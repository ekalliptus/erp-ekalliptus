import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../../core/providers/app_providers.dart';
import '../../core/rbac/rbac_state.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/utils/formatters.dart';
import '../common/erp_widgets.dart';
import '../common/shimmer_skeleton.dart';

class RbacAuditScreen extends ConsumerStatefulWidget {
  final ErpProfile profile;

  const RbacAuditScreen({super.key, required this.profile});

  @override
  ConsumerState<RbacAuditScreen> createState() => _RbacAuditScreenState();
}

class _RbacAuditScreenState extends ConsumerState<RbacAuditScreen> {
  static const int _batchSize = 15;

  final _searchCtrl = TextEditingController();
  bool _loading = true;
  bool _loadingMore = false;
  int _visibleLogs = _batchSize;
  int _observedVersion = 0;
  Timer? _moreTimer;
  String? _error;
  String _search = '';
  String _statusFilter = 'all';
  int _segment = 0;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _observedVersion = ref.read(erpDataVersionProvider);
    if (!widget.profile.hasPermission('rbac', 'view') &&
        widget.profile.hasPermission('audit', 'view')) {
      _segment = 2;
    }
    _load();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).fetchRbacAuditData(
            includeRbac: widget.profile.hasPermission('rbac', 'view'),
            includeAudit: widget.profile.hasPermission('audit', 'view'),
          );
      if (mounted) {
        setState(() {
          _data = res;
          _visibleLogs = _batchSize;
          _loading = false;
        });
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _loading = false;
        });
      }
    }
  }

  void _scheduleLoadMore(int totalLength) {
    if (_loadingMore || _visibleLogs >= totalLength) return;
    _loadingMore = true;
    _moreTimer?.cancel();
    _moreTimer = Timer(const Duration(milliseconds: 220), () {
      if (!mounted) return;
      setState(() {
        _visibleLogs = (_visibleLogs + _batchSize).clamp(0, totalLength);
        _loadingMore = false;
      });
    });
  }

  Future<void> _showClaimCodeDialog({
    required String name,
    required String email,
    required String code,
    String? customNote,
  }) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) {
        final t = EucalyptusTokens.of(ctx);
        return AlertDialog(
          title: Text('Kode Aktivasi $name'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                customNote ??
                    'Berikan kode satu kali ini kepada $email untuk menautkan akun saat Aktivasi.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: t.accentSoft,
                  borderRadius: BorderRadius.circular(t.radiusMd),
                  border: Border.all(color: t.accent.withValues(alpha: 0.35)),
                ),
                child: SelectableText(
                  code,
                  textAlign: TextAlign.center,
                  style: AppTheme.monoNumeric(
                    color: t.accentHover,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Tutup'),
            ),
            FilledButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: code));
                Navigator.of(ctx).pop();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Kode aktivasi disalin ke clipboard.')),
                );
              },
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('Salin Kode'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _generateClaimCode(Map<String, dynamic> emp) async {
    final name = (emp['full_name'] ?? 'Karyawan').toString();
    final confirm = await showErpConfirmDialog(
      context,
      title: 'Buat Kode Aktivasi Baru?',
      message:
          'Kode aktivasi satu kali akan dibuat untuk $name (${emp['email']}). Kode lama yang belum dipakai tidak akan berlaku lagi.',
      confirmLabel: 'Buat Kode',
    );
    if (!confirm || !mounted) return;

    try {
      final res = await ref
          .read(apiClientProvider)
          .generateEmployeeClaimCode(emp['id'].toString());
      if (!mounted) return;
      final code = (res['code'] ?? '').toString();
      final email = (res['email'] ?? emp['email'] ?? '').toString();
      await _load();
      if (!mounted) return;
      await _showClaimCodeDialog(name: name, email: email, code: code);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _unlinkEmployeeAuth(Map<String, dynamic> emp) async {
    final name = (emp['full_name'] ?? 'Karyawan').toString();
    final email = (emp['email'] ?? '-').toString();
    final confirm = await showErpConfirmDialog(
      context,
      title: 'Putus Tautan Akun Login?',
      message:
          'Akses login milik $name ($email) dan perangkat notifikasinya akan dicabut. Kode aktivasi baru akan langsung diterbitkan untuk tautan ulang.',
      confirmLabel: 'Putus Tautan',
      destructive: true,
    );
    if (!confirm || !mounted) return;

    try {
      final res = await ref
          .read(apiClientProvider)
          .unlinkEmployeeAuth(emp['id'].toString(), issueClaimCode: true);
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (!mounted) return;
      final newCode = (res['claim_code'] ?? '').toString();
      if (newCode.isNotEmpty) {
        await _showClaimCodeDialog(
          name: name,
          email: email,
          code: newCode,
          customNote:
              'Tautan login lama telah diputus. Gunakan kode aktivasi baru ini untuk menautkan akun login untuk $email.',
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Tautan login $name berhasil diputus.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _resetEmployeeFace(Map<String, dynamic> emp) async {
    final name = (emp['full_name'] ?? 'Karyawan').toString();
    final confirm = await showErpConfirmDialog(
      context,
      title: 'Reset Data Wajah Karyawan?',
      message:
          'Data biometrik wajah $name akan dihapus dari akun ini. Pada absensi berikutnya (web atau Android), karyawan akan otomatis mendaftarkan wajah baru.',
      confirmLabel: 'Reset Wajah',
      destructive: true,
    );
    if (!confirm || !mounted) return;

    try {
      await ref.read(apiClientProvider).resetEmployeeFace(emp['id'].toString());
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Data wajah $name berhasil direset.')),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _toggleEmployeeActive(
    Map<String, dynamic> emp, {
    bool skipConfirm = false,
  }) async {
    final name = (emp['full_name'] ?? 'Karyawan').toString();
    final currentlyActive = emp['is_active'] != false;
    final nextActive = !currentlyActive;

    if (!skipConfirm) {
      final confirm = await showErpConfirmDialog(
        context,
        title: nextActive ? 'Aktifkan Akun Karyawan?' : 'Nonaktifkan Akun Karyawan?',
        message: nextActive
            ? '$name akan dapat mengakses kembali modul ERP sesuai rolenya.'
            : '$name tidak dapat login atau memakai fitur ERP selama akun berstatus nonaktif, namun riwayat transaksinya tetap tersimpan.',
        confirmLabel: nextActive ? 'Aktifkan' : 'Nonaktifkan',
        destructive: !nextActive,
      );
      if (!confirm || !mounted) return;
    }

    try {
      await ref
          .read(apiClientProvider)
          .updateEmployee(emp['id'].toString(), {'is_active': nextActive});
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              nextActive
                  ? 'Akun $name kembali diaktifkan.'
                  : 'Akun $name telah dinonaktifkan.',
            ),
          ),
        );
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _deleteEmployee(Map<String, dynamic> emp) async {
    final name = (emp['full_name'] ?? 'Karyawan').toString();
    final confirm = await showErpConfirmDialog(
      context,
      title: 'Hapus Karyawan Permanen?',
      message:
          'Data $name (${emp['employee_code']}) akan dihapus permanen dari direktori jika belum memiliki riwayat operasional.',
      confirmLabel: 'Hapus Permanen',
      destructive: true,
    );
    if (!confirm || !mounted) return;

    try {
      await ref.read(apiClientProvider).deleteEmployee(emp['id'].toString());
      if (!mounted) return;
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Karyawan $name berhasil dihapus.')),
        );
      }
    } on ApiException catch (err) {
      if (!mounted) return;
      final canDeactivate = err.statusCode == 409 && err.details?['can_deactivate'] == true;
      if (canDeactivate && emp['is_active'] != false) {
        final refs = err.details?['references'];
        final refText = refs is Map && refs.isNotEmpty
            ? '\n\nTercatat pada: ${refs.entries.map((e) => '${e.key} (${e.value})').join(', ')}'
            : '';
        final deactivate = await showErpConfirmDialog(
          context,
          title: 'Tidak Dapat Dihapus Permanen',
          message: '${err.message}$refText',
          confirmLabel: 'Nonaktifkan Saja',
          destructive: true,
        );
        if (deactivate && mounted) {
          await _toggleEmployeeActive(emp, skipConfirm: true);
        }
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err.message)),
      );
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err.toString())),
        );
      }
    }
  }

  Future<void> _openEmployeeFormSheet({
    required List<dynamic> roles,
    required List<dynamic> existingEmployees,
    Map<String, dynamic>? existing,
  }) async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _EmployeeFormSheet(
        isOwner: widget.profile.roleCode == 'owner',
        selfEmployeeId: widget.profile.employeeId,
        roles: roles,
        existingEmployees: existingEmployees,
        existing: existing,
      ),
    );
    if (result == null || !mounted) return;

    notifyErpDataChanged(ref);
    await _load();
    if (!mounted) return;

    final createdCode = (result['claim_code'] ?? '').toString();
    final empObj = result['employee'] as Map<String, dynamic>?;
    if (existing == null && createdCode.isNotEmpty && empObj != null) {
      await _showClaimCodeDialog(
        name: (empObj['full_name'] ?? 'Karyawan').toString(),
        email: (empObj['email'] ?? '').toString(),
        code: createdCode,
        customNote:
            'Karyawan berhasil ditambahkan. Berikan kode satu kali ini kepada ${empObj['email']} untuk mengaktifkan akunnya.',
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            existing == null
                ? 'Karyawan baru berhasil ditambahkan.'
                : 'Data karyawan berhasil diperbarui.',
          ),
        ),
      );
    }
  }

  Future<void> _openEmployeeDetailSheet(
    Map<String, dynamic> emp,
    List<dynamic> roles,
    List<dynamic> existingEmployees,
  ) async {
    final isOwner = widget.profile.roleCode == 'owner';
    final canManageRbac = widget.profile.hasPermission('rbac', 'update');
    final canDeleteRbac = widget.profile.hasPermission('rbac', 'delete');
    final targetRoleCode = (emp['role_code'] ?? 'staff').toString();
    final isSelf = emp['id'].toString() == widget.profile.employeeId;
    final linked = emp['auth_user_id'] != null;
    final isActive = emp['is_active'] != false;
    final hasClaimCode = emp['has_claim_code'] == true;
    final faceEnrolled = emp['face_enrolled'] == true;
    final canEditThisTarget = canManageRbac && (isOwner || targetRoleCode != 'owner');
    final username = (emp['username'] ?? '').toString().trim();
    final phone = (emp['phone'] ?? '').toString().trim();

    final action = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        final t = EucalyptusTokens.of(ctx);
        return ErpBottomSheetFrame(
          title: (emp['full_name'] ?? 'Karyawan').toString(),
          subtitle: '${emp['employee_code']} · ${emp['role_name']}',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ErpBadge(
                    label: isActive ? 'Akun Aktif' : 'Akun Nonaktif',
                    tone: isActive ? ErpBadgeTone.success : ErpBadgeTone.danger,
                  ),
                  ErpBadge(
                    label: linked ? 'Login Tertaut' : 'Menunggu Aktivasi',
                    tone: linked ? ErpBadgeTone.success : ErpBadgeTone.warning,
                  ),
                  if (!linked && hasClaimCode)
                    const ErpBadge(
                      label: 'Kode Siap Pakai',
                      tone: ErpBadgeTone.info,
                    ),
                  if (faceEnrolled)
                    const ErpBadge(
                      label: 'Wajah Terdaftar',
                      tone: ErpBadgeTone.info,
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Card(
                child: Column(
                  children: [
                    _DetailInfoRow(label: 'Email Kerja', value: (emp['email'] ?? '-').toString()),
                    Divider(height: 1, color: t.border),
                    _DetailInfoRow(
                      label: 'Username Login',
                      value: username.isNotEmpty ? '@$username' : 'Belum diatur',
                    ),
                    Divider(height: 1, color: t.border),
                    _DetailInfoRow(
                      label: 'Nomor Telepon',
                      value: phone.isNotEmpty ? phone : 'Belum diisi',
                    ),
                    Divider(height: 1, color: t.border),
                    _DetailInfoRow(
                      label: 'Gaji Pokok',
                      value: formatRupiah(emp['base_salary']),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              if (canEditThisTarget) ...[
                ErpListRowCard(
                  leadingIcon: Icons.edit_outlined,
                  title: 'Edit Data & Role Karyawan',
                  subtitle: 'Ubah nama, kode, email, username, telepon, role & gaji',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('edit'),
                ),
                const SizedBox(height: 8),
              ],
              if (canEditThisTarget && !linked) ...[
                ErpListRowCard(
                  leadingIcon: Icons.key_outlined,
                  leadingColor: t.info,
                  leadingBackground: t.infoSoft,
                  title: hasClaimCode ? 'Buat Ulang Kode Aktivasi' : 'Buat Kode Aktivasi',
                  subtitle: 'Terbitkan kode satu kali agar karyawan bisa daftar & masuk',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('claim'),
                ),
                const SizedBox(height: 8),
              ],
              if (isOwner && linked && !isSelf) ...[
                ErpListRowCard(
                  leadingIcon: Icons.link_off_outlined,
                  leadingColor: t.warning,
                  leadingBackground: t.warningSoft,
                  title: 'Putus Tautan Akun & Buat Kode Baru',
                  subtitle: 'Cabut akses Neon Auth lama dan terbitkan kode aktivasi baru',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('unlink'),
                ),
                const SizedBox(height: 8),
              ],
              if (canEditThisTarget && !isSelf) ...[
                ErpListRowCard(
                  leadingIcon: isActive
                      ? Icons.person_off_outlined
                      : Icons.person_outline_rounded,
                  leadingColor: isActive ? t.warning : t.success,
                  leadingBackground: isActive ? t.warningSoft : t.successSoft,
                  title: isActive ? 'Nonaktifkan Akun' : 'Aktifkan Kembali Akun',
                  subtitle: isActive
                      ? 'Bekukan akses ERP karyawan tanpa menghapus riwayat data'
                      : 'Izinkan karyawan ini masuk dan memakai sistem kembali',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('toggle_active'),
                ),
                const SizedBox(height: 8),
              ],
              if ((isOwner || widget.profile.roleCode == 'hr') &&
                  (isOwner || targetRoleCode != 'owner') &&
                  faceEnrolled) ...[
                ErpListRowCard(
                  leadingIcon: Icons.face_retouching_off_outlined,
                  leadingColor: t.warning,
                  leadingBackground: t.warningSoft,
                  title: 'Reset Data Wajah',
                  subtitle: 'Hapus biometrik wajah agar karyawan bisa daftar ulang',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('reset_face'),
                ),
                const SizedBox(height: 8),
              ],
              if (isOwner && canDeleteRbac && !isSelf)
                ErpListRowCard(
                  leadingIcon: Icons.delete_outline_rounded,
                  leadingColor: t.danger,
                  leadingBackground: t.dangerSoft,
                  title: 'Hapus Karyawan Permanen',
                  subtitle: 'Hapus dari direktori (otomatis tawarkan nonaktif jika ada riwayat)',
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(ctx).pop('delete'),
                ),
            ],
          ),
        );
      },
    );

    if (action == null || !mounted) return;
    switch (action) {
      case 'edit':
        await _openEmployeeFormSheet(
          roles: roles,
          existingEmployees: existingEmployees,
          existing: emp,
        );
      case 'claim':
        await _generateClaimCode(emp);
      case 'unlink':
        await _unlinkEmployeeAuth(emp);
      case 'reset_face':
        await _resetEmployeeFace(emp);
      case 'toggle_active':
        await _toggleEmployeeActive(emp);
      case 'delete':
        await _deleteEmployee(emp);
    }
  }

  Future<void> _openRolePermissionsSheet(
    Map<String, dynamic> role,
    List<dynamic> allPermissions,
  ) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _RolePermissionsSheet(
        role: role,
        allPermissions: allPermissions,
      ),
    );
    if (saved == true && mounted) {
      notifyErpDataChanged(ref);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Matriks izin role ${role['name']} disimpan.')),
        );
      }
    }
  }

  void _showAuditDiff(Map<String, dynamic> log) {
    final t = EucalyptusTokens.of(context);
    const encoder = JsonEncoder.withIndent('  ');
    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return ErpBottomSheetFrame(
          title: '${log['module'].toString().toUpperCase()} · ${log['action']}',
          subtitle:
              'Actor: ${log['actor_email'] ?? 'system'} · Platform: ${formatPlatformLabel(log['platform']?.toString())}',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Before Data', style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: t.surfaceSubtle,
                  borderRadius: BorderRadius.circular(t.radiusMd),
                ),
                child: SelectableText(
                  encoder.convert(log['before_data']),
                  style: const TextStyle(fontFamily: AppTheme.fontMono, fontSize: 12),
                ),
              ),
              const SizedBox(height: 14),
              Text('After Data', style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: t.surfaceSubtle,
                  borderRadius: BorderRadius.circular(t.radiusMd),
                ),
                child: SelectableText(
                  encoder.convert(log['after_data']),
                  style: const TextStyle(fontFamily: AppTheme.fontMono, fontSize: 12),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(erpDataVersionProvider, (prev, next) {
      if (next != _observedVersion && mounted) {
        _observedVersion = next;
        _load();
      }
    });

    final t = EucalyptusTokens.of(context);
    final isOwner = widget.profile.roleCode == 'owner';
    final canViewRbac = widget.profile.hasPermission('rbac', 'view');
    final canCreateRbac = widget.profile.hasPermission('rbac', 'create');
    final canManageRbac = widget.profile.hasPermission('rbac', 'update');
    final canDeleteRbac = widget.profile.hasPermission('rbac', 'delete');
    final canViewAudit = widget.profile.hasPermission('audit', 'view');

    if (!canViewRbac && !canViewAudit) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses RBAC & Audit Ditolak',
          description: 'Role Anda belum memiliki izin rbac:view atau audit:view.',
        ),
      );
    }
    if (_loading) return const RbacAuditSkeleton();
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(20),
        child: ErpErrorCard(message: _error!, onRetry: _load),
      );
    }

    final employees = (_data?['employees'] as List<dynamic>?) ?? const [];
    final roles = (_data?['roles'] as List<dynamic>?) ?? const [];
    final allPermissions = (_data?['permissions'] as List<dynamic>?) ?? const [];
    final logs = (_data?['audit_logs'] as List<dynamic>?) ?? const [];

    final activeCount = employees.where((raw) {
      final e = raw as Map<String, dynamic>;
      return e['is_active'] != false;
    }).length;
    final pendingCount = employees.where((raw) {
      final e = raw as Map<String, dynamic>;
      return e['is_active'] != false && e['auth_user_id'] == null;
    }).length;
    final inactiveCount = employees.where((raw) {
      final e = raw as Map<String, dynamic>;
      return e['is_active'] == false;
    }).length;

    final q = _search.trim().toLowerCase();
    final filteredEmployees = employees.where((raw) {
      final e = raw as Map<String, dynamic>;
      final isActive = e['is_active'] != false;
      final isLinked = e['auth_user_id'] != null;
      if (_statusFilter == 'active' && !isActive) return false;
      if (_statusFilter == 'pending' && (!isActive || isLinked)) return false;
      if (_statusFilter == 'inactive' && isActive) return false;
      if (q.isEmpty) return true;
      return (e['full_name'] ?? '').toString().toLowerCase().contains(q) ||
          (e['employee_code'] ?? '').toString().toLowerCase().contains(q) ||
          (e['email'] ?? '').toString().toLowerCase().contains(q) ||
          (e['username'] ?? '').toString().toLowerCase().contains(q) ||
          (e['role_name'] ?? '').toString().toLowerCase().contains(q);
    }).toList(growable: false);

    final filteredLogs = logs.where((raw) {
      if (q.isEmpty) return true;
      final l = raw as Map<String, dynamic>;
      return (l['module'] ?? '').toString().toLowerCase().contains(q) ||
          (l['action'] ?? '').toString().toLowerCase().contains(q) ||
          (l['actor_email'] ?? '').toString().toLowerCase().contains(q) ||
          (l['platform'] ?? '').toString().toLowerCase().contains(q) ||
          formatPlatformLabel(l['platform']?.toString()).toLowerCase().contains(q);
    }).toList(growable: false);

    final shownLogs =
        filteredLogs.length < _visibleLogs ? filteredLogs.length : _visibleLogs;
    final hasMoreLogs = _segment == 2 && shownLogs < filteredLogs.length;

    final options = <ErpFilterPillOption<int>>[
      if (canViewRbac) ...[
        ErpFilterPillOption(value: 0, label: 'Karyawan (${employees.length})'),
        ErpFilterPillOption(value: 1, label: 'Role (${roles.length})'),
      ],
      if (canViewAudit) ErpFilterPillOption(value: 2, label: 'Audit Trail (${logs.length})'),
    ];

    final hasEmployeeFilters = _search.trim().isNotEmpty || _statusFilter != 'all';

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMoreLogs &&
            notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(filteredLogs.length);
        }
        return false;
      },
      child: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ErpFilterPillBar<int>(
                      selected: _segment,
                      onSelected: (v) => setState(() {
                        _segment = v;
                        _visibleLogs = _batchSize;
                      }),
                      options: options,
                    ),
                    const SizedBox(height: 12),
                    if (_segment == 0) ...[
                      Row(
                        children: [
                          Expanded(
                            child: _StatChipCard(
                              label: 'Aktif',
                              value: '$activeCount',
                              toneColor: t.success,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _StatChipCard(
                              label: 'Pending',
                              value: '$pendingCount',
                              toneColor: t.warning,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: _StatChipCard(
                              label: 'Nonaktif',
                              value: '$inactiveCount',
                              toneColor: t.danger,
                            ),
                          ),
                        ],
                      ),
                      if (canCreateRbac) ...[
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(double.infinity, 48),
                          ),
                          onPressed: () => _openEmployeeFormSheet(
                            roles: roles,
                            existingEmployees: employees,
                          ),
                          icon: const Icon(Icons.person_add_alt_1_outlined, size: 20),
                          label: const Text('Tambah Karyawan Baru'),
                        ),
                      ],
                      const SizedBox(height: 12),
                    ],
                    if (_segment != 1) ...[
                      TextField(
                        controller: _searchCtrl,
                        decoration: InputDecoration(
                          hintText: _segment == 0
                              ? 'Cari nama, kode, email, @username, atau role'
                              : 'Cari modul, aksi, atau aktor',
                          prefixIcon: const Icon(Icons.search),
                          suffixIcon: _search.isNotEmpty
                              ? IconButton(
                                  tooltip: 'Hapus filter',
                                  onPressed: () {
                                    _searchCtrl.clear();
                                    setState(() {
                                      _search = '';
                                      _visibleLogs = _batchSize;
                                    });
                                  },
                                  icon: const Icon(Icons.close, size: 18),
                                )
                              : null,
                        ),
                        onChanged: (v) => setState(() {
                          _search = v;
                          _visibleLogs = _batchSize;
                        }),
                      ),
                      const SizedBox(height: 10),
                    ],
                    if (_segment == 0) ...[
                      ErpFilterPillBar<String>(
                        selected: _statusFilter,
                        onSelected: (v) => setState(() => _statusFilter = v),
                        options: const [
                          ErpFilterPillOption(value: 'all', label: 'Semua'),
                          ErpFilterPillOption(value: 'active', label: 'Aktif'),
                          ErpFilterPillOption(value: 'pending', label: 'Pending'),
                          ErpFilterPillOption(value: 'inactive', label: 'Nonaktif'),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
              ),
            ),
            if (_segment == 0) ...[
              if (filteredEmployees.isEmpty)
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                  sliver: SliverToBoxAdapter(
                    child: ErpEmptyCard(
                      title: hasEmployeeFilters
                          ? 'Karyawan tidak cocok dengan filter'
                          : 'Belum ada data karyawan',
                      description: hasEmployeeFilters
                          ? 'Ubah kata kunci pencarian atau tampilkan semua status karyawan.'
                          : 'Tambahkan karyawan pertama untuk mulai mengatur role dan kode aktivasi.',
                      actionLabel: hasEmployeeFilters
                          ? 'Reset Filter'
                          : (canCreateRbac ? 'Tambah Karyawan' : null),
                      onAction: hasEmployeeFilters
                          ? () {
                              _searchCtrl.clear();
                              setState(() {
                                _search = '';
                                _statusFilter = 'all';
                              });
                            }
                          : (canCreateRbac
                              ? () => _openEmployeeFormSheet(
                                    roles: roles,
                                    existingEmployees: employees,
                                  )
                              : null),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                  sliver: SliverList.builder(
                    itemCount: filteredEmployees.length,
                    itemBuilder: (ctx, i) {
                      final emp = filteredEmployees[i] as Map<String, dynamic>;
                      final isActive = emp['is_active'] != false;
                      final linked = emp['auth_user_id'] != null;
                      final username = (emp['username'] ?? '').toString().trim();
                      final subtitleParts = [
                        if (username.isNotEmpty) '@$username',
                        (emp['email'] ?? '-').toString(),
                        (emp['role_name'] ?? '-').toString(),
                        formatRupiah(emp['base_salary']),
                      ];

                      final IconData leadingIcon;
                      final Color leadingColor;
                      final Color leadingBg;
                      final String badgeLabel;
                      final ErpBadgeTone badgeTone;

                      if (!isActive) {
                        leadingIcon = Icons.person_off_outlined;
                        leadingColor = t.danger;
                        leadingBg = t.dangerSoft;
                        badgeLabel = 'Nonaktif';
                        badgeTone = ErpBadgeTone.danger;
                      } else if (linked) {
                        leadingIcon = Icons.verified_user_outlined;
                        leadingColor = t.success;
                        leadingBg = t.successSoft;
                        badgeLabel = 'Tertaut';
                        badgeTone = ErpBadgeTone.success;
                      } else {
                        leadingIcon = Icons.person_add_alt_1_outlined;
                        leadingColor = t.warning;
                        leadingBg = t.warningSoft;
                        badgeLabel = 'Pending';
                        badgeTone = ErpBadgeTone.warning;
                      }

                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: ErpListRowCard(
                          leadingIcon: leadingIcon,
                          leadingColor: leadingColor,
                          leadingBackground: leadingBg,
                          title: '${emp['full_name']} (${emp['employee_code']})',
                          subtitle: subtitleParts.join(' · '),
                          trailing: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              ErpBadge(label: badgeLabel, tone: badgeTone),
                              if (canManageRbac || (isOwner && canDeleteRbac)) ...[
                                const SizedBox(height: 4),
                                Text(
                                  'Ketuk kelola',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: t.accent,
                                  ),
                                ),
                              ],
                            ],
                          ),
                          onTap: () => _openEmployeeDetailSheet(emp, roles, employees),
                        ),
                      );
                    },
                  ),
                ),
            ] else if (_segment == 1) ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverList.builder(
                  itemCount: roles.length,
                  itemBuilder: (ctx, i) {
                    final r = roles[i] as Map<String, dynamic>;
                    final permCount = ((r['permissions'] as List<dynamic>?) ?? const []).length;
                    final roleId = r['id'].toString();
                    final empCount = employees
                        .where((raw) => (raw as Map<String, dynamic>)['role_id']?.toString() == roleId)
                        .length;
                    final desc = (r['description'] ?? 'Role sistem MyEkalliptus').toString();
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: Icons.shield_outlined,
                        title: '${r['name']} (${r['code']})',
                        subtitle: '$desc · $empCount karyawan',
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ErpBadge(
                              label: '$permCount izin',
                              tone: ErpBadgeTone.accent,
                            ),
                            if (isOwner) ...[
                              const SizedBox(width: 4),
                              Icon(Icons.chevron_right, color: t.textSecondary),
                            ],
                          ],
                        ),
                        onTap: isOwner && allPermissions.isNotEmpty
                            ? () => _openRolePermissionsSheet(r, allPermissions)
                            : null,
                      ),
                    );
                  },
                ),
              ),
            ] else if (filteredLogs.isEmpty) ...[
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Log Audit Kosong',
                    description: 'Belum ada aktivitas perubahan entitas tercatat.',
                  ),
                ),
              ),
            ] else ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 108),
                sliver: SliverList.builder(
                  itemCount: shownLogs + (hasMoreLogs ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownLogs) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat catatan audit berikutnya...',
                      );
                    }
                    final log = filteredLogs[index] as Map<String, dynamic>;
                    final dt = DateTime.tryParse((log['created_at'] ?? '').toString());
                    final whenLabel = dt != null
                        ? formatRelativeTimeId(dt)
                        : formatShortDateTime(log['created_at']?.toString());
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: ErpListRowCard(
                        leadingIcon: Icons.history_rounded,
                        leadingColor: log['platform'] == 'flutter' ? t.info : t.accent,
                        leadingBackground:
                            log['platform'] == 'flutter' ? t.infoSoft : t.accentSoft,
                        title: '${log['module'].toString().toUpperCase()} · ${log['action']}',
                        subtitle: '${log['actor_email'] ?? 'system'} · $whenLabel',
                        trailing: ErpBadge(
                          label: formatPlatformLabel(log['platform']?.toString()),
                          tone: log['platform'] == 'flutter'
                              ? ErpBadgeTone.info
                              : ErpBadgeTone.accent,
                        ),
                        onTap: () => _showAuditDiff(log),
                      ),
                    );
                  },
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatChipCard extends StatelessWidget {
  final String label;
  final String value;
  final Color toneColor;

  const _StatChipCard({
    required this.label,
    required this.value,
    required this.toneColor,
  });

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: AppTheme.monoNumeric(
                color: toneColor,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 2),
            Container(
              height: 2,
              width: 24,
              decoration: BoxDecoration(
                color: toneColor.withValues(alpha: 0.45),
                borderRadius: BorderRadius.circular(t.radiusPill),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailInfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailInfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          const SizedBox(width: 10),
          Flexible(
            flex: 2,
            child: Text(
              value,
              textAlign: TextAlign.end,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: t.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmployeeFormSheet extends ConsumerStatefulWidget {
  final bool isOwner;
  final String selfEmployeeId;
  final List<dynamic> roles;
  final List<dynamic> existingEmployees;
  final Map<String, dynamic>? existing;

  const _EmployeeFormSheet({
    required this.isOwner,
    required this.selfEmployeeId,
    required this.roles,
    required this.existingEmployees,
    this.existing,
  });

  @override
  ConsumerState<_EmployeeFormSheet> createState() => _EmployeeFormSheetState();
}

class _EmployeeFormSheetState extends ConsumerState<_EmployeeFormSheet> {
  static final RegExp _usernamePattern = RegExp(r'^[a-z0-9_.]{3,24}$');
  static final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  late final TextEditingController _codeCtrl;
  late final TextEditingController _nameCtrl;
  late final TextEditingController _emailCtrl;
  late final TextEditingController _usernameCtrl;
  late final TextEditingController _phoneCtrl;
  late final TextEditingController _salaryCtrl;

  late String _roleId;
  late bool _isActive;
  bool _issueClaimCode = true;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.existing != null;
  bool get _isSelf => _isEdit && widget.existing!['id'].toString() == widget.selfEmployeeId;
  bool get _isLinked => _isEdit && widget.existing!['auth_user_id'] != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _codeCtrl = TextEditingController(
      text: e != null
          ? (e['employee_code'] ?? '').toString()
          : _suggestNextEmployeeCode(),
    );
    _nameCtrl = TextEditingController(text: (e?['full_name'] ?? '').toString());
    _emailCtrl = TextEditingController(text: (e?['email'] ?? '').toString());
    _usernameCtrl = TextEditingController(text: (e?['username'] ?? '').toString());
    _phoneCtrl = TextEditingController(text: (e?['phone'] ?? '').toString());
    _salaryCtrl = TextEditingController(
      text: (e?['base_salary'] ?? '5000000').toString(),
    );

    final assignable = _assignableRoles();
    final existingRoleId = e?['role_id']?.toString();
    final staffDefault = assignable.cast<Map<String, dynamic>?>().firstWhere(
          (r) => r?['code'] == 'staff',
          orElse: () => null,
        );
    _roleId = existingRoleId != null &&
            assignable.any((r) => (r as Map<String, dynamic>)['id'].toString() == existingRoleId)
        ? existingRoleId
        : (staffDefault?['id']?.toString() ??
            (assignable.isNotEmpty
                ? (assignable.first as Map<String, dynamic>)['id'].toString()
                : ''));
    _isActive = e?['is_active'] != false;
  }

  String _suggestNextEmployeeCode() {
    var maxNum = 0;
    for (final raw in widget.existingEmployees) {
      final code = ((raw as Map<String, dynamic>)['employee_code'] ?? '').toString().trim();
      final match = RegExp(r'^EK-(\d+)$', caseSensitive: false).firstMatch(code);
      if (match != null) {
        final numVal = int.tryParse(match.group(1) ?? '');
        if (numVal != null && numVal > maxNum) {
          maxNum = numVal;
        }
      }
    }
    return 'EK-${(maxNum + 1).toString().padLeft(3, '0')}';
  }

  List<dynamic> _assignableRoles() {
    return widget.roles.where((raw) {
      final r = raw as Map<String, dynamic>;
      if (!widget.isOwner && r['code'] == 'owner') {
        return false;
      }
      return true;
    }).toList(growable: false);
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _usernameCtrl.dispose();
    _phoneCtrl.dispose();
    _salaryCtrl.dispose();
    super.dispose();
  }

  int? _parseNonNegativeSalary(String raw) {
    final cleaned = raw.trim().replaceAll(RegExp(r'rp|\s', caseSensitive: false), '');
    if (cleaned.isEmpty) return 0;
    if (cleaned.contains('-')) return null;
    final digits = cleaned.replaceAll('.', '').replaceAll(',', '');
    if (!RegExp(r'^\d+$').hasMatch(digits)) return null;
    return int.tryParse(digits);
  }

  Future<void> _submit() async {
    final code = _codeCtrl.text.trim().toUpperCase();
    final name = _nameCtrl.text.trim();
    final email = _emailCtrl.text.trim().toLowerCase();
    final username = _usernameCtrl.text.trim().toLowerCase();
    final phone = _phoneCtrl.text.trim();
    final salary = _parseNonNegativeSalary(_salaryCtrl.text);

    if (code.length < 2) {
      setState(() => _error = 'Kode karyawan minimal 2 karakter.');
      return;
    }
    if (name.length < 2) {
      setState(() => _error = 'Nama lengkap minimal 2 karakter.');
      return;
    }
    if (!_emailPattern.hasMatch(email)) {
      setState(() => _error = 'Masukkan alamat email kerja yang valid.');
      return;
    }
    if (username.isNotEmpty && !_usernamePattern.hasMatch(username)) {
      setState(() => _error = 'Username 3-24 karakter: huruf kecil, angka, titik, atau garis bawah.');
      return;
    }
    if (_roleId.isEmpty) {
      setState(() => _error = 'Pilih role akses untuk karyawan.');
      return;
    }
    if (salary == null) {
      setState(() => _error = 'Gaji pokok harus berupa angka bulat tidak negatif.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final api = ref.read(apiClientProvider);
      if (_isEdit) {
        final existingRoleCode = widget.existing!['role_code']?.toString();
        final lockSelfOwnerRole = _isSelf && existingRoleCode == 'owner';
        final res = await api.updateEmployee(widget.existing!['id'].toString(), {
          'employee_code': code,
          'full_name': name,
          'email': email,
          'username': username.isEmpty ? null : username,
          'phone': phone.isEmpty ? null : phone,
          if (!lockSelfOwnerRole) 'role_id': _roleId,
          'base_salary': salary,
          if (!_isSelf) 'is_active': _isActive,
        });
        if (mounted) Navigator.of(context).pop(res);
      } else {
        final res = await api.createEmployee({
          'employee_code': code,
          'full_name': name,
          'email': email,
          'username': username.isEmpty ? null : username,
          'phone': phone.isEmpty ? null : phone,
          'role_id': _roleId,
          'base_salary': salary,
          'issue_claim_code': _issueClaimCode,
        });
        if (mounted) Navigator.of(context).pop(res);
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = err.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final assignable = _assignableRoles();
    final lockSelfOwnerRole =
        _isEdit && _isSelf && widget.existing!['role_code']?.toString() == 'owner';

    return ErpBottomSheetFrame(
      title: _isEdit ? 'Edit Data Karyawan' : 'Tambah Karyawan Baru',
      subtitle: _isEdit
          ? '${widget.existing!['full_name']} (${widget.existing!['employee_code']})'
          : 'Lengkapi identitas karyawan dan role aksesnya di ERP.',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: t.dangerSoft,
                borderRadius: BorderRadius.circular(t.radiusMd),
                border: Border.all(color: t.danger.withValues(alpha: 0.45)),
              ),
              child: Text(
                _error!,
                style: TextStyle(fontSize: 12.5, color: t.danger, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _codeCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Kode Karyawan',
              hintText: 'Contoh: EK-002',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Nama Lengkap',
              hintText: 'Nama lengkap sesuai data tim',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(
              labelText: 'Email Kerja',
              hintText: 'nama@ekalliptus.com',
              helperText: _isLinked
                  ? 'Mengubah email hanya memperbarui direktori ERP.'
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _usernameCtrl,
            decoration: const InputDecoration(
              labelText: 'Username Login (Opsional)',
              hintText: 'contoh: budi.santoso',
              helperText: '3-24 karakter: huruf kecil, angka, titik, garis bawah',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phoneCtrl,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Nomor Telepon (Opsional)',
              hintText: '08xxxxxxxxxx',
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _roleId.isNotEmpty ? _roleId : null,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Role Akses',
              helperText: lockSelfOwnerRole
                  ? 'Role Owner milik sendiri tidak dapat diturunkan.'
                  : null,
            ),
            items: [
              for (final raw in assignable)
                DropdownMenuItem<String>(
                  value: (raw as Map<String, dynamic>)['id'].toString(),
                  child: Text(
                    '${raw['name']} (${raw['code']})',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: lockSelfOwnerRole
                ? null
                : (v) {
                    if (v != null) setState(() => _roleId = v);
                  },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _salaryCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Gaji Pokok (IDR)',
              hintText: '5000000',
            ),
          ),
          const SizedBox(height: 8),
          if (!_isEdit)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Langsung buat kode aktivasi'),
              subtitle: const Text('Karyawan bisa langsung menautkan akun menggunakan kode ini'),
              value: _issueClaimCode,
              onChanged: (v) => setState(() => _issueClaimCode = v),
            )
          else
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Status Akun Aktif'),
              subtitle: Text(
                _isSelf
                    ? 'Akun Anda sendiri tidak bisa dinonaktifkan'
                    : 'Nonaktifkan untuk mencabut akses masuk sementara',
              ),
              value: _isActive,
              onChanged: _isSelf ? null : (v) => setState(() => _isActive = v),
            ),
          const SizedBox(height: 14),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
            onPressed: _saving ? null : _submit,
            child: Text(
              _saving
                  ? 'Menyimpan...'
                  : (_isEdit ? 'Simpan Perubahan' : 'Simpan Karyawan'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RolePermissionsSheet extends ConsumerStatefulWidget {
  final Map<String, dynamic> role;
  final List<dynamic> allPermissions;

  const _RolePermissionsSheet({
    required this.role,
    required this.allPermissions,
  });

  @override
  ConsumerState<_RolePermissionsSheet> createState() => _RolePermissionsSheetState();
}

class _RolePermissionsSheetState extends ConsumerState<_RolePermissionsSheet> {
  static const Map<String, String> _moduleLabels = {
    'finance': 'Keuangan',
    'inventory': 'Inventaris',
    'attendance': 'Absensi',
    'payroll': 'Payroll',
    'rbac': 'RBAC & Tim',
    'audit': 'Audit Trail',
  };

  static const Map<String, String> _actionLabels = {
    'view': 'Lihat',
    'create': 'Tambah',
    'update': 'Ubah',
    'delete': 'Hapus',
    'approve': 'Setujui',
    'export': 'Ekspor',
  };

  late final Set<String> _selectedIds;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final existing = (widget.role['permissions'] as List<dynamic>?) ?? const [];
    _selectedIds = existing
        .map((p) => (p as Map<String, dynamic>)['id'].toString())
        .toSet();
  }

  bool _isLockedOwnerPerm(String module, String action) {
    return widget.role['code'] == 'owner' &&
        module == 'rbac' &&
        (action == 'view' || action == 'update');
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .updateRolePermissions(widget.role['id'].toString(), _selectedIds.toList());
      if (mounted) Navigator.of(context).pop(true);
    } catch (err) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = err.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final modules = _moduleLabels.keys.toList(growable: false);

    return ErpBottomSheetFrame(
      title: 'Izin Role ${widget.role['name']}',
      subtitle:
          '${_selectedIds.length} dari ${widget.allPermissions.length} izin aktif${widget.role['code'] == 'owner' ? ' · rbac:view & rbac:update terkunci aktif' : ''}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: t.dangerSoft,
                borderRadius: BorderRadius.circular(t.radiusMd),
                border: Border.all(color: t.danger.withValues(alpha: 0.45)),
              ),
              child: Text(
                _error!,
                style: TextStyle(fontSize: 12.5, color: t.danger, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 12),
          ],
          for (var i = 0; i < modules.length; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _moduleLabels[modules[i]] ?? modules[i],
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final actionEntry in _actionLabels.entries)
                          ...() {
                            final perm = widget.allPermissions
                                .cast<Map<String, dynamic>?>()
                                .firstWhere(
                                  (p) =>
                                      p?['module'] == modules[i] &&
                                      p?['action'] == actionEntry.key,
                                  orElse: () => null,
                                );
                            if (perm == null) return const <Widget>[];
                            final permId = perm['id'].toString();
                            final locked = _isLockedOwnerPerm(modules[i], actionEntry.key);
                            final selected = _selectedIds.contains(permId) || locked;
                            return <Widget>[
                              FilterChip(
                                label: Text(
                                  locked ? '${actionEntry.value} (Wajib)' : actionEntry.value,
                                ),
                                selected: selected,
                                onSelected: locked
                                    ? null
                                    : (next) {
                                        setState(() {
                                          if (next) {
                                            _selectedIds.add(permId);
                                          } else {
                                            _selectedIds.remove(permId);
                                          }
                                        });
                                      },
                              ),
                            ];
                          }(),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(double.infinity, 48)),
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Menyimpan...' : 'Simpan Matriks Izin'),
          ),
        ],
      ),
    );
  }
}
