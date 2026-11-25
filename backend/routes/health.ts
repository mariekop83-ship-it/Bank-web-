import { Router } from 'express';
import { checkDatabaseHealth } from '../config/database.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const db = await checkDatabaseHealth();
  const healthy = !db.configured || db.connected;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: db,
  });
});
