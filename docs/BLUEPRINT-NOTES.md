# Catatan implementasi NEXUS-CORE

Blueprint sumber: `nexus_core_erp_architecture_execution_blueprint.md`.
Implementasi ini memulai modular monolith; bukan klaim enam fase produksi selesai.
Status implementasi dan perintah pengujian tersedia di README dan backend/API.md.

## Koreksi terhadap spesifikasi

- Ledger harus menjadi bagian transaksi operasional sejak awal, bukan baru disambungkan pada fase kelima. Penjualan, pembayaran, stok, dan jurnal wajib commit atau rollback bersama.
- CHECK debit/kredit pada satu baris tidak menjamin jurnal seimbang. Validasi total harus berjalan saat commit, melarang jurnal kosong, dan mencegah mutasi jurnal yang telah dicatat. Kredensial aplikasi produksi tidak boleh menjadi pemilik tabel atau superuser.
- Menghapus journal entry dengan cascade bertentangan dengan ledger immutable. Koreksi finansial produksi membutuhkan jurnal pembalik, bukan edit atau delete; antarmuka refund belum boleh dianggap tersedia tanpa implementasi pembalikan.
- Redis mutex nomor tujuan saja tidak mencegah pengisian pulsa ganda setelah lock dilepas. Integrasi PPOB membutuhkan idempotency persisten, referensi vendor stabil, outbox transaksi, retry terkontrol, serta rekonsiliasi. Tidak ada transaksi provider sukses buatan.
- Signature callback mengikuti dokumentasi vendor yang benar; hash permintaan API dan signature webhook bukan mekanisme yang bisa dipertukarkan.
- Pembayaran invoice piutang mengkredit piutang, bukan mengakui pendapatan kedua kali. Penyerahan servis setelah lunas tidak boleh membuat jurnal penerimaan kas kedua.
- DP proyek adalah kewajiban pendapatan diterima di muka. Implementasi termin selesai yang langsung menimbulkan piutang tidak boleh dipasarkan sebagai dukungan DP lengkap.
- Reservasi stok berbeda dari konsumsi stok. Dukungan multi-gudang, reservasi, dan material cetak pecahan membutuhkan model eksplisit sebelum diaktifkan.
- Token portal pelanggan wajib berumur terbatas, scoped, dapat dicabut, dan disimpan sebagai hash. URL invoice publik berdasarkan UUID saja tidak cukup sebagai kontrol akses.
- PIN perangkat dan NIK pelanggan tidak dikumpulkan secara default. Kebutuhan nyata harus disertai enkripsi, pembatasan akses, retensi, dan penghapusan yang dapat diaudit.
- Barcode scanner keyboard-wedge tidak membutuhkan WebHID. ESC/POS membutuhkan pengujian code page printer; UTF-8 tidak didukung semua model. Pembayaran sukses tidak boleh dibatalkan hanya karena pencetakan gagal.
- Offline checkout tidak otomatis aman: transaksi lokal perlu UUID persisten, antrean idempotent, kebijakan konflik harga/stok, dan pengamanan data lokal. PPOB serta validasi saldo tetap membutuhkan koneksi. Jangan mengklaim offline-first tanpa pengujian sinkronisasi.
- Satu host Docker Compose bukan high availability. HTTPS otomatis tidak menyediakan rate limiting pada Caddy standar. Backup terjadwal belum dianggap berhasil sebelum restore diuji.

## Gerbang sebelum produksi

1. Uji semua peran, sesi kedaluwarsa, pembatasan login, dan izin data pelanggan.
2. Gunakan role PostgreSQL runtime terbatas, TLS, secret eksternal, log tanpa kredensial, dan observabilitas.
3. Uji transaksi bersamaan, retry, rollback, rekonsiliasi kas, stok, dan buku besar pada data representatif.
4. Lengkapi pembalikan transaksi, pajak, audit operasional, periode pembukuan, serta laporan yang dibutuhkan usaha.
5. Konfigurasi sandbox vendor, signature callback, antrean/outbox, retry dan rekonsiliasi sebelum transaksi eksternal.
6. Jalankan backup offsite terenkripsi, uji restore, tetapkan RPO/RTO, dan dokumentasikan penanganan insiden.
7. Uji printer fisik, kasir keyboard-first, perangkat mobile, dan migrasi data bersama operator.
