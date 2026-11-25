import crypto from 'crypto';
import { Router } from 'express';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { beneficiarySchema } from '../validators/schemas.js';

export const beneficiariesRouter = Router();
beneficiariesRouter.use(requireCustomerAuth);

beneficiariesRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, beneficiary_name, account_number, bank_name, bank_country, currency, bic_swift, routing_code, beneficiary_type, created_at
       FROM account_beneficiaries WHERE user_id = ? ORDER BY created_at DESC`,
      [req.customer!.id]
    );
    res.json({ beneficiaries: rows });
  } catch (err) {
    next(err);
  }
});

beneficiariesRouter.post('/', async (req, res, next) => {
  try {
    const data = beneficiarySchema.parse(req.body);
    const pool = getPool();
    const uuid = crypto.randomUUID();
    const [result]: any = await pool.query(
      `INSERT INTO account_beneficiaries
        (uuid, user_id, beneficiary_name, account_number, bank_name, bank_country, currency, bic_swift, routing_code, beneficiary_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid,
        req.customer!.id,
        data.beneficiaryName,
        data.accountNumber,
        data.bankName,
        data.bankCountry.toUpperCase(),
        data.currency.toUpperCase(),
        data.bicSwift || null,
        data.routingCode || null,
        data.beneficiaryType,
      ]
    );
    res.status(201).json({
      beneficiary: {
        id: Number(result.insertId),
        uuid,
        ...data,
      },
    });
  } catch (err) {
    next(err);
  }
});

beneficiariesRouter.delete('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const [result]: any = await pool.query(
      `DELETE FROM account_beneficiaries WHERE id = ? AND user_id = ?`,
      [Number(req.params.id), req.customer!.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Beneficiary not found.' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
