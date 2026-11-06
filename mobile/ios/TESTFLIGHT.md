# Memasang TernaKu melalui TestFlight

Gunakan akun tim Apple Developer peternakan dan App ID `com.rstudiohub.ternaku` dengan kemampuan **Push Notifications**. Di App Store Connect, buat atau pilih aplikasi iOS dengan Bundle ID yang sama. Nomor build harus lebih tinggi daripada unggahan sebelumnya untuk versi tersebut. [Panduan penambahan aplikasi](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)

## Siapkan paket perangkat

Untuk memeriksa aplikasi sebelum akun tim siap, jalankan **TernaKu iPhone release preflight** dari GitHub Actions. Workflow ini membuat arsip Release untuk iPhone fisik pada Mac dan memeriksa versi, arsitektur arm64 serta konfigurasi APNs produksi. Artefak `TernaKu-iPhone-unsigned` tersedia selama tujuh hari. Distribusi melalui TestFlight memerlukan paket yang ditandatangani tim Apple.

Pada Mac dengan Xcode 26 atau lebih baru, pilih tim peternakan pada **Signing & Capabilities** target TernaKu. Pastikan sertifikat Apple Distribution beserta kunci privatnya dan profil distribusi untuk Bundle ID tersebut tersedia di Mac. Xcode dapat mengatur penandatanganan dari akun tim yang memiliki hak yang sesuai. [Persyaratan SDK](https://developer.apple.com/news/upcoming-requirements/) · [Profil distribusi Apple](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile)

Dari root repositori, jalankan perintah berikut. Ganti `TEAM_ID_ANDA` dengan Team ID milik peternakan dan `1` dengan nomor build yang akan dipakai.

```bash
bash mobile/ios/prepare-testflight.sh TEAM_ID_ANDA 1
```

Skrip membuat arsip Release, mengekspor IPA ke `mobile/ios/build/testflight-1/export/TernaKu.ipa`, lalu memeriksa tanda tangan, nomor build, identitas tim, dan APNs produksi. Jika Xcode meminta sertifikat atau profil, selesaikan penandatanganan di Xcode lalu ulangi dengan direktori keluaran baru sebagai argumen ketiga. Unggah IPA melalui Transporter, atau gunakan Xcode Organizer untuk mendistribusikan arsip. Tunggu pemrosesan di App Store Connect dan isi pertanyaan kepatuhan enkripsi sesuai fitur aplikasi yang dikirim. [Mengunggah build](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/) · [Kepatuhan enkripsi](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation/)

## Undang karyawan

Pilih **TestFlight → External Testing**, buat grup karyawan, lalu tambahkan build. Isi alamat email untuk masukan dan kontak penanggung jawab peninjauan. Untuk aplikasi yang membutuhkan login, siapkan akun karyawan uji yang sudah disetujui dengan data contoh. Simpan detail login di kolom **Beta App Review Information** milik Apple. Karyawan dapat menerima undangan setelah build memenuhi syarat distribusi eksternal. [Petunjuk pengujian eksternal](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/) · [Informasi untuk peninjauan beta](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/)

**Deskripsi beta yang dapat dipakai**

> TernaKu membantu karyawan peternakan mencatat panen dan penjualan telur, memeriksa stok gudang, dan menerima pemberitahuan saat atasan menetapkan harga.

**Petunjuk pengujian yang dapat dipakai**

> Masuk menggunakan akun karyawan yang sudah disetujui. Izinkan notifikasi dan pilih **Coba notifikasi** dari beranda. Kembali ke layar utama iPhone. Saat atasan peternakan uji menyimpan harga telur dua kali dengan nominal yang sama, periksa bahwa dua pemberitahuan muncul. Ketuk salah satunya, lalu periksa harga dan waktu berlakunya di TernaKu.

Untuk percobaan pada iPhone, aktifkan pengiriman APNs produksi di server dengan kunci tim yang sama. [Pengaturan layanan pengiriman](../README.md#mengaktifkan-pengiriman-di-vps)
