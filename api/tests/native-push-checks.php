<?php
// Included by push.php after its disposable DB and users have been prepared.
if(PHP_SAPI!=='cli' || !isset($farm,$tokens,$mock,$checks)) exit;
use GuzzleHttp\Psr7\Response;
use Jose\Component\Core\Util\ECSignature;

function verifyPushJWT(string $jwt,string $publicKey,bool $ec): array {
    [$header,$claims,$signature]=explode('.',$jwt);
    $raw=base64_decode(strtr($signature,'-_','+/'),true);
    if($ec) $raw=ECSignature::toAsn1($raw,64);
    checkPush(openssl_verify($header.'.'.$claims,$raw,$publicKey,OPENSSL_ALGO_SHA256)===1,'provider JWT independently verified by OpenSSL');
    return json_decode(base64_decode(strtr($claims,'-_','+/')),true,512,JSON_THROW_ON_ERROR);
}
$credentials=[];
try {
    putenv('FCM_SERVICE_ACCOUNT_FILE=');
    putenv('APNS_PRIVATE_KEY_FILE=');
    $android=['platform'=>'android','installation_id'=>'3102b295-2bd6-4070-a0a1-7c14041bbe82','token'=>'fixture:'.bin2hex(random_bytes(40))];
    $ios=['platform'=>'ios','installation_id'=>'8b79c93e-7cf2-4f92-8dc2-c3cc5b3983a9','token'=>bin2hex(random_bytes(32)),'environment'=>'sandbox'];
    $native=new PushService($db,$mock,[]); // Independent of VAPID.
    checkPush($native->status()['native']===['android'=>false,'ios'=>false],'native delivery defaults off without credentials');
    rejectsPush(fn()=>$native->subscribeNative('push_other',$tokens['push_other'],$android),503);

    $rsa=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_RSA,'private_key_bits'=>2048]);
    $ec=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
    openssl_pkey_export($rsa,$rsaPem); openssl_pkey_export($ec,$ecPem);
    $credentials[]=tempnam(sys_get_temp_dir(),'native-fcm-test-');
    $credentials[]=tempnam(sys_get_temp_dir(),'native-apns-test-');
    file_put_contents($credentials[0],json_encode(['type'=>'service_account','project_id'=>'fixture-push','client_email'=>'fixture@test.example','private_key'=>$rsaPem]));
    file_put_contents($credentials[1],$ecPem);
    putenv('FCM_SERVICE_ACCOUNT_FILE='.$credentials[0]); putenv('APNS_PRIVATE_KEY_FILE='.$credentials[1]);
    putenv('APNS_TEAM_ID=ABCD123456'); putenv('APNS_KEY_ID=EFGH123456'); putenv('APNS_BUNDLE_ID=com.rstudiohub.ternaku');
    checkPush($native->status()['native']===['android'=>true,'ios'=>true] && !$native->status()['enabled'],'each native provider can run without browser keys');

    $employeeToken=$farm->login(['email'=>'push_employee@test.local','password'=>'TestPasswordForPush42'],'fixture-native')['token'];
    $farm->authenticate($tokens['push_admin']);
    rejectsPush(fn()=>$native->subscribeNative('push_other',$tokens['push_other'],$android+['user_id'=>'push_admin']),422);
    rejectsPush(fn()=>$native->subscribeNative('push_other',$tokens['push_other'],array_replace($ios,['environment'=>'bogus'])),422);
    $binding=$native->subscribeNative('push_employee',$employeeToken,$android)['binding_id'];
    checkPush($native->subscribeNative('push_employee',$employeeToken,$android)['binding_id']===$binding,'native binding persists across reconnect');
    $native->subscribeNative('push_employee',$employeeToken,$ios);
    $deliveries=[];
    $farm->command('price.create',$price,'native-price-one');
    $farm->command('price.create',$price,'native-price-one');
    $farm->command('price.create',$price,'native-price-two');
    checkPush($native->drain()['sent']===4 && count(array_unique(array_column($deliveries,'id')))===2,'two equal price updates deliver separate Android and iOS events, command retry deduplicates');

    $httpHistory=[];
    $fakeResponses=[new Response(200,[],'{"access_token":"fixture-google-bearer","expires_in":3600}'),new Response(200,[],'{"name":"projects/fixture-push/messages/1"}'),new Response(200),new Response(404,[],'{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}'),new Response(410,[],'{"reason":"Unregistered"}')];
    $handlers=GuzzleHttp\HandlerStack::create(new GuzzleHttp\Handler\MockHandler($fakeResponses));
    $handlers->push(GuzzleHttp\Middleware::history($httpHistory));
    $providers=new NativePushTransport(new GuzzleHttp\Client(['handler'=>$handlers,'http_errors'=>false]));
    checkPush($providers->send($android,$deliveries[0])['success'] && $providers->send($ios,$deliveries[1])['success'],'real FCM and APNs encoders accepted by simulated providers');
    parse_str((string)$httpHistory[0]['request']->getBody(),$oauth);
    $claims=verifyPushJWT($oauth['assertion'],openssl_pkey_get_details($rsa)['key'],false);
    checkPush($claims['aud']==='https://oauth2.googleapis.com/token' && $claims['scope']==='https://www.googleapis.com/auth/firebase.messaging','Google service assertion has the limited messaging scope and correct audience');
    $fcm=json_decode((string)$httpHistory[1]['request']->getBody(),true)['message'];
    checkPush($fcm['android']['priority']==='HIGH' && !isset($fcm['notification']) && !isset($fcm['android']['collapse_key']) && $fcm['data']['type']==='price.updated' && $fcm['data']['id']===$deliveries[0]['id'] && $fcm['data']['body']===$deliveries[0]['body'],'Android gets a high priority, noncollapsible data message with event ID and amount');
    $apple=$httpHistory[2]['request']; $apns=json_decode((string)$apple->getBody(),true);
    $appleClaims=verifyPushJWT(substr($apple->getHeaderLine('authorization'),7),openssl_pkey_get_details($ec)['key'],true);
    checkPush($appleClaims['iss']==='ABCD123456' && $apple->getUri()->getHost()==='api.sandbox.push.apple.com' && $apple->getHeaderLine('apns-topic')==='com.rstudiohub.ternaku' && $apple->getHeaderLine('apns-push-type')==='alert' && $apple->getHeaderLine('apns-priority')==='10' && $apns['aps']['alert']['body']===$deliveries[1]['body'],'signed APNs alert has the correct bundle, priority and sandbox endpoint');
    checkPush($providers->send($android,$deliveries[0])['expired'] && $providers->send(array_replace($ios,['environment'=>'production']),$deliveries[1])['expired'] && $httpHistory[4]['request']->getUri()->getHost()==='api.push.apple.com','obsolete tokens recognized and distribution builds use production APNs');

    $farm->command('price.create',$price,'native-rebind');
    $native->subscribeNative('push_other',$tokens['push_other'],$android);
    $rotated=array_replace($ios,['token'=>bin2hex(random_bytes(32))]);
    $native->subscribeNative('push_employee',$employeeToken,$rotated);
    $afterRotation=$native->drain();
    checkPush($afterRotation['cancelled']===1 && $afterRotation['sent']===1 && countPush('push_subscription')===2,'switching account cancels stale deliveries while token rotation keeps updates for the same installation and session');
    $device=['platform'=>'android','installation_id'=>$android['installation_id']];
    $native->unsubscribeNative('push_employee',$employeeToken,$device);
    $native->testNative('push_other',$tokens['push_other'],$device);
    rejectsPush(fn()=>$native->testNative('push_other',$tokens['push_other'],$device),429);
    $native->logout('push_other',$tokens['push_other']);
    checkPush($native->drain()['cancelled']===1 && countPush('push_subscription')===1,'unrelated session cannot remove a native registration, logout invalidates its own test delivery');
    $farm->command('price.create',$price,'native-expire');
    $db->prepare('UPDATE tokens SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=?')->execute([hash('sha256',$employeeToken)]);
    checkPush($native->drain()['cancelled']===1,'native price alerts stop for expired sessions');
} finally {
    foreach($credentials as $fixture) if(is_file($fixture)) unlink($fixture);
}
