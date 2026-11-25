import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPortfolioProjectSchema } from '@ekalliptus/contracts';
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
  it('rejects negative prices and fixed pricing without positive price_amount', () => {
    const neg = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'fixed',
      price_amount: -500,
    });
    assert.equal(neg.success, false);

    const missingPrice = createPortfolioProjectSchema.safeParse({
      title: 'Web Toko',
      price_type: 'fixed',
      price_amount: null,
    });
    assert.equal(missingPrice.success, false);

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
  });
});
