import type { Customer, Invoice, Product, Project, Repair } from '../lib/api';
import { rupiah, toMinor } from '../lib/money';
import { matches, transitions, type View } from '../lib/navigation';
import { Badge, Empty, Table } from '../components/ui';

const categoryNames: Record<string, string> = { accessory: 'Aksesori', sparepart: 'Suku cadang', raw_material_print: 'Bahan cetak', consumable: 'Habis pakai' };

export function isResourceView(view: View) {
  return ['inventory', 'customers', 'repairs', 'projects', 'invoices'].includes(view);
}

export function ResourceView({ view, title, query, onQuery, loading, customers, products, repairs, projects, invoices, permitted, customerName, onOpen }: {
  view: View;
  title: string;
  query: string;
  onQuery: (q: string) => void;
  loading: boolean;
  customers: Customer[];
  products: Product[];
  repairs: Repair[];
  projects: Project[];
  invoices: Invoice[];
  permitted: (roles: string[]) => boolean;
  customerName: (id: string) => string;
  onOpen: (kind: string, item?: Customer | Product | Repair | Invoice | Project) => void;
}) {
  const isEmpty =
    (view === 'inventory' && !products.filter(p => matches(query, p.name, p.sku, p.category)).length) ||
    (view === 'customers' && !customers.filter(c => matches(query, c.fullName, c.phoneNumber, c.email)).length) ||
    (view === 'repairs' && !repairs.filter(r => matches(query, r.ticketNumber, r.brand, r.modelName, customerName(r.customerId))).length) ||
    (view === 'projects' && !projects.filter(p => matches(query, p.title, p.projectCode, customerName(p.customerId))).length) ||
    (view === 'invoices' && !invoices.filter(i => matches(query, i.invoiceNumber, customerName(i.customerId), i.sourceModule)).length);
  return <section className="panel"><div className="resource-toolbar"><label className="sr-only" htmlFor="resource-search">Cari dalam daftar</label><input id="resource-search" type="search" placeholder={`Cari ${title.toLowerCase()}…`} value={query} onChange={e => onQuery(e.target.value)} /><span className="muted">200 catatan terbaru</span>{view === 'inventory' && permitted([]) && <button className="primary" onClick={() => onOpen('product')}>+ Tambah barang</button>}{view === 'customers' && permitted(['staff']) && <button className="primary" onClick={() => onOpen('customer')}>+ Tambah pelanggan</button>}{view === 'repairs' && permitted(['staff']) && <button className="primary" onClick={() => onOpen('repair')}>+ Terima perangkat</button>}{view === 'projects' && permitted([]) && <button className="primary" onClick={() => onOpen('project')}>+ Buat proyek</button>}</div>
    {view === 'inventory' && <Table headings={['Barang / SKU', 'Kategori', 'Harga jual', 'Stok', 'Batas minimum', 'Tindakan']}>{products.filter(p => matches(query, p.name, p.sku, p.category)).map(p => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.sku}</small></td><td>{categoryNames[p.category] || p.category}</td><td className="numeric">{rupiah(p.salePrice)}</td><td><span className={p.currentStock <= p.minimumThreshold ? 'stock-low' : ''}>{p.currentStock} {p.unitOfMeasure}</span></td><td>{p.minimumThreshold}</td><td>{permitted([]) && <button className="text-button" onClick={() => onOpen('adjust', p)}>Sesuaikan stok</button>}</td></tr>)}</Table>}
    {view === 'customers' && <Table headings={['Nama pelanggan', 'Nomor telepon', 'Email', 'Alamat']}>{customers.filter(c => matches(query, c.fullName, c.phoneNumber, c.email)).map(c => <tr key={c.id}><td><strong>{c.fullName}</strong></td><td>{c.phoneNumber}</td><td>{c.email || '—'}</td><td>{c.address || '—'}</td></tr>)}</Table>}
    {view === 'repairs' && <Table headings={['Tiket / pelanggan', 'Perangkat', 'Keluhan', 'Tahap', 'Tindakan']}>{repairs.filter(r => matches(query, r.ticketNumber, r.brand, r.modelName, customerName(r.customerId))).map(r => <tr key={r.id}><td><strong>{r.ticketNumber}</strong><small>{customerName(r.customerId)}</small></td><td>{r.brand} {r.modelName}<small>{r.deviceType}</small></td><td className="wrap-cell">{r.declaredDefects}</td><td><Badge value={r.currentState} /></td><td>{permitted(['staff']) && transitions[r.currentState]?.length ? <button className="text-button" onClick={() => onOpen('transition', r)}>Ubah tahap</button> : '—'}</td></tr>)}</Table>}
    {view === 'projects' && <Table headings={['Proyek / pelanggan', 'Target penyerahan', 'Nilai kontrak', 'Status', 'Milestone']}>{projects.filter(p => matches(query, p.title, p.projectCode, customerName(p.customerId))).map(p => <tr key={p.id}><td><strong>{p.title}</strong><small>{p.projectCode} · {customerName(p.customerId)}</small><details><summary>Lingkup pekerjaan</summary><p>{p.scopeDescription}</p></details></td><td>{p.targetDeliveryDate?.slice(0, 10)}</td><td className="numeric">{rupiah(p.totalContractValue)}</td><td><Badge value={p.status} /></td><td>{p.milestones?.map(m => <div key={m.id}><small>{m.milestoneName}</small><Badge value={m.status} /></div>)}{permitted([]) && p.milestones?.some(m => !m.completedAt && m.status === 'unbilled') && <button className="text-button" onClick={() => onOpen('milestone', p)}>Selesaikan & terbitkan tagihan</button>}</td></tr>)}</Table>}
    {view === 'invoices' && <Table headings={['Nomor tagihan', 'Pelanggan / sumber', 'Total', 'Sisa tagihan', 'Status', 'Tindakan']}>{invoices.filter(i => matches(query, i.invoiceNumber, customerName(i.customerId), i.sourceModule)).map(i => <tr key={i.id}><td><strong>{i.invoiceNumber}</strong></td><td>{customerName(i.customerId)}<small>{i.sourceModule}</small></td><td className="numeric">{rupiah(i.totalAmount)}</td><td className="numeric">{rupiah((toMinor(i.totalAmount) - toMinor(i.paidAmount)) / 100)}</td><td><Badge value={i.status} /></td><td>{toMinor(i.totalAmount) > toMinor(i.paidAmount) && i.status !== 'void' && permitted(['staff']) && <button className="text-button" onClick={() => onOpen('payment', i)}>Catat pembayaran</button>}</td></tr>)}</Table>}
    {!loading && isEmpty && <Empty text={query ? 'Tidak ada hasil yang cocok dengan pencarian.' : undefined} />}
    {view === 'repairs' && <div className="panel-foot">Tagihan servis otomatis diterbitkan saat perangkat siap diambil; penutupan tiket memerlukan tagihan lunas. Unggah foto kondisi dan pemakaian suku cadang belum tersedia.</div>}
  </section>;
}
