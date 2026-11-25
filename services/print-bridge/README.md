# MyEkalliptus Local Print Bridge (HP Smart Tank 583 + OpenWA)

Layanan daemon lokal di laptop/PC toko yang terhubung satu jaringan Wi-Fi dengan printer **HP Smart Tank 583** serta menjalankan listener WhatsApp pribadi (`@open-wa/wa-automate`).

## Fitur Utama
1. **OpenWA Personal Document Listener (Option B):** Menerima dokumen/gambar (`PDF`, `JPG`, `PNG`, `WEBP`, `TXT`, `MD`, `HTML`, Office) dari chat WhatsApp personal (<= 25 MB), mengabaikan grup, broadcast, stiker, voice note, audio, video, dan chat teks biasa.
2. **Approval Queue Pertama:** Setiap dokumen dari WhatsApp diunggah aman ke Neon Object Storage dan masuk status `pending_approval` di MyEkalliptus Web & Android, menunggu konfirmasi operator sebelum tercetak.
3. **Direct IPP 2.0 + PWG Raster Engine:** Merender PDF/gambar/HTML ke PWG Raster lalu mengirim langsung ke HP Smart Tank 583 via Wi-Fi (`192.168.0.5:631/ipp/print`).
4. **Mode Dry-Run Aman (`--dry-run`):** Memvalidasi PWG Raster + IPP `Validate-Job` tanpa mengeluarkan kertas atau tinta.

## Cara Setup & Pairing Pertama Kali
1. Masuk ke `https://my.ekalliptus.com/printer` menggunakan akun Owner/Staff/Finance dengan izin `printer:create`.
2. Buka tab **Perangkat & Bridge**, klik **Tambah Perangkat Bridge**, lalu salin **Agent Token** (`ekp_...`) yang hanya tampil sekali.
3. Salin template konfigurasi:
   ```powershell
   cd services\print-bridge
   Copy-Item .env.example .env
   ```
4. Isi `PRINT_AGENT_TOKEN` dan `PRINTER_HOST=192.168.0.5` di `services/print-bridge/.env`.
5. Jalankan verifikasi printer tanpa kertas terlebih dahulu:
   ```powershell
   npm run verify-printer
   ```
6. Jalankan bridge mode normal (atau `npm run dry-run` untuk uji tanpa cetak fisik):
   ```powershell
   npm start
   ```
7. Saat OpenWA pertama kali aktif, pindai QR Code WhatsApp yang muncul pada log terminal memakai aplikasi WhatsApp di ponsel toko. Sesi tersimpan di `.openwa-session/` agar tidak perlu scan ulang saat restart.
