import { Router } from 'express';
import { getPool } from '../config/database.js';
import { requireCustomerAuth } from '../middleware/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireCustomerAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows]: any = await pool.query(
      `SELECT id, uuid, category, title, message, is_read, read_at, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.customer!.id]
    );
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.put('/read-all', async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND is_read = 0`,
      [req.customer!.id]
    );
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.put('/:id/read', async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ?`,
      [Number(req.params.id), req.customer!.id]
    );
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});
