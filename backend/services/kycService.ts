import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPool, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { decryptBuffer, encryptBuffer, encryptText } from '../utils/crypto.js';
import { createNotification, logSecurityEvent } from './notificationService.js';

export type KycDocumentType =
  | 'GOVERNMENT_ID'
  | 'PASSPORT'
  | 'PROOF_OF_ADDRESS'
  | 'ADDITIONAL_DOCUMENT';

export type KycReviewStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADDITIONAL_INFO_REQUIRED';

export async function uploadEncryptedKycDocument(params: {
  userId: number;
  documentType: KycDocumentType;
  documentNumber?: string;
  issuingCountry?: string;
  expiryDate?: string;
  originalFilename: string;
  mimeType: string;
  fileBuffer: Buffer;
  ipAddress?: string;
}) {
  const { encrypted, ivHex, tagHex } = encryptBuffer(params.fileBuffer);
  const docUuid = crypto.randomUUID();
  const storageKey = `kyc/${params.userId}/${docUuid}.enc`;
  const docNumberEnc = params.documentNumber ? encryptText(params.documentNumber.trim()) : null;

  let storageProvider = 'encrypted_db';
  let payloadToStore: Buffer | null = encrypted;

  if (env.privateStorageDir) {
    const baseDir = path.resolve(env.privateStorageDir);
    const targetPath = path.resolve(baseDir, `${docUuid}.enc`);
    if (!targetPath.startsWith(baseDir + path.sep)) {
      throw new Error('Invalid private storage path');
    }
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(targetPath, encrypted, { mode: 0o600 });
    storageProvider = 'private_filesystem_encrypted';
    payloadToStore = null;
  }

  return await withTransaction(async (conn) => {
    const [res]: any = await conn.query(
      `INSERT INTO kyc_documents
        (uuid, user_id, document_type, document_number_enc, issuing_country, expiry_date, original_filename, mime_type, file_size_bytes, storage_provider, storage_key, encrypted_payload, encryption_iv, encryption_tag, review_status, retention_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', DATE_ADD(UTC_DATE(), INTERVAL 5 YEAR))`,
      [
        docUuid,
        params.userId,
        params.documentType,
        docNumberEnc,
        params.issuingCountry ? params.issuingCountry.toUpperCase() : null,
        params.expiryDate || null,
        path.basename(params.originalFilename).slice(0, 255),
        params.mimeType.slice(0, 120),
        params.fileBuffer.length,
        storageProvider,
        storageKey,
        payloadToStore,
        ivHex,
        tagHex,
      ]
    );

    // Move customer KYC status to PENDING if NOT_STARTED or REJECTED/ADDITIONAL_INFO_REQUIRED
    await conn.query(
      `UPDATE users SET kyc_status = 'PENDING' WHERE id = ? AND kyc_status IN ('NOT_STARTED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED')`,
      [params.userId]
    );

    await logSecurityEvent(
      {
        actorType: 'CUSTOMER',
        actorId: params.userId,
        eventType: 'KYC_DOCUMENT_UPLOADED',
        severity: 'INFO',
        ipAddress: params.ipAddress,
        metadata: { documentType: params.documentType, documentUuid: docUuid },
      },
      conn
    );

    return {
      id: Number(res.insertId),
      uuid: docUuid,
      documentType: params.documentType,
      reviewStatus: 'PENDING',
    };
  });
}

export async function getDecryptedKycDocument(params: {
  documentUuid: string;
  actorType: 'CUSTOMER' | 'ADMIN';
  actorId: number;
  ipAddress?: string;
}) {
  const pool = getPool();
  const [rows]: any = await pool.query(`SELECT * FROM kyc_documents WHERE uuid = ? LIMIT 1`, [
    params.documentUuid,
  ]);
  if (rows.length === 0) {
    return null;
  }
  const doc = rows[0];
  if (params.actorType === 'CUSTOMER' && Number(doc.user_id) !== params.actorId) {
    throw new Error('FORBIDDEN_DOCUMENT_ACCESS');
  }

  let encryptedBuf: Buffer;
  if (doc.storage_provider === 'private_filesystem_encrypted' && env.privateStorageDir) {
    const baseDir = path.resolve(env.privateStorageDir);
    const targetPath = path.resolve(baseDir, `${doc.uuid}.enc`);
    if (!targetPath.startsWith(baseDir + path.sep)) {
      throw new Error('Invalid storage path');
    }
    encryptedBuf = fs.readFileSync(targetPath);
  } else {
    encryptedBuf = Buffer.isBuffer(doc.encrypted_payload)
      ? doc.encrypted_payload
      : Buffer.from(doc.encrypted_payload);
  }

  const decrypted = decryptBuffer(encryptedBuf, doc.encryption_iv, doc.encryption_tag);

  await logSecurityEvent({
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: 'KYC_DOCUMENT_ACCESSED',
    severity: 'INFO',
    ipAddress: params.ipAddress,
    metadata: { documentUuid: doc.uuid, ownerUserId: doc.user_id },
  });

  return {
    filename: doc.original_filename,
    mimeType: doc.mime_type,
    buffer: decrypted,
  };
}

export async function reviewCustomerKyc(params: {
  userId: number;
  adminUserId: number;
  decision: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'ADDITIONAL_INFO_REQUIRED';
  notes: string;
  ipAddress?: string;
}) {
  return await withTransaction(async (conn) => {
    const [users]: any = await conn.query(`SELECT id, email, kyc_status FROM users WHERE id = ? FOR UPDATE`, [
      params.userId,
    ]);
    if (users.length === 0) throw new Error('Customer not found');

    await conn.query(`UPDATE users SET kyc_status = ? WHERE id = ?`, [params.decision, params.userId]);
    await conn.query(
      `UPDATE kyc_documents
       SET review_status = ?, reviewer_notes = ?, reviewed_by_admin_id = ?, reviewed_at = UTC_TIMESTAMP(3)
       WHERE user_id = ? AND review_status IN ('PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED')`,
      [params.decision, params.notes, params.adminUserId, params.userId]
    );

    await conn.query(
      `INSERT INTO admin_audit_logs (uuid, admin_user_id, action, target_type, target_id, reason, details_json, ip_address)
       VALUES (?, ?, 'KYC_REVIEW', 'users', ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        params.adminUserId,
        String(params.userId),
        params.notes,
        JSON.stringify({ previousStatus: users[0].kyc_status, newStatus: params.decision }),
        params.ipAddress || null,
      ]
    );

    await createNotification(
      {
        userId: params.userId,
        category: 'KYC',
        title: `Identity verification status: ${params.decision.replace(/_/g, ' ')}`,
        message: params.notes || `Your verification status was updated to ${params.decision}.`,
        emailTo: users[0].email,
        sendEmail: true,
      },
      conn
    );

    return { userId: params.userId, kycStatus: params.decision };
  });
}
