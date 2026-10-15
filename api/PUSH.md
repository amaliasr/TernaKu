# Notifikasi harga ke HP

Web Push memberi notifikasi ketika admin menyimpan harga, termasuk ketika nominalnya sama. Penjadwalan harga tetap mengikuti `effective_at`; pemberitahuan menyebut tanggal mulai berlaku. Notifikasi berjalan melalui layanan browser walaupun halaman TernaKu ditutup. Pengiriman perangkat tetap bergantung pada izin notifikasi, koneksi, dan aturan sistem HP.

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

Jalankan pengujian hanya pada database khusus `_test`: `php api/tests/push.php`. Pengujian pengiriman menggunakan mock dan tidak mengirim ke perangkat nyata.
