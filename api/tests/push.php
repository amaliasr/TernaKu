<?php
/** Dedicated MySQL tests; delivery is always mocked, never sent to a real device. */
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
require dirname(__DIR__).'/vendor/autoload.php';
$dbName=getenv('DB_NAME') ?: '';
if(getenv('ALLOW_TEST_RESET')!=='1' || !preg_match('/^[a-zA-Z0-9_]+_test$/D',$dbName)) { fwrite(STDERR,"Use an isolated _test database and ALLOW_TEST_RESET=1.\n"); exit(1); }
$db=(new FarmService())->database(); $checks=0; $server=null; $serverPipes=[];
function checkPush(bool $ok,string $message): void { global $checks; if(!$ok) throw new RuntimeException('FAIL '.$message); $checks++; echo 'PASS '.$message."\n"; }
function rejectsPush(callable $action,int $status): void { try { $action(); } catch(ApiProblem $e) { checkPush($e->status===$status,'request rejected with '.$status); return; } throw new RuntimeException('Expected push rejection'); }
function countPush(string $kind): int { global $db; $s=$db->prepare('SELECT COUNT(*) FROM records WHERE kind=?'); $s->execute([$kind]); return (int)$s->fetchColumn(); }
function rawPush(string $path,array $body=[],string $token='',string $method='POST',int $expected=200): array {
    global $port; $c=curl_init('http://127.0.0.1:'.$port.$path); $headers=['Content-Type: application/json']; if($token) $headers[]='Authorization: Bearer '.$token;
    curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_TIMEOUT=>10]); if($method!=='GET') curl_setopt($c,CURLOPT_POSTFIELDS,json_encode($body));
    $response=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); curl_close($c);
    $json=json_decode($response?:'',true); if($status!==$expected || !is_array($json)) throw new RuntimeException('Unexpected push HTTP status '.$status.' on '.$path);
    return $json['data']??$json;
}
try {
    $db->exec('SET FOREIGN_KEY_CHECKS=0'); foreach(['records','tokens','login_attempts','command_requests','users','stock','command_mutex'] as $table) $db->exec('DROP TABLE IF EXISTS '.$table); $db->exec('SET FOREIGN_KEY_CHECKS=1');
    foreach(explode(';',preg_replace('/^--.*$/m','',file_get_contents(dirname(__DIR__).'/schema.sql'))) as $sql) if(trim($sql)!=='') $db->exec($sql);
    $statement=$db->prepare('INSERT INTO users(id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?)');
    foreach([['push_admin','admin',1],['push_employee','employee',1],['push_other','employee',1],['push_pending','employee',0]] as [$id,$role,$active]) $statement->execute([$id,$id,$id.'@test.local',password_hash('TestPasswordForPush42',PASSWORD_DEFAULT),$role,$active]);
    $farm=new FarmService($db); $tokens=[];
    foreach(['push_admin','push_employee','push_other'] as $id) $tokens[$id]=$farm->login(['email'=>$id.'@test.local','password'=>'TestPasswordForPush42'],'push-test')['token'];
    $farm->authenticate($tokens['push_admin']);
    $keys=Minishlink\WebPush\VAPID::createVapidKeys()+['subject'=>'https://ternaku.rstudiohub.com'];
    $browserKeys=Minishlink\WebPush\VAPID::createVapidKeys();
    $subscription=['endpoint'=>'https://fcm.googleapis.com/fcm/send/ternaku-isolated-test','expirationTime'=>null,'keys'=>['p256dh'=>$browserKeys['publicKey'],'auth'=>rtrim(strtr(base64_encode(random_bytes(16)),'+/','-_'),'=')]];
    $deliveries=[]; $mock=function($sub,$payload)use(&$deliveries){ $deliveries[]=$payload; return ['success'=>true,'expired'=>false,'status'=>201]; };
    $push=new PushService($db,$mock,$keys);
    $history=[]; $transport=GuzzleHttp\HandlerStack::create(new GuzzleHttp\Handler\MockHandler([new GuzzleHttp\Psr7\Response(201)]));
    $transport->push(GuzzleHttp\Middleware::history($history));
    $crypto=new Minishlink\WebPush\WebPush(['VAPID'=>$keys],['TTL'=>604800,'urgency'=>'high'],4,['handler'=>$transport,'allow_redirects'=>false]);
    $encrypted=$crypto->sendOneNotification(Minishlink\WebPush\Subscription::create(PushService::subscription($subscription)),json_encode(['body'=>'Harga rahasia pengujian']));
    checkPush($encrypted->isSuccess() && $history[0]['request']->getHeaderLine('Content-Encoding')==='aes128gcm' && !str_contains((string)$history[0]['request']->getBody(),'Harga rahasia'),'library encrypts modern browser payload and signs VAPID without real network');
    checkPush($push->status()['enabled'] && $push->status()['public_key']===$keys['publicKey'],'configured VAPID status exposes only public key');
    checkPush(!(new PushService($db,null,[]))->status()['enabled'],'missing VAPID setup is disabled');
    foreach(['https://127.0.0.1/private','http://fcm.googleapis.com/fcm/send/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com@evil.test/x','https://fcm.googleapis.com:8443/x','https://fcm.googleapis.com/x#fragment','https://localhost/x'] as $endpoint) rejectsPush(fn()=>PushService::endpoint($endpoint),422);
    foreach(['https://fcm.googleapis.com/fcm/send/x','https://updates.push.services.mozilla.com/wpush/v2/x','https://web.push.apple.com/x','https://wns2-test.notify.windows.com/w/?token=x'] as $endpoint) checkPush(PushService::endpoint($endpoint)===$endpoint,'official browser push origin accepted');
    rejectsPush(fn()=>PushService::subscription(array_replace($subscription,['keys'=>['p256dh'=>'bad','auth'=>'bad']])),422);
    rejectsPush(fn()=>$push->subscribe('push_pending','token',$subscription),401);
    $bound=$push->subscribe('push_employee',$tokens['push_employee'],$subscription);
    checkPush($push->subscribe('push_employee',$tokens['push_employee'],$subscription)['binding_id']===$bound['binding_id'] && countPush('push_subscription')===1,'repeated subscribe preserves a single binding');
    $push->unsubscribe('push_other',['endpoint'=>$subscription['endpoint']]); checkPush(countPush('push_subscription')===1,'another user cannot remove a subscription');
    $price=['good_price'=>28000,'cracked_price'=>0,'effective_at'=>date('c',time()+86400)];
    $state=$farm->command('price.create',$price,'push-price-uuid-1');
    checkPush(countPush('push_job')===1,'price save atomically adds an outbox job');
    $farm->command('price.create',$price,'push-price-uuid-1'); checkPush(countPush('push_job')===1,'same command UUID never enqueues twice');
    $farm->command('price.create',$price,'push-price-uuid-2'); checkPush(countPush('push_job')===2,'a new price update with identical amounts queues another event');
    $before=countPush('push_job'); $db->beginTransaction(); $push->enqueuePrice(['id'=>'rollback_price']+$price); $db->rollBack(); checkPush(countPush('push_job')===$before,'rolled back transaction also rolls back its push jobs');
    $public=json_encode($farm->bootstrap()); checkPush(!str_contains($public,$subscription['endpoint']) && !str_contains($public,$browserKeys['publicKey']) && !str_contains($public,'push_job'),'bootstrap never leaks endpoints, encryption keys, or queue');
    $result=$push->drain(); checkPush($result['sent']===2 && count($deliveries)===2 && $deliveries[0]['tag']!==$deliveries[1]['tag'],'different price IDs produce distinct notifications');
    checkPush(str_contains($deliveries[0]['body'],'Gratis') && str_contains($deliveries[0]['body'],date('d/m/Y',time()+86400)),'free bentes and future effective date are explicit');
    checkPush($push->drain()['sent']===0,'delivered jobs are never resent by the next worker');
    $harvest=['date'=>date('Y-m-d'),'notes'=>'RAHASIA lokasi','items'=>[
        ['category'=>'good','eggs'=>30,'kg'=>1.8],['category'=>'cracked','eggs'=>10,'kg'=>0.6],
    ]];
    $state=$farm->command('production.create',$harvest,'activity-combined-1');
    $notices=array_values(array_filter($state['notifications'],fn($n)=>($n['type']??'')==='farm.activity'));
    checkPush(count($notices)===1 && $notices[0]['activity']==='production.stocked' && $notices[0]['title']==='Panen masuk gudang'
        && str_contains($notices[0]['message'],'2,4 kg') && !str_contains($notices[0]['message'],'RAHASIA'),'two harvest categories share one safe combined harvest-and-stock notice');
    $event=$notices[0]['event_id'];
    $audience=$db->prepare("SELECT user_id FROM records WHERE kind='notification' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.event_id'))=? ORDER BY user_id");
    $audience->execute([$event]);
    checkPush($audience->fetchAll(PDO::FETCH_COLUMN)===['push_admin','push_employee','push_other'],'all active accounts including the actor have an inbox copy, and inactive accounts do not');
    $farm->command('production.create',$harvest,'activity-combined-1');
    $audience->execute([$event]);
    checkPush(count($audience->fetchAll())===3 && countPush('push_job')===1 && $push->drain()['sent']===1,'replaying the command duplicates neither inbox records nor device deliveries');
    $combined=end($deliveries);
    checkPush($combined['type']==='farm.activity' && $combined['id']===$event && $combined['tag']==='farm-'.$event && $combined['url']==='/'
        && $combined['body']===$notices[0]['message'] && !str_contains(json_encode($combined),'RAHASIA'),'queued push and authenticated inbox refer to the same privacy-limited activity');
    $farm->command('settings.update',['harvest_auto_stock'=>false],'activity-manual-settings');
    $pending=$farm->command('production.create',$harvest,'activity-pending');
    $unreceived=array_values(array_filter($pending['productions'],fn($p)=>$p['stocked_at']===null));
    $farm->command('production.receive',['id'=>$unreceived[0]['id']],'activity-receive');
    $pickupState=$farm->command('pickup.create',['date'=>date('Y-m-d'),'category'=>'good','eggs'=>10,'kg'=>0.6,'area'=>'RAHASIA area'],'activity-pickup');
    $farm->command('pickup.return',['id'=>$pickupState['pickups'][0]['id'],'eggs'=>3,'kg'=>0.18,'notes'=>'RAHASIA retur'],'activity-return');
    $farm->command('price.create',array_replace($price,['effective_at'=>date('c',time()-60)]),'activity-current-price');
    $proof='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=';
    $sale=['date'=>date('Y-m-d'),'stock_source'=>'warehouse','customer'=>'RAHASIA pelanggan','photo'=>$proof,'notes'=>'RAHASIA transaksi',
        'items'=>[['category'=>'good','kg'=>0.06],['category'=>'cracked','kg'=>0.12]],'payment_method'=>'cash','paid'=>0];
    $sold=$farm->command('sale.create',$sale,'activity-sale');
    $balance=$sold['inventory']['good']; $added=$balance; $added['eggs']+=10; $added['kg']+=0.6;
    $addition=['method'=>'add','reason'=>'RAHASIA pergudangan','items'=>[['category'=>'good','expected'=>$balance,'physical'=>$added]]];
    $farm->command('stock.reconcile',$addition,'activity-add');
    $farm->command('stock.reconcile',['method'=>'count','reason'=>'RAHASIA hitung ulang','items'=>[['category'=>'good','expected'=>$added,'physical'=>$added]]],'activity-count');
    $saleId=$sold['command_result']['record_id'];
    $farm->command('correction.apply',['entity'=>'sale','id'=>$saleId,'reason'=>'RAHASIA koreksi','changes'=>['notes'=>'RAHASIA catatan']],'activity-correct');
    $deliveryStart=count($deliveries);
    $push->drain(20);
    $activities=array_values(array_filter(array_slice($deliveries,$deliveryStart),fn($d)=>$d['type']==='farm.activity'));
    $kinds=array_column($activities,'activity'); sort($kinds);
    checkPush($kinds===['pickup.return','production.create','production.receive','sale.create','stock.add']
        && count(array_unique(array_column($activities,'tag')))===5,'each manual harvest, receipt, return, sale and addition sends once; a count or correction does not send');
    $sales=array_values(array_filter($activities,fn($d)=>$d['activity']==='sale.create'));
    checkPush(str_contains($sales[0]['body'],'0,18 kg') && !str_contains(json_encode($activities),'RAHASIA') && !str_contains(json_encode($activities),'data:image')
        && !str_contains($sales[0]['body'],'Rp'),'sale events sum item weights and exclude customer, proof, note, price and total');
    $farm->command('price.create',$price,'push-retry-uuid');
    $fail=new PushService($db,fn()=>['success'=>false,'expired'=>false,'status'=>503],$keys);
    checkPush($fail->drain()['retry']===1 && countPush('push_job')===1,'temporary failure retains durable pending job');
    checkPush($push->drain()['sent']===0,'failed delivery observes backoff'); $db->exec("UPDATE records SET occurred_at=NOW() WHERE kind='push_job'");
    checkPush($push->drain()['sent']===1,'next cron delivers pending job after backoff');
    $farm->command('price.create',$price,'push-rebind-uuid');
    $push->subscribe('push_other',$tokens['push_other'],$subscription);
    checkPush($push->drain()['cancelled']===1,'reassigned browser never receives old user queued messages');
    $push->test('push_other',['endpoint'=>$subscription['endpoint']]); rejectsPush(fn()=>$push->test('push_other',['endpoint'=>$subscription['endpoint']]),429);
    $push->logout('push_other',$tokens['push_other']); checkPush(countPush('push_subscription')===0 && $push->drain()['cancelled']===1,'logout unbinds session and cancels undelivered jobs');
    rejectsPush(fn()=>$push->subscribe('push_other',$tokens['push_other'],$subscription),401);
    checkPush(countPush('push_subscription')===0,'stale subscribe cannot recreate a binding after logout revoked its token');
    $tokens['push_other']=$farm->login(['email'=>'push_other@test.local','password'=>'TestPasswordForPush42'],'push-test')['token'];
    $farm->authenticate($tokens['push_admin']);
    $push->subscribe('push_employee',$tokens['push_employee'],$subscription); $farm->command('price.create',$price,'push-expire-uuid');
    $expired=new PushService($db,fn()=>['success'=>false,'expired'=>true,'status'=>410],$keys);
    checkPush($expired->drain()['failed']===1 && countPush('push_subscription')===0,'expired browser endpoint is removed');
    $push->subscribe('push_employee',$tokens['push_employee'],$subscription); $farm->command('price.create',$price,'push-disabled-uuid'); $db->exec("UPDATE users SET active=0 WHERE id='push_employee'");
    checkPush($push->drain()['cancelled']===1,'disabled account receives no queued push'); $db->exec("UPDATE users SET active=1 WHERE id='push_employee'");

    // HTTP auth checks run on a private local server. No successful HTTP test-send/price write occurs.
    putenv('WEB_PUSH_PUBLIC_KEY='.$keys['publicKey']); putenv('WEB_PUSH_PRIVATE_KEY='.$keys['privateKey']); putenv('WEB_PUSH_SUBJECT='.$keys['subject']);
    $socket=stream_socket_server('tcp://127.0.0.1:0',$errno,$error); $port=(int)substr(strrchr(stream_socket_get_name($socket,false),':'),1); fclose($socket);
    $root=dirname(__DIR__); $server=proc_open([PHP_BINARY,'-S','127.0.0.1:'.$port,'-t',$root,$root.'/router.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$serverPipes);
    if(!is_resource($server)) throw new RuntimeException('Cannot start isolated HTTP API');
    for($i=0;$i<50;$i++){ $probe=@fsockopen('127.0.0.1',$port,$errno,$error,0.1); if($probe){fclose($probe);break;} usleep(100000); }
    foreach(['/push/status'=>'GET','/push/subscribe'=>'POST','/push/unsubscribe'=>'POST','/push/test'=>'POST','/push/native/subscribe'=>'POST','/push/native/unsubscribe'=>'POST','/push/native/test'=>'POST'] as $path=>$method) rawPush($path,[],'',$method,401);
    checkPush(true,'all push HTTP endpoints require an authenticated active user');
    $status=rawPush('/push/status',[],$tokens['push_employee'],'GET'); checkPush($status['enabled'] && !str_contains(json_encode($status),$keys['privateKey']),'HTTP status exposes no private VAPID material');
    rawPush('/push/subscribe',$subscription+['user_id'=>'push_other'],$tokens['push_employee'],'POST',422);
    rawPush('/push/subscribe',$subscription,$tokens['push_employee']); rawPush('/push/unsubscribe',['endpoint'=>$subscription['endpoint']],$tokens['push_other']);
    checkPush(countPush('push_subscription')===1,'HTTP subscription owner comes from bearer user, never request body');
    rawPush('/auth/logout',[],$tokens['push_employee']); checkPush(countPush('push_subscription')===0,'HTTP logout removes bound device subscription');
    require __DIR__.'/native-push-checks.php';
    echo "Completed $checks web and native push checks with mock delivery.\n";
} finally {
    if(is_resource($server)) { proc_terminate($server); foreach($serverPipes as $pipe) if(is_resource($pipe)) fclose($pipe); proc_close($server); }
}
