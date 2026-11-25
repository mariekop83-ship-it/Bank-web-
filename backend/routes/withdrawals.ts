import { Router } from 'express';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { financialRateLimiter } from '../middleware/security.js';
import { createWithdrawalRequest } from '../services/depositWithdrawalService.js';
import { withdrawalSchema } from '../validators/schemas.js';

export const withdrawalsRouter = Router();
withdrawalsRouter.use(requireCustomerAuth);

withdrawalsRouter.post('/', financialRateLimiter, async (req, res, next) => {
  try {
    const data = withdrawalSchema.parse(req.body);
    const result = await createWithdrawalRequest({
      ...data,
      userId: req.customer!.id,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

withdrawalsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, reference, method, amount, fee_amount, currency, destination_details_json,
              status, provider_name, provider_reference, rejection_reason, reviewed_at, created_at
       FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.customer!.id]
    );
    res.json({ withdrawals: rows });
  } catch (err) {
    next(err);
  }
});
