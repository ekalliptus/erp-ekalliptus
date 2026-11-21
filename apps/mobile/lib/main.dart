import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'app.dart';
import 'core/notifications/fcm_adapter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('id_ID', null);
  try {
    await FcmAdapter.ensureInitialized();
  } catch (_) {
    // Perangkat tanpa layanan Firebase: notifikasi push mati, sisanya jalan.
  }

  runApp(
    const ProviderScope(
      child: EkalliptusErpApp(),
    ),
  );
}
