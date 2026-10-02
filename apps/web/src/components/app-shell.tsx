import type { ReactNode } from 'react';
import type { User } from '../lib/api';
import type { View } from '../lib/navigation';
import { Icon } from './ui';

export function AppShell({ user, title, view, available, menuOpen, onMenuToggle, onNavigate, onLogout, busy, children }: {
  user: User;
  title: string;
  view: View;
  available: [View, string][];
  menuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: (view: View) => void;
  onLogout: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  return <div className="app"><a className="skip" href="#workspace">Lewati navigasi</a><aside className="sidebar"><div className="brand"><img className="brand-logo" src="/logo.webp" alt="Logo MyEkalliptus" width={44} height={44} /><span>MyEkalliptus<small>Operasional terpadu</small></span></div><div className="nav-label">Ruang kerja</div><button className="mobile-menu secondary" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={onMenuToggle}><Icon name={menuOpen ? 'close' : 'menu'} />{menuOpen ? 'Tutup menu' : title}</button><nav id="primary-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navigasi utama">{available.map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => onNavigate(key)} aria-current={view === key ? 'page' : undefined}><Icon name={key} />{label}</button>)}</nav><div className="sidebar-bottom"><span className="avatar">{user.fullName.slice(0, 2).toUpperCase()}</span><div><strong>{user.fullName}</strong><small>{user.role.replaceAll('_', ' ')}</small></div><button className="logout" onClick={onLogout} disabled={busy} aria-label="Keluar dari akun">Keluar</button></div></aside><div className="main-shell"><header className="topbar"><span>Operasional <span className="slash">/</span> <strong>{title}</strong></span><span className="date">{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span></header><main id="workspace" tabIndex={-1}>{children}<footer className="workspace-footer"><span>MyEkalliptus</span><span>Data dari server operasional. Mode offline belum tersedia.</span></footer></main></div></div>;
}
