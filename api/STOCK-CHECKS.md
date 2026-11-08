# Pemeriksaan panen dan gudang harian

Admin menunjuk karyawan melalui `user.update` dengan `can_check_stock: true`. Penugasan hanya berlaku untuk karyawan aktif yang sudah disetujui. Status ini tidak dapat diberikan lewat pendaftaran, profil, atau `user.create`. Promosi menjadi atasan, penonaktifan, dan penghapusan akun otomatis mencabut tugas serta mencatat waktunya.

## Memasang pembaruan

Cadangkan database, lalu jalankan pada container API sebelum mengaktifkan kode baru:

```sh
php scripts/migrate-stock-checks.php
```

Migrasi menambahkan `users.can_check_stock` dengan nilai awal `false`. Aman dijalankan kembali dan tidak menunjuk karyawan secara otomatis. Instalasi baru sudah menyertakan kolom ini. Versi ini tetap membutuhkan migrasi kinerja sebelumnya (`scripts/migrate-performance.php`) untuk `records.compact_data` dan `photo_version`.

## Akses catatan

Karyawan yang ditunjuk dapat membaca panen, penjualan, dan foto dokumentasi karyawan lain selama **hari ini dan 29 hari sebelumnya dalam WIB**. Riwayat miliknya sendiri tetap lengkap. Nama pencatat disertakan; email, username, target, dan foto profil akun lain tidak dibagikan. Izin ini tidak membuka koreksi, penerimaan panen, pembayaran, penguncian, maupun perubahan catatan milik orang lain. Setelah tugas dicabut, sesi yang sama langsung kembali ke akses biasa.

`GET /bootstrap` menyertakan:

- `stock_check_context`: hanya untuk admin atau pemeriksa; tanggal WIB, `snapshot`, `warehouse`, dan `harvest`.
- `stock_checks`: semua pemeriksaan bagi admin; hanya milik sendiri bagi karyawan.
- `stock_check_assignments`: riwayat penunjukan/pencabutan; semua bagi admin, milik sendiri bagi karyawan. Setiap peristiwa memuat `id`, `user_id`, `assigned`, `created_at`, dan `created_by`. Riwayat ini dipertahankan ketika akun dihapus agar laporan dapat menampilkan hari yang belum diperiksa.

`warehouse` dan `harvest` memakai bentuk `{good:{eggs,kg,trays},cracked:{eggs,kg,trays}}`. `harvest` menjumlahkan semua panen bertanggal hari tersebut, termasuk panen yang belum masuk gudang. Butir dan krat bilangan bulat nonnegatif; kilogram maksimal tiga desimal. Butir dan berat harus sama-sama nol atau sama-sama terisi.

## Mengirim hasil hitungan

Gunakan `POST /commands`, dengan `request_id` tetap untuk mengulang simpan yang terputus jaringan.

```json
{
  "action": "stock_check.submit",
  "request_id": "pemeriksaan-perangkat-001",
  "payload": {
    "date": "2026-11-08",
    "expected_snapshot": "snapshot-dari-context-terbaru",
    "status": "confirmed"
  }
}
```

`confirmed` berarti hasil hitung sama dengan catatan dan tidak menerima kolom actual. Untuk selisih, kirim `status: "pending"`, `warehouse_actual`, `harvest_actual`, serta `reason` minimal lima karakter. Semua kategori dan tiga ukuran harus diisi, termasuk angka nol. Jika semua angka sama, pilih konfirmasi. Tanggal wajib hari ini WIB. Snapshot yang berubah atau pergantian hari menghasilkan HTTP 409; muat ulang dan hitung kembali.

Pemeriksaan tidak mengubah panen atau gudang saat dikirim. Hasil yang sudah `confirmed` atau `approved` tidak dapat diganti pada hari yang sama. Pengiriman ulang atas hasil `pending` atau `rejected` membuat baris baru; sebelumnya menjadi `superseded` dengan `replaced_by`, sementara hitungan, alasan dan hasil peninjauan sebelumnya tetap tersimpan.

## Meninjau selisih

Admin menggunakan `stock_check.review` dengan `{id, decision: "approve"|"reject", reason?}`. Penolakan wajib disertai alasan minimal lima karakter.

Sebelum persetujuan, admin mengoreksi **masing-masing catatan panen yang keliru** melalui `correction.apply`. Total panen tanggal pemeriksaan harus tepat sama dengan `harvest_actual`. Jika total sudah sama, koreksi panen tidak diperlukan. Panen salah input dapat dinolkan oleh admin dengan `eggs`, `kg`, dan `trays` semuanya nol; baris dan riwayat koreksinya tetap disimpan. Pembuatan panen baru dan koreksi langsung karyawan tetap memerlukan jumlah positif.

Sesudah pemeriksaan dikirim, hanya koreksi admin terhadap catatan panen yang sudah ada dalam snapshot yang boleh terjadi sebelum persetujuan. Penjualan (termasuk dari bawaan pribadi), panen baru (termasuk tanggal mundur), pengambilan, pengembalian, penyesuaian stok, atau koreksi lain membuat hitungan lama tidak berlaku dan menghasilkan HTTP 409. Minta pemeriksa menghitung ulang. Jika hari sudah berganti, tolak pemeriksaan lama dan buat pemeriksaan hari baru. Admin masih bisa menyetujui pemeriksaan hari sebelumnya apabila tidak ada perubahan yang membuatnya kedaluwarsa dan total panen cocok.

Persetujuan menghitung selisih terhadap **stok setelah koreksi panen**, lalu menyamakan gudang dengan hitungan fisik. Ini mencegah selisih panen dihitung dua kali. Kedua kategori mendapat mutasi `reconcile` dengan referensi ID pemeriksaan. Mutex perintah, transaksi, dan status pending mencegah persetujuan bersamaan atau pengulangan tanpa sengaja. Persetujuan satu pemeriksaan juga membuat hitungan paralel dari pemeriksa lain perlu diperbarui.

Status yang tersimpan: `confirmed`, `pending`, `approved`, `rejected`, atau `superseded`. Catatan memuat snapshot, daftar ID panen, hitungan sistem dan fisik, waktu serta pengguna pengirim/peninjau, alasan, dan urutan terakhir perubahan stok. Tidak ada produksi asli yang diganti secara diam-diam oleh pemeriksaan.
