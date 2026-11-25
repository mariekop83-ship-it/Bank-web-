import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, Moon, Sun, X } from 'lucide-react';

export function ThemeToggle({
  dark,
  onToggle,
}: {
  dark: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
    >
      {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
      <span>{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

export function StatusText({ status }: { status: string }) {
  const s = (status || '').toUpperCase();
  let colorClass = 'text-slate-600 dark:text-slate-400';
  if (['SUCCESSFUL', 'APPROVED', 'ACTIVE', 'LIVE', 'RESOLVED'].includes(s)) {
    colorClass = 'text-emerald-700 dark:text-emerald-400';
  } else if (['PENDING', 'PROCESSING', 'UNDER_REVIEW', 'PENDING_ISSUANCE', 'SANDBOX'].includes(s)) {
    colorClass = 'text-amber-700 dark:text-amber-400';
  } else if (['FAILED', 'REJECTED', 'SUSPENDED', 'RESTRICTED', 'CANCELLED', 'REVERSED', 'FROZEN'].includes(s)) {
    colorClass = 'text-rose-700 dark:text-rose-400';
  }

  return (
    <span className={`text-xs font-medium tracking-tight whitespace-nowrap ${colorClass}`}>
      {s.replace(/_/g, ' ')}
    </span>
  );
}

export function AlertBanner({
  type,
  title,
  message,
  onDismiss,
}: {
  type: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  message: string;
  onDismiss?: () => void;
}) {
  const styles = {
    error: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200',
    success: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200',
    warning: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200',
    info: 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200',
  }[type];

  const Icon = type === 'success' ? CheckCircle2 : type === 'info' ? Info : AlertCircle;

  return (
    <div role="alert" className={`flex items-start justify-between gap-3 p-4 rounded-lg border text-sm ${styles}`}>
      <div className="flex items-start gap-3">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          {title && <p className="font-semibold mb-0.5">{title}</p>}
          <p className="leading-relaxed">{message}</p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white whitespace-nowrap cursor-pointer ${
              destructive ? 'bg-rose-700 hover:bg-rose-800' : 'bg-blue-700 hover:bg-blue-800'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="py-12 px-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white/50 dark:bg-slate-900/40">
      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-blue-700 hover:bg-blue-800 text-white transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ResilientImage({
  src,
  alt,
  className = '',
  fallbackTitle,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-slate-200 p-6 ${className}`}
      >
        <span className="text-sm font-medium tracking-tight opacity-80">{fallbackTitle}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
