<?php
/** HTTP + concurrent DB integration tests. Dedicated database only, explicitly opt in. */
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
$dbName=getenv('DB_NAME') ?: '';
if(getenv('ALLOW_TEST_RESET')!=='1' || !preg_match('/^[a-zA-Z0-9_]+_test$/D',$dbName)) { fwrite(STDERR,"Use dedicated DB_NAME ending _test and ALLOW_TEST_RESET=1. Never run against production.\n"); exit(1); }
$base=getenv('TEST_API_URL') ?: 'http://127.0.0.1:8081';
$db=new PDO('mysql:host='.(getenv('DB_HOST')?:'127.0.0.1').';port='.(getenv('DB_PORT')?:'3306').';dbname='.$dbName.';charset=utf8mb4',getenv('DB_USER'),getenv('DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
function resetTestDatabase(bool $schema=true): void {
    global $db;
    $db->exec('SET FOREIGN_KEY_CHECKS=0'); foreach(['records','tokens','login_attempts','command_requests','users','stock','command_mutex'] as $table) $db->exec('DROP TABLE IF EXISTS '.$table); $db->exec('SET FOREIGN_KEY_CHECKS=1');
    if($schema) foreach(explode(';',preg_replace('/^--.*$/m','',file_get_contents(dirname(__DIR__).'/schema.sql'))) as $sql) if(trim($sql)!=='') $db->exec($sql);
}
$checks=0;
function check(bool $ok,string $label): void { global $checks; if(!$ok) throw new RuntimeException('FAIL: '.$label); ++$checks; echo "PASS $label\n"; }
function req(string $path,array $body=[],string $token='',string $method='POST',int $expected=200,?string $origin=null): array {
    global $base; $c=curl_init($base.$path); $headers=['Content-Type: application/json']; if($token!=='') $headers[]='Authorization: Bearer '.$token; if($origin) $headers[]='Origin: '.$origin;
    curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_TIMEOUT=>15]); if($method!=='GET') curl_setopt($c,CURLOPT_POSTFIELDS,json_encode($body));
    $raw=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); if($raw===false) throw new RuntimeException(curl_error($c)); curl_close($c);
    $r=json_decode($raw,true); if($status!==$expected || !is_array($r)) throw new RuntimeException("$method $path expected $expected received $status: ".substr($raw,0,800)); return $r['data']??$r;
}
function cmd(string $action,array $payload,string $token,int $expected=200): array { return req('/commands',['action'=>$action,'payload'=>$payload],$token,'POST',$expected); }
function first(array $state,string $collection,callable $predicate): array { foreach($state[$collection] as $r) if($predicate($r)) return $r; throw new RuntimeException('Missing '.$collection); }
function registrationWorkers(array $jobs): array {
    $workers=[]; foreach($jobs as $job) {
        $pipes=[]; $process=proc_open([PHP_BINARY,__DIR__.'/registration-worker.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        fwrite($pipes[0],json_encode($job)); fclose($pipes[0]); $workers[]=[$process,$pipes];
    }
    $results=[]; foreach($workers as [$process,$pipes]) {
        $output=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
        if(proc_close($process)!==0) throw new RuntimeException($err); $result=json_decode($output,true);
        if(!is_array($result)) throw new RuntimeException('Invalid worker response: '.$output); $results[]=$result;
    } return $results;
}
try {
    $setupKey=getenv('SETUP_TOKEN') ?: ''; if(strlen($setupKey)<32) throw new RuntimeException('Set a test-only SETUP_TOKEN (32+ characters) for both this test and the test API server.');
    resetTestDatabase(false);
    $status=req('/auth/registration-status',[],'','GET'); check($status===['first_admin_required'=>true,'setup_enabled'=>true],'empty installation reports owner-key setup availability');
    check(count($db->query('SHOW TABLES')->fetchAll())===0,'public registration status never initializes schema');
    $disabled=registrationWorkers([['action'=>'status','setup_env'=>'']])[0]; check($disabled['data']['setup_enabled']===false,'first admin setup disabled without owner key');
    $short=registrationWorkers([['action'=>'status','setup_env'=>'too-short']])[0]; check($short['data']['setup_enabled']===false,'short owner key never enables setup');
    $owner=['name'=>'Owner','email'=>'owner@test.local','password'=>' Owner Password 42 ','password_confirmation'=>' Owner Password 42 ','setup_token'=>$setupKey];
    req('/auth/register',array_replace($owner,['setup_token'=>'wrong-key']),'','POST',403); check(count($db->query('SHOW TABLES')->fetchAll())===0,'invalid owner key cannot create tables or first admin');
    $result=req('/auth/register',$owner); check($result['status']==='active' && !isset($result['token']) && (int)$db->query("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1")->fetchColumn()===1,'owner key initializes schema and exactly one active admin without automatic login');
    $ownerLogin=req('/auth/login',['email'=>$owner['email'],'password'=>$owner['password']]); $ownerToken=$ownerLogin['token']; check($ownerLogin['user']['registration_status']==='approved','registration and login preserve leading and trailing password spaces');
    $status=req('/auth/registration-status',[],'','GET'); check($status===['first_admin_required'=>false,'setup_enabled'=>false],'first admin setup permanently closes once a user exists');
    req('/auth/register',array_replace($owner,['email'=>'second-owner@test.local']),'','POST',409); check((int)$db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn()===1,'stale setup request cannot create a second admin');
    $applicant=['name'=>'Calon Karyawan','email'=>'applicant@test.local','password'=>'KataSandiPanjang42','password_confirmation'=>'KataSandiPanjang42'];
    req('/auth/register',$applicant+['role'=>'admin','active'=>true],'','POST',422); check(true,'public registration rejects role and active injection');
    req('/auth/register',array_replace($applicant,['password_confirmation'=>'different']),'','POST',422); check(true,'registration requires matching password confirmation');
    req('/auth/register',array_replace($applicant,['password'=>str_repeat('x',73),'password_confirmation'=>str_repeat('x',73)]),'','POST',422); check(true,'registration rejects bcrypt-truncated passwords');
    req('/auth/register',array_replace($applicant,['password'=>'短い文字列六個','password_confirmation'=>'短い文字列六個']),'','POST',422); check(true,'password minimum counts Unicode characters, not bytes');
    $pending=req('/auth/register',$applicant); $state=req('/bootstrap',[],$ownerToken,'GET'); $pendingUser=first($state,'users',fn($u)=>$u['email']===$applicant['email']);
    check($pending['status']==='pending' && !$pendingUser['active'] && $pendingUser['role']==='employee' && $pendingUser['registration_status']==='pending','all subsequent signups become inactive employees awaiting approval');
    check(count(array_filter($state['notifications'],fn($n)=>$n['title']==='Pendaftaran karyawan baru'))===1,'active admin receives registration notification');
    req('/auth/register',array_replace($applicant,['email'=>'APPLICANT@test.local']),'','POST',409); check(true,'normalized duplicate email cannot overwrite a pending account');
    $wrong=req('/auth/login',['email'=>$applicant['email'],'password'=>'wrong'],'','POST',401); check(!str_contains($wrong['error'],'menunggu'),'wrong password does not disclose pending registration status');
    $waiting=req('/auth/login',['email'=>$applicant['email'],'password'=>$applicant['password']],'','POST',403); check(str_contains($waiting['error'],'menunggu'),'correct pending login explains admin approval requirement');
    check((int)$db->query("SELECT COUNT(*) FROM tokens WHERE user_id=".$db->quote($pendingUser['id']))->fetchColumn()===0,'pending registrations never receive access tokens');
    $db->exec('UPDATE users SET active=1 WHERE id='.$db->quote($pendingUser['id']));
    $unexpectedToken=bin2hex(random_bytes(32)); $db->prepare('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))')->execute([hash('sha256',$unexpectedToken),$pendingUser['id']]);
    req('/bootstrap',[],$unexpectedToken,'GET',401); req('/auth/login',['email'=>$applicant['email'],'password'=>$applicant['password']],'','POST',403);
    check(true,'pending status fails closed even if active flag and token are inconsistent');
    $db->exec('UPDATE users SET active=0 WHERE id='.$db->quote($pendingUser['id']));
    cmd('user.update',['id'=>$pendingUser['id'],'active'=>true],$ownerToken,422); check(true,'generic user update cannot bypass pending approval');
    $state=cmd('user.approve',['id'=>$pendingUser['id']],$ownerToken); check(first($state,'users',fn($u)=>$u['id']===$pendingUser['id'])['registration_status']==='approved','admin approval activates employee and records approved status');
    $approvedToken=req('/auth/login',['email'=>$applicant['email'],'password'=>$applicant['password']])['token']; check(strlen($approvedToken)===64,'approved employee can log in');
    cmd('user.approve',['id'=>$pendingUser['id']],$ownerToken,409); check(true,'already-approved registration cannot be processed twice');
    $db->exec('DELETE FROM login_attempts');
    $second=array_replace($applicant,['email'=>'rejected@test.local','password'=>'éééééééééééé42','password_confirmation'=>'éééééééééééé42']); req('/auth/register',$second);
    $state=req('/bootstrap',[],$ownerToken,'GET'); $secondUser=first($state,'users',fn($u)=>$u['email']===$second['email']);
    cmd('user.reject',['id'=>$secondUser['id']],$approvedToken,403); check(true,'employee cannot review another registration');
    $state=cmd('user.reject',['id'=>$secondUser['id']],$ownerToken); check(!first($state,'users',fn($u)=>$u['id']===$secondUser['id'])['active'],'admin rejection keeps account inactive');
    req('/auth/login',['email'=>$second['email'],'password'=>$second['password']],'','POST',403); req('/auth/register',$second,'','POST',409); check(true,'rejected account cannot log in or overwrite itself by resubmitting');
    cmd('user.update',['id'=>$secondUser['id'],'active'=>true],$ownerToken,422); cmd('user.approve',['id'=>$secondUser['id']],$ownerToken);
    $unicodeLogin=req('/auth/login',['email'=>$second['email'],'password'=>$second['password']]); check($unicodeLogin['user']['registration_status']==='approved','admin can reconsider rejected registration and Unicode password authenticates');
    $records=implode('', $db->query('SELECT data FROM records')->fetchAll(PDO::FETCH_COLUMN)); check(!str_contains($records,$setupKey) && !str_contains($records,$applicant['password']) && !str_contains($records,'password_hash'),'activity and notifications never contain owner key or password material');
    $db->exec('UPDATE users SET active=0'); check(req('/auth/registration-status',[],'','GET')['first_admin_required']===false,'inactive accounts cannot reopen first-admin setup');
    resetTestDatabase();
    $race=registrationWorkers([['payload'=>array_replace($owner,['email'=>'owner-one@test.local']),'ip'=>'race-one'],['payload'=>array_replace($owner,['email'=>'owner-two@test.local']),'ip'=>'race-two']]); $codes=array_column($race,'code'); sort($codes);
    check($codes===[200,409] && (int)$db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn()===1,'concurrent setup processes create at most one admin');
    $race=registrationWorkers([['payload'=>$applicant,'ip'=>'duplicate-one'],['payload'=>$applicant,'ip'=>'duplicate-two']]); $codes=array_column($race,'code'); sort($codes);
    check($codes===[200,409] && (int)$db->query('SELECT COUNT(*) FROM users WHERE email='.$db->quote($applicant['email']))->fetchColumn()===1,'concurrent duplicate employee signup is atomic');
    $db->exec('DELETE FROM login_attempts');
    $jobs=[]; for($i=0;$i<6;$i++) $jobs[]=['payload'=>$applicant,'ip'=>'email-rate-'.$i];
    $codes=array_column(registrationWorkers($jobs),'code'); sort($codes); check($codes===[409,409,409,409,409,429],'email registration throttle persists across different IP addresses');
    $db->exec('DELETE FROM login_attempts');
    $jobs=[]; for($i=0;$i<11;$i++) $jobs[]=['payload'=>array_replace($applicant,['email'=>'rate-'.$i.'@test.local']),'ip'=>'rate-one-ip'];
    $codes=array_column(registrationWorkers($jobs),'code'); sort($codes); check(count(array_filter($codes,fn($c)=>$c===200))===10 && count(array_filter($codes,fn($c)=>$c===429))===1,'IP registration throttle persists across different email addresses');
    // Exercise shared-table contention and an expired window under genuine parallel connections.
    $db->exec('DELETE FROM login_attempts');
    $expired=$db->prepare('INSERT INTO login_attempts(attempt_key,attempts,started_at) VALUES(?,10,DATE_SUB(NOW(),INTERVAL 16 MINUTE))');
    for($i=0;$i<100;$i++) $expired->execute([hash('sha256','expired-noise-'.$i)]);
    $jobs=[]; for($i=0;$i<6;$i++) $jobs[]=['payload'=>$applicant,'ip'=>'mixed-register-'.$i];
    for($i=0;$i<11;$i++) $jobs[]=['action'=>'login','payload'=>['email'=>'missing@test.local','password'=>'WrongPassword42'],'ip'=>'mixed-login'];
    $results=registrationWorkers($jobs); $registrationCodes=array_column(array_slice($results,0,6),'code'); sort($registrationCodes); $loginCodes=array_column(array_slice($results,6),'code'); sort($loginCodes);
    check($registrationCodes===[409,409,409,409,409,429] && count(array_filter($loginCodes,fn($c)=>$c===401))===10 && count(array_filter($loginCodes,fn($c)=>$c===429))===1,'simultaneous login and signup enforce independent limits without shared-table deadlocks');
    $db->prepare('UPDATE login_attempts SET started_at=DATE_SUB(NOW(),INTERVAL 16 MINUTE) WHERE attempt_key=?')->execute([hash('sha256','mixed-login|missing@test.local')]);
    $jobs=[]; for($i=0;$i<11;$i++) $jobs[]=['action'=>'login','payload'=>['email'=>'missing@test.local','password'=>'WrongPassword42'],'ip'=>'mixed-login'];
    $codes=array_column(registrationWorkers($jobs),'code'); check(count(array_filter($codes,fn($c)=>$c===401))===10 && count(array_filter($codes,fn($c)=>$c===429))===1,'expired login counter resets once atomically under concurrency');
    $db->prepare('UPDATE login_attempts SET started_at=DATE_SUB(NOW(),INTERVAL 16 MINUTE) WHERE attempt_key=?')->execute([hash('sha256','registration-email|'.$applicant['email'])]);
    $jobs=[]; for($i=0;$i<6;$i++) $jobs[]=['payload'=>$applicant,'ip'=>'expired-register-'.$i];
    $codes=array_column(registrationWorkers($jobs),'code'); sort($codes); check($codes===[409,409,409,409,409,429],'expired signup counter resets once atomically under concurrency');
    resetTestDatabase();
    $stmt=$db->prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES('admin_test','Admin Test','admin@test.local',?,'admin')"); $stmt->execute([password_hash('SecureTestPassword42',PASSWORD_DEFAULT)]);
    req('/bootstrap',[],'','GET',401); check(true,'unauthenticated access rejected');
    req('/health',[],'','GET',403,'https://untrusted.example'); check(true,'CORS rejects unapproved origins');
    req('/auth/login',['email'=>'admin@test.local','password'=>'wrong'], '', 'POST',401);
    $admin=req('/auth/login',['email'=>'admin@test.local','password'=>'SecureTestPassword42']); $a=$admin['token']; check(strlen($a)===64,'secure login token');
    check($db->query('SELECT token_hash FROM tokens')->fetchColumn()!==$a,'only token hash stored');
    req('/health',[],'','POST',405); check(true,'HTTP method validation');
    $s=cmd('user.create',['name'=>'Sari','email'=>'sari@test.local','password'=>'PasswordSari42','role'=>'employee','target'=>5000000],$a);
    $sari=first($s,'users',fn($u)=>$u['email']==='sari@test.local');
    cmd('user.create',['name'=>'Budi','email'=>'budi@test.local','password'=>'PasswordBudi42','role'=>'employee','target'=>1000000],$a);
    $e=req('/auth/login',['email'=>'sari@test.local','password'=>'PasswordSari42'])['token']; $other=req('/auth/login',['email'=>'budi@test.local','password'=>'PasswordBudi42'])['token'];
    cmd('price.create',['good_price'=>28000,'cracked_price'=>18000,'effective_at'=>'2026-01-01T00:00:00+07:00'],$e,403); check(true,'employee cannot change prices');
    $s=cmd('price.create',['good_price'=>28000,'cracked_price'=>18000,'effective_at'=>'2026-01-01T00:00:00+07:00'],$a);
    $s=cmd('barn.create',['name'=>'Kandang A','type'=>'ayam','capacity'=>1000,'notes'=>''],$a); $barn=$s['barns'][0]['id'];
    $baseProd=['date'=>date('Y-m-d'),'barn_id'=>$barn,'category'=>'good','eggs'=>1000,'kg'=>60,'trays'=>6,'notes'=>'Panen'];
    $s=cmd('production.create',$baseProd,$e); $prod=$s['productions'][0]['id']; check($s['inventory']['good']['eggs']===1000 && $s['inventory']['good']['kg']==60,'production increases shared warehouse');
    cmd('production.create',array_replace($baseProd,['kg'=>-1]),$e,422); check(true,'negative quantities rejected');
    cmd('production.create',array_replace($baseProd,['kg'=>1.2345]),$e,422); check(true,'more than three weight decimals rejected');
    cmd('production.create',array_replace($baseProd,['date'=>'2099-01-01']),$e,422); check(true,'future business date rejected');
    $pick=['date'=>date('Y-m-d'),'category'=>'good','eggs'=>600,'kg'=>36,'trays'=>3,'area'=>'Pasar','notes'=>''];
    cmd('pickup.create',array_replace($pick,['eggs'=>1000,'kg'=>10]),$e,422); check(true,'pickup cannot strand a weight-only warehouse remainder');
    $s=cmd('pickup.create',$pick,$e); $pickup=$s['pickups'][0]['id'];
    cmd('pickup.create',$pick,$e,422); check(true,'over-pickup rejected in kg and eggs');
    $salePayload=['date'=>date('Y-m-d'),'customer'=>'Toko A','phone'=>'','items'=>[['pickup_id'=>$pickup,'category'=>'good','eggs'=>300,'kg'=>18,'trays'=>1]],'payment_method'=>'credit','paid'=>100000,'notes'=>''];
    cmd('sale.create',array_replace($salePayload,['expected_price_id'=>'stale-price']),$e,409); check(true,'stale price displayed to client requires refresh before sale');
    cmd('sale.create',array_replace($salePayload,['items'=>[['pickup_id'=>$pickup,'category'=>'good','eggs'=>600,'kg'=>18,'trays'=>1]]]),$e,422); check(true,'sale cannot strand a weight-only pickup remainder');
    $s=cmd('sale.create',$salePayload,$e); $sale=$s['sales'][0]; check($sale['total']===504000 && $sale['balance']===404000,'server computes sale total and debt');
    cmd('sale.create',$salePayload,$other,403); check(true,'other employee cannot sell owned pickup');
    cmd('sale.create',array_replace($salePayload,['items'=>[$salePayload['items'][0],$salePayload['items'][0]]]),$e,422); check(true,'duplicate pickup lines cannot oversell');
    $s=cmd('price.create',['good_price'=>31000,'cracked_price'=>20000,'effective_at'=>'2026-01-02T00:00:00+07:00'],$a);
    $old=first($s,'sales',fn($r)=>$r['id']===$sale['id']); check($old['items'][0]['unit_price']===28000 && $old['total']===504000,'old price snapshot immutable after price change');
    cmd('price.create',['good_price'=>99000,'cracked_price'=>99000,'effective_at'=>'2099-01-01T00:00:00+07:00'],$a);
    $s=cmd('sale.create',array_replace($salePayload,['items'=>[['pickup_id'=>$pickup,'category'=>'good','eggs'=>100,'kg'=>6,'trays'=>1]],'paid'=>0]),$e); $new=first($s,'sales',fn($r)=>$r['id']!==$sale['id']); check($new['items'][0]['unit_price']===31000,'future price inactive until effective time');
    cmd('pickup.return',['id'=>$pickup,'eggs'=>100,'kg'=>12,'trays'=>1,'notes'=>'Tidak terjual'],$e,422); check(true,'return cannot strand an egg-only pickup remainder');
    $s=cmd('pickup.return',['id'=>$pickup,'eggs'=>200,'kg'=>12,'trays'=>1,'notes'=>'Tidak terjual'],$e); check($s['inventory']['good']['kg']==36 && $s['inventory']['good']['eggs']===600,'return restores only unsold stock');
    $returns=array_values(array_filter($s['stock_movements'],fn($m)=>$m['kind']==='return')); check(count($returns)===1 && $returns[0]['reference_id']===$pickup && $returns[0]['kg']==12 && substr($returns[0]['date'],0,10)===date('Y-m-d'),'returns have individually dated stock ledger entries');
    cmd('pickup.return',['id'=>$pickup,'eggs'=>1,'kg'=>0.1,'trays'=>0],$e,422); check(true,'repeat/excess return rejected');
    $s=cmd('sale.payment',['id'=>$sale['id'],'amount'=>404000],$e); $paid=first($s,'sales',fn($r)=>$r['id']===$sale['id']); check($paid['payment_status']==='paid' && $paid['balance']===0,'debt repayment settles transaction');
    cmd('sale.payment',['id'=>$sale['id'],'amount'=>1],$e,422); check(true,'overpayment rejected');
    cmd('correction.apply',['entity'=>'production','id'=>$prod,'reason'=>'','changes'=>['kg'=>61]],$e,422); check(true,'mandatory correction reason');
    $s=cmd('correction.apply',['entity'=>'production','id'=>$prod,'reason'=>'Timbangan dikalibrasi','changes'=>['kg'=>61]],$e); check($s['inventory']['good']['kg']==37,'unlocked own production correction adjusts stock');
    check(array_sum(array_column($s['stock_movements'],'kg'))==37,'stock ledger includes correction delta and matches physical stock');
    cmd('correction.apply',['entity'=>'production','id'=>$prod,'reason'=>'Koreksi sangat besar','changes'=>['kg'=>1]],$e,422); check(true,'correction cannot make warehouse negative');
    cmd('record.lock',['entity'=>'production','id'=>$prod,'locked'=>true],$a);
    cmd('correction.apply',['entity'=>'production','id'=>$prod,'reason'=>'Catatan revisi','changes'=>['notes'=>'Updated']],$e,403); check(true,'locked correction requires admin');
    $s=cmd('correction.request',['entity'=>'production','id'=>$prod,'reason'=>'Catatan revisi','changes'=>['notes'=>'Updated']],$e); $correction=$s['corrections'][0]['id'];
    $s=cmd('correction.review',['id'=>$correction,'approved'=>true],$a); check(first($s,'productions',fn($r)=>$r['id']===$prod)['notes']==='Updated','admin approval applies safe correction');
    cmd('correction.apply',['entity'=>'sale','id'=>$sale['id'],'reason'=>'Tidak boleh ubah harga','changes'=>['total'=>1]],$a,422); check(true,'financial correction cannot rewrite snapshot');
    $s=cmd('correction.apply',['entity'=>'pickup','id'=>$pickup,'reason'=>'Berat bawaan diperiksa','changes'=>['eggs'=>650,'kg'=>39]],$a); check($s['inventory']['good']['kg']==34 && $s['inventory']['good']['eggs']===550,'pickup quantity correction adjusts warehouse by delta');
    cmd('correction.apply',['entity'=>'pickup','id'=>$pickup,'reason'=>'Kurang dari yang terjual','changes'=>['eggs'=>300,'kg'=>18]],$a,422); check(true,'pickup correction cannot undercut sales and returns');
    cmd('correction.apply',['entity'=>'pickup','id'=>$pickup,'reason'=>'Koreksi bawaan kembali','changes'=>['eggs'=>600,'kg'=>36]],$a);
    $item=$new['items'][0]; $revised=['id'=>$item['id'],'eggs'=>80,'kg'=>4.8,'trays'=>1];
    $s=cmd('correction.request',['entity'=>'sale','id'=>$new['id'],'reason'=>'Berat penjualan ditimbang ulang','changes'=>['items'=>[$revised]]],$e); $saleCorrection=$s['corrections'][0]['id'];
    $s=cmd('correction.review',['id'=>$saleCorrection,'approved'=>true],$a); $changed=first($s,'sales',fn($r)=>$r['id']===$new['id']); check($changed['total']===148800 && $changed['items'][0]['unit_price']===31000 && $changed['balance']===148800,'approved sale quantity correction preserves original price and recalculates debt');
    cmd('correction.apply',['entity'=>'sale','id'=>$new['id'],'reason'=>'Harga tidak boleh diganti','changes'=>['items'=>[array_replace($revised,['unit_price'=>1])]]],$a,422); check(true,'item correction rejects price override');
    cmd('correction.apply',['entity'=>'sale','id'=>$new['id'],'reason'=>'Koreksi melebihi bawaan','changes'=>['items'=>[array_replace($revised,['eggs'=>200,'kg'=>12])]]],$a,422); check(true,'sale correction cannot oversell pickup');
    cmd('correction.apply',['entity'=>'sale','id'=>$sale['id'],'reason'=>'Total turun setelah lunas','changes'=>['items'=>[['id'=>$sale['items'][0]['id'],'eggs'=>250,'kg'=>15,'trays'=>1]]]],$a,422); check(true,'sale correction rejects unsupported refund below paid amount');
    cmd('production.create',array_replace($baseProd,['category'=>'cracked','eggs'=>100,'kg'=>6,'trays'=>1]),$e);
    $s=cmd('pickup.create',array_replace($pick,['category'=>'cracked','eggs'=>100,'kg'=>6,'trays'=>1]),$e); $reviewPickup=first($s,'pickups',fn($p)=>$p['category']==='cracked')['id'];
    $reviewSalePayload=array_replace($salePayload,['items'=>[['pickup_id'=>$reviewPickup,'category'=>'cracked','eggs'=>10,'kg'=>0.6,'trays'=>0]],'paid'=>0]);
    $s=cmd('sale.create',$reviewSalePayload,$e); $reviewSale=first($s,'sales',fn($s)=>$s['items'][0]['pickup_id']===$reviewPickup);
    $s=cmd('correction.request',['entity'=>'sale','id'=>$reviewSale['id'],'reason'=>'Usulan koreksi sebelum stok terjual','changes'=>['items'=>[['id'=>$reviewSale['items'][0]['id'],'eggs'=>20,'kg'=>1.2,'trays'=>0]]]],$e); $pendingId=$s['corrections'][0]['id'];
    cmd('sale.create',array_replace($reviewSalePayload,['items'=>[['pickup_id'=>$reviewPickup,'category'=>'cracked','eggs'=>85,'kg'=>5.1,'trays'=>0]]]),$e);
    cmd('correction.review',['id'=>$pendingId,'approved'=>true],$a,422);
    $s=req('/bootstrap',[],$a,'GET'); check(first($s,'corrections',fn($c)=>$c['id']===$pendingId)['status']==='pending' && first($s,'sales',fn($s)=>$s['id']===$reviewSale['id'])['items'][0]['eggs']===10,'approval revalidates changed stock and rolls back pending correction atomically');
    $s=cmd('feed.create',['name'=>'Konsentrat','unit'=>'kg','min_stock'=>20],$a); $feed=$s['feeds'][0]['id'];
    cmd('feed.purchase',['date'=>date('Y-m-d'),'supplier'=>'Toko Pakan','items'=>[['feed_id'=>$feed,'quantity'=>1000000,'unit_price'=>100000000]],'paid'=>0,'notes'=>''],$a,422); check(true,'oversized monetary totals rejected atomically');
    $s=cmd('feed.purchase',['date'=>date('Y-m-d'),'supplier'=>'Toko Pakan','items'=>[['feed_id'=>$feed,'quantity'=>100,'unit_price'=>9000]],'paid'=>900000,'notes'=>''],$a); check($s['feed_purchases'][0]['total']===900000 && $s['feed_inventory'][$feed]==100,'feed purchase total, receipt number and stock');
    $s=cmd('feed.use',['date'=>date('Y-m-d'),'feed_id'=>$feed,'barn_id'=>$barn,'quantity'=>25,'notes'=>'Pagi'],$e); check($s['feed_inventory'][$feed]==75,'feed use reduces shared stock');
    cmd('feed.use',['date'=>date('Y-m-d'),'feed_id'=>$feed,'barn_id'=>$barn,'quantity'=>80,'notes'=>''],$e,422); check(true,'feed overuse rejected');
    $s=req('/bootstrap',[],$other,'GET'); check(count($s['productions'])===0 && count($s['sales'])===0 && count($s['activity'])===0 && count($s['users'])===1 && $s['inventory']['good']['kg']==37,'employee row-level isolation and shared inventory');
    check(count($s['notifications'])>=3,'price notifications delivered per employee');
    $s=cmd('notification.read',['id'=>'all'],$other); check(count(array_filter($s['notifications'],fn($n)=>!$n['read']))===0,'mark own notifications read');
    $envelope=['action'=>'barn.create','payload'=>['name'=>'Idempotent Barn','type'=>'ayam','capacity'=>0,'notes'=>''],'request_id'=>'test-request-'.bin2hex(random_bytes(10))];
    $one=req('/commands',$envelope,$a); $two=req('/commands',$envelope,$a); check(count($one['barns'])===count($two['barns']),'retried command request ID does not duplicate a write');
    $envelope['payload']['name']='Different'; req('/commands',$envelope,$a,'POST',409); check(true,'same request ID rejects different payload');
    cmd('user.update',['id'=>'admin_test','active'=>false],$a,422); check(true,'self-admin deactivation blocked');
    // Two independent PHP processes compete for a balance that can satisfy only one.
    cmd('production.create',array_replace($baseProd,['category'=>'cracked','eggs'=>200,'kg'=>10,'trays'=>1]),$e);
    $payload=['token'=>$e,'action'=>'pickup.create','payload'=>array_replace($pick,['category'=>'cracked','eggs'=>150,'kg'=>8,'trays'=>1])]; $workers=[];
    for($i=0;$i<2;$i++){ $pipes=[]; $process=proc_open([PHP_BINARY,__DIR__.'/command-worker.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes); fwrite($pipes[0],json_encode($payload)); fclose($pipes[0]); $workers[]=[$process,$pipes]; }
    $results=[]; foreach($workers as [$process,$pipes]){ $results[]=trim(stream_get_contents($pipes[1])); $err=stream_get_contents($pipes[2]); fclose($pipes[1]);fclose($pipes[2]); $code=proc_close($process); if($code!==0) throw new RuntimeException($err); } sort($results); check($results===['200','422'],'concurrent stock race allows exactly one pickup');
    cmd('user.update',['id'=>$sari['id'],'active'=>false],$a); req('/bootstrap',[],$e,'GET',401); check(true,'deactivation revokes existing tokens');
    req('/auth/logout',[],$other); req('/bootstrap',[],$other,'GET',401); check(true,'logout invalidates token');
    req('/application/config/config.php',[],'','GET',404); check(true,'internal files not exposed by dev router');
    echo "\n$checks integration checks passed.\n";
} catch(Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
