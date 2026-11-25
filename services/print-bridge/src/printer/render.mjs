import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { computeCanvasPx, encodePwgRaster, getMediaSpec } from './pwg-raster.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDER_PS1 = path.join(__dirname, 'render-pages.ps1');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff']);
const HTML_EXTS = new Set(['.html', '.htm', '.svg', '.webp']);
const MD_EXTS = new Set(['.md', '.markdown']);
const OFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods', '.odp']);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findBrowserExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const exe of candidates) {
    if (await exists(exe)) return exe;
  }
  throw new Error('Tidak menemukan Google Chrome atau Microsoft Edge untuk merender HTML/Markdown/teks ke PDF.');
}

async function findLibreOfficeExe() {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const exe of candidates) {
    if (await exists(exe)) return exe;
  }
  return null;
}

/**
 * Parse page range strings like "1", "1-3", "1,3,5-7" into sorted unique 1-based page numbers.
 */
export function parsePageRanges(spec, totalPages = null) {
  if (!spec) return [];
  const nums = new Set();
  for (const rawPart of String(spec).split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < start) {
        throw new Error(`Rentang halaman tidak valid: "${part}"`);
      }
      for (let i = start; i <= end; i++) nums.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1) throw new Error(`Nomor halaman tidak valid: "${part}"`);
      nums.add(n);
    } else {
      throw new Error(`Format halaman tidak valid: "${part}" (contoh benar: 1-3,5)`);
    }
  }
  const sorted = [...nums].sort((a, b) => a - b);
  if (totalPages !== null) {
    for (const n of sorted) {
      if (n > totalPages) {
        throw new Error(`Halaman ${n} melebihi jumlah halaman dokumen (${totalPages})`);
      }
    }
  }
  return sorted;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/**
 * Convert Markdown to clean print-ready HTML with @page sizing.
 */
export function markdownToHtml(mdText, { mediaSpec, title = 'Document', landscape = false } = {}) {
  const lines = String(mdText).replace(/\r\n/g, '\n').split('\n');
  const htmlParts = [];
  let inCode = false;
  let codeLines = [];
  let inList = null;
  let tableRows = [];

  const flushList = () => {
    if (inList) {
      htmlParts.push(`</${inList}>`);
      inList = null;
    }
  };
  const flushTable = () => {
    if (tableRows.length > 0) {
      let t = '<table>';
      tableRows.forEach((cells, idx) => {
        if (idx === 1 && cells.every((c) => /^:?-+:?$/.test(c.trim()))) return;
        const tag = idx === 0 ? 'th' : 'td';
        t += '<tr>' + cells.map((c) => `<${tag}>${renderInlineMarkdown(c.trim())}</${tag}>`).join('') + '</tr>';
      });
      t += '</table>';
      htmlParts.push(t);
      tableRows = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushList();
      flushTable();
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushList();
      const cells = line.trim().slice(1, -1).split('|');
      tableRows.push(cells);
      continue;
    } else {
      flushTable();
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const lvl = heading[1].length;
      htmlParts.push(`<h${lvl}>${renderInlineMarkdown(heading[2])}</h${lvl}>`);
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      htmlParts.push('<hr>');
      continue;
    }

    const ulMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ulMatch) {
      if (inList !== 'ul') {
        flushList();
        inList = 'ul';
        htmlParts.push('<ul>');
      }
      htmlParts.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (olMatch) {
      if (inList !== 'ol') {
        flushList();
        inList = 'ol';
        htmlParts.push('<ol>');
      }
      htmlParts.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    flushList();
    if (line.trim() === '') {
      continue;
    }
    if (line.trim().startsWith('>')) {
      htmlParts.push(`<blockquote>${renderInlineMarkdown(line.trim().slice(1).trim())}</blockquote>`);
      continue;
    }
    htmlParts.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  flushList();
  flushTable();
  if (inCode) {
    htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  const pageSizeCss = mediaSpec
    ? `${mediaSpec.widthMm}mm ${mediaSpec.heightMm}mm${landscape ? ' landscape' : ''}`
    : `A4${landscape ? ' landscape' : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${pageSizeCss}; margin: 15mm; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #111;
    margin: 0;
  }
  h1, h2, h3, h4 { margin: 0.9em 0 0.35em; page-break-after: avoid; color: #000; }
  h1 { font-size: 18pt; border-bottom: 1.5px solid #222; padding-bottom: 4pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 12pt; }
  p { margin: 0 0 0.6em; }
  ul, ol { margin: 0.3em 0 0.7em; padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 9.2pt;
    background: #f3f4f6;
    padding: 1pt 3pt;
    border-radius: 2pt;
  }
  pre {
    background: #f6f7f9;
    border: 1px solid #d1d5db;
    padding: 8pt 10pt;
    border-radius: 3pt;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 8.8pt;
    line-height: 1.4;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3pt solid #555;
    margin: 0.6em 0;
    padding: 2pt 0 2pt 10pt;
    color: #333;
  }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 9.5pt; }
  th, td { border: 1px solid #999; padding: 4pt 7pt; text-align: left; }
  th { background: #efefef; font-weight: 600; }
  hr { border: none; border-top: 1px solid #bbb; margin: 1em 0; }
</style>
</head>
<body>
${htmlParts.join('\n')}
</body>
</html>`;
}

export function textToHtml(text, { mediaSpec, title = 'Text Document', landscape = false } = {}) {
  const pageSizeCss = mediaSpec
    ? `${mediaSpec.widthMm}mm ${mediaSpec.heightMm}mm${landscape ? ' landscape' : ''}`
    : `A4${landscape ? ' landscape' : ''}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${pageSizeCss}; margin: 14mm; }
  body {
    font-family: Consolas, "Courier New", monospace;
    font-size: 9.5pt;
    line-height: 1.45;
    color: #111;
    margin: 0;
  }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
</head>
<body><pre>${escapeHtml(text)}</pre></body>
</html>`;
}

export function buildTestPageHtml({ printer, mediaSpec }) {
  const now = new Date().toLocaleString('id-ID', { hour12: false });
  const markerRows = (printer?.markers || [])
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.name)}</td><td>${m.level !== null ? `${m.level}%` : 'n/a'}</td><td><span style="display:inline-block;width:24px;height:10px;background:${escapeHtml(m.color || '#888')};border:1px solid #333;"></span></td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>HP Smart Tank 583 Wi-Fi Test Page</title>
<style>
  @page { size: ${mediaSpec.widthMm}mm ${mediaSpec.heightMm}mm; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    color: #111;
    margin: 0;
    padding: 0;
  }
  .frame {
    border: 1.5pt solid #111;
    padding: 14mm;
    min-height: ${Math.max(120, Math.round(mediaSpec.heightMm - 30))}mm;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2pt solid #0078d4;
    padding-bottom: 8pt;
    margin-bottom: 12pt;
  }
  h1 { margin: 0; font-size: 18pt; color: #005a9e; }
  .meta { font-size: 9pt; color: #444; text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12pt; margin-bottom: 14pt; }
  .box { border: 0.75pt solid #999; padding: 8pt 10pt; border-radius: 3pt; }
  .box h2 { margin: 0 0 6pt; font-size: 11pt; color: #222; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  td, th { padding: 3pt 4pt; border-bottom: 0.5pt solid #ddd; text-align: left; }
  .swatches { display: flex; gap: 6pt; margin: 10pt 0; }
  .swatch { flex: 1; height: 14mm; border: 0.75pt solid #222; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 3pt; font-size: 8pt; font-weight: 600; }
  .type-ladder p { margin: 3pt 0; }
</style>
</head>
<body>
  <div class="frame">
    <div class="header">
      <div>
        <h1>HP Smart Tank 583 Wi-Fi Diagnostic</h1>
        <div style="font-size:10pt;color:#333;">Antigravity Direct IPP 2.0 + PWG Raster Pipeline</div>
      </div>
      <div class="meta">
        <div><strong>Waktu:</strong> ${escapeHtml(now)}</div>
        <div><strong>Kertas:</strong> ${escapeHtml(mediaSpec.pwgName)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h2>Informasi Printer</h2>
        <table>
          <tr><th>Model</th><td>${escapeHtml(printer?.model || 'HP Smart Tank 580-590 series')}</td></tr>
          <tr><th>Nama</th><td>${escapeHtml(printer?.info || 'HP Smart Tank 583')}</td></tr>
          <tr><th>IP / URI</th><td>${escapeHtml(printer?.uri || 'ipp://192.168.0.5:631/ipp/print')}</td></tr>
          <tr><th>Status</th><td>${escapeHtml(printer?.stateText || 'idle')}</td></tr>
        </table>
      </div>
      <div class="box">
        <h2>Status Tinta</h2>
        <table>${markerRows || '<tr><td>C/M/Y/K</td><td>Reported OK</td></tr>'}</table>
      </div>
    </div>

    <div class="box" style="margin-bottom:14pt;">
      <h2>Uji Kalibrasi Warna (CMYK + RGB)</h2>
      <div class="swatches">
        <div class="swatch" style="background:#00ffff;color:#000;">Cyan</div>
        <div class="swatch" style="background:#ff00ff;color:#000;">Magenta</div>
        <div class="swatch" style="background:#ffff00;color:#000;">Yellow</div>
        <div class="swatch" style="background:#000000;color:#fff;">Black</div>
        <div class="swatch" style="background:#e11d48;color:#fff;">Red</div>
        <div class="swatch" style="background:#16a34a;color:#fff;">Green</div>
        <div class="swatch" style="background:#2563eb;color:#fff;">Blue</div>
      </div>
    </div>

    <div class="box type-ladder">
      <h2>Uji Ketajaman Teks</h2>
      <p style="font-size:8pt;">8pt: Uji cetak cepat melalui Wi-Fi tanpa kabel USB - 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
      <p style="font-size:10pt;">10pt: The quick brown fox jumps over the lazy dog - Uji keterbacaan standar dokumen.</p>
      <p style="font-size:14pt;">14pt: Judul Bagian - Ketajaman Teks Menengah</p>
      <p style="font-size:20pt;font-weight:700;">20pt: Headline Cetak Bersih</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Convert an HTML string or local HTML/SVG/WebP file into PDF using headless Chrome/Edge.
 */
export async function htmlToPdf(htmlContentOrFilePath, outPdfPath, { isFilePath = false, mediaSpec, landscape = false } = {}) {
  const browserExe = await findBrowserExe();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-print-chrome-'));
  const profileDir = path.join(tempRoot, 'profile');
  await fs.mkdir(profileDir, { recursive: true });

  try {
    let targetPath = htmlContentOrFilePath;
    if (!isFilePath) {
      targetPath = path.join(tempRoot, 'input.html');
      await fs.writeFile(targetPath, htmlContentOrFilePath, 'utf8');
    } else {
      const resolved = path.resolve(htmlContentOrFilePath);
      const ext = path.extname(resolved).toLowerCase();
      if (ext === '.svg' || ext === '.webp') {
        const wMm = mediaSpec ? mediaSpec.widthMm : 210;
        const hMm = mediaSpec ? mediaSpec.heightMm : 297;
        const wrapperHtml = `<!DOCTYPE html><html><head><style>@page{size:${wMm}mm ${hMm}mm${landscape ? ' landscape' : ''};margin:8mm;}body{margin:0;display:flex;justify-content:center;align-items:center;min-height:95vh;}img{max-width:100%;max-height:95vh;object-fit:contain;}</style></head><body><img src="${pathToFileURL(resolved).href}"></body></html>`;
        targetPath = path.join(tempRoot, 'image-wrapper.html');
        await fs.writeFile(targetPath, wrapperHtml, 'utf8');
      } else {
        targetPath = resolved;
      }
    }

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      `--user-data-dir=${profileDir}`,
      `--print-to-pdf=${outPdfPath}`,
      pathToFileURL(targetPath).href,
    ];

    await execFileAsync(browserExe, args, { timeout: 60000, windowsHide: true });
    if (!(await exists(outPdfPath))) {
      throw new Error('Headless browser gagal membuat file PDF sementara.');
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function runRenderPagesPs1({
  inputPath,
  outputDir,
  widthPx,
  heightPx,
  colorMode,
  pagesList,
  orientation,
  fit,
  marginPx,
}) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    RENDER_PS1,
    '-InputPath',
    path.resolve(inputPath),
    '-OutputDir',
    path.resolve(outputDir),
    '-WidthPx',
    String(widthPx),
    '-HeightPx',
    String(heightPx),
    '-ColorMode',
    colorMode,
    '-Orientation',
    orientation,
    '-Fit',
    fit,
    '-MarginPx',
    String(marginPx),
  ];
  if (pagesList && pagesList.length > 0) {
    args.push('-Pages', pagesList.join(','));
  }

  const { stdout, stderr } = await execFileAsync('powershell.exe', args, {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  const trimmed = stdout.trim();
  const lastLine = trimmed.split(/\r?\n/).pop();
  try {
    return JSON.parse(lastLine);
  } catch (err) {
    throw new Error(`Gagal membaca hasil render PowerShell: ${err.message}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
  }
}

/**
 * Render any supported input (file path, --text, --markdown, or --html) into a PWG Raster Buffer.
 */
export async function renderInputToPwg({
  filePath = null,
  text = null,
  markdown = null,
  html = null,
  media = 'a4',
  dpi = 300,
  color = 'color',
  quality = 4,
  pages = null,
  orientation = 'auto',
  fit = 'contain',
  marginMm = null,
  borderless = false,
} = {}) {
  const mediaSpec = getMediaSpec(media);
  const { widthPx, heightPx } = computeCanvasPx(mediaSpec, dpi);
  const colorMode = color === 'mono' || color === 'monochrome' || color === 'sgray' ? 'sgray' : 'srgb';
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hp-print-work-'));
  const rawDir = path.join(workDir, 'raw');
  await fs.mkdir(rawDir, { recursive: true });

  try {
    let rasterSourcePath = null;
    let effectiveMarginMm = marginMm;

    if (html !== null) {
      const pdfPath = path.join(workDir, 'doc.pdf');
      await htmlToPdf(html, pdfPath, { mediaSpec, landscape: orientation === 'landscape' });
      rasterSourcePath = pdfPath;
      if (effectiveMarginMm === null) effectiveMarginMm = 0;
    } else if (markdown !== null) {
      const pdfPath = path.join(workDir, 'doc.pdf');
      const wrapped = markdownToHtml(markdown, { mediaSpec, landscape: orientation === 'landscape' });
      await htmlToPdf(wrapped, pdfPath, { mediaSpec, landscape: orientation === 'landscape' });
      rasterSourcePath = pdfPath;
      if (effectiveMarginMm === null) effectiveMarginMm = 0;
    } else if (text !== null) {
      const pdfPath = path.join(workDir, 'doc.pdf');
      const wrapped = textToHtml(text, { mediaSpec, landscape: orientation === 'landscape' });
      await htmlToPdf(wrapped, pdfPath, { mediaSpec, landscape: orientation === 'landscape' });
      rasterSourcePath = pdfPath;
      if (effectiveMarginMm === null) effectiveMarginMm = 0;
    } else if (filePath) {
      const resolved = path.resolve(filePath);
      if (!(await exists(resolved))) {
        throw new Error(`File tidak ditemukan: ${resolved}`);
      }
      const ext = path.extname(resolved).toLowerCase();

      if (ext === '.pdf') {
        rasterSourcePath = resolved;
        if (effectiveMarginMm === null) effectiveMarginMm = 0;
      } else if (IMAGE_EXTS.has(ext)) {
        rasterSourcePath = resolved;
        if (effectiveMarginMm === null) effectiveMarginMm = borderless ? 0 : 5;
      } else if (HTML_EXTS.has(ext)) {
        const pdfPath = path.join(workDir, 'doc.pdf');
        await htmlToPdf(resolved, pdfPath, {
          isFilePath: true,
          mediaSpec,
          landscape: orientation === 'landscape',
        });
        rasterSourcePath = pdfPath;
        if (effectiveMarginMm === null) effectiveMarginMm = 0;
      } else if (MD_EXTS.has(ext)) {
        const mdContent = await fs.readFile(resolved, 'utf8');
        const pdfPath = path.join(workDir, 'doc.pdf');
        const wrapped = markdownToHtml(mdContent, {
          mediaSpec,
          title: path.basename(resolved),
          landscape: orientation === 'landscape',
        });
        await htmlToPdf(wrapped, pdfPath, { mediaSpec, landscape: orientation === 'landscape' });
        rasterSourcePath = pdfPath;
        if (effectiveMarginMm === null) effectiveMarginMm = 0;
      } else if (OFFICE_EXTS.has(ext)) {
        const soffice = await findLibreOfficeExe();
        if (!soffice) {
          throw new Error(
            `Format Office (${ext}) memerlukan LibreOffice atau export ke PDF terlebih dahulu. ` +
              `Silakan simpan/export file sebagai .pdf lalu cetak ulang.`
          );
        }
        await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', workDir, resolved], {
          timeout: 60000,
          windowsHide: true,
        });
        const convertedPdf = path.join(workDir, `${path.basename(resolved, ext)}.pdf`);
        if (!(await exists(convertedPdf))) {
          throw new Error(`LibreOffice gagal mengonversi ${resolved} ke PDF.`);
        }
        rasterSourcePath = convertedPdf;
        if (effectiveMarginMm === null) effectiveMarginMm = 0;
      } else {
        // Treat .txt, .log, .json, .csv, source code, etc. as plain text
        const txtContent = await fs.readFile(resolved, 'utf8');
        const pdfPath = path.join(workDir, 'doc.pdf');
        const wrapped = textToHtml(txtContent, {
          mediaSpec,
          title: path.basename(resolved),
          landscape: orientation === 'landscape',
        });
        await htmlToPdf(wrapped, pdfPath, { mediaSpec, landscape: orientation === 'landscape' });
        rasterSourcePath = pdfPath;
        if (effectiveMarginMm === null) effectiveMarginMm = 0;
      }
    } else {
      throw new Error('Tidak ada input untuk dicetak. Berikan path file atau --text / --markdown / --html.');
    }

    if (borderless && marginMm === null) {
      effectiveMarginMm = 0;
    }

    const marginPx = Math.max(0, Math.round((Number(effectiveMarginMm || 0) / 25.4) * dpi));
    const pagesList = pages ? parsePageRanges(pages) : [];

    // When Chrome already laid out HTML/MD/text in landscape, keep orientation=auto (Wait: Chrome @page landscape outputs landscape PDF pages, and our portrait PWG sheet rotates 90 deg cleanly).
    const renderResult = await runRenderPagesPs1({
      inputPath: rasterSourcePath,
      outputDir: rawDir,
      widthPx,
      heightPx,
      colorMode,
      pagesList,
      orientation,
      fit,
      marginPx,
    });

    const pageBuffers = [];
    for (const rawFile of renderResult.files) {
      pageBuffers.push(await fs.readFile(rawFile));
    }

    const pwgBuffer = encodePwgRaster(pageBuffers, {
      width: widthPx,
      height: heightPx,
      dpi,
      colorMode,
      pageSizePt: [mediaSpec.widthPt, mediaSpec.heightPt],
      pageSizeName: mediaSpec.pwgName,
      printQuality: quality,
    });

    return {
      pwgBuffer,
      totalPages: renderResult.totalPages,
      renderedPages: renderResult.renderedPages,
      widthPx,
      heightPx,
      dpi,
      colorMode,
      mediaSpec,
      sizeBytes: pwgBuffer.length,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
