import { useEffect, useRef, useState, type ReactNode } from 'react';

export type ModuleSkeletonVariant =
  | 'dashboard'
  | 'finance'
  | 'inventory'
  | 'attendance'
  | 'payroll'
  | 'portfolio'
  | 'ai'
  | 'rbac'
  | 'audit'
  | 'profile';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`ep-shimmer rounded-md ${className}`} />;
}

export function AccountCardsSkeleton({
  count = 4,
  label = 'Memuat daftar rekening kas...',
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }, (_, idx) => (
          <div key={idx} className="rounded-lg border border-border bg-surface p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="h-4 w-4 rounded-sm" />
            </div>
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-6 w-28" />
          </div>
        ))}
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 6,
  showToolbar = true,
  label = 'Memuat tabel data...',
}: {
  columns?: number;
  rows?: number;
  showToolbar?: boolean;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
    >
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SkeletonBlock className="h-9 w-full max-w-xs" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-9 w-28" />
            <SkeletonBlock className="h-9 w-24" />
          </div>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <div
          className="grid gap-3 border-b border-border pb-2.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <SkeletonBlock key={c} className="h-3.5 w-3/4" />
          ))}
        </div>

        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className="grid gap-3 py-2 border-b border-border/60 last:border-b-0"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }, (_, c) => (
              <SkeletonBlock
                key={c}
                className={`h-4 ${c === 0 ? 'w-11/12' : c === columns - 1 ? 'w-16 ml-auto' : 'w-4/5'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
    </div>
  );
}

export function CardListSkeleton({
  count = 4,
  label = 'Memuat daftar data...',
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-2.5">
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3.5"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-44 max-w-full" />
            <SkeletonBlock className="h-3 w-64 max-w-full" />
          </div>
          <SkeletonBlock className="h-6 w-20 rounded-full shrink-0" />
        </div>
      ))}
      <p className="sr-only">{label}</p>
    </div>
  );
}

export function DashboardSkeleton({
  label = 'Menghitung ringkasan ERP dan arus kas...',
}: {
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, idx) => (
          <div key={idx} className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <SkeletonBlock className="h-3.5 w-28" />
            <SkeletonBlock className="h-7 w-36" />
            <SkeletonBlock className="h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="rounded-lg border border-border bg-surface p-5 space-y-4 xl:col-span-8">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-3 w-64" />
            </div>
            <SkeletonBlock className="h-4 w-28" />
          </div>
          <SkeletonBlock className="h-44 w-full" />
          <AccountCardsSkeleton count={2} label={label} />
        </div>

        <div className="space-y-6 xl:col-span-4">
          <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <SkeletonBlock className="h-4 w-40" />
            <CardListSkeleton count={3} label={label} />
          </div>
          <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <SkeletonBlock className="h-4 w-36" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        </div>
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}

export function ModulePageSkeleton({
  variant,
  label,
}: {
  variant: ModuleSkeletonVariant;
  label?: string;
}) {
  if (variant === 'dashboard') {
    return <DashboardSkeleton label={label ?? 'Memuat halaman Ringkasan MyEkalliptus...'} />;
  }

  if (variant === 'finance') {
    const resolvedLabel = label ?? 'Memuat modul Keuangan MyEkalliptus...';
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-48" />
            <SkeletonBlock className="h-3.5 w-72" />
          </div>
          <SkeletonBlock className="h-9 w-36" />
        </div>
        <AccountCardsSkeleton count={4} label={resolvedLabel} />
        <TableSkeleton columns={6} rows={6} label={resolvedLabel} />
      </div>
    );
  }

  if (variant === 'payroll') {
    const resolvedLabel = label ?? 'Memuat modul Payroll MyEkalliptus...';
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-44" />
            <SkeletonBlock className="h-3.5 w-64" />
          </div>
          <SkeletonBlock className="h-9 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <CardListSkeleton count={4} label={resolvedLabel} />
          </div>
          <div className="lg:col-span-8">
            <TableSkeleton columns={5} rows={5} label={resolvedLabel} />
          </div>
        </div>
      </div>
    );
  }

  const resolvedLabel = label ?? `Memuat modul ${variant}...`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-3.5 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 w-28" />
          <SkeletonBlock className="h-9 w-32" />
        </div>
      </div>
      <TableSkeleton columns={variant === 'inventory' ? 6 : 5} rows={6} label={resolvedLabel} />
    </div>
  );
}

export function AppShellBootSkeleton({
  label = 'Menyiapkan MyEkalliptus Command Center...',
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex min-h-screen bg-canvas text-text-primary"
    >
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-3">
          <SkeletonBlock className="h-7 w-7 rounded-md" />
          <div className="space-y-1.5">
            <SkeletonBlock className="h-3.5 w-24" />
            <SkeletonBlock className="h-2.5 w-28" />
          </div>
        </div>
        <div className="flex-1 space-y-2.5 p-3">
          {Array.from({ length: 7 }, (_, idx) => (
            <SkeletonBlock key={idx} className="h-9 w-full" />
          ))}
        </div>
        <div className="border-t border-border p-3 space-y-1.5">
          <SkeletonBlock className="h-3.5 w-32" />
          <SkeletonBlock className="h-3 w-24" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
          <SkeletonBlock className="h-5 w-36" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="hidden h-9 w-32 sm:block" />
            <SkeletonBlock className="h-9 w-9" />
            <SkeletonBlock className="h-9 w-20" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          <DashboardSkeleton label={label} />
        </main>
      </div>
    </div>
  );
}

export function LazySection({
  fallback,
  rootMargin = '120px',
  children,
}: {
  fallback: ReactNode;
  rootMargin?: string;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (visible) return;
    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return <div ref={hostRef}>{visible ? children : fallback}</div>;
}
