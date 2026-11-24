import { hasPermission } from '@ekalliptus/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { RealtimeProvider } from '@neon/realtime-react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Boxes,
  Briefcase,
  Command,
  FileSpreadsheet,
  Fingerprint,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  ShieldCheck,
  Store,
  Users,
  X,
} from 'lucide-react';
import { Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, RealtimeFeed } from '../lib/api.ts';
import { authClient, clearAccessTokenCache } from '../lib/auth.ts';
import { lazyWithRetry } from '../lib/lazyWithRetry.ts';
import { ErpRealtimeSubscriber, realtimeClient, type LiveFeedStatus } from '../lib/realtime.tsx';
import {
  AppVersionWatcher,
  DownloadAppButton,
  SidebarVersionTrigger,
} from './AppVersionWidgets.tsx';
import { NotificationsBell } from './NotificationsBell.tsx';
import { ThemeToggleButton } from './ThemeToggleButton.tsx';

const CommandPalette = lazyWithRetry(() =>
  import('./CommandPalette.tsx').then((m) => ({ default: m.CommandPalette })),
);

interface NavEntry {
  to:
    | '/'
    | '/finance'
    | '/inventory'
    | '/attendance'
    | '/payroll'
    | '/portfolio'
    | '/rbac'
    | '/audit'
    | '/profile';
  label: string;
  group: 'Operasional' | 'Kontrol';
  icon: typeof LayoutDashboard;
  module?:
    | 'finance'
    | 'inventory'
    | 'attendance'
    | 'payroll'
    | 'portfolio'
    | 'rbac'
    | 'audit';
}

const NAV_ENTRIES: NavEntry[] = [
  { to: '/', label: 'Ringkasan', group: 'Operasional', icon: LayoutDashboard },
  { to: '/finance', label: 'Kasir / POS', group: 'Operasional', icon: Store, module: 'finance' },
  { to: '/inventory', label: 'Inventaris', group: 'Operasional', icon: Boxes, module: 'inventory' },
  {
    to: '/attendance',
    label: 'Absensi',
    group: 'Operasional',
    icon: Fingerprint,
    module: 'attendance',
  },
  {
    to: '/payroll',
    label: 'Payroll',
    group: 'Operasional',
    icon: FileSpreadsheet,
    module: 'payroll',
  },
  {
    to: '/portfolio',
    label: 'Portofolio Web',
    group: 'Operasional',
    icon: Briefcase,
    module: 'portfolio',
  },
  { to: '/rbac', label: 'Akses & Tim', group: 'Kontrol', icon: Users, module: 'rbac' },
  { to: '/audit', label: 'Audit Trail', group: 'Kontrol', icon: ShieldCheck, module: 'audit' },
];

const FINANCE_INVALIDATE_KEYS: QueryKey[] = [['me'], ['finance'], ['payroll']];
const INVENTORY_INVALIDATE_KEYS: QueryKey[] = [['me'], ['inventory']];
const ATTENDANCE_INVALIDATE_KEYS: QueryKey[] = [['me'], ['attendance'], ['payroll']];

export function AppShell({
  me,
  onNavigate,
  onSignedOut,
  children,
}: {
  me: MeResponse;
  onNavigate: (to: string) => void;
  onSignedOut: () => void;
  children: ReactNode;
}) {
  const sidebarId = useId();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveFeedStatus>({
    status: 'connecting',
    errorMessage: null,
  });

  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseRef = useRef<HTMLButtonElement | null>(null);

  const visibleNav = useMemo(
    () =>
      NAV_ENTRIES.filter((entry) => {
        if (!entry.module) return true;
        return hasPermission(me.permissions, entry.module, 'view');
      }),
    [me.permissions],
  );

  const activeEntry =
    visibleNav.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to))) ??
    visibleNav[0];

  const headerTitle = pathname.startsWith('/profile')
    ? 'Profil & Ruang Kerja'
    : (activeEntry?.label ?? 'Ringkasan');
  const canFinance = hasPermission(me.permissions, 'finance', 'view');
  const canInventory = hasPermission(me.permissions, 'inventory', 'view');
  const canAttendance = hasPermission(me.permissions, 'attendance', 'view');

  const primaryRealtimeFeed = useMemo<RealtimeFeed>(() => {
    if (canFinance) return 'erp:finance';
    if (canInventory) return 'erp:inventory';
    return 'erp:attendance';
  }, [canFinance, canInventory]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const t = setTimeout(() => mobileCloseRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileOpen(false);
        mobileTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      clearAccessTokenCache();
      queryClient.clear();
      setSigningOut(false);
      onSignedOut();
    }
  }

  const realtimePillLabel =
    liveStatus.status === 'live'
      ? 'Realtime Aktif'
      : liveStatus.status === 'connecting'
        ? 'Menghubungkan'
        : liveStatus.status === 'stale'
          ? 'Menyegarkan'
          : liveStatus.status === 'error'
            ? 'Realtime Terputus'
            : 'Siaga';

  const renderSidebarLinks = (isCollapsed: boolean, onItemClick?: () => void) => {
    const groups: Array<'Operasional' | 'Kontrol'> = ['Operasional', 'Kontrol'];
    return groups.map((group) => {
      const entries = visibleNav.filter((item) => item.group === group);
      if (entries.length === 0) return null;
      return (
        <div key={group} className="space-y-1">
          {!isCollapsed ? (
            <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              {group}
            </p>
          ) : (
            <div className="my-2 border-t border-border" aria-hidden="true" />
          )}
          <ul className="space-y-0.5">
            {entries.map((entry) => {
              const Icon = entry.icon;
              const isActive =
                entry.to === '/' ? pathname === '/' : pathname.startsWith(entry.to);
              return (
                <li key={entry.to}>
                  <Link
                    to={entry.to}
                    onClick={onItemClick}
                    aria-current={isActive ? 'page' : undefined}
                    title={isCollapsed ? entry.label : undefined}
                    className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                      isCollapsed ? 'justify-center px-2' : ''
                    } ${
                      isActive
                        ? 'bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
                        : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                    }`}
                  >
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-accent"
                      />
                    ) : null}
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!isCollapsed ? <span className="truncate">{entry.label}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      );
    });
  };

  return (
    <RealtimeProvider client={realtimeClient}>
      <div className="flex min-h-screen bg-canvas text-text-primary">
        <ErpRealtimeSubscriber
          feed="erp:finance"
          enabled={canFinance}
          queryKeysToInvalidate={FINANCE_INVALIDATE_KEYS}
          onStatusChange={primaryRealtimeFeed === 'erp:finance' ? setLiveStatus : undefined}
        />
        <ErpRealtimeSubscriber
          feed="erp:inventory"
          enabled={canInventory}
          queryKeysToInvalidate={INVENTORY_INVALIDATE_KEYS}
          onStatusChange={primaryRealtimeFeed === 'erp:inventory' ? setLiveStatus : undefined}
        />
        <ErpRealtimeSubscriber
          feed="erp:attendance"
          enabled={canAttendance}
          queryKeysToInvalidate={ATTENDANCE_INVALIDATE_KEYS}
          onStatusChange={primaryRealtimeFeed === 'erp:attendance' ? setLiveStatus : undefined}
        />

      {/* Desktop persistent collapsible sidebar */}
      <aside
        id={sidebarId}
        aria-label="Navigasi utama"
        className={`hidden shrink-0 flex-col border-r border-border bg-surface lg:flex ${
          collapsed ? 'w-[68px]' : 'w-[240px]'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <img
              src="/logo.webp"
              alt="Logo MyEkalliptus"
              width={28}
              height={28}
              decoding="async"
              className="h-7 w-7 shrink-0 rounded-md border border-border bg-white p-0.5 object-contain"
            />
            {!collapsed ? (
              <div className="min-w-0">
                <span className="block truncate font-display text-sm font-bold text-text-primary">
                  MyEkalliptus
                </span>
                <span className="block truncate text-[11px] font-medium text-text-secondary">
                  ERP Command Center
                </span>
              </div>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls={sidebarId}
            aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {renderSidebarLinks(collapsed)}
        </nav>

        <div className="border-t border-border p-2">
          <Link
            to="/profile"
            aria-label={`Buka profil ${me.employee.full_name}`}
            aria-current={pathname.startsWith('/profile') ? 'page' : undefined}
            className={`block rounded-md p-2 transition-colors ${
              pathname.startsWith('/profile')
                ? 'bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                : 'hover:bg-surface-subtle'
            }`}
          >
            {!collapsed ? (
              <div className="flex items-center gap-2.5">
                {me.employee.avatar_url ? (
                  <img
                    src={me.employee.avatar_url}
                    alt={`Foto ${me.employee.full_name}`}
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft text-[11px] font-bold text-[#115E59] dark:text-[#34D399]">
                    {me.employee.full_name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 space-y-0.5 text-xs">
                  <p className="truncate font-semibold text-text-primary">{me.employee.full_name}</p>
                  <p className="truncate text-text-secondary">
                    {me.role_name} ({me.employee.employee_code})
                  </p>
                  {me.employee.username ? (
                    <p className="truncate text-text-secondary" title="Username untuk login">
                      @{me.employee.username}
                    </p>
                  ) : (
                    <p className="truncate font-medium text-accent">Buka Profil &amp; Ruang Kerja</p>
                  )}
                </div>
              </div>
            ) : me.employee.avatar_url ? (
              <img
                src={me.employee.avatar_url}
                alt={`Foto ${me.employee.full_name}`}
                width={32}
                height={32}
                title={me.employee.full_name}
                className="mx-auto h-8 w-8 rounded-full border border-border object-cover"
              />
            ) : (
              <p className="text-center text-xs font-bold text-text-primary" title={me.employee.full_name}>
                {me.employee.full_name.slice(0, 2).toUpperCase()}
              </p>
            )}
          </Link>
          <SidebarVersionTrigger isOwner={me.role === 'owner'} collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/45"
            aria-hidden="true"
            onClick={() => {
              setMobileOpen(false);
              mobileTriggerRef.current?.focus();
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            className="relative z-10 flex h-full w-64 flex-col border-r border-border bg-surface"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2.5">
                <img
                  src="/logo.webp"
                  alt="Logo MyEkalliptus"
                  width={28}
                  height={28}
                  decoding="async"
                  className="h-7 w-7 rounded-md border border-border bg-white p-0.5 object-contain"
                />
                <span className="font-display text-sm font-bold text-text-primary">
                  MyEkalliptus
                </span>
              </div>
              <button
                ref={mobileCloseRef}
                type="button"
                aria-label="Tutup menu"
                onClick={() => {
                  setMobileOpen(false);
                  mobileTriggerRef.current?.focus();
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {renderSidebarLinks(false, () => setMobileOpen(false))}
            </nav>
            <div className="border-t border-border p-3">
              <Link
                to="/profile"
                onClick={() => setMobileOpen(false)}
                aria-current={pathname.startsWith('/profile') ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md p-2 text-xs ${
                  pathname.startsWith('/profile')
                    ? 'bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                    : 'hover:bg-surface-subtle'
                }`}
              >
                {me.employee.avatar_url ? (
                  <img
                    src={me.employee.avatar_url}
                    alt={`Foto ${me.employee.full_name}`}
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft text-[11px] font-bold text-[#115E59] dark:text-[#34D399]">
                    {me.employee.full_name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">{me.employee.full_name}</p>
                  <p className="truncate text-text-secondary">
                    {me.role_name} ({me.employee.employee_code}) · Profil
                  </p>
                </div>
              </Link>
              <SidebarVersionTrigger isOwner={me.role === 'owner'} collapsed={false} />
              <div className="mt-2">
                <DownloadAppButton variant="drawer" />
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={mobileTriggerRef}
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
              aria-expanded={mobileOpen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-base font-bold text-text-primary">
                {headerTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-medium text-text-primary hover:border-accent sm:inline-flex"
            >
              <Command className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
              <span>Cari Modul</span>
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                Ctrl+K
              </kbd>
            </button>

            <div
              title={liveStatus.errorMessage || `Neon Realtime (${primaryRealtimeFeed})`}
              className="hidden items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-primary md:inline-flex"
            >
              <Radio
                className={`h-3.5 w-3.5 ${
                  liveStatus.status === 'live'
                    ? 'text-[#15803D] dark:text-[#22C55E]'
                    : liveStatus.status === 'error'
                      ? 'text-[#991B1B] dark:text-[#FCA5A5]'
                      : 'text-text-secondary'
                }`}
                aria-hidden="true"
              />
              <span>{realtimePillLabel}</span>
            </div>

            <div className="hidden sm:block">
              <DownloadAppButton variant="header" />
            </div>

            <NotificationsBell />

            <ThemeToggleButton />

            <button
              type="button"
              disabled={signingOut}
              onClick={handleSignOut}
              aria-label="Keluar sesi"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{signingOut ? 'Keluar...' : 'Keluar'}</span>
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile-web fixed bottom navbar dengan tombol Fingerprint Absensi di tengah */}
      <nav
        aria-label="Navigasi cepat mobile"
        className="fixed inset-x-3 bottom-3 z-40 flex h-16 items-center justify-between rounded-2xl border border-border-strong bg-surface px-2 shadow-lg lg:hidden"
      >
        <Link
          to="/"
          className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl text-[11px] font-medium ${
            pathname === '/'
              ? 'bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          <span className="mt-0.5 truncate">Ringkasan</span>
        </Link>

        {canFinance ? (
          <Link
            to="/finance"
            className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl text-[11px] font-medium ${
              pathname.startsWith('/finance')
                ? 'bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Store className="h-4 w-4" aria-hidden="true" />
            <span className="mt-0.5 truncate">Kasir</span>
          </Link>
        ) : (
          <div className="flex-1" aria-hidden="true" />
        )}

        <div className="px-1.5">
          {canAttendance ? (
            <Link
              to="/attendance"
              aria-label="Absensi Sidik Jari & Wajah"
              aria-current={pathname.startsWith('/attendance') ? 'page' : undefined}
              className={`flex h-12 w-12 items-center justify-center rounded-full shadow-md transition-transform active:scale-95 ${
                pathname.startsWith('/attendance')
                  ? 'bg-accent text-on-accent ring-4 ring-accent/25'
                  : 'bg-accent text-on-accent hover:bg-accent-hover'
              }`}
            >
              <Fingerprint className="h-6 w-6" aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu navigasi"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent shadow-md"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {canInventory ? (
          <Link
            to="/inventory"
            className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl text-[11px] font-medium ${
              pathname.startsWith('/inventory')
                ? 'bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Boxes className="h-4 w-4" aria-hidden="true" />
            <span className="mt-0.5 truncate">Stok</span>
          </Link>
        ) : (
          <Link
            to="/profile"
            className={`flex h-12 flex-1 flex-col items-center justify-center rounded-xl text-[11px] font-medium ${
              pathname.startsWith('/profile')
                ? 'bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span className="mt-0.5 truncate">Profil</span>
          </Link>
        )}

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Menu modul lainnya"
          className="flex h-12 flex-1 flex-col items-center justify-center rounded-xl text-[11px] font-medium text-text-secondary hover:text-text-primary"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          <span className="mt-0.5 truncate">Menu</span>
        </button>
      </nav>

      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            me={me}
            onNavigate={onNavigate}
          />
        </Suspense>
      ) : null}

      <AppVersionWatcher isOwner={me.role === 'owner'} />
      </div>
    </RealtimeProvider>
  );
}
