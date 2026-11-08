# SKM, SKM Baru, dan bentes

Kelompok **Telur Bagus** terdiri dari SKM dan SKM Baru. Keduanya memiliki harga dan saldo stok tersendiri. API mempertahankan nama kolom `category` untuk identitas jenis:

| Nilai | Arti | Panen/pengambilan baru |
| --- | --- | --- |
| `skm` | Telur SKM | Ya |
| `skm_new` | Telur SKM Baru | Ya |
| `cracked` | Telur bentes | Ya |
| `good` | Telur bagus lama, belum dipilah | Tidak |

`inventory` memuat empat saldo mandiri. `good` tidak boleh dijumlahkan kembali sebagai total bagus; ia bukan alias untuk SKM. Butir, berat dan krat tetap dicatat terpisah. Pembuatan panen mendukung tiga jenis sekaligus, dan foto bersama tetap memakai mekanisme dokumentasi yang sama.

## Migrasi instalasi yang sudah berjalan

Cadangkan database, siapkan kode API baru, kemudian jalankan pada container API sebelum menerima transaksi versi baru:

```sh
php scripts/migrate-egg-types.php
```

Migrasi memakai mutex transaksi yang sama dengan perintah operasional. Ia menambahkan saldo nol `egg:skm` dan `egg:skm_new`, serta penanda `schema_egg_types_v2`. Aman dijalankan kembali. Saldo `egg:good`, `egg:cracked`, seluruh dokumen JSON lama, foto, penjualan, snapshot harga, pengambilan pribadi dan sesi pengguna tetap dipertahankan. Migrasi tidak menganggap telur lama sebagai SKM secara otomatis. `schema.sql` untuk instalasi baru sudah menyediakan keempat saldo.

Pasang frontend baru bersama perubahan ini. Draft lama dengan `category: good` untuk panen/pengambilan baru perlu dipilih ulang jenisnya; server menolaknya tanpa menyimpan atau mengubah saldo. Klien lama tidak dapat membuat harga dua kategori lagi. Riwayat dan nota lama tetap dapat dibaca.

## Memilah stok bagus lama

Hanya admin dapat mengirim `stock.classify`:

```json
{
  "action": "stock.classify",
  "request_id": "pemilahan-gudang-001",
  "payload": {
    "category": "skm_new",
    "eggs": 100,
    "kg": 6,
    "trays": 1,
    "expected_source": {"eggs": 200, "kg": 12, "trays": 2},
    "expected_target": {"eggs": 0, "kg": 0, "trays": 0},
    "reason": "Hasil pilahan fisik di gudang"
  }
}
```

Sumber selalu `good`; tujuan hanya `skm` atau `skm_new`. Butir dan kilogram wajib positif; krat boleh nol dan bawaan nol. `expected_source` dan `expected_target` harus sama dengan saldo saat perintah dijalankan. Perubahan saldo menghasilkan 409; muat ulang sebelum mencoba lagi. Jumlah dan krat tidak boleh melebihi sumber. Pengulangan karena jaringan harus memakai `request_id` yang sama.

Transfer mencatat pasangan `classify_out`/`classify_in` dengan satu referensi, waktu, pelaksana dan alasan minimal lima karakter. Total butir, berat, dan krat tidak berubah. Panen, penjualan dan pengambilan lama tidak ditulis ulang. Pemilahan hanya mencakup saldo di gudang; telur yang masih dibawa karyawan tetap berjenis lama sampai dijual atau dikembalikan. Retur masuk kembali ke stok `good` dan dapat dipilah setelahnya.

## Harga dan penjualan

`price.create` mewajibkan `skm_price`, `skm_new_price`, `cracked_price`, dan `effective_at`. SKM dan SKM Baru harus positif; bentes boleh nol. Payload tidak menerima perubahan `good_price`; stok lama memakai tarif bagus dari riwayat lama yang sudah ada.

Server mengambil nilai terbaru yang sudah berlaku **untuk masing-masing kolom harga**. Jadwal lama yang hanya berisi bagus/bentes tetap dapat mengubah kedua tarif lamanya tanpa menghapus tarif SKM/SKM Baru. Jika tarif suatu jenis belum tersedia, penjualannya ditolak; tidak ada peminjaman harga jenis lain. Identitas `expected_price_id` memakai record harga berlaku paling baru, sedangkan setiap item menyimpan harga satuannya sendiri. Penjualan yang sudah tersimpan tidak mengikuti perubahan harga berikutnya.

Penjualan gudang dapat memakai `good` secara eksplisit selama stok lama mencukupi. Penjualan dari pengambilan lama harus tetap memakai kategori pengambilan tersebut; tidak dapat menggantinya dengan SKM atau SKM Baru. Estimasi butir dari berat, pengurangan stok, koreksi, dan pengembalian semuanya dihitung per jenis. Stok SKM yang banyak tidak dapat menutup kekurangan SKM Baru.

Setiap penyimpanan harga menghasilkan ID dan notifikasi baru, termasuk nominal yang sama. Pesan baru menyebut SKM, SKM Baru dan bentes. Antrean notifikasi lama tetap berisi pesan dari peristiwa asalnya.

Pemeriksaan gudang memakai `schema_version: 2` dan empat saldo. Lihat [pemeriksaan harian](STOCK-CHECKS.md) untuk penanganan hitungan lama dan persetujuan setelah koreksi panen. Batas hari tetap tengah malam WIB.
