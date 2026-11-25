import mysql from 'mysql2/promise';
import { env } from './env.js';

export type DbPool = mysql.Pool;
export type DbConnection = mysql.PoolConnection;

let pool: mysql.Pool | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(env.mysql.host && env.mysql.user && env.mysql.database);
}

export function getPool(): mysql.Pool {
  if (pool) {
    return pool;
  }

  if (!isDatabaseConfigured()) {
    const err = new Error(
      'External MySQL database is not configured. Set MYSQL_URL (or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE).'
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 503;
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
    const sslConfig = env.mysql.ssl
      ? {
          rejectUnauthorized: env.mysql.sslRejectUnauthorized,
          ...(env.mysql.sslCa ? { ca: env.mysql.sslCa.replace(/\\n/g, '\n') } : {}),
        }
      : undefined;

    pool = mysql.createPool({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      database: env.mysql.database,
      waitForConnections: true,
      connectionLimit: env.mysql.connectionLimit,
      queueLimit: 0,
      timezone: 'Z',
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      ...(sslConfig ? { ssl: sslConfig } : {}),
    });

  return pool;
}

export function setCustomPoolForTesting(customPool: mysql.Pool | null): void {
  pool = customPool;
}

export async function withTransaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const activePool = getPool();
  const conn = await activePool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback errors if connection already closed
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function checkDatabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  error?: string;
}> {
  if (!isDatabaseConfigured() && !pool) {
    return { configured: false, connected: false };
  }
  try {
    const activePool = getPool();
    await activePool.query('SELECT 1 AS ok');
    return { configured: true, connected: true };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : 'Database connection error',
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
