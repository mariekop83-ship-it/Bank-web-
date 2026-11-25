import crypto from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import {
  parseDecimalToScaled,
  formatScaledToDecimal,
  assertPositiveScaled,
} from '../utils/money.js';
import { generateReference } from '../utils/crypto.js';

export type LedgerEntryType = 'DEBIT' | 'CREDIT';
export type LedgerTransactionType =
  | 'INTERNAL_TRANSFER'
  | 'DOMESTIC_TRANSFER'
  | 'INTERNATIONAL_TRANSFER'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'FX_CONVERSION'
  | 'FEE'
  | 'REVERSAL'
  | 'CARD_SETTLEMENT';

export type LedgerTransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'REVERSED'
  | 'CANCELLED';

export interface LedgerEntryInput {
  ledgerAccountId: number;
  entryType: LedgerEntryType;
  amount: string; // exact decimal string
  currency: string;
  memo?: string;
}

export interface PostLedgerTransactionInput {
  reference?: string;
  idempotencyKey: string;
  transactionType: LedgerTransactionType;
  status: LedgerTransactionStatus;
  currency: string;
  totalAmount: string;
  feeAmount?: string;
  description: string;
  initiatedByUserId?: number | null;
  reversedTransactionId?: number | null;
  metadata?: Record<string, unknown>;
  entries: LedgerEntryInput[];
}

export interface LedgerAccountRow {
  id: number;
  code: string;
  account_class: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  currency: string;
  owner_user_id: number | null;
  allow_negative: number;
  balance: string;
}

function isDebitNormal(accountClass: LedgerAccountRow['account_class']): boolean {
  return accountClass === 'ASSET' || accountClass === 'EXPENSE';
}

export class LedgerError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = 'LEDGER_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function postLedgerTransaction(
  conn: PoolConnection,
  input: PostLedgerTransactionInput
): Promise<{ transactionId: number; reference: string; idempotentReplay: boolean }> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 8) {
    throw new LedgerError('Valid idempotency key is required for ledger transactions', 400, 'IDEMPOTENCY_REQUIRED');
  }

  // 1. Idempotency check
  const [existingRows]: any = await conn.query(
    `SELECT id, reference FROM ledger_transactions WHERE idempotency_key = ? LIMIT 1`,
    [input.idempotencyKey]
  );
  if (existingRows.length > 0) {
    return {
      transactionId: Number(existingRows[0].id),
      reference: existingRows[0].reference,
      idempotentReplay: true,
    };
  }

  if (!input.entries || input.entries.length < 2) {
    throw new LedgerError('Double-entry transaction requires at least two balanced entries', 400, 'UNBALANCED_ENTRIES');
  }

  // 2. Validate positive amounts & balanced DEBIT === CREDIT per currency
  const balanceCheckByCurrency = new Map<string, { debits: bigint; credits: bigint }>();

  for (const entry of input.entries) {
    const amtScaled = parseDecimalToScaled(entry.amount);
    assertPositiveScaled(amtScaled, 'Ledger entry amount');

    const bucket = balanceCheckByCurrency.get(entry.currency) || { debits: 0n, credits: 0n };
    if (entry.entryType === 'DEBIT') {
      bucket.debits += amtScaled;
    } else {
      bucket.credits += amtScaled;
    }
    balanceCheckByCurrency.set(entry.currency, bucket);
  }

  for (const [curr, totals] of balanceCheckByCurrency.entries()) {
    if (totals.debits !== totals.credits) {
      throw new LedgerError(
        `Unbalanced ledger entries for ${curr}: debits (${formatScaledToDecimal(totals.debits)}) != credits (${formatScaledToDecimal(totals.credits)})`,
        400,
        'LEDGER_IMBALANCE'
      );
    }
  }

  // 3. Acquire deterministic row locks on all affected ledger_accounts (ordered ascending by id)
  const uniqueAccountIds = Array.from(new Set(input.entries.map((e) => e.ledgerAccountId))).sort((a, b) => a - b);
  const placeholders = uniqueAccountIds.map(() => '?').join(',');
  const [lockedAccounts]: any = await conn.query(
    `SELECT id, code, account_class, currency, owner_user_id, allow_negative, balance
     FROM ledger_accounts
     WHERE id IN (${placeholders})
     ORDER BY id ASC
     FOR UPDATE`,
    uniqueAccountIds
  );

  if (lockedAccounts.length !== uniqueAccountIds.length) {
    throw new LedgerError('One or more ledger accounts do not exist', 404, 'LEDGER_ACCOUNT_NOT_FOUND');
  }

  const accountMap = new Map<number, LedgerAccountRow>();
  const runningBalanceMap = new Map<number, bigint>();
  for (const row of lockedAccounts as LedgerAccountRow[]) {
    accountMap.set(Number(row.id), row);
    runningBalanceMap.set(Number(row.id), parseDecimalToScaled(row.balance));
  }

  // 4. Create immutable ledger_transactions header
  const reference = input.reference || generateReference('LTX');
  const totalScaled = parseDecimalToScaled(input.totalAmount);
  const feeScaled = parseDecimalToScaled(input.feeAmount || '0');

  const [txRes]: any = await conn.query(
    `INSERT INTO ledger_transactions
      (uuid, reference, idempotency_key, transaction_type, status, currency, total_amount, fee_amount, description, initiated_by_user_id, reversed_transaction_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      reference,
      input.idempotencyKey,
      input.transactionType,
      input.status,
      input.currency,
      formatScaledToDecimal(totalScaled),
      formatScaledToDecimal(feeScaled),
      input.description.slice(0, 255),
      input.initiatedByUserId ?? null,
      input.reversedTransactionId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
  const ledgerTransactionId = Number(txRes.insertId);

  // 5. Apply entries sequentially, verify non-negative policy, write immutable ledger_entries
  for (const entry of input.entries) {
    const acc = accountMap.get(entry.ledgerAccountId);
    if (!acc) {
      throw new LedgerError(`Missing locked account ${entry.ledgerAccountId}`, 500);
    }
    if (acc.currency !== entry.currency) {
      throw new LedgerError(
        `Currency mismatch on account ${acc.code}: expected ${acc.currency}, received ${entry.currency}`,
        400,
        'CURRENCY_MISMATCH'
      );
    }

    const amtScaled = parseDecimalToScaled(entry.amount);
    const currentScaled = runningBalanceMap.get(entry.ledgerAccountId)!;
    const debitNormal = isDebitNormal(acc.account_class);
    const delta =
      (debitNormal && entry.entryType === 'DEBIT') || (!debitNormal && entry.entryType === 'CREDIT')
        ? amtScaled
        : -amtScaled;

    const nextScaled = currentScaled + delta;
    if (!acc.allow_negative && nextScaled < 0n) {
      throw new LedgerError(
        `Insufficient funds in ${acc.currency} account`,
        400,
        'INSUFFICIENT_FUNDS'
      );
    }

    runningBalanceMap.set(entry.ledgerAccountId, nextScaled);

    await conn.query(
      `INSERT INTO ledger_entries
        (ledger_transaction_id, ledger_account_id, entry_type, amount, currency, balance_after, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ledgerTransactionId,
        entry.ledgerAccountId,
        entry.entryType,
        formatScaledToDecimal(amtScaled),
        entry.currency,
        formatScaledToDecimal(nextScaled),
        entry.memo ? entry.memo.slice(0, 255) : null,
      ]
    );
  }

  // 6. Update authoritative ledger_accounts balances
  for (const [accId, finalScaled] of runningBalanceMap.entries()) {
    await conn.query(`UPDATE ledger_accounts SET balance = ? WHERE id = ?`, [
      formatScaledToDecimal(finalScaled),
      accId,
    ]);
  }

  // 7. Synchronize derived currency_accounts balances strictly from locked ledger_accounts
  await syncCurrencyAccountsFromLedger(conn, uniqueAccountIds);

  return {
    transactionId: ledgerTransactionId,
    reference,
    idempotentReplay: false,
  };
}

export async function syncCurrencyAccountsFromLedger(
  conn: PoolConnection,
  ledgerAccountIds: number[]
): Promise<void> {
  if (ledgerAccountIds.length === 0) return;
  const placeholders = ledgerAccountIds.map(() => '?').join(',');

  const [wallets]: any = await conn.query(
    `SELECT ca.id, la.balance AS avail_bal, lp.balance AS pend_bal
     FROM currency_accounts ca
     JOIN ledger_accounts la ON la.id = ca.available_ledger_account_id
     JOIN ledger_accounts lp ON lp.id = ca.pending_ledger_account_id
     WHERE ca.available_ledger_account_id IN (${placeholders})
        OR ca.pending_ledger_account_id IN (${placeholders})
     FOR UPDATE`,
    [...ledgerAccountIds, ...ledgerAccountIds]
  );

  for (const wallet of wallets) {
    const avail = parseDecimalToScaled(wallet.avail_bal);
    const pend = parseDecimalToScaled(wallet.pend_bal);
    const ledgerTotal = avail + pend;
    await conn.query(
      `UPDATE currency_accounts
       SET available_balance = ?, pending_balance = ?, ledger_balance = ?
       WHERE id = ?`,
      [
        formatScaledToDecimal(avail),
        formatScaledToDecimal(pend),
        formatScaledToDecimal(ledgerTotal),
        wallet.id,
      ]
    );
  }
}

export async function reverseLedgerTransaction(
  conn: PoolConnection,
  params: {
    originalTransactionId: number;
    idempotencyKey: string;
    adminUserId: number;
    reason: string;
  }
): Promise<{ reversalTransactionId: number; reference: string }> {
  const [txRows]: any = await conn.query(
    `SELECT id, reference, status, currency, total_amount, fee_amount, initiated_by_user_id
     FROM ledger_transactions WHERE id = ? FOR UPDATE`,
    [params.originalTransactionId]
  );

  if (txRows.length === 0) {
    throw new LedgerError('Original ledger transaction not found', 404, 'TX_NOT_FOUND');
  }
  const orig = txRows[0];
  if (orig.status === 'REVERSED') {
    throw new LedgerError('Transaction has already been reversed', 409, 'ALREADY_REVERSED');
  }
  if (orig.status !== 'SUCCESSFUL') {
    throw new LedgerError('Only SUCCESSFUL transactions can be reversed via compensating entries', 400, 'INVALID_REVERSAL_STATE');
  }

  const [entries]: any = await conn.query(
    `SELECT ledger_account_id, entry_type, amount, currency, memo
     FROM ledger_entries WHERE ledger_transaction_id = ? ORDER BY id ASC`,
    [orig.id]
  );

  const compensatingEntries: LedgerEntryInput[] = entries.map((e: any) => ({
    ledgerAccountId: Number(e.ledger_account_id),
    entryType: e.entry_type === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    amount: String(e.amount),
    currency: e.currency,
    memo: `Reversal of ${orig.reference}: ${params.reason}`.slice(0, 255),
  }));

  const reversal = await postLedgerTransaction(conn, {
    reference: generateReference('REV'),
    idempotencyKey: params.idempotencyKey,
    transactionType: 'REVERSAL',
    status: 'SUCCESSFUL',
    currency: orig.currency,
    totalAmount: String(orig.total_amount),
    feeAmount: '0.0000',
    description: `Reversal of ${orig.reference}: ${params.reason}`,
    initiatedByUserId: orig.initiated_by_user_id ? Number(orig.initiated_by_user_id) : null,
    reversedTransactionId: Number(orig.id),
    metadata: { adminUserId: params.adminUserId, reason: params.reason },
    entries: compensatingEntries,
  });

  await conn.query(`UPDATE ledger_transactions SET status = 'REVERSED' WHERE id = ?`, [orig.id]);
  await conn.query(`UPDATE transfers SET status = 'REVERSED' WHERE ledger_transaction_id = ?`, [orig.id]);

  return {
    reversalTransactionId: reversal.transactionId,
    reference: reversal.reference,
  };
}

export async function getSystemLedgerAccount(
  conn: PoolConnection,
  code: string
): Promise<number> {
  const [rows]: any = await conn.query(`SELECT id FROM ledger_accounts WHERE code = ? LIMIT 1`, [code]);
  if (rows.length === 0) {
    throw new LedgerError(`System ledger account ${code} not initialized. Run migrations.`, 500, 'SYSTEM_LEDGER_MISSING');
  }
  return Number(rows[0].id);
}
