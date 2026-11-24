import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCircle2,
  Download,
  History,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { StatusBadge } from './StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type AppReleaseRow,
  type AppVersionCheckResponse,
} from '../lib/api.ts';
import {
  applyWebUpdate,
  getSnoozedUpdateBuild,
  setSnoozedUpdateBuild,
  WEB_APP_BUILD_NUMBER,
  WEB_APP_VERSION,
} from '../lib/appVersion.ts';
import { formatDateId } from '../lib/format.ts';

export function formatFileSizeMb(bytes?: string | number | null): string | null {
  if (bytes === null || bytes === undefined) return null;
  const num = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return null;
  const mb = num / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

export function AppUpdateModal({
  open,
  result,
  onLater,
  onUpdate,
}: {
  open: boolean;
  result: AppVersionCheckResponse | null;
  onLater: () => void;
  onUpdate: (url?: string | null) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 15);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onLaterRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || !result?.latest) return null;
  const latest = result.latest;
  const releasesToShow =
    result.pending_releases.length > 0 ? result.pending_releases : [latest];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" onClick={onLater} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl outline-none space-y-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[#115E59] dark:text-[#34D399]">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone="accent" label="Update Tersedia" />
                {latest.is_mandatory ? <StatusBadge tone="warning" label="Penting" /> : null}
              </div>
              <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
                Pembaruan Aplikasi MyEkalliptus
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onLater}
            aria-label="Tutup popup pembaruan"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-lg border border-border bg-surface-subtle px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-mono font-bold text-text-primary">
            v{result.current_version} -&gt; v{latest.version} (Build {latest.build_number})
          </span>
          <span className="text-text-secondary">{formatDateId(latest.published_at)}</span>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          <p className="text-sm font-bold text-text-primary">{latest.title}</p>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Changelog Pembaruan
          </p>
          {releasesToShow.map((rel) => (
            <div key={rel.id} className="space-y-1.5">
              {releasesToShow.length > 1 ? (
                <p className="pt-1 text-xs font-bold text-[#115E59] dark:text-[#34D399]">
                  v{rel.version} (Build {rel.build_number}) · {rel.title}
                </p>
              ) : null}
              <ul className="space-y-1.5">
                {rel.changelog.map((item, idx) => (
                  <li key={`${rel.id}-${idx}`} className="flex items-start gap-2 text-xs text-text-primary">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onLater}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
          >
            Nanti
          </button>
          <button
            type="button"
            onClick={() => onUpdate(latest.download_url)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Update
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppChangelogModal({
  open,
  onClose,
  result,
  isOwner,
  onCheckUpdate,
  checking,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  result: AppVersionCheckResponse | null;
  isOwner: boolean;
  onCheckUpdate: () => void;
  checking: boolean;
  onPublished?: () => Promise<void> | void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [platform, setPlatform] = useState<'web' | 'android'>('web');
  const [versionInput, setVersionInput] = useState('1.3.4');
  const [buildInput, setBuildInput] = useState(String(WEB_APP_BUILD_NUMBER + 1));
  const [releaseTitle, setReleaseTitle] = useState('');
  const [changelogText, setChangelogText] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('https://my.ekalliptus.com');
  const [apkObjectKey, setApkObjectKey] = useState<string | null>(null);
  const [apkSizeBytes, setApkSizeBytes] = useState<number | null>(null);
  const [apkFilename, setApkFilename] = useState<string | null>(null);
  const [uploadingApk, setUploadingApk] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [pushNotice, setPushNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );

  const publishMut = useMutation({
    mutationFn: erpApi.app.publishRelease,
    onSuccess: async (res) => {
      setShowPublishForm(false);
      setReleaseTitle('');
      setChangelogText('');
      setApkObjectKey(null);
      setApkSizeBytes(null);
      setApkFilename(null);
      setPublishError(null);
      if (res.notification) {
        setPushNotice({
          tone: 'success',
          text: `Rilis terbit. Notifikasi dikirim ke ${res.notification.recipients} akun (${res.notification.push.sent} push terkirim).`,
        });
      }
      await onPublished?.();
    },
    onError: (err) => setPublishError((err as Error).message),
  });

  const notifyMut = useMutation({
    mutationFn: erpApi.app.notifyRelease,
    onSuccess: (res) => {
      setPushNotice({
        tone: 'success',
        text: `Notifikasi dikirim ke ${res.recipients} akun (${res.push.sent} push terkirim).`,
      });
    },
    onError: (err) => {
      setPushNotice({
        tone: 'error',
        text: (err as Error).message,
      });
    },
  });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setShowPublishForm(false);
      setApkObjectKey(null);
      setApkSizeBytes(null);
      setApkFilename(null);
      setPublishError(null);
      setPushNotice(null);
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 15);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const releases: AppReleaseRow[] = [...(result?.releases ?? [])].sort(
    (a, b) => b.build_number - a.build_number,
  );
  const currentVersion = result?.current_version ?? WEB_APP_VERSION;
  const currentBuild = result?.current_build ?? WEB_APP_BUILD_NUMBER;

  function handlePublishSubmit(e: FormEvent) {
    e.preventDefault();
    const lines = changelogText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const buildNumber = Number.parseInt(buildInput.trim(), 10);
    if (!Number.isFinite(buildNumber) || buildNumber < 1) {
      setPublishError('Nomor build harus angka bulat positif.');
      return;
    }
    if (lines.length === 0) {
      setPublishError('Isi minimal satu poin changelog.');
      return;
    }
    publishMut.mutate({
      platform,
      version: versionInput.trim(),
      build_number: buildNumber,
      title: releaseTitle.trim(),
      changelog: lines,
      download_url: downloadUrl.trim() || null,
      file_object_key: platform === 'android' ? apkObjectKey : null,
      file_size_bytes: platform === 'android' ? apkSizeBytes : null,
    });
  }

  async function handleApkFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingApk(true);
    setPublishError(null);
    try {
      const key = await uploadFileViaPresign('release', file);
      setApkObjectKey(key);
      setApkSizeBytes(file.size);
      setApkFilename(file.name);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Gagal mengunggah file APK.');
    } finally {
      setUploadingApk(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl outline-none space-y-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
              Riwayat Pembaruan & Changelog
            </h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              Versi terpasang: v{currentVersion} (Build {currentBuild})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog changelog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            {result?.has_update && result.latest ? (
              <StatusBadge tone="warning" label={`Update v${result.latest.version} tersedia`} />
            ) : (
              <StatusBadge tone="success" label="Menggunakan Versi Terbaru" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? (
              <button
                type="button"
                onClick={() => setShowPublishForm((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {showPublishForm ? 'Tutup Form Rilis' : 'Publikasikan Rilis Baru'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={checking}
              onClick={onCheckUpdate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
              {checking ? 'Memeriksa...' : 'Cek Update'}
            </button>
          </div>
        </div>

        {isOwner && showPublishForm ? (
          <form
            onSubmit={handlePublishSubmit}
            className="rounded-lg border border-border bg-surface-subtle p-4 space-y-3"
          >
            <p className="text-xs font-bold text-text-primary">Publikasikan Rilis Baru (Owner)</p>
            {publishError ? (
              <p role="alert" className="text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
                {publishError}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as 'web' | 'android')}
                className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-xs"
              >
                <option value="web">Web (web)</option>
                <option value="android">Android (android)</option>
              </select>
              <input
                required
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
                placeholder="1.2.1"
                className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-xs"
              />
              <input
                required
                type="number"
                min={1}
                value={buildInput}
                onChange={(e) => setBuildInput(e.target.value)}
                placeholder="Build number"
                className="h-9 rounded-md border border-border-strong bg-surface px-2.5 text-xs"
              />
            </div>
            <input
              required
              value={releaseTitle}
              onChange={(e) => setReleaseTitle(e.target.value)}
              placeholder="Judul rilis pembaruan..."
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
            />
            <textarea
              required
              rows={3}
              value={changelogText}
              onChange={(e) => setChangelogText(e.target.value)}
              placeholder="Satu poin changelog per baris..."
              className="w-full rounded-md border border-border-strong bg-surface p-2.5 text-xs"
            />
            <input
              type="url"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://my.ekalliptus.com"
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-2.5 text-xs"
            />
            {platform === 'android' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border-strong bg-surface px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary">
                    {apkObjectKey
                      ? `APK siap: ${apkFilename ?? 'app-release.apk'} (${formatFileSizeMb(apkSizeBytes) ?? 'OK'})`
                      : 'Upload File APK Android (.apk, Opsional)'}
                  </p>
                  <p className="text-[11px] text-text-secondary">
                    Disimpan aman ke Neon Object Storage agar tombol Download Aplikasi mengunduh APK langsung.
                  </p>
                </div>
                <label className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-2.5 text-xs font-semibold text-text-primary hover:border-accent">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  {uploadingApk ? 'Mengunggah...' : apkObjectKey ? 'Ganti APK' : 'Pilih File APK'}
                  <input
                    type="file"
                    accept=".apk,application/vnd.android.package-archive"
                    disabled={uploadingApk}
                    className="sr-only"
                    onChange={(e) => void handleApkFileChange(e)}
                  />
                </label>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={publishMut.isPending || uploadingApk}
                className="inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                {publishMut.isPending ? 'Menerbitkan...' : 'Terbitkan Rilis'}
              </button>
            </div>
          </form>
        ) : null}

        {pushNotice ? (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 text-xs font-medium ${
              pushNotice.tone === 'error'
                ? 'border-[#B91C1C]/40 bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#450A0A]/40 dark:text-[#FCA5A5]'
                : 'border-accent/40 bg-accent-soft/60 text-[#115E59] dark:text-[#34D399]'
            }`}
          >
            {pushNotice.text}
          </p>
        ) : null}

        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {releases.length === 0 ? (
            <p className="text-xs text-text-secondary">Belum ada riwayat rilis yang tersedia.</p>
          ) : (
            releases.map((rel, idx) => {
              const isInstalled =
                rel.build_number === currentBuild && rel.version === currentVersion;
              return (
                <div
                  key={rel.id}
                  className={`rounded-lg border p-3.5 space-y-2 ${
                    isInstalled
                      ? 'border-accent/45 bg-accent-soft/35'
                      : 'border-border bg-surface-subtle'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-text-primary">
                        v{rel.version} (Build {rel.build_number})
                      </span>
                      {idx === 0 ? <StatusBadge tone="accent" label="Terbaru" /> : null}
                      {isInstalled ? <StatusBadge tone="success" label="Terpasang" /> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isOwner && rel.is_published ? (
                        <button
                          type="button"
                          disabled={notifyMut.isPending}
                          onClick={() => notifyMut.mutate(rel.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong bg-surface px-2 text-[11px] font-semibold text-text-primary hover:border-accent disabled:opacity-50"
                        >
                          <Bell className="h-3 w-3" aria-hidden="true" />
                          {notifyMut.isPending ? 'Mengirim...' : 'Kirim Push'}
                        </button>
                      ) : null}
                      <span className="text-[11px] text-text-secondary">
                        {formatDateId(rel.published_at)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-text-primary">{rel.title}</p>
                  <ul className="space-y-1">
                    {rel.changelog.map((point, pIdx) => (
                      <li key={`${rel.id}-${pIdx}`} className="flex items-start gap-2 text-xs text-text-primary">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function AppVersionWatcher({ isOwner: _isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [dismissedBuild, setDismissedBuild] = useState<number | null>(() => getSnoozedUpdateBuild());

  const versionQuery = useQuery({
    queryKey: ['app', 'version', 'web'],
    queryFn: () => erpApi.app.checkVersion('web', WEB_APP_VERSION, WEB_APP_BUILD_NUMBER),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const data = versionQuery.data ?? null;
  const latest = data?.latest ?? null;
  const shouldShow = Boolean(
    data?.has_update && latest && dismissedBuild !== latest.build_number,
  );

  return (
    <AppUpdateModal
      open={shouldShow}
      result={data}
      onLater={() => {
        if (latest) {
          setSnoozedUpdateBuild(latest.build_number);
          setDismissedBuild(latest.build_number);
        }
      }}
      onUpdate={(url) => {
        void queryClient.invalidateQueries({ queryKey: ['app', 'version'] });
        void applyWebUpdate(url);
      }}
    />
  );
}

export function SidebarVersionTrigger({
  isOwner,
  collapsed,
}: {
  isOwner: boolean;
  collapsed: boolean;
}) {
  const queryClient = useQueryClient();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [manualUpdateResult, setManualUpdateResult] = useState<AppVersionCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const versionQuery = useQuery({
    queryKey: ['app', 'version', 'web'],
    queryFn: () => erpApi.app.checkVersion('web', WEB_APP_VERSION, WEB_APP_BUILD_NUMBER),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const result = versionQuery.data ?? null;
  const hasUpdate = Boolean(result?.has_update && result?.latest);

  async function handleCheckNow() {
    setChecking(true);
    try {
      const fresh = await erpApi.app.checkVersion('web', WEB_APP_VERSION, WEB_APP_BUILD_NUMBER);
      queryClient.setQueryData(['app', 'version', 'web'], fresh);
      if (fresh.has_update && fresh.latest) {
        setChangelogOpen(false);
        setManualUpdateResult(fresh);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setChangelogOpen(true)}
        title={`Versi v${WEB_APP_VERSION} (Build ${WEB_APP_BUILD_NUMBER})`}
        className={`mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
          hasUpdate
            ? 'bg-warning-soft text-[#92400E] dark:text-[#FCD34D]'
            : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
        } ${collapsed ? 'justify-center' : 'justify-between'}`}
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          {hasUpdate ? (
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {!collapsed ? (
            <span className="truncate">
              {hasUpdate && result?.latest
                ? `Update v${result.latest.version}`
                : `v${WEB_APP_VERSION} · Changelog`}
            </span>
          ) : null}
        </span>
        {!collapsed && !hasUpdate ? (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
        ) : null}
      </button>

      <AppChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        result={result}
        isOwner={isOwner}
        checking={checking}
        onCheckUpdate={() => void handleCheckNow()}
        onPublished={() => queryClient.invalidateQueries({ queryKey: ['app', 'version'] })}
      />

      <AppUpdateModal
        open={Boolean(manualUpdateResult)}
        result={manualUpdateResult}
        onLater={() => setManualUpdateResult(null)}
        onUpdate={(url) => void applyWebUpdate(url)}
      />
    </>
  );
}

export function DownloadAppModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const androidQuery = useQuery({
    queryKey: ['app', 'version', 'android', 'download'],
    queryFn: () => erpApi.app.checkVersion('android', '0.0.0', 0),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const onDownloadCloseRef = useRef(onClose);
  onDownloadCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 15);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDownloadCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const latest = androidQuery.data?.latest ?? null;
  const sizeLabel = formatFileSizeMb(latest?.file_size_bytes);
  const canDownloadApk = Boolean(
    latest &&
      (latest.has_apk ||
        (latest.download_url && latest.download_url.includes('/api/app/download/android'))),
  );
  const apkHref = latest
    ? canDownloadApk
      ? erpApi.app.androidDownloadHref(latest.build_number)
      : (latest.download_url ?? erpApi.app.androidDownloadHref())
    : erpApi.app.androidDownloadHref();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/55" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text-primary shadow-xl outline-none space-y-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[#115E59] dark:text-[#34D399]">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <h3 id={titleId} className="font-display text-base font-bold text-text-primary">
                Download Aplikasi Android
              </h3>
              <p className="text-xs text-text-secondary">
                MyEkalliptus Mobile APK resmi untuk perangkat Android
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog download aplikasi"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle text-text-primary hover:border-border-strong"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {androidQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-surface-subtle p-4 text-xs text-text-secondary">
            Memuat informasi rilis Android terbaru...
          </div>
        ) : androidQuery.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-[#FECACA] bg-danger-soft p-3.5 text-xs font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:text-[#FCA5A5]"
          >
            Gagal memuat info APK:{' '}
            {androidQuery.error instanceof Error
              ? androidQuery.error.message
              : 'Koneksi bermasalah.'}
          </div>
        ) : latest ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-surface-subtle p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-text-primary">
                  v{latest.version} (Build {latest.build_number})
                </span>
                <div className="flex items-center gap-1.5">
                  {sizeLabel ? <StatusBadge tone="accent" label={sizeLabel} /> : null}
                  <StatusBadge tone="info" label="Android APK" />
                </div>
              </div>
              <p className="text-xs font-semibold text-text-primary">{latest.title}</p>
              <p className="text-[11px] text-text-secondary">
                Dirilis {formatDateId(latest.published_at)}
              </p>
            </div>

            {latest.changelog.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  Pembaruan pada versi ini
                </p>
                <ul className="space-y-1">
                  {latest.changelog.map((item, idx) => (
                    <li key={`dl-${idx}`} className="flex items-start gap-2 text-xs text-text-primary">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-canvas/60 px-3 py-2.5 text-[11px] text-text-secondary space-y-1">
              <p className="font-semibold text-text-primary">Cara pasang singkat di Android:</p>
              <p>1. Unduh file APK hingga selesai di ponsel Android Anda.</p>
              <p>2. Ketuk file APK tersebut lalu izinkan instalasi aplikasi jika diminta sistem.</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-secondary">
            Belum ada rilis Android yang dipublikasikan.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
          >
            Tutup
          </button>
          {latest && canDownloadApk ? (
            <a
              href={apkHref}
              download
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download APK Android
            </a>
          ) : (
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-surface-subtle px-3 text-xs font-medium text-text-secondary">
              APK sedang disiapkan
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DownloadAppButton({
  variant = 'header',
  className = '',
}: {
  variant?: 'header' | 'login' | 'card' | 'drawer';
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const label =
    variant === 'header'
      ? 'Download App'
      : variant === 'card' || variant === 'drawer'
        ? 'Download Aplikasi Android'
        : 'Download Aplikasi';

  const variantClasses =
    variant === 'header'
      ? 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 text-xs font-semibold text-text-primary hover:border-accent'
      : variant === 'login'
        ? 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle'
        : variant === 'drawer'
          ? 'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent-soft px-3 text-xs font-semibold text-[#115E59] hover:border hover:border-accent dark:text-[#34D399]'
          : 'inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-accent-soft px-3.5 text-xs font-semibold text-[#115E59] hover:border-accent dark:text-[#34D399]';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${variantClasses} ${className}`.trim()}
      >
        <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </button>

      <DownloadAppModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
