import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  const code = err?.code || undefined;

  if (status >= 500) {
    if (code !== 'DB_NOT_CONFIGURED') {
      console.error('[Server Error]', err?.message || err);
    }
    res.status(status).json({
      error:
        code === 'DB_NOT_CONFIGURED'
          ? err.message
          : 'An unexpected internal error occurred. Please try again later.',
      ...(code ? { code } : {}),
    });
    return;
  }

  res.status(status).json({
    error: err?.message || 'Request rejected.',
    ...(code ? { code } : {}),
  });
}
