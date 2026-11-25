import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';
import 'printer_job_detail_sheet.dart';
import 'printer_providers.dart';

class PrinterScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const PrinterScreen({super.key, required this.profile});

  @override
  ConsumerState<PrinterScreen> createState() => _PrinterScreenState();
}

class _PrinterScreenState extends ConsumerState<PrinterScreen> {
  final ImagePicker _picker = ImagePicker();
  bool _uploading = false;

  ErpBadgeTone _statusTone(String status) {
    switch (status) {
      case 'printed':
        return ErpBadgeTone.success;
      case 'pending_approval':
        return ErpBadgeTone.warning;
      case 'queued':
      case 'approved':
        return ErpBadgeTone.info;
      case 'printing':
        return ErpBadgeTone.accent;
      case 'rejected':
      case 'failed':
        return ErpBadgeTone.danger;
      default:
        return ErpBadgeTone.neutral;
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'pending_approval':
        return 'Menunggu';
      case 'queued':
        return 'Antre';
      case 'printing':
        return 'Mencetak';
      case 'printed':
        return 'Selesai';
      case 'rejected':
        return 'Ditolak';
      case 'failed':
        return 'Gagal';
      default:
        return status;
    }
  }

  Future<void> _pickAndUploadPhoto() async {
    try {
      final XFile? picked = await _picker.pickImage(source: ImageSource.gallery);
      if (picked == null) return;
      final Uint8List bytes = await picked.readAsBytes();
      if (bytes.length > 26_214_400) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Ukuran gambar maksimal 25 MB.')),
          );
        }
        return;
      }

      setState(() => _uploading = true);
      final name = picked.name.isNotEmpty ? picked.name : 'foto-cetak.jpg';
      final ext = name.toLowerCase();
      final mime = ext.endsWith('.png')
          ? 'image/png'
          : ext.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';

      await ref.read(printerRepositoryProvider).createManualImageJob(
            filename: name,
            contentType: mime,
            bytes: bytes,
            customerName: widget.profile.fullName,
            autoApprove: widget.profile.hasPermission('printer', 'approve'),
          );
      _refreshAll();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Gambar diunggah ke antrean Smart Printer.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString())));
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  void _refreshAll() {
    ref.invalidate(printerDashboardProvider);
    ref.invalidate(pendingPrintApprovalCountProvider);
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final canViewFinance = widget.profile.hasPermission('finance', 'view');
    final canCreate = widget.profile.hasPermission('printer', 'create');
    final asyncBundle = ref.watch(printerDashboardProvider(canViewFinance));
    final currentStatus = ref.watch(printerStatusFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Smart Printer'),
        actions: [
          IconButton(
            tooltip: 'Segarkan',
            onPressed: _refreshAll,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: _uploading ? null : _pickAndUploadPhoto,
              icon: _uploading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_photo_alternate_outlined),
              label: Text(_uploading ? 'Mengunggah...' : 'Cetak Foto'),
            )
          : null,
      body: asyncBundle.when(
        loading: () => ShimmerScope(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: const [
              SkeletonBox(height: 120),
              SizedBox(height: 12),
              SkeletonBox(height: 44),
              SizedBox(height: 12),
              SkeletonBox(height: 82),
              SizedBox(height: 10),
              SkeletonBox(height: 82),
            ],
          ),
        ),
        error: (err, _) => Padding(
          padding: const EdgeInsets.all(16),
          child: ErpErrorCard(
            message: err.toString(),
            onRetry: _refreshAll,
          ),
        ),
        data: (bundle) {
          final primaryDevice = bundle.devices.isNotEmpty
              ? (bundle.devices.where((d) => d.isOnline).isNotEmpty
                  ? bundle.devices.firstWhere((d) => d.isOnline)
                  : bundle.devices.first)
              : null;

          return RefreshIndicator(
            onRefresh: () async {
              _refreshAll();
              await ref.read(printerDashboardProvider(canViewFinance).future);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.print_outlined, color: t.accent),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                primaryDevice?.deviceName ?? 'Belum ada Bridge terdaftar',
                                style: Theme.of(context).textTheme.titleMedium,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            ErpBadge(
                              label: (primaryDevice?.isOnline ?? false) ? 'Online' : 'Offline',
                              tone: (primaryDevice?.isOnline ?? false)
                                  ? ErpBadgeTone.success
                                  : ErpBadgeTone.danger,
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          primaryDevice != null
                              ? 'OpenWA: ${primaryDevice.openwaStatus} | Printer: ${primaryDevice.printerState}'
                              : 'Daftarkan perangkat bridge di MyEkalliptus Web -> Smart Printer.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        if (primaryDevice != null && primaryDevice.inkLevels.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: primaryDevice.inkLevels
                                .map(
                                  (ink) => Chip(
                                    visualDensity: VisualDensity.compact,
                                    label: Text(
                                      '${ink.name}: ${ink.level != null ? '${ink.level}%' : 'n/a'}',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                  ),
                                )
                                .toList(),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _MiniKpiCard(
                        label: 'Menunggu',
                        value: '${bundle.summary.pendingApproval}',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _MiniKpiCard(
                        label: 'Antre/Cetak',
                        value: '${bundle.summary.queued + bundle.summary.printing}',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _MiniKpiCard(
                        label: 'Omzet Hari Ini',
                        value: formatRupiah(bundle.summary.revenueToday.toString()),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ErpFilterPillBar<String>(
                  selected: currentStatus,
                  options: const [
                    ErpFilterPillOption(value: 'all', label: 'Semua'),
                    ErpFilterPillOption(value: 'pending_approval', label: 'Menunggu'),
                    ErpFilterPillOption(value: 'in_progress', label: 'Antre/Cetak'),
                    ErpFilterPillOption(value: 'printed', label: 'Selesai'),
                    ErpFilterPillOption(value: 'failed', label: 'Gagal'),
                  ],
                  onSelected: (v) {
                    ref.read(printerStatusFilterProvider.notifier).state = v;
                  },
                ),
                const SizedBox(height: 12),
                if (bundle.jobs.isEmpty)
                  const ErpEmptyCard(
                    title: 'Antrean cetak kosong',
                    description: 'Dokumen dari WhatsApp pribadi atau upload foto manual akan tampil di sini.',
                  )
                else
                  for (final job in bundle.jobs)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: job.fileMime.startsWith('image/')
                            ? Icons.image_outlined
                            : Icons.picture_as_pdf_outlined,
                        title: '${job.jobCode} - ${job.fileName}',
                        subtitle:
                            '${job.customerName ?? job.customerPhone ?? 'Pelanggan'} | ${job.pagesToPrint} hal x ${job.copies} (${job.paperSize.toUpperCase()}) | ${formatRupiah(job.totalPrice.toString())}',
                        trailing: ErpBadge(
                          label: _statusLabel(job.status),
                          tone: _statusTone(job.status),
                        ),
                        onTap: () {
                          showModalBottomSheet<void>(
                            context: context,
                            useRootNavigator: true,
                            isScrollControlled: true,
                            useSafeArea: true,
                            backgroundColor: Colors.transparent,
                            builder: (_) => PrinterJobDetailSheet(
                              jobId: job.id,
                              profile: widget.profile,
                              pricingRules: bundle.pricingRules,
                              devices: bundle.devices,
                              financeAccounts: bundle.financeAccounts,
                              onChanged: _refreshAll,
                            ),
                          );
                        },
                      ),
                    ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MiniKpiCard extends StatelessWidget {
  final String label;
  final String value;

  const _MiniKpiCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodySmall, maxLines: 1),
            const SizedBox(height: 4),
            Text(
              value,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
