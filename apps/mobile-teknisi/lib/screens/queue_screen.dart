import 'package:flutter/material.dart';
import '../api.dart';
import '../models.dart';
import '../repair_flow.dart';
import 'ticket_screen.dart';
import 'new_ticket_screen.dart';
import 'login_screen.dart';

class QueuePage extends StatefulWidget {
  const QueuePage({super.key, required this.api, required this.user, required this.role});
  final Api api;
  final String user, role;
  @override
  State<QueuePage> createState() => _QueuePageState();
}

class _QueuePageState extends State<QueuePage> {
  List<Repair> _repairs = [];
  Map<String, String> _customers = {};
  bool _loading = true;
  bool _loggingOut = false;
  String _query = '', _filter = 'active';
  String? _error;
  bool get _canCreate => ['superadmin', 'hardware_tech', 'cashier'].contains(widget.role);
  bool get _canEdit => ['superadmin', 'hardware_tech'].contains(widget.role);

  Future<void> _logout() async {
    setState(() => _loggingOut = true);
    try {
      await widget.api.post('/auth/logout', {}).timeout(const Duration(seconds: 10));
    } catch (_) {
      // Always clear the local session; server expiry covers unavailable revocation.
    } finally {
      widget.api.token = null;
      if (mounted) Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginPage()), (_) => false);
    }
  }

  @override
  void initState() { super.initState(); _reload(); }

  Future<void> _reload() async {
    setState(() { _loading = true; _error = null; });
    try {
      final repairs = (await widget.api.get('/repairs') as List).map((j) => Repair.fromJson(j as Map<String, dynamic>)).toList();
      final customers = {
        for (final c in (await widget.api.get('/customers') as List).map((j) => Customer.fromJson(j as Map<String, dynamic>))) c.id: c.fullName,
      };
      if (!mounted) return;
      setState(() { _repairs = repairs; _customers = customers; _loading = false; });
    } on ApiException catch (e) {
      if (e.message.startsWith('Sesi berakhir') && mounted) {
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginPage()));
        return;
      }
      if (!mounted) return;
      setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _error = 'Server tidak dapat dihubungi.'; _loading = false; });
    }
  }

  Future<void> _openTicket(Repair repair) async {
    final changed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => TicketPage(api: widget.api, repair: repair, customers: _customers, canEdit: _canEdit)));
    if (changed == true && mounted) _reload();
  }

  Future<void> _newTicket() async {
    final changed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(builder: (_) => NewTicketPage(api: widget.api, customers: _customers)));
    if (changed == true && mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _repairs.where((r) => matchesRepair(r, _customers[r.customerId] ?? '', _query, _filter)).toList();
    final active = _repairs.where((r) => matchesRepair(r, '', '', 'active')).length;
    final ready = _repairs.where((r) => r.currentState == 'ready_for_pickup').length;
    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [Icon(Icons.eco_outlined), SizedBox(width: 10), Text('MyEkalliptus', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 20))]),
        actions: [
          IconButton(onPressed: _loading || _loggingOut ? null : _reload, icon: const Icon(Icons.refresh), tooltip: 'Perbarui antrean'),
          IconButton(onPressed: _loggingOut ? null : _logout, icon: const Icon(Icons.logout), tooltip: 'Keluar dari akun'),
        ],
      ),
      floatingActionButton: _canCreate ? FloatingActionButton.extended(onPressed: _loggingOut ? null : _newTicket, icon: const Icon(Icons.add), label: const Text('Terima perangkat')) : null,
      body: SafeArea(child: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 100),
          children: [
            Text('Ruang servis', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, color: const Color(0xFF203B32))),
            const SizedBox(height: 6),
            Text('Selamat bekerja, ${widget.user}.', style: const TextStyle(color: Color(0xFF61756C))),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(color: const Color(0xFF153E33), borderRadius: BorderRadius.circular(20)),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Tiket aktif', style: TextStyle(color: Color(0xFFC0D4C8))),
                  Text(_loading ? '—' : '$active', style: const TextStyle(fontSize: 36, color: Colors.white, fontWeight: FontWeight.w600)),
                ])),
                Container(width: 1, height: 56, color: const Color(0xFF527462)),
                Expanded(child: Padding(padding: const EdgeInsets.only(left: 24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Siap diambil', style: TextStyle(color: Color(0xFFC0D4C8))),
                  Text(_loading ? '—' : '$ready', style: const TextStyle(fontSize: 36, color: Colors.white, fontWeight: FontWeight.w600)),
                ]))),
              ]),
            ),
            const SizedBox(height: 22),
            TextField(onChanged: (value) => setState(() => _query = value), decoration: const InputDecoration(hintText: 'Tiket, perangkat, atau pelanggan', labelText: 'Cari antrean', prefixIcon: Icon(Icons.search))),
            const SizedBox(height: 12),
            SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
              for (final entry in const {'active': 'Aktif', 'ready': 'Siap diambil', 'closed': 'Selesai', 'all': 'Semua'}.entries)
                Padding(padding: const EdgeInsets.only(right: 8), child: FilterChip(label: Text(entry.value), selected: _filter == entry.key, onSelected: (_) => setState(() => _filter = entry.key))),
            ])),
            const SizedBox(height: 18),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              const Text('Antrean perangkat', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
              Text('${visible.length} tiket', style: const TextStyle(color: Color(0xFF61756C))),
            ]),
            const SizedBox(height: 12),
            if (_loading) const Padding(padding: EdgeInsets.all(36), child: Center(child: CircularProgressIndicator()))
            else if (_error != null) Card(child: Padding(padding: const EdgeInsets.all(24), child: Column(children: [
              const Icon(Icons.wifi_off_outlined, size: 32), const SizedBox(height: 12), Text(_error!, textAlign: TextAlign.center), const SizedBox(height: 12), OutlinedButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh), label: const Text('Coba lagi')),
            ])))
            else if (visible.isEmpty) Card(child: Padding(padding: const EdgeInsets.all(32), child: Column(children: [
              const Icon(Icons.fact_check_outlined, size: 44, color: Color(0xFF63846B)), const SizedBox(height: 18),
              Text(_repairs.isEmpty ? 'Belum ada perangkat masuk' : 'Tidak ada tiket yang cocok', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600), textAlign: TextAlign.center),
              const SizedBox(height: 8), Text(_repairs.isEmpty ? 'Tiket yang diterima akan muncul di antrean ini.' : 'Coba kata pencarian lain atau pilih filter Semua.', textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF61756C))),
            ])))
            else ...visible.map((r) => Card(
              margin: const EdgeInsets.only(bottom: 12),
              clipBehavior: Clip.antiAlias,
              child: InkWell(onTap: () => _openTicket(r), child: Padding(padding: const EdgeInsets.all(18), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Container(padding: const EdgeInsets.all(11), decoration: BoxDecoration(color: const Color(0xFFEDF4E9), borderRadius: BorderRadius.circular(12)), child: Icon(r.deviceType == 'laptop' ? Icons.laptop_outlined : r.deviceType == 'printer' ? Icons.print_outlined : Icons.phone_android_outlined, color: const Color(0xFF346B4C))),
                  const SizedBox(width: 14),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.ticketNumber, style: const TextStyle(fontSize: 12, color: Color(0xFF61756C))),
                    const SizedBox(height: 4), Text('${r.brand} ${r.modelName}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                  ])),
                  const Icon(Icons.chevron_right, color: Color(0xFF61756C)),
                ]),
                const SizedBox(height: 14),
                Text(_customers[r.customerId] ?? 'Pelanggan', style: const TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 5),
                Text(r.declaredDefects, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xFF61756C), fontSize: 13)),
                const SizedBox(height: 14),
                Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), decoration: BoxDecoration(color: const Color(0xFFEDF4E9), borderRadius: BorderRadius.circular(7)), child: Text(stateNames[r.currentState] ?? r.currentState, style: const TextStyle(color: Color(0xFF346B4C), fontWeight: FontWeight.w600, fontSize: 12))),
              ]))),
            )),
            const SizedBox(height: 10),
            const Text('Ringkasan berdasarkan tiket yang dimuat dari server.', style: TextStyle(fontSize: 12, color: Color(0xFF61756C))),
          ],
        ),
      )),
    );
  }
}
