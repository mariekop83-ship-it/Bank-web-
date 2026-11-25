import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import readline from 'readline';
import { getPool, closePool, withTransaction } from '../backend/config/database.js';
import { env } from '../backend/config/env.js';
import { encryptText } from '../backend/utils/crypto.js';
import { generateBase32Secret, buildOtpAuthUri } from '../backend/utils/totp.js';
import { runMigrations } from './migrate.js';

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function createInitialAdmin() {
  await runMigrations();
  const pool = getPool();

  const email = (process.env.ADMIN_INITIAL_EMAIL || (await promptInput('Super Admin Email: '))).toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('A valid administrator email is required.');
  }

  const fullName = process.env.ADMIN_INITIAL_NAME || (await promptInput('Full Name: ')) || 'Primary Administrator';
  const password = process.env.ADMIN_INITIAL_PASSWORD || (await promptInput('Strong Password (min 12 chars): '));

  if (!password || password.length < 12) {
    throw new Error('Administrator password must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const totpSecret = generateBase32Secret(32);
  const totpEnc = encryptText(totpSecret);

  await withTransaction(async (conn) => {
    const [roles]: any = await conn.query(`SELECT id FROM admin_roles WHERE code = 'SUPER_ADMIN' LIMIT 1`);
    if (roles.length === 0) {
      throw new Error('SUPER_ADMIN role not found. Ensure migrations ran successfully.');
    }

    const [existing]: any = await conn.query(`SELECT id FROM admin_users WHERE email = ?`, [email]);
    if (existing.length > 0) {
      throw new Error(`Administrator with email ${email} already exists.`);
    }

    const [res]: any = await conn.query(
      `INSERT INTO admin_users (uuid, email, full_name, password_hash, role_id, status, mfa_enabled, mfa_secret_enc)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?)`,
      [crypto.randomUUID(), email, fullName, passwordHash, roles[0].id, totpEnc]
    );

    await conn.query(
      `INSERT INTO admin_audit_logs (uuid, admin_user_id, action, target_type, target_id, reason)
       VALUES (?, ?, 'ADMIN_BOOTSTRAP_CLI', 'admin_users', ?, 'Initial Super Administrator provisioned via CLI')`,
      [crypto.randomUUID(), res.insertId, String(res.insertId)]
    );
  });

  const otpUri = buildOtpAuthUri(email, env.brand.shortName + ' Admin', totpSecret);
  console.log('\nSuper Administrator created successfully.');
  console.log(`Email: ${email}`);
  console.log(`Authenticator TOTP Secret: ${totpSecret}`);
  console.log(`Authenticator OTPAuth URI: ${otpUri}`);
  console.log('Store this TOTP secret in your password manager/authenticator app immediately.\n');
}

createInitialAdmin()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Admin creation failed:', err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
