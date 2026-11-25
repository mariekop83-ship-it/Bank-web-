import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { brandConfig } from '../config/brand.js';
import { getPool, isDatabaseConfigured } from '../config/database.js';
import { getAllProviderStatuses, providers } from '../services/providers/registry.js';
import { isPathMatchingAdminPortal } from '../services/adminPathService.js';
import { generateReference } from '../utils/crypto.js';

export const publicRouter = Router();

publicRouter.get('/config', async (_req, res, next) => {
  try {
    let currencies: any[] = brandConfig.supportedCurrencies.map((c) => ({
      ...c,
      isSupported: true,
      partnerAvailable: false,
      partnerName: null,
    }));
    let publicSettings: Record<string, string> = {};

    if (isDatabaseConfigured()) {
      try {
        const pool = getPool();
        const [currRows]: any = await pool.query(
          `SELECT code, name, symbol, minor_units, is_supported, partner_available, partner_name
           FROM currencies ORDER BY sort_order ASC`
        );
        if (currRows.length > 0) {
          currencies = currRows.map((c: any) => ({
            code: c.code,
            name: c.name,
            symbol: c.symbol,
            minorUnits: Number(c.minor_units),
            isSupported: Boolean(c.is_supported),
            partnerAvailable: Boolean(c.partner_available),
            partnerName: c.partner_name,
          }));
        }
        const [setRows]: any = await pool.query(
          `SELECT setting_key, setting_value FROM system_settings WHERE is_public = 1`
        );
        for (const r of setRows) {
          publicSettings[r.setting_key] = r.setting_value;
        }
      } catch {
        // Return static configurable defaults if migrations haven't run yet
      }
    }

    res.json({
      databaseConfigured: isDatabaseConfigured(),
      brand: brandConfig,
      currencies,
      providers: getAllProviderStatuses(),
      publicSettings,
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/resolve-route', async (req, res, next) => {
  try {
    const candidatePath = String(req.query.path || '/');
    const isAdminRoute = await isPathMatchingAdminPortal(candidatePath);
    res.json({ isAdminRoute });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/fx-rate', async (req, res, next) => {
  try {
    const base = String(req.query.base || 'USD').toUpperCase();
    const quote = String(req.query.quote || 'EUR').toUpperCase();
    const status = providers.fxRates.getStatus();
    const quoteData = await providers.fxRates.getRate(base, quote);

    res.json({
      providerStatus: status,
      quote: quoteData,
    });
  } catch (err) {
    next(err);
  }
});

const contactSchema = z.object({
  email: z.string().email().max(255),
  subject: z.string().min(3).max(200),
  category: z.enum(['GENERAL', 'TRANSFERS', 'KYC', 'CARDS', 'SECURITY', 'BILLING']).optional(),
  message: z.string().min(10).max(4000),
});

publicRouter.post('/contact', async (req, res, next) => {
  try {
    const data = contactSchema.parse(req.body);
    const pool = getPool();
    const reference = generateReference('TKT');
    await pool.query(
      `INSERT INTO support_tickets (uuid, reference, contact_email, subject, category, message, status)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`,
      [crypto.randomUUID(), reference, data.email, data.subject, data.category || 'GENERAL', data.message]
    );
    res.status(201).json({
      message: 'Your inquiry has been logged with our client support desk.',
      reference,
    });
  } catch (err) {
    next(err);
  }
});
