# API TernaKu — CodeIgniter 3 + MySQL

API ini menjalankan CodeIgniter **3.1.13** asli, dengan runtime `system/` dari [rilis resmi CodeIgniter](https://github.com/bcit-ci/CodeIgniter/releases/tag/3.1.13). Lisensi upstream ada di `CI-LICENSE.txt`. Runtime ikut dalam repository; tidak perlu Composer di hosting. Versi yang diuji: PHP 8.2.12, PDO MySQL, MariaDB 10.4 (InnoDB). Gunakan PHP 8.2, ekstensi `pdo_mysql`, `mbstring`, `json`, `openssl`, dan Apache `mod_rewrite`. MySQL 5.7/8.0 juga didukung oleh skema. CI3 masih memakai dynamic properties; entrypoint menonaktifkan pesan deprecation PHP 8.2, sedangkan error aplikasi tetap dicatat dan tidak dibocorkan ke respons.

Fitur aktif: autentikasi admin/karyawan, produksi, stok/pengambilan/pengembalian telur, penjualan beberapa item, pembayaran piutang, harga terjadwal, notifikasi harga, pakan, pembelian dan pemakaian pakan, koreksi dengan alasan/persetujuan, penguncian, serta audit. **Kandang sapi dan insentif adalah Coming Soon**, sesuai cakupan terbaru. Kandang ayam hanya sebagai sumber produksi dan tujuan pemakaian pakan.

## Instalasi pertama

Untuk langkah pemasangan melalui File Manager hosting seperti RumahFlow, baca **[Petunjuk pemasangan API TernaKu](PEMASANGAN.md)**. Admin pertama dapat dibuat melalui halaman Daftar dengan kode setup pemilik, atau installer terminal/SSH dan Cron Jobs sementara.

1. Buat database MySQL kosong ber-charset `utf8mb4` dan user khusus dengan akses ke database itu. Jangan memakai akun root di production.
2. Salin `.env.example` menjadi `.env`, lalu isi koneksi database, `APP_URL`, dan `ALLOWED_ORIGINS`. Jangan commit `.env`.
3. Jalankan installer melalui terminal, dengan kredensial admin pertama di environment shell:

   ```bash
   export ADMIN_EMAIL='admin@peternakan.example'
   export ADMIN_PASSWORD='ganti-dengan-password-kuat-minimal-12-karakter'
   export ADMIN_NAME='Admin TernaKu'
   php scripts/install.php
   unset ADMIN_PASSWORD
   ```

   PowerShell:

   ```powershell
   $env:ADMIN_EMAIL = 'admin@peternakan.example'
   $env:ADMIN_PASSWORD = 'ganti-dengan-password-kuat-minimal-12-karakter'
   $env:ADMIN_NAME = 'Admin TernaKu'
   php scripts/install.php
   Remove-Item Env:ADMIN_PASSWORD
   ```

   Installer membuat tabel, admin pertama, dan satu sumber `Kandang Ayam Utama`. Tidak ada akun/password demo atau data transaksi contoh di production. Menjalankan ulang installer tidak mengganti akun yang sudah ada. Akun karyawan baru memakai password minimal 10 karakter.
4. Untuk lokal, jalankan dari folder `api/`: `php -S 127.0.0.1:8081 router.php`. Atur `APP_URL=http://127.0.0.1:8081` dan `ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000` di `.env`. Gunakan origin frontend yang tepat, termasuk port.
5. `GET /health` harus memberikan `{"data":{"status":"ok",...}}`. Login menggunakan admin pertama, lalu buat harga aktif dan jenis pakan melalui aplikasi sebelum bertransaksi.

## Deployment di api.buildmanagement.id/ternaku

Upload isi `api/` ke folder publik `/ternaku` pada domain API, termasuk `.htaccess` dan `system/`. Jangan upload `.test-db/`, `upstream/`, ZIP unduhan, atau log tes. Buat `.env` di server:

```dotenv
APP_ENV=production
APP_URL=https://api.buildmanagement.id/ternaku
ALLOWED_ORIGINS=https://ternaku.rstudiohub.com
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=nama_database_hosting
DB_USER=user_database_hosting
DB_PASSWORD=password_database_hosting
TOKEN_TTL_HOURS=12
```

`APP_URL` tidak memakai `/index.php` atau garis miring terakhir. Apache harus mengizinkan `.htaccess` (`AllowOverride All`). Pastikan `application/logs/` dapat ditulis oleh PHP dan tidak dapat dibaca melalui HTTP. `.htaccess` membatasi direktori internal, `.env`, SQL, dan PHP selain entrypoint. Endpoint seperti `/ternaku/.env`, `/ternaku/schema.sql`, dan `/ternaku/application/config/config.php` harus menghasilkan 403/404, bukan isi file. Untuk Nginx, buat aturan penolakan yang setara; `.htaccess` tidak berlaku di Nginx. Hanya `index.php` boleh menjadi entrypoint PHP. Gunakan HTTPS di kedua domain.

Frontend production memakai `NEXT_PUBLIC_API_URL=https://api.buildmanagement.id/ternaku` dan `NEXT_PUBLIC_DEMO_MODE=false` pada **waktu build Next.js**. Perubahan `.env` frontend setelah static export tidak akan mengganti URL yang sudah tertanam. GitHub menyimpan source dan dapat menjalankan build frontend; runtime PHP/MySQL harus berada di hosting API. Tidak ada kredensial database yang dikirim ke browser.

## Protokol

| Metode | Path | Fungsi |
| --- | --- | --- |
| GET | `/health` | Pemeriksaan runtime dan koneksi database |
| GET | `/auth/registration-status` | `{first_admin_required,setup_enabled}` tanpa autentikasi |
| POST | `/auth/register` | `{name,email,password,password_confirmation,setup_token?}` → `{status,message}` |
| POST | `/auth/login` | `{email,password}` → `{token,user}` |
| POST | `/auth/logout` | Mencabut bearer token |
| GET | `/bootstrap` | State sesuai hak pengguna |
| POST | `/commands` | `{action,payload,request_id?}` → State terbaru |

Semua respons berhasil dibungkus `{"data":...}` dan kesalahan `{"error":"pesan"}`. Permintaan tulis memakai `Content-Type: application/json`; setelah login gunakan `Authorization: Bearer <token>`. Token acak disimpan sebagai hash SHA-256, kadaluarsa 12 jam secara default, dan dicabut ketika akun dinonaktifkan atau logout. Percobaan login dibatasi 10 per pasangan IP/email per 15 menit. CORS hanya mengizinkan origin yang tercantum, tidak memakai `*` dan tidak bergantung pada cookie.

Tombol **Daftar** tetap tersedia setelah admin dibuat. Pendaftaran pertama memerlukan tabel pengguna kosong dan kode pemilik acak `SETUP_TOKEN` (minimal 32 karakter), atau file terlindungi `application/config/setup-token.php` yang mengembalikan kode tersebut. Pendaftaran berikutnya selalu menjadi karyawan peternakan yang sama dengan status menunggu; admin menyetujui atau menolak melalui menu Karyawan. Form pendaftaran tidak boleh menentukan role/aktivasi sendiri dan tidak menghasilkan token login. Password pendaftaran minimal 12 karakter Unicode dan maksimal 72 byte UTF-8; spasi dipertahankan. Pendaftaran dibatasi 10 percobaan per IP dan 5 per email dalam 15 menit. Status pendaftaran disimpan di tabel `records`, sehingga pemasangan lama tidak memerlukan migrasi skema. Akun lama tetap dianggap disetujui. Hapus kode setup setelah admin pertama berhasil dibuat, dan jangan masukkan kode/password ke Git atau paket deployment.

`request_id` opsional disarankan untuk seluruh penulisan: gunakan UUID baru untuk suatu tindakan, pertahankan UUID tersebut ketika mengulangi permintaan yang hasilnya tidak diketahui karena jaringan putus. Permintaan identik dengan ID yang sama dari pengguna yang sama tidak menulis ulang data; payload berbeda dengan ID sama menghasilkan 409. Kunci disimpan atomik bersama perubahan. Gunakan UUID baru untuk tindakan baru yang memang ingin dicatat dua kali.

Status: 400 JSON tidak valid, 401 sesi tidak sah, 403 hak/origin ditolak, 404 data/endpoint tidak ditemukan, 405 metode salah, 409 konflik idempotensi, 413 terlalu besar, 415 tipe konten salah, 422 validasi bisnis, 429 pembatasan login, 500 kesalahan server. Body maksimal 3 MB. Foto opsional berupa data URL JPEG/PNG/WebP (maksimal sekitar 1,3 MB biner) atau URL HTTPS, disimpan di dokumen transaksi; belum ada layanan upload/CDN terpisah.

## Perintah

Nama kolom dan struktur respons mengikuti `../src/lib/types.ts` dan `../CONTRACT.md`. ID adalah string; kategori `good`/`cracked`, role `admin`/`employee`, metode pembayaran `cash`/`transfer`/`qris`/`credit`.

| Perintah | Payload utama | Hak |
| --- | --- | --- |
| `production.create` | date, barn_id, category, eggs, kg, trays, notes, photo?, location? | Semua, pencatat otomatis |
| `pickup.create` | date, category, eggs, kg, trays, area, notes | Semua, pengambil otomatis |
| `pickup.return` | id, eggs, kg, trays, notes | Pemilik/admin |
| `sale.create` | date, customer, phone, items[{pickup_id,category,eggs,kg,trays}], payment_method, paid, notes, photo?, expected_price_id? | Pengambilan sendiri |
| `sale.payment` | id, amount | Pemilik/admin |
| `price.create` | good_price, cracked_price, effective_at | Admin |
| `user.create` | name, email, password, role, target | Admin |
| `user.update` | id, name?, active?, target? | Admin |
| `user.approve` | id | Admin, menyetujui pendaftaran karyawan |
| `user.reject` | id | Admin, menolak pendaftaran yang menunggu |
| `barn.create` | name, type:`ayam`, capacity, notes | Admin |
| `feed.create` | name, unit:`kg`, min_stock | Admin |
| `feed.purchase` | date, supplier, items[{feed_id,quantity,unit_price}], paid, notes | Admin |
| `feed.use` | date, feed_id, barn_id, quantity, notes | Semua |
| `notification.read` | id atau id:`all` | Notifikasi sendiri |
| `correction.request` | entity, id, reason, changes | Pemilik/admin |
| `correction.apply` | entity, id, reason, changes | Admin atau produksi sendiri yang belum dikunci |
| `correction.review` | id, approved:boolean | Admin |
| `record.lock` | entity, id, locked:boolean | Admin |

Koreksi memakai entity `production`, `pickup`, atau `sale`; alasan minimal 5 karakter. Produksi boleh mengubah eggs/kg/trays/notes selama stok tidak menjadi negatif. Pickup dapat mengubah eggs/kg/trays/notes/area; jumlah baru harus mencukupi seluruh penjualan dan pengembalian, sedangkan selisih pengambilan disesuaikan ke stok gudang dan ledger.

Sale dapat mengubah notes/customer dan kuantitas item melalui `changes.items:[{id,eggs,kg,trays}]`. Seluruh item lama harus dicantumkan tepat sekali; tidak boleh menambah/menghapus item, memindahkan sumber/kategori, atau mengubah snapshot harga. Total dan sisa tagihan dihitung ulang memakai harga lama, dengan validasi saldo pickup yang mengecualikan versi lama penjualan. Koreksi tidak boleh membuat total lebih kecil dari pembayaran yang sudah diterima karena refund/pembatalan/reversal finansial belum didukung. Koreksi pickup/sale dilakukan admin atau melalui permintaan yang disetujui admin. Admin dapat mengunci catatan; penjualan baru dikunci secara default. Pembayaran tambahan dan pengembalian tetap dapat dilakukan karena merupakan mutasi bisnis tersendiri yang diaudit.

Permintaan koreksi menyimpan usulan dan memeriksa bentuk kolom, sedangkan saldo dan pembayaran divalidasi ulang secara atomik ketika admin menyetujuinya. Permintaan dapat gagal disetujui jika transaksi baru telah menghabiskan saldo; dalam kondisi tersebut status tetap pending dan tidak ada bagian perubahan yang diterapkan.

Harga disalin ke setiap item penjualan berdasarkan **waktu server saat penjualan dibuat**, termasuk jika tanggal laporan transaksi dimundurkan. Harga masa depan baru berlaku ketika waktu mulai tercapai. Harga baru tidak mengubah penjualan lama. Jika `expected_price_id` dari form berbeda dari harga aktif, API menolak 409 agar pengguna melihat total baru sebelum mengulangi simpan. Rupiah dibulatkan ke rupiah terdekat pada setiap item; total maksimum Rp1 triliun menjaga representasi angka tetap tepat di browser. Kilogram maksimal 3 desimal, jumlah butir/krat bilangan bulat. Jumlah krat informatif dan bebas dari berat aktual; tidak pernah dikalikan 10 sebagai dasar total atau validasi stok. Validasi stok menggunakan butir dan kilogram; sisa keduanya harus sama-sama nol atau sama-sama positif. Tanggal transaksi tidak boleh pada hari mendatang, tetapi harga boleh dijadwalkan; zona waktu Asia/Jakarta.

## Penyimpanan dan konsistensi

`users`, `tokens`, `login_attempts`, `records`, `stock`, `command_requests`, dan `command_mutex` menggunakan InnoDB. Dokumen domain disimpan sebagai JSON tervalidasi dalam `records.data` (LONGTEXT untuk kompatibilitas MySQL/MariaDB), dengan indeks jenis/pemilik/waktu dan urutan penulisan. `stock` menyimpan saldo otoritatif. Semua input dibangun ulang oleh server; `user_id`, harga, total, dan saldo dari klien tidak dipercaya.

Setiap command menggunakan transaksi dan kunci baris. Kunci command global yang singkat mengurutkan perubahan lintas dokumen sehingga dua penjualan/pengambilan bersamaan tidak melewati validasi saldo; baris stok/pickup juga dikunci. Desain ini cocok untuk skala peternakan, namun penulisan seluruh pengguna berbagi satu antrean. Sebelum berkembang ke volume tinggi, normalisasikan item/pembayaran dan ganti mutex global dengan urutan kunci per entitas. Bootstrap dikembalikan dari satu read transaction agar riwayat dan saldo konsisten. Backup database secara terjadwal; tidak ada endpoint hapus untuk riwayat harga/audit.

Admin menerima semua transaksi dan audit; karyawan hanya menerima produksi, pickup, penjualan, koreksi, pemakaian pakan, dan notifikasinya sendiri. `stock_movements` mencatat produksi, pengambilan, setiap pengembalian, dan delta koreksi dengan tanggal, referensi, serta jumlah bertanda positif/negatif; karyawan hanya menerima ledger miliknya. Saldo stok telur/pakan tetap berasal dari agregat seluruh peternakan, bukan data karyawan yang disaring. Karyawan tidak menerima hash password, token pengguna lain, audit admin, biaya pembelian pakan, atau email karyawan lain. Laporan, grafik, PDF/Excel, dan nota dirender frontend dari state ini.

Notifikasi harga tersimpan di database dan muncul saat frontend menyegarkan state/polling. Tidak ada push browser ketika aplikasi ditutup, layanan WhatsApp/SMS, atau notifikasi native.

## Pengujian nyata

`tests/integration.php` menjalankan pengujian melalui HTTP serta dua proses PHP bersamaan untuk race stok. **Tes menghapus tabel hanya pada database uji yang namanya berakhiran `_test`**, dan memerlukan `ALLOW_TEST_RESET=1`. Jangan menunjuk ke data production.

1. Buat database kosong terpisah, misalnya `ternaku_test`, dan arahkan `.env` serta server PHP ke database itu.
2. Jalankan `php -S 127.0.0.1:8081 router.php`.
3. Atur `SETUP_TOKEN` acak khusus pengujian, sama pada server PHP dan proses tes; jangan memakai kode production. Jalankan `ALLOW_TEST_RESET=1 php tests/integration.php` (PowerShell: `$env:ALLOW_TEST_RESET='1'; php tests/integration.php`). `TEST_API_URL` dapat mengganti alamat uji.

Suite memverifikasi login/hash token, pembatasan akses, CORS/metode, validasi angka/tanggal, produksi, pengambilan/penjualan/pengembalian berlebih, pembayaran, snapshot harga dan harga masa depan, koreksi/alasan/penguncian, pakan, isolasi karyawan, notifikasi, idempotensi, pencegahan menonaktifkan diri sendiri, race stok, pencabutan token, serta perlindungan direktori internal. Pengujian pendaftaran mencakup kode setup, persetujuan/penolakan, password Unicode, pembatasan percobaan, serta pendaftaran admin pertama dan email duplikat yang berjalan bersamaan. Lingkungan verifikasi pengembangan menggunakan MariaDB terisolasi pada port 33317 dengan data dalam `.test-db/` yang diabaikan Git; tidak mengubah database XAMPP yang sudah ada.
