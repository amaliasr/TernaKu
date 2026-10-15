# Petunjuk pemasangan API TernaKu

API TernaKu dipasang melalui File Manager hosting, seperti pola pemasangan RumahFlow. Targetnya **https://api.buildmanagement.id/ternaku**, dengan website di **https://ternakku.rstudio.com**. Gunakan folder dan database tersendiri agar pemasangan RumahFlow yang sudah ada tetap berjalan.

Panduan ini mengikuti paket dan installer TernaKu yang tersedia di repository. Pemasangan ke hosting dilakukan melalui langkah di bawah.

## 1. Siapkan hosting dan paket API

Siapkan PHP **8.2**, ekstensi `pdo_mysql`, `mbstring`, `json`, dan `openssl`, serta MySQL 5.7+/8.0 atau MariaDB 10.4+ dengan InnoDB. Web server harus mendukung aturan `.htaccess` dan rewrite Apache. Gunakan HTTPS pada kedua domain. Runtime CodeIgniter 3 sudah ada dalam paket; Composer dan Node.js tidak diperlukan untuk menjalankan API.

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
    ├── application/
    │   ├── config/
    │   ├── controllers/
    │   ├── libraries/
    │   └── logs/
    ├── scripts/
    │   ├── env.php
    │   └── install.php
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
ALLOWED_ORIGINS=https://ternakku.rstudio.com
DB_HOST=localhost
DB_PORT=3306
DB_NAME=akun_ternaku
DB_USER=akun_ternakuuser
DB_PASSWORD="GANTI_DENGAN_PASSWORD_DATABASE"
TOKEN_TTL_HOURS=12
```

`DB_HOST=localhost` di atas hanya contoh. Jika hosting memberikan `127.0.0.1` atau hostname lain, gunakan nilai tersebut. Tulis setiap pengaturan dalam satu baris dan jangan menambahkan komentar di belakang nilainya.

`APP_URL` tidak memakai `/index.php`, tambahan `/api`, atau garis miring di akhir. `ALLOWED_ORIGINS` berisi alamat website, tanpa path dan tanpa garis miring di akhir. Domain tujuan memakai **ternakku** dengan dua huruf **k**. Jika domain website berubah, pengaturan ini juga perlu diubah.

TernaKu membaca `.env` otomatis. Koneksi MySQL diambil dari `DB_*`; tidak perlu mengubah `application/config/database.php` atau menyalin pengaturan cookie/proxy RumahFlow. Jangan simpan `.env` di GitHub atau di folder website frontend.

Pastikan PHP dapat membaca `.env` dan menulis ke `application/logs/`. Umumnya direktori memakai izin 755 dan file 644; sesuaikan kepemilikan/izin baca `.env` dengan akun PHP hosting, misalnya 600 jika dimiliki pengguna yang sama. Jangan memakai izin 777 untuk seluruh aplikasi.

Periksa `https://api.buildmanagement.id/ternaku/.env`; hasilnya wajib **403/404**, tanpa menampilkan isi konfigurasi.

## 5. Jalankan installer untuk membuat admin

Pilih **salah satu** cara berikut. Installer membuat tabel, akun admin pertama, dan sumber produksi `Kandang Ayam Utama`. Installer ini hanya dapat berjalan melalui PHP CLI; membuka `/scripts/install.php` di browser memang ditolak.

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

Jika hosting tidak menyediakan Terminal maupun Cron Jobs PHP CLI, siapkan tiga baris `ADMIN_*` sementara seperti Cara B, lalu minta dukungan hosting menjalankan `php scripts/install.php` sekali dari folder API. Setelah berhasil, hapus kembali ketiga baris tersebut. Installer web melalui browser belum tersedia pada versi ini.

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
| Data setelah login | `GET https://api.buildmanagement.id/ternaku/bootstrap` dengan bearer token |

Tidak ada tambahan `/api` setelah `/ternaku`. Membuka alamat login langsung melalui address bar mengirim GET, sehingga bukan cara menguji login.

## 7. Hubungkan website TernaKu

Frontend perlu dibangun dengan pengaturan berikut:

```dotenv
NEXT_PUBLIC_API_URL=https://api.buildmanagement.id/ternaku
NEXT_PUBLIC_DEMO_MODE=false
```

Workflow GitHub yang tersedia sudah memakai kedua nilai tersebut. Unduh artifact **ternaku-web** dari build yang berhasil, lalu upload **isinya** ke document root `ternakku.rstudio.com`. `index.html` dan folder `_next` harus langsung berada di document root frontend.

TernaKu menggunakan hasil static export Next.js. Hosting frontend cukup melayani file tersebut; tidak perlu `npm start`. URL API tertanam saat build, sehingga perubahan alamat API memerlukan build dan upload frontend ulang.

Setelah website terbuka:

1. Pastikan tidak ada label **DEMO**, lalu login memakai email/password admin yang dibuat installer. Akun demo `admin@ternaku.id` tidak otomatis dibuat di production.
2. Tetapkan harga telur bagus dan bentes yang sudah mulai berlaku.
3. Buat akun karyawan dan jenis pakan sesuai kebutuhan.
4. Catat data pertama yang benar, muat ulang halaman, lalu pastikan data tetap ada. Periksa pengambilan, penjualan, dan nota saat mulai bertransaksi.

Untuk mencoba transaksi fiktif, gunakan mode demo atau instalasi uji terpisah. Jangan menjalankan suite tes integrasi pada database operasional karena suite tersebut menghapus dan membuat ulang tabel database tes.

## Jika muncul kendala

| Gejala | Yang perlu diperiksa |
| --- | --- |
| `/ternaku/health` menghasilkan 404 HTML dari hosting | Document root, letak `index.php`, file `.htaccess`, dan dukungan rewrite. Pastikan tidak ada folder `api/` ekstra hasil ekstraksi. |
| API membalas `Layanan belum siap atau terjadi kesalahan server` | Baca log terbaru di `application/logs/` atau log PHP hosting. Periksa `DB_HOST`, port, nama/user/password, hak pengguna database, serta ekstensi `pdo_mysql`. |
| Health `ok`, tetapi login gagal dengan error server | Pastikan installer selesai. Koneksi DB saja dapat berhasil meskipun tabel belum dibuat. |
| Email/password ditolak | Gunakan akun yang dibuat installer, bukan akun demo; pastikan akun aktif. Installer ulang tidak mereset password akun lama. |
| `Origin tidak diizinkan` atau kesalahan CORS | Cocokkan `ALLOWED_ORIGINS` dengan origin website secara persis: HTTPS, ejaan domain, dan port bila ada. Jangan memakai `*`. Pastikan respons bukan halaman error hosting. |
| Website masih menampilkan DEMO | Build ulang frontend dengan `NEXT_PUBLIC_DEMO_MODE=false`, upload hasil `out/` terbaru, lalu muat ulang halaman. |
| Installer gagal atau tidak berjalan lewat Cron Jobs | Periksa path absolut, versi PHP CLI, ekstensi `pdo_mysql`, koneksi DB, dan izin folder log privat. |
| `.env` atau file internal dapat diunduh | Hentikan setup sampai aturan penolakan server berfungsi. Jika rahasia sudah terpapar, ganti password terkait. |

## Pembaruan API berikutnya

Sebelum memperbarui, cadangkan database MySQL dan `.env` di lokasi privat. Ekstrak paket terbaru sambil mempertahankan `.env` milik hosting. Ikuti petunjuk migrasi pada rilis jika ada; jangan mengosongkan database atau mengimpor data contoh. Installer awal tidak menggantikan migrasi schema untuk perubahan versi mendatang. Setelah pembaruan, periksa `/health` dan login kembali.

## Perbedaan dengan pemasangan RumahFlow

| Bagian | TernaKu | RumahFlow pada konfigurasi proyek saat ini |
| --- | --- | --- |
| Folder API | `/ternaku` | `/rumahflow` |
| Database | MySQL/MariaDB, koneksi `DB_*` | SQLite pada penyimpanan privat |
| Konfigurasi | `.env` dibaca otomatis | Pengaturan lingkungan pada paket RumahFlow |
| Admin pertama | Installer PHP CLI | Alur pendaftaran admin awal RumahFlow |
| Status API | `/ternaku/health` | `/rumahflow/api/auth/status` |
| Koneksi frontend | Langsung ke API, bearer token, `ALLOWED_ORIGINS` | Proxy Next.js dan cookie sesi |
| Frontend dua domain | Static export `out/` | Server Next.js dengan build/start |

Referensi proyek: [panduan API](README.md), [contoh konfigurasi](.env.example), [installer](scripts/install.php), dan [workflow paket deploy](https://github.com/amaliasr/TernaKu/blob/main/.github/workflows/ci.yml).
