import { env } from './env.js';

export const brandConfig = {
  brandName: env.brand.name,
  shortName: env.brand.shortName,
  supportEmail: env.brand.supportEmail,
  domain: env.brand.domain,
  legalDisclosures: {
    regulatoryNotice:
      'Meridian International Bank is a financial technology platform architecture. Account issuance, payment clearing, card issuance, and custody services operate exclusively through authorized, licensed banking and payment partners when configured.',
    depositNotice:
      'Balances displayed inside this platform reflect internal double-entry ledger records. Deposit insurance or statutory protection applies only where explicitly provided by a configured, regulated partner institution.',
    fxNotice:
      'Currency conversions execute strictly against authorized external exchange-rate feeds configured in environment variables.',
  },
  supportedCurrencies: [
    { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
    { code: 'GBP', name: 'British Pound', symbol: '£', minorUnits: 2 },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', minorUnits: 2 },
    { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', minorUnits: 2 },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', minorUnits: 2 },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2 },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0 },
  ],
};
