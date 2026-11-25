import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { isSafeHttpsUrl } from './security-policy.js';

export type DemoCaptureVariant = 'desktop' | 'mobile';
export type SafeRasterMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type DemoCaptureProvider = 'cloudflare' | 'mshots' | 'microlink';

export interface DnsAddressRecord {
  address: string;
  family: number;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<DnsAddressRecord[]>;

export type SleepFn = (ms: number) => Promise<void>;

export type CaptureVariantResult =
  | {
      ok: true;
      bytes: Uint8Array;
      mime: SafeRasterMime;
      provider: DemoCaptureProvider;
    }
  | {
      ok: false;
      reason: string;
    };

export interface CaptureScreenshotsResult {
  urlValidationError?: string;
  url: string;
  hostname: string;
  desktop: CaptureVariantResult | null;
  mobile: CaptureVariantResult | null;
}

const BLOCKED_HOSTNAME_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.arpa|metadata\.google\.internal)$/i;
const SELF_CAPTURE_PROVIDER_HOSTS = new Set(['s0.wp.com', 'api.microlink.io']);

const MIN_IMAGE_BYTES = 4096;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isPrivateIpv4Octets(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number.parseInt(p, 10) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

function expandIpv6Hextets(ip: string): number[] | null {
  const zoneIdx = ip.indexOf('%');
  const raw = (zoneIdx >= 0 ? ip.slice(0, zoneIdx) : ip).toLowerCase();
  if (!raw || net.isIPv6(raw) === false) return null;

  // Handle IPv4-embedded tail e.g. ::ffff:127.0.0.1
  let working = raw;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const tail = parseIpv4(working.slice(lastColon + 1));
    if (!tail) return null;
    const h1 = ((tail[0] << 8) | tail[1]).toString(16);
    const h2 = ((tail[2] << 8) | tail[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${h1}:${h2}`;
  }

  const dblParts = working.split('::');
  if (dblParts.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const segs = part.split(':');
    const out: number[] = [];
    for (const s of segs) {
      if (!/^[0-9a-f]{1,4}$/i.test(s)) return null;
      out.push(Number.parseInt(s, 16));
    }
    return out;
  };

  if (dblParts.length === 1) {
    const groups = parseGroups(dblParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseGroups(dblParts[0]);
  const right = parseGroups(dblParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim();
  if (!clean) return true;

  if (net.isIPv4(clean)) {
    const octets = parseIpv4(clean);
    if (!octets) return true;
    return isPrivateIpv4Octets(octets[0], octets[1], octets[2], octets[3]);
  }

  const hextets = expandIpv6Hextets(clean);
  if (!hextets) return true;

  const allZero = hextets.every((h) => h === 0);
  if (allZero) return true; // :: unspecified

  const isLoopback =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0 &&
    hextets[6] === 0 &&
    hextets[7] === 1;
  if (isLoopback) return true; // ::1

  // IPv4-mapped IPv6 ::ffff:a.b.c.d
  const isV4Mapped =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff;
  if (isV4Mapped) {
    const a = (hextets[6] >> 8) & 0xff;
    const b = hextets[6] & 0xff;
    const c = (hextets[7] >> 8) & 0xff;
    const d = hextets[7] & 0xff;
    return isPrivateIpv4Octets(a, b, c, d);
  }

  const first = hextets[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

export async function validatePublicCaptureUrl(
  rawUrl: string,
  dnsLookup: DnsLookupFn = (host, opts) => lookup(host, opts),
): Promise<{ ok: true; url: string; hostname: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'URL demo tidak valid.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL demo wajib menggunakan protokol HTTPS.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL demo tidak boleh mengandung kredensial.' };
  }
  if (parsed.port && parsed.port !== '443') {
    return { ok: false, error: 'URL demo hanya diizinkan pada port HTTPS standar (443).' };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || !host.includes('.')) {
    return { ok: false, error: 'Hostname URL demo harus berupa domain publik yang valid.' };
  }
  if (net.isIP(host) !== 0) {
    return { ok: false, error: 'URL demo tidak boleh menggunakan alamat IP langsung.' };
  }
  if (BLOCKED_HOSTNAME_RE.test(host) || SELF_CAPTURE_PROVIDER_HOSTS.has(host)) {
    return { ok: false, error: 'Hostname URL demo tidak diizinkan untuk pengambilan gambar.' };
  }

  let addresses: DnsAddressRecord[];
  try {
    addresses = await dnsLookup(host, { all: true });
  } catch {
    return { ok: false, error: 'Domain URL demo tidak dapat di-resolve melalui DNS.' };
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, error: 'Domain URL demo tidak memiliki alamat IP DNS yang valid.' };
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      return { ok: false, error: 'URL demo mengarah ke alamat jaringan privat atau terlarang.' };
    }
  }

  return { ok: true, url: parsed.toString(), hostname: host };
}

export function detectSafeRasterMime(bytes: Uint8Array): SafeRasterMime | null {
  if (bytes.byteLength < MIN_IMAGE_BYTES || bytes.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // WEBP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

const VARIANT_SPECS: Record<
  DemoCaptureVariant,
  { width: number; height: number; mshotsW: number; mshotsH: number }
> = {
  desktop: { width: 1440, height: 900, mshotsW: 1440, mshotsH: 900 },
  mobile: { width: 390, height: 844, mshotsW: 480, mshotsH: 960 },
};

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBytes(response: Response): Promise<Uint8Array | null> {
  const lenHeader = response.headers.get('content-length');
  if (lenHeader) {
    const parsedLen = Number.parseInt(lenHeader, 10);
    if (Number.isFinite(parsedLen) && parsedLen > MAX_IMAGE_BYTES) {
      return null;
    }
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }
  return new Uint8Array(buf);
}

async function tryCloudflareScreenshot(params: {
  url: string;
  variant: DemoCaptureVariant;
  accountId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<CaptureVariantResult | null> {
  const spec = VARIANT_SPECS[params.variant];
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    params.accountId,
  )}/browser-rendering/screenshot`;

  try {
    const res = await fetchWithTimeout(
      params.fetchImpl,
      endpoint,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: params.url,
          viewport: { width: spec.width, height: spec.height },
          gotoOptions: { waitUntil: 'networkidle2', timeout: 14000 },
          screenshotOptions: { type: 'jpeg', quality: 88 },
        }),
      },
      15_000,
    );
    if (!res.ok) {
      return { ok: false, reason: `Cloudflare Browser Rendering HTTP ${res.status}` };
    }
    const bytes = await readBoundedBytes(res);
    if (!bytes) {
      return { ok: false, reason: 'Ukuran gambar Cloudflare melebihi batas.' };
    }
    const mime = detectSafeRasterMime(bytes);
    if (!mime) {
      return { ok: false, reason: 'Format file Cloudflare bukan gambar raster yang valid.' };
    }
    return { ok: true, bytes, mime, provider: 'cloudflare' };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Gagal menghubungi Cloudflare Browser Rendering.',
    };
  }
}

async function tryMshotsScreenshot(params: {
  url: string;
  variant: DemoCaptureVariant;
  fetchImpl: typeof fetch;
  sleepImpl: SleepFn;
}): Promise<CaptureVariantResult> {
  const spec = VARIANT_SPECS[params.variant];
  const mshotsUrl =
    `https://s0.wp.com/mshots/v1/${encodeURIComponent(params.url)}` +
    `?w=${spec.mshotsW}&h=${spec.mshotsH}&vpw=${spec.width}&vph=${spec.height}`;

  const deadline = Date.now() + 15_000;
  let lastReason = 'mShots belum mengembalikan screenshot.';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    try {
      const res = await fetchWithTimeout(
        params.fetchImpl,
        mshotsUrl,
        {
          method: 'GET',
          redirect: 'manual',
          headers: { Accept: 'image/jpeg,image/png,image/webp,*/*' },
        },
        Math.min(8_000, remaining),
      );

      if (res.status === 307 || res.status === 302) {
        lastReason = 'mShots masih memproses antrean render URL demo.';
      } else if (res.status === 200) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.startsWith('image/')) {
          const bytes = await readBoundedBytes(res);
          if (bytes) {
            const mime = detectSafeRasterMime(bytes);
            if (mime) {
              return { ok: true, bytes, mime, provider: 'mshots' };
            }
            lastReason = 'Hasil gambar mShots terlalu kecil atau bukan WEBP/PNG/JPG.';
          } else {
            lastReason = 'Ukuran screenshot mShots melebihi batas.';
          }
        } else {
          lastReason = `mShots mengembalikan tipe konten tidak valid (${contentType || 'kosong'}).`;
        }
      } else {
        lastReason = `mShots mengembalikan HTTP ${res.status}.`;
      }
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'Gagal menghubungi mShots.';
    }

    if (attempt < 4 && deadline - Date.now() > 2200) {
      await params.sleepImpl(2000);
    }
  }

  return { ok: false, reason: lastReason };
}

async function tryMicrolinkScreenshot(params: {
  url: string;
  variant: DemoCaptureVariant;
  fetchImpl: typeof fetch;
}): Promise<CaptureVariantResult> {
  const spec = VARIANT_SPECS[params.variant];
  const endpoint =
    `https://api.microlink.io/?url=${encodeURIComponent(params.url)}` +
    `&screenshot=true&meta=false&viewport.width=${spec.width}&viewport.height=${spec.height}`;

  try {
    const res = await fetchWithTimeout(
      params.fetchImpl,
      endpoint,
      { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } },
      10_000,
    );
    if (!res.ok) {
      return { ok: false, reason: `Microlink mengembalikan HTTP ${res.status}.` };
    }
    const payload = (await res.json().catch(() => null)) as {
      status?: string;
      data?: { screenshot?: { url?: string } };
    } | null;

    const screenshotUrl = payload?.data?.screenshot?.url;
    if (payload?.status !== 'success' || !screenshotUrl || !isSafeHttpsUrl(screenshotUrl)) {
      return { ok: false, reason: 'Microlink tidak mengembalikan URL screenshot yang valid.' };
    }

    const imgRes = await fetchWithTimeout(
      params.fetchImpl,
      screenshotUrl,
      { method: 'GET', redirect: 'error' },
      10_000,
    );
    if (!imgRes.ok) {
      return { ok: false, reason: `Unduhan gambar Microlink gagal (HTTP ${imgRes.status}).` };
    }
    const bytes = await readBoundedBytes(imgRes);
    if (!bytes) {
      return { ok: false, reason: 'Ukuran gambar Microlink melebihi batas.' };
    }
    const mime = detectSafeRasterMime(bytes);
    if (!mime) {
      return { ok: false, reason: 'Format gambar Microlink bukan WEBP/PNG/JPG yang valid.' };
    }
    return { ok: true, bytes, mime, provider: 'microlink' };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Gagal menghubungi Microlink.',
    };
  }
}

export async function captureDemoVariant(params: {
  url: string;
  variant: DemoCaptureVariant;
  fetchImpl?: typeof fetch;
  sleepImpl?: SleepFn;
  env?: {
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_BROWSER_TOKEN?: string;
  };
}): Promise<CaptureVariantResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const sleepImpl =
    params.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const env = params.env ?? process.env;

  const failureReasons: string[] = [];

  const cfAccountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const cfToken = env.CLOUDFLARE_BROWSER_TOKEN?.trim();
  if (cfAccountId && cfToken) {
    const cfRes = await tryCloudflareScreenshot({
      url: params.url,
      variant: params.variant,
      accountId: cfAccountId,
      token: cfToken,
      fetchImpl,
    });
    if (cfRes?.ok) return cfRes;
    if (cfRes && !cfRes.ok) failureReasons.push(cfRes.reason);
  }

  const mshotsRes = await tryMshotsScreenshot({
    url: params.url,
    variant: params.variant,
    fetchImpl,
    sleepImpl,
  });
  if (mshotsRes.ok) return mshotsRes;
  failureReasons.push(mshotsRes.reason);

  const microlinkRes = await tryMicrolinkScreenshot({
    url: params.url,
    variant: params.variant,
    fetchImpl,
  });
  if (microlinkRes.ok) return microlinkRes;
  failureReasons.push(microlinkRes.reason);

  return {
    ok: false,
    reason: failureReasons.join(' | ') || 'Tidak ada layanan screenshot live yang berhasil.',
  };
}

export async function captureDemoScreenshots(
  rawUrl: string,
  variants: DemoCaptureVariant[] = ['desktop', 'mobile'],
  deps?: {
    fetchImpl?: typeof fetch;
    dnsLookup?: DnsLookupFn;
    sleepImpl?: SleepFn;
    env?: {
      CLOUDFLARE_ACCOUNT_ID?: string;
      CLOUDFLARE_BROWSER_TOKEN?: string;
    };
  },
): Promise<CaptureScreenshotsResult> {
  const validation = await validatePublicCaptureUrl(rawUrl, deps?.dnsLookup);
  if (!validation.ok) {
    return {
      urlValidationError: validation.error,
      url: rawUrl,
      hostname: '',
      desktop: null,
      mobile: null,
    };
  }

  const uniqueVariants = Array.from(new Set(variants));
  const wantDesktop = uniqueVariants.includes('desktop');
  const wantMobile = uniqueVariants.includes('mobile');

  const [desktop, mobile] = await Promise.all([
    wantDesktop
      ? captureDemoVariant({
          url: validation.url,
          variant: 'desktop',
          fetchImpl: deps?.fetchImpl,
          sleepImpl: deps?.sleepImpl,
          env: deps?.env,
        })
      : Promise.resolve(null),
    wantMobile
      ? captureDemoVariant({
          url: validation.url,
          variant: 'mobile',
          fetchImpl: deps?.fetchImpl,
          sleepImpl: deps?.sleepImpl,
          env: deps?.env,
        })
      : Promise.resolve(null),
  ]);

  return {
    url: validation.url,
    hostname: validation.hostname,
    desktop,
    mobile,
  };
}
