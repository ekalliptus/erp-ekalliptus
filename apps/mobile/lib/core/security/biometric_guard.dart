import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

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
}
