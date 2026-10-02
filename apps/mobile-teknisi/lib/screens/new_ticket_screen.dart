import 'package:flutter/material.dart';
import '../api.dart';
import '../models.dart';
import '../repair_flow.dart';

class NewTicketPage extends StatefulWidget {
  const NewTicketPage({super.key, required this.api, required this.customers});
  final Api api;
  final Map<String, String> customers;
  @override
  State<NewTicketPage> createState() => _NewTicketPageState();
}

class _NewTicketPageState extends State<NewTicketPage> {
  final _formKey = GlobalKey<FormState>();
  String? _customerId;
  String _deviceType = 'smartphone';
  final _brand = TextEditingController();
  final _model = TextEditingController();
  final _defects = TextEditingController();
  bool _busy = false;
  bool _loadingCustomers = true;
  Map<String, String> _customers = const {};
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  @override
  void dispose() {
    _brand.dispose();
    _model.dispose();
    _defects.dispose();
    super.dispose();
  }

  Future<void> _loadCustomers() async {
    try {
      final list = await widget.api.get('/customers') as List;
      if (!mounted) return;
      setState(() {
        _customers = {for (final c in list.map((j) => Customer.fromJson(j as Map<String, dynamic>))) c.id: '${c.fullName} — ${c.phoneNumber}'};
        _loadingCustomers = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() { _loadingCustomers = false; _error = 'Daftar pelanggan gagal dimuat. Kembali lalu coba lagi.'; });
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/repairs', {
        'customerId': _customerId,
        'deviceType': _deviceType,
        'brand': _brand.text.trim(),
        'modelName': _model.text.trim(),
        'declaredDefects': _defects.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tiket servis dibuat.')));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _error = e.message; _busy = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _error = 'Server tidak dapat dihubungi.'; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Terima perangkat')),
        body: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              const Text('Penerimaan perangkat', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              const Text('Catat identitas dan kondisi awal bersama pelanggan.', style: TextStyle(color: Color(0xFF61756C), height: 1.6)),
              const SizedBox(height: 26),
              const Text('01 / Pelanggan & perangkat', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF23664D))),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _customerId,
                decoration: InputDecoration(labelText: 'Pelanggan', helperText: _loadingCustomers ? 'Memuat daftar pelanggan…' : null),
                items: [for (final e in _customers.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                validator: (v) => v == null ? 'Pilih pelanggan.' : null,
                onChanged: _loadingCustomers ? null : (v) => setState(() => _customerId = v),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                initialValue: _deviceType,
                decoration: const InputDecoration(labelText: 'Jenis perangkat'),
                items: [for (final e in deviceTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                onChanged: (v) => setState(() => _deviceType = v ?? _deviceType),
              ),
              const SizedBox(height: 14),
              TextFormField(controller: _brand, decoration: const InputDecoration(labelText: 'Merek'), validator: (v) => (v == null || v.trim().isEmpty) ? 'Isi merek.' : null),
              const SizedBox(height: 14),
              TextFormField(controller: _model, decoration: const InputDecoration(labelText: 'Model'), validator: (v) => (v == null || v.trim().isEmpty) ? 'Isi model.' : null),
              const SizedBox(height: 14),
              TextFormField(
                controller: _defects,
                decoration: const InputDecoration(labelText: 'Keluhan dan kondisi saat diterima'),
                maxLines: 4,
                validator: (v) => (v == null || v.trim().length < 3) ? 'Jelaskan keluhan perangkat.' : null,
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(_error!, style: const TextStyle(color: Color(0xFFA72D35))),
              ],
              const SizedBox(height: 22),
              FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Menyimpan…' : 'Simpan tiket')),
            ],
          ),
        ),
      );
}
