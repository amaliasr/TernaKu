<?php
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    $p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
    if(isset($p['setup_env'])) putenv('SETUP_TOKEN='.$p['setup_env']);
    $farm=new FarmService();
    if(($p['action']??'')==='status') echo json_encode(['code'=>200,'data'=>$farm->registrationStatus()]);
    elseif(($p['action']??'')==='login') { $farm->login($p['payload'],$p['ip']??'test-worker'); echo json_encode(['code'=>200]); }
    else echo json_encode(['code'=>200,'data'=>$farm->register($p['payload'],$p['ip']??'test-worker')]);
} catch(ApiProblem $e) { echo json_encode(['code'=>$e->status,'error'=>$e->getMessage()]); }
catch(Throwable $e) { fwrite(STDERR,$e->getMessage()); exit(1); }
