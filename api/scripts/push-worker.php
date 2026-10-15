<?php
/** Run once per minute from hosting cron. No web-accessible worker endpoint. */
if(PHP_SAPI!=='cli') exit;
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
$options=getopt('',['limit:']); $limit=max(1,min(100,(int)($options['limit']??50)));
try {
    if(!PushService::ready()) throw new RuntimeException('Web Push keys or Composer dependencies are not configured.');
    $farm=new FarmService(); $result=(new PushService($farm->database()))->drain($limit,50);
    $status=['last_run'=>date('c'),'ok'=>true,'counts'=>$result];
    file_put_contents(dirname(__DIR__).'/application/logs/push-worker-status.json',json_encode($status,JSON_THROW_ON_ERROR),LOCK_EX);
    echo $status['last_run'].' '.json_encode($result,JSON_THROW_ON_ERROR)."\n";
} catch(Throwable $e) {
    @file_put_contents(dirname(__DIR__).'/application/logs/push-worker-status.json',json_encode(['last_run'=>date('c'),'ok'=>false]),LOCK_EX);
    fwrite(STDERR,"Web Push worker failed. Check private server configuration/database and try again.\n"); exit(1);
}
