# TernaKu untuk Android

Aplikasi ini membuka situs produksi `https://ternaku.rstudiohub.com` dan menyediakan penerima Firebase Cloud Messaging (FCM) untuk pengumuman harga. Nama paketnya `com.rstudiohub.ternaku`. Android 8 atau lebih baru dan layanan Google Play diperlukan untuk menerima push.

## Build

1. Sediakan JDK 17 atau lebih baru serta Android SDK Platform 36 dan Build Tools 36.0.0. Tetapkan `ANDROID_HOME` ke lokasi SDK.
2. Daftarkan nama paket di proyek Firebase yang sama dengan pengirim pada API. Simpan konfigurasi aplikasi Android di `app/google-services.json`. Berkas ini diabaikan Git. Kredensial service account hanya diperlukan oleh API.
3. Jalankan `./gradlew :app:assembleDebug` dari direktori ini, atau `gradlew.bat :app:assembleDebug` di Windows. APK uji ada di `app/build/outputs/apk/debug/`. Build debug tanpa konfigurasi Firebase hanya bisa dipakai untuk mencoba antarmuka.
4. Untuk distribusi, tetapkan `TERNAKU_KEYSTORE` (lokasi absolut), `TERNAKU_KEYSTORE_PASSWORD`, `TERNAKU_KEY_ALIAS` dan `TERNAKU_KEY_PASSWORD`. Gunakan `:app:assembleRelease` untuk menghasilkan APK dan `:app:bundleRelease` untuk berkas AAB Google Play. Simpan keystore dan cadangannya secara privat. Untuk memperbarui APK langsung, gunakan kunci penandatangan yang sama dengan pemasangan sebelumnya.

## Pembaruan

Perubahan halaman web tersedia dari situs yang sama. Untuk perubahan native, naikkan `versionCode` dan `versionName` di `app/build.gradle`. Terbitkan APK bertanda tangan di `/mobile/TernaKu.apk`, lalu perbarui `/mobile/android-release.json` di domain produksi dengan `{"versionCode":2,"versionName":"1.1.0"}` sesuai versi nyata. Saat aplikasi dibuka kembali, versi native diperiksa paling sering sekali setiap enam jam. Pengguna dapat menunda pembaruan. Pemasangan dari Play Store diarahkan ke Play Store.

## Memeriksa notifikasi

Masuk sebagai karyawan uji dan izinkan notifikasi. Tekan Home atau hapus aplikasi dari daftar aplikasi terbaru. Terbitkan dua pembaruan berbeda dengan nominal sama pada lingkungan uji. Setiap pembaruan menggunakan ID terpisah dan seharusnya menghasilkan satu notifikasi. Transport memakai pesan FCM prioritas tinggi berisi data, tanpa collapse key. Service memeriksa ikatan akun dan menampilkan harga melalui kategori **Pengumuman harga telur**. Tampilan banner mengikuti izin HP dan mode Jangan Ganggu. Setelah pengguna menekan **Paksa berhenti** di Pengaturan Android, aplikasi perlu dibuka lagi.

Tes perangkat dijalankan dengan `./gradlew :app:connectedDebugAndroidTest`. Fitur pengambilan token untuk uji cloud hanya terdapat pada APK instrumentasi dan harus diaktifkan eksplisit pada emulator terisolasi.
