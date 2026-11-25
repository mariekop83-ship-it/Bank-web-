import { Router } from 'express';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { financialRateLimiter } from '../middleware/security.js';
import { executeFxConversion, executeTransfer } from '../services/transferService.js';
import { fxConvertSchema, transferSchema } from '../validators/schemas.js';

export const transfersRouter = Router();
transfersRouter.use(requireCustomerAuth);

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
              partner_provider, partner_reference, failure_reason, created_at
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
