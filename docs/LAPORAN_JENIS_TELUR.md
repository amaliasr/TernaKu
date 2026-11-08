# Harga dan laporan tiga jenis telur

Pencatatan panen, stok, dan penjualan menggunakan **SKM**, **SKM Baru**, dan **Bentes**. SKM dan SKM Baru memakai satu harga **Telur Bagus**. Stok keduanya tetap terpisah: memilih SKM tidak mengambil stok SKM Baru.

Atasan membuka **Ringkasan → Perbarui harga telur** atau menu **Harga telur**, lalu mengisi dua harga: **Telur Bagus** dan **Telur Bentes**. Perubahan harga bagus berlaku untuk SKM dan SKM Baru sekaligus. Bentes boleh memiliki harga Rp0. Harga terjadwal berlaku pada tanggal dan jam WIB yang dipilih. Pemeriksaan harga di akun karyawan tetap setiap 5 detik saat aplikasi dibuka.

Seluruh catatan telur bagus lama dimasukkan ke **SKM**, termasuk panen, stok gudang, telur yang dibawa karyawan, dan item penjualan. Berat, jumlah butir, serta jumlah total persediaan tidak berubah. Pada nota lama, nama jenis menjadi SKM tetapi harga per kilogram, total, pembayaran, dan piutangnya tetap sama.

Log aktivitas tetap menyimpan jejak perubahan aslinya agar proses pembaruan dapat ditelusuri.

Jika belum ada harga bersama, aplikasi memakai harga bagus lama yang masih berlaku. Bila catatan harga terakhir hanya berisi harga SKM dan SKM Baru yang berbeda tanpa harga bagus, aplikasi menampilkan **Belum diatur** sampai atasan menetapkan harga bersama. Sistem tidak memilih salah satu harga secara diam-diam atau menganggapnya Rp0. Setelah harga bersama mulai berlaku, jadwal dengan aturan harga lama tidak lagi diaktifkan. Riwayat harga terpisah tetap dapat dibaca di tabel riwayat.

## Memperbarui instalasi yang sudah berisi data

Cadangkan database, lalu jalankan `php scripts/migrate-shared-good-price.php --legacy-to-skm` dari direktori API sebelum membuka versi baru. Flag `--legacy-to-skm` menegaskan bahwa seluruh data bagus lama akan dimasukkan ke SKM. Ikuti [panduan migrasi jenis telur di API](../api/EGG-TYPES.md) untuk urutan pemasangan lengkap. Migrasi menggabungkan saldo bagus lama ke SKM serta memperbarui identitas jenis pada catatan terkait. Migrasi tidak menghitung ulang nilai penjualan, harga pada nota, pembayaran, atau piutang. Menjalankan migrasi lagi tidak boleh menggandakan stok.

Tidak diperlukan pemilahan manual untuk stok bagus lama: semuanya menjadi SKM sesuai ketentuan baru. Jangan memasukkan panen baru untuk memindahkan stok lama karena akan menggandakan jumlah persediaan.

## Membaca ringkasan dan laporan

- Panen ditampilkan per jenis dalam butir, berat aktual, dan krat.
- Subtotal bagus berisi SKM + SKM Baru, termasuk catatan bagus lama yang kini masuk SKM.
- Total seluruh telur menjumlahkan ketiga jenis sekali. Jangan menjumlahkan kembali baris subtotal atau total sebagai jenis telur tambahan.
- Penjualan per jenis menggunakan berat dan harga yang disimpan pada transaksi. Pembayaran dan piutang ada pada laporan **Penjualan**, satu baris per nota; keduanya tidak disalin ke tiap rincian jenis telur.
- Rincian item penjualan dan nota memakai identitas jenis yang berlaku sekarang serta harga transaksi yang tersimpan. Harga yang berubah kemudian tidak mengubah nominal nota lama.
- PDF dan Excel memakai periode yang sama dengan layar. Saldo gudang tetap menampilkan SKM, SKM Baru, dan Bentes secara terpisah.

Contoh panen pada **7 November 2026**, direkap pukul **22.00 WIB**:

| Jenis | Butir | Berat |
| --- | ---: | ---: |
| SKM | 485 | 28 kg |
| SKM Baru | 650 | 36 kg |
| Bentes | 38 | 2,3 kg |
| Subtotal bagus (SKM + SKM Baru) | 1.135 | 64 kg |
| Total seluruh telur | 1.173 | 66,3 kg |

Pukul 22.00 adalah waktu rekap, bukan pergantian hari. Laporan harian tetap mengikuti **00.00–23.59.59 WIB**. Panen tanggal 7 November yang disimpan setelah pukul 22.00 tetap termasuk laporan tanggal 7 November. Jam input dicantumkan terpisah jika tanggal panen tidak menyimpan jam kegiatan.
