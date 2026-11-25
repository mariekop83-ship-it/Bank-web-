import { Router } from 'express';
import { brandConfig } from '../config/brand.js';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { financialRateLimiter } from '../middleware/security.js';
import { executeFxConversion, executeTransfer } from '../services/transferService.js';
import { fxConvertSchema, transferSchema } from '../validators/schemas.js';

export const transfersRouter = Router();
transfersRouter.use(requireCustomerAuth);

transfersRouter.get('/resolve-account', financialRateLimiter, async (req, res, next) => {
  try {
    const rawAccount = String(req.query.accountNumber || '').trim().toUpperCase();
    const requestedCurrency = String(req.query.currency || '').trim().toUpperCase();
    if (rawAccount.length < 4 || rawAccount.length > 64) {
      res.status(400).json({ found: false, error: 'Enter a valid account number or IBAN.' });
      return;
    }

    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT ba.id AS bank_account_id, ba.user_id, ba.account_number, ba.iban, ba.bic_swift, ba.status AS bank_status,
              u.status AS user_status, p.first_name, p.last_name, a.country
       FROM bank_accounts ba
       JOIN users u ON u.id = ba.user_id
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_addresses a ON a.user_id = u.id AND a.is_primary = 1
       WHERE UPPER(ba.account_number) = ? OR UPPER(ba.iban) = ?
       LIMIT 1`,
      [rawAccount, rawAccount]
    );

    if (rows.length === 0) {
      res.json({
        found: false,
        error: `No ${brandConfig.brandName} account matched "${rawAccount}".`,
      });
      return;
    }

    const acct = rows[0];
    if (acct.bank_status !== 'ACTIVE' || acct.user_status !== 'ACTIVE') {
      res.json({
        found: false,
        error: 'This recipient account is currently restricted or inactive.',
      });
      return;
    }

    const [walletRows]: any = await pool.query(
      `SELECT currency FROM currency_accounts WHERE bank_account_id = ? AND status = 'ACTIVE' ORDER BY id ASC`,
      [acct.bank_account_id]
    );
    const supportedCurrencies = walletRows.map((w: any) => String(w.currency));
    const supportsRequestedCurrency = requestedCurrency
      ? supportedCurrencies.includes(requestedCurrency)
      : true;

    res.json({
      found: true,
      accountNumber: acct.account_number,
      iban: acct.iban,
      bicSwift: acct.bic_swift,
      accountName: `${acct.first_name} ${acct.last_name}`.trim(),
      bankName: brandConfig.brandName,
      country: acct.country || 'GB',
      supportedCurrencies,
      supportsRequestedCurrency,
      isOwnAccount: Number(acct.user_id) === req.customer!.id,
    });
  } catch (err) {
    next(err);
  }
});

transfersRouter.post('/', financialRateLimiter, async (req, res, next) => {
  try {
    const data = transferSchema.parse(req.body);
    const result = await executeTransfer({
      ...data,
      senderUserId: req.customer!.id,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

transfersRouter.post('/fx-convert', financialRateLimiter, async (req, res, next) => {
  try {
    const data = fxConvertSchema.parse(req.body);
    const result = await executeFxConversion({
      ...data,
      userId: req.customer!.id,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

transfersRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, reference, transfer_type, recipient_name, recipient_account_number, recipient_bank,
              recipient_country, recipient_currency, amount, fee_amount, currency, description, status,
              ledger_transaction_id, partner_provider, partner_reference, failure_reason, created_at
       FROM transfers
       WHERE sender_user_id = ? OR recipient_user_id = ?
       ORDER BY created_at DESC LIMIT 100`,
      [req.customer!.id, req.customer!.id]
    );
    res.json({ transfers: rows });
  } catch (err) {
    next(err);
  }
});

transfersRouter.get('/fx-history', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, reference, source_currency, target_currency, source_amount, target_amount,
              fee_amount, exchange_rate, rate_source, status, created_at
       FROM fx_conversions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.customer!.id]
    );
    res.json({ conversions: rows });
  } catch (err) {
    next(err);
  }
});

transfersRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT * FROM transfers WHERE (id = ? OR uuid = ?) AND (sender_user_id = ? OR recipient_user_id = ?) LIMIT 1`,
      [req.params.id, req.params.id, req.customer!.id, req.customer!.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Transfer not found.' });
      return;
    }
    res.json({ transfer: rows[0] });
  } catch (err) {
    next(err);
  }
});
