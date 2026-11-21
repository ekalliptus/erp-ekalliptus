import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_service.dart';
import '../network/api_client.dart';
import '../notifications/notification_models.dart';
import '../notifications/notification_registration.dart';
import '../offline/offline_queue_store.dart';
import '../rbac/rbac_state.dart';
import '../security/biometric_guard.dart';

final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

final authServiceProvider = Provider<AuthService>((ref) => AuthService());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(auth: ref.watch(authServiceProvider));
});

final biometricGuardProvider = Provider<BiometricGuard>((ref) => BiometricGuard());

final offlineQueueStoreProvider = Provider<OfflineQueueStore>((ref) {
  final store = DriftOfflineQueueStore();
  ref.onDispose(() => store.close());
  return store;
});

final offlineSyncServiceProvider = Provider<OfflineSyncService>((ref) {
  final store = ref.watch(offlineQueueStoreProvider);
  final api = ref.watch(apiClientProvider);
  return OfflineSyncService(
    store: store,
    sender: (method, endpoint, payload) => api.rawSend(method, endpoint, payload),
  );
});

final pendingOfflineCountProvider = FutureProvider<int>((ref) async {
  final store = ref.watch(offlineQueueStoreProvider);
  final list = await store.pendingItems();
  return list.length;
});

final sessionProfileProvider = FutureProvider<ErpProfile?>((ref) async {
  final auth = ref.watch(authServiceProvider);
  final snap = await auth.restoreSession();
  if (snap == null) return null;
  final api = ref.watch(apiClientProvider);
  return api.fetchMe();
});

final notificationRegistrationProvider = Provider<NotificationRegistrationService>((ref) {
  final api = ref.watch(apiClientProvider);
  return NotificationRegistrationService(
    onRegister: (token) => api.registerDeviceToken(token),
    onUnregister: (token) => api.unregisterDeviceToken(token),
  );
});

/// Hitungan notifikasi belum dibaca; disegarkan berkala dan manual.
final unreadNotificationsProvider =
    AsyncNotifierProvider<UnreadNotificationsController, int>(
        UnreadNotificationsController.new);

class UnreadNotificationsController extends AsyncNotifier<int> {
  Timer? _pollTimer;
  bool _disposed = false;

  @override
  Future<int> build() async {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (!_disposed) {
        ref.invalidateSelf();
      }
    });
    ref.onDispose(() {
      _pollTimer?.cancel();
      _disposed = true;
    });
    try {
      final api = ref.watch(apiClientProvider);
      return await api.fetchUnreadNotificationCount();
    } catch (_) {
      return 0;
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading<int>().copyWithPrevious(state);
    state = await AsyncValue.guard(() async {
      try {
        final api = ref.read(apiClientProvider);
        return await api.fetchUnreadNotificationCount();
      } catch (_) {
        return 0;
      }
    });
  }

  Future<List<NotificationEntry>> fetchEntries({int limit = 30}) async {
    final api = ref.read(apiClientProvider);
    return api.fetchNotifications(limit: limit);
  }

  Future<void> markAllRead() async {
    final api = ref.read(apiClientProvider);
    await api.markAllNotificationsRead();
    await refresh();
  }
}
