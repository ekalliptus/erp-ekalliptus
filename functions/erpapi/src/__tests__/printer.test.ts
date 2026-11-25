import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvePrintJobSchema, upsertPrintPricingRuleSchema } from '@ekalliptus/contracts';
import {
  calculatePrintJobPricing,
  hashAgentToken,
  parsePageRangeCount,
  sanitizeDeviceForClient,
  verifyAgentTokenHash,
} from '../modules/printer.js';
import { authorizeStorageDownload } from '../services/security-policy.js';

describe('Smart Printer unit logic', () => {
  it('parses page ranges accurately and rejects out-of-bounds ranges', () => {
    assert.equal(parsePageRangeCount(null, 5), 5);
    assert.equal(parsePageRangeCount('', 4), 4);
    assert.equal(parsePageRangeCount('1-3,5', 10), 4);
    assert.equal(parsePageRangeCount('2,2-3,3', 5), 2);
    assert.throws(() => parsePageRangeCount('6-8', 5), /melebihi/);
    assert.throws(() => parsePageRangeCount('5-2', 10), /tidak valid/);
  });

  it('computes BIGINT pricing with duplex discount and job discount without floats', () => {
    const standard = calculatePrintJobPricing({
      pagesToPrint: 4,
      copies: 2,
      pricePerPage: 1500n,
      duplex: false,
      duplexDiscountPerPage: 200n,
      discountAmount: 1000n,
    });
    assert.equal(standard.unitPricePerPage, 1500n);
    assert.equal(standard.totalPrice, 11000n);

    const duplexCapped = calculatePrintJobPricing({
      pagesToPrint: 3,
      copies: 1,
      pricePerPage: 500n,
      duplex: true,
      duplexDiscountPerPage: 100n,
      discountAmount: 5000n,
    });
    assert.equal(duplexCapped.unitPricePerPage, 400n);
    assert.equal(duplexCapped.totalPrice, 0n);
  });

  it('verifies print agent SHA-256 tokens using constant-time comparison', () => {
    const raw = 'ekp_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hash = hashAgentToken(raw);
    assert.equal(hash.length, 64);
    assert.equal(verifyAgentTokenHash(raw, hash), true);
    assert.equal(verifyAgentTokenHash(`${raw.slice(0, -1)}0`, hash), false);
    assert.equal(verifyAgentTokenHash('short', hash), false);
  });

  it('validates BIGINT coercion and page_range format in print contracts', () => {
    const okPrice = upsertPrintPricingRuleSchema.safeParse({
      paper_size: 'a4',
      color_mode: 'color',
      price_per_page: '1500',
      duplex_discount_per_page: 0,
      is_active: true,
    });
    assert.equal(okPrice.success, true);
    if (okPrice.success) {
      assert.equal(okPrice.data.price_per_page, 1500n);
    }

    const badPageRange = approvePrintJobSchema.safeParse({
      page_range: '1-3; rm -rf',
    });
    assert.equal(badPageRange.success, false);
  });

  it('enforces storage download ACL for print-jobs prefix', async () => {
    const allowed = await authorizeStorageDownload({
      key: 'print-jobs/2026/11/doc-123.pdf',
      roleCode: 'staff',
      employeeId: 'emp-1',
      employeeCode: 'EK-002',
      permissions: ['printer:view'],
    });
    assert.equal(allowed.allowed, true);

    const denied = await authorizeStorageDownload({
      key: 'print-jobs/2026/11/doc-123.pdf',
      roleCode: 'warehouse',
      employeeId: 'emp-2',
      employeeCode: 'EK-003',
      permissions: ['inventory:view'],
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'missing_printer_view');
  });

  it('exposes OpenWA pairing QR only when includePairing=true, online, qr_required, and fresh', () => {
    const now = new Date();
    const baseRow = {
      id: '11111111-1111-1111-1111-111111111111',
      device_name: 'Kasir Printer',
      host: '192.168.0.5',
      mdns_host: null,
      model: 'HP Smart Tank 580-590 series',
      agent_token_hash: 'secret_hash_should_never_leak',
      is_active: true,
      last_heartbeat_at: now,
      printer_state: 'idle',
      printer_state_reasons: ['none'],
      ink_levels: [],
      capabilities: {},
      openwa_status: 'qr_required',
      openwa_qr_code: '2@sample_qr_payload',
      openwa_link_code: '12345678',
      openwa_qr_updated_at: now,
      created_by: null,
      created_at: now,
      updated_at: now,
    };

    const allowedWeb = sanitizeDeviceForClient(baseRow, { includePairing: true });
    assert.equal('agent_token_hash' in allowedWeb, false);
    assert.equal(allowedWeb.is_online, true);
    assert.equal(allowedWeb.openwa_qr_code, '2@sample_qr_payload');
    assert.equal(allowedWeb.openwa_link_code, '12345678');

    const strippedMobileOrViewOnly = sanitizeDeviceForClient(baseRow, { includePairing: false });
    assert.equal(strippedMobileOrViewOnly.openwa_qr_code, null);
    assert.equal(strippedMobileOrViewOnly.openwa_link_code, null);

    const strippedConnected = sanitizeDeviceForClient(
      { ...baseRow, openwa_status: 'connected' },
      { includePairing: true },
    );
    assert.equal(strippedConnected.openwa_qr_code, null);

    const strippedOffline = sanitizeDeviceForClient(
      { ...baseRow, last_heartbeat_at: new Date(Date.now() - 120_000) },
      { includePairing: true },
    );
    assert.equal(strippedOffline.openwa_qr_code, null);

    const strippedExpiredQr = sanitizeDeviceForClient(
      { ...baseRow, openwa_qr_updated_at: new Date(Date.now() - 120_000) },
      { includePairing: true },
    );
    assert.equal(strippedExpiredQr.openwa_qr_code, null);
  });
});
