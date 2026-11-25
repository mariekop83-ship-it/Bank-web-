import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getPool, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { encryptText, decryptText, generateToken, sha256Hex } from '../utils/crypto.js';
import { allocateUniqueAccountDetails } from '../utils/bankIdentifiers.js';
import { generateBase32Secret, buildOtpAuthUri, generateTotpQrDataUrl, verifyTotpCode } from '../utils/totp.js';
import { createNotification, logSecurityEvent } from './notificationService.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_TTL_HOURS = 24;

export class AuthError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 401, code = 'AUTH_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface RegisterCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  dateOfBirth: string;
  addressLine1: string;
  city: string;
  postalCode?: string;
  password: string;
  accountTier?: 'PERSONAL' | 'BUSINESS';
  preferredCurrency?: string;
}

export async function registerCustomer(
  input: RegisterCustomerInput,
  ctx: { ip?: string; userAgent?: string }
) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const verifyToken = generateToken(24);
  const verifyTokenHash = sha256Hex(verifyToken);

  const result = await withTransaction(async (conn) => {
    const [existing]: any = await conn.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
    if (existing.length > 0) {
      throw new AuthError('An account with this email address already exists.', 409, 'EMAIL_EXISTS');
    }

    const userUuid = crypto.randomUUID();
    const [userRes]: any = await conn.query(
      `INSERT INTO users (uuid, email, phone, password_hash, status, kyc_status)
       VALUES (?, ?, ?, ?, 'ACTIVE', 'NOT_STARTED')`,
      [userUuid, email, input.phone.trim(), passwordHash]
    );
    const userId = Number(userRes.insertId);

    const preferredCurrency = input.preferredCurrency || 'USD';
    await conn.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, nationality, preferred_currency, account_tier, terms_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        userId,
        input.firstName.trim(),
        input.lastName.trim(),
        input.dateOfBirth,
        input.country.toUpperCase(),
        preferredCurrency,
        input.accountTier || 'PERSONAL',
      ]
    );

    await conn.query(
      `INSERT INTO user_addresses (user_id, address_line_1, city, postal_code, country, is_primary)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        userId,
        input.addressLine1.trim(),
        input.city.trim(),
        input.postalCode?.trim() || null,
        input.country.toUpperCase(),
      ]
    );

    // Provision primary bank account record & initial multi-currency ledger wallets
    const { accountNumber, iban, routingNumber, bicSwift } = await allocateUniqueAccountDetails(conn);
    const [bankRes]: any = await conn.query(
      `INSERT INTO bank_accounts (uuid, user_id, account_number, iban, bic_swift, routing_number, account_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        userId,
        accountNumber,
        iban,
        bicSwift,
        routingNumber,
        input.accountTier === 'BUSINESS' ? 'BUSINESS_TREASURY' : 'PERSONAL_CHECKING',
      ]
    );
    const bankAccountId = Number(bankRes.insertId);

    const initialCurrencies = Array.from(new Set([preferredCurrency, 'USD', 'EUR', 'GBP']));
    for (const curr of initialCurrencies) {
      const [availRes]: any = await conn.query(
        `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
         VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
        [`CUST_${userId}_${curr}_AVAIL`, `Customer ${userId} Available ${curr}`, curr, userId]
      );
      const [pendRes]: any = await conn.query(
        `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
         VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
        [`CUST_${userId}_${curr}_PEND`, `Customer ${userId} Pending ${curr}`, curr, userId]
      );
      await conn.query(
        `INSERT INTO currency_accounts (uuid, bank_account_id, user_id, currency, available_ledger_account_id, pending_ledger_account_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), bankAccountId, userId, curr, availRes.insertId, pendRes.insertId]
      );
    }

    await conn.query(
      `INSERT INTO user_verifications (user_id, verification_type, token_hash, status, expires_at)
       VALUES (?, 'EMAIL_VERIFY', ?, 'PENDING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 24 HOUR))`,
      [userId, verifyTokenHash]
    );

    await createNotification(
      {
        userId,
        category: 'KYC',
        title: `Welcome to ${env.brand.shortName}`,
        message: 'Your multi-currency account ledger has been provisioned. Complete email verification and KYC to unlock external rails.',
        emailTo: email,
        sendEmail: true,
      },
      conn
    );

    await logSecurityEvent(
      {
        actorType: 'CUSTOMER',
        actorId: userId,
        eventType: 'CUSTOMER_REGISTERED',
        severity: 'INFO',
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      },
      conn
    );

    return { userId, uuid: userUuid, email, accountNumber };
  });

  // In non-production or when SMTP is unconfigured, verification link can be dispatched via configured email provider
  return {
    ...result,
    emailVerificationRequired: true,
    verificationUrl:
      env.nodeEnv !== 'production'
        ? `${env.publicUrl}/verify-email?token=${verifyToken}`
        : undefined,
  };
}

export async function loginCustomer(
  input: { email: string; password: string; totpCode?: string; deviceFingerprint?: string; deviceName?: string },
  ctx: { ip?: string; userAgent?: string }
) {
  const email = input.email.trim().toLowerCase();
  const pool = getPool();

  const [rows]: any = await pool.query(
    `SELECT u.*, p.first_name, p.last_name
     FROM users u
     JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = ? LIMIT 1`,
    [email]
  );

  if (rows.length === 0) {
    await logSecurityEvent({
      actorType: 'CUSTOMER',
      eventType: 'LOGIN_FAILED_UNKNOWN_EMAIL',
      severity: 'WARNING',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { email },
    });
    throw new AuthError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  const user = rows[0];

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new AuthError(
      'Account temporarily locked due to repeated failed sign-in attempts. Please try again later.',
      423,
      'ACCOUNT_LOCKED'
    );
  }

  if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
    throw new AuthError('This account is currently suspended. Contact compliance support.', 403, 'ACCOUNT_SUSPENDED');
  }

  const passwordOk = await bcrypt.compare(input.password, user.password_hash);
  if (!passwordOk) {
    const nextAttempts = Number(user.failed_login_attempts || 0) + 1;
    const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
    await pool.query(
      `UPDATE users
       SET failed_login_attempts = ?,
           locked_until = ${shouldLock ? `DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LOCKOUT_MINUTES} MINUTE)` : 'NULL'}
       WHERE id = ?`,
      [nextAttempts, user.id]
    );
    await logSecurityEvent({
      actorType: 'CUSTOMER',
      actorId: user.id,
      eventType: shouldLock ? 'ACCOUNT_LOCKED_FAILED_LOGINS' : 'LOGIN_FAILED_BAD_PASSWORD',
      severity: shouldLock ? 'CRITICAL' : 'WARNING',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw new AuthError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  // Enforce 2FA if enabled
  if (user.two_factor_enabled) {
    if (!input.totpCode) {
      return {
        requiresTwoFactor: true,
        mfaToken: jwt.sign({ uid: user.id, purpose: 'mfa_login' }, env.security.jwtSecret, { expiresIn: '5m' }),
      };
    }
    const secret = decryptText(user.two_factor_secret_enc);
    if (!verifyTotpCode(secret, input.totpCode)) {
      await logSecurityEvent({
        actorType: 'CUSTOMER',
        actorId: user.id,
        eventType: 'LOGIN_FAILED_2FA',
        severity: 'WARNING',
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new AuthError('Invalid two-factor authentication code.', 401, 'INVALID_2FA');
    }
  }

  return await createCustomerSession(user, input.deviceFingerprint, input.deviceName, ctx);
}

async function createCustomerSession(
  user: any,
  deviceFingerprint: string | undefined,
  deviceName: string | undefined,
  ctx: { ip?: string; userAgent?: string }
) {
  const rawSessionToken = generateToken(32);
  const tokenHash = sha256Hex(rawSessionToken);
  const fp = deviceFingerprint || sha256Hex(ctx.userAgent || 'unknown-browser').slice(0, 32);
  const dName = deviceName || (ctx.userAgent ? ctx.userAgent.slice(0, 120) : 'Web Browser');

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [user.id]
    );

    const [devRows]: any = await conn.query(
      `SELECT id FROM user_devices WHERE user_id = ? AND device_fingerprint = ? LIMIT 1`,
      [user.id, fp]
    );

    let deviceId: number;
    let isNewDevice = false;

    if (devRows.length === 0) {
      isNewDevice = true;
      const [devRes]: any = await conn.query(
        `INSERT INTO user_devices (user_id, device_fingerprint, device_name, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, fp, dName, ctx.userAgent?.slice(0, 512) || null, ctx.ip?.slice(0, 64) || null]
      );
      deviceId = Number(devRes.insertId);
    } else {
      deviceId = Number(devRows[0].id);
      await conn.query(
        `UPDATE user_devices SET last_seen_at = UTC_TIMESTAMP(3), ip_address = ? WHERE id = ?`,
        [ctx.ip?.slice(0, 64) || null, deviceId]
      );
    }

    await conn.query(
      `INSERT INTO user_sessions (user_id, device_id, token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${SESSION_TTL_HOURS} HOUR))`,
      [user.id, deviceId, tokenHash, ctx.ip?.slice(0, 64) || null, ctx.userAgent?.slice(0, 512) || null]
    );

    await createNotification(
      {
        userId: user.id,
        category: isNewDevice ? 'NEW_DEVICE' : 'LOGIN',
        title: isNewDevice ? 'New device sign-in detected' : 'Successful sign-in',
        message: isNewDevice
          ? `A new device (${dName}) signed into your account from IP ${ctx.ip || 'unknown'}.`
          : `You signed into your account from IP ${ctx.ip || 'unknown'}.`,
        emailTo: user.email,
        sendEmail: isNewDevice,
      },
      conn
    );

    await logSecurityEvent(
      {
        actorType: 'CUSTOMER',
        actorId: user.id,
        eventType: isNewDevice ? 'CUSTOMER_LOGIN_NEW_DEVICE' : 'CUSTOMER_LOGIN',
        severity: isNewDevice ? 'WARNING' : 'INFO',
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      },
      conn
    );
  });

  const jwtToken = jwt.sign(
    { uid: user.id, uuid: user.uuid, st: rawSessionToken, role: 'customer' },
    env.security.jwtSecret,
    { expiresIn: `${SESSION_TTL_HOURS}h` }
  );

  return {
    requiresTwoFactor: false,
    token: jwtToken,
    user: {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      status: user.status,
      kycStatus: user.kyc_status,
      twoFactorEnabled: Boolean(user.two_factor_enabled),
      emailVerified: Boolean(user.email_verified_at),
    },
  };
}

export async function setupCustomer2FA(userId: number, email: string) {
  const secret = generateBase32Secret(32);
  const enc = encryptText(secret);
  const pool = getPool();
  await pool.query(`UPDATE users SET two_factor_secret_enc = ? WHERE id = ?`, [enc, userId]);
  const otpAuthUri = buildOtpAuthUri(email, env.brand.shortName, secret);
  const qrDataUrl = await generateTotpQrDataUrl(otpAuthUri);
  return { secret, otpAuthUri, qrDataUrl };
}

export async function enableCustomer2FA(userId: number, code: string) {
  const pool = getPool();
  const [rows]: any = await pool.query(`SELECT two_factor_secret_enc, email FROM users WHERE id = ? LIMIT 1`, [userId]);
  if (rows.length === 0 || !rows[0].two_factor_secret_enc) {
    throw new AuthError('2FA setup has not been initiated.', 400, '2FA_NOT_INITIATED');
  }
  const secret = decryptText(rows[0].two_factor_secret_enc);
  if (!verifyTotpCode(secret, code)) {
    throw new AuthError('Invalid verification code.', 400, 'INVALID_2FA');
  }
  await pool.query(`UPDATE users SET two_factor_enabled = 1 WHERE id = ?`, [userId]);
  await createNotification({
    userId,
    category: 'SECURITY_ALERT',
    title: 'Two-factor authentication enabled',
    message: 'Authenticator app 2FA is now active on your account.',
    emailTo: rows[0].email,
    sendEmail: true,
  });
  return { enabled: true };
}
