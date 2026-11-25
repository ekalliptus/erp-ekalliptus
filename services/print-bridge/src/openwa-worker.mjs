import fs from 'node:fs/promises';
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
      // Try next
    }
  }
  return undefined;
}

export async function startOpenWaWorker({
  apiClient,
  sessionId = 'ekalliptus-printer',
  sessionPath = './.openwa-session',
  chromePath = '',
  logger = console,
}) {
  let waModule;
  try {
    waModule = await import('@open-wa/wa-automate');
  } catch (err) {
    logger.warn('[openwa] Paket @open-wa/wa-automate belum siap:', err?.message || err);
    return {
      status: 'disconnected',
      getStatus: () => 'disconnected',
      sendText: async () => false,
      close: async () => {},
    };
  }

  const { create, decryptMedia } = waModule;
  const executablePath = await resolveChromeExe(chromePath);
  let status = 'qr_required';
  let client = null;

  try {
    client = await create({
      sessionId,
      sessionDataPath: sessionPath,
      headless: true,
      useChrome: Boolean(executablePath),
      executablePath,
      multiDevice: true,
      qrTimeout: 0,
      authTimeout: 0,
      killProcessOnBrowserClose: true,
      disableSpins: true,
      logConsole: false,
      popup: false,
      chromiumArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    status = 'connected';
    logger.log(`[openwa] Terhubung (session: ${sessionId})`);
  } catch (err) {
    status = 'disconnected';
    logger.error('[openwa] Gagal inisialisasi sesi WhatsApp:', err?.message || err);
    return {
      status: 'disconnected',
      getStatus: () => 'disconnected',
      sendText: async () => false,
      close: async () => {},
    };
  }

  client.onStateChanged((state) => {
    const normalized = String(state || '').toUpperCase();
    if (normalized === 'CONNECTED') {
      status = 'connected';
    } else if (normalized.includes('QR') || normalized === 'UNPAIRED') {
      status = 'qr_required';
    } else if (normalized === 'CONFLICT' || normalized === 'UNLAUNCHED') {
      status = 'disconnected';
    }
    logger.log(`[openwa] State berubah -> ${state} (${status})`);
  });

  client.onMessage(async (message) => {
    try {
      const decision = classifyIncomingMessage(message);
      if (decision.action === 'ignore') {
        return;
      }

      if (decision.action === 'reject_size') {
        await client
          .sendText(
            decision.chatId,
            `Maaf, file "${decision.filename}" melebihi batas maksimal 25 MB untuk cetak otomatis.`,
          )
          .catch(() => {});
        return;
      }

      const buffer = Buffer.from(await decryptMedia(message));
      if (buffer.length === 0) return;
      if (buffer.length > MAX_PRINT_FILE_BYTES) {
        await client
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

  return {
    getStatus: () => status,
    sendText: async (chatId, text) => {
      if (!client || status !== 'connected') {
        return false;
      }
      await client.sendText(chatId, text);
      return true;
    },
    close: async () => {
      try {
        if (client && typeof client.kill === 'function') {
          await client.kill();
        }
      } catch {
        // Ignore shutdown errors
      }
    },
  };
}
