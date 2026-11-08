<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    $farm=new FarmService();
    $count=UsernameService::migrate($farm->database());
    echo "Pembaruan username selesai. $count akun mendapat username; data akun dan sesi tetap tersimpan.\n";
} catch(Throwable $e) {
    $message=$e instanceof PDOException ? 'Periksa koneksi database dan izin perubahan tabel (SQLSTATE '.$e->getCode().').' : $e->getMessage();
    fwrite(STDERR,"Pembaruan username gagal: ".$message."\n");
    exit(1);
}
