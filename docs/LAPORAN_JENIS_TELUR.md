# Harga dan laporan tiga jenis telur

Pencatatan baru menggunakan **SKM**, **SKM Baru**, dan **Bentes**. SKM dan SKM Baru termasuk kelompok telur bagus, tetapi stok serta harga keduanya terpisah. Memilih SKM tidak mengambil stok SKM Baru.

Saat pembaruan ini pertama dipasang, atasan perlu membuka **Ringkasan → Perbarui harga telur** atau menu **Harga telur** dan menetapkan harga ketiga jenis. Harga SKM dan SKM Baru tidak disalin dari harga bagus lama. Sebelum ditetapkan, aplikasi menampilkan **Belum diatur**, bukan Rp0. Bentes boleh memiliki harga Rp0. Harga terjadwal berlaku pada tanggal dan jam WIB yang dipilih. Pemeriksaan harga di akun karyawan tetap setiap 5 detik saat aplikasi dibuka.

Data bagus lama diberi nama **Telur bagus (belum dibedakan)**. Catatan, stok, dan harga lamanya tetap terpisah sampai stok dipilah. Riwayat dan nota lama tidak diganti menjadi SKM atau SKM Baru. Pembaruan harga baru hanya mengatur tiga jenis baru; harga bagus lama ditampilkan sebagai acuan lama yang tidak diubah dari formulir tersebut.

## Memperbarui instalasi yang sudah berisi data

Cadangkan database, lalu jalankan `php scripts/migrate-egg-types.php` dari direktori API sebelum fitur tiga jenis dipakai. Migrasi menambah saldo SKM dan SKM Baru dengan nilai awal nol. Saldo bagus lama serta riwayat panen, pengambilan, penjualan, dan harga tidak ditimpa. Skrip aman dijalankan ulang.

Untuk memindahkan stok fisik yang sudah diketahui jenisnya, atasan memakai **pemilahan stok bagus lama** di menu gudang. Isi jenis tujuan SKM atau SKM Baru, jumlah, berat aktual, dan alasan. Sistem mengurangi stok bagus lama lalu menambahkan jumlah yang sama pada jenis tujuan; total persediaan tetap sama dan mutasi tercatat. Jangan memasukkan panen baru hanya untuk memindahkan stok lama. API menjalankan pemilahan melalui `stock.classify`, dengan pemeriksaan saldo sumber dan tujuan supaya hitungan lama tidak menimpa transaksi yang lebih baru.

## Membaca ringkasan dan laporan

- Panen ditampilkan per jenis dalam butir, berat aktual, dan krat.
- Subtotal bagus hanya berisi SKM + SKM Baru. Telur bagus lama belum masuk subtotal ini.
- Total seluruh telur menjumlahkan setiap jenis sekali, termasuk data bagus lama bila ada. Jangan menjumlahkan kembali baris subtotal atau total sebagai jenis telur tambahan.
- Penjualan per jenis menggunakan berat dan harga yang disimpan pada transaksi. Pembayaran dan piutang ada pada laporan **Penjualan**, satu baris per nota; keduanya tidak disalin ke tiap rincian jenis telur.
- Rincian item penjualan dan nota memuat jenis serta harga transaksi aslinya. Harga yang berubah kemudian tidak mengubah nota lama.
- PDF dan Excel memakai periode yang sama dengan layar. Saldo gudang menampilkan setiap jenis secara terpisah; stok bagus lama hanya muncul bila masih ada atau riwayatnya belum cukup untuk menentukan saldo.

Contoh panen pada **7 November 2026**, direkap pukul **22.00 WIB**:

| Jenis | Butir | Berat |
| --- | ---: | ---: |
| SKM | 485 | 28 kg |
| SKM Baru | 650 | 36 kg |
| Bentes | 38 | 2,3 kg |
| Subtotal bagus (SKM + SKM Baru) | 1.135 | 64 kg |
| Total seluruh telur | 1.173 | 66,3 kg |

Pukul 22.00 adalah waktu rekap, bukan pergantian hari. Laporan harian tetap mengikuti **00.00–23.59.59 WIB**. Panen tanggal 7 November yang disimpan setelah pukul 22.00 tetap termasuk laporan tanggal 7 November. Jam input dicantumkan terpisah jika tanggal panen tidak menyimpan jam kegiatan.
