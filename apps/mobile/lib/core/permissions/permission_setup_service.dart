import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import '../security/biometric_guard.dart';

enum AppPermissionStatus {
  granted,
  denied,
  permanentlyDenied,
  unavailable,
}

class PermissionSummary {
  final AppPermissionStatus location;
  final bool preciseLocation;
  final bool locationServiceEnabled;
  final AppPermissionStatus camera;
  final AppPermissionStatus notifications;
  final BiometricCapability biometric;

  const PermissionSummary({
    required this.location,
    this.preciseLocation = true,
    required this.locationServiceEnabled,
    required this.camera,
    required this.notifications,
    required this.biometric,
  });

  bool get biometricReady =>
      biometric == BiometricCapability.fingerprint ||
      biometric == BiometricCapability.face ||
      biometric == BiometricCapability.strongBiometric;

  int get readyCount {
    var count = 0;
    if (location == AppPermissionStatus.granted && preciseLocation && locationServiceEnabled) {
      count++;
    }
    if (camera == AppPermissionStatus.granted) count++;
    if (notifications == AppPermissionStatus.granted) count++;
    if (biometricReady) count++;
    return count;
  }

  bool get allEssentialGranted =>
      location == AppPermissionStatus.granted &&
      preciseLocation &&
      camera == AppPermissionStatus.granted &&
      notifications == AppPermissionStatus.granted;
}

class PermissionSetupService {
  static const MethodChannel _channel = MethodChannel(
    'com.ekalliptus.myekalliptus/permissions',
  );
  static const String _onboardingKey = 'myekalliptus_permission_setup_done_v1';

  final BiometricGuard _biometricGuard;
  final FlutterSecureStorage _storage;

  PermissionSetupService({
    BiometricGuard? biometricGuard,
    FlutterSecureStorage? storage,
  })  : _biometricGuard = biometricGuard ?? BiometricGuard(),
        _storage = storage ?? const FlutterSecureStorage();

  Future<bool> hasCompletedOnboarding() async {
    try {
      final raw = await _storage.read(key: _onboardingKey);
      return raw == '1';
    } catch (_) {
      return false;
    }
  }

  Future<void> markOnboardingCompleted() async {
    try {
      await _storage.write(key: _onboardingKey, value: '1');
    } catch (_) {
      // Aman diabaikan saat storage terenkripsi tidak tersedia di widget test.
    }
  }

  Future<PermissionSummary> inspectAll() async {
    Map<String, String> nativeMap = const {};
    if (!kIsWeb && Platform.isAndroid) {
      try {
        final raw = await _channel.invokeMapMethod<String, dynamic>('checkPermissions');
        if (raw != null) {
          nativeMap = raw.map((k, v) => MapEntry(k, v.toString()));
        }
      } catch (_) {
        nativeMap = const {};
      }
    }
    return _composeSummary(nativeMap);
  }

  Future<PermissionSummary> requestLocation() => _requestKeys(const ['location']);

  Future<PermissionSummary> requestCamera() => _requestKeys(const ['camera']);

  Future<PermissionSummary> requestNotifications() => _requestKeys(const ['notifications']);

  Future<PermissionSummary> requestAllEssential() =>
      _requestKeys(const ['location', 'camera', 'notifications']);

  Future<PermissionSummary> _requestKeys(List<String> keys) async {
    Map<String, String> nativeMap = const {};
    if (!kIsWeb && Platform.isAndroid) {
      try {
        final raw = await _channel.invokeMapMethod<String, dynamic>(
          'requestPermissions',
          {'permissions': keys},
        );
        if (raw != null) {
          nativeMap = raw.map((k, v) => MapEntry(k, v.toString()));
          return await _composeSummary(nativeMap);
        }
      } catch (_) {
        // Lanjut ke fallback geolocator bila perlu.
      }
    }

    if (keys.contains('location')) {
      try {
        await Geolocator.requestPermission();
      } catch (_) {}
    }
    return inspectAll();
  }

  Future<void> openAppSettings() async {
    if (!kIsWeb && Platform.isAndroid) {
      try {
        await _channel.invokeMethod<bool>('openAppSettings');
        return;
      } catch (_) {}
    }
    try {
      await Geolocator.openAppSettings();
    } catch (_) {}
  }

  Future<void> openLocationSettings() async {
    if (!kIsWeb && Platform.isAndroid) {
      try {
        await _channel.invokeMethod<bool>('openLocationSettings');
        return;
      } catch (_) {}
    }
    try {
      await Geolocator.openLocationSettings();
    } catch (_) {}
  }

  Future<void> openBiometricSettings() async {
    if (!kIsWeb && Platform.isAndroid) {
      try {
        await _channel.invokeMethod<bool>('openBiometricSettings');
        return;
      } catch (_) {}
    }
    await openAppSettings();
  }

  Future<PermissionSummary> _composeSummary(Map<String, String> nativeMap) async {
    var locationServiceEnabled = true;
    try {
      locationServiceEnabled = await Geolocator.isLocationServiceEnabled();
    } catch (_) {
      locationServiceEnabled = true;
    }

    AppPermissionStatus locationStatus = _parseStatus(nativeMap['location']);
    if (!nativeMap.containsKey('location')) {
      try {
        final geoPerm = await Geolocator.checkPermission();
        locationStatus = switch (geoPerm) {
          LocationPermission.always || LocationPermission.whileInUse => AppPermissionStatus.granted,
          LocationPermission.deniedForever => AppPermissionStatus.permanentlyDenied,
          LocationPermission.denied || LocationPermission.unableToDetermine => AppPermissionStatus.denied,
        };
      } catch (_) {
        locationStatus = AppPermissionStatus.unavailable;
      }
    }

    final preciseLocation = nativeMap.containsKey('preciseLocation')
        ? nativeMap['preciseLocation'] == 'granted'
        : true;
    final cameraStatus = nativeMap.containsKey('camera')
        ? _parseStatus(nativeMap['camera'])
        : AppPermissionStatus.unavailable;
    final notificationsStatus = nativeMap.containsKey('notifications')
        ? _parseStatus(nativeMap['notifications'])
        : AppPermissionStatus.unavailable;

    final biometric = await _biometricGuard.inspectCapability();

    return PermissionSummary(
      location: locationStatus,
      preciseLocation: preciseLocation,
      locationServiceEnabled: locationServiceEnabled,
      camera: cameraStatus,
      notifications: notificationsStatus,
      biometric: biometric,
    );
  }

  AppPermissionStatus _parseStatus(String? raw) {
    switch (raw) {
      case 'granted':
        return AppPermissionStatus.granted;
      case 'permanentlyDenied':
        return AppPermissionStatus.permanentlyDenied;
      case 'denied':
        return AppPermissionStatus.denied;
      default:
        return AppPermissionStatus.unavailable;
    }
  }
}
