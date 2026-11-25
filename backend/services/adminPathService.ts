import { getPool, isDatabaseConfigured } from '../config/database.js';
import { env, normalizeAdminPath } from '../config/env.js';
import { recordAdminAuditLog } from './adminService.js';

export interface AdminPathStatus {
  adminPath: string;
  source: 'env' | 'database' | 'default';
  locked: boolean;
}

export async function getEffectiveAdminPathStatus(): Promise<AdminPathStatus> {
  if (env.adminPathLockedByEnv) {
    return {
      adminPath: env.adminPath,
      source: 'env',
      locked: true,
    };
  }

  if (isDatabaseConfigured()) {
    try {
      const pool = getPool();
      const [rows]: any = await pool.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'admin_portal_path' LIMIT 1`
      );
      if (rows.length > 0 && rows[0].setting_value) {
        const parsed = normalizeAdminPath(String(rows[0].setting_value));
        if (parsed.valid && parsed.path !== '/admin') {
          return {
            adminPath: parsed.path,
            source: 'database',
            locked: true,
          };
        }
      }
    } catch {
      // Fall back to default if settings table is not initialized yet
    }
  }

  return {
    adminPath: '/admin',
    source: 'default',
    locked: false,
  };
}

export async function setVendorAdminPath(
  rawInput: string,
  adminUserId: number | null,
  ipAddress?: string
): Promise<AdminPathStatus> {
  const current = await getEffectiveAdminPathStatus();
  if (current.locked) {
    throw Object.assign(
      new Error('Admin portal URL path has already been set and locked by the vendor.'),
      { statusCode: 409, code: 'ADMIN_PATH_LOCKED' }
    );
  }

  const parsed = normalizeAdminPath(rawInput);
  if (!parsed.valid) {
    throw Object.assign(new Error(parsed.reason || 'Invalid admin portal path.'), {
      statusCode: 400,
      code: 'INVALID_ADMIN_PATH',
    });
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, description, is_public, updated_by_admin_id)
     VALUES ('admin_portal_path', ?, 'Vendor-locked administrator portal URL path', 0, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_admin_id = VALUES(updated_by_admin_id)`,
    [parsed.path, adminUserId]
  );

  if (adminUserId) {
    await recordAdminAuditLog({
      adminUserId,
      action: 'ADMIN_PORTAL_PATH_SET',
      targetType: 'system_settings',
      targetId: 'admin_portal_path',
      reason: 'Vendor configured custom administrator portal URL path',
      details: { adminPath: parsed.path },
      ipAddress,
    });
  }

  return {
    adminPath: parsed.path,
    source: 'database',
    locked: parsed.path !== '/admin',
  };
}

export async function isPathMatchingAdminPortal(requestPath: string): Promise<boolean> {
  const clean = (requestPath || '')
    .split('?')[0]
    .split('#')[0]
    .trim()
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();

  if (!clean) return false;
  const status = await getEffectiveAdminPathStatus();
  const target = status.adminPath.toLowerCase();
  return clean === target || clean.startsWith(`${target}/`);
}
