# Petunjuk pemasangan API TernaKu

API TernaKu dipasang melalui File Manager hosting, seperti pola pemasangan RumahFlow. Targetnya **https://api.buildmanagement.id/ternaku**, dengan website di **https://ternaku.rstudiohub.com**. Gunakan folder dan database tersendiri agar pemasangan RumahFlow yang sudah ada tetap berjalan.

Panduan ini mengikuti paket dan installer TernaKu yang tersedia di repository. Pemasangan ke hosting dilakukan melalui langkah di bawah.

## 1. Siapkan hosting dan paket API

Siapkan PHP **8.2**, ekstensi `pdo_mysql`, `mbstring`, `json`, dan `openssl`, serta MySQL 5.7+/8.0 atau MariaDB 10.4+ dengan InnoDB. Aktifkan juga `curl` untuk notifikasi HP. Web server harus mendukung aturan `.htaccess` dan rewrite Apache. Gunakan HTTPS pada kedua domain. Runtime CodeIgniter 3 dan dependensi Web Push sudah ada dalam paket GitHub Actions terbaru; Composer hanya diperlukan bila menyiapkan dependensi langsung dari source. Node.js tidak diperlukan untuk menjalankan API.

Ambil paket dengan salah satu cara:

- Paket ZIP yang sudah diberikan: `ternaku-api.zip`.
- [GitHub Actions TernaKu](https://github.com/amaliasr/TernaKu/actions): buka proses build yang **berhasil**, unduh artifact **ternaku-api**, lalu buka ZIP hasil unduhan. Di dalamnya terdapat `ternaku-api.tar.gz`; ekstrak arsip tersebut juga. Apabila artifact sudah kedaluwarsa, jalankan workflow kembali melalui **Run workflow**.

Pastikan `.htaccess` ikut terbawa. Aktifkan tampilan file tersembunyi pada File Manager jika file yang diawali titik tidak terlihat.

## 2. Upload ke folder ternaku

Di panel hosting, cari **document root untuk domain `api.buildmanagement.id`**. Gunakan document root yang benar dari pengaturan domain; jangan menganggapnya selalu `public_html` akun utama.

Buat folder `ternaku` di dalam document root tersebut. Upload dan ekstrak **isi paket API** ke folder itu. Hasil akhirnya:

```text
document-root-api.buildmanagement.id/
├── rumahflow/                 ← aplikasi yang sudah ada
└── ternaku/
    ├── .htaccess
    ├── .env.example
    ├── index.php
    ├── schema.sql
    ├── CI-LICENSE.txt
    ├── README.md
    ├── PEMASANGAN.md
    ├── PUSH.md
    ├── composer.json
    ├── composer.lock
    ├── vendor/
    ├── application/
    │   ├── config/
    │   ├── controllers/
    │   ├── libraries/
    │   └── logs/
    ├── scripts/
    │   ├── env.php
    │   ├── install.php
    │   ├── push-keys.php
    │   └── push-worker.php
    └── system/
```

`index.php` harus langsung berada di `ternaku/index.php`, bukan `ternaku/api/index.php` atau `ternaku/ternaku-api/index.php`. Hapus arsip upload setelah ekstraksi selesai. Gunakan struktur paket TernaKu ini; layout `private/rumahflow-app` milik RumahFlow tidak digunakan oleh entrypoint TernaKu.

Sebelum mengisi rahasia database, periksa bahwa alamat berikut ditolak dengan **403 atau 404**:

- `https://api.buildmanagement.id/ternaku/.env.example`
- `https://api.buildmanagement.id/ternaku/schema.sql`
- `https://api.buildmanagement.id/ternaku/application/config/config.php`

Jika isi file dapat dilihat atau diunduh, minta hosting mengaktifkan aturan `.htaccess` sebelum melanjutkan. Pada Apache, folder aplikasi perlu izin override yang sesuai, misalnya `AllowOverride All`. Hosting Nginx murni membutuhkan konfigurasi server yang setara karena tidak membaca `.htaccess`.

## 3. Buat database MySQL

Pada menu database hosting:

1. Buat database baru khusus TernaKu, misalnya `akun_ternaku`.
2. Buat pengguna database, misalnya `akun_ternakuuser`, dengan password tersendiri.
3. Hubungkan pengguna tersebut ke database TernaKu dan berikan hak untuk membuat tabel serta membaca/menulis data pada database itu.
4. Pilih charset `utf8mb4`. Catat nama database, username, password, host, dan port **persis** seperti yang diberikan panel, termasuk awalan nama akun hosting.

Gunakan database kosong yang terpisah dari aplikasi lain. **Tidak perlu mengimpor `schema.sql` secara manual** jika menggunakan installer pada langkah 5. Mengimpor SQL saja belum membuat akun admin.

## 4. Buat file .env

Salin `.env.example` menjadi **`.env`** di folder `ternaku`, sejajar dengan `index.php`. Isi sebagai berikut dan ganti seluruh contoh koneksi database dengan nilai dari panel hosting:

```dotenv
APP_ENV=production
APP_URL=https://api.buildmanagement.id/ternaku
ALLOWED_ORIGINS=https://ternaku.rstudiohub.com
DB_HOST=localhost
DB_PORT=3306
DB_NAME=akun_ternaku
DB_USER=akun_ternakuuser
DB_PASSWORD="GANTI_DENGAN_PASSWORD_DATABASE"
```

`DB_HOST=localhost` di atas hanya contoh. Jika hosting memberikan `127.0.0.1` atau hostname lain, gunakan nilai tersebut. Tulis setiap pengaturan dalam satu baris dan jangan menambahkan komentar di belakang nilainya.

`APP_URL` tidak memakai `/index.php`, tambahan `/api`, atau garis miring di akhir. `ALLOWED_ORIGINS` berisi alamat website, tanpa path dan tanpa garis miring di akhir. Domain frontend final adalah **ternaku.rstudiohub.com**. Jika domain website berubah, pengaturan ini juga perlu diubah.

TernaKu membaca `.env` otomatis. Koneksi MySQL diambil dari `DB_*`; tidak perlu mengubah `application/config/database.php` atau menyalin pengaturan cookie/proxy RumahFlow. Jangan simpan `.env` di GitHub atau di folder website frontend.

Pastikan PHP dapat membaca `.env` dan menulis ke `application/logs/`. Umumnya direktori memakai izin 755 dan file 644; sesuaikan kepemilikan/izin baca `.env` dengan akun PHP hosting, misalnya 600 jika dimiliki pengguna yang sama. Jangan memakai izin 777 untuk seluruh aplikasi.

Periksa `https://api.buildmanagement.id/ternaku/.env`; hasilnya wajib **403/404**, tanpa menampilkan isi konfigurasi.

## 5. Buat admin pertama

Pilih **salah satu** cara berikut. Pembuatan admin pertama menyiapkan tabel, akun admin, dan sumber produksi `Kandang Ayam Utama`. Akun yang sudah ada tidak dihapus atau diganti.

### Melalui halaman Daftar

1. Buat kode setup acak yang panjangnya minimal 32 karakter. Contoh cara menghasilkan kode melalui PHP CLI adalah `php -r 'echo bin2hex(random_bytes(24)), PHP_EOL;'`. Simpan kode sebagai `SETUP_TOKEN` pada `.env` API. Kode ini hanya untuk pemilik hosting dan jangan dimasukkan ke environment frontend atau GitHub.
2. Buka **https://ternaku.rstudiohub.com**, lalu tekan **Daftar**. Jika belum ada akun, formulir menampilkan pembuatan admin pertama dan kolom kode setup.
3. Isi nama, email, kata sandi minimal 12 karakter, konfirmasi kata sandi, dan kode setup. Pendaftaran membentuk database yang diperlukan jika belum tersedia, setelah kode pemilik diverifikasi. Koneksi MySQL pada langkah 4 harus sudah benar.
4. Setelah berhasil, masuk dengan email dan kata sandi yang baru dibuat. Hapus `SETUP_TOKEN` dari `.env` setelah selesai. Pembuatan admin pertama tetap terkunci ketika akun sudah ada, meskipun kode belum dihapus.

Pengelola deployment juga dapat menyimpan kode di `application/config/setup-token.php` yang mengembalikan string PHP, sebagai alternatif `.env`. File tersebut dilindungi aturan server dan diabaikan Git; tidak ikut paket distribusi. `SETUP_TOKEN` yang diisi pada environment API menjadi sumber utama. Jangan menggunakan contoh kode yang sama untuk semua instalasi.

**Tombol Daftar tetap tersedia setelah admin dibuat.** Pendaftaran berikutnya menghasilkan akun karyawan berstatus **Menunggu persetujuan**. Admin membuka menu **Karyawan**, lalu menyetujui atau menolak permohonan. Karyawan baru dapat masuk setelah disetujui. Form publik tidak menyediakan pilihan admin; akun admin tambahan hanya dibuat oleh admin yang sudah masuk.

### Cara A — Terminal atau SSH hosting

Buka terminal hosting yang menggunakan Bash. Ganti path contoh dengan **path absolut folder `ternaku` di akun Anda**, lalu jalankan:

```bash
cd '/PATH/ABSOLUT/KE/ternaku'
php -v
```

Pastikan PHP CLI juga memakai versi 8.2; versi terminal bisa berbeda dari pengaturan PHP website. Bila berbeda, gunakan lokasi executable PHP 8.2 yang disediakan hosting sebagai pengganti `php`.

Masukkan email dan password admin melalui prompt berikut. Password minimal **12 karakter** dan tidak ditampilkan saat diketik:

```bash
read -r -p 'Email admin: ' ADMIN_EMAIL
read -r -s -p 'Password admin (minimal 12 karakter): ' ADMIN_PASSWORD
printf '\n'
export ADMIN_EMAIL ADMIN_PASSWORD
export ADMIN_NAME='Admin TernaKu'
php scripts/install.php
unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_NAME
```

Hasil pertama yang berhasil:

```text
Instalasi berhasil. Admin pertama dibuat; tetapkan harga telur di aplikasi sebelum mencatat penjualan.
```

Jika sudah ada akun, hasilnya `Schema siap. Akun yang sudah ada tidak diubah.` Menjalankan ulang installer **bukan** cara mengganti password atau menambah admin baru.

### Cara B — Tanpa SSH, memakai Cron Jobs sementara

Gunakan cara ini jika panel menyediakan Cron Jobs dengan perintah PHP CLI:

1. Setelah perlindungan `.env` dipastikan bekerja, tambahkan tiga baris sementara di `.env`:

   ```dotenv
   ADMIN_EMAIL=EMAIL_ADMIN_ANDA
   ADMIN_PASSWORD="GANTI_DENGAN_PASSWORD_ADMIN_MINIMAL_12_KARAKTER"
   ADMIN_NAME="Admin TernaKu"
   ```

2. Buat satu Cron Job sementara. Pilih PHP CLI 8.2 dari panel dan gunakan path absolut yang benar. Contoh bentuk perintah:

   ```bash
   /PATH/PHP82 /PATH/ABSOLUT/KE/ternaku/scripts/install.php >> /PATH/PRIVAT/ternaku-install.log 2>&1
   ```

   Semua bagian `/PATH/...` adalah contoh yang wajib diganti. Folder log harus sudah ada, dapat ditulis, dan berada **di luar document root** agar hasil installer tidak dipublikasikan. Jika ada spasi dalam path, bungkus path itu dengan tanda kutip. Lokasi executable PHP dan folder akun dapat dilihat dari panel atau ditanyakan ke dukungan hosting.

3. Jadwalkan eksekusi terdekat yang tersedia, lalu baca log dari File Manager. Tunggu pesan instalasi berhasil seperti pada Cara A.
4. **Hapus Cron Job** setelah berhasil dan hapus tiga baris `ADMIN_*` dari `.env`. Pengaturan database tetap disimpan. Hapus log instalasi setelah selesai diperiksa.

Jika memakai installer CLI, membuka `/scripts/install.php` melalui browser memang ditolak. Gunakan halaman **Daftar** di website untuk pembuatan admin melalui browser, seperti petunjuk di atas.

## 6. Periksa API dan login

Buka **https://api.buildmanagement.id/ternaku/health**. Respons yang benar berbentuk:

```json
{
  "data": {
    "status": "ok",
    "service": "TernaKu API",
    "framework": "CodeIgniter 3.1.13",
    "time": "2026-10-15T09:00:00+07:00"
  }
}
```

Nilai `time` mengikuti waktu server saat diperiksa; tanggal di atas hanya contoh. Endpoint ini memeriksa runtime dan koneksi database. **Status `ok` belum membuktikan tabel dan akun admin sudah dibuat**, sehingga login tetap perlu diuji setelah installer berhasil.

Alamat penting:

| Kebutuhan | Alamat dan metode |
| --- | --- |
| Cek API | `GET https://api.buildmanagement.id/ternaku/health` |
| Login dari aplikasi | `POST https://api.buildmanagement.id/ternaku/auth/login` |
| Status pendaftaran | `GET https://api.buildmanagement.id/ternaku/auth/registration-status` |
| Pendaftaran | `POST https://api.buildmanagement.id/ternaku/auth/register` |
| Data setelah login | `GET https://api.buildmanagement.id/ternaku/bootstrap` dengan bearer token |

Tidak ada tambahan `/api` setelah `/ternaku`. Membuka alamat login langsung melalui address bar mengirim GET, sehingga bukan cara menguji login.

## 7. Hubungkan website TernaKu

Frontend perlu dibangun dengan pengaturan berikut:

```dotenv
NEXT_PUBLIC_API_URL=https://api.buildmanagement.id/ternaku
NEXT_PUBLIC_DEMO_MODE=false
```

Workflow GitHub yang tersedia sudah memakai kedua nilai tersebut. Unduh artifact **ternaku-web** dari build yang berhasil, lalu upload **isinya** ke document root `ternaku.rstudiohub.com`. `index.html` dan folder `_next` harus langsung berada di document root frontend.

TernaKu menggunakan hasil static export Next.js. Hosting frontend cukup melayani file tersebut; tidak perlu `npm start`. URL API tertanam saat build, sehingga perubahan alamat API memerlukan build dan upload frontend ulang.

Setelah website terbuka:

1. Pastikan tidak ada label **DEMO**, lalu login memakai email/password admin yang dibuat installer. Akun demo `admin@ternaku.id` tidak otomatis dibuat di production.
2. Tetapkan harga telur bagus dan bentes yang sudah mulai berlaku.
3. Buat akun karyawan dan jenis pakan sesuai kebutuhan.
4. Catat data pertama yang benar, muat ulang halaman, lalu pastikan data tetap ada. Periksa pengambilan, penjualan, dan nota saat mulai bertransaksi.

Untuk mencoba transaksi fiktif, gunakan mode demo atau instalasi uji terpisah. Jangan menjalankan suite tes integrasi pada database operasional karena suite tersebut menghapus dan membuat ulang tabel database tes.

Halaman karyawan menyediakan Panen, Jual, dan Gudang dengan harga yang diperiksa setiap 5 detik ketika aplikasi terlihat. Admin juga dapat mencatat kegiatan operasional. Tema terang/gelap tersimpan pada perangkat, dan foto dapat diambil melalui kamera atau galeri. Untuk pembagian telur bentes gratis, masukkan harga bentes 0 atau pilih pemberian gratis pada penjualan, lalu isi nama penerima; stok tetap dihitung.

## 8. Aktifkan notifikasi harga ke HP

Ikuti **[panduan Web Push](PUSH.md)** untuk menyiapkan dependensi `vendor/`, kunci VAPID privat, dan cron pengiriman setiap menit. Pakai kunci yang sama pada deployment berikutnya dan simpan cadangannya secara privat. Tidak perlu mengganti database atau menambahkan rahasia ke frontend.

Setelah server siap, login pada HP dan tekan **Aktifkan notifikasi**, lalu beri izin. Tombol **Coba notifikasi** mengirim percobaan hanya ke perangkat tersebut. Pada iPhone/iPad, pasang TernaKu ke layar utama terlebih dahulu. Pembaruan harga tetap menghasilkan pemberitahuan meskipun nominalnya sama. Status `push_ready: true` pada health memeriksa kesiapan server; keberhasilan pengiriman perlu diperiksa pada perangkat sendiri.

## Jika muncul kendala

| Gejala | Yang perlu diperiksa |
| --- | --- |
| `/ternaku/health` menghasilkan 404 HTML dari hosting | Document root, letak `index.php`, file `.htaccess`, dan dukungan rewrite. Pastikan tidak ada folder `api/` ekstra hasil ekstraksi. |
| API membalas `Layanan belum siap atau terjadi kesalahan server` | Baca log terbaru di `application/logs/` atau log PHP hosting. Periksa `DB_HOST`, port, nama/user/password, hak pengguna database, serta ekstensi `pdo_mysql`. |
| Health `ok`, tetapi login gagal dengan error server | Pastikan installer selesai. Koneksi DB saja dapat berhasil meskipun tabel belum dibuat. |
| Email/password ditolak | Gunakan akun yang dibuat installer, bukan akun demo; pastikan akun aktif. Installer ulang tidak mereset password akun lama. |
| `Origin tidak diizinkan` atau kesalahan CORS | Cocokkan `ALLOWED_ORIGINS` dengan origin website secara persis: HTTPS, ejaan domain, dan port bila ada. Jangan memakai `*`. Pastikan respons bukan halaman error hosting. |
| Website masih menampilkan DEMO | Build ulang frontend dengan `NEXT_PUBLIC_DEMO_MODE=false`, upload hasil `out/` terbaru, lalu muat ulang halaman. |
| Form Daftar tidak bisa memuat status | Pasang pembaruan API yang menyediakan `/auth/registration-status` dan `/auth/register`, lalu periksa koneksi serta origin website. |
| Setup admin belum diaktifkan | Konfigurasikan kode setup minimal 32 karakter hanya pada server API. Pembuatan admin melalui browser sengaja dinonaktifkan jika kode belum disiapkan. |
| Akun baru belum bisa masuk | Admin harus menyetujui permohonan di menu Karyawan; tombol Daftar tidak memberi akses otomatis ke data peternakan. |
| Notifikasi HP belum siap atau tidak masuk | Periksa [panduan Web Push](PUSH.md), `push_ready`, cron, izin perangkat, dan koneksi. Pada iPhone/iPad, buka aplikasi dari layar utama. |
| Installer gagal atau tidak berjalan lewat Cron Jobs | Periksa path absolut, versi PHP CLI, ekstensi `pdo_mysql`, koneksi DB, dan izin folder log privat. |
| `.env` atau file internal dapat diunduh | Hentikan setup sampai aturan penolakan server berfungsi. Jika rahasia sudah terpapar, ganti password terkait. |

## Pembaruan API berikutnya

Sebelum memperbarui, cadangkan database MySQL, `.env`, dan `application/config/push-keys.php` bila tersedia di lokasi privat. Ekstrak paket terbaru sambil mempertahankan `.env` dan kunci push milik hosting. Ikuti petunjuk migrasi pada rilis jika ada; jangan mengosongkan database atau mengimpor data contoh. Installer awal tidak menggantikan migrasi schema untuk perubahan versi mendatang. Setelah pembaruan, periksa `/health`, login kembali, dan coba notifikasi pada perangkat sendiri.

### Pembaruan 24 Oktober 2026: sesi dan profil

Untuk API yang sudah memasang Web Push versi sebelumnya, paket **`ternaku-api-update-2026-10-24.zip`** hanya berisi `application/libraries/FarmService.php`. Cadangkan file lama, lalu ekstrak ZIP **di folder `public_html/ternaku/`** pada `api.buildmanagement.id`. Hasil akhirnya harus `public_html/ternaku/application/libraries/FarmService.php`; jangan membuat folder `api/` tambahan. `.env`, kunci setup/push, `vendor/`, dan data MySQL tetap dipertahankan. **Tidak ada migrasi SQL dan installer tidak perlu dijalankan ulang.**

Setelah frontend terbaru dipasang, akun tetap tersimpan ketika aplikasi ditutup. Server memperpanjang sesi sampai 30 hari sejak aktivitas terakhir, dengan batas 90 hari sejak login. Logout mencabut sesi; jaringan terputus tidak otomatis menghapus akun yang tersimpan. Pengaturan `TOKEN_TTL_HOURS` lama tidak lagi digunakan. Sesi yang telah kedaluwarsa sebelum pembaruan perlu login sekali lagi.

Menu profil menggunakan perintah `profile.update` untuk mengubah nama dan foto akun sendiri. Foto baru dikompres lalu diperiksa server sebagai JPEG/PNG/WebP maksimal **1 MiB (1.048.576 byte gambar asli setelah base64 didekode)**. Foto lama tetap bisa dibaca. Mengubah nama tanpa mengganti foto mempertahankan foto lama; menghapus foto mengirim nilai kosong. Perubahan profil tidak dapat mengganti email, kata sandi, peran, atau status akun. Setelah pemasangan, periksa `/health`, login, lalu pastikan akun tetap terbuka setelah aplikasi ditutup dan dibuka kembali.

## Perbedaan dengan pemasangan RumahFlow

| Bagian | TernaKu | RumahFlow pada konfigurasi proyek saat ini |
| --- | --- | --- |
| Folder API | `/ternaku` | `/rumahflow` |
| Database | MySQL/MariaDB, koneksi `DB_*` | SQLite pada penyimpanan privat |
| Konfigurasi | `.env` dibaca otomatis | Pengaturan lingkungan pada paket RumahFlow |
| Admin pertama | Halaman Daftar dengan kode setup pemilik, atau installer PHP CLI | Alur pendaftaran admin awal RumahFlow |
| Status API | `/ternaku/health` | `/rumahflow/api/auth/status` |
| Koneksi frontend | Langsung ke API, bearer token, `ALLOWED_ORIGINS` | Proxy Next.js dan cookie sesi |
| Frontend dua domain | Static export `out/` | Server Next.js dengan build/start |

Referensi proyek: [panduan API](README.md), [contoh konfigurasi](.env.example), [installer](scripts/install.php), dan [workflow paket deploy](https://github.com/amaliasr/TernaKu/blob/main/.github/workflows/ci.yml).
