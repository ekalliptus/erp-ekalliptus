import type { Journal } from '../lib/api';
import { rupiah } from '../lib/money';
import { Empty, Table } from '../components/ui';

export function LedgerView({ journals, loading }: { journals: Journal[]; loading: boolean }) {
  return <section className="panel"><div className="panel-heading"><h2>Jurnal transaksi</h2><span className="badge">Hanya baca</span></div>{journals.length ? journals.map(j => <article className="journal" key={j.id}><header><div><h3>{j.memo}</h3><small>{j.referenceType} · {new Date(j.createdAt).toLocaleString('id-ID')}</small></div><span className="journal-id">{j.id.slice(0, 8)}</span></header><Table headings={['Kode akun', 'Debit', 'Kredit']}>{j.lines.map((l, n) => <tr key={n}><td>{l.accountCode}</td><td className="numeric">{rupiah(l.debit)}</td><td className="numeric">{rupiah(l.credit)}</td></tr>)}</Table></article>) : !loading && <Empty text="Transaksi operasional yang berhasil akan membentuk jurnal otomatis." />}</section>;
}
