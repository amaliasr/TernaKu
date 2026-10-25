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
| GET | `/bootstrap?compact=1` | State yang sama dengan referensi foto, tanpa base64 dalam riwayat/audit |
| GET | `/sync/prices` | Harga, notifikasi sendiri, pengguna aktif tanpa foto, dan pengaturan |
| GET | `/media/{kind}/{id}` | Gambar biner privat; kind `production`, `sale`, atau `profile` |
| POST | `/commands` | `{action,payload,request_id?}` → State terbaru |

Semua respons berhasil dibungkus `{"data":...}` dan kesalahan `{"error":"pesan"}`. Permintaan tulis memakai `Content-Type: application/json`; setelah login gunakan `Authorization: Bearer <token>`. Token acak disimpan sebagai hash SHA-256. Setiap permintaan terautentikasi memperpanjang sesi hingga 30 hari sejak aktivitas terakhir, dengan batas mutlak 90 hari sejak login. Logout dan penonaktifan akun mencabut token. `TOKEN_TTL_HOURS` lama tidak digunakan lagi. Frontend menyimpan sesi di perangkat, memindahkan sesi tab versi lama secara otomatis, dan mempertahankannya saat koneksi terputus; respons 401 meminta login kembali. Percobaan login dibatasi 10 per pasangan IP/email per 15 menit. CORS hanya mengizinkan origin yang tercantum, tidak memakai `*` dan tidak bergantung pada cookie.

Tombol **Daftar** tetap tersedia setelah admin dibuat. Pendaftaran pertama memerlukan tabel pengguna kosong dan kode pemilik acak `SETUP_TOKEN` (minimal 32 karakter), atau file terlindungi `application/config/setup-token.php` yang mengembalikan kode tersebut. Pendaftaran berikutnya selalu menjadi karyawan peternakan yang sama dengan status menunggu; admin menyetujui atau menolak melalui menu Karyawan. Form pendaftaran tidak boleh menentukan role/aktivasi sendiri dan tidak menghasilkan token login. Password pendaftaran minimal 12 karakter Unicode dan maksimal 72 byte UTF-8; spasi dipertahankan. Pendaftaran dibatasi 10 percobaan per IP dan 5 per email dalam 15 menit. Status pendaftaran disimpan di tabel `records`, sehingga pemasangan lama tidak memerlukan migrasi skema. Akun lama tetap dianggap disetujui. Hapus kode setup setelah admin pertama berhasil dibuat, dan jangan masukkan kode/password ke Git atau paket deployment.

`request_id` opsional disarankan untuk seluruh penulisan: gunakan UUID baru untuk suatu tindakan, pertahankan UUID tersebut ketika mengulangi permintaan yang hasilnya tidak diketahui karena jaringan putus. Permintaan identik dengan ID yang sama dari pengguna yang sama tidak menulis ulang data; payload berbeda dengan ID sama menghasilkan 409. Kunci disimpan atomik bersama perubahan. Gunakan UUID baru untuk tindakan baru yang memang ingin dicatat dua kali.

Status: 400 JSON tidak valid, 401 sesi tidak sah, 403 hak/origin ditolak, 404 data/endpoint tidak ditemukan, 405 metode salah, 409 konflik idempotensi, 413 terlalu besar, 415 tipe konten salah, 422 validasi bisnis, 429 pembatasan login, 500 kesalahan server. Body maksimal 3 MB. Foto baru harus berupa data URL JPEG/PNG/WebP, maksimal **1 MiB (1.048.576 byte setelah base64 didekode)**. Server memeriksa isi gambar dan kesesuaian MIME; URL eksternal tidak diterima sebagai unggahan baru. Frontend mengompres sebelum mengirim. Foto lama tetap dapat dibaca, termasuk yang melebihi batas baru; belum ada layanan upload/CDN terpisah.

## Perintah

Nama kolom dan struktur respons mengikuti `../src/lib/types.ts` dan `../CONTRACT.md`. ID adalah string; kategori `good`/`cracked`, role `admin`/`employee`, metode pembayaran `cash`/`transfer`/`qris`/`credit`.

| Perintah | Payload utama | Hak |
| --- | --- | --- |
| `production.create` | date, barn_id, category, eggs, kg, trays, notes, photo?, location? | Semua, pencatat otomatis |
| `production.receive` | id | Pemilik panen/admin; seluruh panen satu kali |
| `settings.update` | harvest_auto_stock:boolean | Admin |
| `pickup.create` | date, category, eggs, kg, trays, area, notes | Semua, pengambil otomatis |
| `pickup.return` | id, eggs, kg, trays, notes | Pemilik/admin |
| `sale.create` | date, customer, phone?, items[{pickup_id,category,eggs,kg,trays}], payment_method, paid, notes, photo, expected_price_id? | Pengambilan sendiri; nama pelanggan dan foto dokumentasi wajib |
| `sale.payment` | id, amount | Pemilik/admin |
| `price.create` | good_price, cracked_price, effective_at | Admin |
| `user.create` | name, email, password, role, target | Admin |
| `user.update` | id, name?, email?, photo?, active?, target? | Admin; perubahan email/foto hanya untuk akun karyawan |
| `profile.update` | name, photo? | Akun sendiri, admin maupun karyawan |
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

`profile.update` menerima nama 1–120 karakter dan foto opsional. Foto yang tidak dikirim dipertahankan; `photo: ""` menghapusnya. Untuk perubahan nama saja, jangan mengirim ulang foto lama agar batas unggahan baru tidak diterapkan pada foto tersebut. Identitas pengguna selalu berasal dari token; kolom lain seperti `id`, `role`, `active`, `email`, dan `password` ditolak. Profil disimpan memakai `users` dan record privat `user_profile`, tanpa migrasi skema.

Admin dapat mengedit nama, email login, target, dan foto karyawan melalui `user.update`. Email dinormalisasi dan harus unik. Foto yang tidak dikirim tetap dipertahankan; `photo: ""` menghapus foto. Perubahan ini tidak mengubah kata sandi, peran, maupun status persetujuan pendaftaran. Akun yang masih menunggu persetujuan tetap harus disetujui melalui `user.approve`. Log perubahan menyimpan metadata tanpa isi gambar.

Setiap penjualan baru, termasuk telur gratis, wajib memuat nama pelanggan/penerima yang tidak kosong dan foto dokumentasi penjualan yang valid, maksimal 1 MB setelah kompresi. Nomor HP tetap opsional. Aturan ini berlaku untuk admin maupun karyawan. Transaksi lama tetap dapat dibaca dan dibayar tanpa harus menambahkan foto, tetapi koreksi nama pelanggan tidak boleh mengosongkannya.

Notifikasi harga tersimpan di database dan muncul saat frontend menyegarkan state/polling. Web Push juga tersedia ketika aplikasi ditutup setelah pengguna mengaktifkannya; lihat [panduan Web Push](PUSH.md). Tidak ada layanan WhatsApp/SMS.

## Pembaruan 24 Oktober 2026

Untuk instalasi yang sudah memakai versi Web Push sebelumnya, cadangkan lalu ganti hanya `application/libraries/FarmService.php` di folder API `public_html/ternaku/`. Paket `ternaku-api-update-2026-10-24.zip` berisi path relatif tersebut; ekstrak langsung di `ternaku/`, bukan di `public_html/` atau `ternaku/api/`. Pertahankan `.env`, kunci setup/push, `vendor/`, dan database. Tidak perlu menjalankan installer atau migrasi SQL. Sesi lama yang sudah kedaluwarsa perlu login sekali lagi; sesi yang masih aktif diperpanjang saat digunakan. Deploy frontend terbaru agar profil dan penyimpanan sesi tersedia.

## Pembaruan 25 Oktober 2026: stok panen dan respons ringan

Pembaruan API ini mengganti **tiga file**: `application/libraries/FarmService.php`, `application/controllers/Api.php`, dan `application/config/routes.php`. Deploy API terlebih dahulu, kemudian frontend. Pertahankan `.env`, kunci setup/push, `vendor/`, serta data. Tidak ada migrasi SQL atau pemindahan foto: pengaturan dan konfirmasi command menggunakan tabel `records` yang sudah ada. Client lama tetap mendapat respons lengkap tanpa harus diubah bersamaan.

`settings.harvest_auto_stock` bernilai `true` jika belum diatur, mempertahankan perilaku sebelumnya. Admin dapat menggantinya melalui `settings.update`. Ketika nonaktif, `production.create` menyimpan panen dengan `stocked_at: null` dan `stocked_by: null`, tanpa menambah stok atau ledger. Pemilik/admin menerima seluruh batch melalui `production.receive`; waktu/penerima ditentukan server, saldo bertambah satu kali, dan satu pergerakan `production` dicatat pada waktu penerimaan. Pengulangan dengan request ID yang sama bersifat idempoten; permintaan baru setelah diterima ditolak 409. Mengaktifkan kembali pengaturan tidak otomatis menerima panen yang masih menunggu. Koreksi kuantitas panen yang menunggu tidak menyentuh stok; setelah diterima koreksi kembali menyesuaikan saldo dan ledger. Data produksi lama yang **tidak mempunyai kolom** `stocked_at` dianggap sudah diterima, sehingga tidak terjadi penggandaan stok setelah upgrade.

Untuk klien baru, ambil state lengkap melalui `/bootstrap?compact=1` (atau `compact=true`), dan tambahkan `response_mode: "compact"` di luar `payload` pada `/commands`. State ringkas mengganti foto produksi, bukti penjualan, dan profil dengan `photo: ""` serta `photo_ref: {kind,id,version}` jika gambar ada. `version` adalah SHA-256, 64 karakter heksadesimal kecil. Foto dalam snapshot audit juga dikeluarkan dari respons ringkas, sementara data asli tetap tersimpan. Tanpa parameter ini respons lama tetap berisi foto untuk kompatibilitas. Kolom milik karyawan disaring dalam SQL sebelum JSON dibaca; koleksi pembelian dan audit admin tidak diambil sama sekali untuk karyawan. Metadata profil/pendaftaran pengguna dibaca secara kelompok untuk menghindari query berulang per pengguna.

`POST /auth/login` juga menerima `response_mode: "compact"` bersama email/password. Respons login tetap `{token,user}`, dengan foto profil berupa referensi yang sama. Tanpa parameter tersebut respons login lama tetap berlaku.

Frontend dapat memanggil `/sync/prices` setiap **5 detik** tanpa mengunduh transaksi/foto. Hasilnya `{prices,notifications,user,settings}`; `user` sengaja tidak berisi `photo` atau `photo_ref`, sehingga client mempertahankan foto yang sudah dimilikinya. Endpoint ini tetap memeriksa token, status pendaftaran, dan aktivasi akun pada setiap permintaan. State lengkap dapat disegarkan lebih jarang, setelah penulisan, atau saat pengguna meminta refresh. Harga terjadwal tetap disertakan agar tampilan dapat mengaktifkannya pada waktu yang tepat.

Ambil foto hanya ketika diperlukan menggunakan bearer token pada `GET /media/{kind}/{id}?v={version}`. Untuk profil, `id` adalah ID pengguna. Respons adalah byte gambar asli dengan MIME tervalidasi, `ETag`, dan `Cache-Control: private, no-store`. Karyawan hanya dapat membaca foto catatan/profilnya; admin dapat membaca semuanya. Parameter `v` adalah identitas cache client, bukan pengganti autentikasi. Tidak ada token dalam URL, redirect ke URL eksternal, atau perubahan penyimpanan gambar. Cache Blob di memori client harus dibatasi dan dibersihkan ketika sesi berganti.

Respons `sale.create` kini menyertakan `state.command_result: {action:"sale.create",record_id,request_id}`. Gunakan `record_id` tersebut untuk menampilkan/mencetak nota dari state yang dikembalikan, bukan menebak penjualan terbaru atau menunggu render state React. Saat request ID disertakan, ID transaksi hasil commit disimpan secara atomik dalam record privat `command_result`; retry setelah respons hilang mengembalikan ID penjualan yang sama meskipun ada transaksi lain sesudahnya. `response_mode` tidak termasuk fingerprint penulisan, sehingga retry dapat berganti format respons tanpa menggandakan penjualan.

## Pengujian nyata

`tests/integration.php` menjalankan pengujian melalui HTTP serta dua proses PHP bersamaan untuk race stok. **Tes menghapus tabel hanya pada database uji yang namanya berakhiran `_test`**, dan memerlukan `ALLOW_TEST_RESET=1`. Jangan menunjuk ke data production.

1. Buat database kosong terpisah, misalnya `ternaku_test`, dan arahkan `.env` serta server PHP ke database itu.
2. Jalankan `php -S 127.0.0.1:8081 router.php`.
3. Atur `SETUP_TOKEN` acak khusus pengujian, sama pada server PHP dan proses tes; jangan memakai kode production. Jalankan `ALLOW_TEST_RESET=1 php tests/integration.php` (PowerShell: `$env:ALLOW_TEST_RESET='1'; php tests/integration.php`). `TEST_API_URL` dapat mengganti alamat uji.

Suite memverifikasi login/hash token, pembatasan akses, CORS/metode, validasi angka/tanggal, produksi, pengambilan/penjualan/pengembalian berlebih, pembayaran, snapshot harga dan harga masa depan, koreksi/alasan/penguncian, pakan, isolasi karyawan, notifikasi, idempotensi, pencegahan menonaktifkan diri sendiri, race stok, pencabutan token, serta perlindungan direktori internal. Pengujian pendaftaran mencakup kode setup, persetujuan/penolakan, password Unicode, pembatasan percobaan, serta pendaftaran admin pertama dan email duplikat yang berjalan bersamaan. Lingkungan verifikasi pengembangan menggunakan MariaDB terisolasi pada port 33317 dengan data dalam `.test-db/` yang diabaikan Git; tidak mengubah database XAMPP yang sudah ada.
