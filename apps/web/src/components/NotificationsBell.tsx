import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { erpApi, type NotificationItem } from '../lib/api';
import { enableWebNotifications, notificationSupported } from '../lib/notifications';
import { CardListSkeleton } from './Skeleton';
import { EmptyState, ErrorState } from './StateViews';
import { SlideOver } from './SlideOver';

const MODULE_LABEL: Record<string, string> = {
  finance: 'Kas',
  inventory: 'Stok',
  attendance: 'Absensi',
  payroll: 'Gaji',
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => erpApi.notifications.unreadCount(),
    refetchInterval: 60_000,
  });
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => erpApi.notifications.list(30),
    enabled: open,
    refetchInterval: open ? 60_000 : false,
  });
  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({
    mutationFn: () => erpApi.notifications.markAllRead(),
    onSuccess: invalidateAll,
  });
  const markOne = useMutation({
    mutationFn: (id: string) => erpApi.notifications.markRead(id),
    onSuccess: invalidateAll,
  });
  const enable = useMutation({
    mutationFn: () => enableWebNotifications(),
    onSuccess: invalidateAll,
  });

  const unreadCount = unread.data?.unread ?? 0;
  const canEnablePush = notificationSupported() && typeof Notification !== 'undefined' && Notification.permission === 'default';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Notifikasi${unreadCount > 0 ? ` (${unreadCount} belum dibaca)` : ''}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-strong bg-surface text-text-primary hover:bg-surface-subtle"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#276044] px-1 text-center text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Notifikasi"
        subtitle="Aktivitas kas, stok, absensi, dan gaji yang menyentuh Anda."
      >
        <div className="flex h-full flex-col gap-3">
          {canEnablePush && (
            <button
              type="button"
              onClick={() => enable.mutate()}
              disabled={enable.isPending}
              className="w-full rounded-md border border-accent bg-surface-subtle px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface disabled:opacity-50"
            >
              {enable.isPending ? 'Meminta izin...' : 'Aktifkan notifikasi perangkat'}
              </button>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">
              {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Tandai semua dibaca
              </button>
            )}
          </div>

          {list.isLoading ? (
            <CardListSkeleton count={4} />
          ) : list.isError ? (
            <ErrorState
              message="Gagal memuat notifikasi."
              onRetry={() => void list.refetch()}
            />
          ) : (list.data?.notifications.length ?? 0) === 0 ? (
            <EmptyState
              title="Belum ada notifikasi"
              description="Aktivitas modul yang relevan akan muncul di sini."
            />
          ) : (
            <ul className="flex flex-col gap-2 overflow-y-auto">
              {list.data!.notifications.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onMarkRead={() => markOne.mutate(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </SlideOver>
    </>
  );
}

function NotificationRow({ item, onMarkRead }: { item: NotificationItem; onMarkRead: () => void }) {
  const unread = item.read_at === null;
  return (
    <li>
      <button
        type="button"
        onClick={onMarkRead}
        className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
          unread
            ? 'border-accent bg-surface-subtle hover:bg-surface'
            : 'border-border bg-surface hover:bg-surface-subtle'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            {unread && <span className="h-2 w-2 rounded-full bg-[#276044]" aria-hidden="true" />}
            {item.title}
          </span>
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            {MODULE_LABEL[item.module] ?? item.module}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{item.body}</p>
        <p className="mt-1 text-[10px] text-text-secondary">{formatTime(item.created_at)}</p>
      </button>
    </li>
  );
}
