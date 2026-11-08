<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    StockCheckSchema::migrate((new FarmService())->database());
    echo "Pemeriksaan stok harian siap. Penugasan karyawan tetap ditentukan admin.\n";
} catch(Throwable $e) { fwrite(STDERR,'Pembaruan pemeriksaan stok gagal: '.$e->getMessage()."\n"); exit(1); }
