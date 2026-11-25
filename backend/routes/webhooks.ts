import express, { Router } from 'express';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { settleVerifiedDeposit } from '../services/depositWithdrawalService.js';
import { verifyHmacSignature } from '../utils/crypto.js';

export const webhooksRouter = Router();

webhooksRouter.post('/payment/:provider', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const providerName = req.params.provider;
    const signature = String(req.headers['x-webhook-signature'] || req.headers['x-signature'] || '');
    const timestampHeader = String(req.headers['x-webhook-timestamp'] || '');
    const secret = env.providers.paymentWebhookSecret || env.providers.bankingPartnerWebhookSecret;

    if (!secret) {
      res.status(503).json({ error: 'Webhook secret not configured on server.' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const sigValid = verifyHmacSignature(rawBody, signature, secret);
    if (!sigValid) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    // Replay protection (reject webhooks older than 5 minutes if timestamp header supplied)
    if (timestampHeader) {
      const tsMs = Number(timestampHeader) * (timestampHeader.length <= 10 ? 1000 : 1);
      if (Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
        res.status(400).json({ error: 'Webhook timestamp outside replay tolerance window.' });
        return;
      }
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventId = String(payload.eventId || payload.id || '');
    const eventType = String(payload.eventType || payload.type || '');
    if (!eventId || !eventType) {
      res.status(400).json({ error: 'Webhook payload missing eventId or eventType.' });
      return;
    }

    const pool = getPool();

    // Idempotent event logging
    try {
      await pool.query(
        `INSERT INTO payment_provider_events (provider_name, provider_event_id, event_type, signature_valid, payload_json, processing_status)
         VALUES (?, ?, ?, 1, ?, 'RECEIVED')`,
        [providerName, eventId, eventType, JSON.stringify(payload)]
      );
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        res.json({ received: true, idempotentReplay: true });
        return;
      }
      throw err;
    }

    if (eventType === 'deposit.settled' && payload.reference && payload.providerReference) {
      const [depRows]: any = await pool.query(`SELECT id FROM deposits WHERE reference = ? LIMIT 1`, [
        String(payload.reference),
      ]);
      if (depRows.length > 0) {
        await settleVerifiedDeposit({
          depositId: Number(depRows[0].id),
          providerReference: String(payload.providerReference),
          adminUserId: null,
        });
      }
    }

    await pool.query(
      `UPDATE payment_provider_events SET processing_status = 'PROCESSED', processed_at = UTC_TIMESTAMP(3)
       WHERE provider_name = ? AND provider_event_id = ?`,
      [providerName, eventId]
    );

    res.json({ received: true, processed: true });
  } catch (err) {
    next(err);
  }
});
