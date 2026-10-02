import 'package:flutter/material.dart';
import '../api.dart';
import '../models.dart';
import '../repair_flow.dart';

class TicketPage extends StatefulWidget {
  const TicketPage({super.key, required this.api, required this.repair, required this.customers, required this.canEdit});
  final bool canEdit;
  final Api api;
  final Repair repair;
  final Map<String, String> customers;
  @override
  State<TicketPage> createState() => _TicketPageState();
}

class _TicketPageState extends State<TicketPage> {
  late String _target = (transitions[widget.repair.currentState] ?? const ['']).first;
  final _evidence = TextEditingController();
  final _quoteAmount = TextEditingController();
  final _quoteDescription = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _evidence.dispose();
    _quoteAmount.dispose();
    _quoteDescription.dispose();
    super.dispose();
  }

  bool get _quoteOpen => ['inspection_pending', 'diagnosed_quotation_ready'].contains(widget.repair.currentState);
  bool get _quoteNeeded => ['diagnosed_quotation_ready', 'waiting_customer_approval', 'repair_approved_in_progress', 'ready_for_pickup'].contains(_target) && widget.repair.quotationAmount == null;

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      if (!widget.canEdit) throw ApiException('Akses hanya baca.');
      if (_evidenceLabel() != null && _evidence.text.trim().length < 3) throw ApiException('Lengkapi bukti atau catatan tahap, minimal 3 karakter.');
      final quote = _quoteAmount.text.trim();
      if (quote.isNotEmpty && (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(quote) || (double.tryParse(quote) ?? 0) <= 0)) throw ApiException('Kuotasi harus positif, maksimal dua angka desimal.');
      if (_quoteOpen && quote.isNotEmpty) {
        if (_quoteDescription.text.trim().isEmpty && widget.repair.quotationDescription == null) {
          throw ApiException('Isi deskripsi pekerjaan untuk kuotasi jasa.');
        }
        await widget.api.post('/repairs/${widget.repair.id}/quotation', {
          'amount': quote,
          'description': _quoteDescription.text.trim().isNotEmpty ? _quoteDescription.text.trim() : widget.repair.quotationDescription,
        });
      }
      if (_quoteNeeded && quote.isEmpty) throw ApiException('Tetapkan kuotasi jasa sebelum tahap ini.');
      final body = {'state': _target};
      if (_evidence.text.trim().isNotEmpty) {
        if (_target == 'inspection_pending') body['intakeEvidence'] = _evidence.text.trim();
        if (_target == 'repair_approved_in_progress') body['approvalEvidence'] = _evidence.text.trim();
        if (_target == 'ready_for_pickup') body['qcEvidence'] = _evidence.text.trim();
      }
      await widget.api.patch('/repairs/${widget.repair.id}/state', body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Tahap diperbarui ke ${stateNames[_target] ?? _target}.')));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _error = e.message; _busy = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _error = 'Server tidak dapat dihubungi.'; _busy = false; });
    }
  }

  String? _evidenceLabel() {
    if (_target == 'inspection_pending') return 'Bukti kondisi awal saat diterima';
    if (_target == 'repair_approved_in_progress') return 'Bukti persetujuan pelanggan';
    if (_target == 'ready_for_pickup') return 'Catatan pemeriksaan kualitas';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.repair;
    final targets = widget.canEdit ? transitions[r.currentState] ?? const <String>[] : const <String>[];
    final evidenceLabel = _evidenceLabel();
    return Scaffold(
      appBar: AppBar(title: Text(r.ticketNumber)),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(margin: EdgeInsets.zero, child: Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.build_circle_outlined, size: 40, color: Color(0xFF23664D)),
            const SizedBox(height: 18),
            Text('${r.brand} ${r.modelName}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text('${widget.customers[r.customerId] ?? 'Pelanggan'} · ${deviceTypes[r.deviceType] ?? r.deviceType}'),
            const SizedBox(height: 12),
            Chip(label: Text(stateNames[r.currentState] ?? r.currentState)),
          ]))),
          const SizedBox(height: 24),
          const Text('Keluhan & kondisi awal', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(r.declaredDefects, style: const TextStyle(height: 1.6)),
          if (r.quotationAmount != null) ...[
            const SizedBox(height: 12),
            Text('Kuotasi jasa: ${rupiah(r.quotationAmount!)} — ${r.quotationDescription ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
          const Divider(height: 30),
          if (targets.isEmpty)
            Text(widget.canEdit ? 'Tiket sudah ${stateNames[r.currentState] ?? r.currentState}. Tidak ada transisi lagi.' : 'Akses hanya baca. Perubahan tahap dilakukan oleh teknisi.', style: const TextStyle(color: Color(0xFF61756C)))
          else ...[
            DropdownButtonFormField<String>(
              initialValue: _target,
              decoration: const InputDecoration(labelText: 'Tahap berikutnya'),
              items: [for (final s in targets) DropdownMenuItem(value: s, child: Text(stateNames[s] ?? s))],
              isExpanded: true,
              onChanged: _busy ? null : (v) => setState(() { _target = v ?? _target; _evidence.clear(); }),
            ),
            if (_quoteOpen) ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _quoteAmount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'Kuotasi jasa (Rp)',
                  helperText: r.quotationAmount == null ? 'Wajib sebelum tahap diagnosis ke atas. Mengikat nilai tagihan servis.' : 'Kosongkan bila kuotasi tidak berubah.',
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(controller: _quoteDescription, decoration: const InputDecoration(labelText: 'Deskripsi pekerjaan kuotasi'), maxLines: 2),
            ],
            if (evidenceLabel != null) ...[
              const SizedBox(height: 14),
              TextFormField(
                controller: _evidence,
                decoration: InputDecoration(labelText: evidenceLabel, helperText: _target == 'ready_for_pickup' ? 'Tagihan servis diterbitkan otomatis pada tahap ini.' : null),
                maxLines: 3,
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: const TextStyle(color: Color(0xFFA72D35))),
            ],
            const SizedBox(height: 22),
            FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Menyimpan…' : 'Simpan tahap')),
            const SizedBox(height: 10),
            Text('Server memeriksa izin dan aturan transisi. Pengambilan perangkat mensyaratkan tagihan lunas.',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
          ],
        ],
      ),
    );
  }
}
