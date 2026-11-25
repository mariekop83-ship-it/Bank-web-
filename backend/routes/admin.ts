import { Router } from 'express';
import { z } from 'zod';
import { getPool, withTransaction } from '../config/database.js';
import { requireAdminAuth, requirePermission } from '../middleware/auth.js';
import { authRateLimiter, clearSecureSessionCookie, setSecureSessionCookie } from '../middleware/security.js';
import {
  bootstrapFirstAdmin,
  getAdminBootstrapStatus,
  loginAdmin,
  recordAdminAuditLog,
} from '../services/adminService.js';
import {
  approveAndSettleWithdrawal,
  rejectWithdrawalAndReleaseHold,
  settleVerifiedDeposit,
} from '../services/depositWithdrawalService.js';
import { getDecryptedKycDocument, reviewCustomerKyc } from '../services/kycService.js';
import { reverseLedgerTransaction } from '../services/ledgerService.js';
import { createNotification } from '../services/notificationService.js';
import { getAllProviderStatuses } from '../services/providers/registry.js';

export const adminRouter = Router();

// Public admin bootstrap check & first-run super-admin claim (only when 0 admins exist)
adminRouter.get('/bootstrap-status', async (_req, res, next) => {
  try {
    const status = await getAdminBootstrapStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/bootstrap', authRateLimiter, async (req, res, next) => {
  try {
    const data = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2).max(160),
        password: z.string().min(12).max(128),
        setupToken: z.string().optional(),
      })
      .parse(req.body);
    const result = await bootstrapFirstAdmin({ ...data, ipAddress: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/auth/login', authRateLimiter, async (req, res, next) => {
  try {
    const data = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        totpCode: z.string().optional(),
      })
      .parse(req.body);

    const result = await loginAdmin(data, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (!result.requiresTwoFactor && 'token' in result && result.token) {
      setSecureSessionCookie(res, req, 'mb_admin_session', result.token, 8 * 60 * 60 * 1000);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/auth/logout', requireAdminAuth, async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?`, [
      req.admin!.sessionId,
    ]);
    clearSecureSessionCookie(res, req, 'mb_admin_session');
    res.json({ message: 'Administrator signed out.' });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/auth/me', requireAdminAuth, async (req, res) => {
  res.json({ admin: req.admin });
});

// Protected Administrator Endpoints
adminRouter.use(requireAdminAuth);

adminRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const pool = getPool();
    const [[custStats]]: any = await pool.query(`
      SELECT
        COUNT(*) AS total_customers,
        SUM(CASE WHEN kyc_status = 'APPROVED' THEN 1 ELSE 0 END) AS verified_customers,
        SUM(CASE WHEN kyc_status IN ('PENDING', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS pending_kyc,
        SUM(CASE WHEN status IN ('SUSPENDED', 'RESTRICTED') THEN 1 ELSE 0 END) AS suspended_accounts
      FROM users
    `);

    const [[txStats]]: any = await pool.query(`
      SELECT
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN status = 'SUCCESSFUL' THEN 1 ELSE 0 END) AS successful_transactions,
        SUM(CASE WHEN status IN ('PENDING', 'PROCESSING') THEN 1 ELSE 0 END) AS pending_transactions,
        SUM(CASE WHEN status IN ('FAILED', 'REVERSED') THEN 1 ELSE 0 END) AS failed_transactions,
        COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL' THEN total_amount ELSE 0 END), 0) AS transaction_volume,
        COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL' THEN fee_amount ELSE 0 END), 0) AS fee_revenue
      FROM ledger_transactions
    `);

    const [[depStats]]: any = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL' THEN amount ELSE 0 END), 0) AS deposit_volume,
             SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_deposits
      FROM deposits
    `);

    const [[wdStats]]: any = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL' THEN amount ELSE 0 END), 0) AS withdrawal_volume,
             SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_withdrawals
      FROM withdrawals
    `);

    res.json({
      customers: custStats,
      transactions: txStats,
      deposits: depStats,
      withdrawals: wdStats,
      providers: getAllProviderStatuses(),
    });
  } catch (err) {
    next(err);
  }
});

// Customer Management
adminRouter.get('/users', requirePermission('users.read'), async (req, res, next) => {
  try {
    const pool = getPool();
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const kyc = String(req.query.kyc || '').trim();

    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (search) {
      where.push('(u.email LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR ba.account_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push('u.status = ?');
      params.push(status);
    }
    if (kyc) {
      where.push('u.kyc_status = ?');
      params.push(kyc);
    }

    const [rows]: any = await pool.query(
      `SELECT u.id, u.uuid, u.email, u.phone, u.status, u.kyc_status, u.two_factor_enabled, u.created_at, u.last_login_at,
              p.first_name, p.last_name, p.account_tier, p.preferred_currency,
              ba.account_number
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN bank_accounts ba ON ba.user_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY u.created_at DESC LIMIT 100`,
      params
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/users/:id/status', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { status, reason } = z
      .object({
        status: z.enum(['ACTIVE', 'SUSPENDED', 'RESTRICTED']),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);

    const pool = getPool();
    const [existing]: any = await pool.query(`SELECT status, email FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (existing.length === 0) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    await pool.query(`UPDATE users SET status = ? WHERE id = ?`, [status, userId]);
    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: `CUSTOMER_STATUS_${status}`,
      targetType: 'users',
      targetId: String(userId),
      reason,
      details: { previousStatus: existing[0].status, newStatus: status },
      ipAddress: req.ip,
    });

    await createNotification({
      userId,
      category: 'ACCOUNT_RESTRICTION',
      title: `Account status updated: ${status}`,
      message: reason,
      emailTo: existing[0].email,
      sendEmail: true,
    });

    res.json({ updated: true, status });
  } catch (err) {
    next(err);
  }
});

// KYC Review Queue
adminRouter.get('/kyc', requirePermission('kyc.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [submissions]: any = await pool.query(
      `SELECT u.id AS user_id, u.email, u.kyc_status, p.first_name, p.last_name, p.date_of_birth,
              a.address_line_1, a.city, a.country,
              kd.id AS doc_id, kd.uuid AS doc_uuid, kd.document_type, kd.issuing_country, kd.original_filename,
              kd.review_status, kd.reviewer_notes, kd.created_at AS uploaded_at
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_addresses a ON a.user_id = u.id AND a.is_primary = 1
       JOIN kyc_documents kd ON kd.user_id = u.id
       ORDER BY FIELD(u.kyc_status, 'PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED', 'REJECTED', 'APPROVED', 'NOT_STARTED'), kd.created_at DESC`
    );
    res.json({ submissions });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/kyc/documents/:uuid', requirePermission('kyc.read'), async (req, res, next) => {
  try {
    const file = await getDecryptedKycDocument({
      documentUuid: req.params.uuid,
      actorType: 'ADMIN',
      actorId: req.admin!.id,
      ipAddress: req.ip,
    });
    if (!file) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'KYC_DOCUMENT_VIEWED',
      targetType: 'kyc_documents',
      targetId: req.params.uuid,
      ipAddress: req.ip,
    });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/kyc/:userId/review', requirePermission('kyc.review'), async (req, res, next) => {
  try {
    const data = z
      .object({
        decision: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED']),
        notes: z.string().min(3).max(1000),
      })
      .parse(req.body);

    const out = await reviewCustomerKyc({
      userId: Number(req.params.userId),
      adminUserId: req.admin!.id,
      decision: data.decision,
      notes: data.notes,
      ipAddress: req.ip,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Accounts Explorer
adminRouter.get('/accounts', requirePermission('accounts.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [accounts]: any = await pool.query(
      `SELECT ca.id, ca.currency, ca.available_balance, ca.pending_balance, ca.ledger_balance, ca.status,
              ba.account_number, ba.iban, ba.status AS bank_status,
              u.email, p.first_name, p.last_name
       FROM currency_accounts ca
       JOIN bank_accounts ba ON ba.id = ca.bank_account_id
       JOIN users u ON u.id = ca.user_id
       JOIN user_profiles p ON p.user_id = u.id
       ORDER BY ca.id DESC LIMIT 200`
    );
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// Transactions & Double-Entry Ledger Inspector + Controlled Reversal
adminRouter.get('/transactions', requirePermission('transactions.read'), async (req, res, next) => {
  try {
    const pool = getPool();
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (status) {
      where.push('lt.status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(lt.reference LIKE ? OR lt.description LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows]: any = await pool.query(
      `SELECT lt.*, u.email AS initiator_email
       FROM ledger_transactions lt
       LEFT JOIN users u ON u.id = lt.initiated_by_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY lt.posted_at DESC LIMIT 150`,
      params
    );
    res.json({ transactions: rows });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/transactions/:id/ledger', requirePermission('transactions.read'), async (req, res, next) => {
  try {
    const pool = getPool();
    const [entries]: any = await pool.query(
      `SELECT le.*, la.code AS account_code, la.name AS account_name, la.account_class
       FROM ledger_entries le
       JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE le.ledger_transaction_id = ?
       ORDER BY le.id ASC`,
      [Number(req.params.id)]
    );
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/transactions/:id/reverse', requirePermission('transactions.reverse'), async (req, res, next) => {
  try {
    const { reason, idempotencyKey } = z
      .object({
        reason: z.string().min(5).max(500),
        idempotencyKey: z.string().min(8).max(128),
      })
      .parse(req.body);

    const result = await withTransaction(async (conn) => {
      const rev = await reverseLedgerTransaction(conn, {
        originalTransactionId: Number(req.params.id),
        idempotencyKey,
        adminUserId: req.admin!.id,
        reason,
      });

      await conn.query(
        `INSERT INTO admin_audit_logs (uuid, admin_user_id, action, target_type, target_id, reason, ip_address)
         VALUES (UUID(), ?, 'LEDGER_TRANSACTION_REVERSAL', 'ledger_transactions', ?, ?, ?)`,
        [req.admin!.id, String(req.params.id), reason, req.ip || null]
      );

      return rev;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Deposits Reconciliation
adminRouter.get('/deposits', requirePermission('deposits.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [deposits]: any = await pool.query(
      `SELECT d.*, u.email AS customer_email, p.first_name, p.last_name
       FROM deposits d
       JOIN users u ON u.id = d.user_id
       JOIN user_profiles p ON p.user_id = u.id
       ORDER BY FIELD(d.status, 'PENDING', 'PROCESSING', 'SUCCESSFUL', 'REJECTED', 'FAILED'), d.created_at DESC LIMIT 150`
    );
    res.json({ deposits });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/deposits/:id/confirm', requirePermission('deposits.reconcile'), async (req, res, next) => {
  try {
    const { providerReference, reason } = z
      .object({
        providerReference: z.string().min(4).max(128),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);

    const out = await settleVerifiedDeposit({
      depositId: Number(req.params.id),
      providerReference,
      adminUserId: req.admin!.id,
    });

    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'DEPOSIT_RECONCILED_CONFIRMED',
      targetType: 'deposits',
      targetId: String(req.params.id),
      reason,
      details: { providerReference },
      ipAddress: req.ip,
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/deposits/:id/reject', requirePermission('deposits.reconcile'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(5).max(255) }).parse(req.body);
    const pool = getPool();
    const [result]: any = await pool.query(
      `UPDATE deposits SET status = 'REJECTED', rejection_reason = ?, verified_by_admin_id = ?, verified_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND status IN ('PENDING', 'PROCESSING')`,
      [reason, req.admin!.id, Number(req.params.id)]
    );
    if (result.affectedRows === 0) {
      res.status(400).json({ error: 'Pending deposit not found.' });
      return;
    }
    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'DEPOSIT_REJECTED',
      targetType: 'deposits',
      targetId: String(req.params.id),
      reason,
      ipAddress: req.ip,
    });
    res.json({ rejected: true });
  } catch (err) {
    next(err);
  }
});

// Withdrawals Approval & Payout Control
adminRouter.get('/withdrawals', requirePermission('withdrawals.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [withdrawals]: any = await pool.query(
      `SELECT w.*, u.email AS customer_email, p.first_name, p.last_name
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       JOIN user_profiles p ON p.user_id = u.id
       ORDER BY FIELD(w.status, 'PENDING', 'APPROVED', 'PROCESSING', 'SUCCESSFUL', 'REJECTED', 'FAILED'), w.created_at DESC LIMIT 150`
    );
    res.json({ withdrawals });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/withdrawals/:id/approve', requirePermission('withdrawals.approve'), async (req, res, next) => {
  try {
    const { providerReference, reason } = z
      .object({
        providerReference: z.string().min(4).max(128),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);

    const wd = await approveAndSettleWithdrawal({
      withdrawalId: Number(req.params.id),
      adminUserId: req.admin!.id,
      providerReference,
    });

    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'WITHDRAWAL_APPROVED_SETTLED',
      targetType: 'withdrawals',
      targetId: String(req.params.id),
      reason,
      details: { providerReference },
      ipAddress: req.ip,
    });

    res.json({ withdrawal: wd });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/withdrawals/:id/reject', requirePermission('withdrawals.approve'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(5).max(255) }).parse(req.body);
    const wd = await rejectWithdrawalAndReleaseHold({
      withdrawalId: Number(req.params.id),
      adminUserId: req.admin!.id,
      reason,
    });

    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'WITHDRAWAL_REJECTED',
      targetType: 'withdrawals',
      targetId: String(req.params.id),
      reason,
      ipAddress: req.ip,
    });

    res.json({ withdrawal: wd });
  } catch (err) {
    next(err);
  }
});

// System Fees, Currencies & Settings
adminRouter.get('/system', requirePermission('system.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [fees]: any = await pool.query(`SELECT * FROM transaction_fees ORDER BY id ASC`);
    const [currencies]: any = await pool.query(`SELECT * FROM currencies ORDER BY sort_order ASC`);
    const [settings]: any = await pool.query(`SELECT * FROM system_settings ORDER BY setting_key ASC`);
    res.json({ fees, currencies, settings, providers: getAllProviderStatuses() });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/fees/:id', requirePermission('system.manage'), async (req, res, next) => {
  try {
    const data = z
      .object({
        flatFee: z.string().regex(/^\d+(\.\d{1,4})?$/),
        percentFee: z.string().regex(/^\d+(\.\d{1,4})?$/),
        minFee: z.string().regex(/^\d+(\.\d{1,4})?$/),
        maxFee: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable(),
        isActive: z.boolean(),
        reason: z.string().min(3).max(255),
      })
      .parse(req.body);

    const pool = getPool();
    await pool.query(
      `UPDATE transaction_fees SET flat_fee = ?, percent_fee = ?, min_fee = ?, max_fee = ?, is_active = ? WHERE id = ?`,
      [data.flatFee, data.percentFee, data.minFee, data.maxFee, data.isActive ? 1 : 0, Number(req.params.id)]
    );
    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'FEE_RULE_UPDATED',
      targetType: 'transaction_fees',
      targetId: String(req.params.id),
      reason: data.reason,
      details: data,
      ipAddress: req.ip,
    });
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/settings', requirePermission('system.manage'), async (req, res, next) => {
  try {
    const { settingKey, settingValue, reason } = z
      .object({
        settingKey: z.string().min(2).max(120),
        settingValue: z.string().max(2000),
        reason: z.string().min(3).max(255),
      })
      .parse(req.body);

    const pool = getPool();
    await pool.query(
      `UPDATE system_settings SET setting_value = ?, updated_by_admin_id = ? WHERE setting_key = ?`,
      [settingValue, req.admin!.id, settingKey]
    );
    await recordAdminAuditLog({
      adminUserId: req.admin!.id,
      action: 'SYSTEM_SETTING_UPDATED',
      targetType: 'system_settings',
      targetId: settingKey,
      reason,
      details: { settingValue },
      ipAddress: req.ip,
    });
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/audit-logs', requirePermission('audit.read'), async (_req, res, next) => {
  try {
    const pool = getPool();
    const [auditLogs]: any = await pool.query(
      `SELECT l.*, au.email AS admin_email, au.full_name AS admin_name
       FROM admin_audit_logs l
       LEFT JOIN admin_users au ON au.id = l.admin_user_id
       ORDER BY l.created_at DESC LIMIT 200`
    );
    const [securityEvents]: any = await pool.query(
      `SELECT * FROM security_events ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ auditLogs, securityEvents });
  } catch (err) {
    next(err);
  }
});
