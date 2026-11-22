# Lanjutin Sesi: MyEkalliptus ERP (untuk Antigravity)

Dokumen ini khusus untuk melanjutkan kerja di **Antigravity** pada workspace `C:\dev\erp-ekalliptus`. Detail arsitektur lengkap ada di `zcode-erp.md` di root repo: **baca itu dulu**, lalu baca dokumen ini supaya tahu posisi terakhir sesi ZCode (21-22 Nov 2026) dan apa yang tersisa.

## 1. Posisi terakhir (semua sudah terpush ke origin/main, hingga commit `8c4478b`)

| Hal | Status |
| --- | --- |
| Produksi web | **https://my.ekalliptus.com** (Cloudflare Pages `myekalliptus`, custom domain `active`) + alias `myekalliptus.pages.dev` |
| Backend | Neon Functions `erpapi` (Hono) di `https://br-odd-frog-aoghf6vq-erpapi.compute.c-2.ap-southeast-1.aws.neon.tech` |
| Notifikasi FCM | AKTIF: service account di `.secrets/myekalliptus-firebase-adminsdk-fbsvc-9e03407fc0.json` (di luar git), VAPID di `.env.local` sebagai `VITE_FCM_VAPID_KEY`; health `notifications_configured: true` |
| Login | Email **atau** username (`employees.username`, lookup publik rate-limited); aktivasi karyawan pakai **kode aktivasi sekali pakai** dari owner/HR (auto-link email sudah DIHAPUS karena lubang pembajakan) |
| Keamanan | presign-download ber-ACL (selfie/receipt/avatar = pemilik; slips = `payroll:view`; invoices = `finance:view`; product = `inventory:view`); CORS allowlist; rate limit claim 5/menit + lookup 10/menit (per instance, best-effort) |
| Owner | `alul@ekalliptus.com` (kode `EK-001`) **SUDAH TERKLAIM** lewat jalur lama sebelum auto-link dihapus; diasumsikan sah |
| E2E | `npm run verify:e2e` = 15 PASS (Postgres ACID, Auth/RBAC, Storage, Realtime, Notifications, Username, Claim) |
| Situs publik | `ekalliptus.com` (repo `C:\dev\ekalliptus-web`): dialog konsultasi sudah jadi **builder pesan WhatsApp** (7 bahasa); admin lama (`ekalliptus-admin`) sudah diarsipkan offline |

## 2. Aturan wajib proyek (sama dengan zcode-erp.md section 1)

1. Nominal uang: `BIGINT` Rupiah bulat di PostgreSQL, Zod, backend, formatter web/Flutter. Dilarang float.
2. Mutasi saldo/stok/gaji wajib di `db.transaction(...)` dengan row lock `.for('update')`; audit trail (actor, platform, module, action, before/after) wajib.
3. Dilarang karakter em dash di kode, UI copy, dan komentar.
4. Jangan pernah menulis nilai rahasia `.env.local` atau isi `.secrets/` ke dokumen/kode klien.
5. Selesai = terverifikasi: `npm run build` (root) + `flutter analyze` & `flutter test` di `apps/mobile` + `npm run verify:e2e`. Laporan dengan bukti output, bukan klaim.

## 3. Keanehan lingkungan host ini (pelajarannya sudah dibayar, jangan diulang)

- Windows + Git Bash; PATH custom. Awali shell dengan:
  `$env:PATH` (PowerShell) atau export PATH Git Bash berisi: `C:\Users\ekalliptus\bin;C:\Users\ekalliptus\AppData\Roaming\npm;C:\dev\flutter\bin;C:\dev\tools\git\cmd;C:\Users\ekalliptus\.bun\bin;C:\Users\ekalliptus\AppData\Local\Android\Sdk\platform-tools`
- `git safe.directory` untuk `C:/dev/erp-ekalliptus` dan `C:/dev/ekalliptus-web` SUDAH di-whitelist di config global.
- `npm run db:push` (drizzle-kit) sering minta jawaban interaktif di non-TTY (drift hantu `finance_categories_name_kind_uq`). Jangan berjuang di situ: terapkan perubahan skema baru via SQL langsung pakai `node --env-file=.env.local -e "..."` dan `pg.Pool` ke `DATABASE_URL_UNPOOLED`.
- Menulis file panjang dalam satu langkah rawan hasil terdegradasi (noise/placeholder menyusup). Protokol yang terbukti: tulis potongan kecil (10-30 baris) lewat heredoc Bash, setiap potongan langsung `grep -c "placeholder\|mintok"` dan sed bersihkan sebelum lanjut.
- Token OAuth wrangler (akun CF `ekalliptus@gmail.com`) TIDAK punya scope DNS records: record DNS harus dibuat user di dashboard atau pakai token terpisah. Baca token dari `%APPDATA%\xdg.config\.wrangler\config\default.toml` tanpa pernah mencetaknya.
- Konflik domain Pages error 8000018 ("already added") padahal GET bilang tidak ada = domain nyangkut di proyek Pages lain; probe per proyek, lalu DELETE dari sana.

## 4. Pelajaran teknis backend/Neon (dari bug yang benar-benar terjadi)

- Di Hono, route yang butuh `c.get('auth')` HARUS terdaftar SETELAH `app.use('/api/*', apiAuth)`; route sebelum guard tidak dapat auth context dan meledak 500. Endpoint publik pra-login masuk skip list di wrapper tersebut.
- Drizzle membungkus error Postgres: kode `23505` kadang ada di `err.cause.code`, cek keduanya.
- Deploy Neon Functions punya delay propagasi beberapa detik: E2E yang dijalankan langsung setelah `npm run deploy:neon` bisa kena versi lama. Beri jeda ~20 detik.
- Halaman web itu CSR: `curl` hanya melihat HTML kosong; verifikasi konten lewat browser (skill browser-use) atau `curl` aset JS/CSS.
- `grep | head` selalu exit 0; jangan pakai pipeline itu sebagai kondisi `||`.

## 5. Backlog tersisa (urutan saran)

1. Uji runtime penuh notifikasi: login owner di `my.ekalliptus.com`, aktifkan izin push, picu mutasi dari akun lain (aktor tidak menerima notifikasi atas aksinya sendiri), verifikasi bel + push browser; rebuild APK debug ke emulator untuk FCM Android.
2. Release signing Android (`key.properties`) + uji perangkat fisik (kamera, GPS, biometrik, scanner).
3. Rate limit global via proxy (sekarang per-instance), kebijakan sandi/magic-link Neon Auth, dan uji penetrasi ulang sebelum dibuka ke pengguna luas.
4. Modul baru (POS/Kasir, Ticketing) lewat pola plugin `ErpModulePlugin` (zcode-erp.md section 6.5).
5. SMTP email transaksional (invoice/slip gaji) kalau dibutuhkan; PPOB belum diimplementasi sama sekali.
6. Opsional: hapus endpoint `/api/consult*` yang sudah tak dipakai UI di situs publik; sisa 1 file `legacy` terkunci ACL (hapus via shell elevated).

## 6. Perintah penting

```bash
npm run build        # tokens:sync + tsc db/contracts/api + vite build web
npm run deploy:neon  # deploy functions (jeda 20 dtk sebelum verify)
npm run verify:e2e   # 15 PASS end-to-end
npm run db:seed      # bootstrap; mencetak kode aktivasi owner sekali bila perlu
cd apps/mobile && flutter analyze && flutter test && flutter run -d emulator-5554
npx wrangler@latest pages deploy apps/web/dist --project-name=myekalliptus --branch=main
```

## 7. Prompt siap pakai untuk Antigravity

```text
Baca dua file ini sebagai konteks penuh sebelum bekerja:
1. C:\dev\erp-ekalliptus\zcode-erp.md  (arsitektur, infra Neon, aturan teknis)
2. C:\dev\erp-ekalliptus\lanjutin-sesi.md  (posisi terakhir sesi, keanehan host, backlog)
Patuhi aturan BIGINT/ACID/audit, larangan em dash, dan protokol verifikasi.
Kerjakan tugas berikut secara terstruktur, verifikasi dengan build + test + verify:e2e,
laporkan dengan bukti output (tanpa simulasi sukses):
[TULISKAN TARGET DI SINI]
```
