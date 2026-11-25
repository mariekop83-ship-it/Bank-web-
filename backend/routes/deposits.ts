import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { financialRateLimiter } from '../middleware/security.js';
import { createDepositRequest } from '../services/depositWithdrawalService.js';
import { depositSchema } from '../validators/schemas.js';

export const depositsRouter = Router();
depositsRouter.use(requireCustomerAuth);

depositsRouter.post('/', financialRateLimiter, async (req, res, next) => {
  try {
    const data = depositSchema.parse(req.body);
    const result = await createDepositRequest({
      ...data,
      userId: req.customer!.id,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

depositsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, reference, method, amount, fee_amount, currency, status, provider_name,
              provider_reference, receipt_reference, rejection_reason, verified_at, created_at
       FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.customer!.id]
    );
    res.json({ deposits: rows });
  } catch (err) {
    next(err);
  }
});

depositsRouter.post('/:id/receipt', async (req, res, next) => {
  try {
    const { receiptReference } = z.object({ receiptReference: z.string().min(3).max(255) }).parse(req.body);
    const pool = getPool();
    // Attaches receipt reference for reconciliation only — NEVER credits customer balance!
    const [result]: any = await pool.query(
      `UPDATE deposits SET receipt_reference = ? WHERE id = ? AND user_id = ? AND status = 'PENDING'`,
      [receiptReference.trim(), Number(req.params.id), req.customer!.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Pending deposit not found.' });
      return;
    }
    res.json({
      message: 'Receipt reference attached. Balance will only be credited upon independent provider or finance verification.',
    });
  } catch (err) {
    next(err);
  }
});
