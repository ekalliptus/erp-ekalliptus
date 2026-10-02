# MyEkalliptus

Fondasi ERP lokal tiga jalur: POS retail, servis, proyek agensi. **Bukan implementasi penuh blueprint, bukan siap produksi.** Batas desain dan koreksi skema: [docs/BLUEPRINT-NOTES.md](docs/BLUEPRINT-NOTES.md). Kontrak HTTP: [backend/API.md](backend/API.md).

## Struktur repositori

```
apps/web/            Antarmuka web (Next.js) — kasir, inventori, servis, proyek, tagihan, buku besar
apps/mobile-teknisi/ Aplikasi teknisi (Flutter, Android)
backend/             API (TypeScript) — aturan bisnis, migrasi, jurnal
infra/               Skrip run lokal, seed demo, verifikasi integrasi, Dockerfile, Caddyfile
docs/                Catatan desain dan batasan blueprint
.data/               Data runtime lokal (PostgreSQL embedded, artefak uji) — gitignored
```

Backend adalah sumber kebenaran aturan bisnis; web dan Flutter hanya klien API yang sama.

## Jalankan lokal

Prasyarat Node.js 22+, npm, PostgreSQL 16+ (17 direkomendasikan).

### Cara cepat: satu perintah (PostgreSQL embedded, tanpa install database)

1. `npm run setup` (sekali, mengunduh dependensi).
2. `npm run local:up` — menyalakan PostgreSQL persisten di `.data/postgres`, menerapkan migrasi, membuat akun admin (kredensial dihasilkan otomatis dan disimpan di `.env`), lalu menjalankan backend (loopback) dan frontend (bind WiFi/LAN). Biarkan terminal berjalan.
3. Akses:
   - Web di PC ini: `http://localhost:3100`.
   - Web dari HP/perangkat lain di WiFi yang sama: `http://<IP-LAN-PC>:3100` (alamat tercetak saat start, mis. `http://192.168.1.76:3100`). Jika tidak terjangkau, izinkan port 3100 di Windows Firewall (perlu admin): `netsh advfirewall firewall add rule name="MyEkalliptus Web 3100" dir=in action=allow protocol=TCP localport=3100 profile=private`.
   - Semua lalu lintas API melewati proxy frontend yang sama, jadi backend tidak perlu dibuka ke jaringan.
4. `npm run local:down` (dari terminal lain) menghentikan semuanya. Data tetap tersimpan di `.data/postgres` untuk run berikutnya. `.env` berisi kredensial admin — jangan dibagikan atau di-commit.

### Akun dummy untuk uji coba

`npm run seed:demo` membuat lima akun contoh (satu per peran) di database yang sedang berjalan. Kata sandi bawaan `DemoMyEkalliptus2026` dapat diganti lewat variabel `DEMO_PASSWORD`. **Kredensial ini diketahui publik dan hanya untuk uji coba lokal — jangan pernah dijalankan di server produksi.**

| Email | Peran | Akses utama |
| :--- | :--- | :--- |
| `owner@myekalliptus.test` | superadmin | Semua menu termasuk inventori, stok, dan buku besar |
| `finance@myekalliptus.test` | finance_admin | Dashboard, tagihan, pembayaran, buku besar |
| `kasir@myekalliptus.test` | cashier | Kasir/POS, pelanggan, tiket servis, tagihan |
| `teknisi@myekalliptus.test` | hardware_tech | Tiket servis: kuotasi, bukti, perubahan tahap |
| `dev@myekalliptus.test` | software_dev | Proyek agensi dan milestone |

Semua memakai kata sandi yang sama. Menjalankan `seed:demo` lagi tidak mengubah akun yang sudah ada; hapus manual di database bila perlu direset.

### Cara manual (PostgreSQL sendiri)

1. `npm ci` lalu `npm run setup`.
2. Salin `.env.example` ke `.env`. Isi `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` minimal 12 karakter. Tidak tersedia password bawaan. Buat database PostgreSQL kosong terlebih dahulu.
3. Ekspor variabel `.env` ke lingkungan shell; skrip backend tidak otomatis membaca berkas ini. Jalankan `npm run db:migrate`, `npm run db:seed`; opsional `npm run db:sample` untuk katalog contoh.
4. Dua terminal dengan lingkungan sama: `npm run dev:backend` dan `npm run dev:frontend`.
5. Buka `http://localhost:3100`; API `http://localhost:3000/api/v1`. Masuk menggunakan admin yang dibuat sendiri.

`BACKEND_URL` mengatur proxy Next.js; gunakan `http://127.0.0.1:3000` lokal. Setelah mengubahnya, restart/build ulang frontend. `npm run build` membangun kedua aplikasi. `.env` dan data sementara tidak boleh masuk Git.

## Aplikasi mobile teknisi (Flutter)

Proyek Flutter berada di `apps/mobile-teknisi` (Android). Fitur: masuk dengan akun staf, daftar tiket servis, terima perangkat baru, dan ubah tahap servis lengkap dengan bukti intake/persetujuan/QC serta kuotasi jasa. Semua data dari API yang sama.

1. Prasyarat: Flutter SDK 3.x dengan Android toolchain (`flutter doctor`).
2. Jalankan lokal seperti di atas (`npm run local:up`).
3. `flutter pub get` di `apps/mobile-teknisi`, lalu `flutter run` — pilih emulator atau perangkat Android. ID aplikasi Android: `id.myekalliptus.teknisi`.
   - Emulator Android memakai alamat server bawaan `http://10.0.2.2:3100/api/v1` (alias host).
   - HP fisik di WiFi yang sama: isi "Alamat server" di layar masuk dengan `http://<IP-LAN-PC>:3100/api/v1`.
   - Bangun APK: `flutter build apk --debug` (hasil di `build/app/outputs/flutter-apk/`).
4. Build Windows desktop belum didukung host ini (Visual Studio C++ tidak terpasang).

## Docker Compose

Docker tidak tersedia pada host pengembangan ini; konfigurasi container **belum diuji runtime**.

1. Instal Docker sendiri pada lingkungan tujuan, salin `.env.example`, isi password PostgreSQL dan admin.
2. Sesuaikan `DATABASE_URL` untuk lokal dan `COMPOSE_DATABASE_URL` dengan hostname `postgres`; password pada URL wajib di-URL-encode. Samakan nama database/user/password dengan `POSTGRES_*`.
3. `npm run compose:up`; buka `http://localhost:8080`.
4. `npm run compose:down` menghentikan layanan tanpa menghapus volume. Jangan memakai `down -v` kecuali sengaja menghapus data.

Compose menyediakan PostgreSQL 17, NestJS, Next.js, Caddy. API menjalankan migrasi dan bootstrap admin saat start; katalog contoh tidak otomatis dimasukkan. Port hanya dipublikasikan ke loopback. HTTP lokal bukan TLS produksi. Untuk produksi, pisahkan pemilik migrasi dari role DB aplikasi, lepas kredensial bootstrap dari runtime, konfigurasi domain/TLS/port/firewall, rate limiting, pengelolaan rahasia, monitoring, backup dan uji pemulihan. Volume persisten **bukan backup**.

## Verifikasi

- `npm test`: uji logika backend dan perhitungan uang frontend.
- `npm run build`: kompilasi backend dan build frontend.
- `npm run test:integration`: PostgreSQL sementara dari dependency pengembangan `embedded-postgres`, tanpa Docker atau instalasi sistem. Build backend dahulu. Cluster/akun menggunakan port serta password acak; tidak menyentuh database `.env`. Perlu binary sesuai OS yang diunduh npm; pada npm dengan persetujuan skrip, setujui paket `@embedded-postgres/<platform>` yang relevan.
- Runner menjalankan uji DB backend, lalu login, penolakan anonim, checkout bersamaan, rollback stok/order/jurnal, pembayaran parsial/idempotensi/overpayment bersamaan, keseimbangan jurnal, logout dan provider belum tersedia. Kegagalan menghasilkan exit nonzero.
- `KEEP_TEST_SERVICES=1 TEST_API_PORT=3000 npm run test:integration` mempertahankan layanan sementara untuk uji GUI. Kredensial hanya disimpan di berkas sementara lokal; hentikan proses setelah selesai. Jangan bagikan berkas tersebut. Direktori cluster sementara dipertahankan untuk diagnosis, dapat dihapus setelah proses berhenti.

## Status dan batas

**Diimplementasikan dalam kode:** autentikasi sesi server/RBAC, pelanggan, katalog/stok, checkout kasir atomik, jurnal berpasangan, invoice/pembayaran manual, tiket servis/FSM lengkap dengan kuotasi jasa, bukti intake/persetujuan/QC, tagihan servis otomatis saat siap diambil, dan penutupan wajib lunas; proyek/milestone, dashboard, antarmuka desktop responsif; mode run lokal satu perintah dengan PostgreSQL embedded; aplikasi teknisi Flutter (Android) untuk tiket servis. Ketersediaan fitur bukan bukti lolos semua skenario produksi; hasil verifikasi aktual dilaporkan saat eksekusi, tidak diasumsikan dari konfigurasi.

**Ditunda/tidak diklaim:** integrasi nyata PPOB/Digiflazz, QRIS/payment gateway, WhatsApp, antrean Redis/BullMQ, S3/unggah foto, sinkronisasi offline/PWA transaksi, printer ESC/POS/WebUSB, multi-gudang, pajak/refund, pemakaian suku cadang servis terintegrasi dan persetujuan terverifikasi eksternal, kontrak digital/portal klien, penjadwalan, backup otomatis teruji, replikasi/HA, pemantauan produksi, SLA latensi dan audit keamanan independen. Aplikasi Flutter masih dasar (tanpa notifikasi, unggah foto, atau mode offline). Provider belum dikonfigurasi harus ditampilkan tidak tersedia, bukan sukses simulasi.
