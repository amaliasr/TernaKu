<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
require dirname(__DIR__).'/application/libraries/PerformanceSchema.php';
try {
    PerformanceSchema::migrate((new FarmService())->database());
    echo "Data ringkas siap. Foto asli dan seluruh catatan tetap tersimpan.\n";
} catch(Throwable $e) {
    // SQL errors can include customer data; keep their details in private logs only.
    fwrite(STDERR,"Pembaruan data ringkas gagal (".get_class($e)."). Periksa skema database.\n");
    exit(1);
}
