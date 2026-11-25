-- Migration 002: Default Currencies, System Ledger Accounts, Fees, Admin Roles & Permissions

INSERT IGNORE INTO currencies (code, name, symbol, minor_units, is_supported, partner_available, partner_name, sort_order) VALUES
  ('USD', 'US Dollar', '$', 2, 1, 0, NULL, 1),
  ('EUR', 'Euro', '€', 2, 1, 0, NULL, 2),
  ('GBP', 'British Pound', '£', 2, 1, 0, NULL, 3),
  ('NGN', 'Nigerian Naira', '₦', 2, 1, 0, NULL, 4),
  ('CAD', 'Canadian Dollar', 'CA$', 2, 1, 0, NULL, 5),
  ('AUD', 'Australian Dollar', 'A$', 2, 1, 0, NULL, 6),
  ('CHF', 'Swiss Franc', 'CHF', 2, 1, 0, NULL, 7),
  ('JPY', 'Japanese Yen', '¥', 0, 1, 0, NULL, 8);

-- System Treasury, Clearing & Fee Revenue Ledger Accounts per currency
INSERT IGNORE INTO ledger_accounts (code, name, account_class, currency, allow_negative, balance) VALUES
  ('SYS_CLEARING_USD', 'System Settlement Clearing USD', 'ASSET', 'USD', 1, 0.0000),
  ('SYS_CLEARING_EUR', 'System Settlement Clearing EUR', 'ASSET', 'EUR', 1, 0.0000),
  ('SYS_CLEARING_GBP', 'System Settlement Clearing GBP', 'ASSET', 'GBP', 1, 0.0000),
  ('SYS_CLEARING_NGN', 'System Settlement Clearing NGN', 'ASSET', 'NGN', 1, 0.0000),
  ('SYS_CLEARING_CAD', 'System Settlement Clearing CAD', 'ASSET', 'CAD', 1, 0.0000),
  ('SYS_CLEARING_AUD', 'System Settlement Clearing AUD', 'ASSET', 'AUD', 1, 0.0000),
  ('SYS_CLEARING_CHF', 'System Settlement Clearing CHF', 'ASSET', 'CHF', 1, 0.0000),
  ('SYS_CLEARING_JPY', 'System Settlement Clearing JPY', 'ASSET', 'JPY', 1, 0.0000),
  ('SYS_FEE_REV_USD', 'Fee Revenue USD', 'REVENUE', 'USD', 0, 0.0000),
  ('SYS_FEE_REV_EUR', 'Fee Revenue EUR', 'REVENUE', 'EUR', 0, 0.0000),
  ('SYS_FEE_REV_GBP', 'Fee Revenue GBP', 'REVENUE', 'GBP', 0, 0.0000),
  ('SYS_FEE_REV_NGN', 'Fee Revenue NGN', 'REVENUE', 'NGN', 0, 0.0000),
  ('SYS_FEE_REV_CAD', 'Fee Revenue CAD', 'REVENUE', 'CAD', 0, 0.0000),
  ('SYS_FEE_REV_AUD', 'Fee Revenue AUD', 'REVENUE', 'AUD', 0, 0.0000),
  ('SYS_FEE_REV_CHF', 'Fee Revenue CHF', 'REVENUE', 'CHF', 0, 0.0000),
  ('SYS_FEE_REV_JPY', 'Fee Revenue JPY', 'REVENUE', 'JPY', 0, 0.0000);

-- Default Fee Rules (configurable by Finance/Super Admin)
INSERT IGNORE INTO transaction_fees (fee_code, transaction_type, currency, flat_fee, percent_fee, min_fee, max_fee, is_active) VALUES
  ('INT_TRF_USD', 'INTERNAL_TRANSFER', 'USD', 0.0000, 0.0000, 0.0000, NULL, 1),
  ('DOM_TRF_USD', 'DOMESTIC_TRANSFER', 'USD', 2.5000, 0.0000, 2.5000, 25.0000, 1),
  ('INTL_TRF_USD', 'INTERNATIONAL_TRANSFER', 'USD', 12.0000, 0.0035, 12.0000, 75.0000, 1),
  ('FX_CONV_USD', 'FX_CONVERSION', 'USD', 0.0000, 0.0040, 1.0000, NULL, 1),
  ('WD_USD', 'WITHDRAWAL', 'USD', 5.0000, 0.0000, 5.0000, 50.0000, 1),
  ('DEP_USD', 'DEPOSIT', 'USD', 0.0000, 0.0000, 0.0000, NULL, 1);

-- Admin RBAC Roles
INSERT IGNORE INTO admin_roles (code, name, description) VALUES
  ('SUPER_ADMIN', 'Super Administrator', 'Full platform administration, configuration, and security control'),
  ('FINANCE_ADMIN', 'Finance Administrator', 'Manages deposits, withdrawals, fees, currencies, and controlled reversals'),
  ('COMPLIANCE_OFFICER', 'Compliance Officer', 'Reviews KYC submissions, restricts/suspends accounts, views audit trails'),
  ('SUPPORT_ADMIN', 'Customer Support Administrator', 'Views customer profiles and support tickets without financial mutation rights'),
  ('READ_ONLY_AUDITOR', 'Read-Only Auditor', 'Read-only access to ledger entries, transactions, security events, and audit logs');

-- Admin Permissions
INSERT IGNORE INTO admin_permissions (code, description) VALUES
  ('users.read', 'View customer profiles and statuses'),
  ('users.manage', 'Suspend, reactivate, or restrict customer accounts'),
  ('kyc.read', 'View KYC verification queue and private documents'),
  ('kyc.review', 'Approve, reject, or request additional KYC documents'),
  ('accounts.read', 'View customer bank accounts and currency wallets'),
  ('transactions.read', 'View transactions and double-entry ledger legs'),
  ('transactions.reverse', 'Initiate controlled compensating ledger reversals'),
  ('deposits.read', 'View deposit requests'),
  ('deposits.reconcile', 'Confirm verified provider deposits or reject invalid requests'),
  ('withdrawals.read', 'View withdrawal requests'),
  ('withdrawals.approve', 'Approve or reject customer withdrawal requests'),
  ('system.read', 'View system settings, fees, and currency configuration'),
  ('system.manage', 'Update transaction fees, limits, currencies, and settings'),
  ('audit.read', 'View immutable administrative audit logs and security events'),
  ('admins.manage', 'Create and manage administrator accounts');

-- Role -> Permission Mapping
INSERT IGNORE INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p WHERE r.code = 'SUPER_ADMIN';

INSERT IGNORE INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.code = 'FINANCE_ADMIN'
  AND p.code IN ('users.read', 'accounts.read', 'transactions.read', 'transactions.reverse', 'deposits.read', 'deposits.reconcile', 'withdrawals.read', 'withdrawals.approve', 'system.read', 'system.manage', 'audit.read');

INSERT IGNORE INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.code = 'COMPLIANCE_OFFICER'
  AND p.code IN ('users.read', 'users.manage', 'kyc.read', 'kyc.review', 'accounts.read', 'transactions.read', 'audit.read');

INSERT IGNORE INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.code = 'SUPPORT_ADMIN'
  AND p.code IN ('users.read', 'kyc.read', 'accounts.read', 'transactions.read', 'deposits.read', 'withdrawals.read');

INSERT IGNORE INTO admin_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM admin_roles r, admin_permissions p
WHERE r.code = 'READ_ONLY_AUDITOR'
  AND p.code IN ('users.read', 'kyc.read', 'accounts.read', 'transactions.read', 'deposits.read', 'withdrawals.read', 'system.read', 'audit.read');

-- Public & Platform System Settings
INSERT IGNORE INTO system_settings (setting_key, setting_value, is_public, description) VALUES
  ('public_hero_headline', 'Cross-border accounts and institutional ledger architecture.', 1, 'Homepage primary headline'),
  ('public_notice_banner', 'Partner settlement rails and live FX feeds require active provider credentials in environment configuration.', 1, 'Disclosure banner text'),
  ('default_daily_transfer_limit', '25000.0000', 0, 'Default daily customer transfer limit in USD equivalent'),
  ('kyc_required_for_external_transfers', 'true', 0, 'Require APPROVED KYC before external transfers or withdrawals');
