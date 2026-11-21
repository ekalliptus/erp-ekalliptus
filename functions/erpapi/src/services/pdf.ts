import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function formatIdr(amount: bigint): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}Rp ${grouped}`;
}

export async function generateInvoicePdf(params: {
  id: string;
  accountName: string;
  categoryName: string | null;
  type: string;
  amount: bigint;
  description: string;
  status: string;
  transactedAt: Date;
  createdByName: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const ink = rgb(0.067, 0.094, 0.082);
  const muted = rgb(0.294, 0.341, 0.318);
  const accent = rgb(0.059, 0.463, 0.431);
  const lineColor = rgb(0.886, 0.902, 0.882);

  let y = 780;
  page.drawText('EKALLIPTUS DIGITAL', { x: 48, y, size: 18, font: fontBold, color: accent });
  page.drawText('BUKTI TRANSAKSI & INVOICE ERP', {
    x: 48,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: muted,
  });
  page.drawText('alul@ekalliptus.com | https://ekalliptus.com', {
    x: 330,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });

  y -= 42;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: lineColor });

  const rows: Array<[string, string, boolean]> = [
    ['ID Referensi', params.id, true],
    ['Tanggal Transaksi', params.transactedAt.toISOString(), true],
    ['Tipe Mutasi', params.type.toUpperCase(), false],
    ['Rekening / Kas', params.accountName, false],
    ['Kategori', params.categoryName ?? '-', false],
    ['Status', params.status.toUpperCase(), false],
    ['Dicatat Oleh', params.createdByName, false],
    ['Keterangan', params.description, false],
  ];

  y -= 30;
  for (const [label, value, isMono] of rows) {
    page.drawText(label, { x: 48, y, size: 10, font: fontBold, color: muted });
    page.drawText(value.slice(0, 72), {
      x: 190,
      y,
      size: 10,
      font: isMono ? fontMono : fontRegular,
      color: ink,
    });
    y -= 24;
  }

  y -= 10;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: lineColor });
  y -= 30;
  page.drawText('NOMINAL TOTAL', { x: 48, y, size: 11, font: fontBold, color: muted });
  page.drawText(formatIdr(params.amount), {
    x: 190,
    y,
    size: 16,
    font: fontMono,
    color: accent,
  });

  y -= 60;
  page.drawText('Dokumen resmi diterbitkan otomatis oleh Ekalliptus ERP. Hubungi alul@ekalliptus.com untuk verifikasi.', {
    x: 48,
    y,
    size: 8.5,
    font: fontRegular,
    color: muted,
  });

  return doc.save();
}

export async function generatePayrollSlipPdf(params: {
  runId: string;
  periodStart: string;
  periodEnd: string;
  employeeCode: string;
  employeeName: string;
  employeeEmail: string;
  baseSalary: bigint;
  allowances: bigint;
  overtimePay: bigint;
  deductions: bigint;
  netSalary: bigint;
  paidAt: Date;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const ink = rgb(0.067, 0.094, 0.082);
  const muted = rgb(0.294, 0.341, 0.318);
  const accent = rgb(0.059, 0.463, 0.431);
  const lineColor = rgb(0.886, 0.902, 0.882);

  let y = 780;
  page.drawText('EKALLIPTUS DIGITAL', { x: 48, y, size: 18, font: fontBold, color: accent });
  page.drawText('SLIP GAJI KARYAWAN (PAYROLL SLIP)', {
    x: 48,
    y: y - 20,
    size: 10,
    font: fontBold,
    color: muted,
  });
  page.drawText('HR & Finance: alul@ekalliptus.com', {
    x: 360,
    y,
    size: 9,
    font: fontRegular,
    color: muted,
  });

  y -= 42;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: lineColor });

  const meta: Array<[string, string]> = [
    ['Payroll Run ID', params.runId],
    ['Periode', `${params.periodStart} s/d ${params.periodEnd}`],
    ['Kode Karyawan', params.employeeCode],
    ['Nama Karyawan', params.employeeName],
    ['Email', params.employeeEmail],
    ['Tanggal Bayar', params.paidAt.toISOString()],
  ];

  y -= 28;
  for (const [k, v] of meta) {
    page.drawText(k, { x: 48, y, size: 10, font: fontBold, color: muted });
    page.drawText(v, { x: 190, y, size: 10, font: fontRegular, color: ink });
    y -= 22;
  }

  y -= 10;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: lineColor });
  y -= 28;

  const breakdown: Array<[string, bigint]> = [
    ['Gaji Pokok (Base Salary)', params.baseSalary],
    ['Tunjangan (Allowances)', params.allowances],
    ['Lembur (Overtime Pay)', params.overtimePay],
    ['Potongan (Deductions)', -params.deductions],
  ];

  for (const [label, val] of breakdown) {
    page.drawText(label, { x: 48, y, size: 10.5, font: fontRegular, color: ink });
    page.drawText(formatIdr(val), { x: 370, y, size: 10.5, font: fontMono, color: ink });
    y -= 24;
  }

  y -= 8;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: lineColor });
  y -= 30;
  page.drawText('GAJI BERSIH DITERIMA (NET SALARY)', {
    x: 48,
    y,
    size: 11,
    font: fontBold,
    color: accent,
  });
  page.drawText(formatIdr(params.netSalary), {
    x: 370,
    y,
    size: 14,
    font: fontMono,
    color: accent,
  });

  y -= 55;
  page.drawText('Slip gaji diterbitkan secara elektronik oleh sistem Ekalliptus ERP (alul@ekalliptus.com).', {
    x: 48,
    y,
    size: 8.5,
    font: fontRegular,
    color: muted,
  });

  return doc.save();
}
