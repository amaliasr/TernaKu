<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
if($argc!==2 || $argv[1]!=='--legacy-to-skm') {
    fwrite(STDERR,"Gunakan --legacy-to-skm setelah mencadangkan database dan menyetujui semua data bagus lama sebagai SKM.\n"); exit(1);
}
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    $changed=SharedGoodPriceMigration::migrate((new FarmService())->database());
    echo $changed ? "Migrasi selesai. Stok dan catatan bagus lama kini SKM; nota, foto, tanggal dan riwayat harga tetap tersimpan.\n" : "Migrasi sudah diterapkan; tidak ada data yang diubah lagi.\n";
} catch(Throwable $error) { fwrite(STDERR,'Migrasi harga bersama gagal: '.$error->getMessage()."\n"); exit(1); }
