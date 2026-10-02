import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

class Api {
  Api({required this.baseUrl});
  final String baseUrl;
  String? token;

  Map<String, String> _headers() => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer ${token!}',
      };

  Future<dynamic> get(String path) async =>
      _run(await http.get(Uri.parse('$baseUrl$path'), headers: _headers()));
  Future<dynamic> post(String path, Object? body) async => _run(
      await http.post(Uri.parse('$baseUrl$path'), headers: _headers(), body: jsonEncode(body)));
  Future<dynamic> patch(String path, Object? body) async => _run(
      await http.patch(Uri.parse('$baseUrl$path'), headers: _headers(), body: jsonEncode(body)));

  dynamic _run(http.Response response) {
    final data = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode == 401 && token != null) {
      throw ApiException('Sesi berakhir. Masuk kembali.');
    }
    if (response.statusCode >= 300) {
      final message = data is Map && data['message'] is String
          ? data['message'] as String
          : 'Permintaan gagal (${response.statusCode}).';
      throw ApiException(_translate(message));
    }
    return data;
  }
}

const _translations = {
  'Invalid credentials': 'Email atau kata sandi salah.',
  'Invalid repair state transition': 'Perpindahan tahap tidak sesuai alur servis.',
  'Quotation is locked outside diagnosis': 'Kuotasi hanya dapat diubah saat inspeksi atau diagnosis.',
  'Quotation required': 'Tetapkan kuotasi jasa sebelum tahap ini.',
  'Repair invoice already issued': 'Tagihan servis sudah diterbitkan untuk tiket ini.',
  'Overpayment rejected': 'Pembayaran melebihi sisa tagihan.',
  'Invalid data or conflicting reference': 'Data tidak valid atau bertentangan dengan catatan lain.',
  'Duplicate record or reference': 'Catatan sudah ada atau referensi ganda.',
};

String _translate(String raw) => _translations[raw] ?? raw;

String rupiah(String decimal) {
  final clean = decimal.replaceAll(RegExp(r'[^0-9.]'), '');
  if (clean.isEmpty) return 'Rp 0';
  final whole = clean.split('.').first;
  final buffer = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    final left = whole.length - i;
    buffer.write(whole[i]);
    if (left > 1 && left % 3 == 1) buffer.write('.');
  }
  return 'Rp $buffer';
}

const defaultApiBase =
    String.fromEnvironment('NEXUS_API', defaultValue: 'http://10.0.2.2:3100/api/v1');
