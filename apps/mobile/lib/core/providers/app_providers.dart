import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/auth_service.dart';
import '../network/api_client.dart';
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
