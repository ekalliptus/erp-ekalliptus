import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Suspense, useEffect, type ReactNode } from 'react';
import {
  AppShellBootSkeleton,
  ModulePageSkeleton,
  type ModuleSkeletonVariant,
} from './components/Skeleton.tsx';
import { ErrorState } from './components/StateViews.tsx';
import { ApiError, erpApi, type MeResponse } from './lib/api.ts';
import { authClient, clearAccessTokenCache } from './lib/auth.ts';
import {
  isChunkLoadError,
  lazyWithRetry,
  tryReloadOnceForStaleChunk,
} from './lib/lazyWithRetry.ts';
import { LoginPage } from './routes/LoginPage.tsx';

const AppShell = lazyWithRetry(() =>
  import('./components/AppShell.tsx').then((m) => ({ default: m.AppShell })),
);

const DashboardPage = lazyWithRetry(() =>
  import('./routes/DashboardPage.tsx').then((m) => ({ default: m.DashboardPage })),
);
const FinancePage = lazyWithRetry(() =>
  import('./routes/FinancePage.tsx').then((m) => ({ default: m.FinancePage })),
);
const InventoryPage = lazyWithRetry(() =>
  import('./routes/InventoryPage.tsx').then((m) => ({ default: m.InventoryPage })),
);
const AttendancePage = lazyWithRetry(() =>
  import('./routes/AttendancePage.tsx').then((m) => ({ default: m.AttendancePage })),
);
const PayrollPage = lazyWithRetry(() =>
  import('./routes/PayrollPage.tsx').then((m) => ({ default: m.PayrollPage })),
);
const RbacPage = lazyWithRetry(() =>
  import('./routes/RbacPage.tsx').then((m) => ({ default: m.RbacPage })),
);
const AuditPage = lazyWithRetry(() =>
  import('./routes/AuditPage.tsx').then((m) => ({ default: m.AuditPage })),
);
const ProfilePage = lazyWithRetry(() =>
  import('./routes/ProfilePage.tsx').then((m) => ({ default: m.ProfilePage })),
);

function AuthenticatedFrame({
  skeletonVariant,
  renderPage,
}: {
  skeletonVariant: ModuleSkeletonVariant;
  renderPage: (me: MeResponse) => ReactNode;
}) {
  const sessionHook = authClient.useSession();
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: erpApi.fetchMe,
    enabled: Boolean(sessionHook.data?.user),
    retry: false,
  });

  if (sessionHook.isPending || meQuery.isLoading) {
    return (
      <ModulePageSkeleton
        variant={skeletonVariant}
        label="Memuat profil dan hak akses RBAC..."
      />
    );
  }

  if (meQuery.isError) {
    const err = meQuery.error;
    const isMissingEmployee = err instanceof ApiError && err.status === 403;
    return (
      <div className="mx-auto mt-16 max-w-lg p-4">
        <ErrorState
          message={
            isMissingEmployee
              ? 'Email akun Neon Auth Anda belum terdaftar di tabel karyawan MyEkalliptus. Hubungi administrator (alul@ekalliptus.com).'
              : err instanceof Error
                ? err.message
                : 'Gagal memuat sesi ERP.'
          }
          onRetry={() => void meQuery.refetch()}
        />
      </div>
    );
  }

  if (!meQuery.data) {
    return null;
  }

  return (
    <Suspense fallback={<ModulePageSkeleton variant={skeletonVariant} />}>
      {renderPage(meQuery.data)}
    </Suspense>
  );
}

function RootComponent() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sessionHook = authClient.useSession();

  const hasUser = Boolean(sessionHook.data?.user);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: erpApi.fetchMe,
    enabled: hasUser,
    retry: false,
  });

  useEffect(() => {
    if (!meQuery.data) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void import('./lib/notifications.ts')
        .then((m) => m.enableWebNotifications())
        .catch(() => null);
    }
  }, [meQuery.data]);

  useEffect(() => {
    if (sessionHook.isPending) return;
    if (!hasUser && pathname !== '/login') {
      void navigate({ to: '/login', replace: true });
    } else if (hasUser && pathname === '/login') {
      void navigate({ to: '/', replace: true });
    }
  }, [sessionHook.isPending, hasUser, pathname, navigate]);

  if (sessionHook.isPending) {
    return <AppShellBootSkeleton label="Memverifikasi sesi MyEkalliptus..." />;
  }

  if (!hasUser || pathname === '/login') {
    return (
      <LoginPage
        onSuccess={async () => {
          await sessionHook.refetch?.();
          await queryClient.invalidateQueries({ queryKey: ['me'] });
          void navigate({ to: '/', replace: true });
        }}
      />
    );
  }

  if (meQuery.isLoading) {
    return <AppShellBootSkeleton label="Memuat workspace ERP dan matriks RBAC..." />;
  }

  if (meQuery.isError || !meQuery.data) {
    const err = meQuery.error;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-lg space-y-4">
          <ErrorState
            message={
              err instanceof Error
                ? err.message
                : 'Tidak dapat memuat profil karyawan dari API MyEkalliptus.'
            }
            onRetry={() => void meQuery.refetch()}
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={async () => {
                await authClient.signOut();
                clearAccessTokenCache();
                queryClient.clear();
                void navigate({ to: '/login', replace: true });
              }}
              className="rounded-md border border-border-strong bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
            >
              Keluar & Ganti Akun
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<AppShellBootSkeleton label="Memuat ruang kerja MyEkalliptus..." />}>
      <AppShell
        me={meQuery.data}
        onNavigate={(to) => void navigate({ to: to as '/' })}
        onSignedOut={() => void navigate({ to: '/login', replace: true })}
      >
        <Outlet />
      </AppShell>
    </Suspense>
  );
}

const rootRoute = createRootRoute({
  component: RootComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => null,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="dashboard"
      renderPage={(me) => <DashboardPage me={me} />}
    />
  ),
});

const financeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/finance',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="finance"
      renderPage={(me) => <FinancePage me={me} />}
    />
  ),
});

const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="inventory"
      renderPage={(me) => <InventoryPage me={me} />}
    />
  ),
});

const attendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/attendance',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="attendance"
      renderPage={(me) => <AttendancePage me={me} />}
    />
  ),
});

const payrollRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/payroll',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="payroll"
      renderPage={(me) => <PayrollPage me={me} />}
    />
  ),
});

const rbacRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rbac',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="rbac"
      renderPage={(me) => <RbacPage me={me} />}
    />
  ),
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="audit"
      renderPage={(me) => <AuditPage me={me} />}
    />
  ),
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: () => (
    <AuthenticatedFrame
      skeletonVariant="profile"
      renderPage={(me) => <ProfilePage me={me} />}
    />
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  financeRoute,
  inventoryRoute,
  attendanceRoute,
  payrollRoute,
  rbacRoute,
  auditRoute,
  profileRoute,
]);

function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const chunkErr = isChunkLoadError(error);
  const errorMessage =
    error instanceof Error ? error.message : 'Terjadi kesalahan saat memuat halaman.';

  useEffect(() => {
    if (chunkErr) {
      tryReloadOnceForStaleChunk();
    }
  }, [chunkErr]);

  return (
    <div className="mx-auto my-12 w-full max-w-lg px-4">
      <div
        role="alert"
        className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center shadow-sm"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-[#991B1B] dark:text-[#FCA5A5]">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-base font-bold text-text-primary">
            {chunkErr ? 'Pembaruan Aplikasi Tersedia' : 'Terjadi Gangguan pada Halaman'}
          </h2>
          <p className="text-xs leading-relaxed text-text-secondary">
            {chunkErr
              ? 'Versi aplikasi di server telah diperbarui sehingga modul halaman lama tidak lagi tersedia. Muat ulang halaman untuk mengambil versi terbaru.'
              : errorMessage}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Muat Ulang Halaman
          </button>
          {!chunkErr ? (
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-4 text-xs font-semibold text-text-primary hover:bg-surface"
            >
              Coba Lagi
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RouteNotFoundFallback() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto my-12 w-full max-w-lg px-4">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-[#115E59] dark:text-[#34D399]">
          <Home className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-base font-bold text-text-primary">
            Halaman Tidak Ditemukan
          </h2>
          <p className="text-xs leading-relaxed text-text-secondary">
            Tautan halaman yang Anda buka tidak tersedia atau telah dipindahkan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: '/', replace: true })}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
        >
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          Kembali ke Dashboard
        </button>
      </div>
    </div>
  );
}

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
  defaultErrorComponent: RouteErrorFallback,
  defaultNotFoundComponent: RouteNotFoundFallback,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
