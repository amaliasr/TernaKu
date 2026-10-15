# TernaKu

![Dashboard TernaKu](docs/screenshots/dashboard.png)

Web pengelolaan telur dan pakan untuk admin serta karyawan, berbahasa Indonesia, responsif, dengan font **Poppins**. Frontend memakai **Next.js 16 App Router, React, TypeScript, Bootstrap 5**, dan Recharts. Backend terpisah memakai **CodeIgniter 3.1.13, PHP 8.2, MySQL/MariaDB InnoDB**. Frontend di-export menjadi file statis; seluruh autentikasi dan mutasi data production berjalan melalui API.

Tujuan deployment:

| Komponen   | Lokasi                                                      |
| ---------- | ----------------------------------------------------------- |
| Repository | [amaliasr/TernaKu](https://github.com/amaliasr/TernaKu)     |
| Frontend   | `https://ternakku.rstudio.com`                              |
| API        | `https://api.buildmanagement.id/ternaku`                    |
| Database   | MySQL pada hosting API; tidak diakses langsung oleh browser |

Source dan workflow build siap digunakan. Publikasi ke domain memerlukan akses hosting, konfigurasi domain, serta kredensial database yang sesuai; repository ini tidak menyimpan kredensial production.

## Fitur versi awal

- Dashboard produksi, omzet, stok, grafik, target, dan performa karyawan dengan filter tanggal.
- Produksi harian telur bagus/bentes: butir, kilogram aktual, jumlah krat, sumber kandang opsional, catatan, foto dan lokasi opsional. Krat dan kilogram diisi terpisah; estimasi 10 kg/krat hanya membantu input.
- Pengambilan telur per karyawan, sisa telur yang dibawa, pengembalian, dan riwayat pergerakan stok bertanggal. Validasi mencegah saldo butir/kilogram negatif dan sisa yang hanya mempunyai salah satu satuan.
- Penjualan beberapa item dalam satu transaksi, pelanggan, harga otomatis, Tunai/Transfer/QRIS/Piutang, pembayaran sebagian/pelunasan, dan nota penjualan PDF.
- Harga bagus/bentes per kilogram, jadwal mulai berlaku, riwayat harga, notifikasi perubahan, serta snapshot harga transaksi yang tidak berubah ketika harga baru ditetapkan.
- Pembelian pakan beberapa item, nota pembelian PDF, stok/minimum pakan, dan pemakaian pakan per kandang ayam.
- Admin mengelola akun/target, menonaktifkan karyawan, mengunci catatan, meninjau koreksi, dan membaca log aktivitas. Karyawan hanya menerima transaksi miliknya sendiri; harga serta saldo peternakan dapat dilihat sesuai kebutuhan kerja.
- Laporan PDF dan Excel (`.xlsx`) serta peringkat penjualan. Export dibuat di browser menggunakan jsPDF dan ExcelJS.
- **Insentif karyawan dan manajemen kandang sapi ditampilkan sebagai Coming Soon**, sesuai perubahan cakupan.

## Menjalankan demo lokal

Gunakan Node.js 22+ dan npm. Dari root repository:

```bash
npm ci
```

Buat `.env.local` (diabaikan Git):

```dotenv
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_API_URL=https://api.buildmanagement.id/ternaku
```

Jalankan `npm run dev`, lalu buka `http://127.0.0.1:3000`. Mode ini diberi label **DEMO** dan hanya menyimpan data contoh di browser (localStorage).

| Peran demo   | Email              | Password   |
| ------------ | ------------------ | ---------- |
| Atasan/admin | `admin@ternaku.id` | `Demo123!` |
| Karyawan     | `sari@ternaku.id`  | `Demo123!` |

Akun tersebut hanya berlaku dalam mode demo, tidak dibuat oleh installer API. Data demo tidak otomatis dikirim ke database dan tidak menggantikan API jika koneksi production gagal. Untuk mengulang demo dari awal, hapus data situs/localStorage pada browser.

## Menjalankan dengan API dan database nyata

1. Siapkan PHP 8.2 dengan `pdo_mysql`, `mbstring`, `json`, dan `openssl`, serta MySQL 5.7+/8.0 atau MariaDB 10.4+ dengan InnoDB. `curl` PHP diperlukan hanya untuk suite integration test.
2. Buat database kosong `utf8mb4` dan user khusus database tersebut. Salin `api/.env.example` ke `api/.env`, lalu isi koneksi database. Untuk lokal, gunakan `APP_URL=http://127.0.0.1:8081` dan `ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`.
3. Jalankan installer sekali menggunakan kredensial admin yang Anda tentukan melalui environment shell:

   ```bash
   ADMIN_EMAIL='admin@peternakan.example' ADMIN_PASSWORD='password-kuat-minimal-12-karakter' php api/scripts/install.php
   ```

   PowerShell:

   ```powershell
   $env:ADMIN_EMAIL = 'admin@peternakan.example'
   $env:ADMIN_PASSWORD = 'password-kuat-minimal-12-karakter'
   php api/scripts/install.php
   Remove-Item Env:ADMIN_PASSWORD
   ```

   Installer membuat schema, admin pertama, dan sumber `Kandang Ayam Utama`. Tidak ada password bawaan. Menjalankan ulang tidak mereset akun yang sudah ada.

4. Jalankan API dari root repository: `php -S 127.0.0.1:8081 -t api api/router.php`.
5. Ubah `.env.local` menjadi:

   ```dotenv
   NEXT_PUBLIC_DEMO_MODE=false
   NEXT_PUBLIC_API_URL=http://127.0.0.1:8081
   ```

6. Mulai ulang `npm run dev`, login dengan admin dari installer, tetapkan harga aktif, buat karyawan/jenis pakan, lalu mulai mencatat produksi. `GET http://127.0.0.1:8081/health` memeriksa runtime dan koneksi database.

Detail schema, payload command, CORS, installer, autentikasi, dan deployment ada di [panduan API](api/README.md).

## Deployment melalui GitHub

Untuk pemasangan manual melalui File Manager seperti RumahFlow, ikuti **[Petunjuk pemasangan API TernaKu](api/PEMASANGAN.md)**. Panduan mencakup lokasi folder, database MySQL, `.env`, pembuatan admin melalui terminal atau Cron Jobs sementara, dan pemeriksaan koneksi website.

Workflow [.github/workflows/ci.yml](.github/workflows/ci.yml) berjalan pada push ke `main`/`master`, pull request, atau pemicu manual. Workflow memasang dependencies, memeriksa TypeScript, menjalankan tes domain, memeriksa sintaks PHP aplikasi, menjalankan tes HTTP+MySQL termasuk persaingan stok, lalu membangun frontend **dengan DEMO=false**. Setelah berhasil tersedia dua artifact:

- `ternaku-web`: isi hasil static export `out/`, untuk document root `ternakku.rstudio.com`.
- `ternaku-api`: arsip `ternaku-api.tar.gz`, untuk folder `/ternaku` di document root `api.buildmanagement.id`. Arsip memakai daftar file yang diizinkan dan mencakup runtime CI3 resmi. File `.env`, database/log lokal, tes, dan unduhan sementara tidak dimasukkan.

Workflow menyiapkan paket deploy; belum ada transfer otomatis ke hosting karena akses deployment belum dikonfigurasi. Untuk deploy manual:

1. Unduh artifact dari GitHub Actions yang berhasil dan unggah isi `ternaku-web` ke document root frontend. Ini adalah file statis, tidak membutuhkan server Node.js di hosting.
2. Ekstrak `ternaku-api.tar.gz` ke folder API, termasuk `.htaccess`, `application/`, dan `system/`.
3. Buat `.env` di folder `ternaku/` pada hosting API, sejajar dengan `index.php`, dari contoh yang tersedia. Isi `APP_ENV=production`, `APP_URL=https://api.buildmanagement.id/ternaku`, `ALLOWED_ORIGINS=https://ternakku.rstudio.com`, dan kredensial database khusus hosting. Jalankan installer via terminal hosting atau Cron Jobs sementara sesuai petunjuk pemasangan.
4. Aktifkan HTTPS kedua domain dan pastikan Apache mengizinkan `.htaccess`/rewrite. Folder `application/logs/` harus dapat ditulis oleh PHP. Untuk Nginx, terapkan larangan akses direktori internal dan `.env` yang setara; `.htaccess` hanya berlaku di Apache.
5. Periksa `/ternaku/health`, login dari domain frontend, dan verifikasi bahwa `.env`, `schema.sql`, serta `application/` tidak dapat diunduh melalui browser.

Build lokal production juga dapat dilakukan dengan `.env.local` berisi `NEXT_PUBLIC_DEMO_MODE=false` dan URL API production, lalu `npm run build`. Hasilnya berada di `out/`; `npm run preview` menayangkannya secara lokal. Variabel `NEXT_PUBLIC_*` ditanam pada waktu build, sehingga perubahan URL atau mode memerlukan build ulang.

## Aturan penting dan batas versi awal

Harga transaksi ditetapkan dari waktu server saat disimpan, walaupun tanggal laporan dimundurkan. Semua total/bayar/sisa tagihan dihitung server. Bila harga yang tampil di form berubah sebelum disimpan, frontend mengambil harga terbaru dan pengguna menyimpan kembali. Snapshot harga, sumber/kategori item, dan pemilik penjualan tidak dapat diganti melalui koreksi.

Koreksi wajib menyertakan alasan. Karyawan bisa langsung mengoreksi produksi sendiri yang belum dikunci; selain itu mengajukan persetujuan admin. Koreksi jumlah/berat produksi dan pengambilan menyesuaikan saldo fisik serta ledger, dengan mempertimbangkan penjualan/pengembalian yang sudah tercatat. Admin dapat mengoreksi kuantitas seluruh item penjualan yang sudah ada; total dihitung ulang memakai snapshot harga lama, tanpa melebihi telur yang dibawa. Nilai baru tidak boleh lebih kecil dari pembayaran yang sudah diterima karena refund/pembatalan/reversal belum tersedia. Pembayaran piutang penjualan dicatat sebagai tindakan terpisah yang diaudit.

Berat memakai maksimal 3 desimal, rupiah dibulatkan per item, dan zona waktu bisnis Asia/Jakarta. Penguncian database mencegah dua permintaan mengambil saldo yang sama. Permintaan tulis memakai ID idempotensi untuk mencegah duplikasi saat respons hilang. Backend memeriksa token aktif, role, kepemilikan, kategori, harga, dan saldo; pembatasan UI bukan satu-satunya pengaman.

Notifikasi harga tampil dalam aplikasi saat state disegarkan, termasuk polling; tidak ada push ketika aplikasi ditutup atau integrasi WhatsApp/SMS. Foto opsional disimpan sebagai data gambar terbatas/URL HTTPS, belum memakai penyimpanan objek terpisah. Bootstrap memuat riwayat pengguna sekaligus; untuk volume transaksi besar perlu pagination, agregasi laporan di server, dan penyesuaian penguncian dari mutex global ke kunci per entitas. Backup database perlu disiapkan di hosting.

## Pemeriksaan lokal

```bash
npm run typecheck
npm test
npm run build
```

Tes API menjalankan transaksi nyata dan dua proses PHP paralel. Gunakan database kosong **khusus tes** yang namanya berakhiran `_test`, atur server API ke database itu, kemudian jalankan:

```bash
ALLOW_TEST_RESET=1 php api/tests/integration.php
```

PowerShell: `$env:ALLOW_TEST_RESET='1'; php api/tests/integration.php`. Tes menghapus dan membuat ulang tabel pada database tersebut. Jangan menjalankannya terhadap data bisnis. `TEST_API_URL` dapat mengganti alamat HTTP default `http://127.0.0.1:8081`. Pengujian lokal pengembangan telah dijalankan terhadap PHP 8.2 dan MariaDB terisolasi, termasuk perhitungan, snapshot harga, stok bersamaan, hak akses, koreksi, idempotensi, dan ledger pengembalian.

## Struktur repository

```text
src/app/          Next.js app dan gaya global
src/components/   Dashboard, navigasi, modul operasional, dan form
src/lib/          Tipe, aturan domain, state/API client, demo, dan export
tests/            Unit test domain frontend
api/              CodeIgniter 3, schema MySQL, installer, dan integration test
.github/workflows/ci.yml   Validasi serta paket deployment
```

Keputusan antarmodul didokumentasikan dalam [CONTRACT.md](CONTRACT.md). Lisensi runtime CI3 tercantum di [api/CI-LICENSE.txt](api/CI-LICENSE.txt).
