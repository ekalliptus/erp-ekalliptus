import { hasPermission } from '@ekalliptus/contracts';
import {
  ArrowRight,
  Boxes,
  Briefcase,
  Cpu,
  FileSpreadsheet,
  Fingerprint,
  LayoutDashboard,
  Printer,
  Search,
  ShieldCheck,
  Store,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MeResponse } from '../lib/api.ts';

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  path: string;
  icon: typeof LayoutDashboard;
}

export function CommandPalette({
  open,
  onClose,
  me,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  me: MeResponse;
  onNavigate: (to: string) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const perms = me.permissions;
    const list: PaletteItem[] = [
      {
        id: 'nav-home',
        group: 'Navigasi',
        label: 'Ringkasan Ekosistem',
        hint: 'Arus kas, stok kritis, dan antrean persetujuan',
        path: '/',
        icon: LayoutDashboard,
      },
      {
        id: 'nav-profile',
        group: 'Navigasi',
        label: 'Profil & Ruang Kerja',
        hint: 'Identitas akun, ringkasan role, slip gaji & matriks hak akses',
        path: '/profile',
        icon: Users,
      },
    ];
    if (hasPermission(perms, 'finance', 'view')) {
      list.push({
        id: 'nav-finance',
        group: 'Navigasi',
        label: 'Kasir / POS & Penjualan',
        hint: 'Transaksi kasir, keranjang, diskon, PPN, struk & laporan',
        path: '/finance',
        icon: Store,
      });
    }
    if (hasPermission(perms, 'inventory', 'view')) {
      list.push({
        id: 'nav-inventory',
        group: 'Navigasi',
        label: 'Inventaris & Supply Chain',
        hint: 'Stok gudang, katalog SKU, mutasi, supplier & PO',
        path: '/inventory',
        icon: Boxes,
      });
    }
    if (hasPermission(perms, 'attendance', 'view')) {
      list.push({
        id: 'nav-attendance',
        group: 'Navigasi',
        label: 'Absensi & Geofence',
        hint: 'Clock-in/out GPS + scan wajah, jam aktif & pengajuan izin',
        path: '/attendance',
        icon: Fingerprint,
      });
    }
    if (hasPermission(perms, 'payroll', 'view')) {
      list.push({
        id: 'nav-payroll',
        group: 'Navigasi',
        label: 'Payroll & Slip Gaji',
        hint: 'Kalkulasi periode gaji, approval, posting kas & slip PDF',
        path: '/payroll',
        icon: FileSpreadsheet,
      });
    }
    if (hasPermission(perms, 'portfolio', 'view')) {
      list.push({
        id: 'nav-portfolio',
        group: 'Navigasi',
        label: 'Portofolio Web',
        hint: 'Upload & kelola katalog project untuk web ekalliptus.com',
        path: '/portfolio',
        icon: Briefcase,
      });
    }
    if (hasPermission(perms, 'printer', 'view')) {
      list.push({
        id: 'nav-printer',
        group: 'Navigasi',
        label: 'Smart Printer',
        hint: 'Antrean cetak WA & manual, preview, approval HP Smart Tank 583 & kas',
        path: '/printer',
        icon: Printer,
      });
    }
    if (hasPermission(perms, 'ai', 'view')) {
      list.push({
        id: 'nav-ai',
        group: 'Kontrol',
        label: 'AI Management',
        hint: 'Provider, API key, prompt AI Konsultasi web & Auto-Fill Portofolio',
        path: '/ai',
        icon: Cpu,
      });
    }
    if (hasPermission(perms, 'rbac', 'view')) {
      list.push({
        id: 'nav-rbac',
        group: 'Kontrol',
        label: 'Akses, Role & Karyawan',
        hint: 'Matriks izin role dan direktori karyawan',
        path: '/rbac',
        icon: Users,
      });
    }
    if (hasPermission(perms, 'audit', 'view')) {
      list.push({
        id: 'nav-audit',
        group: 'Kontrol',
        label: 'Audit Trail Immutable',
        hint: 'Log aktivitas web, android, dan system beserta diff data',
        path: '/audit',
        icon: ShieldCheck,
      });
    }
    return list;
  }, [me.permissions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-20 sm:pt-24">
      <div className="fixed inset-0 bg-black/45" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palet Perintah"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border-strong bg-surface text-text-primary"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) =>
              filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0,
            );
          } else if (e.key === 'Enter' && filtered[activeIndex]) {
            e.preventDefault();
            onNavigate(filtered[activeIndex].path);
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          <label htmlFor={inputId} className="sr-only">
            Cari modul atau perintah
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ketik nama modul (Keuangan, Stok, Absensi, Payroll, Audit)..."
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup palet perintah"
            className="rounded p-1 text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Daftar modul">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-text-secondary">
              Tidak ada modul yang cocok dengan kata kunci tersebut.
            </li>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === activeIndex;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onNavigate(item.path);
                      onClose();
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left ${
                      isSelected
                        ? 'bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                        : 'text-text-primary hover:bg-surface-subtle'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.label}</p>
                        <p
                          className={`truncate text-xs ${
                            isSelected ? 'text-[#115E59] dark:text-[#B4C0B9]' : 'text-text-secondary'
                          }`}
                        >
                          {item.hint}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-surface-subtle/60 px-4 py-2 text-[11px] text-text-secondary">
          <span>Gunakan panah atas/bawah dan Enter untuk berpindah</span>
          <span>ESC untuk menutup</span>
        </div>
      </div>
    </div>
  );
}
