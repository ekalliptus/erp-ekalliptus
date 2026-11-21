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
