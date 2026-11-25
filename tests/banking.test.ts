import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import { setCustomPoolForTesting } from '../backend/config/database.js';
import { applyExchangeRate, calculateFeeScaled, formatScaledToDecimal, parseDecimalToScaled } from '../backend/utils/money.js';
import { decryptBuffer, encryptBuffer, sha256Hex, verifyHmacSignature } from '../backend/utils/crypto.js';
import { generateTotpCode, verifyTotpCode } from '../backend/utils/totp.js';
import { postLedgerTransaction, reverseLedgerTransaction, LedgerError } from '../backend/services/ledgerService.js';
import { createDepositRequest, settleVerifiedDeposit, createWithdrawalRequest, approveAndSettleWithdrawal, rejectWithdrawalAndReleaseHold } from '../backend/services/depositWithdrawalService.js';
import { executeTransfer } from '../backend/services/transferService.js';
import { registerCustomer, loginCustomer } from '../backend/services/authService.js';
import { uploadEncryptedKycDocument, getDecryptedKycDocument, reviewCustomerKyc } from '../backend/services/kycService.js';
import { bootstrapFirstAdmin, loginAdmin } from '../backend/services/adminService.js';
import { requireAdminAuth, requirePermission } from '../backend/middleware/auth.js';
import { errorHandler } from '../backend/middleware/errorHandler.js';

/**
 * Lightweight deterministic in-memory MySQL PoolConnection harness
 * executing real service code & SQL state transitions for CI verification
 * without requiring an external MySQL daemon during automated tests.
 */
class MockMySqlDatabase {
  users: any[] = [];
  user_profiles: any[] = [];
  user_addresses: any[] = [];
  user_devices: any[] = [];
  user_sessions: any[] = [];
  user_verifications: any[] = [];
  kyc_documents: any[] = [];
  currencies: any[] = [
    { code: 'USD', name: 'US Dollar', symbol: '$', minor_units: 2, is_supported: 1, partner_available: 0 },
    { code: 'EUR', name: 'Euro', symbol: '€', minor_units: 2, is_supported: 1, partner_available: 0 },
  ];
  bank_accounts: any[] = [];
  ledger_accounts: any[] = [
    { id: 1, code: 'SYS_CLEARING_USD', name: 'Clearing USD', account_class: 'ASSET', currency: 'USD', owner_user_id: null, allow_negative: 1, balance: '0.0000' },
    { id: 2, code: 'SYS_FEE_REV_USD', name: 'Fee Revenue USD', account_class: 'REVENUE', currency: 'USD', owner_user_id: null, allow_negative: 0, balance: '0.0000' },
  ];
  currency_accounts: any[] = [];
  ledger_transactions: any[] = [];
  ledger_entries: any[] = [];
  transaction_fees: any[] = [
    { id: 1, fee_code: 'INT_TRF_USD', transaction_type: 'INTERNAL_TRANSFER', currency: 'USD', flat_fee: '0.0000', percent_fee: '0.0000', min_fee: '0.0000', max_fee: null, is_active: 1 },
  ];
  transfers: any[] = [];
  deposits: any[] = [];
  withdrawals: any[] = [];
  notifications: any[] = [];
  security_events: any[] = [];
  admin_roles: any[] = [
    { id: 1, code: 'SUPER_ADMIN', name: 'Super Administrator' },
    { id: 2, code: 'SUPPORT_ADMIN', name: 'Support Administrator' },
  ];
  admin_permissions: any[] = [
    { id: 1, code: 'users.read' },
    { id: 2, code: 'transactions.reverse' },
  ];
  admin_role_permissions: any[] = [
    { role_id: 1, permission_id: 1 },
    { role_id: 1, permission_id: 2 },
    { role_id: 2, permission_id: 1 },
  ];
  admin_users: any[] = [];
  admin_sessions: any[] = [];
  admin_audit_logs: any[] = [];
  system_settings: any[] = [{ setting_key: 'kyc_required_for_external_transfers', setting_value: 'true' }];

  private seq = 10;
  nextId() {
    this.seq += 1;
    return this.seq;
  }

  async query(sql: string, params: any[] = []): Promise<[any, any]> {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('SELECT 1')) return [[{ ok: 1 }], []];

    // Users
    if (q.startsWith('SELECT id FROM users WHERE email = ?')) {
      return [this.users.filter((u) => u.email === params[0]), []];
    }
    if (q.startsWith('INSERT INTO users')) {
      const id = this.nextId();
      this.users.push({
        id,
        uuid: params[0],
        email: params[1],
        phone: params[2],
        password_hash: params[3],
        transaction_pin_hash: null,
        status: 'ACTIVE',
        kyc_status: 'NOT_STARTED',
        two_factor_enabled: 0,
        two_factor_secret_enc: null,
        failed_login_attempts: 0,
        locked_until: null,
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT u.*, p.first_name, p.last_name FROM users u')) {
      const u = this.users.find((x) => x.email === params[0]);
      if (!u) return [[], []];
      const p = this.user_profiles.find((x) => x.user_id === u.id) || {};
      return [[{ ...u, first_name: p.first_name, last_name: p.last_name }], []];
    }
    if (q.startsWith('SELECT id, email, status, kyc_status, transaction_pin_hash FROM users WHERE id = ?')) {
      return [this.users.filter((u) => u.id === Number(params[0])), []];
    }
    if (q.startsWith('SELECT id, email, status FROM users WHERE id = ?')) {
      return [this.users.filter((u) => u.id === Number(params[0])), []];
    }
    if (q.startsWith('SELECT id, email, status, kyc_status FROM users WHERE id = ?')) {
      return [this.users.filter((u) => u.id === Number(params[0])), []];
    }
    if (q.startsWith('SELECT id, email, kyc_status FROM users WHERE id = ?')) {
      return [this.users.filter((u) => u.id === Number(params[0])), []];
    }
    if (q.startsWith('UPDATE users SET failed_login_attempts = ?, locked_until =')) {
      const u = this.users.find((x) => x.id === Number(params[1]));
      if (u) {
        u.failed_login_attempts = params[0];
        if (q.includes('DATE_ADD')) u.locked_until = new Date(Date.now() + 15 * 60000);
      }
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith('UPDATE users SET failed_login_attempts = 0')) {
      const u = this.users.find((x) => x.id === Number(params[0]));
      if (u) {
        u.failed_login_attempts = 0;
        u.locked_until = null;
      }
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE users SET kyc_status = 'PENDING'")) {
      const u = this.users.find((x) => x.id === Number(params[0]));
      if (u) u.kyc_status = 'PENDING';
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith('UPDATE users SET kyc_status = ? WHERE id = ?')) {
      const u = this.users.find((x) => x.id === Number(params[1]));
      if (u) u.kyc_status = params[0];
      return [{ affectedRows: 1 }, []];
    }

    // Profiles & Addresses
    if (q.startsWith('INSERT INTO user_profiles')) {
      this.user_profiles.push({
        id: this.nextId(),
        user_id: params[0],
        first_name: params[1],
        last_name: params[2],
        date_of_birth: params[3],
        nationality: params[4],
        preferred_currency: params[5],
        account_tier: params[6],
      });
      return [{ insertId: this.seq }, []];
    }
    if (q.startsWith('INSERT INTO user_addresses')) {
      this.user_addresses.push({ id: this.nextId(), user_id: params[0], address_line_1: params[1], city: params[2], country: params[4] });
      return [{ insertId: this.seq }, []];
    }

    // Devices & Sessions
    if (q.startsWith('SELECT id FROM user_devices WHERE user_id = ? AND device_fingerprint = ?')) {
      return [this.user_devices.filter((d) => d.user_id === params[0] && d.device_fingerprint === params[1]), []];
    }
    if (q.startsWith('INSERT INTO user_devices')) {
      const id = this.nextId();
      this.user_devices.push({ id, user_id: params[0], device_fingerprint: params[1], device_name: params[2] });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('UPDATE user_devices')) return [{ affectedRows: 1 }, []];
    if (q.startsWith('INSERT INTO user_sessions')) {
      const id = this.nextId();
      this.user_sessions.push({ id, user_id: params[0], token_hash: params[2] });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('INSERT INTO user_verifications')) {
      const id = this.nextId();
      this.user_verifications.push({ id, user_id: params[0], verification_type: 'EMAIL_VERIFY', token_hash: params[1], status: 'PENDING' });
      return [{ insertId: id }, []];
    }

    // Bank Accounts & Wallets
    if (q.startsWith('INSERT INTO bank_accounts')) {
      const id = this.nextId();
      this.bank_accounts.push({
        id,
        uuid: params[0],
        user_id: params[1],
        account_number: params[2],
        iban: params[3],
        status: 'ACTIVE',
        daily_transfer_limit: '25000.0000',
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('INSERT INTO ledger_accounts')) {
      const id = this.nextId();
      this.ledger_accounts.push({
        id,
        code: params[0],
        name: params[1],
        account_class: 'LIABILITY',
        currency: params[2],
        owner_user_id: params[3],
        allow_negative: 0,
        balance: '0.0000',
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('INSERT INTO currency_accounts')) {
      const id = this.nextId();
      this.currency_accounts.push({
        id,
        uuid: params[0],
        bank_account_id: params[1],
        user_id: params[2],
        currency: params[3],
        available_ledger_account_id: params[4],
        pending_ledger_account_id: params[5],
        available_balance: '0.0000',
        pending_balance: '0.0000',
        ledger_balance: '0.0000',
        status: 'ACTIVE',
      });
      return [{ insertId: id }, []];
    }

    // Ledger Engine SQL
    if (q.startsWith('SELECT id, reference FROM ledger_transactions WHERE idempotency_key = ?')) {
      return [this.ledger_transactions.filter((t) => t.idempotency_key === params[0]), []];
    }
    if (q.startsWith('SELECT id, code, account_class, currency, owner_user_id, allow_negative, balance FROM ledger_accounts WHERE id IN')) {
      const ids = params.map(Number);
      return [this.ledger_accounts.filter((a) => ids.includes(a.id)).sort((a, b) => a.id - b.id), []];
    }
    if (q.startsWith('INSERT INTO ledger_transactions')) {
      const id = this.nextId();
      this.ledger_transactions.push({
        id,
        uuid: params[0],
        reference: params[1],
        idempotency_key: params[2],
        transaction_type: params[3],
        status: params[4],
        currency: params[5],
        total_amount: params[6],
        fee_amount: params[7],
        description: params[8],
        initiated_by_user_id: params[9],
        reversed_transaction_id: params[10],
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('INSERT INTO ledger_entries')) {
      const id = this.nextId();
      this.ledger_entries.push({
        id,
        ledger_transaction_id: Number(params[0]),
        ledger_account_id: Number(params[1]),
        entry_type: params[2],
        amount: params[3],
        currency: params[4],
        balance_after: params[5],
        memo: params[6],
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('UPDATE ledger_accounts SET balance = ? WHERE id = ?')) {
      const acc = this.ledger_accounts.find((a) => a.id === Number(params[1]));
      if (acc) acc.balance = params[0];
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith('SELECT ca.id, la.balance AS avail_bal, lp.balance AS pend_bal FROM currency_accounts ca')) {
      const half = params.length / 2;
      const ids = params.slice(0, half).map(Number);
      const matched = this.currency_accounts
        .filter((ca) => ids.includes(ca.available_ledger_account_id) || ids.includes(ca.pending_ledger_account_id))
        .map((ca) => {
          const la = this.ledger_accounts.find((l) => l.id === ca.available_ledger_account_id);
          const lp = this.ledger_accounts.find((l) => l.id === ca.pending_ledger_account_id);
          return { id: ca.id, avail_bal: la.balance, pend_bal: lp.balance };
        });
      return [matched, []];
    }
    if (q.startsWith('UPDATE currency_accounts SET available_balance = ?, pending_balance = ?, ledger_balance = ? WHERE id = ?')) {
      const w = this.currency_accounts.find((c) => c.id === Number(params[3]));
      if (w) {
        w.available_balance = params[0];
        w.pending_balance = params[1];
        w.ledger_balance = params[2];
      }
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith('SELECT id FROM ledger_accounts WHERE code = ?')) {
      return [this.ledger_accounts.filter((a) => a.code === params[0]), []];
    }
    if (q.startsWith('SELECT id, reference, status, currency, total_amount, fee_amount, initiated_by_user_id FROM ledger_transactions WHERE id = ?')) {
      return [this.ledger_transactions.filter((t) => t.id === Number(params[0])), []];
    }
    if (q.startsWith('SELECT ledger_account_id, entry_type, amount, currency, memo FROM ledger_entries WHERE ledger_transaction_id = ?')) {
      return [this.ledger_entries.filter((e) => e.ledger_transaction_id === Number(params[0])), []];
    }
    if (q.startsWith("UPDATE ledger_transactions SET status = 'REVERSED' WHERE id = ?")) {
      const tx = this.ledger_transactions.find((t) => t.id === Number(params[0]));
      if (tx) tx.status = 'REVERSED';
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE ledger_transactions SET status = 'SUCCESSFUL' WHERE id = ?") || q.startsWith("UPDATE ledger_transactions SET status = 'CANCELLED' WHERE id = ?")) {
      const tx = this.ledger_transactions.find((t) => t.id === Number(params[0]));
      if (tx) tx.status = q.includes("'SUCCESSFUL'") ? 'SUCCESSFUL' : 'CANCELLED';
      return [{ affectedRows: 1 }, []];
    }

    // Transfers & Fees
    if (q.includes('FROM transfers WHERE idempotency_key = ?')) {
      return [this.transfers.filter((t) => t.idempotency_key === params[0]), []];
    }
    if (q.startsWith('SELECT ca.*, ba.daily_transfer_limit')) {
      const ca = this.currency_accounts.find((c) => c.id === Number(params[0]) && c.user_id === Number(params[1]));
      if (!ca) return [[], []];
      const ba = this.bank_accounts.find((b) => b.id === ca.bank_account_id);
      return [[{ ...ca, daily_transfer_limit: ba.daily_transfer_limit, bank_status: ba.status, sender_account_number: ba.account_number }], []];
    }
    if (q.startsWith('SELECT COALESCE(SUM(amount), 0) AS today_total FROM transfers')) {
      const total = this.transfers
        .filter((t) => t.sender_user_id === Number(params[0]) && t.currency === params[1])
        .reduce((acc, t) => acc + parseDecimalToScaled(t.amount), 0n);
      return [[{ today_total: formatScaledToDecimal(total) }], []];
    }
    if (q.startsWith('SELECT ca.*, u.status AS recip_user_status')) {
      const ba = this.bank_accounts.find(
        (b) =>
          String(b.account_number).toUpperCase() === String(params[1]).toUpperCase() ||
          String(b.iban).toUpperCase() === String(params[2]).toUpperCase()
      );
      if (!ba) return [[], []];
      const ca = this.currency_accounts.find((c) => c.bank_account_id === ba.id && c.currency === params[0]);
      if (!ca) return [[], []];
      const u = this.users.find((x) => x.id === ba.user_id);
      return [[{ ...ca, recip_user_status: u.status, recip_email: u.email }], []];
    }
    if (q.startsWith('SELECT flat_fee, percent_fee, min_fee, max_fee FROM transaction_fees')) {
      return [this.transaction_fees.filter((f) => f.transaction_type === params[0] && f.currency === params[1]), []];
    }
    if (q.startsWith('INSERT INTO transfers')) {
      const id = this.nextId();
      this.transfers.push({
        id,
        uuid: params[0],
        reference: params[1],
        idempotency_key: params[2],
        sender_user_id: params[3],
        sender_currency_account_id: params[4],
        recipient_user_id: params[5],
        recipient_currency_account_id: params[6],
        transfer_type: 'INTERNAL',
        recipient_name: params[7],
        recipient_account_number: params[8],
        recipient_bank: params[9],
        recipient_country: params[10],
        recipient_currency: params[11],
        amount: params[12],
        fee_amount: params[13],
        currency: params[14],
        description: params[15],
        status: 'SUCCESSFUL',
        ledger_transaction_id: params[16],
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT * FROM transfers WHERE reference = ?')) {
      return [this.transfers.filter((t) => t.reference === params[0]), []];
    }
    if (q.startsWith('UPDATE transfers SET status = \'REVERSED\'')) {
      const t = this.transfers.find((x) => x.ledger_transaction_id === Number(params[0]));
      if (t) t.status = 'REVERSED';
      return [{ affectedRows: 1 }, []];
    }

    // Deposits & Withdrawals
    if (q.startsWith('SELECT * FROM deposits WHERE idempotency_key = ?')) {
      return [this.deposits.filter((d) => d.idempotency_key === params[0]), []];
    }
    if (q.startsWith('SELECT * FROM currency_accounts WHERE id = ? AND user_id = ?')) {
      return [this.currency_accounts.filter((c) => c.id === Number(params[0]) && c.user_id === Number(params[1])), []];
    }
    if (q.startsWith('INSERT INTO deposits')) {
      const id = this.nextId();
      this.deposits.push({
        id,
        uuid: params[0],
        reference: params[1],
        idempotency_key: params[2],
        user_id: Number(params[3]),
        currency_account_id: Number(params[4]),
        method: params[5],
        amount: params[6],
        fee_amount: '0.0000',
        currency: params[7],
        status: 'PENDING',
        provider_name: params[8],
        provider_reference: params[9],
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT * FROM deposits WHERE reference = ?')) {
      return [this.deposits.filter((d) => d.reference === params[0]), []];
    }
    if (q.startsWith('SELECT * FROM deposits WHERE id = ?')) {
      return [this.deposits.filter((d) => d.id === Number(params[0])), []];
    }
    if (q.startsWith('SELECT ca.*, u.email FROM currency_accounts ca JOIN users u')) {
      const ca = this.currency_accounts.find((c) => c.id === Number(params[0]));
      const u = this.users.find((x) => x.id === ca?.user_id);
      return ca ? [[{ ...ca, email: u?.email }], []] : [[], []];
    }
    if (q.startsWith('UPDATE deposits SET status = \'SUCCESSFUL\'')) {
      const d = this.deposits.find((x) => x.id === Number(params[3]));
      if (d) {
        d.status = 'SUCCESSFUL';
        d.provider_reference = params[0];
        d.ledger_transaction_id = params[1];
      }
      return [{ affectedRows: 1 }, []];
    }

    if (q.startsWith('SELECT * FROM withdrawals WHERE idempotency_key = ?')) {
      return [this.withdrawals.filter((w) => w.idempotency_key === params[0]), []];
    }
    if (q.startsWith('INSERT INTO withdrawals')) {
      const id = this.nextId();
      this.withdrawals.push({
        id,
        uuid: params[0],
        reference: params[1],
        idempotency_key: params[2],
        user_id: Number(params[3]),
        currency_account_id: Number(params[4]),
        method: params[5],
        amount: params[6],
        fee_amount: '0.0000',
        currency: params[7],
        destination_details_json: params[8],
        status: 'PENDING',
        provider_name: params[9],
        hold_ledger_transaction_id: params[10],
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT * FROM withdrawals WHERE reference = ?')) {
      return [this.withdrawals.filter((w) => w.reference === params[0]), []];
    }
    if (q.startsWith('SELECT * FROM withdrawals WHERE id = ?')) {
      return [this.withdrawals.filter((w) => w.id === Number(params[0])), []];
    }
    if (q.startsWith("UPDATE withdrawals SET status = 'SUCCESSFUL'")) {
      const w = this.withdrawals.find((x) => x.id === Number(params[3]));
      if (w) {
        w.status = 'SUCCESSFUL';
        w.provider_reference = params[0];
        w.settlement_ledger_transaction_id = params[1];
      }
      return [{ affectedRows: 1 }, []];
    }
    if (q.startsWith("UPDATE withdrawals SET status = 'REJECTED'")) {
      const w = this.withdrawals.find((x) => x.id === Number(params[2]));
      if (w) {
        w.status = 'REJECTED';
        w.rejection_reason = params[0];
      }
      return [{ affectedRows: 1 }, []];
    }

    // KYC
    if (q.startsWith('INSERT INTO kyc_documents')) {
      const id = this.nextId();
      this.kyc_documents.push({
        id,
        uuid: params[0],
        user_id: Number(params[1]),
        document_type: params[2],
        original_filename: params[6],
        mime_type: params[7],
        file_size_bytes: params[8],
        storage_provider: params[9],
        storage_key: params[10],
        encrypted_payload: params[11],
        encryption_iv: params[12],
        encryption_tag: params[13],
        review_status: 'PENDING',
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT * FROM kyc_documents WHERE uuid = ?')) {
      return [this.kyc_documents.filter((d) => d.uuid === params[0]), []];
    }
    if (q.startsWith('UPDATE kyc_documents SET review_status = ?')) {
      this.kyc_documents
        .filter((d) => d.user_id === Number(params[3]))
        .forEach((d) => {
          d.review_status = params[0];
          d.reviewer_notes = params[1];
        });
      return [{ affectedRows: 1 }, []];
    }

    // Notifications, Audit & Admin
    if (q.startsWith('INSERT INTO notifications')) {
      this.notifications.push({ id: this.nextId(), user_id: params[1], category: params[2], title: params[3] });
      return [{ insertId: this.seq }, []];
    }
    if (q.startsWith('INSERT INTO security_events')) {
      this.security_events.push({ id: this.nextId(), actor_type: params[1], event_type: params[3] });
      return [{ insertId: this.seq }, []];
    }
    if (q.startsWith('SELECT COUNT(*) AS cnt FROM admin_users')) {
      return [[{ cnt: this.admin_users.length }], []];
    }
    if (q.startsWith("SELECT id FROM admin_roles WHERE code = 'SUPER_ADMIN'")) {
      return [this.admin_roles.filter((r) => r.code === 'SUPER_ADMIN'), []];
    }
    if (q.startsWith('INSERT INTO admin_users')) {
      const id = this.nextId();
      this.admin_users.push({
        id,
        uuid: params[0],
        email: params[1],
        full_name: params[2],
        password_hash: params[3],
        role_id: params[4],
        status: 'ACTIVE',
        mfa_enabled: 1,
        mfa_secret_enc: params[5],
        failed_login_attempts: 0,
      });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT au.*, ar.code AS role_code')) {
      const au = this.admin_users.find((a) => a.email === params[0]);
      if (!au) return [[], []];
      const ar = this.admin_roles.find((r) => r.id === au.role_id);
      return [[{ ...au, role_code: ar.code, role_name: ar.name }], []];
    }
    if (q.startsWith('UPDATE admin_users SET failed_login_attempts = 0')) return [{ affectedRows: 1 }, []];
    if (q.startsWith('INSERT INTO admin_sessions')) {
      const id = this.nextId();
      this.admin_sessions.push({ id, admin_user_id: Number(params[0]), token_hash: params[1], revoked_at: null });
      return [{ insertId: id }, []];
    }
    if (q.startsWith('SELECT s.id AS session_id, au.id, au.uuid')) {
      const sess = this.admin_sessions.find((s) => s.token_hash === params[0] && s.admin_user_id === Number(params[1]) && !s.revoked_at);
      if (!sess) return [[], []];
      const au = this.admin_users.find((a) => a.id === sess.admin_user_id);
      const ar = this.admin_roles.find((r) => r.id === au.role_id);
      return [[{ session_id: sess.id, ...au, role_code: ar.code }], []];
    }
    if (q.startsWith('SELECT ap.code FROM admin_role_permissions')) {
      const perms = this.admin_role_permissions
        .filter((rp) => rp.role_id === Number(params[0]))
        .map((rp) => this.admin_permissions.find((p) => p.id === rp.permission_id))
        .filter(Boolean);
      return [perms, []];
    }
    if (q.startsWith('INSERT INTO admin_audit_logs')) {
      let action = params[2] || 'ACTION';
      let targetType = params[3];
      let targetId = params[4];
      let reason = params[5];
      if (q.includes("'KYC_REVIEW'")) {
        action = 'KYC_REVIEW';
        targetType = 'users';
        targetId = params[2];
        reason = params[3];
      } else if (q.includes("'ADMIN_FIRST_RUN_BOOTSTRAP'")) {
        action = 'ADMIN_FIRST_RUN_BOOTSTRAP';
        targetType = 'admin_users';
        targetId = params[2];
        reason = 'Initial Super Administrator claimed via first-run setup';
      }
      this.admin_audit_logs.push({
        id: this.nextId(),
        action,
        target_type: targetType,
        target_id: targetId,
        reason,
      });
      return [{ insertId: this.seq }, []];
    }

    return [[], []];
  }

  asPool(): any {
    const self = this;
    return {
      query: (sql: string, params?: any[]) => self.query(sql, params),
      getConnection: async () => ({
        query: (sql: string, params?: any[]) => self.query(sql, params),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      }),
      end: async () => {},
    };
  }
}

describe('Meridian International Bank Core Security & Financial Engine', () => {
  let db: MockMySqlDatabase;

  beforeEach(() => {
    db = new MockMySqlDatabase();
    setCustomPoolForTesting(db.asPool());
    process.env.MYSQL_HOST = 'mock';
    process.env.MYSQL_USER = 'mock';
    process.env.MYSQL_DATABASE = 'mock';
  });

  after(() => {
    setCustomPoolForTesting(null);
  });

  it('performs exact BigInt decimal arithmetic without floating-point drift', () => {
    const a = parseDecimalToScaled('0.1000');
    const b = parseDecimalToScaled('0.2000');
    assert.equal(formatScaledToDecimal(a + b), '0.3000');

    const fee = calculateFeeScaled(parseDecimalToScaled('1000.00'), '2.50', '0.0035', '5.00', '50.00');
    assert.equal(formatScaledToDecimal(fee), '6.0000');

    const fx = applyExchangeRate(parseDecimalToScaled('100.00'), '0.92150000', 2);
    assert.equal(formatScaledToDecimal(fx), '92.1500');
  });

  it('encrypts/decrypts KYC payloads and verifies TOTP & HMAC webhook signatures', () => {
    const plain = Buffer.from('sensitive-passport-scan-bytes');
    const { encrypted, ivHex, tagHex } = encryptBuffer(plain);
    assert.notDeepEqual(encrypted, plain);
    assert.deepEqual(decryptBuffer(encrypted, ivHex, tagHex), plain);

    const secret = 'JBSWY3DPEHPK3PXP';
    const code = generateTotpCode(secret);
    assert.equal(verifyTotpCode(secret, code), true);
    assert.equal(verifyTotpCode(secret, '000000'), false);

    const webhookBody = JSON.stringify({ eventId: 'evt_1', eventType: 'deposit.settled' });
    const sig = crypto.createHmac('sha256', 'whsec_test_123').update(webhookBody).digest('hex');
    assert.equal(verifyHmacSignature(webhookBody, `sha256=${sig}`, 'whsec_test_123'), true);
    assert.equal(verifyHmacSignature(webhookBody, 'tampered', 'whsec_test_123'), false);
  });

  it('registers customers, hashes passwords with bcrypt, enforces lockout, and provisions wallets', async () => {
    const reg = await registerCustomer(
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: '+442079460001',
        country: 'GB',
        dateOfBirth: '1992-01-10',
        addressLine1: '10 Downing Way',
        city: 'London',
        password: 'StrongPassword123',
      },
      { ip: '127.0.0.1' }
    );
    assert.ok(reg.accountNumber.startsWith('MRD'));
    const storedUser = db.users.find((u) => u.email === 'ada@example.com');
    assert.ok(storedUser.password_hash.startsWith('$2'));
    assert.notEqual(storedUser.password_hash, 'StrongPassword123');

    // Lockout after 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => loginCustomer({ email: 'ada@example.com', password: 'WrongPassword1' }, {}));
    }
    await assert.rejects(
      () => loginCustomer({ email: 'ada@example.com', password: 'StrongPassword123' }, {}),
      /temporarily locked/
    );
  });

  it('enforces double-entry ledger balancing, blocks negative balances, prevents duplicate idempotency, and reverses transactions cleanly', async () => {
    const alice = await registerCustomer(
      {
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        phone: '+12025550101',
        country: 'US',
        dateOfBirth: '1990-05-05',
        addressLine1: '100 Main St',
        city: 'New York',
        password: 'StrongPassword123',
      },
      {}
    );
    const bob = await registerCustomer(
      {
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@example.com',
        phone: '+12025550102',
        country: 'US',
        dateOfBirth: '1988-06-06',
        addressLine1: '200 Broad St',
        city: 'New York',
        password: 'StrongPassword123',
      },
      {}
    );

    const aliceUsd = db.currency_accounts.find((w) => w.user_id === alice.userId && w.currency === 'USD');
    const bobUsd = db.currency_accounts.find((w) => w.user_id === bob.userId && w.currency === 'USD');

    // 1. Reject unbalanced ledger entries
    const conn = await db.asPool().getConnection();
    await assert.rejects(
      () =>
        postLedgerTransaction(conn, {
          idempotencyKey: 'unbalanced_key_1',
          transactionType: 'DEPOSIT',
          status: 'SUCCESSFUL',
          currency: 'USD',
          totalAmount: '100.00',
          description: 'Invalid unbalanced',
          entries: [
            { ledgerAccountId: 1, entryType: 'DEBIT', amount: '100.00', currency: 'USD' },
            { ledgerAccountId: aliceUsd.available_ledger_account_id, entryType: 'CREDIT', amount: '99.00', currency: 'USD' },
          ],
        }),
      (err: LedgerError) => err.code === 'LEDGER_IMBALANCE'
    );

    // 2. Deposit request stays PENDING and does NOT credit balance until verified
    const depReq = await createDepositRequest({
      userId: alice.userId,
      currencyAccountId: aliceUsd.id,
      method: 'BANK_TRANSFER',
      amount: '500.00',
      idempotencyKey: 'dep_req_alice_1',
    });
    assert.equal(depReq.deposit.status, 'PENDING');
    assert.equal(aliceUsd.available_balance, '0.0000');

    // 3. Verified deposit credits Available Balance via double-entry ledger
    const settled = await settleVerifiedDeposit({
      depositId: depReq.deposit.id,
      providerReference: 'STRIPE_PI_999',
      adminUserId: null,
    });
    assert.equal(settled.deposit.status, 'SUCCESSFUL');
    assert.equal(aliceUsd.available_balance, '500.0000');

    // 4. Reject overdraft / negative balance transfer
    await assert.rejects(
      () =>
        executeTransfer({
          senderUserId: alice.userId,
          sourceCurrencyAccountId: aliceUsd.id,
          transferType: 'INTERNAL',
          recipientName: 'Bob Jones',
          recipientAccountNumber: db.bank_accounts.find((b) => b.user_id === bob.userId).account_number,
          recipientBank: 'Meridian Bank',
          recipientCountry: 'US',
          recipientCurrency: 'USD',
          amount: '600.00',
          description: 'Overdraft attempt',
          idempotencyKey: 'trf_overdraft_1',
        }),
      /Insufficient funds/
    );

    // 5. Successful internal transfer + duplicate idempotency key prevention
    const bobBank = db.bank_accounts.find((b) => b.user_id === bob.userId);
    const trf1 = await executeTransfer({
      senderUserId: alice.userId,
      sourceCurrencyAccountId: aliceUsd.id,
      transferType: 'INTERNAL',
      recipientName: 'Bob Jones',
      recipientAccountNumber: bobBank.account_number,
      recipientBank: 'Meridian Bank',
      recipientCountry: 'US',
      recipientCurrency: 'USD',
      amount: '150.00',
      description: 'Invoice payment',
      idempotencyKey: 'trf_idemp_key_123',
    });
    assert.equal(trf1.idempotentReplay, false);
    assert.equal(aliceUsd.available_balance, '350.0000');
    assert.equal(bobUsd.available_balance, '150.0000');

    const trfDup = await executeTransfer({
      senderUserId: alice.userId,
      sourceCurrencyAccountId: aliceUsd.id,
      transferType: 'INTERNAL',
      recipientName: 'Bob Jones',
      recipientAccountNumber: bobBank.account_number,
      recipientBank: 'Meridian Bank',
      recipientCountry: 'US',
      recipientCurrency: 'USD',
      amount: '150.00',
      description: 'Invoice payment',
      idempotencyKey: 'trf_idemp_key_123',
    });
    assert.equal(trfDup.idempotentReplay, true);
    assert.equal(aliceUsd.available_balance, '350.0000');

    // 6. Controlled compensating reversal restores balances cleanly
    await reverseLedgerTransaction(conn, {
      originalTransactionId: trf1.transfer.ledger_transaction_id,
      idempotencyKey: 'rev_key_123',
      adminUserId: 1,
      reason: 'Customer dispute resolution',
    });
    assert.equal(aliceUsd.available_balance, '500.0000');
    assert.equal(bobUsd.available_balance, '0.0000');
  });

  it('manages withdrawal pending holds, approvals, rejections, KYC encryption, and admin RBAC + audit logs', async () => {
    const cust = await registerCustomer(
      {
        firstName: 'Clara',
        lastName: 'Oswald',
        email: 'clara@example.com',
        phone: '+442079460999',
        country: 'GB',
        dateOfBirth: '1991-09-11',
        addressLine1: '221B Baker St',
        city: 'London',
        password: 'StrongPassword123',
      },
      {}
    );
    const usdWallet = db.currency_accounts.find((w) => w.user_id === cust.userId && w.currency === 'USD');

    // Upload encrypted KYC document & verify compliance review + audit log
    const doc = await uploadEncryptedKycDocument({
      userId: cust.userId,
      documentType: 'PASSPORT',
      documentNumber: 'P998877',
      issuingCountry: 'GB',
      originalFilename: 'passport.png',
      mimeType: 'image/png',
      fileBuffer: Buffer.from('binary-passport-image'),
    });
    const decrypted = await getDecryptedKycDocument({
      documentUuid: doc.uuid,
      actorType: 'CUSTOMER',
      actorId: cust.userId,
    });
    assert.equal(decrypted?.buffer.toString(), 'binary-passport-image');

    await assert.rejects(
      () =>
        getDecryptedKycDocument({
          documentUuid: doc.uuid,
          actorType: 'CUSTOMER',
          actorId: cust.userId + 999,
        }),
      /FORBIDDEN_DOCUMENT_ACCESS/
    );

    await reviewCustomerKyc({
      userId: cust.userId,
      adminUserId: 1,
      decision: 'APPROVED',
      notes: 'Passport verified against registration profile',
    });
    assert.equal(db.users.find((u) => u.id === cust.userId).kyc_status, 'APPROVED');
    assert.ok(db.admin_audit_logs.some((l) => l.action === 'KYC_REVIEW'));

    // Deposit & fund wallet
    const dep = await createDepositRequest({
      userId: cust.userId,
      currencyAccountId: usdWallet.id,
      method: 'BANK_TRANSFER',
      amount: '400.00',
      idempotencyKey: 'dep_clara_1',
    });
    await settleVerifiedDeposit({ depositId: dep.deposit.id, providerReference: 'WIRE_01' });

    // Withdrawal 1: Create -> Hold -> Reject -> Release Hold
    const wd1 = await createWithdrawalRequest({
      userId: cust.userId,
      currencyAccountId: usdWallet.id,
      method: 'EXTERNAL_BANK',
      amount: '100.00',
      destinationDetails: { accountName: 'Clara Oswald', accountNumber: 'GB123456', bankName: 'Barclays', country: 'GB' },
      idempotencyKey: 'wdr_clara_1',
    });
    assert.equal(usdWallet.available_balance, '300.0000');
    assert.equal(usdWallet.pending_balance, '100.0000');

    await rejectWithdrawalAndReleaseHold({
      withdrawalId: wd1.withdrawal.id,
      adminUserId: 1,
      reason: 'Beneficiary bank mismatch',
    });
    assert.equal(usdWallet.available_balance, '400.0000');
    assert.equal(usdWallet.pending_balance, '0.0000');

    // Withdrawal 2: Create -> Approve & Settle
    const wd2 = await createWithdrawalRequest({
      userId: cust.userId,
      currencyAccountId: usdWallet.id,
      method: 'EXTERNAL_BANK',
      amount: '120.00',
      destinationDetails: { accountName: 'Clara Oswald', accountNumber: 'GB123456', bankName: 'Barclays', country: 'GB' },
      idempotencyKey: 'wdr_clara_2',
    });
    await approveAndSettleWithdrawal({
      withdrawalId: wd2.withdrawal.id,
      adminUserId: 1,
      providerReference: 'PAYOUT_REF_77',
    });
    assert.equal(usdWallet.available_balance, '280.0000');
    assert.equal(usdWallet.pending_balance, '0.0000');
    assert.equal(usdWallet.ledger_balance, '280.0000');

    // Admin bootstrap, MFA login & RBAC permission enforcement
    const boot = await bootstrapFirstAdmin({
      email: 'chief.admin@meridianbank.example',
      fullName: 'Chief Administrator',
      password: 'SuperAdminPassword!99',
    });
    const mfaCode = generateTotpCode(boot.totpSecret);
    const loginRes = await loginAdmin(
      { email: 'chief.admin@meridianbank.example', password: 'SuperAdminPassword!99', totpCode: mfaCode },
      {}
    );
    assert.equal(loginRes.requiresTwoFactor, false);
    assert.ok(loginRes.token);

    // RBAC HTTP check: SUPPORT_ADMIN cannot access transactions.reverse
    const testApp = express();
    testApp.post(
      '/test-reverse',
      (req, _res, next) => {
        req.admin = {
          id: 99,
          uuid: 'u',
          email: 'support@example.com',
          fullName: 'Support',
          roleCode: 'SUPPORT_ADMIN',
          permissions: ['users.read'],
          sessionId: 1,
        };
        next();
      },
      requirePermission('transactions.reverse'),
      (_req, res) => res.json({ ok: true })
    );
    testApp.use(errorHandler);
    const server = testApp.listen(0);
    const addr: any = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/test-reverse`, { method: 'POST' });
    assert.equal(resp.status, 403);
    server.close();
  });
});
