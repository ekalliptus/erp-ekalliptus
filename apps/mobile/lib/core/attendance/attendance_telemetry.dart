import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

class AttendanceTelemetrySnapshot {
  final double? latitude;
  final double? longitude;
  final double? gpsAccuracyMeters;
  final bool? isMockedGps;
  final String? manufacturer;
  final String? brand;
  final String? model;
  final String? osVersion;
  final String? platform;
  final String? deviceId;
  final bool? isPhysicalDevice;
  final String? localIp;

  const AttendanceTelemetrySnapshot({
    this.latitude,
    this.longitude,
    this.gpsAccuracyMeters,
    this.isMockedGps,
    this.manufacturer,
    this.brand,
    this.model,
    this.osVersion,
    this.platform,
    this.deviceId,
    this.isPhysicalDevice,
    this.localIp,
  });

  bool get hasGps => latitude != null && longitude != null;

  String get deviceLabel {
    final cleanBrand = (brand ?? '').trim();
    final cleanModel = (model ?? '').trim();
    if (cleanModel.isNotEmpty) {
      if (cleanBrand.isNotEmpty &&
          !cleanModel.toLowerCase().startsWith(cleanBrand.toLowerCase())) {
        return '$cleanBrand $cleanModel';
      }
      return cleanModel;
    }
    if (cleanBrand.isNotEmpty) return cleanBrand;
    final cleanPlatform = (platform ?? '').trim();
    return cleanPlatform.isNotEmpty ? cleanPlatform : 'Perangkat Aktif';
  }

  Map<String, dynamic> toDeviceInfoJson({
    String? biometricType,
    int? faceSimilarityPercent,
  }) {
    return <String, dynamic>{
      if (brand != null) 'brand': brand,
      if (model != null) 'model': model,
      if (manufacturer != null) 'manufacturer': manufacturer,
      if (osVersion != null) 'os_version': osVersion,
      if (platform != null) 'platform': platform,
      if (deviceId != null) 'device_id': deviceId,
      if (isPhysicalDevice != null) 'is_physical_device': isPhysicalDevice,
      if (localIp != null) 'local_ip': localIp,
      if (gpsAccuracyMeters != null) 'gps_accuracy_meters': gpsAccuracyMeters,
      if (isMockedGps != null) 'is_mocked_gps': isMockedGps,
      if (biometricType != null && biometricType.trim().isNotEmpty)
        'biometric_type': biometricType.trim(),
      if (faceSimilarityPercent != null)
        'face_similarity_percent': faceSimilarityPercent,
    };
  }
}

class _GpsReading {
  final double? latitude;
  final double? longitude;
  final double? accuracyMeters;
  final bool? isMocked;

  const _GpsReading({
    this.latitude,
    this.longitude,
    this.accuracyMeters,
    this.isMocked,
  });
}

class AttendanceTelemetryService {
  static const MethodChannel _channel = MethodChannel(
    'com.ekalliptus.myekalliptus/device_telemetry',
  );

  Future<Map<String, dynamic>> collectDeviceAndNetwork() async {
    Map<String, dynamic> native = const {};
    if (!kIsWeb && Platform.isAndroid) {
      try {
        final raw = await _channel.invokeMapMethod<String, dynamic>('getDeviceInfo');
        if (raw != null) {
          native = Map<String, dynamic>.from(raw);
        }
      } catch (_) {
        // Fallback aman ketika berjalan di widget test atau channel belum siap.
      }
    }

    String? localIp;
    if (!kIsWeb) {
      try {
        final interfaces = await NetworkInterface.list(
          includeLoopback: false,
          type: InternetAddressType.IPv4,
        );
        for (final iface in interfaces) {
          for (final addr in iface.addresses) {
            if (!addr.isLoopback && addr.address.trim().isNotEmpty) {
              localIp = addr.address.trim();
              break;
            }
          }
          if (localIp != null) break;
        }
      } catch (_) {
        // Interface jaringan opsional; server juga mencatat clientIp dari request.
      }
    }

    final fallbackPlatform = kIsWeb ? 'web' : Platform.operatingSystem;
    final fallbackOs = kIsWeb ? 'web' : Platform.operatingSystemVersion;

    return <String, dynamic>{
      'manufacturer': native['manufacturer']?.toString(),
      'brand': native['brand']?.toString(),
      'model': native['model']?.toString() ?? fallbackPlatform,
      'os_version': native['os_version']?.toString() ?? fallbackOs,
      'platform': native['platform']?.toString() ?? fallbackPlatform,
      'device_id': native['device_id']?.toString(),
      'is_physical_device': native['is_physical_device'] is bool
          ? native['is_physical_device'] as bool
          : null,
      'local_ip': localIp,
    };
  }

  Future<Position?> _refineWithStream({
    required LocationSettings settings,
    Position? initial,
  }) async {
    var best = initial;
    final completer = Completer<Position?>();
    StreamSubscription<Position>? sub;
    final timer = Timer(const Duration(seconds: 6), () async {
      await sub?.cancel();
      if (!completer.isCompleted) {
        completer.complete(best);
      }
    });

    try {
      sub = Geolocator.getPositionStream(locationSettings: settings).listen(
        (pos) async {
          if (best == null || pos.accuracy < best!.accuracy) {
            best = pos;
          }
          if (pos.accuracy <= 65.0) {
            timer.cancel();
            await sub?.cancel();
            if (!completer.isCompleted) {
              completer.complete(best);
            }
          }
        },
        onError: (_) async {
          timer.cancel();
          await sub?.cancel();
          if (!completer.isCompleted) {
            completer.complete(best);
          }
        },
      );
    } catch (_) {
      timer.cancel();
      if (!completer.isCompleted) {
        completer.complete(best);
      }
    }

    return completer.future;
  }

  Future<_GpsReading> _collectGps({required bool requestPermission}) async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied && requestPermission) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        return const _GpsReading();
      }

      final LocationSettings settings = !kIsWeb && Platform.isAndroid
          ? AndroidSettings(
              accuracy: LocationAccuracy.best,
              distanceFilter: 0,
              timeLimit: const Duration(seconds: 15),
            )
          : const LocationSettings(
              accuracy: LocationAccuracy.best,
              distanceFilter: 0,
              timeLimit: Duration(seconds: 15),
            );

      Position? bestPos;
      try {
        bestPos = await Geolocator.getCurrentPosition(locationSettings: settings);
      } catch (_) {
        bestPos = null;
      }

      if (bestPos == null || bestPos.accuracy > 100.0) {
        bestPos = await _refineWithStream(settings: settings, initial: bestPos);
      }

      if (bestPos == null) {
        final last = await Geolocator.getLastKnownPosition();
        if (last != null) {
          final age = DateTime.now().difference(last.timestamp);
          if (last.accuracy <= 200.0 && age <= const Duration(minutes: 5)) {
            bestPos = last;
          }
        }
      }

      if (bestPos == null) return const _GpsReading();
      return _GpsReading(
        latitude: bestPos.latitude,
        longitude: bestPos.longitude,
        accuracyMeters: bestPos.accuracy,
        isMocked: bestPos.isMocked,
      );
    } catch (_) {
      return const _GpsReading();
    }
  }

  Future<AttendanceTelemetrySnapshot> collectAll({
    required bool requestPermission,
  }) async {
    final results = await Future.wait<dynamic>([
      collectDeviceAndNetwork(),
      _collectGps(requestPermission: requestPermission),
    ]);
    final dev = results[0] as Map<String, dynamic>;
    final gps = results[1] as _GpsReading;

    return AttendanceTelemetrySnapshot(
      latitude: gps.latitude,
      longitude: gps.longitude,
      gpsAccuracyMeters: gps.accuracyMeters,
      isMockedGps: gps.isMocked,
      manufacturer: dev['manufacturer'] as String?,
      brand: dev['brand'] as String?,
      model: dev['model'] as String?,
      osVersion: dev['os_version'] as String?,
      platform: dev['platform'] as String?,
      deviceId: dev['device_id'] as String?,
      isPhysicalDevice: dev['is_physical_device'] as bool?,
      localIp: dev['local_ip'] as String?,
    );
  }
}
