import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPool, closePool, withTransaction } from '../backend/config/database.js';
import { runMigrations } from './migrate.js';
import { generateReference } from '../backend/utils/crypto.js';

/**
 * Optional Development Seed Script.
 * Seeds sample reference data and an optional development test customer ONLY when
 * NODE_ENV !== 'production' and ALLOW_DEV_SEED=true.
 * Never creates a hardcoded production administrator.
 */
async function runDevSeed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed script cannot be executed in production.');
  }

  await runMigrations();
  const pool = getPool();

  // Seed static reference exchange rates marked is_live = 0 (sandbox reference only)
  const sampleRates = [
    ['USD', 'EUR', '0.92150000'],
    ['USD', 'GBP', '0.78800000'],
    ['USD', 'NGN', '1545.00000000'],
    ['USD', 'CAD', '1.38500000'],
    ['USD', 'AUD', '1.52400000'],
    ['USD', 'CHF', '0.88100000'],
    ['USD', 'JPY', '153.20000000'],
    ['EUR', 'USD', '1.08520000'],
    ['GBP', 'USD', '1.26900000'],
  ];

  for (const [base, quote, rate] of sampleRates) {
    await pool.query(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate, source_provider, is_live, fetched_at, expires_at)
       VALUES (?, ?, ?, 'sandbox_reference', 0, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 365 DAY))
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), fetched_at = VALUES(fetched_at)`,
      [base, quote, rate]
    );
  }

  if (process.env.SEED_DEV_CUSTOMER === 'true') {
    const devEmail = process.env.DEV_SEED_EMAIL || 'dev.customer@meridianbank.example';
    const devPassword = process.env.DEV_SEED_PASSWORD || crypto.randomBytes(16).toString('hex');
    const [existing] = await pool.query<any[]>('SELECT id FROM users WHERE email = ?', [devEmail]);

    if (existing.length === 0) {
      await withTransaction(async (conn) => {
        const userUuid = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(devPassword, 12);
        const [userRes]: any = await conn.query(
          `INSERT INTO users (uuid, email, phone, password_hash, status, kyc_status, email_verified_at)
           VALUES (?, ?, '+442079460192', ?, 'ACTIVE', 'APPROVED', UTC_TIMESTAMP(3))`,
          [userUuid, devEmail, passwordHash]
        );
        const userId = userRes.insertId;

        await conn.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, date_of_birth, nationality, preferred_currency, terms_accepted_at)
           VALUES (?, 'Elena', 'Vance', '1990-04-12', 'GB', 'USD', UTC_TIMESTAMP(3))`,
          [userId]
        );

        await conn.query(
          `INSERT INTO user_addresses (user_id, address_line_1, city, postal_code, country, is_primary)
           VALUES (?, '42 Bishopsgate', 'London', 'EC2N 4AH', 'GB', 1)`,
          [userId]
        );

        const acctNum = `MRD${String(10000000 + userId)}`;
        const [bankRes]: any = await conn.query(
          `INSERT INTO bank_accounts (uuid, user_id, account_number, iban, bic_swift, account_type)
           VALUES (?, ?, ?, ?, 'MRDNGB2L', 'PERSONAL_CHECKING')`,
          [crypto.randomUUID(), userId, acctNum, `GB29MRDN006016${acctNum.slice(-8)}`]
        );

        for (const currency of ['USD', 'EUR', 'GBP']) {
          const [availRes]: any = await conn.query(
            `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
             VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
            [`CUST_${userId}_${currency}_AVAIL`, `Customer ${userId} Available ${currency}`, currency, userId]
          );
          const [pendRes]: any = await conn.query(
            `INSERT INTO ledger_accounts (code, name, account_class, currency, owner_user_id, allow_negative, balance)
             VALUES (?, ?, 'LIABILITY', ?, ?, 0, 0.0000)`,
            [`CUST_${userId}_${currency}_PEND`, `Customer ${userId} Pending ${currency}`, currency, userId]
          );
          await conn.query(
            `INSERT INTO currency_accounts (uuid, bank_account_id, user_id, currency, available_ledger_account_id, pending_ledger_account_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), bankRes.insertId, userId, currency, availRes.insertId, pendRes.insertId]
          );
        }

        console.log(`Seeded dev customer: ${devEmail} (ref: ${generateReference('DEV')})`);
      });
    }
  }

  console.log('Development seed completed.');
}

runDevSeed()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
