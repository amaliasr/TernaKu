<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    $options=getopt('',['user-id:','expected-email:']);
    if(isset($options['user-id'])!==isset($options['expected-email'])) throw new RuntimeException('Gunakan --user-id dan --expected-email bersama-sama.');
    $db=(new FarmService())->database();
    AccountPolicyService::migrate($db);
    if(isset($options['user-id'])) {
        $changed=AccountPolicyService::protect($db,$options['user-id'],$options['expected-email']);
        echo $changed?"Superadmin berhasil dilindungi.\n":"Akun superadmin sudah dilindungi.\n";
    } else echo "Skema pengelolaan akun siap. Akun dan sesi tetap tersimpan.\n";
} catch(Throwable $e) { fwrite(STDERR,'Pembaruan akun gagal: '.$e->getMessage()."\n"); exit(1); }
