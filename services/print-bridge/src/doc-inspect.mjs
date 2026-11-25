import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const OFFICE_EXTS = new Set([
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.pptx',
  '.ppt',
  '.odt',
  '.ods',
  '.odp',
]);

export function isOfficeExtension(filename) {
  return OFFICE_EXTS.has(path.extname(String(filename || '')).toLowerCase());
}

export async function findLibreOfficePath() {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ];
  for (const exe of candidates) {
    try {
      await fs.access(exe);
      return exe;
    } catch {
      // Keep checking
    }
  }
  return null;
}

export async function countDocumentPages({ buffer, filename = '', mimeType = '' }) {
  const ext = path.extname(String(filename)).toLowerCase();
  const mime = String(mimeType).toLowerCase();

  if (ext === '.pdf' || mime === 'application/pdf') {
    try {
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      return Math.max(1, pdfDoc.getPageCount());
    } catch {
      const rawText = Buffer.from(buffer).toString('latin1');
      const matches = rawText.match(/\/Type\s*\/Page\b(?!s)/g);
      return matches && matches.length > 0 ? matches.length : 1;
    }
  }

  return 1;
}
