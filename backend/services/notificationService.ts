import crypto from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '../config/database.js';
import { providers } from './providers/registry.js';

export type NotificationCategory =
  | 'LOGIN'
  | 'NEW_DEVICE'
  | 'PASSWORD_CHANGE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'KYC'
  | 'SECURITY_ALERT'
  | 'ACCOUNT_RESTRICTION';

export async function createNotification(
  params: {
    userId: number;
    category: NotificationCategory;
    title: string;
    message: string;
    emailTo?: string;
    sendEmail?: boolean;
  },
  conn?: PoolConnection
): Promise<void> {
  const executor = conn || getPool();
  let emailSent = 0;

  if (params.sendEmail && params.emailTo) {
    try {
      const ok = await providers.notifications.sendEmail(
        params.emailTo,
        params.title,
        params.message
      );
      emailSent = ok ? 1 : 0;
    } catch {
      emailSent = 0;
    }
  }

  await executor.query(
    `INSERT INTO notifications (uuid, user_id, category, title, message, channel_in_app, channel_email)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [crypto.randomUUID(), params.userId, params.category, params.title.slice(0, 180), params.message, emailSent]
  );
}

export async function logSecurityEvent(
  params: {
    actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM' | 'WEBHOOK';
    actorId?: number | null;
    eventType: string;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  },
  conn?: PoolConnection
): Promise<void> {
  const executor = conn || getPool();
  await executor.query(
    `INSERT INTO security_events (uuid, actor_type, actor_id, event_type, severity, ip_address, user_agent, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      params.actorType,
      params.actorId ?? null,
      params.eventType.slice(0, 100),
      params.severity || 'INFO',
      params.ipAddress ? params.ipAddress.slice(0, 64) : null,
      params.userAgent ? params.userAgent.slice(0, 512) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );
}
