import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import '../config/app_config.dart';
import '../network/api_client.dart';

export 'package:dio/dio.dart' show CancelToken;

class InstalledAppVersion {
  final String version;
  final int buildNumber;

  const InstalledAppVersion({
    required this.version,
    required this.buildNumber,
  });
}

class ApkDownloadProgress {
  final int receivedBytes;
  final int totalBytes;

  const ApkDownloadProgress({
    required this.receivedBytes,
    required this.totalBytes,
  });

  double? get fraction =>
      totalBytes > 0 ? (receivedBytes / totalBytes).clamp(0.0, 1.0) : null;
}

enum ApkInstallOutcome {
  launched,
  permissionRequired,
  unsupported,
  failed,
}

class ApkInstallResult {
  final ApkInstallOutcome outcome;
  final String? message;

  const ApkInstallResult({
    required this.outcome,
    this.message,
  });
}

class ApkDownloadCancelledException implements Exception {
  const ApkDownloadCancelledException();

  @override
  String toString() => 'Unduhan pembaruan dibatalkan.';
}

class AppReleaseInfo {
  final String id;
  final String platform;
  final String version;
  final int buildNumber;
  final String title;
  final List<String> changelog;
  final String? downloadUrl;
  final int? fileSizeBytes;
  final bool hasApk;
  final bool isMandatory;
  final String publishedAt;

  const AppReleaseInfo({
    required this.id,
    required this.platform,
    required this.version,
    required this.buildNumber,
    required this.title,
    required this.changelog,
    required this.downloadUrl,
    this.fileSizeBytes,
    this.hasApk = false,
    required this.isMandatory,
    required this.publishedAt,
  });

  bool get canDownloadInApp {
    if (hasApk) return true;
    final raw = downloadUrl?.trim().toLowerCase() ?? '';
    return raw.contains('/api/app/download/android') || raw.contains('.apk');
  }

  factory AppReleaseInfo.fromJson(Map<String, dynamic> json) {
    final rawChangelog = json['changelog'];
    final items = <String>[];
    if (rawChangelog is List) {
      for (final entry in rawChangelog) {
        final s = entry?.toString().trim() ?? '';
        if (s.isNotEmpty) items.add(s);
      }
    }
    final rawBuild = json['build_number'];
    final parsedBuild = rawBuild is int
        ? rawBuild
        : int.tryParse(rawBuild?.toString() ?? '') ?? 0;
    final rawSize = json['file_size_bytes'];
    final parsedSize = rawSize is int
        ? rawSize
        : int.tryParse(rawSize?.toString() ?? '');

    return AppReleaseInfo(
      id: (json['id'] ?? '').toString(),
      platform: (json['platform'] ?? 'android').toString(),
      version: (json['version'] ?? '0.0.0').toString(),
      buildNumber: parsedBuild,
      title: (json['title'] ?? 'Pembaruan Aplikasi').toString(),
      changelog: items,
      downloadUrl: json['download_url']?.toString(),
      fileSizeBytes: parsedSize != null && parsedSize > 0 ? parsedSize : null,
      hasApk: json['has_apk'] == true,
      isMandatory: json['is_mandatory'] == true,
      publishedAt: (json['published_at'] ?? '').toString(),
    );
  }
}

class AppVersionCheckResult {
  final String platform;
  final String currentVersion;
  final int currentBuild;
  final bool hasUpdate;
  final AppReleaseInfo? latest;
  final List<AppReleaseInfo> pendingReleases;
  final List<AppReleaseInfo> releases;

  const AppVersionCheckResult({
    required this.platform,
    required this.currentVersion,
    required this.currentBuild,
    required this.hasUpdate,
    required this.latest,
    required this.pendingReleases,
    required this.releases,
  });

  factory AppVersionCheckResult.fromJson(
    Map<String, dynamic> json, {
    required String fallbackVersion,
    required int fallbackBuild,
  }) {
    final rawLatest = json['latest'];
    final rawPending = (json['pending_releases'] as List<dynamic>? ?? const []);
    final rawReleases = (json['releases'] as List<dynamic>? ?? const []);
    final parsedBuild = json['current_build'] is int
        ? json['current_build'] as int
        : int.tryParse(json['current_build']?.toString() ?? '') ?? fallbackBuild;

    return AppVersionCheckResult(
      platform: (json['platform'] ?? 'android').toString(),
      currentVersion: (json['current_version'] ?? fallbackVersion).toString(),
      currentBuild: parsedBuild > 0 ? parsedBuild : fallbackBuild,
      hasUpdate: json['has_update'] == true,
      latest: rawLatest is Map<String, dynamic>
          ? AppReleaseInfo.fromJson(rawLatest)
          : (rawLatest is Map
              ? AppReleaseInfo.fromJson(Map<String, dynamic>.from(rawLatest))
              : null),
      pendingReleases: rawPending
          .whereType<Map>()
          .map((e) => AppReleaseInfo.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false),
      releases: rawReleases
          .whereType<Map>()
          .map((e) => AppReleaseInfo.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false),
    );
  }
}

class AppUpdateService {
  static const MethodChannel _channel = MethodChannel(
    'com.ekalliptus.myekalliptus/device_telemetry',
  );

  final ApiClient _api;

  AppUpdateService(this._api);

  Future<InstalledAppVersion> getInstalledVersion() async {
    if (!kIsWeb && Platform.isAndroid) {
      try {
        final raw = await _channel.invokeMapMethod<dynamic, dynamic>('getAppVersion');
        if (raw != null) {
          final v = raw['version']?.toString().trim() ?? '';
          final rawB = raw['build_number'];
          final b = rawB is int ? rawB : int.tryParse(rawB?.toString() ?? '') ?? 0;
          if (v.isNotEmpty && b > 0) {
            return InstalledAppVersion(version: v, buildNumber: b);
          }
        }
      } catch (_) {
        // Fallback ke versi build statis saat di widget test atau non-Android.
      }
    }
    return const InstalledAppVersion(
      version: AppConfig.appVersion,
      buildNumber: AppConfig.appBuildNumber,
    );
  }

  Future<AppVersionCheckResult> checkForUpdate() async {
    final installed = await getInstalledVersion();
    final json = await _api.fetchAppVersion(
      platform: 'android',
      currentVersion: installed.version,
      currentBuild: installed.buildNumber,
    );
    return AppVersionCheckResult.fromJson(
      json,
      fallbackVersion: installed.version,
      fallbackBuild: installed.buildNumber,
    );
  }

  bool get supportsInAppInstall => !kIsWeb && Platform.isAndroid;

  Future<bool> canInstallPackages() async {
    if (!supportsInAppInstall) return false;
    try {
      final allowed = await _channel.invokeMethod<bool>('canInstallPackages');
      return allowed == true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> openInstallPermissionSettings() async {
    if (!supportsInAppInstall) return false;
    try {
      final opened = await _channel.invokeMethod<bool>('openInstallPermissionSettings');
      return opened == true;
    } catch (_) {
      return false;
    }
  }

  Future<ApkInstallResult> installApk(String filePath) async {
    if (!supportsInAppInstall) {
      return const ApkInstallResult(
        outcome: ApkInstallOutcome.unsupported,
        message: 'Pemasangan APK langsung hanya tersedia pada perangkat Android.',
      );
    }
    try {
      final raw = await _channel.invokeMapMethod<dynamic, dynamic>(
        'installApk',
        {'file_path': filePath},
      );
      final status = raw?['status']?.toString() ?? 'error';
      switch (status) {
        case 'launched':
          return const ApkInstallResult(outcome: ApkInstallOutcome.launched);
        case 'permission_required':
          return const ApkInstallResult(outcome: ApkInstallOutcome.permissionRequired);
        default:
          return ApkInstallResult(
            outcome: ApkInstallOutcome.failed,
            message: raw?['message']?.toString() ?? 'Gagal memulai pemasang aplikasi Android.',
          );
      }
    } catch (err) {
      return ApkInstallResult(
        outcome: ApkInstallOutcome.failed,
        message: 'Gagal memulai pemasang aplikasi Android: $err',
      );
    }
  }

  Future<bool> _isValidApkFile(File file, {int? expectedBytes}) async {
    if (!await file.exists()) return false;
    final length = await file.length();
    if (length <= 102400) return false;
    if (expectedBytes != null && expectedBytes > 0 && length != expectedBytes) {
      return false;
    }
    final raf = await file.open();
    try {
      final header = await raf.read(2);
      return header.length == 2 && header[0] == 0x50 && header[1] == 0x4B;
    } finally {
      await raf.close();
    }
  }

  Future<String> downloadApk(
    AppReleaseInfo release, {
    void Function(ApkDownloadProgress progress)? onProgress,
    CancelToken? cancelToken,
  }) async {
    var rawUrl = release.downloadUrl?.trim() ?? '';
    if (rawUrl.startsWith('/')) {
      rawUrl = '${AppConfig.apiBaseUrl}$rawUrl';
    }
    if (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://')) {
      throw Exception('URL unduhan APK tidak valid.');
    }

    final dio = Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(minutes: 10),
        followRedirects: true,
        maxRedirects: 5,
      ),
    );

    var directUrl = rawUrl;
    int? expectedTotal = release.fileSizeBytes;
    if (rawUrl.contains('/api/app/download/android')) {
      final sep = rawUrl.contains('?') ? '&' : '?';
      try {
        final metaRes = await dio.get<dynamic>(
          '$rawUrl${sep}format=json',
          cancelToken: cancelToken,
        );
        final meta = metaRes.data;
        if (meta is Map) {
          final resolved = meta['download_url']?.toString().trim() ?? '';
          if (resolved.startsWith('https://') || resolved.startsWith('http://')) {
            directUrl = resolved;
          }
          final rawSize = meta['file_size_bytes'];
          final parsedSize = rawSize is int ? rawSize : int.tryParse(rawSize?.toString() ?? '');
          if (parsedSize != null && parsedSize > 0) {
            expectedTotal = parsedSize;
          }
        }
      } on DioException catch (e) {
        if (CancelToken.isCancel(e)) {
          throw const ApkDownloadCancelledException();
        }
        // Fallback ke tautan langsung bila metadata JSON gagal diambil.
      } catch (_) {
        // Fallback ke tautan langsung bila metadata JSON gagal diambil.
      }
    }

    final tempDir = await getTemporaryDirectory();
    final updatesDir = Directory('${tempDir.path}/apk_updates');
    await updatesDir.create(recursive: true);

    final safeVersion = release.version.replaceAll(RegExp(r'[^0-9A-Za-z._-]'), '_');
    final targetFile = File('${updatesDir.path}/MyEkalliptus-v$safeVersion-b${release.buildNumber}.apk');
    final partFile = File('${targetFile.path}.part');

    if (await _isValidApkFile(targetFile, expectedBytes: expectedTotal)) {
      final cachedSize = await targetFile.length();
      onProgress?.call(
        ApkDownloadProgress(receivedBytes: cachedSize, totalBytes: cachedSize),
      );
      return targetFile.path;
    }

    if (updatesDir.existsSync()) {
      for (final entity in updatesDir.listSync()) {
        if (entity is File &&
            (entity.path.endsWith('.apk') || entity.path.endsWith('.part'))) {
          try {
            await entity.delete();
          } catch (_) {
            // Abaikan berkas cache lama yang tidak dapat dihapus.
          }
        }
      }
    }

    if (expectedTotal != null && expectedTotal > 0) {
      onProgress?.call(ApkDownloadProgress(receivedBytes: 0, totalBytes: expectedTotal));
    }

    try {
      await dio.download(
        directUrl,
        partFile.path,
        cancelToken: cancelToken,
        deleteOnError: true,
        onReceiveProgress: (received, total) {
          final resolvedTotal = total > 0 ? total : (expectedTotal ?? 0);
          onProgress?.call(
            ApkDownloadProgress(receivedBytes: received, totalBytes: resolvedTotal),
          );
        },
      );
    } on DioException catch (e) {
      if (await partFile.exists()) {
        try {
          await partFile.delete();
        } catch (_) {}
      }
      if (CancelToken.isCancel(e)) {
        throw const ApkDownloadCancelledException();
      }
      throw Exception('Gagal mengunduh pembaruan: ${e.message ?? 'koneksi terputus'}');
    }

    final valid = await _isValidApkFile(partFile, expectedBytes: expectedTotal);
    if (!valid) {
      if (await partFile.exists()) {
        try {
          await partFile.delete();
        } catch (_) {}
      }
      throw Exception('Berkas APK tidak valid atau unduhan terputus.');
    }

    if (await targetFile.exists()) {
      await targetFile.delete();
    }
    await partFile.rename(targetFile.path);
    return targetFile.path;
  }

  Future<bool> openUpdateUrl(String url) async {
    final trimmed = url.trim();
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
      return false;
    }
    if (kIsWeb || !Platform.isAndroid) {
      return false;
    }
    try {
      final launched = await _channel.invokeMethod<bool>(
        'openExternalUrl',
        {'url': trimmed},
      );
      return launched == true;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> publishRelease(Map<String, dynamic> payload) {
    return _api.publishAppRelease(payload);
  }
}
