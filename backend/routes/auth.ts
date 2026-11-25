import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { authRateLimiter, clearSecureSessionCookie, setSecureSessionCookie } from '../middleware/security.js';
import {
  enableCustomer2FA,
  loginCustomer,
  registerCustomer,
  setupCustomer2FA,
} from '../services/authService.js';
import { createNotification, logSecurityEvent } from '../services/notificationService.js';
import { generateToken, sha256Hex } from '../utils/crypto.js';
import { loginSchema, registerSchema } from '../validators/schemas.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await registerCustomer(data, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await loginCustomer(data, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (!result.requiresTwoFactor && 'token' in result && result.token) {
      setSecureSessionCookie(res, req, 'mb_session', result.token, 24 * 60 * 60 * 1000);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireCustomerAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?`, [
      req.customer!.sessionId,
    ]);
    clearSecureSessionCookie(res, req, 'mb_session');
    res.json({ message: 'Signed out cleanly.' });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireCustomerAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT u.id, u.uuid, u.email, u.phone, u.status, u.kyc_status, u.email_verified_at, u.phone_verified_at,
              u.two_factor_enabled, u.transaction_pin_hash IS NOT NULL AS has_transaction_pin,
              p.first_name, p.last_name, p.date_of_birth, p.nationality, p.occupation, p.preferred_currency, p.account_tier
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [req.customer!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }
    const u = rows[0];
    res.json({
      id: u.id,
      uuid: u.uuid,
      email: u.email,
      phone: u.phone,
      status: u.status,
      kycStatus: u.kyc_status,
      emailVerified: Boolean(u.email_verified_at),
      phoneVerified: Boolean(u.phone_verified_at),
      twoFactorEnabled: Boolean(u.two_factor_enabled),
      hasTransactionPin: Boolean(u.has_transaction_pin),
      firstName: u.first_name,
      lastName: u.last_name,
      dateOfBirth: u.date_of_birth,
      nationality: u.nationality,
      occupation: u.occupation,
      preferredCurrency: u.preferred_currency,
      accountTier: u.account_tier,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const pool = getPool();
    const tokenHash = sha256Hex(token);
    const [rows]: any = await pool.query(
      `SELECT id, user_id FROM user_verifications
       WHERE token_hash = ? AND verification_type = 'EMAIL_VERIFY' AND status = 'PENDING' AND expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [tokenHash]
    );
    if (rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired email verification token.' });
      return;
    }
    await pool.query(`UPDATE user_verifications SET status = 'VERIFIED', completed_at = UTC_TIMESTAMP(3) WHERE id = ?`, [
      rows[0].id,
    ]);
    await pool.query(`UPDATE users SET email_verified_at = UTC_TIMESTAMP(3) WHERE id = ?`, [rows[0].user_id]);
    res.json({ verified: true, message: 'Email address verified successfully.' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/forgot-password', authRateLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const pool = getPool();
    const [users]: any = await pool.query(`SELECT id, email FROM users WHERE email = ? LIMIT 1`, [
      email.trim().toLowerCase(),
    ]);

    let devResetUrl: string | undefined;
    if (users.length > 0) {
      const token = generateToken(24);
      await pool.query(
        `INSERT INTO user_verifications (user_id, verification_type, token_hash, status, expires_at)
         VALUES (?, 'PASSWORD_RESET', ?, 'PENDING', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR))`,
        [users[0].id, sha256Hex(token)]
      );
      await createNotification({
        userId: users[0].id,
        category: 'SECURITY_ALERT',
        title: 'Password reset requested',
        message: `A password reset was requested for your account. Reset link expires in 1 hour.`,
        emailTo: users[0].email,
        sendEmail: true,
      });
      if (env.nodeEnv !== 'production') {
        devResetUrl = `${env.publicUrl}/reset-password?token=${token}`;
      }
    }

    res.json({
      message: 'If an account matches that email address, password reset instructions have been issued.',
      ...(devResetUrl ? { resetUrl: devResetUrl } : {}),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/reset-password', authRateLimiter, async (req, res, next) => {
  try {
    const data = z
      .object({
        token: z.string().min(10),
        newPassword: z.string().min(10).max(128),
      })
      .parse(req.body);

    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, user_id FROM user_verifications
       WHERE token_hash = ? AND verification_type = 'PASSWORD_RESET' AND status = 'PENDING' AND expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [sha256Hex(data.token)]
    );

    if (rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired password reset token.' });
      return;
    }

    const newHash = await bcrypt.hash(data.newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?`, [
      newHash,
      rows[0].user_id,
    ]);
    await pool.query(`UPDATE user_verifications SET status = 'VERIFIED', completed_at = UTC_TIMESTAMP(3) WHERE id = ?`, [
      rows[0].id,
    ]);
    await pool.query(`UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL`, [
      rows[0].user_id,
    ]);
    await logSecurityEvent({
      actorType: 'CUSTOMER',
      actorId: Number(rows[0].user_id),
      eventType: 'PASSWORD_RESET_COMPLETED',
      severity: 'INFO',
      ipAddress: req.ip,
    });

    res.json({ message: 'Password updated and existing sessions revoked.' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/change-password', requireCustomerAuth, async (req, res, next) => {
  try {
    const data = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(10).max(128),
      })
      .parse(req.body);

    const pool = getPool();
    const [rows]: any = await pool.query(`SELECT password_hash, email FROM users WHERE id = ? LIMIT 1`, [
      req.customer!.id,
    ]);
    const valid = await bcrypt.compare(data.currentPassword, rows[0].password_hash);
    if (!valid) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newHash = await bcrypt.hash(data.newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.customer!.id]);
    await createNotification({
      userId: req.customer!.id,
      category: 'PASSWORD_CHANGE',
      title: 'Password changed',
      message: 'Your account password was changed successfully.',
      emailTo: rows[0].email,
      sendEmail: true,
    });
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/pin', requireCustomerAuth, async (req, res, next) => {
  try {
    const { pin, currentPassword } = z
      .object({
        pin: z.string().regex(/^\d{4,6}$/, 'Transaction PIN must be 4 to 6 digits'),
        currentPassword: z.string().min(1),
      })
      .parse(req.body);

    const pool = getPool();
    const [rows]: any = await pool.query(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, [
      req.customer!.id,
    ]);
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      res.status(403).json({ error: 'Account password verification failed.' });
      return;
    }
    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query(`UPDATE users SET transaction_pin_hash = ? WHERE id = ?`, [pinHash, req.customer!.id]);
    res.json({ message: 'Transaction PIN configured.' });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/2fa/setup', requireCustomerAuth, async (req, res, next) => {
  try {
    const setup = await setupCustomer2FA(req.customer!.id, req.customer!.email);
    res.json(setup);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/2fa/enable', requireCustomerAuth, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
    const out = await enableCustomer2FA(req.customer!.id, code);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/2fa/disable', requireCustomerAuth, async (req, res, next) => {
  try {
    const { currentPassword } = z.object({ currentPassword: z.string().min(1) }).parse(req.body);
    const pool = getPool();
    const [rows]: any = await pool.query(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, [
      req.customer!.id,
    ]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      res.status(403).json({ error: 'Password incorrect.' });
      return;
    }
    await pool.query(`UPDATE users SET two_factor_enabled = 0, two_factor_secret_enc = NULL WHERE id = ?`, [
      req.customer!.id,
    ]);
    res.json({ enabled: false });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/sessions', requireCustomerAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    const [sessions]: any = await pool.query(
      `SELECT s.id, s.ip_address, s.user_agent, s.last_activity_at, s.created_at, s.expires_at,
              d.device_name, d.is_trusted
       FROM user_sessions s
       LEFT JOIN user_devices d ON d.id = s.device_id
       WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       ORDER BY s.last_activity_at DESC`,
      [req.customer!.id]
    );
    res.json({
      currentSessionId: req.customer!.sessionId,
      sessions,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete('/sessions/:id', requireCustomerAuth, async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const pool = getPool();
    await pool.query(`UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ?`, [
      sessionId,
      req.customer!.id,
    ]);
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
});
