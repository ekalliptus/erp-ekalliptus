import type {
  PortfolioAvailabilityStatus,
  PortfolioCategory,
  PortfolioOfferType,
} from '@ekalliptus/contracts';

export type StudioTheme = 'dark' | 'light';

export interface PortfolioStudioInput {
  title: string;
  slug: string;
  tagline: string;
  summary: string;
  category: PortfolioCategory;
  categoryLabel: string;
  offerType: PortfolioOfferType;
  offerLabel: string;
  availabilityStatus: PortfolioAvailabilityStatus;
  availabilityLabel: string;
  priceLabel?: string | null;
  originalPriceLabel?: string | null;
  deliveryEstimate: string;
  clientName: string;
  demoUrl: string;
  techStack: string[];
  highlights: string[];
}

interface StudioPalette {
  canvas: string;
  surface: string;
  subtle: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentSolid: string;
  onAccent: string;
}

const STUDIO_PALETTES: Record<StudioTheme, StudioPalette> = {
  dark: {
    canvas: '#0C0E0D',
    surface: '#141816',
    subtle: '#1B211E',
    border: '#2A342F',
    borderStrong: '#394740',
    textPrimary: '#F1F5F3',
    textSecondary: '#B4C0B9',
    accent: '#34D399',
    accentSolid: '#0F766E',
    onAccent: '#FFFFFF',
  },
  light: {
    canvas: '#F7F7F5',
    surface: '#FFFFFF',
    subtle: '#ECF0EB',
    border: '#D4DBD3',
    borderStrong: '#B5C1B5',
    textPrimary: '#111815',
    textSecondary: '#3F4B45',
    accent: '#0F766E',
    accentSolid: '#0F766E',
    onAccent: '#FFFFFF',
  },
};

const CANVAS_W = 1600;
const CANVAS_H = 1000;
const DISPLAY_FONT = "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif";
const SANS_FONT = "'Inter', system-ui, -apple-system, sans-serif";
const MONO_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

function sanitizeNoEmDash(text: string): string {
  return text.replace(/\u2014/g, ', ').trim();
}

function safeDemoHost(demoUrl: string): string {
  const clean = demoUrl.trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    return parsed.hostname;
  } catch {
    return clean;
  }
}

async function waitFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  await Promise.race([
    document.fonts.ready.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
}

function createHiResCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser tidak mendukung HTML5 Canvas 2D.');
  }
  ctx.textBaseline = 'top';
  return [canvas, ctx];
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillAndStrokeRounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillStyle: string,
  strokeStyle?: string,
  lineWidth = 1.5,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
  ctx.restore();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const clean = sanitizeNoEmDash(rawText).replace(/\s+/g, ' ');
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  const pushTruncatedLast = (line: string) => {
    let trimmed = line;
    while (trimmed.length > 3 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1).trimEnd();
    }
    lines.push(`${trimmed}...`);
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      if (lines.length + 1 >= maxLines) {
        pushTruncatedLast(current);
        return lines;
      }
      lines.push(current);
      current = word;
    } else {
      // Single long token exceeds maxWidth
      let chunk = word;
      while (chunk.length > 3 && ctx.measureText(chunk).width > maxWidth) {
        chunk = chunk.slice(0, -1);
      }
      if (lines.length + 1 >= maxLines) {
        pushTruncatedLast(chunk);
        return lines;
      }
      lines.push(chunk);
      current = '';
    }
  }

  if (current) {
    if (lines.length >= maxLines) {
      return lines;
    }
    lines.push(current);
  }
  return lines;
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
): number {
  let cursorY = y;
  for (const line of lines) {
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
  return cursorY;
}

function drawTagChip(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  palette: StudioPalette,
  accentFill = false,
): number {
  const clean = sanitizeNoEmDash(label);
  ctx.save();
  ctx.font = `600 18px ${SANS_FONT}`;
  const textW = ctx.measureText(clean).width;
  const w = Math.ceil(textW + 32);
  const h = 40;
  fillAndStrokeRounded(
    ctx,
    x,
    y,
    w,
    h,
    8,
    accentFill ? palette.accentSolid : palette.surface,
    accentFill ? palette.accentSolid : palette.borderStrong,
  );
  ctx.fillStyle = accentFill ? palette.onAccent : palette.textPrimary;
  ctx.fillText(clean, x + 16, y + 10);
  ctx.restore();
  return w;
}

function drawCanvasBackdrop(
  ctx: CanvasRenderingContext2D,
  palette: StudioPalette,
): void {
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Subtle single top hairline marking studio canvas frame
  ctx.fillStyle = palette.border;
  ctx.fillRect(72, 114, CANVAS_W - 144, 1.5);
}

function drawTopBar(
  ctx: CanvasRenderingContext2D,
  palette: StudioPalette,
  brandLabel: string,
  rightTags: Array<{ label: string; accent?: boolean }>,
): void {
  ctx.save();
  ctx.fillStyle = palette.accentSolid;
  roundRectPath(ctx, 72, 54, 12, 34, 4);
  ctx.fill();

  ctx.font = `700 20px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText(sanitizeNoEmDash(brandLabel), 96, 60);

  let cursorRight = CANVAS_W - 72;
  for (let i = rightTags.length - 1; i >= 0; i -= 1) {
    const tag = rightTags[i];
    const clean = sanitizeNoEmDash(tag.label);
    ctx.font = `600 17px ${SANS_FONT}`;
    const w = Math.ceil(ctx.measureText(clean).width + 28);
    cursorRight -= w;
    fillAndStrokeRounded(
      ctx,
      cursorRight,
      50,
      w,
      38,
      8,
      tag.accent ? palette.accentSolid : palette.surface,
      tag.accent ? palette.accentSolid : palette.borderStrong,
    );
    ctx.fillStyle = tag.accent ? palette.onAccent : palette.textPrimary;
    ctx.fillText(clean, cursorRight + 14, 59);
    cursorRight -= 10;
  }
  ctx.restore();
}

function drawBottomUrlBar(
  ctx: CanvasRenderingContext2D,
  palette: StudioPalette,
  slug: string,
  slideTag?: string,
): void {
  const cleanSlug = slug.trim() || 'katalog';
  ctx.save();
  ctx.fillStyle = palette.border;
  ctx.fillRect(72, CANVAS_H - 78, CANVAS_W - 144, 1.5);

  ctx.font = `500 17px ${MONO_FONT}`;
  ctx.fillStyle = palette.textSecondary;
  ctx.fillText(`https://ekalliptus.com/id/portfolio/${cleanSlug}`, 72, CANVAS_H - 54);

  if (slideTag) {
    const tagW = ctx.measureText(slideTag).width;
    ctx.fillText(slideTag, CANVAS_W - 72 - tagW, CANVAS_H - 54);
  }
  ctx.restore();
}

async function canvasToImageFile(
  canvas: HTMLCanvasElement,
  filenameBase: string,
): Promise<File> {
  const safeBase = filenameBase.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'portfolio-slide';

  const toBlobPromise = (mime: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), mime, quality);
    });

  let blob = await toBlobPromise('image/webp', 0.9);
  let ext = 'webp';
  let mime = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlobPromise('image/png');
    ext = 'png';
    mime = 'image/png';
  }
  if (!blob) {
    throw new Error('Gagal mengekspor gambar canvas portofolio.');
  }
  return new File([blob], `${safeBase}.${ext}`, { type: mime });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat tangkapan layar ke canvas.'));
    img.src = src;
  });
}

function drawCheckMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 7);
  ctx.lineTo(x + 5, y + 12);
  ctx.lineTo(x + 14, y + 2);
  ctx.stroke();
  ctx.restore();
}

export async function renderStudioCoverSlide(
  input: PortfolioStudioInput,
  theme: StudioTheme = 'dark',
): Promise<File> {
  await waitFontsReady();
  const palette = STUDIO_PALETTES[theme];
  const [canvas, ctx] = createHiResCanvas();

  drawCanvasBackdrop(ctx, palette);
  drawTopBar(ctx, palette, 'EKALLIPTUS STUDIO', [
    { label: input.categoryLabel },
    { label: input.availabilityLabel, accent: true },
  ]);

  // Left editorial column (x: 72..872)
  const leftW = 780;
  const cleanTitle = sanitizeNoEmDash(input.title.trim() || 'Project Digital Ekalliptus');
  const titleSize = cleanTitle.length > 52 ? 40 : cleanTitle.length > 34 ? 46 : 54;
  const titleLh = Math.round(titleSize * 1.18);

  ctx.font = `700 ${titleSize}px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  const titleLines = wrapLines(ctx, cleanTitle, leftW, 3);
  let y = drawTextLines(ctx, titleLines, 72, 166, titleLh);

  const taglineText = sanitizeNoEmDash(
    input.tagline.trim() || input.summary.trim() || input.offerLabel,
  );
  if (taglineText) {
    y += 22;
    ctx.font = `400 25px ${SANS_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    const tagLines = wrapLines(ctx, taglineText, leftW, 3);
    y = drawTextLines(ctx, tagLines, 72, y, 36);
  }

  // Real facts strip at bottom-left
  const factItems: Array<{ label: string; value: string }> = [];
  if (input.priceLabel?.trim()) {
    factItems.push({ label: 'HARGA TAYANG', value: input.priceLabel.trim() });
  } else {
    factItems.push({ label: 'PENAWARAN', value: input.offerLabel });
  }
  if (input.deliveryEstimate.trim()) {
    factItems.push({ label: 'ESTIMASI', value: input.deliveryEstimate.trim() });
  }
  if (input.clientName.trim()) {
    factItems.push({ label: 'SEKTOR', value: input.clientName.trim() });
  }

  const factCardY = 740;
  const factGap = 16;
  const factW = Math.floor((leftW - factGap * (factItems.length - 1)) / factItems.length);
  factItems.forEach((fact, idx) => {
    const fx = 72 + idx * (factW + factGap);
    fillAndStrokeRounded(ctx, fx, factCardY, factW, 118, 12, palette.surface, palette.border);
    ctx.font = `600 14px ${MONO_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    ctx.fillText(fact.label, fx + 20, factCardY + 20);

    ctx.font = `700 23px ${DISPLAY_FONT}`;
    ctx.fillStyle = idx === 0 ? palette.accent : palette.textPrimary;
    const valLines = wrapLines(ctx, fact.value, factW - 40, 2);
    drawTextLines(ctx, valLines, fx + 20, factCardY + 48, 28);
  });

  // Right category-aware UI showcase frame (x: 908..1528)
  const frameX = 908;
  const frameY = 160;
  const frameW = 620;
  const frameH = 700;
  const urlBarText =
    safeDemoHost(input.demoUrl) || `ekalliptus.com/id/portfolio/${input.slug || 'project'}`;
  const previewHighlights = input.highlights.slice(0, 4);
  const previewStack = input.techStack.slice(0, 5);

  if (input.category === 'mobile_app') {
    const phoneW = 396;
    const phoneH = 700;
    const phoneX = frameX + Math.round((frameW - phoneW) / 2);
    fillAndStrokeRounded(
      ctx,
      phoneX,
      frameY,
      phoneW,
      phoneH,
      36,
      palette.surface,
      palette.borderStrong,
      2,
    );
    fillAndStrokeRounded(
      ctx,
      phoneX + 16,
      frameY + 18,
      phoneW - 32,
      phoneH - 36,
      24,
      palette.subtle,
      palette.border,
    );
    // Phone top speaker notch
    fillAndStrokeRounded(
      ctx,
      phoneX + Math.round(phoneW / 2) - 44,
      frameY + 32,
      88,
      10,
      5,
      palette.borderStrong,
    );

    let py = frameY + 72;
    ctx.font = `600 14px ${MONO_FONT}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(sanitizeNoEmDash(input.categoryLabel).toUpperCase(), phoneX + 38, py);
    py += 26;

    ctx.font = `700 24px ${DISPLAY_FONT}`;
    ctx.fillStyle = palette.textPrimary;
    const pTitle = wrapLines(ctx, cleanTitle, phoneW - 76, 2);
    py = drawTextLines(ctx, pTitle, phoneX + 38, py, 32) + 18;

    const listItems =
      previewHighlights.length > 0 ? previewHighlights : [input.offerLabel, input.availabilityLabel];
    for (const item of listItems.slice(0, 4)) {
      const cardLines = wrapLines(ctx, item, phoneW - 122, 2);
      const boxH = Math.max(54, cardLines.length * 24 + 24);
      fillAndStrokeRounded(
        ctx,
        phoneX + 34,
        py,
        phoneW - 68,
        boxH,
        10,
        palette.surface,
        palette.border,
      );
      drawCheckMark(ctx, phoneX + 48, py + 18, palette.accent);
      ctx.font = `500 17px ${SANS_FONT}`;
      ctx.fillStyle = palette.textPrimary;
      drawTextLines(ctx, cardLines, phoneX + 76, py + 15, 24);
      py += boxH + 12;
      if (py > frameY + phoneH - 120) break;
    }

    if (previewStack.length > 0) {
      let sx = phoneX + 34;
      const sy = frameY + phoneH - 96;
      for (const tech of previewStack.slice(0, 3)) {
        ctx.font = `600 14px ${MONO_FONT}`;
        const tw = Math.ceil(ctx.measureText(tech).width + 20);
        if (sx + tw > phoneX + phoneW - 34) break;
        fillAndStrokeRounded(ctx, sx, sy, tw, 32, 6, palette.surface, palette.border);
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(tech, sx + 10, sy + 8);
        sx += tw + 8;
      }
    }
  } else {
    fillAndStrokeRounded(
      ctx,
      frameX,
      frameY,
      frameW,
      frameH,
      16,
      palette.surface,
      palette.borderStrong,
      2,
    );
    // Browser titlebar
    ctx.fillStyle = palette.subtle;
    roundRectPath(ctx, frameX + 2, frameY + 2, frameW - 4, 52, 14);
    ctx.fill();
    ctx.fillStyle = palette.border;
    ctx.fillRect(frameX, frameY + 54, frameW, 1.5);

    // Address pill
    fillAndStrokeRounded(
      ctx,
      frameX + 20,
      frameY + 12,
      frameW - 40,
      30,
      8,
      palette.canvas,
      palette.border,
    );
    ctx.font = `500 14px ${MONO_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    const addrLines = wrapLines(ctx, urlBarText, frameW - 72, 1);
    ctx.fillText(addrLines[0] || urlBarText, frameX + 34, frameY + 19);

    let cy = frameY + 80;
    ctx.font = `600 14px ${MONO_FONT}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(sanitizeNoEmDash(input.offerLabel).toUpperCase(), frameX + 28, cy);
    cy += 26;

    ctx.font = `700 26px ${DISPLAY_FONT}`;
    ctx.fillStyle = palette.textPrimary;
    const fTitle = wrapLines(ctx, cleanTitle, frameW - 56, 2);
    cy = drawTextLines(ctx, fTitle, frameX + 28, cy, 34) + 18;

    const rows =
      previewHighlights.length > 0
        ? previewHighlights
        : wrapLines(ctx, input.summary || input.tagline || cleanTitle, frameW - 96, 3);
    for (const point of rows.slice(0, 4)) {
      const pointLines = wrapLines(ctx, point, frameW - 116, 2);
      const boxH = Math.max(58, pointLines.length * 26 + 26);
      if (cy + boxH > frameY + frameH - 96) break;
      fillAndStrokeRounded(
        ctx,
        frameX + 28,
        cy,
        frameW - 56,
        boxH,
        10,
        palette.subtle,
        palette.border,
      );
      drawCheckMark(ctx, frameX + 46, cy + 20, palette.accent);
      ctx.font = `500 18px ${SANS_FONT}`;
      ctx.fillStyle = palette.textPrimary;
      drawTextLines(ctx, pointLines, frameX + 76, cy + 16, 26);
      cy += boxH + 14;
    }

    if (previewStack.length > 0) {
      let sx = frameX + 28;
      const sy = frameY + frameH - 72;
      for (const tech of previewStack) {
        ctx.font = `600 15px ${MONO_FONT}`;
        const tw = Math.ceil(ctx.measureText(tech).width + 24);
        if (sx + tw > frameX + frameW - 28) break;
        fillAndStrokeRounded(ctx, sx, sy, tw, 36, 7, palette.subtle, palette.borderStrong);
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(tech, sx + 12, sy + 9);
        sx += tw + 10;
      }
    }
  }

  drawBottomUrlBar(ctx, palette, input.slug, 'Cover Showcase');
  return canvasToImageFile(canvas, `${input.slug || 'project'}-cover`);
}

export async function renderLiveMobileShowcaseSlide(
  input: PortfolioStudioInput,
  mobileDataUrl: string,
  theme: StudioTheme = 'dark',
): Promise<File> {
  await waitFontsReady();
  const img = await loadImageElement(mobileDataUrl);
  const palette = STUDIO_PALETTES[theme];
  const [canvas, ctx] = createHiResCanvas();

  drawCanvasBackdrop(ctx, palette);
  drawTopBar(ctx, palette, 'TAMPILAN MOBILE LIVE', [{ label: input.categoryLabel }]);

  // Left context column
  const leftW = 680;
  const host = safeDemoHost(input.demoUrl);
  let y = 166;

  if (host) {
    ctx.font = `600 19px ${MONO_FONT}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(host, 72, y);
    y += 38;
  }

  const cleanTitle = sanitizeNoEmDash(input.title.trim() || 'Preview Aplikasi Mobile');
  ctx.font = `700 46px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  const titleLines = wrapLines(ctx, cleanTitle, leftW, 3);
  y = drawTextLines(ctx, titleLines, 72, y, 56) + 22;

  const bodyCopy = sanitizeNoEmDash(input.summary.trim() || input.tagline.trim());
  if (bodyCopy) {
    ctx.font = `400 24px ${SANS_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    const copyLines = wrapLines(ctx, bodyCopy, leftW, 6);
    y = drawTextLines(ctx, copyLines, 72, y, 36);
  }

  fillAndStrokeRounded(ctx, 72, 756, leftW, 86, 12, palette.surface, palette.border);
  ctx.font = `600 18px ${SANS_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText('Tangkapan layar langsung dari URL demo aktif', 96, 782);
  ctx.font = `500 16px ${MONO_FONT}`;
  ctx.fillStyle = palette.textSecondary;
  const demoLine = wrapLines(ctx, input.demoUrl || host, leftW - 48, 1);
  ctx.fillText(demoLine[0] || host, 96, 810);

  // Right centered phone frame (368x760 bezel)
  const phoneW = 368;
  const phoneH = 760;
  const phoneX = 990;
  const phoneY = 140;
  fillAndStrokeRounded(
    ctx,
    phoneX,
    phoneY,
    phoneW,
    phoneH,
    40,
    palette.surface,
    palette.borderStrong,
    3,
  );

  const screenX = phoneX + 14;
  const screenY = phoneY + 14;
  const screenW = phoneW - 28;
  const screenH = phoneH - 28;

  ctx.save();
  roundRectPath(ctx, screenX, screenY, screenW, screenH, 28);
  ctx.clip();

  const imgW = img.naturalWidth || screenW;
  const imgH = img.naturalHeight || screenH;
  const scale = screenW / imgW;
  const drawW = screenW;
  const drawH = imgH * scale;
  ctx.drawImage(img, screenX, screenY, drawW, drawH);
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, screenX, screenY, screenW, screenH, 28);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.border;
  ctx.stroke();
  ctx.restore();

  drawBottomUrlBar(ctx, palette, input.slug, 'Galeri 01 / Mobile Live');
  return canvasToImageFile(canvas, `${input.slug || 'project'}-mobile-live`);
}

export async function renderStudioOverviewSlide(
  input: PortfolioStudioInput,
  theme: StudioTheme = 'dark',
): Promise<File> {
  await waitFontsReady();
  const palette = STUDIO_PALETTES[theme];
  const [canvas, ctx] = createHiResCanvas();

  drawCanvasBackdrop(ctx, palette);
  drawTopBar(ctx, palette, 'RINGKASAN PROJECT', [{ label: input.categoryLabel }]);

  const cleanTitle = sanitizeNoEmDash(input.title.trim() || 'Project Digital Ekalliptus');
  ctx.font = `700 40px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  const titleLines = wrapLines(ctx, cleanTitle, 840, 2);
  const afterTitleY = drawTextLines(ctx, titleLines, 72, 152, 48);

  // Left wide overview text
  const leftW = 840;
  const overviewText = sanitizeNoEmDash(
    input.summary.trim() || input.tagline.trim() || 'Spesifikasi solusi digital siap implementasi.',
  );
  fillAndStrokeRounded(
    ctx,
    72,
    afterTitleY + 24,
    leftW,
    858 - (afterTitleY + 24),
    16,
    palette.surface,
    palette.border,
  );
  ctx.font = `400 25px ${SANS_FONT}`;
  ctx.fillStyle = palette.textSecondary;
  const bodyLines = wrapLines(ctx, overviewText, leftW - 64, 12);
  drawTextLines(ctx, bodyLines, 104, afterTitleY + 60, 38);

  // Right structured metadata card (only non-empty real values)
  const metaX = 948;
  const metaY = 152;
  const metaW = 580;
  const metaH = 706;
  fillAndStrokeRounded(ctx, metaX, metaY, metaW, metaH, 16, palette.surface, palette.borderStrong);

  ctx.font = `700 22px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText('Spesifikasi Katalog', metaX + 32, metaY + 30);

  const metaRows: Array<{ k: string; v: string; accent?: boolean }> = [
    { k: 'Kategori', v: input.categoryLabel },
    { k: 'Model Penjualan', v: input.offerLabel },
    { k: 'Ketersediaan', v: input.availabilityLabel },
  ];
  if (input.priceLabel?.trim()) {
    metaRows.push({ k: 'Harga Tayang', v: input.priceLabel.trim(), accent: true });
  }
  if (input.deliveryEstimate.trim()) {
    metaRows.push({ k: 'Estimasi Deploy', v: input.deliveryEstimate.trim() });
  }
  if (input.clientName.trim()) {
    metaRows.push({ k: 'Klien / Industri', v: input.clientName.trim() });
  }
  if (input.demoUrl.trim()) {
    metaRows.push({ k: 'URL Live Demo', v: safeDemoHost(input.demoUrl) || input.demoUrl.trim() });
  }

  let rowY = metaY + 86;
  for (const row of metaRows) {
    ctx.fillStyle = palette.border;
    ctx.fillRect(metaX + 32, rowY, metaW - 64, 1);
    ctx.font = `500 16px ${SANS_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    ctx.fillText(row.k, metaX + 32, rowY + 18);

    ctx.font = `600 20px ${DISPLAY_FONT}`;
    ctx.fillStyle = row.accent ? palette.accent : palette.textPrimary;
    const valLines = wrapLines(ctx, row.v, metaW - 64, 1);
    ctx.fillText(valLines[0] || row.v, metaX + 32, rowY + 44);
    rowY += 84;
  }

  drawBottomUrlBar(ctx, palette, input.slug, 'Galeri 01 / Ringkasan');
  return canvasToImageFile(canvas, `${input.slug || 'project'}-overview`);
}

export async function renderStudioHighlightsSlide(
  input: PortfolioStudioInput,
  theme: StudioTheme = 'dark',
): Promise<File> {
  await waitFontsReady();
  const palette = STUDIO_PALETTES[theme];
  const [canvas, ctx] = createHiResCanvas();

  drawCanvasBackdrop(ctx, palette);
  drawTopBar(ctx, palette, 'FITUR & DELIVERABLES UTAMA', [{ label: input.categoryLabel }]);

  const cleanTitle = sanitizeNoEmDash(input.title.trim() || 'Project Digital Ekalliptus');
  ctx.font = `700 40px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  const titleLines = wrapLines(ctx, cleanTitle, CANVAS_W - 144, 2);
  const startY = drawTextLines(ctx, titleLines, 72, 150, 48) + 28;

  const items =
    input.highlights.length > 0
      ? input.highlights.slice(0, 8)
      : [
          ...(input.tagline.trim() ? [input.tagline.trim()] : []),
          ...(input.summary.trim() ? [input.summary.trim()] : []),
        ].slice(0, 4);

  const twoCols = items.length > 4;
  const colGap = 24;
  const cardW = twoCols ? (CANVAS_W - 144 - colGap) / 2 : CANVAS_W - 144;
  const rowsPerCol = twoCols ? Math.ceil(items.length / 2) : items.length;
  const availableH = CANVAS_H - 104 - startY;
  const cardGapY = 16;
  const cardH = Math.min(136, Math.floor((availableH - cardGapY * Math.max(0, rowsPerCol - 1)) / Math.max(1, rowsPerCol)));

  items.forEach((text, idx) => {
    const col = twoCols ? Math.floor(idx / rowsPerCol) : 0;
    const row = twoCols ? idx % rowsPerCol : idx;
    const x = 72 + col * (cardW + colGap);
    const y = startY + row * (cardH + cardGapY);

    fillAndStrokeRounded(ctx, x, y, cardW, cardH, 12, palette.surface, palette.border);

    const numStr = String(idx + 1).padStart(2, '0');
    ctx.font = `700 22px ${MONO_FONT}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(numStr, x + 24, y + 26);

    ctx.font = `500 22px ${SANS_FONT}`;
    ctx.fillStyle = palette.textPrimary;
    const lines = wrapLines(ctx, text, cardW - 104, 3);
    drawTextLines(ctx, lines, x + 76, y + 24, 30);
  });

  drawBottomUrlBar(ctx, palette, input.slug, 'Galeri 02 / Fitur Utama');
  return canvasToImageFile(canvas, `${input.slug || 'project'}-highlights`);
}

export async function renderStudioStackSpecSlide(
  input: PortfolioStudioInput,
  theme: StudioTheme = 'dark',
): Promise<File> {
  await waitFontsReady();
  const palette = STUDIO_PALETTES[theme];
  const [canvas, ctx] = createHiResCanvas();

  drawCanvasBackdrop(ctx, palette);
  drawTopBar(ctx, palette, 'STACK TEKNOLOGI & PAKET', [{ label: input.offerLabel }]);

  const cleanTitle = sanitizeNoEmDash(input.title.trim() || 'Project Digital Ekalliptus');
  ctx.font = `700 38px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  const titleLines = wrapLines(ctx, cleanTitle, CANVAS_W - 144, 1);
  drawTextLines(ctx, titleLines, 72, 150, 46);

  // Left zone: Tech Stack
  const stackX = 72;
  const stackY = 230;
  const stackW = 860;
  const stackH = 626;
  fillAndStrokeRounded(ctx, stackX, stackY, stackW, stackH, 16, palette.surface, palette.border);

  ctx.font = `700 24px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText('Stack Teknologi', stackX + 32, stackY + 30);

  if (input.techStack.length > 0) {
    let cx = stackX + 32;
    let cy = stackY + 88;
    const rowH = 56;
    for (const tech of input.techStack.slice(0, 12)) {
      const clean = sanitizeNoEmDash(tech);
      ctx.font = `600 20px ${MONO_FONT}`;
      const w = Math.ceil(ctx.measureText(clean).width + 44);
      if (cx + w > stackX + stackW - 32) {
        cx = stackX + 32;
        cy += rowH + 16;
      }
      if (cy + rowH > stackY + stackH - 32) break;
      fillAndStrokeRounded(ctx, cx, cy, w, rowH, 10, palette.subtle, palette.borderStrong);
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(clean, cx + 22, cy + 17);
      cx += w + 14;
    }
  } else {
    ctx.font = `400 22px ${SANS_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    const fallbackLines = wrapLines(
      ctx,
      `Solusi kategori ${input.categoryLabel} disiapkan sesuai kebutuhan operasional bisnis Anda.`,
      stackW - 64,
      3,
    );
    drawTextLines(ctx, fallbackLines, stackX + 32, stackY + 96, 34);
  }

  // Right zone: Offer & Package info
  const infoX = 964;
  const infoY = 230;
  const infoW = 564;
  const infoH = 626;
  fillAndStrokeRounded(ctx, infoX, infoY, infoW, infoH, 16, palette.surface, palette.borderStrong);

  ctx.font = `700 24px ${DISPLAY_FONT}`;
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText('Informasi Paket', infoX + 32, infoY + 30);

  const specRows: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: 'Skema Penawaran', value: input.offerLabel },
    { label: 'Status Ketersediaan', value: input.availabilityLabel },
  ];
  if (input.priceLabel?.trim()) {
    specRows.push({ label: 'Harga Tayang', value: input.priceLabel.trim(), accent: true });
  }
  if (input.deliveryEstimate.trim()) {
    specRows.push({ label: 'Estimasi Siap / Deploy', value: input.deliveryEstimate.trim() });
  }
  if (input.demoUrl.trim()) {
    specRows.push({ label: 'URL Demo', value: safeDemoHost(input.demoUrl) || input.demoUrl.trim() });
  }

  let sy = infoY + 94;
  for (const row of specRows) {
    ctx.fillStyle = palette.border;
    ctx.fillRect(infoX + 32, sy, infoW - 64, 1);
    ctx.font = `500 16px ${SANS_FONT}`;
    ctx.fillStyle = palette.textSecondary;
    ctx.fillText(row.label, infoX + 32, sy + 18);

    ctx.font = `700 22px ${DISPLAY_FONT}`;
    ctx.fillStyle = row.accent ? palette.accent : palette.textPrimary;
    const vLines = wrapLines(ctx, row.value, infoW - 64, 1);
    ctx.fillText(vLines[0] || row.value, infoX + 32, sy + 44);
    sy += 92;
  }

  drawTagChip(ctx, 'Siap Konsultasi WhatsApp Ekalliptus', infoX + 32, infoY + infoH - 74, palette, true);
  drawBottomUrlBar(ctx, palette, input.slug, 'Galeri 03 / Tech Stack');
  return canvasToImageFile(canvas, `${input.slug || 'project'}-tech-spec`);
}
