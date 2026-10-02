import 'package:flutter/material.dart';
import '../api.dart';
import 'queue_screen.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _base = TextEditingController(text: defaultApiBase);
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _base.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    final api = Api(baseUrl: _base.text.trim().replaceAll(RegExp(r'/+$'), ''));
    try {
      final data = await api.post('/auth/login', {'email': _email.text.trim(), 'password': _password.text});
      api.token = data['token'] as String?;
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => QueuePage(api: api, user: data['user']?['fullName'] as String? ?? 'Teknisi', role: data['user']?['role'] as String? ?? '')));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _error = e.message; _busy = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _error = 'Server tidak dapat dihubungi. Periksa alamat dan koneksi WiFi.'; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Form(
                key: _formKey,
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(color: const Color(0xFF153E33), borderRadius: BorderRadius.circular(24)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      ClipRRect(borderRadius: BorderRadius.circular(14), child: Image.asset('assets/logo.png', width: 72, height: 72, fit: BoxFit.contain)),
                      SizedBox(height: 22),
                      Text('MyEkalliptus', style: TextStyle(color: Colors.white, fontSize: 27, fontWeight: FontWeight.w700)),
                      SizedBox(height: 8),
                      Text('Perangkat terawat.\nPekerjaan tercatat.', style: TextStyle(color: Color(0xFFC0D4C8), fontSize: 18, height: 1.5)),
                    ]),
                  ),
                  const SizedBox(height: 30),
                  const Text('Masuk ke ruang servis', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  const Text('Lanjutkan pekerjaan dengan akun staf Anda.'),
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                    validator: (v) => (v == null || !v.contains('@')) ? 'Email tidak valid.' : null,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _password,
                    obscureText: _obscure,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(labelText: 'Kata sandi', prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(tooltip: _obscure ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi', onPressed: () => setState(() => _obscure = !_obscure), icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined))),
                    validator: (v) => (v == null || v.isEmpty) ? 'Kata sandi wajib diisi.' : null,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(_error!, style: const TextStyle(color: Color(0xFFA72D35))),
                  ],
                  const SizedBox(height: 22),
                  FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Memeriksa…' : 'Masuk')),
                  const SizedBox(height: 14),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    leading: const Icon(Icons.dns_outlined),
                    title: const Text('Koneksi server', style: TextStyle(fontSize: 14)),
                    children: [TextFormField(
                      controller: _base,
                      keyboardType: TextInputType.url,
                      decoration: const InputDecoration(labelText: 'Alamat server', helperText: 'Gunakan alamat server operasional pada jaringan WiFi Anda.'),
                      validator: (v) {
                        final uri = Uri.tryParse(v?.trim() ?? '');
                        return uri == null || !['http', 'https'].contains(uri.scheme) || uri.host.isEmpty ? 'Isi alamat server http(s) yang valid.' : null;
                      },
                    ), const SizedBox(height: 16)],
                  ),
                  const Text('Akses terbatas untuk staf. Hubungi administrator untuk akun baru.', style: TextStyle(fontSize: 12, color: Color(0xFF61756C))),
                ]),
              ),
            ),
          ),
        ),
      );
}
