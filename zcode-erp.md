# MyEkalliptus ERP: Dokumen Handoff & Panduan Lanjutan ZCode

Dokumen ini merangkum seluruh arsitektur, infrastruktur Neon, perubahan UI/UX terbaru, status verifikasi, dan langkah lanjutan untuk meneruskan pengembangan ekosistem **MyEkalliptus** menggunakan ZCode di workspace `c:\dev\erp-ekalliptus`.

---

## 1. Identitas & Ringkasan Proyek

- **Nama Produk**: **MyEkalliptus** (Web Command Center + Flutter Native App)
- **Workspace Utama**: `c:\dev\erp-ekalliptus` (monorepo npm + Flutter)
- **Workspace Terkait (Sudah Dimigrasi)**: `c:\dev\ekalliptus-web` (identitas email resmi sudah diseragamkan ke `alul@ekalliptus.com` di 27 file, `0` email lama, 59/59 test lulus)
- **Sistem Desain**: **Eucalyptus Precision** (`packages/tokens/design-tokens.json`, gaya Neo-Swiss Precision Bento, border 1px, tanpa template generik biru/ungu)
- **Identitas & Android App**:
  - Owner seed DB: `alul@ekalliptus.com` (role `owner`)
  - Android `applicationId`: `com.ekalliptus.myekalliptus`
  - Android label: `MyEkalliptus` (`minSdk = 24`)

### Aturan Teknis & Gaya Wajib Dipertahankan
1. **Nominal Uang**: Wajib `BIGINT` Rupiah bulat pada PostgreSQL, backend, kontrak Zod, dan formatter Web/Flutter (dilarang memakai floating point untuk nominal transaksi).
2. **Transaksi ACID**: Seluruh mutasi saldo kas (`finance`), pergerakan stok (`inventory`), dan pencairan gaji (`payroll`) wajib berjalan di dalam database transaction (`db.transaction(...)`).
3. **Audit Trail Immutable**: Setiap aksi mutasi mencatat `actor_id`, `platform` (`web` / `flutter` / `system`), `module`, `action`, `before_data`, dan `after_data`.
4. **Anti-Slop & Aksesibilitas**:
   - Dilarang memakai karakter em dash (`\u2014`) di kode, UI copy, maupun komentar.
   - Animasi hanya memakai properti ramah GPU (`transform`, `opacity`, `clip-path`), menghormati `prefers-reduced-motion: reduce` (Web) dan `MediaQuery.disableAnimationsOf(context)` (Flutter).
   - Jangan pernah membaca atau menulis nilai rahasia `.env.local` ke dokumentasi atau kode klien.

---

## 2. Arsitektur Monorepo & Peta File Kunci

> **Catatan**: File `README.md` di root masih menyimpan catatan prototipe lokal lama. Implementasi aktif ekosistem ERP berada di struktur berikut.

```text
c:\dev\erp-ekalliptus\
├── neon.ts                         # Definisi deploy 5 layanan Neon + env ERP_REALTIME_SECRET
├── drizzle.config.ts               # Konfigurasi Drizzle ORM ke Neon Postgres
├── .env.example                    # Template variabel lingkungan (isi nyata di .env.local, jangan di-commit)
├── packages/
│   ├── tokens/
│   │   ├── design-tokens.json      # Single source of truth warna Light/Dark, font, radius, spasi
│   │   └── scripts/sync-tokens.mjs # Generator otomatis tokens.css & eucalyptus_theme.dart
│   ├── db/
│   │   └── src/
│   │       ├── schema.ts           # Skema relasional Postgres (RBAC, Finance, Inventory, Attendance, Payroll, Audit)
│   │       ├── client.ts           # Koneksi @neondatabase/serverless + Drizzle
│   │       └── seed.ts             # Seed role, permission, akun kas, gudang, kantor, & owner alul@ekalliptus.com
│   └── contracts/
│       └── src/
│           ├── rbac.ts             # Helper izin modular (hasPermission, konstanta modul/aksi)
│           └── schemas.ts          # Validasi Zod bersama API & Web
├── functions/erpapi/               # Neon Functions (Hono REST/JSON API + SSE/Realtime)
│   └── src/
│       ├── index.ts                # Router utama `/api/*`, `/api/health`, `/api/me`, registrasi plugin
│       ├── middleware/             # auth.ts (JWT/JWKS), rbac.ts, audit.ts
│       ├── modules/                # finance, inventory, attendance, payroll, rbac, storage, realtime, plugin
│       └── services/               # pdf.ts (slip gaji/invoice), realtime.ts, storage.ts (presigned S3 URLs)
├── apps/web/                       # Web Command Center (Vite 6 + React 19 + TypeScript + Tailwind v4 + TanStack)
│   ├── index.html                  # Title "MyEkalliptus", favicon, preload theme class
│   ├── public/                     # logo.webp, apple-touch-icon.png, favicon.*
│   └── src/
│       ├── router.tsx              # React.lazy + Suspense route-splitting ke 7 modul + AppShellBootSkeleton
│       ├── lib/
│       │   ├── theme.tsx           # View Transitions API circular reveal + fallback ep-theme-fallback
│       │   ├── auth.ts             # @neon/auth client + ekstraksi JWT session
│       │   ├── realtime.tsx        # Subscriber channel erp:finance, erp:inventory, erp:attendance
│       │   └── api.ts              # Typed API client + presigned object storage uploader
│       ├── styles/
│       │   ├── tokens.css          # Generated oleh tokens:sync
│       │   └── app.css             # Shimmer (.ep-shimmer), View Transition root rules, reduced-motion
│       ├── components/
│       │   ├── AppShell.tsx        # Sidebar desktop collapsible, drawer mobile, Ctrl+K CommandPalette
│       │   ├── ThemeToggleButton.tsx # Tombol tema morph Sun/Moon + koordinat asal klik/keyboard
│       │   ├── Skeleton.tsx        # SkeletonBlock, AppShellBootSkeleton, Dashboard/Table/CardList/Module skeletons, LazySection
│       │   ├── StateViews.tsx      # LoadingState berbasis shimmer, EmptyState, ErrorState
│       │   ├── DataTable.tsx       # TanStack Table + ekspor CSV (*-myekalliptus.csv)
│       │   ├── CommandPalette.tsx
│       │   ├── SlideOver.tsx
│       │   └── StatusBadge.tsx
│       └── routes/                 # LoginPage, DashboardPage, FinancePage, InventoryPage, AttendancePage, PayrollPage, RbacPage, AuditPage
├── apps/mobile/                    # Flutter Native App (Riverpod + GoRouter + Dio + Drift SQLite offline queue)
│   ├── pubspec.yaml                # Asset `assets/images/` terdaftar
│   ├── assets/images/logo.png      # Logo botanical `ekalliptus` (identik dengan Web apple-touch-icon.png)
│   ├── android/app/src/main/
│   │   ├── AndroidManifest.xml     # label "MyEkalliptus", 5 permissions (INTERNET, FINE/COARSE_LOCATION, CAMERA, USE_BIOMETRIC)
│   │   ├── kotlin/.../MainActivity.kt # Extend FlutterFragmentActivity (wajib untuk local_auth)
│   │   └── res/                    # Adaptive icon (mipmap-anydpi-v26), mipmap-*, values*/colors & styles-v31 (Android 14 splash)
│   ├── lib/
│   │   ├── app.dart                # MaterialApp.router + AnnotatedRegion SystemUiOverlayStyle + ThemeRevealHost
│   │   ├── router/app_router.dart  # initialLocation `/splash`, fade transitions, DashboardSkeleton fallback
│   │   ├── core/                   # config/app_config.dart, theme/eucalyptus_theme.dart, auth, network, offline (Drift), rbac, security
│   │   └── features/
│   │       ├── splash/splash_screen.dart          # SplashScreen modern MyEkalliptus + animasi masuk & cek sesi
│   │       ├── common/shimmer_skeleton.dart       # ShimmerScope, SkeletonBox/Card, skeleton 6 layar, LazyListShimmerFooter
│   │       ├── common/theme_transition.dart       # ThemeRevealHost (toImageSync + PathFillType.evenOdd wipe) & AnimatedThemeToggleButton
│   │       ├── common/erp_widgets.dart            # MyEkalliptusLogo, LazyNetworkImage, ErpBadge, Empty/Error cards, barcode scanner
│   │       ├── auth/login_screen.dart
│   │       ├── shell/floating_nav_shell.dart      # Bottom floating pill bar (<= 4 tab utama) + Quick Action Center
│   │       └── dashboard, finance, inventory, attendance, payroll, rbac/ # SliverList.builder lazy batch + Skeleton per layar
│   └── test/erp_mobile_test.dart   # 8 unit & widget tests (Light/Dark parity, RBAC, geofence, Drift, Splash, Skeleton, ThemeRevealHost)
└── scripts/verify-e2e.mjs          # Uji E2E langsung Postgres + API + Object Storage + Realtime
```

---

## 3. Infrastruktur Neon (5 Layanan Aktif)

| Properti | Nilai |
| --- | --- |
| Org ID | `org-solitary-sound-28704514` |
| Project ID | `raspy-wind-79044194` |
| Branch Aktif | `production` (`br-odd-frog-aoghf6vq`) |
| Region | `ap-southeast-1` (AWS) |
| Neon Functions Endpoint (`erpapi`) | `https://br-odd-frog-aoghf6vq-erpapi.compute.c-2.ap-southeast-1.aws.neon.tech` |
| Neon Auth URL | `https://ep-wispy-pond-aowkf9dl.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth` |
| Web Origin Dev | `http://localhost:5173` |
| Web Origin Produksi | `https://myekalliptus.pages.dev` (Cloudflare Pages, proyek `myekalliptus`, akun CF `ekalliptus@gmail.com`) |

### Layanan yang Terhubung
1. **`postgres`**: Neon Postgres 18 (`neondb`) melalui `@neondatabase/serverless` dan Drizzle ORM.
2. **`auth`**: Neon Auth (Email/Password + JWT). Klaim `sub` otomatis dipetakan ke `employees.auth_user_id`.
3. **`object-storage`**: Bucket private `assets` dengan presigned upload/download URLs (struk transaksi, selfie absensi, foto produk, slip gaji PDF).
4. **`functions`**: Layanan API `erpapi` (Hono TypeScript). Starter function `hello` sudah dihapus.
5. **`realtime`**: Channel `erp:finance`, `erp:inventory`, `erp:attendance`.

### Catatan Wiring Kritis (Jangan Diubah Sembarangan)
- **Env Variable Realtime di Neon Functions**: Karena prefix `NEON_` dicadangkan di Neon Functions, `neon.ts` memetakan `ERP_REALTIME_SECRET` dari `process.env.NEON_REALTIME_SECRET`, dan `functions/erpapi/src/services/realtime.ts` membaca `process.env.NEON_REALTIME_SECRET || process.env.ERP_REALTIME_SECRET`.
- **Ekstraksi JWT Neon Auth Web**: `@neon/auth` mengembalikan token JWT pada `data.session.token` dan header `set-auth-jwt` saat `getSession()` / `/token`. Logika ekstraksi JWT 3-segmen sudah ditangani di `apps/web/src/lib/auth.ts`.
- **Biometrik Android**: `MainActivity.kt` wajib menggunakan `FlutterFragmentActivity` agar plugin `local_auth` berfungsi di modul `FinanceScreen` dan `PayrollScreen`.
- **Daftar Env Keys Wajib** (tersedia di `.env.local` lokal dan template `.env.example`):
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_BRANCH_ID`, `NEON_FUNCTION_HOST_SUFFIX`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `VITE_NEON_AUTH_URL`, `VITE_NEON_REALTIME_URL`, `VITE_API_BASE_URL`, `OWNER_EMAIL`, `SMTP_FROM`, `STORAGE_BUCKET`.

---

## 4. Pekerjaan Selesai & Status Verifikasi Terakhir

Seluruh misi utama dan iterasi lanjutan sudah selesai dibangun dan diverifikasi:

1. **Audit Email `ekalliptus.com`**: Migrasi 27 file ke `alul@ekalliptus.com` di `c:\dev\ekalliptus-web` + 59/59 test lulus + seed owner ERP.
2. **Provisioning & E2E Neon 5 Layanan**: `npm run deploy:neon` dan `npm run verify:e2e` lulus (`exit 0`, memverifikasi Postgres 18, Auth, Storage `assets`, Functions `erpapi`, dan Realtime WebSocket).
3. **Rebranding Penuh ke `MyEkalliptus` + Logo Web Identik**:
   - Web (`title`, header, login hero, footer, CSV exports) dan Flutter (`MyEkalliptusLogo`, Android launcher icon, `AndroidManifest.xml`, `applicationId`) seragam memakai logo Web (`/logo.webp` & `assets/images/logo.png`).
4. **Splash Screen Modern**:
   - Android native Light/Dark launch screen (`values/styles.xml`, `values-night/styles.xml`, `values-v31/styles.xml`, `values-night-v31/styles.xml`) + `SplashScreen` animasi `easeOutCubic` di Flutter.
   - Terverifikasi lewat tangkapan layar pada emulator **LDPlayer 14** (`emulator-5554`, `Pixel 11`, Android 14 API 34).
5. **Lazy-Load & Skeleton Shimmer Lintas Platform**:
   - Web: `React.lazy` + `Suspense` menghasilkan 7 chunk modul terpisah (`DashboardPage`, `FinancePage`, `InventoryPage`, `AttendancePage`, `PayrollPage`, `RbacPage`, `AuditPage`) + `DataTable` chunk, dilengkapi `.ep-shimmer` dan `LazySection`.
   - Flutter: `ShimmerScope` + skeleton layout-matched pada seluruh 6 layar dan router, serta `CustomScrollView` + `SliverList.builder` batch reveal (`LazyListShimmerFooter`).
6. **Animasi Modern Pergantian Mode Light / Dark**:
   - Web: View Transitions API circular `clipPath` reveal (`460ms`, `cubic-bezier(0.23, 1, 0.32, 1)`) + `ThemeToggleButton` morph Sun/Moon + fallback CSS terukur. Terverifikasi di Chrome/webview `http://localhost:5173/login` untuk klik `Mode Gelap`, `Mode Terang`, serta rapid double-click (`0` console errors, `0` failed requests).
   - Flutter: `ThemeRevealHost` (rekaman layar sinkron `toImageSync` + `PathFillType.evenOdd` circular reveal `480ms` + ring tepi tipis) + `AnimatedThemeToggleButton` (`AnimatedSwitcher` + haptic) + sinkronisasi warna system bar. Terverifikasi visual di LDPlayer 14 (Light -> Dark -> Light kembali ke kondisi bersih) tanpa error log runtime.
7. **Verifikasi Build & Test Terbaru**:
   - `npm run build` di root: `exit 0` (`tokens:sync`, `tsc` DB/Contracts/API/Web, `vite build` 2060 modul).
   - `flutter analyze`: `No issues found!`.
   - `flutter test`: `8/8` test lulus (`exit 0`).
   - Pemindaian karakter em dash (`\u2014`) di Web & Flutter source: `0` temuan.
8. **Penyimpanan Git (21 Nov 2026)**:
   - Seluruh arsitektur Neon di-commit sebagai `e606844` (`feat: rebuild ERP on Neon five-service stack`, 193 file, +27.081/−5.762) dan di-push ke `origin/main`.
   - Folder `legacy/` (backend lama, docker infra, mobile-teknisi, web Next.js) dihapus; kode lama tetap ada di riwayat git (commit `b030932` s.d. `413cfb0`).
   - Verifikasi sebelum commit: build web `exit 0`, Flutter analyze `0` issue, Flutter test `8/8`, pemindaian secrets bersih, `.env.local` tidak ikut ter-stage.
9. **Deploy Produksi Cloudflare Pages (21 Nov 2026)**:
   - Web terdeploy ke **https://myekalliptus.pages.dev** (proyek Pages `myekalliptus`, branch produksi `main`, akun Cloudflare `ekalliptus@gmail.com`, deploy ID `521c021d`).
   - SPA fallback ditambahkan lewat `apps/web/public/_redirects`; URL Neon (API/Auth/Realtime) sama dengan dev karena dibakar dari `.env.local` saat build.
   - Domain `https://myekalliptus.pages.dev` didaftarkan ke **Neon Auth Trusted Domains** via `neon api -X POST /projects/raspy-wind-79044194/auth/domains -F "domain=https://myekalliptus.pages.dev" -F "auth_provider=better_auth"`. CORS API memang sudah mengizinkan origin apa pun (`origin: (origin) => origin || '*'`).
   - Probe origin trust (POST `/sign-in/email` dengan kredensial dummy dari origin produksi): HTTP `401 INVALID_EMAIL_OR_PASSWORD`, bukan penolakan origin, jadi alur login produksi siap dipakai.
   - **Belum diuji**: login end-to-end dengan akun owner sungguhan dari domain produksi (butuh kredensial kamu).

---

## 5. Lingkungan Lokal, Perintah Utama & Cara Menjalankan

Pada Windows host saat ini, beberapa binary toolchain berada di path custom. Awali sesi PowerShell ZCode dengan PATH berikut bila belum ada di global PATH:

```powershell
$env:PATH = "C:\Users\ekalliptus\bin;C:\Users\ekalliptus\AppData\Roaming\npm;C:\dev\flutter\bin;C:\dev\tools\git\cmd;C:\Users\ekalliptus\.bun\bin;C:\Users\ekalliptus\AppData\Local\Android\Sdk\platform-tools;" + $env:PATH
```

### Perintah Workspace Root (`c:\dev\erp-ekalliptus`)
- `npm run tokens:sync` : sinkronkan `design-tokens.json` ke Web CSS & Flutter theme tokens.
- `npm run build` : `tokens:sync` + typecheck DB, Contracts, API, dan `vite build` Web.
- `npm run dev --workspace=apps/web` : jalankan Web Command Center di `http://localhost:5173/`.
- `npm run db:push` / `npm run db:seed` : dorong skema Drizzle & seed data awal Neon Postgres.
- `npm run deploy:neon` : deploy ulang Neon (`neon.ts` & Functions) ke branch `production`.
- `npm run verify:e2e` : jalankan verifikasi End-to-End 5 layanan Neon.

### Perintah Flutter (`c:\dev\erp-ekalliptus\apps\mobile`)
- `flutter pub get` : unduh dependensi Dart/Flutter.
- `flutter analyze` : cek static analysis & lint.
- `flutter test` : jalankan unit & widget tests (`test/erp_mobile_test.dart`).
- `flutter run -d emulator-5554` : jalankan aplikasi ke emulator LDPlayer 14 aktif (`Pixel 11`, Android 14 API 34).

### Cara Aktivasi Login Pertama (Owner)
1. Pastikan Web atau Mobile berjalan.
2. Buka tab **Aktivasi Pertama** (Web) atau **Aktivasi** (Mobile).
3. Daftarkan akun menggunakan email yang sudah di-seed HR: `alul@ekalliptus.com` dan kata sandi minimal 8 karakter.
4. Neon Auth akan menautkan `sub` ke baris karyawan `EMP-001` (`owner`) secara otomatis untuk akses penuh RBAC.

---

## 6. Catatan Teknis (Known Notes) & Backlog Lanjutan untuk ZCode

1. **Git Ownership Notice (Windows)**:
   - Menjalankan `git` di `c:\dev\erp-ekalliptus` memunculkan `fatal: detected dubious ownership`. Jika ZCode perlu menjalankan command `git`, jalankan sekali:
     `git config --global --add safe.directory C:/dev/erp-ekalliptus`
2. **Deploy Produksi Web & Trusted Domains Neon Auth**:
   - Saat Web dideploy ke domain produksi (selain `http://localhost:5173`), perbarui `VITE_API_BASE_URL`, `VITE_NEON_AUTH_URL`, `VITE_NEON_REALTIME_URL`, serta daftarkan domain produksi ke **Neon Auth Trusted Domains** dan sesuaikan CORS di `functions/erpapi/src/index.ts`.
   - Untuk build rilis APK/AAB Flutter dengan URL produksi/kustom, oper `--dart-define=API_BASE_URL=... --dart-define=NEON_AUTH_URL=... --dart-define=AUTH_ORIGIN=...`.
3. **Android Release Signing & Hardware Testing**:
   - `apps/mobile/android/app/build.gradle.kts` saat ini memakai debug signing untuk build `release`. Siapkan keystore rilis (`key.properties`) sebelum distribusi toko/internal.
   - Uji kamera selfie absensi, GPS nyata di luar emulator, biometrik sidik jari nyata (`local_auth`), dan barcode scanner (`mobile_scanner`) pada perangkat Android fisik.
4. **Optimasi Bundle Vite & Warning Plugin Flutter (SELESAI 21 Nov 2026)**:
   - `manualChunks` ditambahkan di `apps/web/vite.config.ts` (vendor react / tanstack / neon dipecah dari chunk aplikasi). Hasil: chunk utama `index-*.js` turun dari `~763 kB` (`~214 kB` gzip) menjadi `~116 kB` (`~29 kB` gzip); vendor-react `223 kB`, vendor-neon `303 kB`, vendor-tanstack `175 kB`; tidak ada chunk di atas `500 kB` sehingga warning build hilang.
   - Terverifikasi runtime via `vite preview` + browser: semua chunk `200`, boot aplikasi normal, redirect sesi ke `/login`, halaman login render utuh, toggle tema Light/Dark berfungsi, tanpa error console.
   - Warning Kotlin `package_info_plus` (`9.0.1` vs `10.2.2`) sengaja TIDAK di-upgrade: paket itu dependensi transitive dari `geolocator_linux`, tidak dipakai langsung, dan `dependency_overrides` ke major 10 berisiko merusak resolusi geolocator. Revisit hanya saat geolocator menaikkan constraint-nya.
5. **Pengembangan Modul Baru (Extensible Plugin Architecture)**:
   - Untuk menambah domain baru (seperti POS/Kasir, Ticketing Service, atau Project Management) tanpa mengubah inti Auth/RBAC:
     1. Tambah tabel domain ke `packages/db/src/schema.ts`.
     2. Tambah izin & skema Zod ke `packages/contracts/src/{rbac.ts,schemas.ts}`.
     3. Buat router plugin `ErpModulePlugin` baru di `functions/erpapi/src/modules/` dan daftarkan di array `registerErpPlugins(...)` pada `functions/erpapi/src/index.ts`.
     4. Tambahkan route `React.lazy` baru di `apps/web/src/router.tsx` + skeleton di `Skeleton.tsx`, serta route GoRouter + shimmer screen di `apps/mobile/lib/`.
6. **Integrasi Email SMTP / Transaksional**:
   - Pengirim email default dikonfigurasi ke `alul@ekalliptus.com` (`SMTP_FROM`). Jika fitur kirim invoice/slip gaji lewat email diaktifkan, sambungkan provider SMTP/email di layer service API sambil tetap memanfaatkan Neon `object-storage` untuk arsip PDF.

---

## 7. Prompt Lanjutan Siap Pakai di ZCode

Salin dan sesuaikan prompt berikut ketika melanjutkan sesi baru di ZCode:

```text
Baca file c:\dev\erp-ekalliptus\zcode-erp.md terlebih dahulu sebagai konteks lengkap proyek MyEkalliptus (Web + Flutter + Neon 5 layanan).
Setelah memahami arsitektur, aturan BIGINT/ACID/Zero-em-dash, dan konvensi design tokens Eucalyptus Precision, kerjakan tugas berikut secara terstruktur dan verifikasi hasilnya dengan build serta test:
[TULISKAN TARGET FITUR / PERBAIKAN / DEPLOY DI SINI]
```
