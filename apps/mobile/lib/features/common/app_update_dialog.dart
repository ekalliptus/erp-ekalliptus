import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/eucalyptus_theme.dart';
import '../../core/updates/app_update_service.dart';
import '../../core/utils/formatters.dart';
import 'erp_widgets.dart';

String _formatFileSizeMb(int bytes) {
  final mb = bytes / (1024 * 1024);
  return '${mb >= 10 ? mb.toStringAsFixed(1) : mb.toStringAsFixed(2)} MB';
}

Future<void> launchOrCopyUpdateUrl(
  BuildContext context,
  AppUpdateService service,
  String url,
) async {
  final target = url.trim().isEmpty ? AppConfig.defaultUpdateUrl : url.trim();
  final opened = await service.openUpdateUrl(target);
  if (!context.mounted) return;
  if (!opened) {
    await Clipboard.setData(ClipboardData(text: target));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Tautan pembaruan disalin: $target'),
      ),
    );
  }
}

Future<void> showAppUpdateDialog(
  BuildContext context, {
  required AppVersionCheckResult result,
  required VoidCallback onLater,
  AppUpdateService? updateService,
  Future<void> Function(String url)? onUpdate,
}) async {
  final latest = result.latest;
  if (latest == null) return;

  await showDialog<void>(
    context: context,
    barrierDismissible: !latest.isMandatory,
    builder: (ctx) => _AppUpdateDialogBody(
      result: result,
      latest: latest,
      onLater: onLater,
      updateService: updateService,
      onUpdate: onUpdate,
    ),
  );
}

enum _UpdateDialogPhase {
  idle,
  downloading,
  readyToInstall,
  permissionRequired,
  error,
}

class _AppUpdateDialogBody extends StatefulWidget {
  final AppVersionCheckResult result;
  final AppReleaseInfo latest;
  final VoidCallback onLater;
  final AppUpdateService? updateService;
  final Future<void> Function(String url)? onUpdate;

  const _AppUpdateDialogBody({
    required this.result,
    required this.latest,
    required this.onLater,
    this.updateService,
    this.onUpdate,
  });

  @override
  State<_AppUpdateDialogBody> createState() => _AppUpdateDialogBodyState();
}

class _AppUpdateDialogBodyState extends State<_AppUpdateDialogBody>
    with WidgetsBindingObserver {
  _UpdateDialogPhase _phase = _UpdateDialogPhase.idle;
  ApkDownloadProgress? _progress;
  CancelToken? _cancelToken;
  String? _downloadedApkPath;
  String? _errorMessage;
  bool _waitingForPermission = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (_cancelToken != null && !_cancelToken!.isCancelled) {
      _cancelToken!.cancel();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _waitingForPermission &&
        _downloadedApkPath != null &&
        widget.updateService != null) {
      unawaited(_resumeInstallAfterPermission());
    }
  }

  Future<void> _resumeInstallAfterPermission() async {
    final service = widget.updateService;
    final apkPath = _downloadedApkPath;
    if (service == null || apkPath == null) return;
    final granted = await service.canInstallPackages();
    if (!mounted || !granted) return;
    setState(() => _waitingForPermission = false);
    await _triggerInstall(apkPath);
  }

  String _resolveTargetUrl() {
    final raw = widget.latest.downloadUrl?.trim() ?? '';
    return raw.isNotEmpty ? raw : AppConfig.defaultUpdateUrl;
  }

  Future<void> _startUpdateFlow() async {
    final service = widget.updateService;
    final canInApp =
        service != null && service.supportsInAppInstall && widget.latest.canDownloadInApp;
    if (!canInApp) {
      final url = _resolveTargetUrl();
      if (mounted) {
        Navigator.of(context).pop();
      }
      if (widget.onUpdate != null) {
        await widget.onUpdate!(url);
      } else if (service != null && mounted) {
        await launchOrCopyUpdateUrl(context, service, url);
      }
      return;
    }

    final token = CancelToken();
    setState(() {
      _cancelToken = token;
      _errorMessage = null;
      _phase = _UpdateDialogPhase.downloading;
      _progress = ApkDownloadProgress(
        receivedBytes: 0,
        totalBytes: widget.latest.fileSizeBytes ?? 0,
      );
    });

    try {
      final apkPath = await service.downloadApk(
        widget.latest,
        cancelToken: token,
        onProgress: (p) {
          if (mounted) {
            setState(() => _progress = p);
          }
        },
      );
      if (!mounted) return;
      _downloadedApkPath = apkPath;
      await _triggerInstall(apkPath);
    } on ApkDownloadCancelledException {
      if (!mounted) return;
      setState(() {
        _cancelToken = null;
        _progress = null;
        _phase = _UpdateDialogPhase.idle;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _cancelToken = null;
        _phase = _UpdateDialogPhase.error;
        _errorMessage = err.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _triggerInstall(String apkPath) async {
    final service = widget.updateService;
    if (service == null) return;
    final installRes = await service.installApk(apkPath);
    if (!mounted) return;
    switch (installRes.outcome) {
      case ApkInstallOutcome.launched:
        setState(() {
          _waitingForPermission = false;
          _phase = _UpdateDialogPhase.readyToInstall;
        });
      case ApkInstallOutcome.permissionRequired:
        setState(() => _phase = _UpdateDialogPhase.permissionRequired);
      case ApkInstallOutcome.unsupported:
      case ApkInstallOutcome.failed:
        setState(() {
          _phase = _UpdateDialogPhase.error;
          _errorMessage = installRes.message ?? 'Gagal memasang pembaruan.';
        });
    }
  }

  Future<void> _openPermissionSettings() async {
    final service = widget.updateService;
    if (service == null) return;
    _waitingForPermission = true;
    await service.openInstallPermissionSettings();
  }

  String _progressDetailText(ApkDownloadProgress? progress) {
    if (progress == null) return 'Menghubungkan ke server...';
    if (progress.totalBytes > 0) {
      return '${_formatFileSizeMb(progress.receivedBytes)} / ${_formatFileSizeMb(progress.totalBytes)}';
    }
    if (progress.receivedBytes > 0) {
      return '${_formatFileSizeMb(progress.receivedBytes)} terunduh';
    }
    return 'Menghubungkan ke server...';
  }

  @override
  Widget build(BuildContext context) {
    final t = EucalyptusTokens.of(context);
    final latest = widget.latest;
    final releasesToShow =
        widget.result.pendingReleases.isNotEmpty ? widget.result.pendingReleases : [latest];
    final canPopDialog =
        _phase != _UpdateDialogPhase.downloading && !latest.isMandatory;
    final fraction = _progress?.fraction;
    final percentLabel =
        fraction != null ? '${(fraction * 100).round().clamp(0, 100)}%' : null;

    return PopScope(
      canPop: canPopDialog,
      child: AlertDialog(
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
        contentPadding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
        title: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: t.accentSoft,
                borderRadius: BorderRadius.circular(t.radiusMd),
              ),
              child: Icon(Icons.system_update_alt_rounded, size: 20, color: t.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      const ErpBadge(label: 'Update Tersedia', tone: ErpBadgeTone.accent),
                      if (latest.isMandatory)
                        const ErpBadge(label: 'Penting', tone: ErpBadgeTone.warning),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Pembaruan Aplikasi',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ],
              ),
            ),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 300),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: t.surfaceSubtle,
                    borderRadius: BorderRadius.circular(t.radiusMd),
                    border: Border.all(color: t.border),
                  ),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        'v${widget.result.currentVersion} -> v${latest.version} (Build ${latest.buildNumber})',
                        style: AppTheme.monoNumeric(
                          color: t.textPrimary,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        formatShortDate(latest.publishedAt),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                if (latest.fileSizeBytes != null && _phase == _UpdateDialogPhase.idle) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Ukuran unduhan: ${_formatFileSizeMb(latest.fileSizeBytes!)}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: t.textMuted),
                  ),
                ],
                const SizedBox(height: 12),
                if (_phase == _UpdateDialogPhase.downloading) ...[
                  Text(
                    'Mengunduh pembaruan v${latest.version}...',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: t.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(t.radiusPill),
                    child: LinearProgressIndicator(
                      value: fraction,
                      minHeight: 8,
                      backgroundColor: t.surfaceSubtle,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          _progressDetailText(_progress),
                          style: AppTheme.monoNumeric(
                            color: t.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      if (percentLabel != null)
                        Text(
                          percentLabel,
                          style: AppTheme.monoNumeric(
                            color: t.accentHover,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                    ],
                  ),
                ] else if (_phase == _UpdateDialogPhase.readyToInstall) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: t.accentSoft,
                      borderRadius: BorderRadius.circular(t.radiusMd),
                      border: Border.all(color: t.accent.withValues(alpha: 0.45)),
                    ),
                    child: Text(
                      'Unduhan selesai. Ikuti konfirmasi pemasangan dari sistem Android.',
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                        color: t.textPrimary,
                      ),
                    ),
                  ),
                ] else if (_phase == _UpdateDialogPhase.permissionRequired) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: t.warningSoft,
                      borderRadius: BorderRadius.circular(t.radiusMd),
                      border: Border.all(color: t.warning.withValues(alpha: 0.45)),
                    ),
                    child: Text(
                      'Izinkan pemasangan aplikasi dari MyEkalliptus di Pengaturan Android, lalu kembali ke aplikasi ini.',
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                        color: t.textPrimary,
                      ),
                    ),
                  ),
                ] else if (_phase == _UpdateDialogPhase.error) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: t.dangerSoft,
                      borderRadius: BorderRadius.circular(t.radiusMd),
                      border: Border.all(color: t.danger.withValues(alpha: 0.45)),
                    ),
                    child: Text(
                      _errorMessage ?? 'Terjadi kesalahan saat mengunduh pembaruan.',
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        color: t.danger,
                      ),
                    ),
                  ),
                ] else ...[
                  Text(
                    latest.title,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: t.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Changelog Pembaruan',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: t.textSecondary,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 6),
                  for (final rel in releasesToShow) ...[
                    if (releasesToShow.length > 1) ...[
                      Padding(
                        padding: const EdgeInsets.only(top: 6, bottom: 4),
                        child: Text(
                          'v${rel.version} (Build ${rel.buildNumber}) · ${rel.title}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: t.accentHover,
                          ),
                        ),
                      ),
                    ],
                    for (final item in rel.changelog)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Container(
                                width: 5,
                                height: 5,
                                decoration: BoxDecoration(
                                  color: t.accent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  height: 1.4,
                                  color: t.textPrimary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ],
              ],
            ),
          ),
        ),
        actions: _buildActions(context, latest),
      ),
    );
  }

  List<Widget> _buildActions(BuildContext context, AppReleaseInfo latest) {
    switch (_phase) {
      case _UpdateDialogPhase.downloading:
        return [
          TextButton(
            onPressed: () {
              if (_cancelToken != null && !_cancelToken!.isCancelled) {
                _cancelToken!.cancel();
              }
            },
            child: const Text('Batal'),
          ),
        ];
      case _UpdateDialogPhase.readyToInstall:
        return [
          if (!latest.isMandatory)
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Tutup'),
            ),
          FilledButton.icon(
            onPressed: _downloadedApkPath == null
                ? null
                : () => unawaited(_triggerInstall(_downloadedApkPath!)),
            icon: const Icon(Icons.install_mobile_rounded, size: 18),
            label: const Text('Pasang Ulang'),
          ),
        ];
      case _UpdateDialogPhase.permissionRequired:
        return [
          if (!latest.isMandatory)
            TextButton(
              onPressed: () {
                _waitingForPermission = false;
                Navigator.of(context).pop();
              },
              child: const Text('Batal'),
            ),
          FilledButton.icon(
            onPressed: () => unawaited(_openPermissionSettings()),
            icon: const Icon(Icons.settings_outlined, size: 18),
            label: const Text('Izinkan & Pasang'),
          ),
        ];
      case _UpdateDialogPhase.error:
        return [
          if (!latest.isMandatory)
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Tutup'),
            ),
          FilledButton.icon(
            onPressed: () => unawaited(_startUpdateFlow()),
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Coba Lagi'),
          ),
        ];
      case _UpdateDialogPhase.idle:
        return [
          if (!latest.isMandatory)
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                widget.onLater();
              },
              child: const Text('Nanti'),
            ),
          FilledButton.icon(
            onPressed: () => unawaited(_startUpdateFlow()),
            icon: const Icon(Icons.download_rounded, size: 18),
            label: const Text('Update'),
          ),
        ];
    }
  }
}

Future<void> showAppChangelogSheet(
  BuildContext context, {
  required String currentVersion,
  required int currentBuild,
  required List<AppReleaseInfo> releases,
  bool canPublishRelease = false,
  Future<void> Function(Map<String, dynamic> payload)? onPublishRelease,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) {
      final t = EucalyptusTokens.of(ctx);
      final sorted = List<AppReleaseInfo>.from(releases)
        ..sort((a, b) => b.buildNumber.compareTo(a.buildNumber));

      return ErpBottomSheetFrame(
        title: 'Riwayat Pembaruan & Changelog',
        subtitle: 'Versi terpasang saat ini: v$currentVersion (Build $currentBuild)',
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (canPublishRelease && onPublishRelease != null) ...[
              FilledButton.icon(
                onPressed: () async {
                  final published = await showModalBottomSheet<bool>(
                    context: ctx,
                    useRootNavigator: true,
                    isScrollControlled: true,
                    useSafeArea: true,
                    builder: (_) => _PublishReleaseSheet(
                      defaultBuildNumber:
                          (sorted.isNotEmpty ? sorted.first.buildNumber : currentBuild) + 1,
                      onSubmit: onPublishRelease,
                    ),
                  );
                  if (published == true && ctx.mounted) {
                    Navigator.of(ctx).pop();
                  }
                },
                icon: const Icon(Icons.new_releases_outlined, size: 18),
                label: const Text('Publikasikan Rilis Baru'),
              ),
              const SizedBox(height: 12),
            ],
            if (sorted.isEmpty)
              const ErpEmptyCard(
                title: 'Belum ada catatan rilis',
                description: 'Periksa koneksi server untuk mengambil riwayat changelog.',
              )
            else
              for (var i = 0; i < sorted.length; i++) ...[
                _ChangelogReleaseCard(
                  release: sorted[i],
                  isLatest: i == 0,
                  isInstalled: sorted[i].buildNumber == currentBuild &&
                      sorted[i].version == currentVersion,
                  tokens: t,
                ),
                if (i < sorted.length - 1) const SizedBox(height: 10),
              ],
          ],
        ),
      );
    },
  );
}

class _ChangelogReleaseCard extends StatelessWidget {
  final AppReleaseInfo release;
  final bool isLatest;
  final bool isInstalled;
  final EucalyptusTokens tokens;

  const _ChangelogReleaseCard({
    required this.release,
    required this.isLatest,
    required this.isInstalled,
    required this.tokens,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isInstalled ? tokens.accentSoft.withValues(alpha: 0.45) : tokens.surfaceSubtle,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
        border: Border.all(
          color: isInstalled ? tokens.accent.withValues(alpha: 0.45) : tokens.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                'v${release.version} (Build ${release.buildNumber})',
                style: AppTheme.monoNumeric(
                  color: tokens.textPrimary,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (isLatest) const ErpBadge(label: 'Terbaru', tone: ErpBadgeTone.accent),
              if (isInstalled) const ErpBadge(label: 'Terpasang', tone: ErpBadgeTone.success),
              Text(
                formatShortDate(release.publishedAt),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            release.title,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: tokens.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          for (final item in release.changelog)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        color: tokens.accent,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      item,
                      style: TextStyle(fontSize: 12.5, height: 1.4, color: tokens.textPrimary),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _PublishReleaseSheet extends StatefulWidget {
  final int defaultBuildNumber;
  final Future<void> Function(Map<String, dynamic> payload) onSubmit;

  const _PublishReleaseSheet({
    required this.defaultBuildNumber,
    required this.onSubmit,
  });

  @override
  State<_PublishReleaseSheet> createState() => _PublishReleaseSheetState();
}

class _PublishReleaseSheetState extends State<_PublishReleaseSheet> {
  final _versionCtrl = TextEditingController(text: '1.3.4');
  late final TextEditingController _buildCtrl;
  final _titleCtrl = TextEditingController();
  final _changelogCtrl = TextEditingController();
  final _urlCtrl = TextEditingController(text: AppConfig.defaultUpdateUrl);
  String _platform = 'android';
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _buildCtrl = TextEditingController(text: widget.defaultBuildNumber.toString());
  }

  @override
  void dispose() {
    _versionCtrl.dispose();
    _buildCtrl.dispose();
    _titleCtrl.dispose();
    _changelogCtrl.dispose();
    _urlCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final version = _versionCtrl.text.trim();
    final buildNum = int.tryParse(_buildCtrl.text.trim());
    final title = _titleCtrl.text.trim();
    final lines = _changelogCtrl.text
        .split('\n')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList(growable: false);
    final url = _urlCtrl.text.trim();

    if (!RegExp(r'^\d+\.\d+\.\d+$').hasMatch(version)) {
      setState(() => _error = 'Format versi harus semver seperti 1.2.1');
      return;
    }
    if (buildNum == null || buildNum < 1) {
      setState(() => _error = 'Nomor build harus angka bulat positif.');
      return;
    }
    if (title.length < 3) {
      setState(() => _error = 'Judul rilis minimal 3 karakter.');
      return;
    }
    if (lines.isEmpty) {
      setState(() => _error = 'Isi minimal satu poin changelog.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSubmit({
        'platform': _platform,
        'version': version,
        'build_number': buildNum,
        'title': title,
        'changelog': lines,
        if (url.isNotEmpty) 'download_url': url,
      });
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
    return ErpBottomSheetFrame(
      title: 'Publikasikan Rilis Baru',
      subtitle: 'Hanya Owner. Rilis baru langsung muncul pada cek update perangkat.',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: t.dangerSoft,
                borderRadius: BorderRadius.circular(t.radiusMd),
                border: Border.all(color: t.danger.withValues(alpha: 0.4)),
              ),
              child: Text(_error!, style: TextStyle(fontSize: 12.5, color: t.danger)),
            ),
            const SizedBox(height: 12),
          ],
          DropdownButtonFormField<String>(
            initialValue: _platform,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Platform Target'),
            items: const [
              DropdownMenuItem(value: 'android', child: Text('Android Mobile (android)')),
              DropdownMenuItem(value: 'web', child: Text('Web Command Center (web)')),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _platform = v);
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _versionCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Versi Semver',
                    hintText: '1.2.1',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _buildCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Build Number',
                    hintText: '4',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(
              labelText: 'Judul Pembaruan',
              hintText: 'Perbaikan performa & sinkronisasi GPS',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _changelogCtrl,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Daftar Changelog (1 poin per baris)',
              hintText: 'Peningkatan akurasi GPS\nPerbaikan tampilan profil',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _urlCtrl,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'URL Unduhan / Pembaruan',
              hintText: AppConfig.defaultUpdateUrl,
            ),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _saving ? null : _submit,
            child: Text(_saving ? 'Mempublikasikan...' : 'Terbitkan Rilis'),
          ),
        ],
      ),
    );
  }
}
