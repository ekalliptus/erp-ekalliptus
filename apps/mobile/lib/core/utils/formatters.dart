import 'dart:math' as math;
import 'package:intl/intl.dart';

final NumberFormat _idrFormat = NumberFormat.currency(
  locale: 'id_ID',
  symbol: 'Rp ',
  decimalDigits: 0,
);

String formatRupiah(Object? value) {
  if (value == null) return 'Rp 0';
  final parsed = BigInt.tryParse(value.toString().trim());
  if (parsed == null) return 'Rp 0';
  if (parsed.abs() <= BigInt.from(9007199254740991)) {
    return _idrFormat.format(parsed.toInt());
  }
  final str = parsed.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 == 0) buf.write('.');
    buf.write(str[i]);
  }
  return '${parsed.isNegative ? '-' : ''}Rp ${buf.toString()}';
}

/// Parses Rupiah integer input strictly (rejects decimals, negatives, and non-numeric strings).
int? parseRupiahInput(String raw) {
  var cleaned = raw.trim().replaceAll(RegExp(r'rp|\s', caseSensitive: false), '');
  if (cleaned.isEmpty || cleaned.contains('-')) return null;

  // Allow thousands separators like 150.000 or 150,000, but reject decimal fractions like 10.50.
  final partsByDot = cleaned.split('.');
  final partsByComma = cleaned.split(',');
  final hasThousandsDots = partsByDot.length > 1 &&
      partsByDot.skip(1).every((segment) => segment.length == 3 && RegExp(r'^\d{3}$').hasMatch(segment));
  final hasThousandsCommas = partsByComma.length > 1 &&
      partsByComma.skip(1).every((segment) => segment.length == 3 && RegExp(r'^\d{3}$').hasMatch(segment));

  if ((cleaned.contains('.') && !hasThousandsDots) || (cleaned.contains(',') && !hasThousandsCommas)) {
    return null;
  }

  cleaned = cleaned.replaceAll('.', '').replaceAll(',', '');
  if (!RegExp(r'^\d+$').hasMatch(cleaned)) return null;
  final value = int.tryParse(cleaned);
  if (value == null || value <= 0) return null;
  return value;
}

String formatShortDate(String? iso) {
  if (iso == null || iso.isEmpty) return '-';
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('dd MMM yyyy', 'id_ID').format(dt.toLocal());
}

String formatShortDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '-';
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  return DateFormat('dd MMM HH:mm', 'id_ID').format(dt.toLocal());
}

String formatRelativeTimeId(DateTime dt, {DateTime? now}) {
  final local = dt.toLocal();
  final refNow = (now ?? DateTime.now()).toLocal();
  final diff = refNow.difference(local);
  if (diff.isNegative || diff.inMinutes < 1) return 'Baru saja';
  if (diff.inMinutes < 60) return '${diff.inMinutes} mnt lalu';
  if (diff.inHours < 24) return '${diff.inHours} jam lalu';
  return DateFormat('dd MMM HH:mm', 'id_ID').format(local);
}

String formatDistanceId(double meters) {
  if (meters < 1000) return '${meters.round()} m';
  return '${(meters / 1000).toStringAsFixed(2)} km';
}

double calculateDistanceMeters({
  required double lat1,
  required double lng1,
  required double lat2,
  required double lng2,
}) {
  const earthRadiusMeters = 6371000.0;
  double toRad(double deg) => deg * (math.pi / 180.0);
  final dLat = toRad(lat2 - lat1);
  final dLng = toRad(lng2 - lng1);
  final a = math.pow(math.sin(dLat / 2), 2) +
      math.cos(toRad(lat1)) * math.cos(toRad(lat2)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * earthRadiusMeters * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

String formatPlatformLabel(String? platform) {
  final normalized = (platform ?? '').trim().toLowerCase();
  if (normalized == 'flutter' || normalized == 'android') return 'ANDROID';
  if (normalized == 'web') return 'WEB';
  if (normalized == 'system') return 'SYSTEM';
  return normalized.isEmpty ? '-' : normalized.toUpperCase();
}
