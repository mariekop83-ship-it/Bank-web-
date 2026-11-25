import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getPool, withTransaction } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { generateReference } from '../utils/crypto.js';

export const userRouter = Router();
userRouter.use(requireCustomerAuth);

userRouter.get('/profile', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT u.id, u.uuid, u.email, u.phone, u.status, u.kyc_status, u.two_factor_enabled,
              u.email_verified_at, u.phone_verified_at,
              p.first_name, p.last_name, p.date_of_birth, p.nationality, p.occupation, p.preferred_currency, p.account_tier,
              a.address_line_1, a.address_line_2, a.city, a.state_region, a.postal_code, a.country
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_addresses a ON a.user_id = u.id AND a.is_primary = 1
       WHERE u.id = ? LIMIT 1`,
      [req.customer!.id]
    );
    res.json({ profile: rows[0] });
  } catch (err) {
    next(err);
  }
});

userRouter.put('/profile', async (req, res, next) => {
  try {
    const data = z
      .object({
        phone: z.string().min(6).max(40).optional(),
        occupation: z.string().max(150).optional(),
        preferredCurrency: z.enum(['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'CHF', 'JPY']).optional(),
        addressLine1: z.string().min(3).max(255).optional(),
        city: z.string().min(1).max(120).optional(),
        postalCode: z.string().max(40).optional(),
      })
      .parse(req.body);

    const pool = getPool();
    if (data.phone) {
      await pool.query(`UPDATE users SET phone = ? WHERE id = ?`, [data.phone, req.customer!.id]);
    }
    if (data.occupation !== undefined || data.preferredCurrency) {
      await pool.query(
        `UPDATE user_profiles
         SET occupation = COALESCE(?, occupation),
             preferred_currency = COALESCE(?, preferred_currency)
         WHERE user_id = ?`,
        [data.occupation ?? null, data.preferredCurrency ?? null, req.customer!.id]
      );
    }
    if (data.addressLine1 || data.city || data.postalCode !== undefined) {
      await pool.query(
        `UPDATE user_addresses
         SET address_line_1 = COALESCE(?, address_line_1),
             city = COALESCE(?, city),
             postal_code = COALESCE(?, postal_code)
         WHERE user_id = ? AND is_primary = 1`,
        [data.addressLine1 ?? null, data.city ?? null, data.postalCode ?? null, req.customer!.id]
      );
    }
    res.json({ message: 'Profile updated.' });
  } catch (err) {
    next(err);
  }
});

userRouter.get('/accounts', async (req, res, next) => {
  try {
    const pool = getPool();
    const [bankAccounts]: any = await pool.query(
      `SELECT id, uuid, account_number, iban, bic_swift, routing_number, account_type, status, partner_provider, daily_transfer_limit, created_at
       FROM bank_accounts WHERE user_id = ?`,
      [req.customer!.id]
    );
    const [wallets]: any = await pool.query(
      `SELECT ca.id, ca.uuid, ca.currency, ca.available_balance, ca.pending_balance, ca.ledger_balance, ca.status,
              c.name AS currency_name, c.symbol, c.minor_units, c.partner_available
       FROM currency_accounts ca
       JOIN currencies c ON c.code = ca.currency
       WHERE ca.user_id = ?
       ORDER BY c.sort_order ASC`,
      [req.customer!.id]
    );
    res.json({ bankAccounts, wallets });
  } catch (err) {
    next(err);
  }
});

userRouter.post('/accounts', async (req, res, next) => {
  try {
    const { currency } = z
      .object({ currency: z.enum(['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'CHF', 'JPY']) })
      .parse(req.body);

    const wallet = await withTransaction(async (conn) => {
      const [banks]: any = await conn.query(`SELECT id FROM bank_accounts WHERE user_id = ? LIMIT 1`, [
        req.customer!.id,
      ]);
      if (banks.length === 0) throw new Error('Primary bank account not found.');
      const bankAccountId = Number(banks[0].id);

      const [existing]: any = await conn.query(
        `SELECT id FROM currency_accounts WHERE bank_account_id = ? AND currency = ? LIMIT 1`,
        [bankAccountId, currency]
      );
      if (existing.length > 0) {
        throw Object.assign(new Error(`${currency} wallet already exists for this account.`), { statusCode: 409 });
      }

      const [availRes]: any = await conn.query(
        `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
         VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
        [`CUST_${req.customer!.id}_${currency}_AVAIL`, `Customer ${req.customer!.id} Available ${currency}`, currency, req.customer!.id]
      );
      const [pendRes]: any = await conn.query(
        `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
         VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
        [`CUST_${req.customer!.id}_${currency}_PEND`, `Customer ${req.customer!.id} Pending ${currency}`, currency, req.customer!.id]
      );
      const [caRes]: any = await conn.query(
        `INSERT INTO currency_accounts (uuid, bank_account_id, user_id, currency, available_ledger_account_id, pending_ledger_account_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), bankAccountId, req.customer!.id, currency, availRes.insertId, pendRes.insertId]
      );

      const [rows]: any = await conn.query(
        `SELECT ca.*, c.name AS currency_name, c.symbol FROM currency_accounts ca JOIN currencies c ON c.code = ca.currency WHERE ca.id = ?`,
        [caRes.insertId]
      );
      return rows[0];
    });

    res.status(201).json({ wallet });
  } catch (err) {
    next(err);
  }
});

userRouter.get('/dashboard', async (req, res, next) => {
  try {
    const pool = getPool();
    const userId = req.customer!.id;

    const [profileRows]: any = await pool.query(
      `SELECT u.uuid, u.email, u.status, u.kyc_status, u.two_factor_enabled, u.email_verified_at,
              p.first_name, p.last_name, p.preferred_currency, p.account_tier
       FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1`,
      [userId]
    );

    const [bankAccounts]: any = await pool.query(
      `SELECT id, uuid, account_number, iban, bic_swift, account_type, status, partner_provider, daily_transfer_limit
       FROM bank_accounts WHERE user_id = ?`,
      [userId]
    );

    const [wallets]: any = await pool.query(
      `SELECT ca.id, ca.uuid, ca.currency, ca.available_balance, ca.pending_balance, ca.ledger_balance, ca.status,
              c.name AS currency_name, c.symbol, c.partner_available
       FROM currency_accounts ca JOIN currencies c ON c.code = ca.currency
       WHERE ca.user_id = ? ORDER BY c.sort_order ASC`,
      [userId]
    );

    const [depositStats]: any = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_deposits FROM deposits WHERE user_id = ? AND status = 'SUCCESSFUL'`,
      [userId]
    );
    const [withdrawalStats]: any = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_withdrawals FROM withdrawals WHERE user_id = ? AND status = 'SUCCESSFUL'`,
      [userId]
    );
    const [pendingTxCount]: any = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ledger_transactions WHERE initiated_by_user_id = ? AND status IN ('PENDING', 'PROCESSING')`,
      [userId]
    );

    const [recentTransactions]: any = await pool.query(
      `SELECT DISTINCT lt.id, lt.uuid, lt.reference, lt.transaction_type, lt.status, lt.currency,
              lt.total_amount, lt.fee_amount, lt.description, lt.posted_at
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE lt.initiated_by_user_id = ? OR la.owner_user_id = ?
       ORDER BY lt.posted_at DESC LIMIT 10`,
      [userId, userId]
    );

    const [notifications]: any = await pool.query(
      `SELECT id, uuid, category, title, message, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    const [monthlyVolume]: any = await pool.query(
      `SELECT DATE_FORMAT(lt.posted_at, '%Y-%m') AS month_label,
              COALESCE(SUM(lt.total_amount), 0) AS volume,
              COUNT(*) AS tx_count
       FROM ledger_transactions lt
       WHERE lt.initiated_by_user_id = ? AND lt.status = 'SUCCESSFUL'
       GROUP BY DATE_FORMAT(lt.posted_at, '%Y-%m')
       ORDER BY month_label DESC LIMIT 6`,
      [userId]
    );

    res.json({
      customer: profileRows[0],
      bankAccounts,
      wallets,
      summary: {
        totalDeposits: String(depositStats[0].total_deposits || '0.0000'),
        totalWithdrawals: String(withdrawalStats[0].total_withdrawals || '0.0000'),
        pendingCount: Number(pendingTxCount[0].cnt || 0),
      },
      recentTransactions,
      notifications,
      monthlyVolume: monthlyVolume.reverse(),
    });
  } catch (err) {
    next(err);
  }
});

userRouter.get('/support', async (req, res, next) => {
  try {
    const pool = getPool();
    const [tickets]: any = await pool.query(
      `SELECT id, uuid, reference, subject, category, message, status, created_at
       FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC`,
      [req.customer!.id]
    );
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
});

userRouter.post('/support', async (req, res, next) => {
  try {
    const data = z
      .object({
        subject: z.string().min(3).max(200),
        category: z.enum(['GENERAL', 'TRANSFERS', 'KYC', 'CARDS', 'SECURITY', 'BILLING']).optional(),
        message: z.string().min(10).max(4000),
      })
      .parse(req.body);
    const pool = getPool();
    const reference = generateReference('TKT');
    await pool.query(
      `INSERT INTO support_tickets (uuid, reference, user_id, contact_email, subject, category, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [crypto.randomUUID(), reference, req.customer!.id, req.customer!.email, data.subject, data.category || 'GENERAL', data.message]
    );
    res.status(201).json({ reference, message: 'Support ticket submitted.' });
  } catch (err) {
    next(err);
  }
});
