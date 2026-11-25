import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrintBridgeApiClient } from './api-client.mjs';
import { findLibreOfficePath, isOfficeExtension } from './doc-inspect.mjs';
import { loadBridgeEnv } from './env-loader.mjs';
import { startOpenWaWorker } from './openwa-worker.mjs';
import { resolvePrinter } from './printer/discover.mjs';
import { printJob, validateJob } from './printer/ipp.mjs';
import { getMediaSpec } from './printer/pwg-raster.mjs';
import { buildTestPageHtml, renderInputToPwg } from './printer/render.mjs';

loadBridgeEnv();

const QUALITY_MAP = {
  draft: 3,
  normal: 4,
  high: 5,
};

function normalizeColor(rawColor) {
  if (rawColor === 'mono' || rawColor === 'monochrome' || rawColor === 'sgray') {
    return { ippColorMode: 'monochrome', renderColor: 'mono' };
  }
  return { ippColorMode: 'color', renderColor: 'color' };
}

async function safeResolvePrinter(preferredHost) {
  try {
    const printer = await resolvePrinter({ host: preferredHost || null, subnetScan: false });
    return { online: true, printer, error: null };
  } catch (err) {
    return {
      online: false,
      printer: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runVerifyPrinter(preferredHost) {
  const probe = await safeResolvePrinter(preferredHost);
  if (!probe.online || !probe.printer) {
    const report = {
      ok: false,
      mode: 'verify-printer',
      reachable: false,
      host: preferredHost || 'auto',
      error: probe.error,
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const printer = probe.printer;
  const mediaSpec = getMediaSpec('a4');
  const html = buildTestPageHtml({ printer, mediaSpec });
  const rendered = await renderInputToPwg({
    html,
    media: 'a4',
    dpi: 300,
    color: 'color',
    quality: 4,
  });

  const valRes = await validateJob(printer.ip, {
    documentFormat: 'image/pwg-raster',
    jobName: 'Ekalliptus Bridge Validate Check',
    copies: 1,
    media: mediaSpec.pwgName,
    colorMode: 'color',
    quality: 4,
  });

  const report = {
    ok: valRes.ok,
    mode: 'verify-printer',
    reachable: true,
    printer: {
      ip: printer.ip,
      model: printer.model,
      state: printer.stateText,
      markers: printer.markers,
    },
    ippStatusCode: `0x${valRes.statusCode.toString(16).padStart(4, '0')}`,
    ippStatusName: valRes.statusName,
    renderedPages: rendered.renderedPages,
    pwgBytes: rendered.sizeBytes,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function executeJobPrint(job, downloadUrl, preferredHost, dryRun) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ekp-print-job-'));
  try {
    if (isOfficeExtension(job.file_name)) {
      const soffice = await findLibreOfficePath();
      if (!soffice) {
        throw new Error(
          `Dokumen Office (${path.extname(job.file_name)}) memerlukan LibreOffice (soffice.exe) pada host print-bridge. Minta pelanggan kirim PDF atau export ke PDF terlebih dahulu.`,
        );
      }
    }

    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Gagal mengunduh file dokumen (HTTP ${res.status})`);
    }
    const fileBuf = Buffer.from(await res.arrayBuffer());
    const safeName = String(job.file_name || 'document.pdf').replace(/[^A-Za-z0-9._-]/g, '_');
    const localFilePath = path.join(workDir, safeName);
    await fs.writeFile(localFilePath, fileBuf);

    const probe = await safeResolvePrinter(preferredHost);
    if (!probe.online || !probe.printer) {
      throw new Error(probe.error || 'Printer HP Smart Tank 583 tidak terjangkau di jaringan Wi-Fi.');
    }

    const mediaSpec = getMediaSpec(job.paper_size || 'a4');
    const { ippColorMode, renderColor } = normalizeColor(job.color_mode || 'color');
    const quality = QUALITY_MAP[job.quality || 'normal'] ?? 4;
    const copies = Math.min(99, Math.max(1, Number(job.copies || 1)));
    const borderless = Boolean(job.borderless);

    const rendered = await renderInputToPwg({
      filePath: localFilePath,
      media: job.paper_size || 'a4',
      dpi: 300,
      color: renderColor,
      quality,
      pages: job.page_range || null,
      orientation: job.orientation || 'auto',
      fit: job.fit || 'contain',
      borderless,
    });

    const ippOpts = {
      documentFormat: 'image/pwg-raster',
      jobName: `${job.job_code || 'PRT'} - ${safeName}`.slice(0, 80),
      copies,
      media: mediaSpec.pwgName,
      colorMode: ippColorMode,
      quality,
      borderless,
      mediaSizeMm: borderless ? { widthMm: mediaSpec.widthMm, heightMm: mediaSpec.heightMm } : null,
    };

    if (dryRun) {
      const val = await validateJob(probe.printer.ip, ippOpts);
      if (!val.ok) {
        throw new Error(`Dry-run Validate-Job ditolak printer (${val.statusName})`);
      }
      return {
        status: 'printed',
        dry_run: true,
        ipp_job_id: null,
        rendered_pages: rendered.renderedPages,
      };
    }

    const printRes = await printJob(probe.printer.ip, {
      ...ippOpts,
      data: rendered.pwgBuffer,
    });
    if (!printRes.ok) {
      throw new Error(`Print-Job ditolak printer (${printRes.statusName})`);
    }
    const jobAttr = printRes.jobAttributes?.[0] || {};
    return {
      status: 'printed',
      dry_run: false,
      ipp_job_id: typeof jobAttr['job-id'] === 'number' ? jobAttr['job-id'] : null,
      rendered_pages: rendered.renderedPages,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cliDryRun = args.includes('--dry-run');
  const envDryRun = String(process.env.PRINT_DRY_RUN || 'false').toLowerCase() === 'true';
  let serverDryRun = null;
  let effectiveHost = (process.env.PRINTER_HOST || '192.168.0.5').trim() || null;

  const isDryRunActive = () => cliDryRun || envDryRun || Boolean(serverDryRun);

  if (args.includes('--verify-printer')) {
    const result = await runVerifyPrinter(effectiveHost);
    if (!result.reachable || !result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const baseUrl = (process.env.ERP_API_BASE_URL || '').trim();
  const agentToken = (process.env.PRINT_AGENT_TOKEN || '').trim();
  if (!baseUrl || !agentToken) {
    throw new Error(
      'ERP_API_BASE_URL dan PRINT_AGENT_TOKEN wajib diisi di .env atau .env.local (services/print-bridge maupun root repo)',
    );
  }

  const apiClient = new PrintBridgeApiClient({ baseUrl, agentToken });
  const enableOpenWa = String(process.env.ENABLE_OPENWA || 'true').toLowerCase() !== 'false';
  const openwaHeadless = String(process.env.OPENWA_HEADLESS || 'true').toLowerCase() !== 'false';
  const openwaLinkPhone = (process.env.OPENWA_LINK_PHONE || '').trim();

  let heartbeatInFlight = false;
  let heartbeatQueued = false;
  let heartbeatConfirmed = false;
  let commandInFlight = false;
  let openwa = {
    getStatus: () => 'disconnected',
    getPairingState: () => ({ qrCode: null, linkCode: null }),
    reconnect: async () => {},
    disconnect: async () => {},
    sendText: async () => false,
    close: async () => {},
  };

  async function executePendingCommand(cmd) {
    if (!cmd || !cmd.command || commandInFlight) return;
    commandInFlight = true;
    const action = String(cmd.command);
    try {
      if (!enableOpenWa) {
        await apiClient.ackCommand({
          command: action,
          ok: false,
          message: 'OpenWA dinonaktifkan di bridge (ENABLE_OPENWA=false).',
        });
        return;
      }

      if (action === 'connect_qr') {
        if (openwa.getStatus() === 'connected') {
          await apiClient.ackCommand({
            command: action,
            ok: true,
            message: 'WhatsApp sudah terhubung.',
          });
        } else {
          void openwa.reconnect({ clearSession: false, linkCode: '' });
          await apiClient.ackCommand({
            command: action,
            ok: true,
            message: 'Memulai sesi QR WhatsApp...',
          });
        }
        return;
      }

      if (action === 'reset_qr') {
        void openwa.reconnect({ clearSession: true, linkCode: '' });
        await apiClient.ackCommand({
          command: action,
          ok: true,
          message: 'Sesi direset, membuat QR Code baru...',
        });
        return;
      }

      if (action === 'pair_link_code') {
        const phone = String(cmd.payload?.phone || '').replace(/[^\d]/g, '');
        if (!phone) {
          await apiClient.ackCommand({
            command: action,
            ok: false,
            message: 'Nomor WhatsApp pairing tidak ditemukan.',
          });
          return;
        }
        void openwa.reconnect({ clearSession: true, linkCode: phone });
        await apiClient.ackCommand({
          command: action,
          ok: true,
          message: 'Membuat kode pairing 8 digit...',
        });
        return;
      }

      if (action === 'logout_wa') {
        await openwa.disconnect({ clearSession: true });
        await apiClient.ackCommand({
          command: action,
          ok: true,
          message: 'Sesi WhatsApp diputuskan.',
        });
        return;
      }

      await apiClient.ackCommand({
        command: action,
        ok: false,
        message: `Perintah tidak dikenal: ${action}`,
      });
    } catch (err) {
      await apiClient
        .ackCommand({
          command: action,
          ok: false,
          message: err instanceof Error ? err.message.slice(0, 280) : 'Gagal menjalankan perintah.',
        })
        .catch(() => {});
    } finally {
      commandInFlight = false;
    }
  }

  async function tickHeartbeat() {
    if (heartbeatInFlight) {
      heartbeatQueued = true;
      return;
    }
    heartbeatInFlight = true;
    try {
      const probe = await safeResolvePrinter(effectiveHost);
      const p = probe.printer;
      const openwaStatus = openwa.getStatus();
      const pairing = openwa.getPairingState();
      const hbRes = await apiClient.heartbeat({
        printer_host: p?.ip || effectiveHost,
        printer_model: p?.model || 'HP Smart Tank 580-590 series',
        printer_state: probe.online ? p.stateText : 'offline',
        printer_state_reasons: probe.online
          ? Array.isArray(p.stateReasons)
            ? p.stateReasons.map(String)
            : [String(p.stateReasons || 'none')]
          : ['unreachable'],
        ink_levels: probe.online ? p.markers : [],
        openwa_status: openwaStatus,
        openwa_qr_code: openwaStatus === 'qr_required' ? pairing.qrCode : null,
        openwa_link_code: openwaStatus === 'qr_required' ? pairing.linkCode : null,
      });

      if (hbRes?.config) {
        if (typeof hbRes.config.dry_run_mode === 'boolean') {
          serverDryRun = hbRes.config.dry_run_mode;
        }
        if (typeof hbRes.config.host === 'string' && hbRes.config.host.trim()) {
          effectiveHost = hbRes.config.host.trim();
        }
      }

      if (!heartbeatConfirmed) {
        heartbeatConfirmed = true;
        console.log(
          `[heartbeat] Terhubung ke ERP API (device online, printer=${probe.online ? p.stateText : 'offline'}, dryRun=${isDryRunActive()}).`,
        );
      }

      if (hbRes?.pending_command) {
        await executePendingCommand(hbRes.pending_command);
      }
    } catch (err) {
      heartbeatConfirmed = false;
      console.warn('[heartbeat] Gagal mengirim heartbeat:', err?.message || err);
    } finally {
      heartbeatInFlight = false;
      if (heartbeatQueued) {
        heartbeatQueued = false;
        void tickHeartbeat();
      }
    }
  }

  if (enableOpenWa) {
    openwa = startOpenWaWorker({
      apiClient,
      sessionId: process.env.OPENWA_SESSION_ID || 'ekalliptus-printer',
      sessionPath: process.env.OPENWA_SESSION_PATH || './.openwa-session',
      chromePath: process.env.CHROME_PATH || '',
      headless: openwaHeadless,
      linkCode: openwaLinkPhone,
      onStateChange: () => {
        void tickHeartbeat();
      },
    });
  }

  console.log(
    `[bridge] Smart Printer Bridge berjalan (dryRun=${isDryRunActive()}, openwa=${enableOpenWa ? 'enabled' : 'disabled'}, host=${effectiveHost || 'auto'})`,
  );

  let isPrinting = false;
  let shuttingDown = false;

  async function tickQueue() {
    if (isPrinting || shuttingDown) return;
    isPrinting = true;
    try {
      const claimed = await apiClient.claimNextJob();
      if (!claimed?.job || !claimed?.download_url) return;

      const job = claimed.job;
      const runDry = isDryRunActive();
      console.log(`[queue] Memproses ${job.job_code} (${job.file_name}) [dryRun=${runDry}]`);
      try {
        const result = await executeJobPrint(job, claimed.download_url, effectiveHost, runDry);
        await apiClient.submitJobResult(job.id, result);
        console.log(`[queue] Selesai ${job.job_code} -> printed (ippJob=${result.ipp_job_id ?? 'dry-run'})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[queue] Gagal mencetak ${job.job_code}:`, msg);
        await apiClient.submitJobResult(job.id, {
          status: 'failed',
          error_message: msg.slice(0, 480),
          dry_run: runDry,
        });
      }
    } catch (err) {
      console.warn('[queue] Gagal polling antrean:', err?.message || err);
    } finally {
      isPrinting = false;
    }
  }

  async function tickOutbox() {
    if (shuttingDown || openwa.getStatus() !== 'connected') return;
    try {
      const res = await apiClient.getPendingOutbox();
      const messages = Array.isArray(res?.messages) ? res.messages : [];
      for (const msg of messages) {
        try {
          const sent = await openwa.sendText(msg.wa_chat_id, msg.message_text);
          if (sent) {
            await apiClient.ackOutbox(msg.id, { status: 'sent' });
          }
        } catch (err) {
          await apiClient.ackOutbox(msg.id, {
            status: 'failed',
            error_message: err instanceof Error ? err.message : String(err),
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[outbox] Gagal polling WA outbox:', err?.message || err);
    }
  }

  await tickHeartbeat();
  const hbTimer = setInterval(tickHeartbeat, 5_000);
  const qTimer = setInterval(tickQueue, 3_000);
  const waTimer = setInterval(tickOutbox, 3_000);

  const shutdown = async () => {
    shuttingDown = true;
    clearInterval(hbTimer);
    clearInterval(qTimer);
    clearInterval(waTimer);
    await openwa.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[bridge fatal]', err);
  process.exit(1);
});
