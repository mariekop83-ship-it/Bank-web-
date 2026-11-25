import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  email: z.string().email().max(255),
  phone: z.string().min(6).max(40),
  country: z.string().length(2),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  addressLine1: z.string().min(3).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().max(40).optional(),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[0-9]/, 'Password must include a number'),
  confirmPassword: z.string(),
  termsAccepted: z.literal(true),
  accountTier: z.enum(['PERSONAL', 'BUSINESS']).optional(),
  preferredCurrency: z.enum(['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD', 'CHF', 'JPY']).optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  deviceFingerprint: z.string().max(128).optional(),
  deviceName: z.string().max(200).optional(),
});

export const transferSchema = z.object({
  sourceCurrencyAccountId: z.number().int().positive(),
  transferType: z.enum(['INTERNAL', 'DOMESTIC', 'INTERNATIONAL', 'BENEFICIARY']),
  recipientName: z.string().min(2).max(160),
  recipientAccountNumber: z.string().min(4).max(64),
  recipientBank: z.string().min(2).max(160),
  recipientCountry: z.string().length(2),
  recipientCurrency: z.string().length(3),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a positive decimal with up to 4 decimal places'),
  description: z.string().min(1).max(255),
  idempotencyKey: z.string().min(8).max(128),
  transactionPin: z.string().regex(/^\d{4,6}$/).optional(),
});

export const fxConvertSchema = z.object({
  sourceWalletId: z.number().int().positive(),
  targetWalletId: z.number().int().positive(),
  sourceAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  idempotencyKey: z.string().min(8).max(128),
});

export const depositSchema = z.object({
  currencyAccountId: z.number().int().positive(),
  method: z.enum(['BANK_TRANSFER', 'CARD_PAYMENT', 'PAYMENT_GATEWAY', 'PARTNER_ACCOUNT']),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  idempotencyKey: z.string().min(8).max(128),
});

export const withdrawalSchema = z.object({
  currencyAccountId: z.number().int().positive(),
  method: z.enum(['INTERNAL_ACCOUNT', 'EXTERNAL_BANK', 'PAYOUT_PROVIDER']),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  destinationDetails: z.object({
    accountName: z.string().min(2).max(160),
    accountNumber: z.string().min(4).max(64),
    bankName: z.string().min(2).max(160),
    country: z.string().length(2),
    swiftBic: z.string().max(16).optional(),
  }),
  idempotencyKey: z.string().min(8).max(128),
});

export const beneficiarySchema = z.object({
  beneficiaryName: z.string().min(2).max(160),
  accountNumber: z.string().min(4).max(64),
  bankName: z.string().min(2).max(160),
  bankCountry: z.string().length(2),
  currency: z.string().length(3),
  bicSwift: z.string().max(16).optional(),
  routingCode: z.string().max(32).optional(),
  beneficiaryType: z.enum(['INTERNAL', 'DOMESTIC', 'INTERNATIONAL']),
});
