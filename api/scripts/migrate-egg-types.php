<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    EggTypesSchema::migrate((new FarmService())->database());
    echo "Jenis telur siap. Saldo SKM dan SKM Baru tersedia; stok dan riwayat bagus lama dipertahankan sebagai belum dipilah.\n";
} catch(Throwable $e) { fwrite(STDERR,'Pembaruan jenis telur gagal: '.$e->getMessage()."\n"); exit(1); }
