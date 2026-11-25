import { Router } from 'express';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';

export const transactionsRouter = Router();
transactionsRouter.use(requireCustomerAuth);

transactionsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const userId = req.customer!.id;
    const search = String(req.query.search || '').trim();
    const type = String(req.query.type || '').trim();
    const status = String(req.query.status || '').trim();
    const currency = String(req.query.currency || '').trim().toUpperCase();
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = ['(lt.initiated_by_user_id = ? OR la.owner_user_id = ?)'];
    const params: any[] = [userId, userId];

    if (search) {
      whereClauses.push('(lt.reference LIKE ? OR lt.description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (type) {
      whereClauses.push('lt.transaction_type = ?');
      params.push(type);
    }
    if (status) {
      whereClauses.push('lt.status = ?');
      params.push(status);
    }
    if (currency) {
      whereClauses.push('lt.currency = ?');
      params.push(currency);
    }
    if (fromDate) {
      whereClauses.push('lt.posted_at >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      whereClauses.push('lt.posted_at <= ?');
      params.push(`${toDate} 23:59:59`);
    }

    const whereSql = whereClauses.join(' AND ');

    const [countRows]: any = await pool.query(
      `SELECT COUNT(DISTINCT lt.id) AS total
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE ${whereSql}`,
      params
    );

    const [rows]: any = await pool.query(
      `SELECT DISTINCT lt.id, lt.uuid, lt.reference, lt.transaction_type, lt.status, lt.currency,
              lt.total_amount, lt.fee_amount, lt.description, lt.posted_at,
              t.recipient_name, t.recipient_account_number, t.recipient_bank
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       LEFT JOIN transfers t ON t.ledger_transaction_id = lt.id
       WHERE ${whereSql}
       ORDER BY lt.posted_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      transactions: rows,
      pagination: {
        page,
        limit,
        total: Number(countRows[0].total || 0),
        totalPages: Math.max(1, Math.ceil(Number(countRows[0].total || 0) / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.get('/export/csv', async (req, res, next) => {
  try {
    const pool = getPool();
    const userId = req.customer!.id;
    const [rows]: any = await pool.query(
      `SELECT DISTINCT lt.reference, lt.transaction_type, lt.status, lt.currency, lt.total_amount, lt.fee_amount, lt.description, lt.posted_at
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE lt.initiated_by_user_id = ? OR la.owner_user_id = ?
       ORDER BY lt.posted_at DESC LIMIT 1000`,
      [userId, userId]
    );

    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = ['Reference', 'Type', 'Status', 'Currency', 'Amount', 'Fee', 'Description', 'Posted At (UTC)'].join(',');
    const lines = rows.map((r: any) =>
      [
        escapeCsv(r.reference),
        escapeCsv(r.transaction_type),
        escapeCsv(r.status),
        escapeCsv(r.currency),
        escapeCsv(r.total_amount),
        escapeCsv(r.fee_amount),
        escapeCsv(r.description),
        escapeCsv(new Date(r.posted_at).toISOString()),
      ].join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="meridian-statement.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (err) {
    next(err);
  }
});

transactionsRouter.get('/:id', async (req, res, next) => {
  try {
    const pool = getPool();
    const userId = req.customer!.id;
    const [txRows]: any = await pool.query(
      `SELECT DISTINCT lt.*
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE (lt.id = ? OR lt.uuid = ? OR lt.reference = ?)
         AND (lt.initiated_by_user_id = ? OR la.owner_user_id = ?)
       LIMIT 1`,
      [req.params.id, req.params.id, req.params.id, userId, userId]
    );
    if (txRows.length === 0) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }

    const tx = txRows[0];
    const [entries]: any = await pool.query(
      `SELECT le.id, le.entry_type, le.amount, le.currency, le.balance_after, le.memo, la.code, la.name
       FROM ledger_entries le
       JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE le.ledger_transaction_id = ? AND la.owner_user_id = ?
       ORDER BY le.id ASC`,
      [tx.id, userId]
    );

    res.json({ transaction: tx, entries });
  } catch (err) {
    next(err);
  }
});
