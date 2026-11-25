import fs from 'fs';
import path from 'path';
import { getPool, closePool } from '../backend/config/database.js';

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  const migrationsDir = path.resolve(process.cwd(), 'database', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  // Ensure schema_migrations table exists first
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(100) NOT NULL UNIQUE,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await pool.query<Array<{ version: string } & Record<string, unknown>> & any>(
    'SELECT version FROM schema_migrations'
  );
  const applied = new Set((rows as Array<{ version: string }>).map((r) => r.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sqlContent
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
      .filter((s) => s.length > 0);

    const conn = await pool.getConnection();
    try {
      for (const stmt of statements) {
        // Strip leading single-line comments
        const cleaned = stmt
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
        if (cleaned) {
          await conn.query(cleaned);
        }
      }
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
      newlyApplied.push(file);
    } finally {
      conn.release();
    }
  }

  return newlyApplied;
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(async (applied) => {
      console.log(
        applied.length > 0
          ? `Applied migrations: ${applied.join(', ')}`
          : 'All migrations already applied.'
      );
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      await closePool();
      process.exit(1);
    });
}
