import crypto from 'crypto';
import { withTransaction } from '../config/database.js';
import {
  assertPositiveScaled,
  formatScaledToDecimal,
  parseDecimalToScaled,
} from '../utils/money.js';
import { generateReference } from '../utils/crypto.js';
import {
  getSystemLedgerAccount,
  LedgerError,
  postLedgerTransaction,
} from './ledgerService.js';
import { providers } from './providers/registry.js';
import { createNotification } from './notificationService.js';

/**
 * Creates a deposit request in PENDING status.
 * NEVER credits customer balances on submission or receipt upload.
 * Balances are ONLY credited when reconciled via verified payment provider webhook
 * or authorized Finance Administrator confirmation.
 */
export async function createDepositRequest(input: {
  userId: number;
  currencyAccountId: number;
  method: 'BANK_TRANSFER' | 'CARD_PAYMENT' | 'PAYMENT_GATEWAY' | 'PARTNER_ACCOUNT';
  amount: string;
  idempotencyKey: string;
}) {
  const amountScaled = parseDecimalToScaled(input.amount);
  assertPositiveScaled(amountScaled, 'Deposit amount');

  return await withTransaction(async (conn) => {
    const [existing]: any = await conn.query(
      `SELECT * FROM deposits WHERE idempotency_key = ? LIMIT 1`,
      [input.idempotencyKey]
    );
    if (existing.length > 0) {
      return { idempotentReplay: true, deposit: existing[0] };
    }

    const [users]: any = await conn.query(`SELECT id, email, status FROM users WHERE id = ?`, [input.userId]);
    if (users.length === 0) throw new LedgerError('User not found', 404);
    if (users[0].status !== 'ACTIVE') {
      throw new LedgerError('Suspended or restricted accounts cannot initiate deposits.', 403);
    }

    const [wallets]: any = await conn.query(
      `SELECT * FROM currency_accounts WHERE id = ? AND user_id = ?`,
      [input.currencyAccountId, input.userId]
    );
    if (wallets.length === 0) throw new LedgerError('Currency wallet not found.', 404);
    const wallet = wallets[0];

    const reference = generateReference('DEP');
    const initResult = await providers.paymentGateway.initiateDeposit({
      reference,
      amount: formatScaledToDecimal(amountScaled),
      currency: wallet.currency,
      method: input.method,
      customerEmail: users[0].email,
    });

    await conn.query(
      `INSERT INTO deposits
        (uuid, reference, idempotency_key, user_id, currency_account_id, method, amount, fee_amount, currency, status, provider_name, provider_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0.0000', ?, 'PENDING', ?, ?)`,
      [
        crypto.randomUUID(),
        reference,
        input.idempotencyKey,
        input.userId,
        wallet.id,
        input.method,
        formatScaledToDecimal(amountScaled),
        wallet.currency,
        initResult.providerName,
        initResult.providerReference || null,
      ]
    );

    const [saved]: any = await conn.query(`SELECT * FROM deposits WHERE reference = ? LIMIT 1`, [reference]);
    return {
      idempotentReplay: false,
      deposit: saved[0],
      instructions: initResult.instructions,
    };
  });
}

/**
 * Settles a verified deposit via double-entry ledger.
 * Callable ONLY by verified webhook reconciliation or authorized admin reconciliation.
 */
export async function settleVerifiedDeposit(params: {
  depositId: number;
  providerReference: string;
  adminUserId?: number | null;
}) {
  return await withTransaction(async (conn) => {
    const [depRows]: any = await conn.query(`SELECT * FROM deposits WHERE id = ? FOR UPDATE`, [params.depositId]);
    if (depRows.length === 0) throw new LedgerError('Deposit record not found.', 404);
    const deposit = depRows[0];

    if (deposit.status === 'SUCCESSFUL') {
      return { alreadySettled: true, deposit };
    }
    if (deposit.status !== 'PENDING' && deposit.status !== 'PROCESSING') {
      throw new LedgerError(`Cannot settle deposit in ${deposit.status} state.`, 400);
    }

    const [wallets]: any = await conn.query(
      `SELECT ca.*, u.email FROM currency_accounts ca JOIN users u ON u.id = ca.user_id WHERE ca.id = ? FOR UPDATE`,
      [deposit.currency_account_id]
    );
    const wallet = wallets[0];
    const clearingId = await getSystemLedgerAccount(conn, `SYS_CLEARING_${deposit.currency}`);

    const ltx = await postLedgerTransaction(conn, {
      reference: deposit.reference,
      idempotencyKey: `dep_settle_${deposit.id}`,
      transactionType: 'DEPOSIT',
      status: 'SUCCESSFUL',
      currency: deposit.currency,
      totalAmount: String(deposit.amount),
      feeAmount: String(deposit.fee_amount),
      description: `Verified deposit ${deposit.reference} (${params.providerReference})`,
      initiatedByUserId: Number(deposit.user_id),
      entries: [
        {
          ledgerAccountId: clearingId,
          entryType: 'DEBIT',
          amount: String(deposit.amount),
          currency: deposit.currency,
          memo: `Verified provider inflow ${params.providerReference}`,
        },
        {
          ledgerAccountId: Number(wallet.available_ledger_account_id),
          entryType: 'CREDIT',
          amount: String(deposit.amount),
          currency: deposit.currency,
          memo: `Customer deposit credit ${deposit.reference}`,
        },
      ],
    });

    await conn.query(
      `UPDATE deposits
       SET status = 'SUCCESSFUL', provider_reference = ?, ledger_transaction_id = ?, verified_by_admin_id = ?, verified_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [params.providerReference, ltx.transactionId, params.adminUserId ?? null, deposit.id]
    );

    await createNotification(
      {
        userId: Number(deposit.user_id),
        category: 'DEPOSIT',
        title: 'Deposit confirmed and credited',
        message: `Your deposit of ${deposit.amount} ${deposit.currency} (Ref: ${deposit.reference}) has been verified and credited.`,
        emailTo: wallet.email,
        sendEmail: true,
      },
      conn
    );

    const [updated]: any = await conn.query(`SELECT * FROM deposits WHERE id = ? LIMIT 1`, [deposit.id]);
    return { alreadySettled: false, deposit: updated[0] };
  });
}

/**
 * Initiates a withdrawal request by placing a double-entry pending hold
 * (Available -> Pending). Funds are NOT released externally until approved and
 * confirmed by a configured payout provider.
 */
export async function createWithdrawalRequest(input: {
  userId: number;
  currencyAccountId: number;
  method: 'INTERNAL_ACCOUNT' | 'EXTERNAL_BANK' | 'PAYOUT_PROVIDER';
  amount: string;
  destinationDetails: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const amountScaled = parseDecimalToScaled(input.amount);
  assertPositiveScaled(amountScaled, 'Withdrawal amount');

  return await withTransaction(async (conn) => {
    const [existing]: any = await conn.query(
      `SELECT * FROM withdrawals WHERE idempotency_key = ? LIMIT 1`,
      [input.idempotencyKey]
    );
    if (existing.length > 0) {
      return { idempotentReplay: true, withdrawal: existing[0] };
    }

    const [users]: any = await conn.query(
      `SELECT id, email, status, kyc_status FROM users WHERE id = ? FOR UPDATE`,
      [input.userId]
    );
    if (users.length === 0) throw new LedgerError('User not found', 404);
    if (users[0].status !== 'ACTIVE') {
      throw new LedgerError('Account is restricted or suspended from withdrawals.', 403);
    }
    if (input.method !== 'INTERNAL_ACCOUNT' && users[0].kyc_status !== 'APPROVED') {
      throw new LedgerError('Approved KYC verification is required for external withdrawals.', 403, 'KYC_REQUIRED');
    }

    const [wallets]: any = await conn.query(
      `SELECT * FROM currency_accounts WHERE id = ? AND user_id = ? FOR UPDATE`,
      [input.currencyAccountId, input.userId]
    );
    if (wallets.length === 0) throw new LedgerError('Currency wallet not found.', 404);
    const wallet = wallets[0];

    const reference = generateReference('WDR');

    const holdTx = await postLedgerTransaction(conn, {
      reference: `${reference}-HLD`,
      idempotencyKey: `wdr_hold_${input.idempotencyKey}`,
      transactionType: 'WITHDRAWAL',
      status: 'PENDING',
      currency: wallet.currency,
      totalAmount: formatScaledToDecimal(amountScaled),
      feeAmount: '0.0000',
      description: `Withdrawal hold ${reference}`,
      initiatedByUserId: input.userId,
      entries: [
        {
          ledgerAccountId: Number(wallet.available_ledger_account_id),
          entryType: 'DEBIT',
          amount: formatScaledToDecimal(amountScaled),
          currency: wallet.currency,
          memo: `Hold available balance for withdrawal ${reference}`,
        },
        {
          ledgerAccountId: Number(wallet.pending_ledger_account_id),
          entryType: 'CREDIT',
          amount: formatScaledToDecimal(amountScaled),
          currency: wallet.currency,
          memo: `Pending withdrawal reserve ${reference}`,
        },
      ],
    });

    await conn.query(
      `INSERT INTO withdrawals
        (uuid, reference, idempotency_key, user_id, currency_account_id, method, amount, fee_amount, currency, destination_details_json, status, provider_name, hold_ledger_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0.0000', ?, ?, 'PENDING', ?, ?)`,
      [
        crypto.randomUUID(),
        reference,
        input.idempotencyKey,
        input.userId,
        wallet.id,
        input.method,
        formatScaledToDecimal(amountScaled),
        wallet.currency,
        JSON.stringify(input.destinationDetails),
        providers.bankingPartner.getStatus().name,
        holdTx.transactionId,
      ]
    );

    const [saved]: any = await conn.query(`SELECT * FROM withdrawals WHERE reference = ? LIMIT 1`, [reference]);
    return { idempotentReplay: false, withdrawal: saved[0] };
  });
}

export async function approveAndSettleWithdrawal(params: {
  withdrawalId: number;
  adminUserId: number;
  providerReference: string;
}) {
  return await withTransaction(async (conn) => {
    const [rows]: any = await conn.query(`SELECT * FROM withdrawals WHERE id = ? FOR UPDATE`, [params.withdrawalId]);
    if (rows.length === 0) throw new LedgerError('Withdrawal request not found.', 404);
    const wd = rows[0];
    if (wd.status !== 'PENDING' && wd.status !== 'APPROVED') {
      throw new LedgerError(`Cannot settle withdrawal in ${wd.status} state.`, 400);
    }

    const partnerStatus = providers.bankingPartner.getStatus();
    if (wd.method !== 'INTERNAL_ACCOUNT' && !partnerStatus.available && !params.providerReference) {
      throw new LedgerError(
        'Cannot complete external payout without a configured banking partner or verified payout reference.',
        503,
        'PAYOUT_PROVIDER_UNAVAILABLE'
      );
    }

    const [wallets]: any = await conn.query(
      `SELECT ca.*, u.email FROM currency_accounts ca JOIN users u ON u.id = ca.user_id WHERE ca.id = ? FOR UPDATE`,
      [wd.currency_account_id]
    );
    const wallet = wallets[0];
    const clearingId = await getSystemLedgerAccount(conn, `SYS_CLEARING_${wd.currency}`);

    const settleTx = await postLedgerTransaction(conn, {
      reference: wd.reference,
      idempotencyKey: `wdr_settle_${wd.id}`,
      transactionType: 'WITHDRAWAL',
      status: 'SUCCESSFUL',
      currency: wd.currency,
      totalAmount: String(wd.amount),
      feeAmount: String(wd.fee_amount),
      description: `Settled withdrawal ${wd.reference} (${params.providerReference})`,
      initiatedByUserId: Number(wd.user_id),
      entries: [
        {
          ledgerAccountId: Number(wallet.pending_ledger_account_id),
          entryType: 'DEBIT',
          amount: String(wd.amount),
          currency: wd.currency,
          memo: `Release pending reserve on payout ${wd.reference}`,
        },
        {
          ledgerAccountId: clearingId,
          entryType: 'CREDIT',
          amount: String(wd.amount),
          currency: wd.currency,
          memo: `External payout clearing ${params.providerReference}`,
        },
      ],
    });

    await conn.query(
      `UPDATE withdrawals
       SET status = 'SUCCESSFUL', provider_reference = ?, settlement_ledger_transaction_id = ?, reviewed_by_admin_id = ?, reviewed_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [params.providerReference, settleTx.transactionId, params.adminUserId, wd.id]
    );

    if (wd.hold_ledger_transaction_id) {
      await conn.query(`UPDATE ledger_transactions SET status = 'SUCCESSFUL' WHERE id = ?`, [
        wd.hold_ledger_transaction_id,
      ]);
    }

    await createNotification(
      {
        userId: Number(wd.user_id),
        category: 'WITHDRAWAL',
        title: 'Withdrawal processed',
        message: `Your withdrawal of ${wd.amount} ${wd.currency} (Ref: ${wd.reference}) has been settled.`,
        emailTo: wallet.email,
        sendEmail: true,
      },
      conn
    );

    const [updated]: any = await conn.query(`SELECT * FROM withdrawals WHERE id = ? LIMIT 1`, [wd.id]);
    return updated[0];
  });
}

export async function rejectWithdrawalAndReleaseHold(params: {
  withdrawalId: number;
  adminUserId: number;
  reason: string;
}) {
  return await withTransaction(async (conn) => {
    const [rows]: any = await conn.query(`SELECT * FROM withdrawals WHERE id = ? FOR UPDATE`, [params.withdrawalId]);
    if (rows.length === 0) throw new LedgerError('Withdrawal request not found.', 404);
    const wd = rows[0];
    if (wd.status !== 'PENDING' && wd.status !== 'APPROVED') {
      throw new LedgerError(`Cannot reject withdrawal in ${wd.status} state.`, 400);
    }

    const [wallets]: any = await conn.query(
      `SELECT ca.*, u.email FROM currency_accounts ca JOIN users u ON u.id = ca.user_id WHERE ca.id = ? FOR UPDATE`,
      [wd.currency_account_id]
    );
    const wallet = wallets[0];

    await postLedgerTransaction(conn, {
      reference: `${wd.reference}-REL`,
      idempotencyKey: `wdr_reject_${wd.id}`,
      transactionType: 'REVERSAL',
      status: 'SUCCESSFUL',
      currency: wd.currency,
      totalAmount: String(wd.amount),
      feeAmount: '0.0000',
      description: `Release hold for rejected withdrawal ${wd.reference}`,
      initiatedByUserId: Number(wd.user_id),
      reversedTransactionId: wd.hold_ledger_transaction_id ? Number(wd.hold_ledger_transaction_id) : null,
      entries: [
        {
          ledgerAccountId: Number(wallet.pending_ledger_account_id),
          entryType: 'DEBIT',
          amount: String(wd.amount),
          currency: wd.currency,
          memo: `Release pending hold (${params.reason})`,
        },
        {
          ledgerAccountId: Number(wallet.available_ledger_account_id),
          entryType: 'CREDIT',
          amount: String(wd.amount),
          currency: wd.currency,
          memo: `Return funds to available balance`,
        },
      ],
    });

    await conn.query(
      `UPDATE withdrawals
       SET status = 'REJECTED', rejection_reason = ?, reviewed_by_admin_id = ?, reviewed_at = UTC_TIMESTAMP(3)
       WHERE id = ?`,
      [params.reason, params.adminUserId, wd.id]
    );

    if (wd.hold_ledger_transaction_id) {
      await conn.query(`UPDATE ledger_transactions SET status = 'CANCELLED' WHERE id = ?`, [
        wd.hold_ledger_transaction_id,
      ]);
    }

    await createNotification(
      {
        userId: Number(wd.user_id),
        category: 'WITHDRAWAL',
        title: 'Withdrawal request declined',
        message: `Your withdrawal ${wd.reference} was declined and funds returned to available balance. Reason: ${params.reason}`,
        emailTo: wallet.email,
        sendEmail: true,
      },
      conn
    );

    const [updated]: any = await conn.query(`SELECT * FROM withdrawals WHERE id = ? LIMIT 1`, [wd.id]);
    return updated[0];
  });
}
