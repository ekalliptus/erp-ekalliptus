import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { countDocumentPages, isOfficeExtension } from '../src/doc-inspect.mjs';
import { loadBridgeEnv } from '../src/env-loader.mjs';
import { classifyIncomingMessage, MAX_PRINT_FILE_BYTES } from '../src/message-filter.mjs';
import { decodeDecryptedMedia } from '../src/openwa-worker.mjs';

describe('OpenWA personal print filter (Option B)', () => {
  it('ignores group chats, broadcasts, fromMe, stickers, voice notes, video, and plain text', () => {
    assert.equal(
      classifyIncomingMessage({
        id: 'm1',
        fromMe: true,
        chatId: '628111@c.us',
        hasMedia: true,
        mimetype: 'application/pdf',
        filename: 'a.pdf',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm2',
        isGroupMsg: true,
        chatId: '12345@g.us',
        hasMedia: true,
        mimetype: 'application/pdf',
        filename: 'a.pdf',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm3',
        chatId: 'status@broadcast',
        hasMedia: true,
        mimetype: 'image/jpeg',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm4',
        chatId: '628111@c.us',
        type: 'sticker',
        isSticker: true,
        hasMedia: true,
        mimetype: 'image/webp',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm5',
        chatId: '628111@c.us',
        type: 'ptt',
        hasMedia: true,
        mimetype: 'audio/ogg',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm6',
        chatId: '628111@c.us',
        type: 'video',
        hasMedia: true,
        mimetype: 'video/mp4',
      }).action,
      'ignore',
    );
    assert.equal(
      classifyIncomingMessage({
        id: 'm7',
        chatId: '628111@c.us',
        type: 'chat',
        hasMedia: false,
        body: 'Halo admin',
      }).action,
      'ignore',
    );
  });

  it('rejects oversized files (>25MB) and accepts valid personal PDF/image documents', () => {
    const tooBig = classifyIncomingMessage({
      id: 'm-big',
      chatId: '6281999900306@c.us',
      type: 'document',
      hasMedia: true,
      mimetype: 'application/pdf',
      filename: 'skripsi-besar.pdf',
      size: MAX_PRINT_FILE_BYTES + 1,
    });
    assert.equal(tooBig.action, 'reject_size');

    const okPdf = classifyIncomingMessage({
      id: 'm-ok-pdf',
      chatId: '6281999900306@c.us',
      type: 'document',
      hasMedia: true,
      mimetype: 'application/pdf',
      filename: 'invoice-klien.pdf',
      size: 120_000,
      sender: { pushname: 'Budi Print' },
      caption: 'Tolong print A4 warna 2 rangkap',
    });
    assert.equal(okPdf.action, 'ingest');
    assert.equal(okPdf.customerName, 'Budi Print');
    assert.equal(okPdf.customerPhone, '6281999900306');
    assert.equal(okPdf.filename, 'invoice-klien.pdf');

    const okPhoto = classifyIncomingMessage({
      id: 'm-ok-jpg',
      chatId: '628123456789@c.us',
      type: 'image',
      hasMedia: true,
      mimetype: 'image/jpeg',
      size: 540_000,
    });
    assert.equal(okPhoto.action, 'ingest');
    assert.ok(okPhoto.filename.endsWith('.jpg'));
  });
});

describe('Document inspection & PDF page counter', () => {
  it('counts exact pages from generated multi-page PDF buffer', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const pdfBytes = Buffer.from(await doc.save());

    const count = await countDocumentPages({
      buffer: pdfBytes,
      filename: 'multi-3-hal.pdf',
      mimeType: 'application/pdf',
    });
    assert.equal(count, 3);
    assert.equal(isOfficeExtension('laporan.docx'), true);
    assert.equal(isOfficeExtension('laporan.pdf'), false);
  });
});

describe('OpenWA v5 DataURL media decoder & message id handling', () => {
  it('decodes v5 base64 DataURL media strings into exact binary Buffer', () => {
    const buf = decodeDecryptedMedia('data:application/pdf;base64,JVBERi0xLjQ=');
    assert.equal(buf.toString('utf8'), '%PDF-1.4');
  });

  it('returns Buffer inputs intact without altering bytes', () => {
    const raw = Buffer.from('hello');
    const out = decodeDecryptedMedia(raw);
    assert.equal(Buffer.isBuffer(out), true);
    assert.equal(out.toString('utf8'), 'hello');
  });

  it('extracts serialized message id when id is an object', () => {
    const res = classifyIncomingMessage({
      id: { _serialized: 'true_628111@c.us_ABC123' },
      chatId: '628111@c.us',
      type: 'document',
      hasMedia: true,
      mimetype: 'application/pdf',
      filename: 'berkas.pdf',
      size: 1024,
    });
    assert.equal(res.action, 'ingest');
    assert.equal(res.waMessageId, 'true_628111@c.us_ABC123');
  });
});

describe('Bridge env loader (.env and .env.local precedence)', () => {
  it('loads root .env.local over bridge .env, prioritizes bridge .env.local, preserves shell env, and ignores empty overrides', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ekp-env-test-'));
    try {
      const bridgeDir = path.join(tmpRoot, 'services', 'print-bridge');
      await fs.mkdir(bridgeDir, { recursive: true });

      await fs.writeFile(
        path.join(bridgeDir, '.env'),
        'PRINT_AGENT_TOKEN=ekp_ganti_dengan_token_bridge_anda\nPRINTER_HOST=192.168.0.5\nERP_API_BASE_URL=https://bridge-env.test\nSHELL_VAR=from_bridge_env\n',
      );
      await fs.writeFile(
        path.join(tmpRoot, '.env.local'),
        'PRINT_AGENT_TOKEN=ekp_from_root_env_local\nPRINTER_HOST=\nSHELL_VAR=from_root_local\n',
      );

      const env1 = { SHELL_VAR: 'from_shell' };
      loadBridgeEnv({ bridgeRoot: bridgeDir, targetEnv: env1 });
      assert.equal(env1.PRINT_AGENT_TOKEN, 'ekp_from_root_env_local');
      assert.equal(env1.PRINTER_HOST, '192.168.0.5');
      assert.equal(env1.ERP_API_BASE_URL, 'https://bridge-env.test');
      assert.equal(env1.SHELL_VAR, 'from_shell');

      await fs.writeFile(
        path.join(bridgeDir, '.env.local'),
        'PRINT_AGENT_TOKEN=ekp_from_bridge_env_local\n',
      );
      const env2 = { SHELL_VAR: 'from_shell' };
      loadBridgeEnv({ bridgeRoot: bridgeDir, targetEnv: env2 });
      assert.equal(env2.PRINT_AGENT_TOKEN, 'ekp_from_bridge_env_local');
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
