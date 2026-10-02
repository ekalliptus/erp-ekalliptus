const translations: Record<string, string> = {
  'Invalid credentials': 'Email atau kata sandi salah.',
  'Duplicate record or reference': 'Catatan sudah ada atau referensi ganda.',
  'Invalid data or conflicting reference': 'Data tidak valid atau bertentangan dengan catatan lain.',
  'Invalid repair state transition': 'Perpindahan tahap tidak sesuai alur servis.',
  'Quotation is locked outside diagnosis': 'Kuotasi hanya dapat diubah saat tahap inspeksi atau diagnosis.',
  'Quotation required': 'Tetapkan kuotasi jasa sebelum tahap ini.',
  'Repair invoice already issued': 'Tagihan servis untuk tiket ini sudah diterbitkan.',
  'Overpayment rejected': 'Pembayaran melebihi sisa tagihan.',
  'Payment reference payload mismatch': 'Referensi pembayaran sudah dipakai dengan data berbeda.',
  'Idempotency key payload mismatch': 'Kunci transaksi sudah dipakai dengan isi keranjang berbeda.',
  'Integration unavailable: no provider configured': 'Integrasi belum dikonfigurasi di server.',
  'Only cash POS payment is available': 'Kasir hanya menerima pembayaran tunai.',
};
export async function api<T>(path: string, token: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch { throw new Error('Server tidak dapat dihubungi. Periksa koneksi, lalu coba lagi.'); }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && token) window.dispatchEvent(new Event('session-expired'));
  if (!response.ok) {
    const raw = Array.isArray(data?.message) ? data.message.join(' • ') : data?.message || `Permintaan gagal (${response.status}). Coba lagi.`;
    throw new Error(translations[raw] || raw);
  }
  return data as T;
}
export type User = { id: string; fullName: string; email: string; role: string };
export type Customer = { id: string; fullName: string; phoneNumber: string; email?: string; address?: string };
export type Product = { id: string; sku: string; name: string; category: string; costPrice: string; salePrice: string; currentStock: number; minimumThreshold: number; unitOfMeasure: string };
export type Repair = { id: string; ticketNumber: string; customerId: string; deviceType: string; brand: string; modelName: string; declaredDefects: string; currentState: string; quotationAmount?: string; quotationDescription?: string; };
export type Milestone = { id: string; milestoneName: string; status: string; completedAt?: string; milestoneAmount: string };
export type Project = { id: string; projectCode: string; title: string; customerId: string; totalContractValue: string; targetDeliveryDate: string; scopeDescription: string; status: string; milestones: Milestone[] };
export type Invoice = { id: string; invoiceNumber: string; customerId: string; sourceModule: string; totalAmount: string; paidAmount: string; status: string };
export type Order = { id: string; orderNumber: string; totalAmount: string; createdAt: string };
export type Journal = { id: string; referenceType: string; memo: string; createdAt: string; lines: { accountCode: string; debit: string; credit: string }[] };
export type Dashboard = { salesToday: string; outstandingReceivables: string; orderCount: number; customerCount: number; lowStockCount: number; openRepairs: number; activeProjects: number };
