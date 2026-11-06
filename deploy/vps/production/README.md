# Menjalankan TernaKu di VPS produksi

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
