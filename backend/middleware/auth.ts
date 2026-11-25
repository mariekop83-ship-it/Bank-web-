import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { sha256Hex } from '../utils/crypto.js';

export interface AuthenticatedCustomer {
  id: number;
  uuid: string;
  email: string;
  status: string;
  kycStatus: string;
  sessionId: number;
}

export interface AuthenticatedAdmin {
  id: number;
  uuid: string;
  email: string;
  fullName: string;
  roleCode: string;
  permissions: string[];
  sessionId: number;
}

declare global {
  namespace Express {
    interface Request {
      customer?: AuthenticatedCustomer;
      admin?: AuthenticatedAdmin;
    }
  }
}

function extractToken(req: Request, cookieName: string): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (req.cookies && req.cookies[cookieName]) {
    return String(req.cookies[cookieName]);
  }
  return null;
}

export async function requireCustomerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req, 'mb_session');
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const payload = jwt.verify(token, env.security.jwtSecret) as {
      uid: number;
      uuid: string;
      st: string;
      role: string;
    };

    if (payload.role !== 'customer' || !payload.st) {
      res.status(401).json({ error: 'Invalid session token.' });
      return;
    }

    const pool = getPool();
    const tokenHash = sha256Hex(payload.st);
    const [rows]: any = await pool.query(
      `SELECT s.id AS session_id, u.id, u.uuid, u.email, u.status, u.kyc_status
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [tokenHash, payload.uid]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: 'Session expired or revoked.' });
      return;
    }

    const user = rows[0];
    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
      res.status(403).json({ error: 'Account is suspended or closed.' });
      return;
    }

    await pool.query(`UPDATE user_sessions SET last_activity_at = UTC_TIMESTAMP(3) WHERE id = ?`, [
      user.session_id,
    ]);

    req.customer = {
      id: Number(user.id),
      uuid: user.uuid,
      email: user.email,
      status: user.status,
      kycStatus: user.kyc_status,
      sessionId: Number(user.session_id),
    };
    next();
  } catch (err: any) {
    if (err?.code === 'DB_NOT_CONFIGURED') {
      res.status(503).json({ error: err.message, code: 'DB_NOT_CONFIGURED' });
      return;
    }
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req, 'mb_admin_session');
    if (!token) {
      res.status(401).json({ error: 'Administrator authentication required.' });
      return;
    }

    const payload = jwt.verify(token, env.security.jwtSecret) as {
      aid: number;
      uuid: string;
      ast: string;
      role: string;
    };

    if (payload.role !== 'admin' || !payload.ast) {
      res.status(401).json({ error: 'Invalid administrator token.' });
      return;
    }

    const pool = getPool();
    const tokenHash = sha256Hex(payload.ast);
    const [rows]: any = await pool.query(
      `SELECT s.id AS session_id, au.id, au.uuid, au.email, au.full_name, au.status, au.role_id, ar.code AS role_code
       FROM admin_sessions s
       JOIN admin_users au ON au.id = s.admin_user_id
       JOIN admin_roles ar ON ar.id = au.role_id
       WHERE s.token_hash = ? AND s.admin_user_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [tokenHash, payload.aid]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: 'Administrator session expired or revoked.' });
      return;
    }

    const admin = rows[0];
    if (admin.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Administrator account is suspended.' });
      return;
    }

    const [permRows]: any = await pool.query(
      `SELECT ap.code
       FROM admin_role_permissions arp
       JOIN admin_permissions ap ON ap.id = arp.permission_id
       WHERE arp.role_id = ?`,
      [admin.role_id]
    );

    req.admin = {
      id: Number(admin.id),
      uuid: admin.uuid,
      email: admin.email,
      fullName: admin.full_name,
      roleCode: admin.role_code,
      permissions: permRows.map((p: any) => p.code),
      sessionId: Number(admin.session_id),
    };
    next();
  } catch (err: any) {
    if (err?.code === 'DB_NOT_CONFIGURED') {
      res.status(503).json({ error: err.message, code: 'DB_NOT_CONFIGURED' });
      return;
    }
    res.status(401).json({ error: 'Invalid or expired administrator session.' });
  }
}

export function requirePermission(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Administrator authentication required.' });
      return;
    }
    if (req.admin.roleCode === 'SUPER_ADMIN' || req.admin.permissions.includes(permissionCode)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Insufficient administrator privileges. Required permission: ${permissionCode}`,
    });
  };
}
