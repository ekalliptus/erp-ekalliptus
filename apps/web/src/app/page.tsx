'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type User, type Customer, type Product, type Repair, type Project, type Invoice, type Order, type Journal, type Dashboard } from '../lib/api';
import { rupiah, toMinor, cartTotal } from '../lib/money';
import { navigation, descriptions, transitions, type View } from '../lib/navigation';
import { AppShell } from '../components/app-shell';
import { LoginScreen } from '../components/login-screen';
import { WorkspaceDialogForm, type DialogState } from '../components/workspace-dialog';
import { DashboardView } from '../views/dashboard-view';
import { PosView, type CartLine } from '../views/pos-view';
import { ResourceView, isResourceView } from '../views/resource-view';
import { LedgerView } from '../views/ledger-view';

export default function Home() {
  const [token, setToken] = useState(''); const [user, setUser] = useState<User | null>(null); const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>('dashboard'); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]); const [products, setProducts] = useState<Product[]>([]); const [repairs, setRepairs] = useState<Repair[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [invoices, setInvoices] = useState<Invoice[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [journals, setJournals] = useState<Journal[]>([]); const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]); const [customerId, setCustomerId] = useState(''); const [cash, setCash] = useState(''); const checkoutKey = useRef(''); const search = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null); const dialogRef = useRef<HTMLDialogElement>(null); const opener = useRef<HTMLElement | null>(null); const paymentRef = useRef('');
  const [transitionTarget, setTransitionTarget] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const finance = user?.role === 'superadmin' || user?.role === 'finance_admin';
  const permitted = (roles: string[]) => !!user && (user.role === 'superadmin' || roles.includes(user.role));
  const available = navigation.filter(([key]) => !(['dashboard', 'ledger'].includes(key) && !finance) && !(key === 'invoices' && !permitted(['finance_admin', 'cashier'])));
  const clearSession = useCallback(() => { sessionStorage.removeItem('nexus-token'); setToken(''); setUser(null); setCart([]); setCustomers([]); setProducts([]); setRepairs([]); setProjects([]); setInvoices([]); setOrders([]); setJournals([]); setDashboard(null); setDialog(null); setNotice(''); }, []);
  useEffect(() => { const expired = () => { clearSession(); setError('Session berakhir. Silakan masuk kembali.'); }; window.addEventListener('session-expired', expired); const saved = sessionStorage.getItem('nexus-token'); if (saved) api<User>('/auth/me', saved).then(u => { setToken(saved); setUser(u); setView(['superadmin', 'finance_admin'].includes(u.role) ? 'dashboard' : 'pos'); }).catch(e => { clearSession(); setError(e.message); }).finally(() => setBooting(false)); else setBooting(false); return () => window.removeEventListener('session-expired', expired); }, [clearSession]);
  const reload = useCallback(async () => {
    if (!token) return; setLoading(true); setError('');
    try {
      if (view === 'dashboard') { const [d, o, r, p] = await Promise.all([api<Dashboard>('/dashboard', token), api<Order[]>('/orders', token), api<Repair[]>('/repairs', token), api<Product[]>('/inventory', token)]); setDashboard(d); setOrders(o); setRepairs(r); setProducts(p); }
      if (view === 'customers') setCustomers(await api<Customer[]>('/customers', token));
      if (view === 'inventory') setProducts(await api<Product[]>('/inventory', token));
      if (['pos', 'repairs', 'projects', 'invoices'].includes(view)) {
        const c = await api<Customer[]>('/customers', token); setCustomers(c);
        if (view === 'pos') setProducts(await api<Product[]>('/inventory', token));
        if (view === 'repairs') setRepairs(await api<Repair[]>('/repairs', token));
        if (view === 'projects') setProjects(await api<Project[]>('/projects', token));
        if (view === 'invoices') setInvoices(await api<Invoice[]>('/invoices', token));
      }
      if (view === 'ledger') setJournals(await api<Journal[]>('/ledger', token));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [token, view]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else { dialogRef.current?.close(); opener.current?.focus(); } }, [dialog]);
  useEffect(() => { const hotkey = (e: KeyboardEvent) => { if (view === 'pos' && e.key === 'F2') { e.preventDefault(); search.current?.focus(); } }; window.addEventListener('keydown', hotkey); return () => window.removeEventListener('keydown', hotkey); }, [view]);
  const open = (kind: string, item?: DialogState['item']) => { opener.current = document.activeElement as HTMLElement; paymentRef.current = crypto.randomUUID(); setError(''); if (kind === 'transition') setTransitionTarget(transitions[(item as Repair).currentState]?.[0] || ''); setDialog({ kind, item }); };
  const navigate = (next: View) => { setView(next); setQuery(''); setNotice(''); setError(''); setMenuOpen(false); };
  const customerName = (id: string) => customers.find(c => c.id === id)?.fullName || 'Pelanggan';
  async function login(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(''); const f = new FormData(e.currentTarget); try { const data = await api<{ token: string; user: User }>('/auth/login', '', 'POST', { email: f.get('email'), password: f.get('password') }); sessionStorage.setItem('nexus-token', data.token); setToken(data.token); setUser(data.user); setView(['superadmin', 'finance_admin'].includes(data.user.role) ? 'dashboard' : 'pos'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function logout() { setBusy(true); try { await api('/auth/logout', token, 'POST'); } catch { /* Local token must still be removed when the server is unavailable. */ } finally { clearSession(); setBusy(false); } }
  async function mutate(path: string, method: string, body: unknown, success: string) { if (busy) return false; setBusy(true); setError(''); try { await api(path, token, method, body); setNotice(success); setDialog(null); await reload(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); } }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!dialog) return; const f = new FormData(e.currentTarget); const text = (key: string) => String(f.get(key) || '').trim(); const kind = dialog.kind; const id = dialog.item?.id;
    try {
      if (kind === 'customer') { await mutate('/customers', 'POST', { fullName: text('fullName'), phoneNumber: text('phoneNumber'), email: text('email') || undefined, address: text('address') || undefined }, 'Pelanggan berhasil disimpan.'); }
      if (kind === 'product') { toMinor(text('costPrice')); toMinor(text('salePrice')); await mutate('/inventory', 'POST', { sku: text('sku'), name: text('name'), category: text('category'), costPrice: text('costPrice'), salePrice: text('salePrice'), minimumThreshold: Number(text('minimumThreshold')), unitOfMeasure: text('unitOfMeasure') }, 'Barang dibuat. Tambahkan stok melalui penyesuaian.'); }
      if (kind === 'adjust') { const quantity = Number(text('quantity')); if (!Number.isInteger(quantity) || quantity === 0) throw new Error('Penyesuaian harus bilangan bulat bukan nol.'); await mutate(`/inventory/${id}/adjust`, 'POST', { quantity, reason: text('reason') }, 'Penyesuaian stok berhasil dicatat.'); }
      if (kind === 'repair') await mutate('/repairs', 'POST', { customerId: text('customerId'), deviceType: text('deviceType'), brand: text('brand'), modelName: text('modelName'), declaredDefects: text('declaredDefects') }, 'Tiket servis berhasil dibuat.');
      if (kind === 'transition') {
        const repair = dialog.item as Repair;
        const target = text('state');
        const quoteNeeded = ['diagnosed_quotation_ready', 'waiting_customer_approval', 'repair_approved_in_progress', 'ready_for_pickup'].includes(target);
        if (quoteNeeded && !repair.quotationAmount && !text('quotationAmount')) throw new Error('Tetapkan kuotasi jasa sebelum melanjutkan ke tahap ini.');
        if (text('quotationAmount') && ['inspection_pending', 'diagnosed_quotation_ready'].includes(repair.currentState)) {
          if (!text('quotationDescription') && !repair.quotationDescription) throw new Error('Isi deskripsi pekerjaan untuk kuotasi jasa.');
          await api(`/repairs/${repair.id}/quotation`, token, 'POST', { amount: text('quotationAmount'), description: text('quotationDescription') || repair.quotationDescription });
        }
        const evidence: Record<string, string> = {};
        for (const key of ['intakeEvidence', 'approvalEvidence', 'qcEvidence']) if (text(key)) evidence[key] = text(key);
        await mutate(`/repairs/${repair.id}/state`, 'PATCH', { state: target, ...evidence }, 'Tahap servis berhasil diperbarui.');
      }
      if (kind === 'project') { toMinor(text('totalContractValue')); await mutate('/projects', 'POST', { customerId: text('customerId'), title: text('title'), totalContractValue: text('totalContractValue'), targetDeliveryDate: text('targetDeliveryDate'), scopeDescription: text('scopeDescription') }, 'Proyek dan milestone penyerahan berhasil dibuat.'); }
      if (kind === 'payment') { const inv = dialog.item as Invoice; const amount = toMinor(text('amount')); if (!amount || amount > toMinor(inv.totalAmount) - toMinor(inv.paidAmount)) throw new Error('Pembayaran harus positif dan tidak melebihi sisa tagihan.'); await mutate(`/invoices/${id}/payments`, 'POST', { amount: text('amount'), paymentMethod: text('paymentMethod'), paymentReference: paymentRef.current }, 'Pembayaran berhasil dicatat.'); }
      if (kind === 'milestone') { const project = dialog.item as Project; const milestone = project.milestones.find(m => !m.completedAt && m.status === 'unbilled'); if (milestone) await mutate(`/projects/${id}/milestones/${milestone.id}/complete`, 'POST', {}, 'Milestone selesai. Tagihan proyek telah diterbitkan.'); }
    } catch (e) { setError((e as Error).message); }
  }
  function addProduct(product: Product) { setError(''); setNotice(''); setCart(old => { const found = old.find(x => x.product.id === product.id); if ((found?.quantity || 0) >= product.currentStock) return old; return found ? old.map(x => x.product.id === product.id ? { ...x, quantity: x.quantity + 1 } : x) : [...old, { product, quantity: 1 }]; }); checkoutKey.current = ''; }
  function removeLine(id: string) { setCart(old => old.filter(i => i.product.id !== id)); checkoutKey.current = ''; }
  function changeQuantity(id: string, quantity: number) { setCart(old => old.map(i => i.product.id === id ? { ...i, quantity } : i)); checkoutKey.current = ''; }
  async function checkout(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy || !cart.length) return;
    const total = cartTotal(cart.map(x => ({ price: x.product.salePrice, quantity: x.quantity })));
    let cashMinor = 0; try { cashMinor = cash ? toMinor(cash) : 0; } catch { cashMinor = 0; }
    if (cashMinor < total) { setError('Uang diterima belum mencukupi.'); return; }
    if (!checkoutKey.current) checkoutKey.current = crypto.randomUUID(); setBusy(true); setError(''); try { const order = await api<Order>('/orders', token, 'POST', { customerId: customerId || undefined, items: cart.map(x => ({ itemId: x.product.id, quantity: x.quantity })), paymentMethod: 'cash', idempotencyKey: checkoutKey.current }); setCart([]); setCash(''); setCustomerId(''); checkoutKey.current = ''; setNotice(`Transaksi ${order.orderNumber} berhasil. Total ${rupiah(order.totalAmount)}. Kembalian ${rupiah((cashMinor - total) / 100)}.`); await reload(); search.current?.focus(); } catch (e) { setError(`${(e as Error).message} Jika koneksi terputus, coba lagi tanpa mengubah keranjang; transaksi tidak digandakan.`); } finally { setBusy(false); } }
  if (booting) return <main className="boot" role="status">Menghubungkan ruang kerja…</main>;
  if (!user) return <LoginScreen busy={busy} error={error} onSubmit={login} />;
  const title = navigation.find(([key]) => key === view)?.[1] ?? '';
  return <AppShell user={user} title={title} view={view} available={available} menuOpen={menuOpen} onMenuToggle={() => setMenuOpen(!menuOpen)} onNavigate={navigate} onLogout={logout} busy={busy}>
    <div className="page-heading"><div><h1>{title}</h1><p>{descriptions[view]}</p></div><button className="secondary" onClick={reload} disabled={loading || busy}>{loading ? 'Memuat…' : 'Perbarui data'}</button></div>
    {error && !dialog && <div role="alert" className="alert error">{error}</div>}
    {notice && <div role="status" className="alert success">{notice}</div>}
    {loading && <div className="loading" role="status">Memuat data terbaru…</div>}
    {view === 'dashboard' && dashboard && <DashboardView dashboard={dashboard} orders={orders} permitted={permitted} onNavigate={navigate} />}
    {view === 'pos' && <PosView products={products} customers={customers} cart={cart} customerId={customerId} cash={cash} query={query} loading={loading} busy={busy} permitted={permitted} searchRef={search} onQuery={setQuery} onAddProduct={addProduct} onRemoveLine={removeLine} onQuantity={changeQuantity} onCustomerChange={id => { setCustomerId(id); checkoutKey.current = ''; }} onCash={setCash} onCheckout={checkout} />}
    {isResourceView(view) && <ResourceView view={view} title={title} query={query} onQuery={setQuery} loading={loading} customers={customers} products={products} repairs={repairs} projects={projects} invoices={invoices} permitted={permitted} customerName={customerName} onOpen={open} />}
    {view === 'ledger' && <LedgerView journals={journals} loading={loading} />}
    <dialog ref={dialogRef} onCancel={e => { if (busy) e.preventDefault(); else setDialog(null); }} onClose={() => { if (!busy) setDialog(null); }} aria-labelledby="dialog-title">{dialog && <WorkspaceDialogForm dialog={dialog} busy={busy} error={error} customers={customers} transitionTarget={transitionTarget} onTransitionTarget={setTransitionTarget} onDismiss={() => setDialog(null)} onSubmit={submit} />}</dialog>
  </AppShell>;
}
