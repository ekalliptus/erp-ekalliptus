import type { ReactNode } from 'react';
import { stateNames } from '../lib/navigation';

const iconPaths: Record<string, string> = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  pos: 'M3 3h2l3 12h10l3-8H6 M9 20h.01 M18 20h.01',
  inventory: 'm3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l10 4',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4',
  repairs: 'M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4z',
  projects: 'M3 7V4h6l3 3h9v13H3z M3 10h18',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3',
  ledger: 'M4 3h16v18H4z M8 3v18 M11 8h6 M11 12h6 M11 16h4',
  arrow: 'm9 5 7 7-7 7', plus: 'M12 5v14 M5 12h14', close: 'm6 6 12 12 M6 18 18 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16', refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M18 18A8 8 0 0 1 4 12',
  leaf: 'M20 3C8 2 3 7 4 14c1 7 11 8 14 1 2-4 2-8 2-12Z M5 20 15 9',
};

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`icon ${className}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name] || iconPaths.inventory} /></svg>;
}

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${['paid', 'completed', 'delivered_closed', 'settled'].includes(value) ? 'good' : ''}`}>{stateNames[value] || value.replaceAll('_', ' ')}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  return <div className="table-scroll"><table><thead><tr>{headings.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export function Empty({ text = 'Belum ada data. Tambahkan data pertama untuk mulai bekerja.' }: { text?: string }) {
  return <div className="empty"><span><Icon name="inventory" /></span><h3>Belum ada catatan</h3><p>{text}</p></div>;
}
