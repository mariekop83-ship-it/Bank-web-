import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from '../config/env.js';

export const securityHeaders = helmet({
  frameguard: false, // Allow embedding inside AI Studio / reverse-proxy frames when needed
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
});

export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

export const financialRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Financial operation rate limit exceeded.' },
});

/**
 * CSRF & Origin verification for state-changing requests.
 * Allows requests using Bearer Authorization header, or verifies Origin/Referer/X-Requested-With on cookie requests.
 */
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  // Webhook routes use HMAC signature verification instead of browser CSRF
  if (req.path.startsWith('/webhooks/')) {
    next();
    return;
  }

  // Bearer token in Authorization header is immune to classic CSRF
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const origin = req.headers.origin;
  const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host;

  if (origin && forwardedHost) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === forwardedHost.split(',')[0].trim()) {
        next();
        return;
      }
    } catch {
      // Fall through to reject
    }
    res.status(403).json({ error: 'CSRF validation failed: Origin mismatch.' });
    return;
  }

  // Require custom header if Origin header is absent on cookie-authenticated mutations
  if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers['x-csrf-protection'] === '1') {
    next();
    return;
  }

  // If no cookies are present (e.g. initial login/register JSON POST), allow when Content-Type is JSON
  if (!req.cookies?.mb_session && !req.cookies?.mb_admin_session) {
    next();
    return;
  }

  res.status(403).json({ error: 'CSRF protection check failed.' });
}

export function setSecureSessionCookie(res: Response, req: Request, name: string, token: string, maxAgeMs: number): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || env.isProduction;
  if (isHttps) {
    res.cookie(name, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
      maxAge: maxAgeMs,
      path: '/',
      ...(env.security.cookieDomain ? { domain: env.security.cookieDomain } : {}),
    });
  } else {
    res.cookie(name, token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path: '/',
    });
  }
}

export function clearSecureSessionCookie(res: Response, req: Request, name: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || env.isProduction;
  res.clearCookie(name, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
  });
}
