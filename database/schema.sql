-- Meridian International Banking Platform
-- Complete MySQL 8.0+ Relational Database Schema
-- All timestamps are UTC. Monetary columns use exact DECIMAL(19, 4).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(100) NOT NULL UNIQUE,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1. Core Customer Identity & Security
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(40) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  transaction_pin_hash VARCHAR(255) NULL,
  status ENUM('ACTIVE', 'SUSPENDED', 'RESTRICTED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  kyc_status ENUM('NOT_STARTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED') NOT NULL DEFAULT 'NOT_STARTED',
  email_verified_at DATETIME(3) NULL,
  phone_verified_at DATETIME(3) NULL,
  two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
  two_factor_secret_enc TEXT NULL,
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_users_status (status),
  INDEX idx_users_kyc_status (kyc_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  date_of_birth DATE NOT NULL,
  nationality CHAR(2) NULL,
  occupation VARCHAR(150) NULL,
  preferred_currency CHAR(3) NOT NULL DEFAULT 'USD',
  account_tier ENUM('PERSONAL', 'BUSINESS', 'PRIVATE') NOT NULL DEFAULT 'PERSONAL',
  terms_accepted_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_addresses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  address_line_1 VARCHAR(255) NOT NULL,
  address_line_2 VARCHAR(255) NULL,
  city VARCHAR(120) NOT NULL,
  state_region VARCHAR(120) NULL,
  postal_code VARCHAR(40) NULL,
  country CHAR(2) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_addresses_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_devices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  device_fingerprint VARCHAR(128) NOT NULL,
  device_name VARCHAR(200) NOT NULL,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(64) NULL,
  is_trusted TINYINT(1) NOT NULL DEFAULT 0,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_device (user_id, device_fingerprint),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES user_devices(id) ON DELETE SET NULL,
  INDEX idx_sessions_user_active (user_id, revoked_at, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_verifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  verification_type ENUM('EMAIL_VERIFY', 'PHONE_VERIFY', 'PASSWORD_RESET', 'KYC_SUBMISSION') NOT NULL,
  token_hash CHAR(64) NULL,
  code_hash CHAR(64) NULL,
  status ENUM('PENDING', 'VERIFIED', 'EXPIRED', 'REVIEWED') NOT NULL DEFAULT 'PENDING',
  metadata_json JSON NULL,
  expires_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_verifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_verifications_lookup (user_id, verification_type, status),
  INDEX idx_verifications_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Private KYC Documents (Encrypted binary/reference storage, never exposed publicly)
CREATE TABLE IF NOT EXISTS kyc_documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('GOVERNMENT_ID', 'PASSPORT', 'PROOF_OF_ADDRESS', 'ADDITIONAL_DOCUMENT') NOT NULL,
  document_number_enc TEXT NULL,
  issuing_country CHAR(2) NULL,
  expiry_date DATE NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size_bytes INT UNSIGNED NOT NULL,
  storage_provider VARCHAR(64) NOT NULL DEFAULT 'encrypted_db',
  storage_key VARCHAR(255) NOT NULL,
  encrypted_payload MEDIUMBLOB NULL,
  encryption_iv VARCHAR(64) NULL,
  encryption_tag VARCHAR(64) NULL,
  review_status ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED') NOT NULL DEFAULT 'PENDING',
  reviewer_notes TEXT NULL,
  reviewed_by_admin_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  retention_until DATE NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_kyc_user_status (user_id, review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Currencies & Exchange Rates
CREATE TABLE IF NOT EXISTS currencies (
  code CHAR(3) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  minor_units TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_supported TINYINT(1) NOT NULL DEFAULT 1,
  partner_available TINYINT(1) NOT NULL DEFAULT 0,
  partner_name VARCHAR(100) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate DECIMAL(18, 8) NOT NULL,
  source_provider VARCHAR(80) NOT NULL,
  is_live TINYINT(1) NOT NULL DEFAULT 0,
  fetched_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_pair_provider (base_currency, quote_currency, source_provider),
  CONSTRAINT fk_fx_base FOREIGN KEY (base_currency) REFERENCES currencies(code),
  CONSTRAINT fk_fx_quote FOREIGN KEY (quote_currency) REFERENCES currencies(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Bank Accounts, Multi-Currency Wallets & Beneficiaries
CREATE TABLE IF NOT EXISTS bank_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  account_number VARCHAR(34) NOT NULL UNIQUE,
  iban VARCHAR(34) NULL,
  bic_swift VARCHAR(16) NULL,
  routing_number VARCHAR(32) NULL,
  account_type ENUM('PERSONAL_CHECKING', 'BUSINESS_TREASURY') NOT NULL DEFAULT 'PERSONAL_CHECKING',
  status ENUM('ACTIVE', 'FROZEN', 'RESTRICTED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  partner_provider VARCHAR(80) NOT NULL DEFAULT 'internal_ledger',
  partner_account_id VARCHAR(128) NULL,
  daily_transfer_limit DECIMAL(19, 4) NOT NULL DEFAULT 25000.0000,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_bank_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_bank_accounts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  account_class ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
  currency CHAR(3) NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  allow_negative TINYINT(1) NOT NULL DEFAULT 0,
  balance DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ledger_acc_currency FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT fk_ledger_acc_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_ledger_acc_class_curr (account_class, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS currency_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  bank_account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  available_ledger_account_id BIGINT UNSIGNED NOT NULL,
  pending_ledger_account_id BIGINT UNSIGNED NOT NULL,
  available_balance DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  pending_balance DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  ledger_balance DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  status ENUM('ACTIVE', 'FROZEN', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  partner_wallet_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_currency_wallet (bank_account_id, currency),
  CONSTRAINT fk_curr_acc_bank FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_curr_acc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_curr_acc_currency FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT fk_curr_acc_avail_ledger FOREIGN KEY (available_ledger_account_id) REFERENCES ledger_accounts(id),
  CONSTRAINT fk_curr_acc_pend_ledger FOREIGN KEY (pending_ledger_account_id) REFERENCES ledger_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_beneficiaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  beneficiary_name VARCHAR(160) NOT NULL,
  account_number VARCHAR(64) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  bank_country CHAR(2) NOT NULL,
  currency CHAR(3) NOT NULL,
  bic_swift VARCHAR(16) NULL,
  routing_code VARCHAR(32) NULL,
  beneficiary_type ENUM('INTERNAL', 'DOMESTIC', 'INTERNATIONAL') NOT NULL DEFAULT 'INTERNAL',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_beneficiary_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_beneficiary_currency FOREIGN KEY (currency) REFERENCES currencies(code),
  INDEX idx_beneficiary_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Double-Entry Immutable Financial Ledger
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(64) NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  transaction_type ENUM('INTERNAL_TRANSFER', 'DOMESTIC_TRANSFER', 'INTERNATIONAL_TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'FX_CONVERSION', 'FEE', 'REVERSAL', 'CARD_SETTLEMENT') NOT NULL,
  status ENUM('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REVERSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  currency CHAR(3) NOT NULL,
  total_amount DECIMAL(19, 4) NOT NULL,
  fee_amount DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  description VARCHAR(255) NOT NULL,
  initiated_by_user_id BIGINT UNSIGNED NULL,
  reversed_transaction_id BIGINT UNSIGNED NULL,
  metadata_json JSON NULL,
  posted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ltx_currency FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT fk_ltx_user FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ltx_reversed FOREIGN KEY (reversed_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  INDEX idx_ltx_type_status (transaction_type, status),
  INDEX idx_ltx_user_posted (initiated_by_user_id, posted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_transaction_id BIGINT UNSIGNED NOT NULL,
  ledger_account_id BIGINT UNSIGNED NOT NULL,
  entry_type ENUM('DEBIT', 'CREDIT') NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  currency CHAR(3) NOT NULL,
  balance_after DECIMAL(19, 4) NOT NULL,
  memo VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_le_tx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_le_acc FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_le_curr FOREIGN KEY (currency) REFERENCES currencies(code),
  INDEX idx_le_tx (ledger_transaction_id),
  INDEX idx_le_acc_created (ledger_account_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Transfers, FX Conversions, Deposits & Withdrawals
CREATE TABLE IF NOT EXISTS transaction_fees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fee_code VARCHAR(64) NOT NULL UNIQUE,
  transaction_type ENUM('INTERNAL_TRANSFER', 'DOMESTIC_TRANSFER', 'INTERNATIONAL_TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'FX_CONVERSION') NOT NULL,
  currency CHAR(3) NOT NULL,
  flat_fee DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  percent_fee DECIMAL(7, 4) NOT NULL DEFAULT 0.0000,
  min_fee DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  max_fee DECIMAL(19, 4) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_fees_currency FOREIGN KEY (currency) REFERENCES currencies(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transfers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(64) NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  sender_currency_account_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  recipient_currency_account_id BIGINT UNSIGNED NULL,
  transfer_type ENUM('INTERNAL', 'DOMESTIC', 'INTERNATIONAL', 'BENEFICIARY') NOT NULL,
  recipient_name VARCHAR(160) NOT NULL,
  recipient_account_number VARCHAR(64) NOT NULL,
  recipient_bank VARCHAR(160) NOT NULL,
  recipient_country CHAR(2) NOT NULL,
  recipient_currency CHAR(3) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  fee_amount DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  currency CHAR(3) NOT NULL,
  description VARCHAR(255) NOT NULL,
  status ENUM('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REVERSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  ledger_transaction_id BIGINT UNSIGNED NULL,
  partner_provider VARCHAR(80) NULL,
  partner_reference VARCHAR(128) NULL,
  failure_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tr_sender_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_sender_wallet FOREIGN KEY (sender_currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_recip_user FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_recip_wallet FOREIGN KEY (recipient_currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tr_ltx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  INDEX idx_tr_sender_created (sender_user_id, created_at),
  INDEX idx_tr_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fx_conversions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(64) NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  source_currency_account_id BIGINT UNSIGNED NOT NULL,
  target_currency_account_id BIGINT UNSIGNED NOT NULL,
  source_currency CHAR(3) NOT NULL,
  target_currency CHAR(3) NOT NULL,
  source_amount DECIMAL(19, 4) NOT NULL,
  target_amount DECIMAL(19, 4) NOT NULL,
  fee_amount DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  exchange_rate DECIMAL(18, 8) NOT NULL,
  rate_source VARCHAR(80) NOT NULL,
  ledger_transaction_id BIGINT UNSIGNED NOT NULL,
  status ENUM('SUCCESSFUL', 'REVERSED', 'FAILED') NOT NULL DEFAULT 'SUCCESSFUL',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_fxc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fxc_src FOREIGN KEY (source_currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fxc_dst FOREIGN KEY (target_currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fxc_ltx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deposits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(64) NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  currency_account_id BIGINT UNSIGNED NOT NULL,
  method ENUM('BANK_TRANSFER', 'CARD_PAYMENT', 'PAYMENT_GATEWAY', 'PARTNER_ACCOUNT') NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  fee_amount DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  currency CHAR(3) NOT NULL,
  status ENUM('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  provider_name VARCHAR(80) NOT NULL DEFAULT 'none',
  provider_reference VARCHAR(128) NULL,
  receipt_reference VARCHAR(255) NULL,
  ledger_transaction_id BIGINT UNSIGNED NULL,
  verified_by_admin_id BIGINT UNSIGNED NULL,
  verified_at DATETIME(3) NULL,
  rejection_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_dep_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dep_wallet FOREIGN KEY (currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dep_ltx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  INDEX idx_dep_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(64) NOT NULL UNIQUE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  currency_account_id BIGINT UNSIGNED NOT NULL,
  method ENUM('INTERNAL_ACCOUNT', 'EXTERNAL_BANK', 'PAYOUT_PROVIDER') NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  fee_amount DECIMAL(19, 4) NOT NULL DEFAULT 0.0000,
  currency CHAR(3) NOT NULL,
  destination_details_json JSON NOT NULL,
  status ENUM('PENDING', 'APPROVED', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  provider_name VARCHAR(80) NOT NULL DEFAULT 'none',
  provider_reference VARCHAR(128) NULL,
  hold_ledger_transaction_id BIGINT UNSIGNED NULL,
  settlement_ledger_transaction_id BIGINT UNSIGNED NULL,
  reviewed_by_admin_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  rejection_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_wd_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_wd_wallet FOREIGN KEY (currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_wd_hold_ltx FOREIGN KEY (hold_ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_wd_settle_ltx FOREIGN KEY (settlement_ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  INDEX idx_wd_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Tokenized Cards (Never stores raw PAN, CVV, or PIN)
CREATE TABLE IF NOT EXISTS cards (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  currency_account_id BIGINT UNSIGNED NOT NULL,
  card_type ENUM('VIRTUAL', 'PHYSICAL') NOT NULL DEFAULT 'VIRTUAL',
  card_brand VARCHAR(32) NOT NULL DEFAULT 'VISA',
  cardholder_name VARCHAR(160) NOT NULL,
  last4 CHAR(4) NOT NULL,
  expiry_month TINYINT UNSIGNED NOT NULL,
  expiry_year SMALLINT UNSIGNED NOT NULL,
  provider_name VARCHAR(80) NOT NULL DEFAULT 'none',
  provider_card_token VARCHAR(128) NOT NULL UNIQUE,
  status ENUM('PENDING_ISSUANCE', 'ACTIVE', 'FROZEN', 'REPLACEMENT_REQUESTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_ISSUANCE',
  daily_limit DECIMAL(19, 4) NOT NULL DEFAULT 2500.0000,
  monthly_limit DECIMAL(19, 4) NOT NULL DEFAULT 15000.0000,
  online_payments_enabled TINYINT(1) NOT NULL DEFAULT 1,
  international_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cards_wallet FOREIGN KEY (currency_account_id) REFERENCES currency_accounts(id) ON DELETE RESTRICT,
  INDEX idx_cards_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  card_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  merchant_name VARCHAR(160) NOT NULL,
  merchant_category VARCHAR(80) NOT NULL,
  merchant_country CHAR(2) NOT NULL,
  amount DECIMAL(19, 4) NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('PENDING', 'SETTLED', 'DECLINED', 'REVERSED') NOT NULL,
  provider_event_id VARCHAR(128) NULL UNIQUE,
  ledger_transaction_id BIGINT UNSIGNED NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_card_tx_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE RESTRICT,
  CONSTRAINT fk_card_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_card_tx_ltx FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  INDEX idx_card_tx_card (card_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Notifications & Support
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  category ENUM('LOGIN', 'NEW_DEVICE', 'PASSWORD_CHANGE', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'KYC', 'SECURITY_ALERT', 'ACCOUNT_RESTRICTION') NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  channel_in_app TINYINT(1) NOT NULL DEFAULT 1,
  channel_email TINYINT(1) NOT NULL DEFAULT 0,
  channel_sms TINYINT(1) NOT NULL DEFAULT 0,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  reference VARCHAR(40) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  contact_email VARCHAR(255) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  category ENUM('GENERAL', 'TRANSFERS', 'KYC', 'CARDS', 'SECURITY', 'BILLING') NOT NULL DEFAULT 'GENERAL',
  message TEXT NOT NULL,
  status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  assigned_admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Separate Administrator RBAC & Audit Logs
CREATE TABLE IF NOT EXISTS admin_roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(96) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_arp_role FOREIGN KEY (role_id) REFERENCES admin_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_arp_perm FOREIGN KEY (permission_id) REFERENCES admin_permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  mfa_secret_enc TEXT NULL,
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_admin_role FOREIGN KEY (role_id) REFERENCES admin_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  mfa_verified TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_admin_sess_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  admin_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  reason TEXT NULL,
  details_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_audit_action_created (action, created_at),
  INDEX idx_audit_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Security Events, Webhooks & System Settings
CREATE TABLE IF NOT EXISTS security_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  actor_type ENUM('CUSTOMER', 'ADMIN', 'SYSTEM', 'WEBHOOK') NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(100) NOT NULL,
  severity ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sec_events_type_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_name VARCHAR(80) NOT NULL,
  provider_event_id VARCHAR(160) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  signature_valid TINYINT(1) NOT NULL,
  payload_json JSON NOT NULL,
  processing_status ENUM('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
  error_message VARCHAR(255) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  UNIQUE KEY uq_provider_event (provider_name, provider_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(255) NULL,
  updated_by_admin_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
