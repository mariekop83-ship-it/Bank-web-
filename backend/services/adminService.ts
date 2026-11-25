import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getPool, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { decryptText, encryptText, generateToken, sha256Hex } from '../utils/crypto.js';
import { buildOtpAuthUri, generateBase32Secret, generateTotpQrDataUrl, verifyTotpCode } from '../utils/totp.js';
import { logSecurityEvent } from './notificationService.js';

export async function recordAdminAuditLog(params: {
  adminUserId: number | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO admin_audit_logs (uuid, admin_user_id, action, target_type, target_id, reason, details_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      params.adminUserId,
      params.action,
      params.targetType,
      params.targetId,
      params.reason || null,
      params.details ? JSON.stringify(params.details) : null,
      params.ipAddress || null,
    ]
  );
}

export async function getAdminBootstrapStatus(): Promise<{ needsBootstrap: boolean }> {
  const pool = getPool();
  const [rows]: any = await pool.query(`SELECT COUNT(*) AS cnt FROM admin_users`);
  return { needsBootstrap: Number(rows[0].cnt) === 0 };
}

export async function bootstrapFirstAdmin(params: {
  email: string;
  fullName: string;
  password: string;
  setupToken?: string;
  ipAddress?: string;
}) {
  if (env.security.adminSetupToken && params.setupToken !== env.security.adminSetupToken) {
    throw Object.assign(new Error('Invalid administrator bootstrap setup token.'), { statusCode: 403 });
  }

  const email = params.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(params.password, 12);
  const totpSecret = generateBase32Secret(32);
  const totpEnc = encryptText(totpSecret);

  const created = await withTransaction(async (conn) => {
    const [existingAdmins]: any = await conn.query(`SELECT COUNT(*) AS cnt FROM admin_users FOR UPDATE`);
    if (Number(existingAdmins[0].cnt) > 0) {
      throw Object.assign(new Error('An administrator account already exists. Bootstrap is locked.'), {
        statusCode: 409,
      });
    }

    const [roles]: any = await conn.query(`SELECT id FROM admin_roles WHERE code = 'SUPER_ADMIN' LIMIT 1`);
    if (roles.length === 0) {
      throw Object.assign(new Error('Admin roles not seeded. Run database migrations first.'), { statusCode: 500 });
    }

    const [res]: any = await conn.query(
      `INSERT INTO admin_users (uuid, email, full_name, password_hash, role_id, status, mfa_enabled, mfa_secret_enc)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?)`,
      [crypto.randomUUID(), email, params.fullName.trim(), passwordHash, roles[0].id, totpEnc]
    );

    await conn.query(
      `INSERT INTO admin_audit_logs (uuid, admin_user_id, action, target_type, target_id, reason, ip_address)
       VALUES (?, ?, 'ADMIN_FIRST_RUN_BOOTSTRAP', 'admin_users', ?, 'Initial Super Administrator claimed via first-run setup', ?)`,
      [crypto.randomUUID(), res.insertId, String(res.insertId), params.ipAddress || null]
    );

    return { id: Number(res.insertId), email };
  });

  const otpAuthUri = buildOtpAuthUri(email, env.brand.shortName + ' Admin', totpSecret);
  const qrDataUrl = await generateTotpQrDataUrl(otpAuthUri);
  return {
    ...created,
    totpSecret,
    otpAuthUri,
    qrDataUrl,
  };
}

export async function loginAdmin(
  input: { email: string; password: string; totpCode?: string },
  ctx: { ip?: string; userAgent?: string }
) {
  const pool = getPool();
  const email = input.email.trim().toLowerCase();

  const [rows]: any = await pool.query(
    `SELECT au.*, ar.code AS role_code, ar.name AS role_name
     FROM admin_users au
     JOIN admin_roles ar ON ar.id = au.role_id
     WHERE au.email = ? LIMIT 1`,
    [email]
  );

  if (rows.length === 0) {
    await logSecurityEvent({
      actorType: 'ADMIN',
      eventType: 'ADMIN_LOGIN_FAILED',
      severity: 'WARNING',
      ipAddress: ctx.ip,
      metadata: { email },
    });
    throw Object.assign(new Error('Invalid administrator credentials.'), { statusCode: 401 });
  }

  const admin = rows[0];
  if (admin.status !== 'ACTIVE') {
    throw Object.assign(new Error('Administrator account is suspended.'), { statusCode: 403 });
  }
  if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
    throw Object.assign(new Error('Administrator account is temporarily locked.'), { statusCode: 423 });
  }

  const ok = await bcrypt.compare(input.password, admin.password_hash);
  if (!ok) {
    const attempts = Number(admin.failed_login_attempts || 0) + 1;
    const lock = attempts >= 5;
    await pool.query(
      `UPDATE admin_users SET failed_login_attempts = ?, locked_until = ${
        lock ? 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)' : 'NULL'
      } WHERE id = ?`,
      [attempts, admin.id]
    );
    throw Object.assign(new Error('Invalid administrator credentials.'), { statusCode: 401 });
  }

  if (admin.mfa_enabled) {
    if (!input.totpCode) {
      return { requiresTwoFactor: true };
    }
    const secret = decryptText(admin.mfa_secret_enc);
    if (!verifyTotpCode(secret, input.totpCode)) {
      throw Object.assign(new Error('Invalid administrator MFA code.'), { statusCode: 401 });
    }
  }

  const rawToken = generateToken(32);
  const tokenHash = sha256Hex(rawToken);

  await pool.query(
    `UPDATE admin_users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(3) WHERE id = ?`,
    [admin.id]
  );

  await pool.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, ip_address, user_agent, mfa_verified, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR))`,
    [admin.id, tokenHash, ctx.ip?.slice(0, 64) || null, ctx.userAgent?.slice(0, 512) || null, admin.mfa_enabled ? 1 : 0]
  );

  const [permRows]: any = await pool.query(
    `SELECT ap.code
     FROM admin_role_permissions arp
     JOIN admin_permissions ap ON ap.id = arp.permission_id
     WHERE arp.role_id = ?`,
    [admin.role_id]
  );

  await recordAdminAuditLog({
    adminUserId: Number(admin.id),
    action: 'ADMIN_LOGIN',
    targetType: 'admin_users',
    targetId: String(admin.id),
    ipAddress: ctx.ip,
  });

  const jwtToken = jwt.sign(
    { aid: admin.id, uuid: admin.uuid, ast: rawToken, role: 'admin', roleCode: admin.role_code },
    env.security.jwtSecret,
    { expiresIn: '8h' }
  );

  return {
    requiresTwoFactor: false,
    token: jwtToken,
    admin: {
      id: admin.id,
      uuid: admin.uuid,
      email: admin.email,
      fullName: admin.full_name,
      roleCode: admin.role_code,
      roleName: admin.role_name,
      mfaEnabled: Boolean(admin.mfa_enabled),
      permissions: permRows.map((p: any) => p.code),
    },
  };
}
