// PWG 5102.4 PWG Raster Format Encoder & Round-Trip Decoder

export const MEDIA_SPECS = {
  a4: { pwgName: 'iso_a4_210x297mm', widthMm: 210, heightMm: 297, widthPt: 595, heightPt: 842 },
  a5: { pwgName: 'iso_a5_148x210mm', widthMm: 148, heightMm: 210, widthPt: 420, heightPt: 595 },
  a6: { pwgName: 'iso_a6_105x148mm', widthMm: 105, heightMm: 148, widthPt: 298, heightPt: 420 },
  b5: { pwgName: 'jis_b5_182x257mm', widthMm: 182, heightMm: 257, widthPt: 516, heightPt: 729 },
  'iso-b5': { pwgName: 'iso_b5_176x250mm', widthMm: 176, heightMm: 250, widthPt: 499, heightPt: 709 },
  letter: { pwgName: 'na_letter_8.5x11in', widthMm: 215.9, heightMm: 279.4, widthPt: 612, heightPt: 792 },
  legal: { pwgName: 'na_legal_8.5x14in', widthMm: 215.9, heightMm: 355.6, widthPt: 612, heightPt: 1008 },
  f4: { pwgName: 'na_foolscap_8.5x13in', widthMm: 215.9, heightMm: 330.2, widthPt: 612, heightPt: 936 },
  folio: { pwgName: 'na_foolscap_8.5x13in', widthMm: 215.9, heightMm: 330.2, widthPt: 612, heightPt: 936 },
  foolscap: { pwgName: 'na_foolscap_8.5x13in', widthMm: 215.9, heightMm: 330.2, widthPt: 612, heightPt: 936 },
  '4x6': { pwgName: 'na_index-4x6_4x6in', widthMm: 101.6, heightMm: 152.4, widthPt: 288, heightPt: 432 },
  '4r': { pwgName: 'na_index-4x6_4x6in', widthMm: 101.6, heightMm: 152.4, widthPt: 288, heightPt: 432 },
  '10x15': { pwgName: 'om_small-photo_100x150mm', widthMm: 100, heightMm: 150, widthPt: 283, heightPt: 425 },
  '5x7': { pwgName: 'na_5x7_5x7in', widthMm: 127, heightMm: 177.8, widthPt: 360, heightPt: 504 },
  '5r': { pwgName: 'na_5x7_5x7in', widthMm: 127, heightMm: 177.8, widthPt: 360, heightPt: 504 },
};

export function getMediaSpec(media = 'a4') {
  const key = String(media).trim().toLowerCase();
  if (MEDIA_SPECS[key]) return MEDIA_SPECS[key];
  const byPwg = Object.values(MEDIA_SPECS).find((s) => s.pwgName.toLowerCase() === key);
  if (byPwg) return byPwg;
  const supported = ['a4', 'a5', 'a6', 'b5', 'letter', 'legal', 'f4', '4x6', '5x7'].join(', ');
  throw new Error(`Ukuran kertas tidak dikenal: "${media}". Gunakan salah satu: ${supported}`);
}

export function computeCanvasPx(mediaSpec, dpi = 300) {
  return {
    widthPx: Math.round((mediaSpec.widthMm / 25.4) * dpi),
    heightPx: Math.round((mediaSpec.heightMm / 25.4) * dpi),
  };
}

/**
 * Build a 1796-byte PWG 5102.4 Page Header (big-endian).
 */
export function buildPwgPageHeader({
  width,
  height,
  dpi = 300,
  colorMode = 'srgb',
  pageSizePt = [595, 842],
  pageSizeName = 'iso_a4_210x297mm',
  totalPageCount = 0,
  printQuality = 4,
  mediaType = '',
}) {
  const hdr = Buffer.alloc(1796);
  const isGray = colorMode === 'sgray';
  const bpp = isGray ? 8 : 24;
  const numColors = isGray ? 1 : 3;
  const colorSpace = isGray ? 18 : 19; // 18 = PWG_COLORSPACE_SGRAY, 19 = PWG_COLORSPACE_SRGB
  const bytesPerLine = width * numColors;

  hdr.write('PwgRaster', 0, 'ascii');
  if (mediaType) hdr.write(String(mediaType).slice(0, 63), 128, 'ascii');

  hdr.writeUInt32BE(dpi >>> 0, 276); // HWResolution[0]
  hdr.writeUInt32BE(dpi >>> 0, 280); // HWResolution[1]

  // NumCopies MUST stay 1 in PWG header because IPP job-attributes specifies copies (prevents N*N).
  hdr.writeUInt32BE(1, 340);
  hdr.writeUInt32BE(0, 344); // Orientation = 0 (pages already pre-oriented)

  hdr.writeUInt32BE(Math.round(pageSizePt[0]) >>> 0, 352);
  hdr.writeUInt32BE(Math.round(pageSizePt[1]) >>> 0, 356);

  hdr.writeUInt32BE(width >>> 0, 372);
  hdr.writeUInt32BE(height >>> 0, 376);
  hdr.writeUInt32BE(8, 384); // BitsPerColor
  hdr.writeUInt32BE(bpp, 388); // BitsPerPixel
  hdr.writeUInt32BE(bytesPerLine >>> 0, 392);
  hdr.writeUInt32BE(0, 396); // ColorOrder = chunky (0)
  hdr.writeUInt32BE(colorSpace, 400);
  hdr.writeUInt32BE(numColors, 420);

  hdr.writeUInt32BE(totalPageCount >>> 0, 452);
  hdr.writeInt32BE(1, 456); // CrossFeedTransform = 1
  hdr.writeInt32BE(1, 460); // FeedTransform = 1
  hdr.writeUInt32BE(0, 464); // ImageBoxLeft
  hdr.writeUInt32BE(0, 468); // ImageBoxTop
  hdr.writeUInt32BE(width >>> 0, 472); // ImageBoxRight
  hdr.writeUInt32BE(height >>> 0, 476); // ImageBoxBottom
  hdr.writeUInt32BE(0x00ffffff, 480); // AlternatePrimary
  hdr.writeUInt32BE(Number(printQuality) >>> 0, 484);

  if (pageSizeName) {
    hdr.write(String(pageSizeName).slice(0, 63), 1732, 'ascii');
  }

  return hdr;
}

function pixelsEqual(buf, a, b, bytesPerPixel) {
  if (bytesPerPixel === 1) return buf[a] === buf[b];
  return buf[a] === buf[b] && buf[a + 1] === buf[b + 1] && buf[a + 2] === buf[b + 2];
}

function rowsEqual(buf, rowAOffset, rowBOffset, rowBytes) {
  for (let i = 0; i < rowBytes; i++) {
    if (buf[rowAOffset + i] !== buf[rowBOffset + i]) return false;
  }
  return true;
}

/**
 * Compress a single raw pixel page (packed RGB24 or Gray8) using PWG PackBits RLE.
 */
export function compressPwgPage(rawPixels, width, height, bytesPerPixel) {
  const rowBytes = width * bytesPerPixel;
  if (rawPixels.length !== rowBytes * height) {
    throw new Error(
      `Raw page size mismatch: got ${rawPixels.length} bytes, expected ${rowBytes * height} (${width}x${height}x${bytesPerPixel})`
    );
  }

  // Worst-case PackBits output is slightly larger than input; allocate generous buffer and slice.
  const out = Buffer.allocUnsafe(rowBytes * height + height * 16 + 64);
  let outPos = 0;

  let y = 0;
  while (y < height) {
    const rowStart = y * rowBytes;
    let repeatLines = 1;
    while (
      repeatLines < 256 &&
      y + repeatLines < height &&
      rowsEqual(rawPixels, rowStart, (y + repeatLines) * rowBytes, rowBytes)
    ) {
      repeatLines++;
    }

    out[outPos++] = repeatLines - 1;

    // Horizontal pixel RLE within this single scanline
    let x = 0;
    while (x < width) {
      const px0 = rowStart + x * bytesPerPixel;
      if (x + 1 < width && pixelsEqual(rawPixels, px0, px0 + bytesPerPixel, bytesPerPixel)) {
        let runLen = 2;
        while (
          runLen < 128 &&
          x + runLen < width &&
          pixelsEqual(rawPixels, px0, rowStart + (x + runLen) * bytesPerPixel, bytesPerPixel)
        ) {
          runLen++;
        }
        out[outPos++] = runLen - 1;
        for (let c = 0; c < bytesPerPixel; c++) {
          out[outPos++] = rawPixels[px0 + c];
        }
        x += runLen;
      } else {
        let litLen = 1;
        while (litLen < 128 && x + litLen < width) {
          const cur = rowStart + (x + litLen) * bytesPerPixel;
          if (
            x + litLen + 1 < width &&
            pixelsEqual(rawPixels, cur, cur + bytesPerPixel, bytesPerPixel)
          ) {
            break;
          }
          litLen++;
        }
        if (litLen === 1) {
          out[outPos++] = 0x00;
          for (let c = 0; c < bytesPerPixel; c++) {
            out[outPos++] = rawPixels[px0 + c];
          }
        } else {
          out[outPos++] = 257 - litLen;
          const byteCount = litLen * bytesPerPixel;
          rawPixels.copy(out, outPos, px0, px0 + byteCount);
          outPos += byteCount;
        }
        x += litLen;
      }
    }

    y += repeatLines;
  }

  return out.subarray(0, outPos);
}

/**
 * Encode an array of raw page Buffers into a complete PWG Raster stream ("RaS2" + pages).
 */
export function encodePwgRaster(
  pages,
  { width, height, dpi = 300, colorMode = 'srgb', pageSizePt = [595, 842], pageSizeName = 'iso_a4_210x297mm', printQuality = 4 }
) {
  const bytesPerPixel = colorMode === 'sgray' ? 1 : 3;
  const parts = [Buffer.from('RaS2', 'ascii')];
  const totalPageCount = pages.length;

  for (const rawPage of pages) {
    parts.push(
      buildPwgPageHeader({
        width,
        height,
        dpi,
        colorMode,
        pageSizePt,
        pageSizeName,
        totalPageCount,
        printQuality,
      })
    );
    parts.push(compressPwgPage(rawPage, width, height, bytesPerPixel));
  }

  return Buffer.concat(parts);
}

/**
 * Decode a PWG Raster stream back into headers + uncompressed pixel buffers (for verification/testing).
 */
export function decodePwgRaster(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf.toString('ascii', 0, 4) !== 'RaS2') {
    throw new Error('Invalid PWG Raster magic (expected RaS2)');
  }

  let pos = 4;
  const pages = [];

  while (pos < buf.length) {
    if (pos + 1796 > buf.length) {
      throw new Error(`Truncated PWG page header at offset ${pos}`);
    }
    const hdr = buf.subarray(pos, pos + 1796);
    pos += 1796;

    const magicStr = hdr.toString('ascii', 0, 9);
    if (magicStr !== 'PwgRaster') {
      throw new Error(`Invalid PWG page header string: ${magicStr}`);
    }

    const hwResX = hdr.readUInt32BE(276);
    const hwResY = hdr.readUInt32BE(280);
    const numCopies = hdr.readUInt32BE(340);
    const width = hdr.readUInt32BE(372);
    const height = hdr.readUInt32BE(376);
    const bitsPerPixel = hdr.readUInt32BE(388);
    const bytesPerLine = hdr.readUInt32BE(392);
    const colorSpace = hdr.readUInt32BE(400);
    const numColors = hdr.readUInt32BE(420);
    const totalPageCount = hdr.readUInt32BE(452);
    const pageSizeName = hdr.toString('ascii', 1732, 1796).replace(/\0+$/, '');

    const bpp = Math.floor(bitsPerPixel / 8);
    const pixels = Buffer.allocUnsafe(bytesPerLine * height);

    let y = 0;
    while (y < height) {
      if (pos >= buf.length) throw new Error(`Unexpected EOF reading line repeat at y=${y}`);
      const lineRepeat = buf[pos++] + 1;
      const lineBuf = Buffer.allocUnsafe(bytesPerLine);
      let x = 0;

      while (x < width) {
        if (pos >= buf.length) throw new Error(`Unexpected EOF reading pixel ctrl at y=${y}, x=${x}`);
        const ctrl = buf[pos++];
        if (ctrl <= 127) {
          const runLen = ctrl + 1;
          if (pos + bpp > buf.length) throw new Error(`Unexpected EOF reading repeated pixel at y=${y}, x=${x}`);
          const px = buf.subarray(pos, pos + bpp);
          pos += bpp;
          for (let r = 0; r < runLen; r++) {
            px.copy(lineBuf, (x + r) * bpp);
          }
          x += runLen;
        } else {
          const litLen = 257 - ctrl;
          const byteCount = litLen * bpp;
          if (pos + byteCount > buf.length) throw new Error(`Unexpected EOF reading literal pixels at y=${y}, x=${x}`);
          buf.copy(lineBuf, x * bpp, pos, pos + byteCount);
          pos += byteCount;
          x += litLen;
        }
      }

      if (x !== width) {
        throw new Error(`Scanline width mismatch at y=${y}: decoded ${x}, expected ${width}`);
      }

      for (let ly = 0; ly < lineRepeat; ly++) {
        if (y + ly >= height) {
          throw new Error(`Line repeat overflow at y=${y}, repeat=${lineRepeat}, height=${height}`);
        }
        lineBuf.copy(pixels, (y + ly) * bytesPerLine);
      }
      y += lineRepeat;
    }

    pages.push({
      header: {
        hwResX,
        hwResY,
        numCopies,
        width,
        height,
        bitsPerPixel,
        bytesPerLine,
        colorSpace,
        numColors,
        totalPageCount,
        pageSizeName,
      },
      pixels,
    });
  }

  return { bytesConsumed: pos, totalBytes: buf.length, pages };
}
