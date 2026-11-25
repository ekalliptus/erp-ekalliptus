import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrintBridgeApiClient } from './api-client.mjs';
import { findLibreOfficePath, isOfficeExtension } from './doc-inspect.mjs';
import { startOpenWaWorker } from './openwa-worker.mjs';
import { resolvePrinter } from './printer/discover.mjs';
import { printJob, validateJob } from './printer/ipp.mjs';
import { getMediaSpec } from './printer/pwg-raster.mjs';
import { buildTestPageHtml, renderInputToPwg } from './printer/render.mjs';

loadDotenv();

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
  const dryRun =
    args.includes('--dry-run') ||
    String(process.env.PRINT_DRY_RUN || 'false').toLowerCase() === 'true';
  const preferredHost = (process.env.PRINTER_HOST || '192.168.0.5').trim() || null;

  if (args.includes('--verify-printer')) {
    const result = await runVerifyPrinter(preferredHost);
    if (!result.reachable || !result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const baseUrl = (process.env.ERP_API_BASE_URL || '').trim();
  const agentToken = (process.env.PRINT_AGENT_TOKEN || '').trim();
  if (!baseUrl || !agentToken) {
    throw new Error('ERP_API_BASE_URL dan PRINT_AGENT_TOKEN wajib diisi di services/print-bridge/.env');
  }

  const apiClient = new PrintBridgeApiClient({ baseUrl, agentToken });
  const enableOpenWa = String(process.env.ENABLE_OPENWA || 'true').toLowerCase() !== 'false';
  const openwa = enableOpenWa
    ? await startOpenWaWorker({
        apiClient,
        sessionId: process.env.OPENWA_SESSION_ID || 'ekalliptus-printer',
        sessionPath: process.env.OPENWA_SESSION_PATH || './.openwa-session',
        chromePath: process.env.CHROME_PATH || '',
      })
    : {
        getStatus: () => 'disconnected',
        sendText: async () => false,
        close: async () => {},
      };

  console.log(
    `[bridge] Smart Printer Bridge berjalan (dryRun=${dryRun}, openwa=${enableOpenWa ? 'enabled' : 'disabled'}, host=${preferredHost || 'auto'})`,
  );

  let isPrinting = false;
  let shuttingDown = false;

  async function tickHeartbeat() {
    try {
      const probe = await safeResolvePrinter(preferredHost);
      const p = probe.printer;
      await apiClient.heartbeat({
        printer_host: p?.ip || preferredHost,
        printer_model: p?.model || 'HP Smart Tank 580-590 series',
        printer_state: probe.online ? p.stateText : 'offline',
        printer_state_reasons: probe.online
          ? Array.isArray(p.stateReasons)
            ? p.stateReasons.map(String)
            : [String(p.stateReasons || 'none')]
          : ['unreachable'],
        ink_levels: probe.online ? p.markers : [],
        openwa_status: openwa.getStatus(),
      });
    } catch (err) {
      console.warn('[heartbeat] Gagal mengirim heartbeat:', err?.message || err);
    }
  }

  async function tickQueue() {
    if (isPrinting || shuttingDown) return;
    isPrinting = true;
    try {
      const claimed = await apiClient.claimNextJob();
      if (!claimed?.job || !claimed?.download_url) return;

      const job = claimed.job;
      console.log(`[queue] Memproses ${job.job_code} (${job.file_name}) [dryRun=${dryRun}]`);
      try {
        const result = await executeJobPrint(job, claimed.download_url, preferredHost, dryRun);
        await apiClient.submitJobResult(job.id, result);
        console.log(`[queue] Selesai ${job.job_code} -> printed (ippJob=${result.ipp_job_id ?? 'dry-run'})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[queue] Gagal mencetak ${job.job_code}:`, msg);
        await apiClient.submitJobResult(job.id, {
          status: 'failed',
          error_message: msg.slice(0, 480),
          dry_run: dryRun,
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
  const hbTimer = setInterval(tickHeartbeat, 15_000);
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
