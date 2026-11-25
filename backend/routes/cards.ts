import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { providers } from '../services/providers/registry.js';

export const cardsRouter = Router();
cardsRouter.use(requireCustomerAuth);

cardsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [cards]: any = await pool.query(
      `SELECT c.id, c.uuid, c.currency_account_id, c.card_type, c.card_brand, c.cardholder_name,
              c.last4, c.expiry_month, c.expiry_year, c.provider_name, c.status,
              c.daily_limit, c.monthly_limit, c.online_payments_enabled, c.international_enabled, c.created_at,
              ca.currency
       FROM cards c
       JOIN currency_accounts ca ON ca.id = c.currency_account_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`,
      [req.customer!.id]
    );

    res.json({
      issuerStatus: providers.cardIssuer.getStatus(),
      cards,
    });
  } catch (err) {
    next(err);
  }
});

cardsRouter.post('/request', async (req, res, next) => {
  try {
    const data = z
      .object({
        currencyAccountId: z.number().int().positive(),
        cardType: z.enum(['VIRTUAL', 'PHYSICAL']),
      })
      .parse(req.body);

    const pool = getPool();
    const [wallets]: any = await pool.query(
      `SELECT ca.id, ca.currency, p.first_name, p.last_name, u.kyc_status
       FROM currency_accounts ca
       JOIN users u ON u.id = ca.user_id
       JOIN user_profiles p ON p.user_id = u.id
       WHERE ca.id = ? AND ca.user_id = ? LIMIT 1`,
      [data.currencyAccountId, req.customer!.id]
    );
    if (wallets.length === 0) {
      res.status(404).json({ error: 'Currency wallet not found.' });
      return;
    }
    const wallet = wallets[0];
    const cardholderName = `${wallet.first_name} ${wallet.last_name}`.toUpperCase();

    const issuance = await providers.cardIssuer.issueCard({
      userId: req.customer!.id,
      cardholderName,
      cardType: data.cardType,
      currency: wallet.currency,
    });

    const cardUuid = crypto.randomUUID();
    const token = issuance.providerCardToken || `pending_${cardUuid}`;

    await pool.query(
      `INSERT INTO cards
        (uuid, user_id, currency_account_id, card_type, card_brand, cardholder_name, last4, expiry_month, expiry_year, provider_name, provider_card_token, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cardUuid,
        req.customer!.id,
        wallet.id,
        data.cardType,
        issuance.cardBrand || 'VISA',
        cardholderName,
        issuance.last4 || '0000',
        issuance.expiryMonth || 12,
        issuance.expiryYear || new Date().getUTCFullYear() + 4,
        issuance.providerName,
        token,
        issuance.status,
      ]
    );

    res.status(201).json({
      cardUuid,
      status: issuance.status,
      message: issuance.message,
    });
  } catch (err) {
    next(err);
  }
});

cardsRouter.post('/:id/freeze', async (req, res, next) => {
  try {
    const pool = getPool();
    const [result]: any = await pool.query(
      `UPDATE cards SET status = 'FROZEN' WHERE id = ? AND user_id = ? AND status = 'ACTIVE'`,
      [Number(req.params.id), req.customer!.id]
    );
    if (result.affectedRows === 0) {
      res.status(400).json({ error: 'Active card not found.' });
      return;
    }
    res.json({ status: 'FROZEN' });
  } catch (err) {
    next(err);
  }
});

cardsRouter.post('/:id/unfreeze', async (req, res, next) => {
  try {
    const pool = getPool();
    const [result]: any = await pool.query(
      `UPDATE cards SET status = 'ACTIVE' WHERE id = ? AND user_id = ? AND status = 'FROZEN'`,
      [Number(req.params.id), req.customer!.id]
    );
    if (result.affectedRows === 0) {
      res.status(400).json({ error: 'Frozen card not found.' });
      return;
    }
    res.json({ status: 'ACTIVE' });
  } catch (err) {
    next(err);
  }
});

cardsRouter.put('/:id/limits', async (req, res, next) => {
  try {
    const data = z
      .object({
        dailyLimit: z.string().regex(/^\d+(\.\d{1,4})?$/),
        monthlyLimit: z.string().regex(/^\d+(\.\d{1,4})?$/),
        onlinePaymentsEnabled: z.boolean().optional(),
        internationalEnabled: z.boolean().optional(),
      })
      .parse(req.body);

    const pool = getPool();
    await pool.query(
      `UPDATE cards
       SET daily_limit = ?, monthly_limit = ?,
           online_payments_enabled = COALESCE(?, online_payments_enabled),
           international_enabled = COALESCE(?, international_enabled)
       WHERE id = ? AND user_id = ?`,
      [
        data.dailyLimit,
        data.monthlyLimit,
        data.onlinePaymentsEnabled !== undefined ? (data.onlinePaymentsEnabled ? 1 : 0) : null,
        data.internationalEnabled !== undefined ? (data.internationalEnabled ? 1 : 0) : null,
        Number(req.params.id),
        req.customer!.id,
      ]
    );
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

cardsRouter.post('/:id/replace', async (req, res, next) => {
  try {
    const pool = getPool();
    const [result]: any = await pool.query(
      `UPDATE cards SET status = 'REPLACEMENT_REQUESTED' WHERE id = ? AND user_id = ? AND status IN ('ACTIVE', 'FROZEN')`,
      [Number(req.params.id), req.customer!.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Eligible card not found.' });
      return;
    }
    res.json({ status: 'REPLACEMENT_REQUESTED' });
  } catch (err) {
    next(err);
  }
});

cardsRouter.get('/:id/transactions', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, merchant_name, merchant_category, merchant_country, amount, currency, status, occurred_at
       FROM card_transactions
       WHERE card_id = ? AND user_id = ?
       ORDER BY occurred_at DESC LIMIT 100`,
      [Number(req.params.id), req.customer!.id]
    );
    res.json({ transactions: rows });
  } catch (err) {
    next(err);
  }
});
