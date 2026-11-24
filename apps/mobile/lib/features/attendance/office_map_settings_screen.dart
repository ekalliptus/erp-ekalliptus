import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../common/erp_widgets.dart';
import '../common/theme_transition.dart';

class OfficeMapSettingsScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;
  final bool enableTileLayer;

  const OfficeMapSettingsScreen({
    super.key,
    required this.profile,
    this.enableTileLayer = true,
  });

  @override
  ConsumerState<OfficeMapSettingsScreen> createState() =>
      _OfficeMapSettingsScreenState();
}

class _OfficeMapSettingsScreenState
    extends ConsumerState<OfficeMapSettingsScreen> {
  final _mapController = MapController();
  final _nameCtrl = TextEditingController();
  final _radiusCtrl = TextEditingController();
  final _startCtrl = TextEditingController();
  final _endCtrl = TextEditingController();

  bool _loading = true;
  bool _saving = false;
  bool _locating = false;
  String? _error;

  List<dynamic> _offices = const [];
  String? _selectedOfficeId;
  double _lat = -6.8694;
  double _lng = 109.1402;
  int _radiusMeters = 250;
  LatLng? _currentGpsPoint;

  @override
  void initState() {
    super.initState();
    if (widget.profile.roleCode == 'owner') {
      _loadOffices();
    } else {
      _loading = false;
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    _nameCtrl.dispose();
    _radiusCtrl.dispose();
    _startCtrl.dispose();
    _endCtrl.dispose();
    super.dispose();
  }

  void _applyOfficeSelection(Map<String, dynamic> office) {
    final radius = (office['radius_meters'] as num?)?.toInt() ?? 250;
    setState(() {
      _selectedOfficeId = office['id'].toString();
      _lat = (office['latitude'] as num).toDouble();
      _lng = (office['longitude'] as num).toDouble();
      _radiusMeters = radius.clamp(20, 5000);
    });
    _nameCtrl.text = (office['name'] ?? '').toString();
    _radiusCtrl.text = '$_radiusMeters';
    _startCtrl.text = (office['work_start_time'] ?? '09:00').toString();
    _endCtrl.text = (office['work_end_time'] ?? '17:00').toString();
  }

  Future<void> _loadOffices() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).fetchAttendanceData();
      final offices = (res['offices'] as List<dynamic>?) ?? const [];
      if (!mounted) return;
      _offices = offices;
      if (offices.isNotEmpty) {
        final selected = offices.cast<Map<String, dynamic>>().firstWhere(
              (o) => o['id'].toString() == _selectedOfficeId,
              orElse: () => offices.first as Map<String, dynamic>,
            );
        _applyOfficeSelection(selected);
      }
      setState(() => _loading = false);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _snapToMyGps() async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      final snap = await ref
          .read(attendanceTelemetryServiceProvider)
          .collectAll(requestPermission: true);
      if (!mounted) return;
      if (!snap.hasGps) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('GPS tidak terbaca. Aktifkan izin lokasi akurat lalu coba lagi.'),
          ),
        );
        return;
      }
      if (snap.isMockedGps == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Fake GPS terdeteksi; koordinat ditolak.')),
        );
        return;
      }
      final point = LatLng(snap.latitude!, snap.longitude!);
      setState(() {
        _currentGpsPoint = point;
        _lat = snap.latitude!;
        _lng = snap.longitude!;
      });
      if (widget.enableTileLayer) {
        _mapController.move(point, 17.0);
      }
      final accText = snap.gpsAccuracyMeters != null
          ? ' (±${snap.gpsAccuracyMeters!.round()} m)'
          : '';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Pin diarahkan ke lokasi GPS perangkat$accText.')),
      );
    } finally {
      if (mounted) {
        setState(() => _locating = false);
      }
    }
  }

  Future<void> _save() async {
    final officeId = _selectedOfficeId;
    if (officeId == null || _saving) return;

    final name = _nameCtrl.text.trim();
    final radius = int.tryParse(_radiusCtrl.text.trim());
    final start = _startCtrl.text.trim();
    final end = _endCtrl.text.trim();
    final hhmm = RegExp(r'^\d{2}:\d{2}$');

    if (name.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nama kantor minimal 2 karakter.')),
      );
      return;
    }
    if (radius == null || radius < 20 || radius > 5000) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Radius geofence harus antara 20 sampai 5000 meter.')),
      );
      return;
    }
    if (!hhmm.hasMatch(start) || !hhmm.hasMatch(end)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Format jam kerja wajib HH:mm (mis. 09:00).')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      await ref.read(apiClientProvider).updateOfficeLocation(officeId, {
        'name': name,
        'latitude': double.parse(_lat.toStringAsFixed(6)),
        'longitude': double.parse(_lng.toStringAsFixed(6)),
        'radius_meters': radius,
        'work_start_time': start,
        'work_end_time': end,
      });
      notifyErpDataChanged(ref);
      await _loadOffices();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Lokasi & radius kantor berhasil diperbarui.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lokasi Kantor (Maps)'),
        actions: const [
          Padding(
            padding: EdgeInsets.only(right: 12),
            child: Center(child: AnimatedThemeToggleButton()),
          ),
        ],
      ),
      body: widget.profile.roleCode != 'owner'
          ? const Padding(
              padding: EdgeInsets.all(20),
              child: ErpEmptyCard(
                title: 'Khusus Role Owner',
                description: 'Hanya Owner yang dapat mengubah koordinat dan radius kantor.',
              ),
            )
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Padding(
                      padding: const EdgeInsets.all(20),
                      child: ErpErrorCard(message: _error!, onRetry: _loadOffices),
                    )
                  : _offices.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(20),
                          child: ErpEmptyCard(
                            title: 'Belum ada lokasi kantor',
                            description:
                                'Tambahkan lokasi kantor pertama lewat Web Command Center.',
                            actionLabel: 'Muat Ulang',
                            onAction: _loadOffices,
                          ),
                        )
                      : SafeArea(
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                            children: [
                              if (_offices.length > 1) ...[
                                ErpFilterPillBar<String>(
                                  selected: _selectedOfficeId ?? '',
                                  onSelected: (id) {
                                    final chosen = _offices
                                        .cast<Map<String, dynamic>>()
                                        .firstWhere((o) => o['id'].toString() == id);
                                    _applyOfficeSelection(chosen);
                                    if (widget.enableTileLayer) {
                                      _mapController.move(LatLng(_lat, _lng), 16.5);
                                    }
                                  },
                                  options: [
                                    for (final raw in _offices)
                                      ErpFilterPillOption(
                                        value: (raw as Map<String, dynamic>)['id'].toString(),
                                        label: (raw['name'] ?? 'Kantor').toString(),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                              ],

                              ClipRRect(
                                borderRadius: BorderRadius.circular(t.radiusXl),
                                child: SizedBox(
                                  height: 290,
                                  child: Stack(
                                    children: [
                                      FlutterMap(
                                        mapController: _mapController,
                                        options: MapOptions(
                                          initialCenter: LatLng(_lat, _lng),
                                          initialZoom: 16.5,
                                          onTap: (_, point) {
                                            setState(() {
                                              _lat = point.latitude;
                                              _lng = point.longitude;
                                            });
                                          },
                                        ),
                                        children: [
                                          if (widget.enableTileLayer)
                                            TileLayer(
                                              urlTemplate:
                                                  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                                              userAgentPackageName: 'com.ekalliptus.myekalliptus',
                                            ),
                                          CircleLayer(
                                            circles: [
                                              CircleMarker(
                                                point: LatLng(_lat, _lng),
                                                radius: _radiusMeters.toDouble(),
                                                useRadiusInMeter: true,
                                                color: t.accent.withValues(alpha: 0.16),
                                                borderColor: t.accent,
                                                borderStrokeWidth: 2,
                                              ),
                                            ],
                                          ),
                                          MarkerLayer(
                                            markers: [
                                              Marker(
                                                point: LatLng(_lat, _lng),
                                                width: 44,
                                                height: 44,
                                                alignment: Alignment.topCenter,
                                                child: Icon(
                                                  Icons.location_on_rounded,
                                                  size: 40,
                                                  color: t.accent,
                                                ),
                                              ),
                                              if (_currentGpsPoint != null)
                                                Marker(
                                                  point: _currentGpsPoint!,
                                                  width: 18,
                                                  height: 18,
                                                  child: Container(
                                                    decoration: BoxDecoration(
                                                      color: t.info,
                                                      shape: BoxShape.circle,
                                                      border: Border.all(
                                                        color: Colors.white,
                                                        width: 2.5,
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ],
                                      ),
                                      Positioned(
                                        left: 12,
                                        top: 12,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 10,
                                            vertical: 6,
                                          ),
                                          decoration: BoxDecoration(
                                            color: t.surface.withValues(alpha: 0.92),
                                            borderRadius: BorderRadius.circular(t.radiusPill),
                                            border: Border.all(color: t.border),
                                          ),
                                          child: Text(
                                            'Ketuk peta untuk geser titik kantor',
                                            style: Theme.of(context).textTheme.bodySmall,
                                          ),
                                        ),
                                      ),
                                      Positioned(
                                        right: 12,
                                        bottom: 12,
                                        child: FilledButton.icon(
                                          style: FilledButton.styleFrom(
                                            minimumSize: const Size(44, 44),
                                          ),
                                          onPressed: _locating ? null : _snapToMyGps,
                                          icon: _locating
                                              ? SizedBox(
                                                  width: 16,
                                                  height: 16,
                                                  child: CircularProgressIndicator(
                                                    strokeWidth: 2,
                                                    color: t.onAccent,
                                                  ),
                                                )
                                              : const Icon(Icons.my_location, size: 18),
                                          label: Text(_locating ? 'Mencari GPS...' : 'Gunakan GPS Saya'),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),

                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                decoration: BoxDecoration(
                                  color: t.surfaceSubtle,
                                  borderRadius: BorderRadius.circular(t.radiusMd),
                                  border: Border.all(color: t.border),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.pin_drop_outlined, size: 18, color: t.accent),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        'Koordinat: ${_lat.toStringAsFixed(6)}, ${_lng.toStringAsFixed(6)}',
                                        style: AppTheme.monoNumeric(
                                          color: t.textPrimary,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 14),

                              TextField(
                                controller: _nameCtrl,
                                decoration: const InputDecoration(labelText: 'Nama Kantor'),
                              ),
                              const SizedBox(height: 14),

                              Text(
                                'Radius Geofence ($_radiusMeters meter)',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              Row(
                                children: [
                                  Expanded(
                                    child: Slider(
                                      min: 20,
                                      max: 2000,
                                      divisions: 99,
                                      value: _radiusMeters.clamp(20, 2000).toDouble(),
                                      onChanged: (val) {
                                        final rounded = val.round();
                                        setState(() => _radiusMeters = rounded);
                                        _radiusCtrl.text = '$rounded';
                                      },
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  SizedBox(
                                    width: 96,
                                    child: TextField(
                                      controller: _radiusCtrl,
                                      keyboardType: TextInputType.number,
                                      decoration: const InputDecoration(labelText: 'Meter'),
                                      onChanged: (v) {
                                        final parsed = int.tryParse(v.trim());
                                        if (parsed != null && parsed >= 20 && parsed <= 5000) {
                                          setState(() => _radiusMeters = parsed);
                                        }
                                      },
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),

                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _startCtrl,
                                      decoration: const InputDecoration(labelText: 'Jam Masuk (HH:mm)'),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: TextField(
                                      controller: _endCtrl,
                                      decoration: const InputDecoration(labelText: 'Jam Pulang (HH:mm)'),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 18),

                              FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  minimumSize: const Size(double.infinity, 52),
                                ),
                                onPressed: _saving ? null : _save,
                                icon: const Icon(Icons.save_outlined, size: 20),
                                label: Text(_saving ? 'Menyimpan...' : 'Simpan Posisi Kantor'),
                              ),
                            ],
                          ),
                        ),
    );
  }
}
