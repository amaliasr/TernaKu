# Menjalankan TernaKu di VPS produksi

Domain `ternaku.rstudiohub.com` sudah beralih dari hosting bersama ke project Docker `ternaku-prod`. Arsip JavaScript, CSS, dan font dari hosting sebelumnya tersedia sebagai cadangan untuk HP yang masih membuka versi lama.

## Merilis versi berikutnya

Rilis pemeriksaan gudang harian memerlukan `php scripts/migrate-stock-checks.php` pada image API baru sebelum pergantian layanan, setelah snapshot SQL privat dibuat. Kolom `users.can_check_stock` bernilai awal `false`; admin menunjuk petugas lewat editor akun. Riwayat pemeriksaan dan penugasan disimpan sebagai record biasa dan ikut dicadangkan. Jangan menghapus kolom tambahan saat rollback. Alur persetujuan, koreksi panen, dan perlindungan transaksi baru dijelaskan di [STOCK-CHECKS.md](../../../api/STOCK-CHECKS.md).

Rilis pengelolaan akun dan optimasi foto menambahkan kolom akun `is_superadmin`/`deleted_at` serta kolom generated `records.compact_data`/`photo_version`. Sebelum pergantian API, buat snapshot SQL privat, lalu jalankan `php scripts/migrate-account-policy.php` dan `php scripts/migrate-performance.php` menggunakan image API baru pada jaringan database yang sama. Data ringkas dihitung ketika catatan berubah; pembacaan dashboard tidak perlu memproses foto berulang. Foto asli tidak dihapus. Kedua migrasi aman diulang dan kolom tambahan tetap dipertahankan saat rollback aplikasi.

Sesudah API baru aktif, lindungi akun pemilik dengan `php scripts/migrate-account-policy.php --user-id=ID_TERVERIFIKASI --expected-email=EMAIL_TERVERIFIKASI`. Cocokkan ID dan email dari database sebelum menjalankan perintah. Proteksi tidak dapat ditetapkan atau dicabut melalui formulir aplikasi. Akun admin yang sudah aktif mempertahankan sesinya saat ditandai sebagai superadmin.

Produksi memakai `PUSH_INLINE_DELIVERY=false` dengan worker permanen yang memeriksa antrean setiap 5 detik. Penyimpanan harga menyelesaikan transaksi beserta antrean notifikasi terlebih dahulu, lalu segera membalas; pengiriman ke perangkat dijalankan worker. Jangan menonaktifkan pengiriman inline pada hosting yang belum memiliki worker aktif.

Pembaruan login dengan username memerlukan migrasi satu kali. Cadangkan database lengkap ke direktori privat, lalu jalankan `php scripts/migrate-usernames.php` melalui container API versi baru dengan environment dan jaringan database produksi **sebelum** mengaktifkan API baru. Skrip menambahkan kolom username unik dan mengisi akun lama tanpa mengganti email, kata sandi, atau sesi. Skrip aman dijalankan ulang; jalankan kembali sesudah pergantian API untuk mengisi akun yang mungkin baru dibuat oleh versi lama selama proses rilis. Jangan menghapus kolom username saat mengembalikan versi aplikasi sebelumnya.

Pemulihan dump mendukung skema lama maupun skema terbaru. Username, proteksi superadmin, dan status penghapusan yang sudah ada ikut diverifikasi; kolom generated dihitung ulang dari `records.data`. Setelah memulihkan dump lama, jalankan migrasi username, kebijakan akun, dan data ringkas sebelum membuka akses aplikasi. Proteksi pemilik pada dump lama harus ditetapkan kembali menggunakan ID/email yang sudah diverifikasi.

Push ke GitHub memulai pemeriksaan kode. Untuk mengganti versi yang dilayani karyawan, pilih SHA commit yang lulus CI lalu jalankan build dan pembaruan Compose di VPS dengan file Compose produksi dan environment privat yang terpasang. Jika memakai build dari Git, arahkan `PROD_BUILD_CONTEXT` ke repo dan SHA yang dipilih. Gunakan tag image baru per rilis. Pertahankan volume database, kunci push, dan kedua mount arsip aset saat membuat ulang container. Periksa status `web`, `api`, `db`, dan `worker`, lalu buka situs serta `/ternaku/health` melalui domain publik.

## Pemasangan atau pemulihan pada volume baru

Project Compose `ternaku-prod` memiliki volume MySQL dan log sendiri. Frontend memanggil `/ternaku` di `https://ternaku.rstudiohub.com`. Web juga dapat diperiksa di VPS melalui port loopback `18183`. Sambungkan reverse proxy HTTPS ke jaringan Docker `ternaku-prod-ingress` dan arahkan hostname TernaKu ke `ternaku-prod-origin:8080`.

Simpan file environment di direktori privat dengan izin `0600`. Isi `PROD_DB_PASSWORD` dan `PROD_DB_ROOT_PASSWORD` dengan dua password khusus volume produksi. Salin `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, dan `WEB_PUSH_SUBJECT` yang sudah dipakai API lama agar langganan notifikasi di HP tetap berfungsi. Compose membaca `PROD_BUILD_CONTEXT` bila source build berasal dari commit Git, serta `PROD_IMAGE_TAG` untuk memilih tag image lokal. Jika memakai checkout, jalankan dari root repo:

```bash
dc=(docker compose -p ternaku-prod --env-file /etc/ternaku-prod/runtime.env -f deploy/vps/production/compose.yaml)
"${dc[@]}" config --quiet
"${dc[@]}" build db api web
"${dc[@]}" up -d --no-build --pull never --wait db
```

Untuk memulihkan data, hentikan penulisan dan pengiriman push di server sumber, tunggu permintaan yang sedang berjalan selesai, lalu ekspor **struktur dan data lengkap** ketujuh tabel dalam satu snapshot. Catat jumlah baris masing-masing dari database sumber selama periode yang sama. Hitung SHA-256 di sisi sumber sebelum memindahkan file melalui saluran privat. Gunakan file privat dengan mode `0600`. MySQL tujuan harus baru diinisialisasi. Hanya container `db` yang boleh berjalan di project produksi selama pemulihan.

```bash
# SHA dan jumlah berikut berasal dari snapshot final pada sumber yang sudah dibekukan.
python3 deploy/vps/production/restore.py --check "$DUMP" --sha256 "$SHA" --counts "$COUNTS"
python3 deploy/vps/production/restore.py --apply "$DUMP" --sha256 "$SHA" --counts "$COUNTS"
"${dc[@]}" up -d --no-build --pull never --wait web
curl -fsS http://127.0.0.1:18183/ternaku/health
```

Format `COUNTS` ialah `users=N,records=N,login_attempts=N,stock=N,command_mutex=N,command_requests=N,tokens=N`. Skrip mengimpor dump ke database sementara dengan akun berizin terbatas, memeriksa skema serta jumlah data, dan mencocokkan setiap kolom termasuk foto, sesi, dan data push. Verifikasi berjalan dalam transaksi sebelum commit. Nomor urut berikutnya diperiksa setelah commit. Jika verifikasi gagal, pertahankan pembatasan akses sampai penyebabnya ditemukan. Bila database telah berisi transaksi, skrip menolak menjalankan impor ulang.

Sesudah pengujian melalui reverse proxy berhasil, arahkan klien lama di `api.buildmanagement.id/ternaku` dan hostname frontend ke tujuan yang sama. Saat pengirim lama sudah berhenti, aktifkan worker:

```bash
"${dc[@]}" --profile push up -d --no-build --pull never --wait worker
"${dc[@]}" --profile push ps
```

Worker melaporkan sehat bila sudah berhasil memeriksa antrean dan pemeriksaan terakhir berumur kurang dari tiga menit. Untuk menghentikan sementara pemeriksaan antrean, jalankan `"${dc[@]}" --profile push stop worker`. API juga dapat mengirim langsung saat harga diperbarui, sehingga pembekuan penulisan harus mencakup API lama beserta cron-nya.

### Berkas antarmuka untuk HP yang sudah membuka versi lama

Sebelum DNS beralih, unduh aset publik versi lama yang dirujuk HTML, runtime JavaScript, manifest build, dan CSS. Cocokkan hash setiap berkas dengan salinan transfer. Ekstrak isi `_next/static/` ke direktori khusus di VPS dan beri akses baca pada proses nginx. Simpan arsip transfer serta manifest hash di luar direktori ini.

Tetapkan `PROD_LEGACY_STATIC_DIR` ke direktori yang berisi `_next/static`, dan `PROD_LEGACY_NGINX_CONF` ke lokasi absolut `nginx-legacy.conf`. Sertakan `-f deploy/vps/production/compose.legacy-assets.yaml` setelah file dasar dalam setiap perintah Compose. Jika pengelola Docker membaca satu file saja, gabungkan kedua mount pada `services.web.volumes` di file Compose kanonis yang dipakai pengelola. Keduanya hanya memberikan akses baca. Dengan begitu, pembuatan ulang container tetap memakai arsip. Nginx mengutamakan file dari versi aktif, kemudian mencari aset yang masih diminta HP di direktori lama.
