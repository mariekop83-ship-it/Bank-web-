import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';
import { getDecryptedKycDocument, uploadEncryptedKycDocument } from '../services/kycService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, or PDF identity documents are permitted.'));
    }
  },
});

export const kycRouter = Router();
kycRouter.use(requireCustomerAuth);

kycRouter.get('/status', async (req, res, next) => {
  try {
    const pool = getPool();
    const [users]: any = await pool.query(`SELECT kyc_status FROM users WHERE id = ? LIMIT 1`, [
      req.customer!.id,
    ]);
    const [docs]: any = await pool.query(
      `SELECT id, uuid, document_type, issuing_country, expiry_date, original_filename, mime_type,
              file_size_bytes, review_status, reviewer_notes, reviewed_at, created_at
       FROM kyc_documents WHERE user_id = ? ORDER BY created_at DESC`,
      [req.customer!.id]
    );
    res.json({
      kycStatus: users[0]?.kyc_status || 'NOT_STARTED',
      documents: docs,
    });
  } catch (err) {
    next(err);
  }
});

kycRouter.post('/documents', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Identity document file is required.' });
      return;
    }

    const meta = z
      .object({
        documentType: z.enum(['GOVERNMENT_ID', 'PASSPORT', 'PROOF_OF_ADDRESS', 'ADDITIONAL_DOCUMENT']),
        documentNumber: z.string().max(80).optional(),
        issuingCountry: z.string().length(2).optional(),
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.body);

    const saved = await uploadEncryptedKycDocument({
      userId: req.customer!.id,
      documentType: meta.documentType,
      documentNumber: meta.documentNumber,
      issuingCountry: meta.issuingCountry,
      expiryDate: meta.expiryDate,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileBuffer: req.file.buffer,
      ipAddress: req.ip,
    });

    res.status(201).json({ document: saved });
  } catch (err) {
    next(err);
  }
});

kycRouter.post('/submit', async (req, res, next) => {
  try {
    const pool = getPool();
    const [docs]: any = await pool.query(`SELECT id FROM kyc_documents WHERE user_id = ?`, [
      req.customer!.id,
    ]);
    if (docs.length === 0) {
      res.status(400).json({ error: 'Upload at least one identity or address document before submitting for review.' });
      return;
    }
    await pool.query(
      `UPDATE users SET kyc_status = 'PENDING' WHERE id = ? AND kyc_status IN ('NOT_STARTED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED')`,
      [req.customer!.id]
    );
    res.json({
      kycStatus: 'PENDING',
      message: 'Verification package submitted for Compliance Officer review.',
    });
  } catch (err) {
    next(err);
  }
});

kycRouter.get('/documents/:uuid', async (req, res, next) => {
  try {
    const file = await getDecryptedKycDocument({
      documentUuid: req.params.uuid,
      actorType: 'CUSTOMER',
      actorId: req.customer!.id,
      ipAddress: req.ip,
    });
    if (!file) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  } catch (err: any) {
    if (err?.message === 'FORBIDDEN_DOCUMENT_ACCESS') {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    next(err);
  }
});
