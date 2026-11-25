const CUSTOMER_TOKEN_KEY = 'mb_customer_jwt';
const ADMIN_TOKEN_KEY = 'mb_admin_jwt';

function readSessionToken(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeSessionToken(key: string, token: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (token) {
      window.sessionStorage.setItem(key, token);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

let customerToken: string | null = readSessionToken(CUSTOMER_TOKEN_KEY);
let adminToken: string | null = readSessionToken(ADMIN_TOKEN_KEY);

export function setCustomerToken(token: string | null) {
  customerToken = token;
  writeSessionToken(CUSTOMER_TOKEN_KEY, token);
}

export function getCustomerToken(): string | null {
  return customerToken;
}

export function setAdminToken(token: string | null) {
  adminToken = token;
  writeSessionToken(ADMIN_TOKEN_KEY, token);
}

export function getAdminToken(): string | null {
  return adminToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Array<{ path: string; message: string }>;
  constructor(message: string, status: number, code?: string, details?: Array<{ path: string; message: string }>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: any;
    isFormData?: boolean;
    authScope?: 'customer' | 'admin' | 'none';
  } = {}
): Promise<T> {
  const { method = 'GET', body, isFormData = false, authScope = 'customer' } = options;

  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
  };

  if (!isFormData && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (authScope === 'customer' && customerToken) {
    headers['Authorization'] = `Bearer ${customerToken}`;
  } else if (authScope === 'admin' && adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError(`Request failed with status ${res.status}`, res.status);
    }
    return (await res.text()) as unknown as T;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(data.error || 'Request failed.', res.status, data.code, data.details);
  }
  return data as T;
}

export function generateIdempotencyKey(prefix = 'idemp'): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}

export function formatMoney(amount: string | number | undefined, currency = 'USD', hidden = false): string {
  if (hidden) return '••••••••';
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return `0.00 ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: currency === 'JPY' ? 0 : 2,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

export function formatDateUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
