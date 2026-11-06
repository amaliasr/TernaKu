# TernaKu staging di VPS

Compose menjalankan frontend, API CodeIgniter, dan MySQL dalam project **ternaku-staging**. Karyawan membuka frontend di `/` dan browser mengakses API melalui `/ternaku/` pada origin yang sama. Hanya nginx yang membuka port pada loopback VPS. Database, jaringan, dan volume khusus project ini dibuat oleh Compose.

## Jalankan staging baru

Gunakan Docker Engine Linux dengan BuildKit dan Docker Compose 2.20+ pada VPS. Build membutuhkan akses ke registry image, npm, dan Composer. Jalankan perintah berikut dari root checkout TernaKu dengan Bash. Pilih port loopback yang masih kosong.

1. Buat konfigurasi privat di luar checkout. Contoh ini memakai database baru dan menyiapkan kode pendaftaran pemilik pertama.

   ```bash
   sudo install -d -m 0700 /etc/ternaku-staging
   sudo bash -c '
     set -e -C
     umask 077
     {
       printf "STAGING_ORIGIN=http://localhost:18182\nSTAGING_PORT=18182\n"
       printf "STAGING_DB_PASSWORD=%s\n" "$(openssl rand -hex 32)"
       printf "STAGING_DB_ROOT_PASSWORD=%s\n" "$(openssl rand -hex 32)"
       printf "STAGING_SETUP_TOKEN=%s\n" "$(openssl rand -hex 32)"
     } > /etc/ternaku-staging/runtime.env
   '
   ```

   Jika staging memakai hostname HTTPS sendiri, ubah `STAGING_ORIGIN` menjadi origin lengkap yang dibuka pengguna, tanpa garis miring di akhir. Simpan password yang sama untuk volume MySQL yang sudah terisi. Image MySQL membaca password awal saat membuat volume baru.

2. Tetapkan project dan berkas Compose secara eksplisit. Jalankan dengan akun yang berhak membaca konfigurasi dan mengakses Docker.

   ```bash
   dc=(sudo docker compose -p ternaku-staging --env-file /etc/ternaku-staging/runtime.env -f "$PWD/deploy/vps/compose.yaml")
   "${dc[@]}" config --quiet
   "${dc[@]}" up -d --build --wait web
   "${dc[@]}" ps
   curl -fsS http://127.0.0.1:18182/ternaku/health
   curl -fsS http://127.0.0.1:18182/ternaku/auth/registration-status
   ```

   Untuk Docker Manager yang menerima Compose tanpa checkout lokal, gunakan isi `compose.yaml` dan set `STAGING_BUILD_CONTEXT=https://github.com/amaliasr/TernaKu.git#<SHA-commit-40-karakter>` di environment project. Commit harus berisi folder `deploy/vps` dan dapat dibaca oleh builder. Dengan checkout lokal, konteks build otomatis memakai root repo.

3. Untuk uji privat, dari laptop buka SSH tunnel dengan `ssh -L 18182:127.0.0.1:18182 user@VPS`, lalu buka `http://localhost:18182`. Untuk uji PWA dari HP melalui jaringan, gunakan hostname staging dengan HTTPS dan arahkan reverse proxy yang sudah tersedia ke `127.0.0.1:18182`, dengan path dan query utuh. Simpan domain staging terpisah dari domain produksi. Pemasangan PWA dan draf mengikuti origin perangkat.

4. Pada volume kosong, MySQL membuat tabel dan saldo pembuka nol dari `api/schema.sql`. Pendaftaran pemilik pertama memakai `STAGING_SETUP_TOKEN`. Ambil kodenya dari konfigurasi privat di VPS. Setelah akun admin siap, kosongkan nilai token dan jalankan `"${dc[@]}" up -d api web`. Buat dan setujui akun karyawan khusus pengujian, lalu siapkan harga, panen, dan pengambilan telur contoh sebelum mencoba penjualan.

## Memeriksa salinan database

Untuk pengujian dengan dump yang sudah disetujui, simpan dump privat di luar checkout. Gunakan volume staging yang memang disiapkan untuk pemulihan. Backup volume staging yang sudah berisi data sebelum menggantinya. Pastikan dump hanya berisi skema/data TernaKu dan telah disiapkan untuk database tujuan `ternaku`. Jangan impor akun server, database sistem, atau rahasia VAPID produksi.

1. Mulai hanya database dengan `"${dc[@]}" up --build -d --wait db`. Bila project pernah digunakan, hentikan `web`, `api`, dan `worker` yang aktif lebih dulu. Gunakan konfigurasi dasar tanpa Web Push selama pemulihan.
2. Impor melalui akun aplikasi yang hanya diberi hak pada database ini. Sesuaikan lokasi berkas privat berikut.

   ```bash
   "${dc[@]}" exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"' < /lokasi/privat/ternaku-staging.sql
   ```

3. Pada **salinan staging** saja, bersihkan sesi dan tujuan pengiriman produksi sebelum mengizinkan akses atau mengaktifkan notifikasi. Jalankan perintah berikut saat aplikasi staging masih berhenti.

   ```bash
   "${dc[@]}" exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"' <<'SQL'
   START TRANSACTION;
   DELETE FROM tokens;
   DELETE FROM login_attempts;
   DELETE FROM records WHERE kind IN ('push_subscription','push_job','push_sent','push_failed','push_cancelled');
   COMMIT;
   SELECT COUNT(*) AS akun FROM users;
   SELECT kind,COUNT(*) AS jumlah FROM records WHERE kind IN ('sale','production','pickup') GROUP BY kind;
   SELECT COUNT(*) AS tujuan_push_lama FROM records WHERE kind IN ('push_subscription','push_job');
   SQL
   ```

   Batasi akses staging ke tim uji. Gunakan akun karyawan uji dan data pelanggan/foto yang telah disamarkan sesuai kebutuhan. Jalankan `"${dc[@]}" up -d --wait web` dan periksa halaman masuk, kesehatan API, serta catatan yang memang dipulihkan.

## Notifikasi untuk perangkat uji

Konfigurasi dasar mematikan pengiriman push. Aktifkan pekerja notifikasi hanya pada database sintetis atau salinan yang sudah dibersihkan. Buat pasangan VAPID khusus staging dan simpan `STAGING_VAPID_PUBLIC_KEY`, `STAGING_VAPID_PRIVATE_KEY`, serta `STAGING_VAPID_SUBJECT` (alamat `mailto:` atau HTTPS milik tim) di berkas privat yang sama. Sebagai contoh, jalankan pembuatan kunci sekali pada VPS setelah image API dibangun.

```bash
sudo bash -c 'umask 077; set -C; docker run --rm ternaku-staging-api:local php -r '\''require "/srv/ternaku/vendor/autoload.php"; $k=Minishlink\WebPush\VAPID::createVapidKeys(); printf("STAGING_VAPID_PUBLIC_KEY=%s\nSTAGING_VAPID_PRIVATE_KEY=%s\n", $k["publicKey"], $k["privateKey"]);'\'' > /etc/ternaku-staging/vapid.env'
```

Salin kedua nilai itu ke `runtime.env` menggunakan editor privat dan tambahkan subject. Simpan kunci yang sama untuk pengujian berikutnya. Aktifkan override dan izinkan notifikasi pada satu HP uji.

```bash
dcp=("${dc[@]}" -f "$PWD/deploy/vps/compose.push.yaml" --profile push)
"${dcp[@]}" config --quiet
"${dcp[@]}" up -d --wait api web worker
curl -fsS http://127.0.0.1:18182/ternaku/health
"${dcp[@]}" logs --tail 10 worker
```

API melaporkan `push_ready: true` saat kunci dan dependensi tersedia. Worker memproses antrean per menit. Untuk mematikan push, hentikan worker dengan `"${dcp[@]}" stop worker`, lalu buat ulang API memakai konfigurasi dasar dengan `"${dc[@]}" up -d --force-recreate api web`. Untuk menghentikan staging sambil mempertahankan data, gunakan `"${dcp[@]}" stop` bila push aktif atau `"${dc[@]}" stop` pada konfigurasi dasar.
