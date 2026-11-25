import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const runtimeSessionSecret = crypto.randomBytes(32).toString('hex');
const runtimeJwtSecret = crypto.randomBytes(32).toString('hex');
const runtimeEncryptionKey = crypto.randomBytes(32).toString('hex');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000',
  trustProxy: process.env.TRUST_PROXY !== 'false',

  brand: {
    name: process.env.BRAND_NAME || 'Meridian International Bank',
    shortName: process.env.BRAND_SHORT_NAME || 'Meridian Bank',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'support@meridianbank.example',
    domain: process.env.BRAND_DOMAIN || 'meridianbank.example',
  },

  mysql: {
    host: process.env.MYSQL_HOST || '',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || '',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || '',
    ssl: process.env.MYSQL_SSL === 'true',
    sslRejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false',
    sslCa: process.env.MYSQL_SSL_CA || '',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  },

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
