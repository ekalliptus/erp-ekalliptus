import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

enum BiometricCapability {
  fingerprint,
  face,
  strongBiometric,
  deviceCredentialOnly,
  unavailable,
}

class AttendanceAuthResult {
  final bool verified;
  final bool needsCameraFaceFallback;
  final String methodLabel;
  final String? message;

  const AttendanceAuthResult({
    required this.verified,
    required this.needsCameraFaceFallback,
    required this.methodLabel,
    this.message,
  });
}

class BiometricGuard {
  final LocalAuthentication _auth;

  BiometricGuard({LocalAuthentication? auth}) : _auth = auth ?? LocalAuthentication();

  Future<bool> verifySensitiveAccess({
    required String reason,
  }) async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      if (!supported && !canCheck) {
        return true;
      }
      final enrolled = await _auth.getAvailableBiometrics();
      if (enrolled.isEmpty) {
        return true;
      }
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: false,
        ),
      );
    } on PlatformException {
      return false;
    }
  }

  Future<BiometricCapability> inspectCapability() async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      if (!supported && !canCheck) {
        return BiometricCapability.unavailable;
      }
      final enrolled = await _auth.getAvailableBiometrics();
      if (enrolled.isEmpty) {
        return supported
            ? BiometricCapability.deviceCredentialOnly
            : BiometricCapability.unavailable;
      }
      if (enrolled.contains(BiometricType.fingerprint) &&
          enrolled.contains(BiometricType.face)) {
        return BiometricCapability.strongBiometric;
      }
      if (enrolled.contains(BiometricType.fingerprint)) {
        return BiometricCapability.fingerprint;
      }
      if (enrolled.contains(BiometricType.face)) {
        return BiometricCapability.face;
      }
      return BiometricCapability.strongBiometric;
    } on PlatformException {
      return BiometricCapability.unavailable;
    }
  }

  Future<AttendanceAuthResult> authenticateForAttendance({
    required String reason,
  }) async {
    try {
      final capability = await inspectCapability();
      if (capability == BiometricCapability.unavailable ||
          capability == BiometricCapability.deviceCredentialOnly) {
        return const AttendanceAuthResult(
          verified: false,
          needsCameraFaceFallback: true,
          methodLabel: 'camera_face_fallback',
          message: 'Sensor biometrik belum terdaftar; beralih ke scan wajah kamera.',
        );
      }

      final ok = await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );

      final label = switch (capability) {
        BiometricCapability.fingerprint => 'fingerprint',
        BiometricCapability.face => 'face_unlock',
        BiometricCapability.strongBiometric => 'biometric_os',
        BiometricCapability.deviceCredentialOnly ||
        BiometricCapability.unavailable =>
          'camera_face_fallback',
      };

      return AttendanceAuthResult(
        verified: ok,
        needsCameraFaceFallback: false,
        methodLabel: label,
        message: ok ? null : 'Verifikasi sidik jari/wajah dibatalkan.',
      );
    } on PlatformException catch (err) {
      if (err.code == 'NotAvailable' ||
          err.code == 'NotEnrolled' ||
          err.code == 'PasscodeNotSet') {
        return AttendanceAuthResult(
          verified: false,
          needsCameraFaceFallback: true,
          methodLabel: 'camera_face_fallback',
          message: err.message,
        );
      }
      return AttendanceAuthResult(
        verified: false,
        needsCameraFaceFallback: false,
        methodLabel: 'biometric_error',
        message: err.message ?? 'Verifikasi biometrik gagal.',
      );
    }
  }
}
