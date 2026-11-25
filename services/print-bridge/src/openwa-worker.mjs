import fs from 'node:fs/promises';
import path from 'node:path';
import { countDocumentPages } from './doc-inspect.mjs';
import { classifyIncomingMessage, MAX_PRINT_FILE_BYTES } from './message-filter.mjs';

async function resolveChromeExe(preferredPath) {
  const candidates = [
    preferredPath,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const exe of candidates) {
    try {
      await fs.access(exe);
      return exe;
    } catch {
      // Try next candidate executable
    }
  }
  return undefined;
}

/**
 * Decode media payload returned by OpenWA v5 client.decryptMedia (DataURL string)
 * as well as legacy Buffer, Uint8Array, or plain base64 strings.
 */
export function decodeDecryptedMedia(raw) {
  if (!raw) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return Buffer.alloc(0);
    const dataUrlMatch = /^data:[^;,]+(?:;[^;,=]+=[^;,]+)*;base64,(.+)$/is.exec(trimmed);
    const base64Body = dataUrlMatch ? dataUrlMatch[1] : trimmed;
    return Buffer.from(base64Body, 'base64');
  }
  return Buffer.alloc(0);
}

export function startOpenWaWorker({
  apiClient,
  sessionId = 'ekalliptus-printer',
  sessionPath = './.openwa-session',
  chromePath = '',
  headless = true,
  linkCode = '',
  onStateChange = null,
  logger = console,
}) {
  const resolvedSessionPath = path.resolve(sessionPath);
  let status = 'qr_required';
  let currentQrCode = null;
  let currentLinkCode = null;
  let client = null;
  let activeBootClient = null;
  let stopped = false;
  let bootGen = 0;

  const notifyStateChange = () => {
    if (typeof onStateChange === 'function') {
      try {
        onStateChange();
      } catch {
        // Ignore listener errors
      }
    }
  };

  async function stopSession({ clearSession = false } = {}) {
    bootGen += 1;
    const target = client || activeBootClient;
    client = null;
    activeBootClient = null;
    currentQrCode = null;
    currentLinkCode = null;

    if (target && typeof target.stop === 'function') {
      await target.stop('bridge_reconfigure').catch(() => {});
    }

    if (clearSession) {
      await fs.rm(resolvedSessionPath, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(resolvedSessionPath, { recursive: true }).catch(() => {});
    }
  }

  async function bootSession({ clearSession = false, nextLinkCode = linkCode } = {}) {
    await stopSession({ clearSession });
    if (stopped) return;

    const myGen = bootGen;
    status = 'qr_required';
    currentQrCode = null;
    currentLinkCode = null;
    notifyStateChange();

    let coreMod;
    let clientMod;
    let driverMod;
    let qrcodeTerminal;

    try {
      [coreMod, clientMod, driverMod] = await Promise.all([
        import('@open-wa/core'),
        import('@open-wa/client'),
        import('@open-wa/driver-puppeteer'),
      ]);
      const qrMod = await import('qrcode-terminal');
      qrcodeTerminal = qrMod.default || qrMod;
    } catch (err) {
      if (myGen !== bootGen) return;
      status = 'disconnected';
      currentQrCode = null;
      currentLinkCode = null;
      notifyStateChange();
      logger.warn('[openwa] Paket OpenWA v5 belum siap:', err?.message || err);
      return;
    }

    const createClient = coreMod.createClient || coreMod.default?.createClient;
    const Client = clientMod.Client || clientMod.default?.Client;
    const PuppeteerDriver = driverMod.PuppeteerDriver || driverMod.default?.PuppeteerDriver;
    if (
      typeof createClient !== 'function' ||
      typeof Client !== 'function' ||
      typeof PuppeteerDriver !== 'function'
    ) {
      if (myGen !== bootGen) return;
      status = 'disconnected';
      currentQrCode = null;
      currentLinkCode = null;
      notifyStateChange();
      logger.error('[openwa] Export createClient/Client/PuppeteerDriver tidak ditemukan.');
      return;
    }

    try {
      await fs.mkdir(resolvedSessionPath, { recursive: true });
      const executablePath = await resolveChromeExe(chromePath);
      const cleanLinkCode = String(nextLinkCode || '').replace(/[^\d]/g, '');

      const core = await createClient({
        driver: new PuppeteerDriver(),
        sessionId,
        sessionDataPath: resolvedSessionPath,
        headless: Boolean(headless),
        executablePath,
        browser: executablePath
          ? { source: 'system', kind: 'chrome', download: 'never' }
          : undefined,
        browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
        qrTimeoutMs: 0,
        authTimeoutMs: 0,
        logConsole: false,
        logConsoleErrors: false,
        eventMode: true,
        plugins: [],
        ...(cleanLinkCode ? { linkCode: cleanLinkCode } : {}),
      });

      if (stopped || myGen !== bootGen) {
        return;
      }

      const waClient = new Client({
        client: core,
        transport: core.getTransport(),
      });
      activeBootClient = waClient;

      let lastQrRendered = '';
      waClient.events.on('launch.auth.qr.generated', (evt) => {
        if (myGen !== bootGen) return;
        const qrData = evt?.details?.qr;
        if (qrData && typeof qrData === 'string' && !qrData.startsWith('data:image/')) {
          status = 'qr_required';
          currentQrCode = qrData;
          currentLinkCode = null;
          notifyStateChange();
          if (qrData !== lastQrRendered) {
            lastQrRendered = qrData;
            logger.log(
              '[openwa] QR Code siap. Pindai dari https://my.ekalliptus.com/printer atau terminal ini:',
            );
            qrcodeTerminal.generate(qrData, { small: true });
          }
        }
      });

      waClient.events.on('launch.auth.linkCode.generated', (evt) => {
        if (myGen !== bootGen) return;
        const code = evt?.details?.linkCode;
        if (code) {
          status = 'qr_required';
          currentLinkCode = String(code);
          currentQrCode = null;
          notifyStateChange();
          logger.log(
            `[openwa] Kode pairing 8 digit tersedia di https://my.ekalliptus.com/printer: ${code}`,
          );
        }
      });

      waClient.events.on('launch.auth.qr.expired', () => {
        if (myGen !== bootGen) return;
        currentQrCode = null;
        notifyStateChange();
      });

      waClient.events.on('launch.auth.qr.scanned', () => {
        if (myGen !== bootGen) return;
        logger.log('[openwa] QR Code terpindai, sedang menghubungkan perangkat...');
      });

      waClient.events.on('launch.auth.pairing', () => {
        if (myGen !== bootGen) return;
        logger.log('[openwa] Sedang menyinkronkan sesi WhatsApp...');
      });

      waClient.events.on('auth.logout', () => {
        if (myGen !== bootGen) return;
        status = 'qr_required';
        currentQrCode = null;
        currentLinkCode = null;
        notifyStateChange();
        logger.log('[openwa] Sesi WhatsApp keluar (logout). Scan QR ulang diperlukan.');
      });

      await waClient.start();

      if (stopped || myGen !== bootGen) {
        await waClient.stop('bridge_shutdown').catch(() => {});
        return;
      }

      client = waClient;
      status = 'connected';
      currentQrCode = null;
      currentLinkCode = null;
      notifyStateChange();
      logger.log(`[openwa] Terhubung (session: ${sessionId})`);

      waClient.onStateChanged((state) => {
        if (myGen !== bootGen) return;
        const normalized = String(state || '').toUpperCase();
        if (normalized === 'CONNECTED' || normalized === 'READY') {
          status = 'connected';
          currentQrCode = null;
          currentLinkCode = null;
        } else if (normalized.includes('QR') || normalized === 'UNPAIRED') {
          status = 'qr_required';
        } else if (
          normalized === 'CONFLICT' ||
          normalized === 'UNLAUNCHED' ||
          normalized === 'DISCONNECTED'
        ) {
          status = 'disconnected';
          currentQrCode = null;
          currentLinkCode = null;
        }
        notifyStateChange();
        logger.log(`[openwa] State berubah -> ${state} (${status})`);
      });

      waClient.onMessage(async (message) => {
        if (myGen !== bootGen) return;
        try {
          const decision = classifyIncomingMessage(message);
          if (decision.action === 'ignore') {
            return;
          }

          if (decision.action === 'reject_size') {
            await waClient
              .sendText(
                decision.chatId,
                `Maaf, file "${decision.filename}" melebihi batas maksimal 25 MB untuk cetak otomatis.`,
              )
              .catch(() => {});
            return;
          }

          const rawMedia = await waClient.decryptMedia(message);
          const buffer = decodeDecryptedMedia(rawMedia);
          if (buffer.length === 0) return;
          if (buffer.length > MAX_PRINT_FILE_BYTES) {
            await waClient
              .sendText(
                decision.chatId,
                `Maaf, file "${decision.filename}" melebihi batas maksimal 25 MB.`,
              )
              .catch(() => {});
            return;
          }

          const detectedPages = await countDocumentPages({
            buffer,
            filename: decision.filename,
            mimeType: decision.mimeType,
          });

          const presign = await apiClient.presignUpload({
            filename: decision.filename,
            content_type: decision.mimeType,
            file_size_bytes: buffer.length,
          });
          await apiClient.uploadBufferToS3(presign.upload_url, buffer, decision.mimeType);

          const ingested = await apiClient.ingestJob({
            wa_message_id: decision.waMessageId,
            wa_chat_id: decision.chatId,
            customer_name: decision.customerName,
            customer_phone: decision.customerPhone,
            customer_note: decision.customerNote,
            file_name: decision.filename,
            file_mime: decision.mimeType,
            file_size_bytes: buffer.length,
            file_object_key: presign.object_key,
            detected_page_count: detectedPages,
          });

          logger.log(
            `[openwa] Dokumen masuk -> ${ingested?.job?.job_code || decision.filename} ` +
              `(${detectedPages} hal, deduplicated=${Boolean(ingested?.deduplicated)})`,
          );
        } catch (err) {
          logger.error('[openwa] Gagal memproses pesan masuk:', err?.message || err);
        }
      });
    } catch (err) {
      if (myGen !== bootGen) return;
      status = 'disconnected';
      currentQrCode = null;
      currentLinkCode = null;
      notifyStateChange();
      logger.error('[openwa] Gagal inisialisasi sesi WhatsApp:', err?.message || err);
    }
  }

  bootSession().catch((err) => {
    status = 'disconnected';
    currentQrCode = null;
    currentLinkCode = null;
    notifyStateChange();
    logger.error('[openwa] Error fatal worker WhatsApp:', err?.message || err);
  });

  return {
    getStatus: () => status,
    getPairingState: () => ({ qrCode: currentQrCode, linkCode: currentLinkCode }),
    reconnect: async ({ clearSession = false, linkCode: nextLinkCode = '' } = {}) => {
      if (stopped) return;
      await bootSession({ clearSession, nextLinkCode });
    },
    disconnect: async ({ clearSession = true } = {}) => {
      await stopSession({ clearSession });
      status = 'disconnected';
      notifyStateChange();
    },
    sendText: async (chatId, text) => {
      if (!client || status !== 'connected') {
        return false;
      }
      await client.sendText(chatId, text);
      return true;
    },
    close: async () => {
      stopped = true;
      await stopSession({ clearSession: false });
    },
  };
}
