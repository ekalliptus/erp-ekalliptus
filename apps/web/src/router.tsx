import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AppShell } from './components/AppShell.tsx';
import {
  AppShellBootSkeleton,
  ModulePageSkeleton,
  type ModuleSkeletonVariant,
} from './components/Skeleton.tsx';
import { ErrorState } from './components/StateViews.tsx';
import { ApiError, erpApi, type MeResponse } from './lib/api.ts';
import { authClient, clearAccessTokenCache } from './lib/auth.ts';
import { LoginPage } from './routes/LoginPage.tsx';

const DashboardPage = lazy(() =>
  import('./routes/DashboardPage.tsx').then((m) => ({ default: m.DashboardPage })),
);
const FinancePage = lazy(() =>
  import('./routes/FinancePage.tsx').then((m) => ({ default: m.FinancePage })),
);
const InventoryPage = lazy(() =>
  import('./routes/InventoryPage.tsx').then((m) => ({ default: m.InventoryPage })),
);
const AttendancePage = lazy(() =>
  import('./routes/AttendancePage.tsx').then((m) => ({ default: m.AttendancePage })),
);
const PayrollPage = lazy(() =>
  import('./routes/PayrollPage.tsx').then((m) => ({ default: m.PayrollPage })),
);
const RbacPage = lazy(() =>
  import('./routes/RbacPage.tsx').then((m) => ({ default: m.RbacPage })),
);
const AuditPage = lazy(() =>
  import('./routes/AuditPage.tsx').then((m) => ({ default: m.AuditPage })),
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
    <AppShell
      me={meQuery.data}
      onNavigate={(to) => void navigate({ to: to as '/' })}
      onSignedOut={() => void navigate({ to: '/login', replace: true })}
    >
      <Outlet />
    </AppShell>
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  indexRoute,
  financeRoute,
  inventoryRoute,
  attendanceRoute,
  payrollRoute,
  rbacRoute,
  auditRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
