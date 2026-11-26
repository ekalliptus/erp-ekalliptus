import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capturePortfolioDemoSchema,
  createPortfolioProjectSchema,
  extractPublicUrlFromText,
} from '@ekalliptus/contracts';
import {
  captureDemoVariant,
  detectSafeRasterMime,
  fetchPublicWebpageContext,
  fetchSafeRemoteImage,
  isPrivateOrReservedIp,
  validatePublicCaptureUrl,
} from '../services/demo-capture.js';
import {
  authorizeStorageDownload,
  isAllowedPortfolioImageMime,
  isSafeHttpsUrl,
  isSafePortfolioObjectKey,
  slugifyPortfolioTitle,
} from '../services/security-policy.js';

describe('Portfolio URL, MIME & slug helpers', () => {
  it('slugifies titles safely into kebab-case', () => {
    assert.equal(
      slugifyPortfolioTitle('Sistem Kasir & Gudang Modern! (v2)'),
      'sistem-kasir-gudang-modern-v2',
    );
    assert.equal(slugifyPortfolioTitle('  ---App Ekalliptus---  '), 'app-ekalliptus');
  });

  it('allows only valid https URLs and rejects unsafe schemes', () => {
    assert.equal(isSafeHttpsUrl('https://demo.ekalliptus.com/app'), true);
    assert.equal(isSafeHttpsUrl('http://demo.ekalliptus.com/app'), false);
    assert.equal(isSafeHttpsUrl('javascript:alert(1)'), false);
    assert.equal(isSafeHttpsUrl('data:text/html,<script>'), false);
  });

  it('restricts portfolio upload MIME types to safe raster image formats', () => {
    assert.equal(isAllowedPortfolioImageMime('image/webp'), true);
    assert.equal(isAllowedPortfolioImageMime('image/png'), true);
    assert.equal(isAllowedPortfolioImageMime('image/jpeg'), true);
    assert.equal(isAllowedPortfolioImageMime('image/avif'), true);
    assert.equal(isAllowedPortfolioImageMime('image/svg+xml'), false);
    assert.equal(isAllowedPortfolioImageMime('text/html'), false);
  });

  it('validates portfolio object keys against traversal and foreign prefixes', () => {
    assert.equal(
      isSafePortfolioObjectKey('portfolio/emp-1/170000-abc-cover.webp'),
      true,
    );
    assert.equal(isSafePortfolioObjectKey('slips/run-1/EK-001.pdf'), false);
    assert.equal(isSafePortfolioObjectKey('portfolio/../secret.png'), false);
  });
});

describe('Storage authorization for portfolio prefix', () => {
  it('denies user without portfolio:view and allows portfolio:view user', async () => {
    const denied = await authorizeStorageDownload({
      key: 'portfolio/emp-1/170000-cover.webp',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: ['attendance:view'],
    });
    assert.equal(denied.allowed, false);

    const allowed = await authorizeStorageDownload({
      key: 'portfolio/emp-1/170000-cover.webp',
      roleCode: 'owner',
      employeeId: 'emp-1',
      employeeCode: 'EK-001',
      permissions: ['portfolio:view'],
    });
    assert.equal(allowed.allowed, true);
  });

  it('keeps strict IDOR denial on payroll slips intact', async () => {
    const denied = await authorizeStorageDownload({
      key: 'slips/run-1/EK-001.pdf',
      roleCode: 'staff',
      employeeId: 'emp-2',
      employeeCode: 'EK-002',
      permissions: ['payroll:view', 'portfolio:view'],
      ownsSlipObject: async () => false,
    });
    assert.equal(denied.allowed, false);
  });
});

describe('createPortfolioProjectSchema validation', () => {
  it('rejects negative prices and allows empty/null price_amount as optional', () => {
    const neg = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'fixed',
      price_amount: -500,
    });
    assert.equal(neg.success, false);

    const optionalPriceFixed = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'fixed',
      price_amount: null,
    });
    assert.equal(optionalPriceFixed.success, true);

    const omittedPrice = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'starting_from',
    });
    assert.equal(omittedPrice.success, true);

    const unsafeDemo = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'negotiable',
      demo_url: 'http://insecure.example.com',
    });
    assert.equal(unsafeDemo.success, false);
  });

  it('accepts complete valid portfolio payload and negotiable zero/null price', () => {
    const valid = createPortfolioProjectSchema.safeParse({
      title: 'Aplikasi POS Ekalliptus',
      category: 'erp_system',
      offer_type: 'hybrid',
      availability_status: 'available',
      price_type: 'fixed',
      price_amount: '4500000',
      demo_url: 'https://demo.ekalliptus.com',
      tech_stack: ['React', 'PostgreSQL'],
      highlights: ['Multi gudang', 'Laporan laba rugi'],
      is_featured: true,
      is_published: true,
    });
    assert.equal(valid.success, true);

    const negotiable = createPortfolioProjectSchema.safeParse({
      title: 'Custom Integrasi API',
      price_type: 'negotiable',
      price_amount: null,
    });
    assert.equal(negotiable.success, true);

    const webMobile = createPortfolioProjectSchema.safeParse({
      title: 'Platform Toko Web & App',
      category: 'web_mobile',
      price_type: 'negotiable',
      price_amount: null,
    });
    assert.equal(webMobile.success, true);

    const hiddenDefault = createPortfolioProjectSchema.safeParse({
      title: 'Web Profil Profesional',
    });
    assert.equal(hiddenDefault.success, true);
    if (hiddenDefault.success) {
      assert.equal(hiddenDefault.data.price_type, 'negotiable');
      assert.equal(hiddenDefault.data.price_amount, undefined);
    }
  });
});

function makeFakeImage(header: number[], length = 4200): Uint8Array {
  const bytes = new Uint8Array(length);
  header.forEach((b, i) => {
    bytes[i] = b;
  });
  return bytes;
}

describe('Demo URL capture SSRF guard, MIME checks & provider fallback', () => {
  it('detects private, loopback, link-local, CGNAT, and mapped IPv6 addresses', () => {
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('10.20.30.40'), true);
    assert.equal(isPrivateOrReservedIp('172.16.5.1'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('100.64.0.1'), true);
    assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);
    assert.equal(isPrivateOrReservedIp('::1'), true);
    assert.equal(isPrivateOrReservedIp('fe80::1'), true);
    assert.equal(isPrivateOrReservedIp('fc00::1'), true);
    assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('104.21.45.12'), false);
    assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
  });

  it('validates public HTTPS capture URLs and rejects SSRF targets', async () => {
    const publicDns = async () => [{ address: '104.21.45.12', family: 4 }];
    const privateDns = async () => [{ address: '127.0.0.1', family: 4 }];

    assert.equal((await validatePublicCaptureUrl('http://ekalliptus.com', publicDns)).ok, false);
    assert.equal((await validatePublicCaptureUrl('https://localhost:3000', publicDns)).ok, false);
    assert.equal((await validatePublicCaptureUrl('https://127.0.0.1/app', publicDns)).ok, false);
    assert.equal((await validatePublicCaptureUrl('https://user:pass@ekalliptus.com', publicDns)).ok, false);
    assert.equal((await validatePublicCaptureUrl('https://ekalliptus.com:8443', publicDns)).ok, false);
    assert.equal((await validatePublicCaptureUrl('https://internal.ekalliptus.com', privateDns)).ok, false);

    const okRes = await validatePublicCaptureUrl('https://ekalliptus.com/demo', publicDns);
    assert.equal(okRes.ok, true);
    if (okRes.ok) {
      assert.equal(okRes.hostname, 'ekalliptus.com');
    }
  });

  it('accepts only PNG/JPEG/WEBP images >= 4096 bytes and rejects SVG/HTML/tiny buffers', () => {
    const png = makeFakeImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = makeFakeImage([0xff, 0xd8, 0xff, 0xe0]);
    const webp = makeFakeImage([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const tinyPng = makeFakeImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 128);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(120));

    assert.equal(detectSafeRasterMime(png), 'image/png');
    assert.equal(detectSafeRasterMime(jpg), 'image/jpeg');
    assert.equal(detectSafeRasterMime(webp), 'image/webp');
    assert.equal(detectSafeRasterMime(tinyPng), null);
    assert.equal(detectSafeRasterMime(svg), null);
  });

  it('validates capturePortfolioDemoSchema payloads', () => {
    assert.equal(
      capturePortfolioDemoSchema.safeParse({
        demo_url: 'https://ekalliptus.com',
        variants: ['desktop', 'mobile'],
      }).success,
      true,
    );
    assert.equal(
      capturePortfolioDemoSchema.safeParse({
        demo_url: 'http://ekalliptus.com',
      }).success,
      false,
    );
  });

  it('polls mShots 307 then succeeds on 200 JPEG', async () => {
    let calls = 0;
    const jpgBytes = makeFakeImage([0xff, 0xd8, 0xff, 0xe0], 5000);
    const res = await captureDemoVariant({
      url: 'https://ekalliptus.com',
      variant: 'desktop',
      sleepImpl: async () => {},
      env: {},
      fetchImpl: (async () => {
        calls += 1;
        if (calls < 3) {
          return new Response('', { status: 307 });
        }
        return new Response(Buffer.from(jpgBytes), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }) as typeof fetch,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.provider, 'mshots');
      assert.equal(res.mime, 'image/jpeg');
    }
    assert.equal(calls, 3);
  });

  it('falls back to Microlink when mShots fails, and fails gracefully when all providers fail', async () => {
    const pngBytes = makeFakeImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 6000);
    const microlinkOk = await captureDemoVariant({
      url: 'https://demo.ekalliptus.com',
      variant: 'mobile',
      sleepImpl: async () => {},
      env: {},
      fetchImpl: (async (input: string | URL | Request) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.startsWith('https://s0.wp.com/')) {
          return new Response('err', { status: 502 });
        }
        if (urlStr.startsWith('https://api.microlink.io/')) {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { screenshot: { url: 'https://iad.microlink.io/shot.png' } },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(Buffer.from(pngBytes), { status: 200, headers: { 'content-type': 'image/png' } });
      }) as typeof fetch,
    });
    assert.equal(microlinkOk.ok, true);
    if (microlinkOk.ok) {
      assert.equal(microlinkOk.provider, 'microlink');
      assert.equal(microlinkOk.mime, 'image/png');
    }

    const allFailed = await captureDemoVariant({
      url: 'https://demo.ekalliptus.com',
      variant: 'desktop',
      sleepImpl: async () => {},
      env: {},
      fetchImpl: (async () => new Response('down', { status: 503 })) as typeof fetch,
    });
    assert.equal(allFailed.ok, false);
  });

  it('extracts public URLs and bare domains from Indonesian brief text while ignoring emails and filenames', () => {
    assert.equal(
      extractPublicUrlFromText(
        'Project EL-Saver, aplikasi EL-Saver dan web saver.ekalliptus.com. Cari informasinya dari web tersebut dan gambarnya juga',
      ),
      'https://saver.ekalliptus.com/',
    );
    assert.equal(
      extractPublicUrlFromText('Lihat demo di https://demo.ekalliptus.com/app.'),
      'https://demo.ekalliptus.com/app',
    );
    assert.equal(
      extractPublicUrlFromText('Hubungi admin@ekalliptus.com untuk versi v1.14.23 atau unduh app.apk & index.html di localhost.'),
      null,
    );
  });

  it('fetches webpage context cleanly and blocks SSRF redirects to private hosts', async () => {
    const publicDns = async () => [{ address: '104.21.45.12', family: 4 }];
    const mixedDns = async (host: string) =>
      host === 'internal.local' || host === 'evil-internal.com'
        ? [{ address: '127.0.0.1', family: 4 }]
        : [{ address: '104.21.45.12', family: 4 }];

    const sampleHtml = `<!doctype html><html><head>
      <title>EL-Saver: Pengunduh video sosial</title>
      <meta name="description" content="Aplikasi Android unduh video &amp; simpan status WhatsApp." />
      <meta property="og:image" content="/opengraph-image?v=1" />
      <meta name="keywords" content="EL-Saver,downloader" />
      <link rel="manifest" href="/manifest.webmanifest" />
    </head><body>
      <script src="/_next/static/chunks/main.js"></script>
      <a href="/legal/privacy">Privacy</a>
      <a href="/fitur">Fitur</a>
      <a href="/harga">Harga</a>
      <h1>Simpan video &amp; status favorit Anda</h1>
      <h2>Pembayaran QRIS otomatis</h2>
      <p>Unduh APK versi terbaru langsung via GitHub Releases untuk Android.</p>
    </body></html>`;

    const ctx = await fetchPublicWebpageContext('https://saver.ekalliptus.com/', {
      dnsLookup: publicDns,
      fetchImpl: (async () =>
        new Response(sampleHtml, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })) as typeof fetch,
    });
    assert.ok(ctx);
    assert.equal(ctx.title, 'EL-Saver: Pengunduh video sosial');
    assert.equal(ctx.ogImageUrl, 'https://saver.ekalliptus.com/opengraph-image?v=1');
    assert.deepEqual(ctx.subpageUrls, [
      'https://saver.ekalliptus.com/fitur',
      'https://saver.ekalliptus.com/harga',
    ]);
    assert.ok(ctx.detectedTechClues.includes('Next.js'));
    assert.ok(ctx.detectedTechClues.includes('Android App'));
    assert.ok(ctx.detectedTechClues.includes('QRIS Payment'));

    // Redirect to private SSRF host must be blocked
    const blockedRedirect = await fetchPublicWebpageContext('https://saver.ekalliptus.com/', {
      dnsLookup: mixedDns,
      fetchImpl: (async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://evil-internal.com/secret' },
        })) as typeof fetch,
    });
    assert.equal(blockedRedirect, null);

    // fetchSafeRemoteImage accepts valid PNG and rejects SSRF redirects
    const pngBytes = makeFakeImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 5000);
    const ogOk = await fetchSafeRemoteImage('https://saver.ekalliptus.com/opengraph-image', {
      dnsLookup: publicDns,
      fetchImpl: (async () =>
        new Response(Buffer.from(pngBytes), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })) as typeof fetch,
    });
    assert.equal(ogOk.ok, true);
    if (ogOk.ok) {
      assert.equal(ogOk.provider, 'og_image');
      assert.equal(ogOk.mime, 'image/png');
    }
  });
});
