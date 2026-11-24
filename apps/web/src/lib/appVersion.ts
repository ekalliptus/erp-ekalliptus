export const WEB_APP_VERSION = '1.3.3';
export const WEB_APP_BUILD_NUMBER = 7;

const SNOOZE_STORAGE_KEY = 'ekalliptus_snoozed_update_build';

export function getSnoozedUpdateBuild(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SNOOZE_STORAGE_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function setSnoozedUpdateBuild(build: number): void {
  try {
    window.sessionStorage.setItem(SNOOZE_STORAGE_KEY, String(build));
  } catch {
    // Abaikan jika sessionStorage tidak tersedia.
  }
}

export async function applyWebUpdate(downloadUrl?: string | null): Promise<void> {
  const trimmed = downloadUrl?.trim();
  if (trimmed && (trimmed.startsWith('https://') || trimmed.startsWith('http://'))) {
    try {
      const targetUrl = new URL(trimmed);
      if (targetUrl.origin !== window.location.origin) {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch {
      // Lanjutkan muat ulang halaman saat ini.
    }
  }

  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {
    // Abaikan kegagalan hapus cache browser.
  }
  window.location.reload();
}
