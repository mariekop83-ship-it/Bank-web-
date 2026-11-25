import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { closePool } from './backend/config/database.js';
import { env } from './backend/config/env.js';
import { errorHandler } from './backend/middleware/errorHandler.js';
import { csrfOriginCheck, generalApiLimiter, securityHeaders } from './backend/middleware/security.js';
import { adminRouter } from './backend/routes/admin.js';
import { authRouter } from './backend/routes/auth.js';
import { beneficiariesRouter } from './backend/routes/beneficiaries.js';
import { cardsRouter } from './backend/routes/cards.js';
import { depositsRouter } from './backend/routes/deposits.js';
import { healthRouter } from './backend/routes/health.js';
import { kycRouter } from './backend/routes/kyc.js';
import { notificationsRouter } from './backend/routes/notifications.js';
import { publicRouter } from './backend/routes/public.js';
import { transactionsRouter } from './backend/routes/transactions.js';
import { transfersRouter } from './backend/routes/transfers.js';
import { userRouter } from './backend/routes/user.js';
import { webhooksRouter } from './backend/routes/webhooks.js';
import { withdrawalsRouter } from './backend/routes/withdrawals.js';

export function createApp() {
  const app = express();

  if (env.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(securityHeaders);
  app.use(cookieParser());

  // Mount webhooks before global JSON body parser so HMAC verification can inspect raw payload
  app.use('/api/webhooks', webhooksRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use('/health', healthRouter);

  // API Security & Routing
  app.use('/api', generalApiLimiter, csrfOriginCheck);
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/user', userRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/deposits', depositsRouter);
  app.use('/api/withdrawals', withdrawalsRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/beneficiaries', beneficiariesRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/cards', cardsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);

  // Unknown API endpoints return JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(errorHandler);
  return app;
}

async function startServer() {
  const app = createApp();

  if (!env.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath, { index: false }));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`${env.brand.name} server listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.mjs'))) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
