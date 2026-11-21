import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import '../../firebase_options.dart';

/// Handler background wajib top-level.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

/// Adapter tipis di atas firebase_messaging. Tidak diunit-test (butuh platform channel).
class FcmAdapter {
  FcmAdapter._();

  static bool _initialized = false;

  static bool get isSupportedOnThisDevice {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  static Future<void> ensureInitialized() async {
    if (_initialized) return;
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    _initialized = true;
  }

  /// Minta izin dan ambil token FCM. Null berarti tidak tersedia atau izin ditolak.
  static Future<String?> requestToken() async {
    if (!isSupportedOnThisDevice) return null;
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      return null;
    }
    try {
      return await messaging.getToken();
    } catch (_) {
      return null;
    }
  }

  static Stream<String> get tokenStream => FirebaseMessaging.instance.onTokenRefresh;

  static Stream<RemoteMessage> get foregroundMessages => FirebaseMessaging.onMessage;
}
