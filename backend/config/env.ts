import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const runtimeSessionSecret = crypto.randomBytes(32).toString('hex');
const runtimeJwtSecret = crypto.randomBytes(32).toString('hex');
const runtimeEncryptionKey = crypto.randomBytes(32).toString('hex');

function resolveMysqlConfig() {
  const rawUrl = (process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
  let host = process.env.MYSQL_HOST || '';
  let port = Number(process.env.MYSQL_PORT || 3306);
  let user = process.env.MYSQL_USER || '';
  let password = process.env.MYSQL_PASSWORD || '';
  let database = process.env.MYSQL_DATABASE || '';
  let urlRequestsSsl = false;

  if (rawUrl && rawUrl.startsWith('mysql')) {
    try {
      const parsed = new URL(rawUrl);
      host = host || parsed.hostname;
      port = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : Number(parsed.port || 3306);
      user = user || decodeURIComponent(parsed.username || '');
      password = password || decodeURIComponent(parsed.password || '');
      database = database || decodeURIComponent(parsed.pathname.replace(/^\//, '') || '');
      const sslMode = (parsed.searchParams.get('ssl-mode') || parsed.searchParams.get('sslmode') || '').toUpperCase();
      const sslParam = (parsed.searchParams.get('ssl') || '').toLowerCase();
      urlRequestsSsl =
        sslParam === 'true' ||
        sslParam === '1' ||
        sslMode === 'REQUIRED' ||
        sslMode === 'VERIFY_CA' ||
        sslMode === 'VERIFY_IDENTITY';
    } catch {
      // Ignore malformed URL; fallback to individual MYSQL_* env vars
    }
  }

  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1';
  const ssl =
    process.env.MYSQL_SSL === 'true'
      ? true
      : process.env.MYSQL_SSL === 'false'
        ? false
        : Boolean(rawUrl && (urlRequestsSsl || !isLocalHost));

  const sslCa = process.env.MYSQL_SSL_CA || '';
  const sslRejectUnauthorized =
    process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true'
      ? true
      : process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'false'
        ? false
        : Boolean(sslCa);

  return {
    host,
    port,
    user,
    password,
    database,
    ssl,
    sslRejectUnauthorized,
    sslCa,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  };
}

const RESERVED_PUBLIC_PATHS = new Set([
  '/',
  '/personal',
  '/business',
  '/multi-currency',
  '/international-transfers',
  '/cards',
  '/security',
  '/about',
  '/help-center',
  '/faq',
  '/contact',
  '/privacy-policy',
  '/terms',
  '/cookie-policy',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/dashboard',
  '/api',
  '/health',
]);

export function normalizeAdminPath(raw?: string): { path: string; valid: boolean; reason?: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { path: '/admin', valid: true };
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      return { path: '/admin', valid: false, reason: 'Invalid URL format for admin portal path.' };
    }
  }

  candidate = candidate.split('?')[0].split('#')[0].replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!candidate.startsWith('/')) {
    candidate = `/${candidate}`;
  }
  if (candidate.length < 2 || !/^\/[a-zA-Z0-9/_-]+$/.test(candidate)) {
    return {
      path: '/admin',
      valid: false,
      reason: 'Admin portal path may only contain letters, numbers, hyphens, underscores, and slashes.',
    };
  }

  const lower = candidate.toLowerCase();
  if (
    RESERVED_PUBLIC_PATHS.has(lower) ||
    lower.startsWith('/api/') ||
    lower.startsWith('/dashboard/') ||
    lower.startsWith('/assets/')
  ) {
    return {
      path: '/admin',
      valid: false,
      reason: `Path "${candidate}" conflicts with an existing public or customer route.`,
    };
  }

  return { path: lower, valid: true };
}

const rawEnvAdminPath = (process.env.ADMIN_PATH || process.env.ADMIN_PORTAL_PATH || process.env.ADMIN_URL || '').trim();
const parsedEnvAdminPath = normalizeAdminPath(rawEnvAdminPath);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000',
  trustProxy: process.env.TRUST_PROXY !== 'false',
  adminPath: parsedEnvAdminPath.valid ? parsedEnvAdminPath.path : '/admin',
  adminPathLockedByEnv: Boolean(rawEnvAdminPath && parsedEnvAdminPath.valid),

  brand: {
    name: process.env.BRAND_NAME || 'Meridian International Bank',
    shortName: process.env.BRAND_SHORT_NAME || 'Meridian Bank',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'support@meridianbank.example',
    domain: process.env.BRAND_DOMAIN || 'meridianbank.example',
  },

  mysql: resolveMysqlConfig(),

  security: {
    sessionSecret: process.env.SESSION_SECRET || runtimeSessionSecret,
    jwtSecret: process.env.JWT_SECRET || runtimeJwtSecret,
    encryptionKey: process.env.ENCRYPTION_KEY || runtimeEncryptionKey,
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    adminInitialEmail: process.env.ADMIN_INITIAL_EMAIL || '',
    adminSetupToken: process.env.ADMIN_SETUP_TOKEN || '',
  },

  email: {
    host: process.env.EMAIL_HOST || '',
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'Meridian International Bank <no-reply@meridianbank.example>',
  },

  providers: {
    bankingPartner: process.env.BANKING_PARTNER_PROVIDER || 'none',
    bankingPartnerKey: process.env.BANKING_PARTNER_API_KEY || '',
    bankingPartnerWebhookSecret: process.env.BANKING_PARTNER_WEBHOOK_SECRET || '',
    paymentProvider: process.env.PAYMENT_PROVIDER || 'none',
    paymentApiKey: process.env.PAYMENT_API_KEY || '',
    paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    fxProvider: process.env.FX_PROVIDER || 'none',
    fxApiKey: process.env.FX_API_KEY || '',
    cardIssuer: process.env.CARD_ISSUER_PROVIDER || 'none',
    cardIssuerKey: process.env.CARD_ISSUER_API_KEY || '',
    cardIssuerWebhookSecret: process.env.CARD_ISSUER_WEBHOOK_SECRET || '',
    kycProvider: process.env.KYC_PROVIDER || 'internal_review',
    kycApiKey: process.env.KYC_PROVIDER_API_KEY || '',
    smsProvider: process.env.SMS_PROVIDER || 'none',
    smsApiKey: process.env.SMS_API_KEY || '',
    smsFrom: process.env.SMS_FROM || '',
  },

  privateStorageDir: process.env.PRIVATE_STORAGE_DIR || '',
};
