import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { SkeletonBlock } from './Skeleton.tsx';

export function LoadingState({ label = 'Memuat data...' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="space-y-3 rounded-lg border border-border bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-5 w-20 rounded-full" />
      </div>
      <SkeletonBlock className="h-16 w-full" />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-10 w-full" />
      </div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
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
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-subtle text-text-secondary">
        <Inbox className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="max-w-md text-xs text-text-secondary">{description}</p>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-xs font-semibold text-on-accent hover:bg-accent-hover"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-danger/40 bg-surface p-6 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-[#991B1B] dark:text-[#FCA5A5]">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">Gagal memuat data</h3>
        <p className="max-w-lg text-xs text-text-secondary">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Coba Lagi
        </button>
      ) : null}
    </div>
  );
}
