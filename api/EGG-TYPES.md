# Jenis telur dan satu harga telur bagus

**Telur SKM** dan **Telur SKM Baru** memiliki stok masing-masing, tetapi memakai satu harga **Telur Bagus**. Telur bentes memiliki harga tersendiri dan boleh Rp0. Seluruh data bagus lama kini dianggap SKM sesuai keputusan pemilik.

| `category` | Jenis | Harga yang dipakai |
| --- | --- | --- |
| `skm` | Telur SKM | `good_price` |
| `skm_new` | Telur SKM Baru | `good_price` |
| `cracked` | Telur bentes | `cracked_price` |

`good` adalah alias permintaan lama untuk SKM. Saldo respons tetap memuat kunci `good` bernilai nol untuk kompatibilitas perangkat lama; kunci ini bukan total kelompok bagus. Panen dapat mencatat ketiga jenis sekaligus. Butir, kilogram, dan krat tetap terpisah.

## Migrasi data operasional

Cadangkan database dan hentikan penulisan dari API lama selama konversi. Pastikan migrasi dasar jenis telur sudah dijalankan sehingga baris `egg:good`, `egg:skm`, `egg:skm_new`, dan `egg:cracked` tersedia. Kemudian jalankan:

```sh
php scripts/migrate-shared-good-price.php --legacy-to-skm
```

Flag wajib karena operasi ini menyatakan seluruh data bagus lama sebagai SKM. Installer biasa tidak menjalankan konversi ini secara otomatis. Untuk instalasi sebelum penambahan SKM/SKM Baru, jalankan `php scripts/migrate-egg-types.php` terlebih dahulu.

Konversi berjalan dalam satu transaksi dengan mutex perintah:

- Saldo `egg:good` ditambahkan ke `egg:skm`, lalu saldo `egg:good` menjadi nol. Berat dijumlahkan dalam gram bulat untuk menjaga ketelitian tiga desimal.
- Kategori bagus lama pada panen, pengambilan, item penjualan dan mutasi stok menjadi `skm`. Stok SKM Baru dan bentes tetap terpisah.
- Hitungan bagus lama pada pemeriksaan gudang/panen dijumlahkan ke SKM. Pemeriksaan selesai mempertahankan status dan tinjauannya. Pemeriksaan pending ditolak dengan alasan sistem agar dihitung ulang.
- Foto, nominal nota, snapshot harga satuan, pembayaran, ID dan tanggal tetap dipertahankan. Dokumen harga, antrean push, hasil retry, serta audit sebelum/sesudah yang sudah ada tidak ditulis ulang.

Migrasi menambahkan penanda `schema_shared_good_v3` dan satu audit ringkas berisi saldo sebelum/sesudah, jumlah dokumen yang diubah per jenis, dan SHA-256 gabungan dokumen asal/hasil. **Tidak ada mutasi stok transfer baru**, karena ledger historis sudah dikategorikan ulang; menambah mutasi transfer lagi akan menghitung perubahan dua kali. Migrasi ulang tidak menambah saldo atau audit. Konflik marker, saldo melebihi kapasitas, atau data JSON rusak membatalkan transaksi.

Aktifkan API serta frontend baru sesudah konversi selesai, lalu tetapkan harga bagus bersama. Periksa saldo gabungan, riwayat penjualan, pengambilan yang belum selesai, dan pemeriksaan yang perlu diulang.

## Harga berlaku

`price.create` menerima `good_price`, `cracked_price`, dan `effective_at`. Harga bagus wajib positif; harga bentes boleh nol. Record baru menyimpan `pricing_mode: "shared_good"` serta alias kompatibilitas `skm_price = skm_new_price = good_price`. Permintaan harga terpisah dari aplikasi lama ditolak dengan petunjuk memperbarui aplikasi.

Sesudah ada record harga bersama yang mulai berlaku, server memakai record harga bersama terbaru yang sudah aktif. Jadwal dengan kebijakan harga lama tidak dapat menimpanya meskipun tanggal jadwal itu lebih akhir. Harga bentes diambil dari record bersama yang sama.

Sebelum harga bersama pertama aktif, server memeriksa record lama terbaru yang sudah berlaku. `good_price` lama dapat dipakai bersama. Bila hanya tarif SKM/SKM Baru tersedia, keduanya harus sama. Tarif yang berbeda membuat penjualan telur bagus ditolak sampai atasan menetapkan satu harga; server tidak memilih salah satunya secara diam-diam. Bentes tetap memakai tarif dari record lama tersebut.

Harga disalin ke item ketika penjualan dibuat. Perubahan kebijakan atau harga berikutnya tidak mengubah harga, total, atau pembayaran nota lama. `expected_price_id` mengikuti record yang benar-benar digunakan oleh kebijakan di atas.

Setiap penyimpanan harga tetap menghasilkan ID dan notifikasi baru, termasuk nominal yang sama. Pesan baru menyebut harga Telur Bagus (SKM dan SKM Baru) serta harga bentes. Setelah harga bersama efektif, worker membatalkan antrean `price.updated` berkebijakan lama yang belum terkirim, dengan alasan `obsolete_pricing_policy`; payload dan teks aslinya tetap disimpan sebagai bukti. Sebelum harga bersama efektif, antrean lama tetap boleh dikirim. Peristiwa baru berkebijakan bersama tetap terkirim masing-masing meskipun nominalnya sama.

## Perangkat dan draft lama

API menghitung fingerprint serta mencari hasil `request_id` sebelum menormalkan alias kategori. Permintaan yang sudah tersimpan sebelum konversi mengembalikan nota yang sama dengan kategori SKM, tanpa transaksi ganda. Draft yang belum tersimpan dan masih memakai `category: "good"` disimpan sebagai SKM pada panen, pengambilan, penjualan, atau penyesuaian stok.

Payload dan ID retry yang sudah dikirim harus dipertahankan persis saat jaringan terputus. Mengganti payload menjadi `skm` dengan ID lama tetap menghasilkan 409 karena fingerprint aslinya berbeda. Hitungan stok lama yang tidak cocok dengan saldo gabungan juga menghasilkan 409; muat ulang sebelum mengubah stok.

Pengambilan lama sudah menjadi SKM, sehingga retur dan koreksi otomatis memakai SKM. Harga bersama tidak menggabungkan saldo SKM dan SKM Baru: kekurangan satu jenis tetap tidak boleh diambil dari jenis lain. Pemeriksaan baru tetap membutuhkan `schema_version: 2` dan empat kunci kuantitas dengan `good` nol; lihat [pemeriksaan harian](STOCK-CHECKS.md). Batas hari tetap tengah malam WIB.
