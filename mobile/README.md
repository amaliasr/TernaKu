# TernaKu di Android dan iPhone

Aplikasi membuka peternakan di `https://ternaku.rstudiohub.com`. Karyawan masuk memakai akun TernaKu yang sudah disetujui. Setelah layanan pengiriman diaktifkan, aplikasi meminta izin notifikasi saat karyawan masuk. Tekan **Izinkan**, kemudian gunakan **Coba notifikasi** di beranda karyawan. Tombol **Matikan** menghentikan pengiriman ke HP tersebut.

Setiap kali atasan berhasil menyimpan harga, server membuat pengumuman dengan ID tersendiri. Dua kali menyimpan nominal yang sama menghasilkan dua pengumuman. Mengulang permintaan simpan yang sama karena koneksi terputus tetap dihitung satu kali. Karyawan dapat membaca harga bagus, harga bentes, dan waktu mulai berlaku saat aplikasi sedang ditutup. Tampilan banner mengikuti izin, mode Fokus/Jangan Ganggu, koneksi, dan pengaturan HP.

## Android

1. Buat proyek milik peternakan di [Firebase Console](https://console.firebase.google.com/). Tambahkan aplikasi Android dengan nama paket `com.rstudiohub.ternaku`. Unduh `google-services.json` dan tempatkan di `mobile/android/app/google-services.json`.
2. Aktifkan **Firebase Cloud Messaging API (V1)**. Siapkan akun layanan pada proyek yang sama dengan izin mengirim pesan FCM. Simpan JSON kunci privatnya di server sesuai petunjuk VPS di bawah. File ini berbeda dari `google-services.json` milik aplikasi. [Panduan pengiriman Firebase](https://firebase.google.com/docs/cloud-messaging/auth-server)
3. Buka folder `mobile/android` di Android Studio dengan JDK 17 atau 21 dan Android SDK 36. Jalankan `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`). APK berada di `app/build/outputs/apk/debug/app-debug.apk`. APK pratinjau bisa dipasang untuk mencoba aplikasi sebelum Firebase disiapkan. Build ulang APK dengan konfigurasi proyek untuk menerima push.
4. Untuk distribusi, siapkan kunci penandatanganan milik peternakan. Pasang variabel `TERNAKU_KEYSTORE`, `TERNAKU_KEYSTORE_PASSWORD`, `TERNAKU_KEY_ALIAS` dan `TERNAKU_KEY_PASSWORD`. Gunakan `bundleRelease` untuk Play Console atau `assembleRelease` untuk APK yang ditandatangani. Simpan kunci penandatanganan untuk pembaruan aplikasi berikutnya.

Untuk rilis APK berikutnya, naikkan `versionCode` dan `versionName`, lalu tanda tangani dengan kunci yang sama. Pada VPS produksi tempatkan APK dan metadata dalam `public-assets/mobile` dengan nama `TernaKu.apk` dan `android-release.json`. Metadata memuat `versionCode` sebagai bilangan bulat serta `versionName`. Publikasikan APK terlebih dahulu lalu ganti metadata secara atomik. Aplikasi menawarkan pembaruan saat ada versi baru. Pilih **Perbarui** pada pemasang Android agar sesi dan draf di instalasi tersebut tetap tersimpan. Menu dan formulir web mengikuti rilis server saat aplikasi dibuka kembali.

## iPhone

1. Dengan akun tim [Apple Developer](https://developer.apple.com/programs/), buat App ID eksplisit `com.rstudiohub.ternaku`, aktifkan **Push Notifications**, lalu buat kunci APNs untuk aplikasi tersebut. Catat **Team ID** dan **Key ID**. Simpan kunci privat `.p8` untuk server. [Petunjuk Apple](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
2. Pada Mac, buka `mobile/ios/TernaKu.xcodeproj`, pilih target **TernaKu → Signing & Capabilities**, kemudian pilih tim Apple Developer peternakan. Periksa kemampuan **Push Notifications** dan profil penandatanganan untuk App ID ini. Build Debug memakai APNs sandbox. Release dan TestFlight memakai APNs production.
3. Untuk karyawan, pilih **Product → Archive → Distribute App → App Store Connect**, kemudian bagikan melalui TestFlight atau rilis di App Store. Arsip simulator dari GitHub Actions dapat digunakan untuk pengujian di Mac. Instalasi di iPhone fisik membutuhkan build perangkat yang ditandatangani. [Panduan TestFlight](https://developer.apple.com/testflight/)

## Mengaktifkan pengiriman di VPS

Simpan kunci di direktori privat khusus, misalnya `/docker/ternaku-prod/private/mobile-push`. Tempatkan **hanya** JSON akun layanan dengan nama `fcm.json` dan kunci APNs dengan nama `apns.p8` di sana. Keduanya dapat disiapkan terpisah. Pastikan proses PHP dan worker (`www-data`) dapat membaca file. Contoh pada image Linux TernaKu: direktori milik `root:www-data` mode `0750`, file mode `0640`.

Set `PROD_MOBILE_PUSH_DIR` ke direktori itu di environment privat Compose. Untuk iOS tambahkan `APNS_TEAM_ID` dan `APNS_KEY_ID`. Sertakan [compose.mobile-push.yaml](../deploy/vps/production/compose.mobile-push.yaml) sebagai tambahan **setelah** seluruh file Compose produksi yang sedang digunakan, lalu buat ulang layanan `api` dan `worker`. Overlay memasang direktori secara baca-saja pada kedua layanan. Simpan konfigurasi ini dalam perintah rilis atau file Compose kanonis untuk pembaruan berikutnya. [Panduan VPS](../deploy/vps/production/README.md)

Endpoint `GET /ternaku/push/status` dengan sesi yang sah melaporkan kesiapan `native.android` dan `native.ios`. Setelah konfigurasi dibaca, uji dengan akun karyawan pada HP terpisah. Izinkan notifikasi, tekan **Coba notifikasi**, kembali ke layar utama, lalu simpan nominal harga yang sama dua kali dari akun admin pada lingkungan uji. Periksa dua pengumuman, jam berlaku, dan tindakan mengetuk notifikasi. Pada Android biarkan aplikasi ditutup secara normal. Tombol **Paksa berhenti** di pengaturan OS memerlukan aplikasi dibuka kembali. Pada iPhone periksa izin **Banner** dan mode Fokus.

Kunci privat pengirim, kata sandi penandatanganan, dan profil distribusi harus disimpan di luar repositori dan APK. Untuk berbagi konfigurasi dengan pengelola, berikan akses ke direktori privat, bukan isi kuncinya melalui chat.
