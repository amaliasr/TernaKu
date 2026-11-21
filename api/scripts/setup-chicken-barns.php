<?php
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
$args=array_slice($argv,1);
if(count($args)>1 || ($args && !in_array($args[0],['--dry-run','--apply'],true))) {
    fwrite(STDERR,"Gunakan php scripts/setup-chicken-barns.php --dry-run atau --apply.\n"); exit(1);
}
try {
    $db=(new FarmService())->database(); $apply=($args[0]??'--dry-run')==='--apply';
    $result=$apply?BarnSetup::apply($db):BarnSetup::plan($db);
    echo json_encode(['mode'=>$apply?'apply':'preview']+$result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT)."\n";
} catch(Throwable $error) { fwrite(STDERR,'Penyiapan kandang gagal: '.$error->getMessage()."\n"); exit(1); }
