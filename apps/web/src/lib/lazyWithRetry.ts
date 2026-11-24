import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_STORAGE_KEY = 'ekalliptus_chunk_reload_at';
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

let preloadListenerInstalled = false;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = err instanceof Error ? err.name.toLowerCase() : '';
  const msg = (
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  ).toLowerCase();

  return (
    name === 'chunkloaderror' ||
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('unable to preload css') ||
    msg.includes('loading chunk') ||
    msg.includes('chunkloaderror') ||
    msg.includes('dynamically imported module')
  );
}

export function tryReloadOnceForStaleChunk(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const now = Date.now();
    const rawLast = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const lastReload = rawLast ? Number.parseInt(rawLast, 10) : 0;
    if (Number.isFinite(lastReload) && lastReload > 0 && now - lastReload < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function clearStaleChunkReloadFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
  } catch {
    // Abaikan jika sessionStorage tidak tersedia pada mode privasi.
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await importer();
      clearStaleChunkReloadFlag();
      return mod;
    } catch (err) {
      if (isChunkLoadError(err) && tryReloadOnceForStaleChunk()) {
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

export function installGlobalChunkErrorRecovery(): void {
  if (typeof window === 'undefined' || preloadListenerInstalled) return;
  preloadListenerInstalled = true;
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    tryReloadOnceForStaleChunk();
  });
}
