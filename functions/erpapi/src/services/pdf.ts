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

function formatJakartaReceiptDateTime(date: Date): string {
  const d = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/:/g, '.');
  return `${d} ${t} WIB`;
}

function paymentMethodDisplay(method: 'cash' | 'qris' | 'transfer' | 'ewallet'): string {
  switch (method) {
    case 'cash':
      return 'TUNAI';
    case 'qris':
      return 'QRIS';
    case 'transfer':
      return 'TRANSFER BANK';
    case 'ewallet':
      return 'E-WALLET';
  }
}

export async function generatePosReceiptPdf(params: {
  saleNumber: string;
  createdAt: Date;
  cashierName: string;
  customerName: string | null;
  warehouseName: string | null;
  accountName: string;
  paymentMethod: 'cash' | 'qris' | 'transfer' | 'ewallet';
  status: 'completed' | 'void';
  items: Array<{
    itemName: string;
    qty: number;
    unit: string;
    unitPrice: bigint;
    lineTotal: bigint;
  }>;
  subtotal: bigint;
  discountType: 'none' | 'amount' | 'percent';
  discountValue: bigint;
  discountAmount: bigint;
  taxPercent: number;
  taxAmount: bigint;
  totalAmount: bigint;
  paidAmount: bigint;
  changeAmount: bigint;
  note: string | null;
}): Promise<Uint8Array> {
  const width = 240;
  const lineH = 12;
  const estimatedHeight = Math.max(380, 265 + params.items.length * 26 + (params.note ? 18 : 0));

  const doc = await PDFDocument.create();
  const page = doc.addPage([width, estimatedHeight]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.CourierBold);

  const ink = rgb(0.067, 0.094, 0.082);
  const muted = rgb(0.294, 0.341, 0.318);
  const accent = rgb(0.059, 0.463, 0.431);
  const danger = rgb(0.725, 0.11, 0.11);
  const lineColor = rgb(0.82, 0.85, 0.83);

  const left = 14;
  const right = width - 14;
  let y = estimatedHeight - 24;

  const drawCenter = (text: string, size: number, bold = false, color = ink) => {
    const f = bold ? fontBold : fontRegular;
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: Math.max(left, (width - w) / 2), y, size, font: f, color });
    y -= lineH;
  };

  const drawPair = (
    label: string,
    val: string,
    opts?: { bold?: boolean; mono?: boolean; size?: number; color?: typeof ink },
  ) => {
    const size = opts?.size ?? 8;
    const fLabel = opts?.bold ? fontBold : fontRegular;
    const fVal = opts?.mono ? fontMono : fLabel;
    const c = opts?.color ?? ink;
    const maxValW = Math.min(right - left, fVal.widthOfTextAtSize(val, size));
    page.drawText(label.slice(0, 28), { x: left, y, size, font: fLabel, color: c });
    page.drawText(val, { x: right - maxValW, y, size, font: fVal, color: c });
    y -= lineH;
  };

  const drawRule = () => {
    page.drawLine({
      start: { x: left, y: y + 4 },
      end: { x: right, y: y + 4 },
      thickness: 0.6,
      color: lineColor,
    });
    y -= 6;
  };

  drawCenter('EKALLIPTUS DIGITAL', 11, true, accent);
  drawCenter('STRUK PENJUALAN KASIR (POS)', 8, true, muted);
  if (params.status === 'void') {
    y -= 2;
    drawCenter('*** TRANSAKSI VOID / DIBATALKAN ***', 8, true, danger);
  }
  y -= 4;
  drawRule();

  drawPair('No. Struk', params.saleNumber, { bold: true, mono: true, size: 7.5 });
  drawPair('Waktu', formatJakartaReceiptDateTime(params.createdAt), { size: 7.5, color: muted });
  drawPair('Kasir', params.cashierName, { size: 7.5 });
  if (params.customerName) {
    drawPair('Pelanggan', params.customerName, { size: 7.5 });
  }
  if (params.warehouseName) {
    drawPair('Outlet/Gudang', params.warehouseName, { size: 7.5, color: muted });
  }
  drawPair('Akun Kas', params.accountName, { size: 7.5, color: muted });

  y -= 2;
  drawRule();

  for (const item of params.items) {
    page.drawText(item.itemName.slice(0, 34), {
      x: left,
      y,
      size: 8.2,
      font: fontBold,
      color: ink,
    });
    y -= 10;
    const qtyDetail = `${item.qty} ${item.unit} x ${formatIdr(item.unitPrice)}`;
    drawPair(qtyDetail, formatIdr(item.lineTotal), { size: 7.8, mono: true, color: muted });
    y -= 2;
  }

  drawRule();

  drawPair('Subtotal', formatIdr(params.subtotal), { size: 8, mono: true });
  if (params.discountAmount > 0n) {
    const discLabel =
      params.discountType === 'percent' ? `Diskon (${params.discountValue.toString()}%)` : 'Diskon';
    drawPair(discLabel, `-${formatIdr(params.discountAmount)}`, { size: 8, mono: true });
  }
  if (params.taxAmount > 0n) {
    drawPair(`PPN (${params.taxPercent}%)`, formatIdr(params.taxAmount), { size: 8, mono: true });
  }

  y -= 2;
  drawPair('TOTAL BAYAR', formatIdr(params.totalAmount), {
    bold: true,
    mono: true,
    size: 9.5,
    color: params.status === 'void' ? danger : accent,
  });

  drawRule();

  drawPair(`Bayar (${paymentMethodDisplay(params.paymentMethod)})`, formatIdr(params.paidAmount), {
    size: 8,
    mono: true,
  });
  drawPair('Kembalian', formatIdr(params.changeAmount), {
    bold: params.changeAmount > 0n,
    mono: true,
    size: 8,
  });

  if (params.note && params.note.trim().length > 0) {
    y -= 4;
    page.drawText(`Catatan: ${params.note.trim().slice(0, 40)}`, {
      x: left,
      y,
      size: 7.5,
      font: fontRegular,
      color: muted,
    });
    y -= lineH;
  }

  y -= 8;
  drawCenter('Terima kasih atas kunjungan Anda', 8, true, ink);
  drawCenter('MyEkalliptus ERP POS', 7, false, muted);

  return doc.save();
}
