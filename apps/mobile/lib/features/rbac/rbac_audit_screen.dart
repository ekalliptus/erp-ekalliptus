import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

  bool _loading = true;
  bool _loadingMore = false;
  int _visibleLogs = _batchSize;
  Timer? _moreTimer;
  String? _error;
  int _segment = 0;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _moreTimer?.cancel();
    super.dispose();
  }

  void _scheduleLoadMore(int total) {
    if (_loadingMore || _visibleLogs >= total) return;
    setState(() => _loadingMore = true);
    _moreTimer?.cancel();
    _moreTimer = Timer(const Duration(milliseconds: 220), () {
      if (!mounted) return;
      setState(() {
        _visibleLogs += _batchSize;
        _loadingMore = false;
      });
    });
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

  void _showAuditDiff(Map<String, dynamic> log) {
    final t = EucalyptusTokens.of(context);
    const encoder = JsonEncoder.withIndent('  ');
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.6,
          maxChildSize: 0.9,
          builder: (_, scrollCtrl) {
            return ListView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(20),
              children: [
                Text('${log['module']} / ${log['action']}',
                    style: Theme.of(ctx).textTheme.titleLarge),
                const SizedBox(height: 12),
                Text('Before Data', style: Theme.of(ctx).textTheme.titleMedium),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: t.surfaceSubtle,
                    borderRadius: BorderRadius.circular(t.radiusMd),
                  ),
                  child: Text(
                    encoder.convert(log['before_data']),
                    style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 11),
                  ),
                ),
                const SizedBox(height: 12),
                Text('After Data', style: Theme.of(ctx).textTheme.titleMedium),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: t.surfaceSubtle,
                    borderRadius: BorderRadius.circular(t.radiusMd),
                  ),
                  child: Text(
                    encoder.convert(log['after_data']),
                    style: AppTheme.monoNumeric(color: t.textPrimary, fontSize: 11),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final canRbac = widget.profile.hasPermission('rbac', 'view');
    final canAudit = widget.profile.hasPermission('audit', 'view');
    if (!canRbac && !canAudit) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: ErpEmptyCard(
          title: 'Akses Ditolak',
          description: 'Role Anda tidak memiliki izin melihat RBAC maupun Audit Trail.',
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
    final logs = (_data?['audit_logs'] as List<dynamic>?) ?? const [];
    final shownLogs = logs.length < _visibleLogs ? logs.length : _visibleLogs;
    final hasMoreLogs = _segment == 1 && shownLogs < logs.length;

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (hasMoreLogs && notification.metrics.pixels >= notification.metrics.maxScrollExtent - 160) {
          _scheduleLoadMore(logs.length);
        }
        return false;
      },
      child: RefreshIndicator(
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SegmentedButton<int>(
                      segments: const [
                        ButtonSegment<int>(value: 0, label: Text('Tim & Role')),
                        ButtonSegment<int>(value: 1, label: Text('Audit Trail')),
                      ],
                      selected: {_segment},
                      onSelectionChanged: (s) => setState(() {
                        _segment = s.first;
                        _visibleLogs = _batchSize;
                      }),
                    ),
                    const SizedBox(height: 16),
                    if (_segment == 0) ...[
                      Text('Daftar Role (${roles.length})', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                    ],
                  ],
                ),
              ),
            ),
            if (_segment == 0) ...[
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverList.builder(
                  itemCount: roles.length,
                  itemBuilder: (ctx, i) {
                    final r = roles[i] as Map<String, dynamic>;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          title: Text('${r['name']} (${r['code']})'),
                          subtitle: Text((r['description'] ?? '').toString()),
                          trailing: ErpBadge(
                            label: '${((r['permissions'] as List<dynamic>?) ?? const []).length} izin',
                            tone: ErpBadgeTone.accent,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                sliver: SliverToBoxAdapter(
                  child: Text(
                    'Direktori Karyawan (${employees.length})',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverList.builder(
                  itemCount: employees.length,
                  itemBuilder: (ctx, i) {
                    final emp = employees[i] as Map<String, dynamic>;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          title: Text('${emp['full_name']} (${emp['employee_code']})'),
                          subtitle: Text('${emp['email']} • ${emp['role_name']}'),
                          trailing: ErpBadge(
                            label: emp['auth_user_id'] != null ? 'Tertaut' : 'Pending',
                            tone: emp['auth_user_id'] != null
                                ? ErpBadgeTone.success
                                : ErpBadgeTone.warning,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ] else if (logs.isEmpty)
              const SliverPadding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverToBoxAdapter(
                  child: ErpEmptyCard(
                    title: 'Log Audit Kosong',
                    description: 'Belum ada aktivitas perubahan entitas tercatat.',
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
                sliver: SliverList.builder(
                  itemCount: shownLogs + (hasMoreLogs ? 1 : 0),
                  itemBuilder: (ctx, index) {
                    if (index >= shownLogs) {
                      return const LazyListShimmerFooter(
                        label: 'Memuat catatan audit berikutnya...',
                      );
                    }
                    final log = logs[index] as Map<String, dynamic>;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          title: Text('${log['module'].toString().toUpperCase()} • ${log['action']}'),
                          subtitle: Text(
                            '${log['actor_email'] ?? 'system'} (${formatShortDateTime(log['created_at']?.toString())})',
                          ),
                          trailing: ErpBadge(
                            label: log['platform'].toString().toUpperCase(),
                            tone: log['platform'] == 'flutter'
                                ? ErpBadgeTone.info
                                : ErpBadgeTone.accent,
                          ),
                          onTap: () => _showAuditDiff(log),
                        ),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
