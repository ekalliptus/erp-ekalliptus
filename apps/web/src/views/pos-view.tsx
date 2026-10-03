import type { FormEvent, RefObject } from 'react';
import type { Customer, Product } from '../lib/api';
import { cartTotal, rupiah, toMinor } from '../lib/money';
import { matches } from '../lib/navigation';
import { Empty, Field, Icon } from '../components/ui';

export type CartLine = { product: Product; quantity: number };

export function PosView({ products, customers, cart, customerId, cash, query, loading, busy, permitted, searchRef, onQuery, onAddProduct, onRemoveLine, onQuantity, onCustomerChange, onCash, onCheckout }: {
  products: Product[];
  customers: Customer[];
  cart: CartLine[];
  customerId: string;
  cash: string;
  query: string;
  loading: boolean;
  busy: boolean;
  permitted: (roles: string[]) => boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onAddProduct: (p: Product) => void;
  onRemoveLine: (id: string) => void;
  onQuantity: (id: string, n: number) => void;
  onCustomerChange: (id: string) => void;
  onCash: (v: string) => void;
  onCheckout: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const visible = products.filter(p => matches(query, p.name, p.sku));
  const total = cartTotal(cart.map(x => ({ price: x.product.salePrice, quantity: x.quantity })));
  const units = cart.reduce((n, x) => n + x.quantity, 0);
  let cashMinor = 0;
  try { cashMinor = cash ? toMinor(cash) : 0; } catch { cashMinor = 0; }
  return <div className="pos-layout"><section className="panel catalog"><div className="panel-heading"><div><h2>Katalog barang</h2><small>{products.length} barang tersedia dalam katalog</small></div><kbd>F2</kbd></div><div className="search-wrap"><label className="sr-only" htmlFor="product-search">Cari produk atau SKU</label><input ref={searchRef} id="product-search" type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Cari nama barang atau SKU…" /></div><div className="product-list">{visible.map(p => <button className="product-row" key={p.id} disabled={p.currentStock < 1 || busy || !permitted(['staff'])} onClick={() => onAddProduct(p)}><span className="product-symbol"><Icon name="inventory" /></span><span><strong>{p.name}</strong><small>{p.sku} <span className="dot">·</span> Stok {p.currentStock} {p.unitOfMeasure}</small></span><b>{rupiah(p.salePrice)}</b><span className="add-icon"><Icon name="plus" /></span></button>)}{!visible.length && !loading && <Empty text={query ? 'Tidak ada barang yang cocok. Coba nama atau SKU lain.' : 'Tambahkan barang dan stok melalui Inventori.'} />}</div><div className="panel-foot">Pilih barang untuk menambahkan satu unit ke keranjang.</div></section><form className="panel cart" onSubmit={onCheckout}><div className="panel-heading"><h2>Transaksi baru</h2><span className="badge">{units} unit</span></div><div className="cart-body"><Field label="Pelanggan"><select value={customerId} onChange={e => onCustomerChange(e.target.value)} disabled={busy}><option value="">Pelanggan umum</option>{customers.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}</select></Field><div className="cart-items">{!cart.length && <Empty text="Pilih barang dari katalog di sebelah kiri." />}{cart.map(x => <CartRow key={x.product.id} line={x} busy={busy} onRemove={onRemoveLine} onQuantity={onQuantity} />)}</div><div className="cart-total"><span>Total</span><strong>{rupiah(total / 100)}</strong></div><Field label="Uang tunai diterima (Rp)"><input type="number" min={total / 100} step="0.01" required value={cash} onChange={e => onCash(e.target.value)} disabled={busy} placeholder="0" /></Field><div className="change"><span>Kembalian</span><strong>{rupiah(Math.max(0, cashMinor - total) / 100)}</strong></div><button className="primary full checkout" disabled={busy || !cart.length || !permitted(['staff'])}>{busy ? 'Memproses transaksi…' : 'Selesaikan pembayaran'}</button><p className="fineprint">Pembayaran tunai. Stok dan jurnal dicatat setelah server mengonfirmasi. Harga akhir divalidasi server.</p></div></form></div>;
}

function CartRow({ line, busy, onRemove, onQuantity }: { line: CartLine; busy: boolean; onRemove: (id: string) => void; onQuantity: (id: string, n: number) => void }) {
  const { product } = line;
  return <div className="cart-line"><div><strong>{product.name}</strong><small>{rupiah(product.salePrice)} / {product.unitOfMeasure}</small></div><button type="button" className="text-button danger" disabled={busy} onClick={() => onRemove(product.id)} aria-label={`Hapus ${product.name}`}>Hapus</button><label className="qty-label">Jumlah<input type="number" min="1" max={product.currentStock} step="1" value={line.quantity} disabled={busy} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= product.currentStock) onQuantity(product.id, n); }} /></label><b className="line-total">{rupiah(cartTotal([{ price: product.salePrice, quantity: line.quantity }]) / 100)}</b></div>;
}
