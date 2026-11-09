# Notifikasi harga ke HP

Web Push memberi notifikasi ketika admin menyimpan harga, termasuk ketika nominalnya sama. Penjadwalan harga tetap mengikuti `effective_at`; pemberitahuan menyebut tanggal mulai berlaku. Notifikasi berjalan melalui layanan browser walaupun halaman TernaKu ditutup. Pengiriman perangkat tetap bergantung pada izin notifikasi, koneksi, dan aturan sistem HP.

## Isi notifikasi

`application/libraries/NotificationText.php` menyusun satu pesan yang sama untuk kotak notifikasi aplikasi, Web Push, dan push native. Pembaruan ini tidak memerlukan migrasi database. Pesan yang sudah tersimpan atau sedang antre tidak ditulis ulang.

- **Harga:** nama depan petugas, waktu disimpan, waktu mulai berlaku, satu harga Telur Bagus (SKM dan SKM Baru), serta harga Bentes. Harga Bentes nol ditulis **Gratis (Rp0/kg)**. Setiap penyimpanan baru tetap memiliki ID kejadian sendiri, walaupun nominalnya sama.
- **Penjualan:** nomor nota, tanggal transaksi, waktu pencatatan, rincian dan total butir/kg/krat untuk SKM, SKM Baru, dan Bentes, total penjualan, jumlah dibayar, sisa tagihan, status/metode pembayaran, serta asal stok (gudang atau bawaan karyawan). Butir hasil perhitungan ditandai **perkiraan**.
- **Panen:** tanggal panen, waktu pencatatan, rincian tiga jenis dan total, serta keterangan **Sudah masuk** gudang atau **Menunggu diterima**. Penerimaan panen, pengembalian telur, dan penambahan stok juga menyertakan jumlah yang benar-benar berpindah serta waktu pencatatannya.

Waktu selalu memakai `dd/mm/yyyy HH:mm:ss WIB`, terlepas dari zona waktu server. Tanggal bisnis yang hanya berisi tanggal tetap ditulis `dd/mm/yyyy`; waktu kejadian tidak dibuat-buat. Jika waktu pencatatan lama hanya berupa tanggal, pesan menyebut **jam tidak tercatat**. Tanggal mulai harga tanpa jam berarti tengah malam WIB sesuai aturan aktivasi harga.

Nama pelanggan, nomor telepon, email, foto, catatan bebas, lokasi, dan nama kandang tidak dimasukkan ke pesan yang dapat muncul di layar terkunci. Nama petugas dibatasi pada nama depan yang valid, maksimal 32 karakter. Nomor nota harus mengikuti pola aplikasi. Pesan maksimal 1.000 karakter, dengan tiga jenis telur yang dijumlahkan agar rincian tetap muat pada payload push. Tampilan ringkas banner mengikuti sistem HP; rincian lengkap tersedia saat notifikasi diperluas atau dibuka di aplikasi.

## Pemasangan server

1. Gunakan PHP 8.2+ dengan `curl`, `openssl`, `mbstring`, dan `pdo_mysql`.
2. Di folder API jalankan `composer install --no-dev --prefer-dist --no-interaction`. Upload folder `vendor/` beserta `composer.json` dan `composer.lock` jika Composer tidak tersedia di hosting. File `.htaccess` terbaru memblokir akses web ke `vendor/`.
3. Jalankan `php scripts/push-keys.php` sekali. Script menyimpan kunci VAPID ke `application/config/push-keys.php` dan tidak mencetak kunci privat. Jika dijalankan lokal, upload file tersebut hanya ke folder konfigurasi API yang terlindung. Simpan cadangan privat. Jangan mengganti kunci setiap deployment karena langganan browser memakai kunci yang sama.
4. Buat cron setiap menit:

   ```text
   /opt/alt/php83/usr/bin/php /home/u853800235/domains/api.buildmanagement.id/public_html/ternaku/scripts/push-worker.php --limit=50
   ```

5. Periksa `/health`: `push_ready: true` berarti dependensi dan kunci tersedia. Ini bukan bukti izin HP atau keberhasilan pengiriman. Login di HP, aktifkan notifikasi dari aplikasi, lalu gunakan tombol coba notifikasi pada perangkat sendiri.

Tidak ada migrasi tabel atau perubahan `.env` yang diperlukan. Alternatif konfigurasi melalui environment: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`. Jangan masukkan kunci privat ke variabel `NEXT_PUBLIC_*`, GitHub, atau arsip unduhan publik.

## Endpoint (Bearer token wajib)

| Endpoint | Body | Respons data |
|---|---|---|
| `GET /push/status` | — | `enabled`, `public_key` |
| `POST /push/subscribe` | JSON `PushSubscription.toJSON()` berisi `endpoint`, `keys.p256dh`, `keys.auth` | `subscribed: true`, `binding_id` |
| `POST /push/unsubscribe` | `{ "endpoint": "…" }` | `subscribed: false` |
| `POST /push/test` | `{ "endpoint": "…" }` | `queued: true` |

Tes dibatasi sekali per menit per perangkat. Akun yang belum disetujui tidak dapat berlangganan. Logout menghapus langganan yang terikat ke sesi tersebut; frontend juga melepaskan langganan browser. Pergantian pengguna membuat binding baru, sehingga antrean pengguna sebelumnya tidak ikut dikirim.

## Antrean dan pemulihan

Langganan dan antrean disimpan sebagai record privat `push_subscription` dan `push_job`, tidak masuk `/bootstrap` atau ekspor laporan. Antrean dibuat dalam transaksi database yang sama dengan harga. Pengulangan UUID perintah yang sama tidak menambah antrean. Harga baru dengan angka sama memiliki ID harga baru dan notifikasi tersendiri.

API mencoba pengiriman terbatas setelah harga tersimpan. Cron melanjutkan antrean dan mengulang kegagalan jaringan dengan jeda bertahap, maksimal satu jam, sampai tujuh hari. Endpoint yang kedaluwarsa dihapus. Struk pengiriman disimpan 30 hari. Gangguan push tidak membatalkan harga yang sudah tersimpan. Tidak ada harga lama yang digunakan untuk menghitung transaksi baru.

Endpoint pengiriman hanya mengizinkan layanan HTTPS milik Google, Mozilla, Apple, dan Windows. Pengalihan HTTP dinonaktifkan; alamat DNS harus publik dan dipasangkan ke koneksi TLS. Payload dienkripsi menggunakan `minishlink/web-push`, bukan kriptografi buatan aplikasi.

Jalankan pengujian hanya pada database khusus `_test`: `php api/tests/push.php`. Pengujian pengiriman menggunakan mock dan tidak mengirim ke perangkat nyata. Uji format murni tanpa database tersedia melalui `php api/tests/notification-text.php`; uji ini juga memeriksa batas ukuran payload Web Push/APNs, privasi, pengelompokan jenis, serta waktu WIB ketika zona waktu server berbeda.

## Notifikasi dari aplikasi Android dan iOS

Satu penyimpanan harga membuat satu kejadian dengan ID tersendiri, termasuk saat nominalnya sama dengan harga sebelumnya. Ketiga kanal menggunakan antrean yang sama. Pemasangan kredensial setiap kanal bisa dilakukan secara terpisah.

- **Android** memakai Firebase Cloud Messaging HTTP v1. Aktifkan Firebase Cloud Messaging API di proyek yang digunakan oleh aplikasi `com.rstudiohub.ternaku`. Beri akun layanan izin mengirim pesan FCM dan pasang JSON akun layanan sebagai berkas privat. Isi `FCM_SERVICE_ACCOUNT_FILE` dengan path berkas tersebut. Pesan Android membawa ID harga, judul, dan isi sebagai data berprioritas tinggi. Aplikasi menampilkan setiap kejadian melalui kanal harga.
- **iOS** memakai APNs melalui HTTP/2. Aktifkan Push Notifications untuk App ID TernaKu, pasang kunci penandatanganan APNs berformat `.p8` sebagai berkas privat, lalu isi `APNS_PRIVATE_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, dan `APNS_BUNDLE_ID` (default `com.rstudiohub.ternaku`). PHP cURL harus mendukung HTTP/2. Aplikasi menyertakan lingkungan APNs saat mendaftar agar build pengembangan menggunakan sandbox dan build distribusi menggunakan produksi.

Pasang berkas di luar document root. Berikan akun proses API dan worker akses baca. Pada VPS Docker gunakan mount hanya-baca untuk keduanya. Uji dari HP melalui **Coba notifikasi**. Status kredensial lokal terlihat di `GET /push/status` pada `native.android` dan `native.ios`. Pengiriman ke HP membuktikan bahwa izin akun layanan, lingkungan, dan konfigurasi aplikasi sesuai.

Ketiga endpoint berikut menggunakan bearer token sesi pengguna. Pengguna ditentukan oleh server.

| Endpoint POST | Data |
|---|---|
| `/push/native/subscribe` | `platform` (`android` atau `ios`), `installation_id` (UUID), `token`, dan khusus iOS `environment` (`sandbox` atau `production`). Respons `subscribed` dan `binding_id`. |
| `/push/native/unsubscribe` | `platform` dan `installation_id` |
| `/push/native/test` | `platform` dan `installation_id`. Maksimal sekali per menit per perangkat. |

Karyawan perlu mengizinkan notifikasi. Android dan iOS mengikuti pengaturan banner, suara, dan mode fokus pada masing-masing HP. Untuk uji perangkat, simpan dua pembaruan harga dengan nominal sama di lingkungan uji, tutup aplikasi secara biasa, lalu cocokkan kedua notifikasi dan waktu berlakunya.
