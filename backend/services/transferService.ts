import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getPool, withTransaction } from '../config/database.js';
import {
  applyExchangeRate,
  assertPositiveScaled,
  calculateFeeScaled,
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

export interface CreateTransferInput {
  senderUserId: number;
  sourceCurrencyAccountId: number;
  transferType: 'INTERNAL' | 'DOMESTIC' | 'INTERNATIONAL' | 'BENEFICIARY';
  recipientName: string;
  recipientAccountNumber: string;
  recipientBank: string;
  recipientCountry: string;
  recipientCurrency: string;
  amount: string;
  description: string;
  idempotencyKey: string;
  transactionPin?: string;
}

async function computeTransactionFee(
  conn: PoolConnection,
  txType: 'INTERNAL_TRANSFER' | 'DOMESTIC_TRANSFER' | 'INTERNATIONAL_TRANSFER' | 'FX_CONVERSION' | 'WITHDRAWAL' | 'DEPOSIT',
  currency: string,
  amountScaled: bigint
): Promise<bigint> {
  const [feeRows]: any = await conn.query(
    `SELECT flat_fee, percent_fee, min_fee, max_fee
     FROM transaction_fees
     WHERE transaction_type = ? AND currency = ? AND is_active = 1
     LIMIT 1`,
    [txType, currency]
  );

  if (feeRows.length === 0) {
    // Fallback to USD rule if currency-specific rule is not explicitly customized
    const [usdRows]: any = await conn.query(
      `SELECT flat_fee, percent_fee, min_fee, max_fee
       FROM transaction_fees
       WHERE transaction_type = ? AND currency = 'USD' AND is_active = 1
       LIMIT 1`,
      [txType]
    );
    if (usdRows.length === 0) return 0n;
    const f = usdRows[0];
    return calculateFeeScaled(amountScaled, f.flat_fee, f.percent_fee, f.min_fee, f.max_fee);
  }

  const f = feeRows[0];
  return calculateFeeScaled(amountScaled, f.flat_fee, f.percent_fee, f.min_fee, f.max_fee);
}

export async function executeTransfer(input: CreateTransferInput) {
  const amountScaled = parseDecimalToScaled(input.amount);
  assertPositiveScaled(amountScaled, 'Transfer amount');

  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 8) {
    throw new LedgerError('A valid idempotencyKey is required.', 400, 'IDEMPOTENCY_REQUIRED');
  }

  return await withTransaction(async (conn) => {
    // 1. Idempotency check on transfers table
    const [existingTransfers]: any = await conn.query(
      `SELECT id, uuid, reference, status, amount, fee_amount, currency, recipient_name, recipient_account_number, recipient_bank, description, ledger_transaction_id, created_at
       FROM transfers WHERE idempotency_key = ? LIMIT 1`,
      [input.idempotencyKey]
    );
    if (existingTransfers.length > 0) {
      return { idempotentReplay: true, transfer: existingTransfers[0] };
    }

    // 2. Verify sender account status, KYC, and PIN if configured
    const [userRows]: any = await conn.query(
      `SELECT id, email, status, kyc_status, transaction_pin_hash FROM users WHERE id = ? FOR UPDATE`,
      [input.senderUserId]
    );
    if (userRows.length === 0) throw new LedgerError('User not found', 404);
    const senderUser = userRows[0];

    if (senderUser.status !== 'ACTIVE') {
      throw new LedgerError('Account is restricted or suspended from initiating transfers.', 403, 'ACCOUNT_RESTRICTED');
    }

    if (senderUser.transaction_pin_hash) {
      if (!input.transactionPin) {
        throw new LedgerError('Transaction PIN is required to authorize transfers.', 403, 'PIN_REQUIRED');
      }
      const pinValid = await bcrypt.compare(input.transactionPin, senderUser.transaction_pin_hash);
      if (!pinValid) {
        throw new LedgerError('Invalid transaction PIN.', 403, 'INVALID_PIN');
      }
    }

    // 3. Load and lock sender currency wallet + bank account limit
    const [senderWallets]: any = await conn.query(
      `SELECT ca.*, ba.daily_transfer_limit, ba.status AS bank_status, ba.account_number AS sender_account_number
       FROM currency_accounts ca
       JOIN bank_accounts ba ON ba.id = ca.bank_account_id
       WHERE ca.id = ? AND ca.user_id = ?
       FOR UPDATE`,
      [input.sourceCurrencyAccountId, input.senderUserId]
    );
    if (senderWallets.length === 0) {
      throw new LedgerError('Source currency wallet not found.', 404, 'WALLET_NOT_FOUND');
    }
    const senderWallet = senderWallets[0];
    if (senderWallet.status !== 'ACTIVE' || senderWallet.bank_status !== 'ACTIVE') {
      throw new LedgerError('Source account is currently frozen or closed.', 403, 'WALLET_FROZEN');
    }

    // 4. Enforce daily transfer limit
    const [dailyRows]: any = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS today_total
       FROM transfers
       WHERE sender_user_id = ? AND currency = ? AND status IN ('PENDING', 'PROCESSING', 'SUCCESSFUL')
         AND created_at >= UTC_DATE()`,
      [input.senderUserId, senderWallet.currency]
    );
    const todayTotal = parseDecimalToScaled(dailyRows[0].today_total || '0');
    const dailyLimit = parseDecimalToScaled(senderWallet.daily_transfer_limit);
    if (todayTotal + amountScaled > dailyLimit) {
      throw new LedgerError(
        `Transfer exceeds daily limit of ${formatScaledToDecimal(dailyLimit)} ${senderWallet.currency}.`,
        400,
        'DAILY_LIMIT_EXCEEDED'
      );
    }

    // 5. Determine whether this is INTERNAL or EXTERNAL
    let isInternal = input.transferType === 'INTERNAL';
    let recipientWallet: any = null;

    if (isInternal || input.transferType === 'BENEFICIARY') {
      const cleanAcct = input.recipientAccountNumber.trim().toUpperCase();
      const [recipAccounts]: any = await conn.query(
        `SELECT ca.*, u.status AS recip_user_status, u.email AS recip_email
         FROM bank_accounts ba
         JOIN currency_accounts ca ON ca.bank_account_id = ba.id AND ca.currency = ?
         JOIN users u ON u.id = ba.user_id
         WHERE UPPER(ba.account_number) = ? OR UPPER(ba.iban) = ?
         LIMIT 1`,
        [senderWallet.currency, cleanAcct, cleanAcct]
      );

      if (recipAccounts.length > 0) {
        isInternal = true;
        recipientWallet = recipAccounts[0];
      } else if (input.transferType === 'INTERNAL') {
        throw new LedgerError(
          'Recipient platform account number not found for this currency.',
          404,
          'RECIPIENT_NOT_FOUND'
        );
      }
    }

    if (isInternal && recipientWallet) {
      if (Number(recipientWallet.id) === Number(senderWallet.id)) {
        throw new LedgerError('Cannot transfer funds to the same wallet.', 400, 'SAME_WALLET');
      }
      if (recipientWallet.recip_user_status !== 'ACTIVE' || recipientWallet.status !== 'ACTIVE') {
        throw new LedgerError('Recipient account cannot receive funds at this time.', 400, 'RECIPIENT_UNAVAILABLE');
      }

      const feeScaled = await computeTransactionFee(conn, 'INTERNAL_TRANSFER', senderWallet.currency, amountScaled);
      const totalDebitScaled = amountScaled + feeScaled;
      const reference = generateReference('TRF');

      const entries = [
        {
          ledgerAccountId: Number(senderWallet.available_ledger_account_id),
          entryType: 'DEBIT' as const,
          amount: formatScaledToDecimal(totalDebitScaled),
          currency: senderWallet.currency,
          memo: `Internal transfer to ${input.recipientAccountNumber}`,
        },
        {
          ledgerAccountId: Number(recipientWallet.available_ledger_account_id),
          entryType: 'CREDIT' as const,
          amount: formatScaledToDecimal(amountScaled),
          currency: senderWallet.currency,
          memo: `Internal transfer from ${senderWallet.sender_account_number}`,
        },
      ];

      if (feeScaled > 0n) {
        const feeRevAccId = await getSystemLedgerAccount(conn, `SYS_FEE_REV_${senderWallet.currency}`);
        entries.push({
          ledgerAccountId: feeRevAccId,
          entryType: 'CREDIT' as const,
          amount: formatScaledToDecimal(feeScaled),
          currency: senderWallet.currency,
          memo: `Transfer fee (${reference})`,
        });
      }

      const ledgerResult = await postLedgerTransaction(conn, {
        reference,
        idempotencyKey: `ltx_${input.idempotencyKey}`,
        transactionType: 'INTERNAL_TRANSFER',
        status: 'SUCCESSFUL',
        currency: senderWallet.currency,
        totalAmount: formatScaledToDecimal(amountScaled),
        feeAmount: formatScaledToDecimal(feeScaled),
        description: input.description || `Transfer to ${input.recipientName}`,
        initiatedByUserId: input.senderUserId,
        entries,
      });

      const transferUuid = crypto.randomUUID();
      await conn.query(
        `INSERT INTO transfers
          (uuid, reference, idempotency_key, sender_user_id, sender_currency_account_id, recipient_user_id, recipient_currency_account_id, transfer_type, recipient_name, recipient_account_number, recipient_bank, recipient_country, recipient_currency, amount, fee_amount, currency, description, status, ledger_transaction_id, partner_provider)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'INTERNAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESSFUL', ?, 'internal_ledger')`,
        [
          transferUuid,
          reference,
          input.idempotencyKey,
          input.senderUserId,
          senderWallet.id,
          recipientWallet.user_id,
          recipientWallet.id,
          input.recipientName,
          input.recipientAccountNumber,
          input.recipientBank,
          input.recipientCountry.toUpperCase(),
          senderWallet.currency,
          formatScaledToDecimal(amountScaled),
          formatScaledToDecimal(feeScaled),
          senderWallet.currency,
          input.description,
          ledgerResult.transactionId,
        ]
      );

      await createNotification(
        {
          userId: input.senderUserId,
          category: 'TRANSFER',
          title: 'Internal transfer completed',
          message: `Sent ${formatScaledToDecimal(amountScaled)} ${senderWallet.currency} to ${input.recipientName} (Ref: ${reference}).`,
          emailTo: senderUser.email,
          sendEmail: true,
        },
        conn
      );

      await createNotification(
        {
          userId: Number(recipientWallet.user_id),
          category: 'TRANSFER',
          title: 'Funds received',
          message: `Received ${formatScaledToDecimal(amountScaled)} ${senderWallet.currency} (Ref: ${reference}).`,
          emailTo: recipientWallet.recip_email,
          sendEmail: true,
        },
        conn
      );

      const [saved]: any = await conn.query(`SELECT * FROM transfers WHERE reference = ? LIMIT 1`, [reference]);
      return { idempotentReplay: false, transfer: saved[0] };
    }

    // 6. External Domestic / International Transfer
    // Enforce KYC check before external payout dispatch
    const [kycSetting]: any = await conn.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'kyc_required_for_external_transfers' LIMIT 1`
    );
    const kycRequired = kycSetting.length === 0 || kycSetting[0].setting_value !== 'false';
    if (kycRequired && senderUser.kyc_status !== 'APPROVED') {
      throw new LedgerError(
        'Approved KYC identity verification is required before initiating external bank transfers.',
        403,
        'KYC_REQUIRED'
      );
    }

    const partnerStatus = providers.bankingPartner.getStatus();
    if (!partnerStatus.available) {
      throw new LedgerError(
        'External domestic and international transfer rails require a configured, licensed banking partner (BANKING_PARTNER_PROVIDER and BANKING_PARTNER_API_KEY). Internal customer-to-customer transfers remain active.',
        503,
        'EXTERNAL_RAIL_UNAVAILABLE'
      );
    }

    const mappedType = input.transferType === 'DOMESTIC' ? 'DOMESTIC_TRANSFER' : 'INTERNATIONAL_TRANSFER';
    const feeScaled = await computeTransactionFee(conn, mappedType, senderWallet.currency, amountScaled);
    const totalHoldScaled = amountScaled + feeScaled;
    const reference = generateReference('EXT');

    // Reserve funds from Available -> Pending ledger account until external partner confirms settlement via webhook
    const holdTx = await postLedgerTransaction(conn, {
      reference,
      idempotencyKey: `ltx_${input.idempotencyKey}`,
      transactionType: mappedType,
      status: 'PROCESSING',
      currency: senderWallet.currency,
      totalAmount: formatScaledToDecimal(amountScaled),
      feeAmount: formatScaledToDecimal(feeScaled),
      description: input.description || `External ${input.transferType} transfer to ${input.recipientName}`,
      initiatedByUserId: input.senderUserId,
      entries: [
        {
          ledgerAccountId: Number(senderWallet.available_ledger_account_id),
          entryType: 'DEBIT',
          amount: formatScaledToDecimal(totalHoldScaled),
          currency: senderWallet.currency,
          memo: `Hold for external transfer ${reference}`,
        },
        {
          ledgerAccountId: Number(senderWallet.pending_ledger_account_id),
          entryType: 'CREDIT',
          amount: formatScaledToDecimal(totalHoldScaled),
          currency: senderWallet.currency,
          memo: `Pending external settlement ${reference}`,
        },
      ],
    });

    const dispatchResult = await providers.bankingPartner.dispatchTransfer({
      reference,
      transferType: input.transferType === 'DOMESTIC' ? 'DOMESTIC' : 'INTERNATIONAL',
      amount: formatScaledToDecimal(amountScaled),
      currency: senderWallet.currency,
      recipientName: input.recipientName,
      recipientAccountNumber: input.recipientAccountNumber,
      recipientBank: input.recipientBank,
      recipientCountry: input.recipientCountry,
      recipientCurrency: input.recipientCurrency,
      description: input.description,
    });

    await conn.query(
      `INSERT INTO transfers
        (uuid, reference, idempotency_key, sender_user_id, sender_currency_account_id, transfer_type, recipient_name, recipient_account_number, recipient_bank, recipient_country, recipient_currency, amount, fee_amount, currency, description, status, ledger_transaction_id, partner_provider, partner_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, ?)`,
      [
        crypto.randomUUID(),
        reference,
        input.idempotencyKey,
        input.senderUserId,
        senderWallet.id,
        input.transferType === 'DOMESTIC' ? 'DOMESTIC' : 'INTERNATIONAL',
        input.recipientName,
        input.recipientAccountNumber,
        input.recipientBank,
        input.recipientCountry.toUpperCase(),
        input.recipientCurrency.toUpperCase(),
        formatScaledToDecimal(amountScaled),
        formatScaledToDecimal(feeScaled),
        senderWallet.currency,
        input.description,
        holdTx.transactionId,
        dispatchResult.providerName,
        dispatchResult.providerReference || null,
      ]
    );

    const [saved]: any = await conn.query(`SELECT * FROM transfers WHERE reference = ? LIMIT 1`, [reference]);
    return { idempotentReplay: false, transfer: saved[0] };
  });
}

export async function executeFxConversion(input: {
  userId: number;
  sourceWalletId: number;
  targetWalletId: number;
  sourceAmount: string;
  idempotencyKey: string;
}) {
  const sourceScaled = parseDecimalToScaled(input.sourceAmount);
  assertPositiveScaled(sourceScaled, 'Conversion amount');

  const fxStatus = providers.fxRates.getStatus();
  if (!fxStatus.available) {
    throw new LedgerError(
      'Live currency conversion is disabled because no authorized FX rate provider (FX_PROVIDER and FX_API_KEY) is configured.',
      503,
      'FX_PROVIDER_UNAVAILABLE'
    );
  }

  return await withTransaction(async (conn) => {
    const [existingFx]: any = await conn.query(
      `SELECT * FROM fx_conversions WHERE idempotency_key = ? LIMIT 1`,
      [input.idempotencyKey]
    );
    if (existingFx.length > 0) {
      return { idempotentReplay: true, conversion: existingFx[0] };
    }

    const [wallets]: any = await conn.query(
      `SELECT ca.*, c.minor_units
       FROM currency_accounts ca
       JOIN currencies c ON c.code = ca.currency
       WHERE ca.id IN (?, ?) AND ca.user_id = ?
       FOR UPDATE`,
      [input.sourceWalletId, input.targetWalletId, input.userId]
    );

    const srcWallet = wallets.find((w: any) => Number(w.id) === Number(input.sourceWalletId));
    const dstWallet = wallets.find((w: any) => Number(w.id) === Number(input.targetWalletId));

    if (!srcWallet || !dstWallet) {
      throw new LedgerError('Source or target currency wallet not found.', 404);
    }
    if (srcWallet.currency === dstWallet.currency) {
      throw new LedgerError('Source and target currencies must be different.', 400);
    }

    const quote = await providers.fxRates.getRate(srcWallet.currency, dstWallet.currency);
    if (!quote || !quote.isLive) {
      throw new LedgerError(
        `No authorized live exchange rate available for ${srcWallet.currency}/${dstWallet.currency}.`,
        503,
        'FX_RATE_UNAVAILABLE'
      );
    }

    const feeScaled = await computeTransactionFee(conn, 'FX_CONVERSION', srcWallet.currency, sourceScaled);
    const totalSourceDebit = sourceScaled + feeScaled;
    const targetScaled = applyExchangeRate(sourceScaled, quote.rate, Number(dstWallet.minor_units));
    assertPositiveScaled(targetScaled, 'Converted target amount');

    const srcClearingId = await getSystemLedgerAccount(conn, `SYS_CLEARING_${srcWallet.currency}`);
    const dstClearingId = await getSystemLedgerAccount(conn, `SYS_CLEARING_${dstWallet.currency}`);
    const feeRevId = await getSystemLedgerAccount(conn, `SYS_FEE_REV_${srcWallet.currency}`);

    const reference = generateReference('FXC');
    const entries = [
      {
        ledgerAccountId: Number(srcWallet.available_ledger_account_id),
        entryType: 'DEBIT' as const,
        amount: formatScaledToDecimal(totalSourceDebit),
        currency: srcWallet.currency,
        memo: `FX conversion sell ${srcWallet.currency}`,
      },
      {
        ledgerAccountId: srcClearingId,
        entryType: 'DEBIT' as const,
        amount: formatScaledToDecimal(sourceScaled),
        currency: srcWallet.currency,
        memo: `FX clearing inflow ${srcWallet.currency}`,
      },
      {
        ledgerAccountId: dstClearingId,
        entryType: 'CREDIT' as const,
        amount: formatScaledToDecimal(targetScaled),
        currency: dstWallet.currency,
        memo: `FX clearing outflow ${dstWallet.currency}`,
      },
      {
        ledgerAccountId: Number(dstWallet.available_ledger_account_id),
        entryType: 'CREDIT' as const,
        amount: formatScaledToDecimal(targetScaled),
        currency: dstWallet.currency,
        memo: `FX conversion buy ${dstWallet.currency}`,
      },
    ];

    if (feeScaled > 0n) {
      entries.push({
        ledgerAccountId: feeRevId,
        entryType: 'CREDIT' as const,
        amount: formatScaledToDecimal(feeScaled),
        currency: srcWallet.currency,
        memo: `FX conversion fee (${reference})`,
      });
    }

    const ltx = await postLedgerTransaction(conn, {
      reference,
      idempotencyKey: `ltx_${input.idempotencyKey}`,
      transactionType: 'FX_CONVERSION',
      status: 'SUCCESSFUL',
      currency: srcWallet.currency,
      totalAmount: formatScaledToDecimal(sourceScaled),
      feeAmount: formatScaledToDecimal(feeScaled),
      description: `Convert ${formatScaledToDecimal(sourceScaled)} ${srcWallet.currency} to ${formatScaledToDecimal(targetScaled)} ${dstWallet.currency}`,
      initiatedByUserId: input.userId,
      entries,
    });

    await conn.query(
      `INSERT INTO fx_conversions
        (uuid, reference, idempotency_key, user_id, source_currency_account_id, target_currency_account_id, source_currency, target_currency, source_amount, target_amount, fee_amount, exchange_rate, rate_source, ledger_transaction_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESSFUL')`,
      [
        crypto.randomUUID(),
        reference,
        input.idempotencyKey,
        input.userId,
        srcWallet.id,
        dstWallet.id,
        srcWallet.currency,
        dstWallet.currency,
        formatScaledToDecimal(sourceScaled),
        formatScaledToDecimal(targetScaled),
        formatScaledToDecimal(feeScaled),
        quote.rate,
        quote.sourceProvider,
        ltx.transactionId,
      ]
    );

    const [saved]: any = await conn.query(`SELECT * FROM fx_conversions WHERE reference = ? LIMIT 1`, [reference]);
    return { idempotentReplay: false, conversion: saved[0] };
  });
}
