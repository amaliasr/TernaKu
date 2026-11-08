<?php
/** HTTP + concurrent DB integration tests. Dedicated database only, explicitly opt in. */
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
require dirname(__DIR__).'/application/libraries/UsernameService.php';
require dirname(__DIR__).'/application/libraries/AccountPolicyService.php';
$dbName=getenv('DB_NAME') ?: '';
if(getenv('ALLOW_TEST_RESET')!=='1' || !preg_match('/^[a-zA-Z0-9_]+_test$/D',$dbName)) { fwrite(STDERR,"Use dedicated DB_NAME ending _test and ALLOW_TEST_RESET=1. Never run against production.\n"); exit(1); }
$base=getenv('TEST_API_URL') ?: 'http://127.0.0.1:8081';
$db=new PDO('mysql:host='.(getenv('DB_HOST')?:'127.0.0.1').';port='.(getenv('DB_PORT')?:'3306').';dbname='.$dbName.';charset=utf8mb4',getenv('DB_USER'),getenv('DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
// DATETIME fixtures and NOW() assertions must use the same session timezone as FarmService, even on UTC CI hosts.
$db->exec("SET time_zone = '+07:00'");
function resetTestDatabase(bool $schema=true): void {
    global $db;
    $db->exec('SET FOREIGN_KEY_CHECKS=0'); foreach(['records','tokens','login_attempts','command_requests','users','stock','command_mutex'] as $table) $db->exec('DROP TABLE IF EXISTS '.$table); $db->exec('SET FOREIGN_KEY_CHECKS=1');
    if($schema) foreach(explode(';',preg_replace('/^--.*$/m','',file_get_contents(dirname(__DIR__).'/schema.sql'))) as $sql) if(trim($sql)!=='') $db->exec($sql);
}
$checks=0;
$profilePhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=';
function check(bool $ok,string $label): void { global $checks; if(!$ok) throw new RuntimeException('FAIL: '.$label); ++$checks; echo "PASS $label\n"; }
function req(string $path,array $body=[],string $token='',string $method='POST',int $expected=200,?string $origin=null): array {
    global $base; $c=curl_init($base.$path); $headers=['Content-Type: application/json']; if($token!=='') $headers[]='Authorization: Bearer '.$token; if($origin) $headers[]='Origin: '.$origin;
    curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_TIMEOUT=>15]); if($method!=='GET') curl_setopt($c,CURLOPT_POSTFIELDS,json_encode($body));
    $raw=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); if($raw===false) throw new RuntimeException(curl_error($c)); curl_close($c);
    $r=json_decode($raw,true); if($status!==$expected || !is_array($r)) throw new RuntimeException("$method $path expected $expected received $status: ".substr($raw,0,800)); return $r['data']??$r;
}
function cmd(string $action,array $payload,string $token,int $expected=200): array { return req('/commands',['action'=>$action,'payload'=>$payload],$token,'POST',$expected); }
function multipartCommand(array $command,string $token,string $bytes,string $mime='image/png',int $expected=200): array {
    global $base;
    $c=curl_init($base.'/commands');
    curl_setopt_array($c,[
        CURLOPT_RETURNTRANSFER=>true, CURLOPT_TIMEOUT=>15, CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$token],
        CURLOPT_POSTFIELDS=>['command'=>json_encode($command), 'photo'=>new CURLStringFile($bytes,'photo',$mime)],
    ]);
    $raw=curl_exec($c);
    if($raw===false) throw new RuntimeException(curl_error($c));
    $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); $size=curl_getinfo($c,CURLINFO_SIZE_UPLOAD);
    $response=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
    if($status!==$expected) throw new RuntimeException("Multipart command expected $expected, received $status: ".substr($raw,0,600));
    return [$response['data']??$response,$size];
}
function mediaReq(string $path,string $token,int $expected=200): array {
    global $base; $c=curl_init($base.$path); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_HEADER=>true,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$token],CURLOPT_TIMEOUT=>15]);
    $raw=curl_exec($c); if($raw===false) throw new RuntimeException(curl_error($c)); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); $length=curl_getinfo($c,CURLINFO_HEADER_SIZE); $type=curl_getinfo($c,CURLINFO_CONTENT_TYPE); curl_close($c);
    if($status!==$expected) throw new RuntimeException("GET $path expected $expected, received $status"); return ['body'=>substr($raw,$length),'headers'=>substr($raw,0,$length),'type'=>$type];
}
function first(array $state,string $collection,callable $predicate): array { foreach($state[$collection] as $r) if($predicate($r)) return $r; throw new RuntimeException('Missing '.$collection); }
function businessSnapshot(): string {
    global $db; $rows=[];
    foreach(['users'=>'id','records'=>'id','stock'=>'stock_key','command_requests'=>'request_id','command_mutex'=>'id'] as $table=>$order) $rows[$table]=$db->query('SELECT * FROM '.$table.' ORDER BY '.$order)->fetchAll(PDO::FETCH_ASSOC);
    return hash('sha256',json_encode($rows));
}
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
    resetTestDatabase();
    $db->exec('ALTER TABLE users DROP COLUMN is_superadmin, DROP COLUMN deleted_at');
    AccountPolicyService::migrate($db); AccountPolicyService::migrate($db);
    check((int)$db->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME IN ('is_superadmin','deleted_at')")->fetchColumn()===2,'account policy upgrade is additive and idempotent on the legacy schema');
    $db->exec('ALTER TABLE users DROP INDEX users_username_unique, DROP COLUMN username');
    $legacyHash=password_hash('LegacyPassword42',PASSWORD_DEFAULT);
    $insert=$db->prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,'employee')");
    foreach(['legacy_1'=>'same@one.example','legacy_2'=>'same@two.example','legacy_3'=>'a@three.example','legacy_4'=>str_repeat('z',60).'@four.example'] as $id=>$email) $insert->execute([$id,'Legacy account',$email,$legacyHash]);
    $legacyToken=bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))')->execute([hash('sha256',$legacyToken),'legacy_1']);
    check(UsernameService::migrate($db)===4,'username upgrade backfills an old users table without recreating it');
    $legacyUsers=$db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    check(array_column($legacyUsers,'username')===['same','same.2','user.a',str_repeat('z',32)],'legacy usernames handle duplicate prefixes, short names and maximum length deterministically');
    check(count(array_filter($legacyUsers,fn($u)=>$u['password_hash']===$legacyHash))===4 && (int)$db->query('SELECT COUNT(*) FROM tokens')->fetchColumn()===1,'username migration preserves password hashes and active sessions');
    check(UsernameService::migrate($db)===0 && $legacyUsers===$db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC),'username migration can run repeatedly without changing assigned names');
    $legacyLogin=req('/auth/login',['identifier'=>' SAME ','password'=>'LegacyPassword42']);
    check($legacyLogin['user']['id']==='legacy_1' && $legacyLogin['user']['username']==='same','migrated username authenticates case-insensitively with existing password');
    check(req('/bootstrap',[],$legacyToken,'GET')['users'][0]['username']==='same','existing session remains usable after username migration');
    $insert->execute(['legacy_late','Late legacy signup','same@late.example',$legacyHash]);
    check(UsernameService::migrate($db)===1 && $db->query("SELECT username FROM users WHERE id='legacy_late'")->fetchColumn()==='same.3','second migration pass backfills accounts created by an old API during release');
    resetTestDatabase(false);
    $status=req('/auth/registration-status',[],'','GET'); check($status===['first_admin_required'=>true,'setup_enabled'=>true],'empty installation reports owner-key setup availability');
    check(count($db->query('SHOW TABLES')->fetchAll())===0,'public registration status never initializes schema');
    $disabled=registrationWorkers([['action'=>'status','setup_env'=>'']])[0]; check($disabled['data']['setup_enabled']===false,'first admin setup disabled without owner key');
    $short=registrationWorkers([['action'=>'status','setup_env'=>'too-short']])[0]; check($short['data']['setup_enabled']===false,'short owner key never enables setup');
    $owner=['name'=>'Owner','email'=>'owner@test.local','password'=>' Owner Password 42 ','password_confirmation'=>' Owner Password 42 ','setup_token'=>$setupKey];
    req('/auth/register',array_replace($owner,['setup_token'=>'wrong-key']),'','POST',403); check(count($db->query('SHOW TABLES')->fetchAll())===0,'invalid owner key cannot create tables or first admin');
    $result=req('/auth/register',$owner); check($result['status']==='active' && !isset($result['token']) && (int)$db->query("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1")->fetchColumn()===1,'owner key initializes schema and exactly one active admin without automatic login');
    $ownerLogin=req('/auth/login',['email'=>$owner['email'],'password'=>$owner['password']]); $ownerToken=$ownerLogin['token']; check($ownerLogin['user']['registration_status']==='approved','registration and login preserve leading and trailing password spaces');
    check($ownerLogin['user']['username']==='owner' && req('/auth/login',['identifier'=>' OWNER ','password'=>$owner['password']])['user']['id']===$ownerLogin['user']['id'],'first admin without an explicit username gets a usable generated username');
    $status=req('/auth/registration-status',[],'','GET'); check($status===['first_admin_required'=>false,'setup_enabled'=>false],'first admin setup permanently closes once a user exists');
    req('/auth/register',array_replace($owner,['email'=>'second-owner@test.local']),'','POST',409); check((int)$db->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn()===1,'stale setup request cannot create a second admin');
    $applicant=['name'=>'Calon Karyawan','email'=>'applicant@test.local','password'=>'KataSandiPanjang42','password_confirmation'=>'KataSandiPanjang42'];
    req('/auth/register',$applicant+['role'=>'admin','active'=>true],'','POST',422); check(true,'public registration rejects role and active injection');
    req('/auth/register',array_replace($applicant,['password_confirmation'=>'different']),'','POST',422); check(true,'registration requires matching password confirmation');
    req('/auth/register',array_replace($applicant,['password'=>str_repeat('x',73),'password_confirmation'=>str_repeat('x',73)]),'','POST',422); check(true,'registration rejects bcrypt-truncated passwords');
    req('/auth/register',array_replace($applicant,['password'=>'短い文字列六個','password_confirmation'=>'短い文字列六個']),'','POST',422); check(true,'password minimum counts Unicode characters, not bytes');
    $pending=req('/auth/register',$applicant+['username'=>' Calon.Satu ']); $state=req('/bootstrap',[],$ownerToken,'GET'); $pendingUser=first($state,'users',fn($u)=>$u['email']===$applicant['email']);
    check($pending['status']==='pending' && !$pendingUser['active'] && $pendingUser['role']==='employee' && $pendingUser['registration_status']==='pending','all subsequent signups become inactive employees awaiting approval');
    check($pendingUser['username']==='calon.satu','public registration normalizes a requested username');
    req('/auth/login',['identifier'=>'calon.satu','password'=>$applicant['password']],'','POST',403); check(true,'username login cannot bypass pending approval');
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
    $state=cmd('user.update',['id'=>$pendingUser['id'],'name'=>'Calon Diperbarui','email'=>' APPLICANT.EDITED@TEST.LOCAL ','photo'=>$profilePhoto,'target'=>2000000],$ownerToken);
    $pendingEdited=first($state,'users',fn($u)=>$u['id']===$pendingUser['id']);
    check($pendingEdited['email']==='applicant.edited@test.local' && $pendingEdited['photo']===$profilePhoto && !$pendingEdited['active'] && $pendingEdited['registration_status']==='pending' && $pendingEdited['role']==='employee','admin can edit pending employee identity without approving or activating account');
    req('/auth/login',['email'=>$pendingEdited['email'],'password'=>$applicant['password']],'','POST',403);
    cmd('user.update',['id'=>$pendingUser['id'],'email'=>$applicant['email']],$ownerToken);
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
    $db->prepare('UPDATE login_attempts SET started_at=DATE_SUB(NOW(),INTERVAL 16 MINUTE) WHERE attempt_key=?')->execute([hash('sha256','mixed-login|identifier:missing@test.local')]);
    $jobs=[]; for($i=0;$i<11;$i++) $jobs[]=['action'=>'login','payload'=>['email'=>'missing@test.local','password'=>'WrongPassword42'],'ip'=>'mixed-login'];
    $codes=array_column(registrationWorkers($jobs),'code'); check(count(array_filter($codes,fn($c)=>$c===401))===10 && count(array_filter($codes,fn($c)=>$c===429))===1,'expired login counter resets once atomically under concurrency');
    $db->prepare('UPDATE login_attempts SET started_at=DATE_SUB(NOW(),INTERVAL 16 MINUTE) WHERE attempt_key=?')->execute([hash('sha256','registration-email|'.$applicant['email'])]);
    $jobs=[]; for($i=0;$i<6;$i++) $jobs[]=['payload'=>$applicant,'ip'=>'expired-register-'.$i];
    $codes=array_column(registrationWorkers($jobs),'code'); sort($codes); check($codes===[409,409,409,409,409,429],'expired signup counter resets once atomically under concurrency');
    resetTestDatabase();
    $stmt=$db->prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES('admin_test','Admin Test','admin@test.local',?,'admin')"); $stmt->execute([password_hash('SecureTestPassword42',PASSWORD_DEFAULT)]);
    UsernameService::migrate($db);
    req('/bootstrap',[],'','GET',401); check(true,'unauthenticated access rejected');
    req('/health',[],'','GET',403,'https://untrusted.example'); check(true,'CORS rejects unapproved origins');
    req('/auth/login',['email'=>'admin@test.local','password'=>'wrong'], '', 'POST',401);
    $admin=req('/auth/login',['email'=>'admin@test.local','password'=>'SecureTestPassword42']); $a=$admin['token']; check(strlen($a)===64,'secure login token');
    check($db->query('SELECT token_hash FROM tokens')->fetchColumn()!==$a,'only token hash stored');
    $days=(int)$db->query('SELECT TIMESTAMPDIFF(HOUR,NOW(),expires_at) FROM tokens')->fetchColumn(); check($days>=719 && $days<=720,'new login persists for thirty days');
    $expiryToken=req('/auth/login',['email'=>'admin@test.local','password'=>'SecureTestPassword42'])['token']; $expiryHash=hash('sha256',$expiryToken);
    $expiry=$db->prepare('UPDATE tokens SET created_at=DATE_SUB(NOW(),INTERVAL ? DAY),expires_at=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE token_hash=?');
    $expiry->execute([20,$expiryHash]); req('/bootstrap',[],$expiryToken,'GET');
    $expiryHours=$db->prepare('SELECT TIMESTAMPDIFF(HOUR,NOW(),expires_at) FROM tokens WHERE token_hash=?'); $expiryHours->execute([$expiryHash]); check((int)$expiryHours->fetchColumn()>=719,'authenticated activity extends the idle window to thirty days');
    $expiresAt=$db->prepare('SELECT expires_at FROM tokens WHERE token_hash=?'); $expiresAt->execute([$expiryHash]); $firstExpiry=$expiresAt->fetchColumn();
    req('/sync/prices?since=0',[],$expiryToken,'GET'); $expiresAt->execute([$expiryHash]); check($firstExpiry===$expiresAt->fetchColumn(),'five-second price polling does not repeatedly rewrite a recently renewed session');
    $expiry->execute([89,$expiryHash]); req('/bootstrap',[],$expiryToken,'GET'); $expiryHours->execute([$expiryHash]); $hours=(int)$expiryHours->fetchColumn(); check($hours>=23 && $hours<=24,'sliding expiry never exceeds ninety days from login');
    $expiry->execute([91,$expiryHash]); req('/bootstrap',[],$expiryToken,'GET',401); check(true,'absolute session cap rejects even a future expires_at');
    $db->prepare('UPDATE tokens SET created_at=NOW(),expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=?')->execute([$expiryHash]); req('/bootstrap',[],$expiryToken,'GET',401); check(true,'expired idle session cannot be renewed');
    req('/health',[],'','POST',405); check(true,'HTTP method validation');
    $s=cmd('user.create',['name'=>'Sari','email'=>'sari@test.local','password'=>'PasswordSari42','role'=>'employee','target'=>5000000],$a);
    $sari=first($s,'users',fn($u)=>$u['email']==='sari@test.local');
    cmd('user.create',['name'=>'Budi','email'=>'budi@test.local','password'=>'PasswordBudi42','role'=>'employee','target'=>1000000],$a);
    $e=req('/auth/login',['email'=>'sari@test.local','password'=>'PasswordSari42'])['token']; $other=req('/auth/login',['email'=>'budi@test.local','password'=>'PasswordBudi42'])['token'];
    check(req('/auth/login',['identifier'=>' SARI ','password'=>'PasswordSari42','response_mode'=>'compact'])['user']['id']===$sari['id'],'username login works with compact responses and old email login remains supported');
    foreach(['éclair','用户','👩','not valid','_sari'] as $invalid) req('/auth/login',['identifier'=>$invalid,'password'=>'PasswordSari42'],'','POST',401);
    check(true,'malformed or Unicode username logins fail generically without SQL collation errors');
    $jobs=[]; for($i=0;$i<11;$i++) $jobs[]=['action'=>'login','payload'=>['identifier'=>$i%2?'SARI':'sari@test.local','password'=>'WrongPassword42'],'ip'=>'alias-throttle'];
    $codes=array_column(registrationWorkers($jobs),'code'); sort($codes);
    check(count(array_filter($codes,fn($c)=>$c===401))===10 && count(array_filter($codes,fn($c)=>$c===429))===1,'switching username and email cannot bypass the shared account login limit');
    $s=cmd('profile.update',['name'=>'Sari','username'=>' Sari.Baru '],$e);
    check($s['users'][0]['username']==='sari.baru' && req('/auth/login',['identifier'=>'sari.baru','password'=>'PasswordSari42'])['user']['id']===$sari['id'],'employee can change own username and immediately log in with it');
    req('/auth/login',['identifier'=>'sari','password'=>'PasswordSari42'],'','POST',401);
    foreach(['',null,'ab','@sari','nama karyawan','éclair',str_repeat('x',33),' BUDI '] as $invalid) cmd('profile.update',['name'=>'Must not persist','username'=>$invalid],$e,422);
    check(req('/bootstrap',[],$e,'GET')['users'][0]['name']==='Sari','invalid or duplicate usernames roll back profile changes and preserve the session');
    $s=cmd('user.update',['id'=>$sari['id'],'username'=>'pegawai.sari'],$a);
    check(first($s,'users',fn($u)=>$u['id']===$sari['id'])['username']==='pegawai.sari' && req('/auth/login',['identifier'=>'pegawai.sari','password'=>'PasswordSari42'])['user']['id']===$sari['id'],'admin can edit employee username without changing the password');
    cmd('user.update',['id'=>$sari['id'],'username'=>'budi'],$a,422);
    cmd('user.update',['id'=>'admin_test','username'=>'other.admin'],$a);
    cmd('user.update',['id'=>'admin_test','username'=>'admin'],$a);
    cmd('user.update',['id'=>$sari['id'],'username'=>'not.allowed'],$other,403);
    cmd('user.update',['id'=>$sari['id'],'username'=>'sari'],$a);
    $s=cmd('profile.update',['name'=>'Admin Test','username'=>'admin.master'],$a);
    check(first($s,'users',fn($u)=>$u['id']==='admin_test')['username']==='admin.master','admin can set own username through the profile');
    cmd('profile.update',['name'=>'Admin Test','username'=>'admin'],$a);
    $s=cmd('profile.update',['name'=>'Sari Profil','photo'=>$profilePhoto],$e); $profile=first($s,'users',fn($u)=>$u['id']===$sari['id']);
    check($profile['name']==='Sari Profil' && $profile['photo']===$profilePhoto && $profile['role']==='employee','employee can update own name and photo without changing role');
    $s=cmd('profile.update',['name'=>'Sari'],$e); check($s['users'][0]['photo']===$profilePhoto,'name-only profile update retains photo');
    $s=cmd('profile.update',['name'=>'Admin Test','photo'=>$profilePhoto],$a); check(first($s,'users',fn($u)=>$u['id']==='admin_test')['photo']===$profilePhoto,'admin can update own profile');
    foreach(['id','role','active','email','password','target','registration_status'] as $field) cmd('profile.update',['name'=>'Sari',$field=>'admin'],$e,422); check(true,'profile rejects all identity and privilege changes');
    foreach(['',str_repeat('a',121)] as $name) cmd('profile.update',['name'=>$name],$e,422); check(true,'profile name is required and bounded');
    foreach(['data:image/png;base64,aGVsbG8=',str_replace('image/png','image/jpeg',$profilePhoto),'https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zz4='] as $photo) cmd('profile.update',['name'=>'Sari','photo'=>$photo],$e,422); check(true,'new photos validate actual image format and prohibit external URLs');
    $png=base64_decode(explode(',',$profilePhoto,2)[1]);
    $atLimit='data:image/png;base64,'.base64_encode(str_pad($png,1048576,"\0"));
    $s=cmd('profile.update',['name'=>'Sari','photo'=>$atLimit],$e); check($s['users'][0]['photo']===$atLimit,'photo accepts exactly one MiB decoded without truncation');
    $imageBytes=base64_decode(explode(',',$atLimit,2)[1]);
    $upload=['action'=>'profile.update','payload'=>['photo'=>'','name'=>'Sari'],'request_id'=>'photo-'.bin2hex(random_bytes(10)),'response_mode'=>'compact'];
    [$compactPhoto,$uploadSize]=multipartCommand($upload,$e,$imageBytes);
    $jsonUpload=$upload; $jsonUpload['payload']['photo']=$atLimit;
    $legacySize=strlen(json_encode($jsonUpload,JSON_UNESCAPED_SLASHES));
    $photoSnapshot=businessSnapshot(); req('/commands',$jsonUpload,$e);
    check($photoSnapshot===businessSnapshot() && $compactPhoto['users'][0]['photo_ref']['version']===hash('sha256',$atLimit)
        && mediaReq('/media/profile/'.$sari['id'],$e)['body']===$imageBytes,'multipart and JSON replay share one fingerprint and retain every image byte');
    check($uploadSize<$legacySize*.76,'binary wire format removes base64 overhead from a 1 MiB photo');
    echo "MEASURE photo request $uploadSize bytes multipart vs $legacySize bytes JSON\n";
    $changed=$jsonUpload; $changed['payload']['photo']=$profilePhoto; req('/commands',$changed,$e,'POST',409);
    $upload['request_id']='bad-photo-'.bin2hex(random_bytes(8));
    multipartCommand($upload,$e,$imageBytes.'x','image/png',413);
    multipartCommand($upload,$e,$imageBytes,'image/webp',422);
    multipartCommand($upload,$e,'not a photo','image/jpeg',422);
    multipartCommand($upload,$e,'','image/png',422);
    unset($upload['payload']['photo']); multipartCommand($upload,$e,$imageBytes,'image/png',400);
    check(businessSnapshot()===$photoSnapshot,'invalid multipart uploads and changed retries cannot overwrite a saved photo');
    cmd('profile.update',['name'=>'Sari','photo'=>'data:image/png;base64,'.base64_encode(str_pad($png,1048577,"\0"))],$e,422); check(true,'photo rejects one byte above one MiB');
    $legacyPhoto='data:image/png;base64,'.base64_encode(str_pad($png,1048577,"\0"));
    $db->prepare("UPDATE records SET data=? WHERE kind='user_profile' AND user_id=?")->execute([json_encode(['photo'=>$legacyPhoto]),$sari['id']]);
    $s=req('/bootstrap',[],$e,'GET'); check($s['users'][0]['photo']===$legacyPhoto,'legacy oversized photos remain readable');
    $s=cmd('profile.update',['name'=>'Sari'],$e); check($s['users'][0]['photo']===$legacyPhoto,'name-only change preserves a legacy photo without revalidation');
    $s=cmd('profile.update',['name'=>'Sari','photo'=>''],$e); check($s['users'][0]['photo']==='','profile photo can be removed');
    $s=req('/bootstrap',[],$other,'GET'); check(count($s['users'])===1 && $s['users'][0]['name']==='Budi' && $s['users'][0]['photo']==='','profile update does not change or expose another employee');
    $passwordBefore=$db->query('SELECT password_hash FROM users WHERE id='.$db->quote($sari['id']))->fetchColumn();
    $s=cmd('user.update',['id'=>$sari['id'],'name'=>'Sari Edited','email'=>' SARI.EDITED@TEST.LOCAL ','photo'=>$profilePhoto,'target'=>6000000],$a);
    $edited=first($s,'users',fn($u)=>$u['id']===$sari['id']);
    check($edited['name']==='Sari Edited' && $edited['email']==='sari.edited@test.local' && $edited['photo']===$profilePhoto && $edited['target']==6000000 && $edited['active'] && $edited['registration_status']==='approved','admin employee editing persists name normalized email photo and target without privilege changes');
    $audit=first($s,'activity',fn($r)=>$r['action']==='user.update' && $r['after']['id']===$sari['id']);
    check(!isset($audit['before']['photo']) && !isset($audit['after']['photo']) && $audit['after']['photo_changed']===true && !str_contains(json_encode($audit),'data:image/'),'employee edits audit safe identity metadata and photo change without embedding images');
    $self=req('/bootstrap?compact=1',[],$e,'GET')['users'][0];
    check($self['email']===$edited['email'] && $self['photo']==='' && $self['photo_ref']['version']===hash('sha256',$profilePhoto) && mediaReq('/media/profile/'.$sari['id'],$e)['body']===$png,'existing employee session and private media reflect admin edits after reload');
    req('/auth/login',['email'=>'sari@test.local','password'=>'PasswordSari42'],'','POST',401);
    $loginEdited=req('/auth/login',['email'=>' SARI.EDITED@TEST.LOCAL ','password'=>'PasswordSari42']);
    check($loginEdited['user']['id']===$sari['id'] && $db->query('SELECT password_hash FROM users WHERE id='.$db->quote($sari['id']))->fetchColumn()===$passwordBefore,'changed email becomes login identity while original password remains unchanged');
    $snapshot=businessSnapshot();
    foreach([' BUDI@TEST.LOCAL ',' ADMIN@TEST.LOCAL ','','  ','invalid-address',str_repeat('a',191).'@test.local',null] as $email) cmd('user.update',['id'=>$sari['id'],'name'=>'Must not persist','email'=>$email,'photo'=>''],$a,422);
    foreach(['password','registration_status','unexpected'] as $field) cmd('user.update',['id'=>$sari['id'],$field=>'admin'],$a,422);
    cmd('user.update',['id'=>$sari['id'],'role'=>'superadmin'],$a,422);
    foreach(['name','target','active','photo'] as $field) cmd('user.update',['id'=>$sari['id'],$field=>null],$a,422);
    foreach(['data:image/png;base64,aGVsbG8=',str_replace('image/png','image/jpeg',$profilePhoto),'https://example.com/photo.png',$legacyPhoto] as $photo) cmd('user.update',['id'=>$sari['id'],'name'=>'Must not persist','photo'=>$photo],$a,422);
    cmd('user.update',['id'=>'missing_employee','email'=>'absent@test.local'],$a,404);
    cmd('user.update',['id'=>$sari['id'],'email'=>'forbidden@test.local'],$e,403);
    check(businessSnapshot()===$snapshot,'invalid employee edits, duplicate emails, missing accounts, privilege injection and wrong actors leave all business data unchanged');
    $s=cmd('user.update',['id'=>$sari['id'],'email'=>'SARI.EDITED@TEST.LOCAL','target'=>6100000],$a);
    check(first($s,'users',fn($u)=>$u['id']===$sari['id'])['photo']===$profilePhoto,'same normalized email is accepted and omitted employee photo is retained');
    $db->prepare("UPDATE records SET data=? WHERE kind='user_profile' AND user_id=?")->execute([json_encode(['photo'=>$legacyPhoto]),$sari['id']]);
    $s=cmd('user.update',['id'=>$sari['id'],'name'=>'Sari'],$a); check(first($s,'users',fn($u)=>$u['id']===$sari['id'])['photo']===$legacyPhoto,'admin name-only edit preserves oversized legacy profile without resubmitting image');
    $s=cmd('user.update',['id'=>$sari['id'],'email'=>'sari@test.local','photo'=>'','target'=>5000000],$a);
    check(first($s,'users',fn($u)=>$u['id']===$sari['id'])['photo']==='' && !isset(first(req('/bootstrap?compact=1',[],$a,'GET'),'users',fn($u)=>$u['id']===$sari['id'])['photo_ref']),'explicit empty employee photo removes image and compact reference');
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
    $salePayload=['date'=>date('Y-m-d'),'customer'=>'Toko A','phone'=>'','photo'=>$profilePhoto,'items'=>[['pickup_id'=>$pickup,'category'=>'good','eggs'=>300,'kg'=>18,'trays'=>1]],'payment_method'=>'credit','paid'=>100000,'notes'=>''];
    $snapshot=businessSnapshot();
    foreach([''," \t\n ",str_repeat('a',191),null] as $customer) cmd('sale.create',array_replace($salePayload,['customer'=>$customer]),$e,422);
    $missingCustomer=$salePayload; unset($missingCustomer['customer']); cmd('sale.create',$missingCustomer,$e,422);
    foreach(['','  ','data:image/png;base64,aGVsbG8=',str_replace('image/png','image/jpeg',$profilePhoto),'https://example.com/photo.png',$legacyPhoto,null] as $photo) cmd('sale.create',array_replace($salePayload,['photo'=>$photo]),$e,422);
    $missingPhoto=$salePayload; unset($missingPhoto['photo']); req('/commands',['action'=>'sale.create','payload'=>$missingPhoto,'request_id'=>'invalid-sale-doc-'.bin2hex(random_bytes(10))],$e,'POST',422);
    check(businessSnapshot()===$snapshot,'missing blank invalid or oversized sale customer/documentation fails atomically without sale audit stock or request records');
    cmd('sale.create',array_replace($salePayload,['expected_price_id'=>'stale-price']),$e,409); check(true,'stale price displayed to client requires refresh before sale');
    cmd('sale.create',array_replace($salePayload,['items'=>[['pickup_id'=>$pickup,'category'=>'good','eggs'=>600,'kg'=>18,'trays'=>1]]]),$e,422); check(true,'sale cannot strand a weight-only pickup remainder');
    $s=cmd('sale.create',$salePayload,$e); $sale=$s['sales'][0]; check($sale['total']===504000 && $sale['balance']===404000,'server computes sale total and debt');
    check($sale['payments'][0]['kind']==='initial' && $sale['payments'][0]['amount']===100000 && !isset($sale['payments'][0]['method']), 'initial payment records amount and time without inventing a method for credit sales');
    cmd('sale.due',['id'=>$sale['id'],'due_date'=>date('Y-m-d',strtotime('+3 days'))],$other,403);
    cmd('sale.due',['id'=>$sale['id'],'due_date'=>'2037-02-30'],$e,422);
    cmd('sale.due',['id'=>$sale['id'],'due_date'=>'2000-01-01'],$e,422);
    $dueSale=cmd('sale.due',['id'=>$sale['id'],'due_date'=>date('Y-m-d',strtotime('+3 days'))],$e);
    check(first($dueSale,'sales',fn($r)=>$r['id']===$sale['id'])['due_date']===date('Y-m-d',strtotime('+3 days')),'owner can set a real future due date; another employee cannot update it');
    // Represent a historical transaction saved before customer/photo/payment breakdowns were available.
    $legacySale=array_replace($sale,['customer'=>'','photo'=>'']); unset($legacySale['payments'],$legacySale['due_date']); $db->prepare("UPDATE records SET data=? WHERE id=? AND kind='sale'")->execute([json_encode($legacySale),$sale['id']]);
    $legacyRead=first(req('/bootstrap',[],$e,'GET'),'sales',fn($r)=>$r['id']===$sale['id']);
    check($legacyRead['customer']==='' && $legacyRead['photo']==='' && $legacyRead['total']===504000,'historical sales without customer/photo remain readable');
    $snapshot=businessSnapshot();
    foreach([''," \t\n "] as $customer) {
        cmd('correction.apply',['entity'=>'sale','id'=>$sale['id'],'reason'=>'Nama pelanggan diperiksa','changes'=>['customer'=>$customer]],$a,422);
        cmd('correction.request',['entity'=>'sale','id'=>$sale['id'],'reason'=>'Nama pelanggan diperiksa','changes'=>['customer'=>$customer]],$e,422);
    }
    check(businessSnapshot()===$snapshot,'sale corrections cannot clear customer names or create blank-name requests');
    $s=cmd('correction.apply',['entity'=>'sale','id'=>$sale['id'],'reason'=>'Catatan penjualan lama diperbarui','changes'=>['notes'=>'Legacy sale note']],$a);
    $legacyChanged=first($s,'sales',fn($r)=>$r['id']===$sale['id']); check($legacyChanged['notes']==='Legacy sale note' && $legacyChanged['photo']==='' && $legacyChanged['customer']==='','unrelated corrections do not require retroactive documentation on legacy sales');
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
    $s=cmd('sale.payment',['id'=>$sale['id'],'amount'=>404000],$e); $paid=first($s,'sales',fn($r)=>$r['id']===$sale['id']); check($paid['payment_status']==='paid' && $paid['balance']===0 && $paid['photo']==='' && $paid['customer']==='','debt repayment settles legacy transaction without requiring new documentation');
    check(count($paid['payments'])===1 && $paid['payments'][0]['amount']===404000 && $paid['paid']-array_sum(array_column($paid['payments'],'amount'))===100000, 'legacy paid total is retained without fictitious historical payment entries');
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
    $feedInvoice=['date'=>date('Y-m-d'),'supplier'=>'Toko Cicilan','items'=>[['feed_id'=>$feed,'quantity'=>1,'unit_price'=>20000]],'paid'=>2000,'due_date'=>date('Y-m-d',strtotime('+7 days'))];
    $prior=businessSnapshot(); cmd('feed.purchase',array_replace($feedInvoice,['due_date'=>'2037-02-30']),$a,422); check(businessSnapshot()===$prior,'invalid purchase due date rolls back both purchase and stock');
    $ledgerState=cmd('feed.purchase',$feedInvoice,$a); $inv=first($ledgerState,'feed_purchases',fn($r)=>$r['supplier']==='Toko Cicilan');
    $qtyBefore=$ledgerState['feed_inventory'][$feed]; $payment=['id'=>$inv['id'],'amount'=>3000,'expected_paid'=>2000,'method'=>'transfer'];
    cmd('feed.payment',$payment,$e,403); cmd('feed.due',['id'=>$inv['id'],'due_date'=>date('Y-m-d')],$e,403); cmd('feed.payment',array_replace($payment,['amount'=>18001]),$a,422);
    $idempotent=['action'=>'feed.payment','payload'=>$payment,'request_id'=>'installment-'.bin2hex(random_bytes(10)),'response_mode'=>'compact'];
    req('/commands',$idempotent,$a); $again=req('/commands',$idempotent,$a); $inv=first($again,'feed_purchases',fn($r)=>$r['id']===$payment['id']);
    check($inv['paid']===5000 && $inv['balance']===15000 && count($inv['payments'])===2 && $inv['payments'][1]['method']==='transfer' && isset($inv['payments'][1]['recorded_at']) && $again['feed_inventory'][$feed]===$qtyBefore,'replaying supplier installment records it once with history, no stock change');
    cmd('feed.payment',$payment,$a,409); cmd('feed.payment',array_diff_key($payment,['expected_paid'=>1]),$a,422); check(true,'stale or missing supplier balance guard rejects a duplicate payment');
    $settled=cmd('feed.payment',array_replace($payment,['amount'=>15000,'expected_paid'=>5000]),$a);
    $inv=first($settled,'feed_purchases',fn($r)=>$r['id']===$payment['id']);
    check($inv['balance']===0 && array_sum(array_column($inv['payments'],'amount'))===20000 && $settled['feed_inventory'][$feed]===$qtyBefore,'supplier settlement closes exact balance without purchasing goods twice');
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
    // Only an admin can waive a positive price; either role can sell at the posted zero price.
    $freePickups=[]; $goodPickups=[]; $freeSales=[];
    foreach(['admin'=>[$a,'admin_test'],'employee'=>[$e,$sari['id']]] as $role=>[$actorToken,$actorId]) {
        $marker='Free fixture '.$role;
        cmd('production.create',array_replace($baseProd,['category'=>'cracked','eggs'=>100,'kg'=>6,'trays'=>0,'notes'=>$marker]),$actorToken);
        $s=cmd('pickup.create',array_replace($pick,['category'=>'cracked','eggs'=>100,'kg'=>6,'trays'=>0,'notes'=>$marker]),$actorToken);
        $own=first($s,'pickups',fn($p)=>$p['notes']===$marker && $p['user_id']===$actorId); $freePickups[$role]=$own['id'];
        cmd('production.create',array_replace($baseProd,['eggs'=>100,'kg'=>6,'trays'=>0,'notes'=>$marker]),$actorToken);
        $s=cmd('pickup.create',array_replace($pick,['eggs'=>100,'kg'=>6,'trays'=>0,'notes'=>$marker]),$actorToken);
        $ownGood=first($s,'pickups',fn($p)=>$p['notes']===$marker && $p['category']==='good' && $p['user_id']===$actorId); $goodPickups[$role]=$ownGood['id'];
        $gift=['date'=>date('Y-m-d'),'customer'=>'Pak Budi '.$role,'photo'=>$profilePhoto,'items'=>[['pickup_id'=>$own['id'],'category'=>'cracked','eggs'=>20,'kg'=>1.2,'trays'=>0,'is_free'=>true]],'payment_method'=>'credit','paid'=>0];
        $snapshot=businessSnapshot();
        cmd('sale.create',array_replace($gift,['customer'=>'  ']),$actorToken,422);
        cmd('sale.create',array_replace($gift,['photo'=>'']),$actorToken,422);
        $regular=array_replace($gift,['items'=>[['pickup_id'=>$ownGood['id'],'category'=>'good','eggs'=>5,'kg'=>0.3,'trays'=>0]]]);
        cmd('sale.create',array_replace($regular,['customer'=>'']),$actorToken,422); cmd('sale.create',array_replace($regular,['photo'=>'']),$actorToken,422);
        check(businessSnapshot()===$snapshot,$role.' requires customer and documentation for free and regular sales without partial writes');
        if($role==='employee') {
            cmd('sale.create',$gift,$e,422);
            check(businessSnapshot()===$snapshot,'an employee cannot waive a positive price on carried eggs or consume their pickup balance');
            cmd('price.create',['good_price'=>0,'cracked_price'=>0,'effective_at'=>'2026-02-01T00:00:00+07:00'],$a,422);
            cmd('price.create',['good_price'=>31000,'cracked_price'=>-1,'effective_at'=>'2026-02-01T00:00:00+07:00'],$a,422);
            cmd('price.create',['good_price'=>31000,'cracked_price'=>0,'effective_at'=>'2026-02-01T00:00:00+07:00'],$e,403);
            $s=cmd('price.create',['good_price'=>31000,'cracked_price'=>0,'effective_at'=>'2026-02-01T00:00:00+07:00'],$a);
            check(count(array_filter($s['prices'],fn($p)=>$p['cracked_price']===0))===1,'the admin can set the daily cracked price to zero');
        }
        cmd('sale.create',array_replace($gift,['paid'=>1]),$actorToken,422);
        cmd('sale.create',array_replace($gift,['items'=>[array_replace($gift['items'][0],['is_free'=>'true'])]]),$actorToken,422);
        cmd('sale.create',array_replace($gift,['items'=>[array_replace($gift['items'][0],['pickup_id'=>$ownGood['id'],'category'=>'good'])]]),$actorToken,422);
        $s=cmd('sale.create',$gift,$actorToken); $free=first($s,'sales',fn($sale)=>$sale['items'][0]['pickup_id']===$own['id']); $freeSales[$role]=$free;
        check($free['user_id']===$actorId && $free['customer']==='Pak Budi '.$role && $free['items'][0]['is_free']===true && $free['items'][0]['unit_price']===0 && $free['total']===0 && $free['paid']===0 && $free['balance']===0 && $free['payment_status']==='paid' && $free['payment_method']==='cash',$role.' records own harvest/pickup/free cracked eggs with named recipient and zero debt');
        check(count(array_filter($s['sales'],fn($sale)=>$sale['items'][0]['pickup_id']===$own['id']))===1,$role.' rejects missing recipient, overpayment, invalid free flag and free good eggs atomically');
    }
    $mixed=['date'=>date('Y-m-d'),'customer'=>'Penerima campuran','photo'=>$profilePhoto,'items'=>[['pickup_id'=>$goodPickups['employee'],'category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0],['pickup_id'=>$freePickups['employee'],'category'=>'cracked','eggs'=>10,'kg'=>0.6,'trays'=>0,'is_free'=>true]],'payment_method'=>'cash','paid'=>18600];
    $mixedRequest=['action'=>'sale.create','payload'=>$mixed,'request_id'=>'mixed-'.bin2hex(random_bytes(8)),'response_mode'=>'compact','receipt_for_role'=>'employee'];
    $mixedSale=req('/commands',$mixedRequest,$e)['sale'];
    check($mixedSale['total']===18600 && $mixedSale['balance']===0 && $mixedSale['items'][0]['unit_price']===31000 && !$mixedSale['items'][0]['is_free'] && $mixedSale['items'][1]['is_free'] && $mixedSale['items'][1]['total']===0,'mixed paid/free transaction charges only paid eggs and preserves both snapshots');
    cmd('sale.create',array_replace($mixed,['items'=>[['pickup_id'=>$freePickups['employee'],'category'=>'cracked','eggs'=>71,'kg'=>4.26,'trays'=>0,'is_free'=>true]],'paid'=>0]),$e,422); check(true,'free transactions consume the same pickup balance and cannot oversell');
    $dailyFree=['date'=>date('Y-m-d'),'customer'=>'Penerima harga gratis','photo'=>$profilePhoto,'items'=>[['pickup_id'=>$freePickups['employee'],'category'=>'cracked','eggs'=>10,'kg'=>0.6,'trays'=>0,'is_free'=>false]],'payment_method'=>'credit','paid'=>0];
    cmd('sale.create',array_replace($dailyFree,['customer'=>'']),$e,422);
    $s=cmd('sale.create',$dailyFree,$e); $dailySale=first($s,'sales',fn($sale)=>$sale['customer']==='Penerima harga gratis'); check($dailySale['items'][0]['is_free'] && $dailySale['total']===0 && $dailySale['balance']===0 && $dailySale['payment_status']==='paid','zero daily cracked price automatically creates free recipient-linked transaction');
    $free=$freeSales['employee'];
    cmd('correction.apply',['entity'=>'sale','id'=>$free['id'],'reason'=>'Penerima tidak boleh dihapus','changes'=>['customer'=>'']],$a,422);
    cmd('correction.apply',['entity'=>'sale','id'=>$free['id'],'reason'=>'Gratis tidak boleh diubah','changes'=>['items'=>[['id'=>$free['items'][0]['id'],'eggs'=>20,'kg'=>1.2,'trays'=>0,'is_free'=>false]]]],$a,422);
    $s=cmd('correction.apply',['entity'=>'sale','id'=>$free['id'],'reason'=>'Jumlah pemberian diperiksa','changes'=>['items'=>[['id'=>$free['items'][0]['id'],'eggs'=>25,'kg'=>1.5,'trays'=>0]]]],$a);
    $s=cmd('price.create',['good_price'=>32000,'cracked_price'=>22000,'effective_at'=>'2026-03-01T00:00:00+07:00'],$a); $unchanged=first($s,'sales',fn($sale)=>$sale['id']===$free['id']);
    check($unchanged['customer']!=='' && $unchanged['items'][0]['is_free'] && $unchanged['items'][0]['unit_price']===0 && $unchanged['total']===0 && $unchanged['balance']===0,'free snapshot and recipient are immutable through price and permitted quantity corrections');
    $beforeReplay=businessSnapshot();
    $replayedGift=req('/commands',$mixedRequest,$e)['sale'];
    check($mixedSale===$replayedGift && businessSnapshot()===$beforeReplay,'retrying an employee receipt with the legacy free flag preserves the original invoice after the daily price rises');
    // Lightweight sync, compact media, explicit harvest receipt, and exact sale confirmation.
    req('/sync/prices',[],'','GET',401); check(true,'lightweight price sync requires authentication');
    $s=req('/bootstrap',[],$a,'GET'); check($s['settings']===['harvest_auto_stock'=>true],'missing settings preserves automatic harvest stock default');
    $legacy=first($s,'productions',fn($r)=>$r['id']===$prod); unset($legacy['stocked_at'],$legacy['stocked_by']);
    $db->prepare('UPDATE records SET data=? WHERE id=?')->execute([json_encode($legacy),$prod]);
    cmd('production.receive',['id'=>$prod],$a,409); check(true,'legacy harvest without stocked marker cannot be received a second time');
    cmd('settings.update',['harvest_auto_stock'=>false],$e,403);
    cmd('settings.update',['harvest_auto_stock'=>'false'],$a,422);
    cmd('settings.update',['harvest_auto_stock'=>false,'incentive_rate'=>5],$a,422); check(true,'harvest stock setting is strictly boolean and admin-only');
    $s=cmd('settings.update',['harvest_auto_stock'=>false],$a); $stockBefore=$s['inventory']; $movementsBefore=count($s['stock_movements']);
    $pendingPayload=array_replace($baseProd,['eggs'=>50,'kg'=>3,'trays'=>0,'notes'=>'Pending harvest fixture','photo'=>$atLimit,'stocked_at'=>date('c')]);
    $s=cmd('production.create',$pendingPayload,$e); $pendingHarvest=first($s,'productions',fn($r)=>$r['notes']==='Pending harvest fixture');
    check($pendingHarvest['stocked_at']===null && $s['inventory']===$stockBefore,'disabled auto-stock records pending harvest without trusting client stocked marker');
    $s=cmd('correction.apply',['entity'=>'production','id'=>$pendingHarvest['id'],'reason'=>'Timbang ulang sebelum diterima','changes'=>['eggs'=>60,'kg'=>3.6]],$e);
    check($s['inventory']===$stockBefore && count(array_filter($s['stock_movements'],fn($m)=>$m['reference_id']===$pendingHarvest['id']))===0,'correction of pending harvest does not alter warehouse or ledger');
    cmd('production.receive',['id'=>$pendingHarvest['id']],$other,403);
    cmd('production.receive',['id'=>$pendingHarvest['id'],'kg'=>1],$e,422); check(true,'harvest receive enforces ownership and whole-batch semantics');
    $s=cmd('settings.update',['harvest_auto_stock'=>true],$a);
    check(first($s,'productions',fn($r)=>$r['id']===$pendingHarvest['id'])['stocked_at']===null && $s['inventory']===$stockBefore,'enabling automatic stock does not retroactively receive pending harvests');
    $receive=['action'=>'production.receive','payload'=>['id'=>$pendingHarvest['id']],'request_id'=>'receive-'.bin2hex(random_bytes(10)),'response_mode'=>'compact'];
    $received=req('/commands',$receive,$e); $again=req('/commands',$receive,$e);
    check($again['inventory']['good']['eggs']===$stockBefore['good']['eggs']+60 && $again['inventory']['good']['kg']==$stockBefore['good']['kg']+3.6 && count(array_filter($again['stock_movements'],fn($m)=>$m['reference_id']===$pendingHarvest['id']))===1,'receipt and idempotent replay increase corrected quantities exactly once');
    cmd('production.receive',['id'=>$pendingHarvest['id']],$a,409); check(true,'new request cannot receive an already-stocked harvest');
    $s=cmd('settings.update',['harvest_auto_stock'=>false],$a);
    $s=cmd('production.create',array_replace($baseProd,['eggs'=>10,'kg'=>0.6,'trays'=>0,'notes'=>'Concurrent receive fixture']),$e); $raceHarvest=first($s,'productions',fn($r)=>$r['notes']==='Concurrent receive fixture');
    $racePayload=['token'=>$e,'action'=>'production.receive','payload'=>['id'=>$raceHarvest['id']]]; $workers=[];
    for($i=0;$i<2;$i++){ $pipes=[]; $process=proc_open([PHP_BINARY,__DIR__.'/command-worker.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes); fwrite($pipes[0],json_encode($racePayload)); fclose($pipes[0]); $workers[]=[$process,$pipes]; }
    $results=[]; foreach($workers as [$process,$pipes]){ $results[]=trim(stream_get_contents($pipes[1])); $err=stream_get_contents($pipes[2]); fclose($pipes[1]);fclose($pipes[2]); if(proc_close($process)!==0) throw new RuntimeException($err); } sort($results);
    check($results===['200','409'],'concurrent whole-harvest receipt allows exactly one mutation');
    cmd('settings.update',['harvest_auto_stock'=>true],$a);
    $s=cmd('profile.update',['name'=>'Sari','photo'=>$atLimit],$e);
    $compactLogin=req('/auth/login',['email'=>'sari@test.local','password'=>'PasswordSari42','response_mode'=>'compact']);
    check($compactLogin['user']['photo']==='' && $compactLogin['user']['photo_ref']['version']===hash('sha256',$atLimit) && strlen(json_encode($compactLogin))<1000,'compact login sends only versioned profile metadata and a token');
    $full=req('/bootstrap',[],$a,'GET'); $compact=req('/bootstrap?compact=1',[],$a,'GET'); $compactTrue=req('/bootstrap?compact=true',[],$e,'GET');
    $compactHarvest=first($compact,'productions',fn($r)=>$r['id']===$pendingHarvest['id']); $profileRef=first($compactTrue,'users',fn($u)=>$u['id']===$sari['id'])['photo_ref'];
    check($compactHarvest['photo']==='' && $compactHarvest['photo_ref']===['kind'=>'production','id'=>$pendingHarvest['id'],'version'=>hash('sha256',$atLimit)] && $profileRef===['kind'=>'profile','id'=>$sari['id'],'version'=>hash('sha256',$atLimit)],'compact bootstrap returns versioned photo references instead of image bytes');
    $legacyBytes=strlen(json_encode($full)); $compactBytes=strlen(json_encode($compact));
    check(!str_contains(json_encode($compact),'data:image/') && $compactBytes<$legacyBytes/10,'compact bootstrap removes legacy audit photos and substantially reduces payload');
    echo 'MEASURE compact bootstrap '.$compactBytes.' bytes vs legacy '.$legacyBytes.' bytes ('.round(100*(1-$compactBytes/$legacyBytes),2)."% reduction)\n";
    $media=mediaReq('/media/production/'.$pendingHarvest['id'].'?v='.hash('sha256',$atLimit),$e);
    check($media['body']===base64_decode(explode(',',$atLimit,2)[1]) && $media['type']==='image/png' && str_contains(strtolower($media['headers']),'cache-control: private, no-store'),'authenticated media returns original image bytes with private no-store response');
    mediaReq('/media/production/'.$pendingHarvest['id'],$other,403); mediaReq('/media/profile/'.$sari['id'],$other,403); mediaReq('/media/profile/'.$sari['id'],$a); mediaReq('/media/production/'.$pendingHarvest['id'],'',401); mediaReq('/media/notification/'.$pendingHarvest['id'],$a,404); check(true,'media enforces session, kind allowlist, owner/admin access');
    $sync=req('/sync/prices',[],$e,'GET'); $syncKeys=array_keys($sync); sort($syncKeys);
    check($syncKeys===['notifications','prices','settings','user'] && !array_key_exists('photo',$sync['user']) && !array_key_exists('photo_ref',$sync['user']) && !str_contains(json_encode($sync),'data:image/') && strlen(json_encode($sync))<50000,'five-second sync only includes prices, own notifications, safe user, settings');
    echo 'MEASURE price sync '.strlen(json_encode($sync))." bytes\n";
    $cursor=$compactTrue['price_cursor'];
    $nothing=req('/sync/prices?since='.$cursor,[],$e,'GET');
    check($nothing['mode']==='delta' && $nothing['since']===$cursor && $nothing['cursor']===$cursor && !$nothing['more'] && $nothing['prices']===[] && $nothing['notifications']===[],'unchanged five-second poll sends no price or notification history');
    req('/sync/prices?since=oops',[],$e,'GET',400); req('/sync/prices?since=0',[],'','GET',401);
    $scheduled=['good_price'=>37000,'cracked_price'=>19000,'effective_at'=>date('c',strtotime('+15 days'))];
    cmd('price.create',$scheduled,$a); cmd('price.create',$scheduled,$a);
    $changed=req('/sync/prices?since='.$cursor,[],$e,'GET');
    check(count($changed['prices'])===2 && $changed['prices'][0]['id']!==$changed['prices'][1]['id'] && $changed['prices'][0]['effective_at']===$scheduled['effective_at'] && count($changed['notifications'])===2 && count(array_unique(array_column($changed['notifications'],'user_id')))===1 && $changed['notifications'][0]['user_id']===$sari['id'],'both same-value scheduled updates and only own alerts arrive incrementally');
    cmd('notification.read',['id'=>$changed['notifications'][0]['id']],$e);
    $reads=req('/sync/prices?since='.$changed['cursor'],[],$e,'GET');
    check($reads['read_notices']===[$changed['notifications'][0]['id']] && !$reads['prices'] && !$reads['notifications'],'another device can apply a read marker without re-fetching notification history');
    cmd('notification.read',['id'=>'all'],$other);
    check(req('/sync/prices?since='.$reads['cursor'],[],$e,'GET')['read_notices']===[],'other employees cannot leak notification-read markers into the stream');
    cmd('notification.read',['id'=>'all'],$e);
    $allRead=req('/sync/prices?since='.$reads['cursor'],[],$e,'GET');
    check($allRead['read_notices']===['all'] && !$allRead['prices'],'mark-all propagates as a single change');
    $fixture=$db->prepare("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'notification',?,NOW(),?)");
    for($n=0;$n<101;$n++) { $id='page_fixture_'.$n; $fixture->execute([$id,$sari['id'],json_encode(['id'=>$id,'user_id'=>$sari['id'],'message'=>'halaman','title'=>'Harga','created_at'=>date('c'),'read'=>false])]); }
    $page1=req('/sync/prices?since='.$allRead['cursor'],[],$e,'GET');
    $page2=req('/sync/prices?since='.$page1['cursor'],[],$e,'GET');
    check($page1['more'] && count($page1['notifications'])===100 && !$page2['more'] && count($page2['notifications'])===1 && $page2['notifications'][0]['id']==='page_fixture_100','change pages are bounded and resume after the last delivered event without gaps');
    $budiId=first($full,'users',fn($u)=>$u['email']==='budi@test.local')['id'];
    $broken=$db->prepare('INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,?,?,NOW(),?)');
    $broken->execute(['fixture_hidden_production','production',$budiId,'invalid JSON']); $broken->execute(['fixture_hidden_purchase','feed_purchase','admin_test','invalid JSON']); $broken->execute(['fixture_hidden_audit','activity','admin_test','invalid JSON']);
    req('/bootstrap?compact=1',[],$e,'GET'); check(true,'employee bootstrap filters foreign rows in SQL and skips restricted collections before parsing');
    $broken->execute(['fixture_own_history','production',$sari['id'],'invalid JSON']); req('/sync/prices',[],$e,'GET'); check(true,'price-only sync does not read transaction history');
    $db->exec("DELETE FROM records WHERE id IN ('fixture_hidden_production','fixture_hidden_purchase','fixture_hidden_audit','fixture_own_history')");
    $receiptPayload=['date'=>date('Y-m-d'),'customer'=>'Exact receipt fixture','items'=>[['pickup_id'=>$goodPickups['employee'],'category'=>'good','eggs'=>5,'kg'=>0.3,'trays'=>0]],'payment_method'=>'cash','paid'=>9600,'photo'=>$profilePhoto];
    $receiptRequest=['action'=>'sale.create','payload'=>$receiptPayload,'request_id'=>'receipt-'.bin2hex(random_bytes(10)),'response_mode'=>'compact'];
    $confirmed=req('/commands',$receiptRequest,$e); $confirmation=$confirmed['command_result'];
    $confirmedSale=first($confirmed,'sales',fn($sale)=>$sale['id']===$confirmation['record_id']);
    check($confirmation['action']==='sale.create' && $confirmation['request_id']===$receiptRequest['request_id'] && $confirmedSale['customer']==='Exact receipt fixture' && $confirmedSale['total']===9600 && $confirmedSale['photo']==='' && $confirmedSale['photo_ref']['kind']==='sale','first sale response contains exact committed sale ID and compact media ref');
    $fastRequest=array_replace($receiptRequest,['payload'=>array_replace($receiptPayload,['customer'=>'Later sale fixture']),'request_id'=>'receipt-fast-'.bin2hex(random_bytes(8)),'receipt_for_role'=>'employee']);
    $broken->execute(['fixture_unrelated_history','production',$sari['id'],'invalid JSON']);
    $started=microtime(true); $fast=req('/commands',$fastRequest,$e); $receiptMs=round((microtime(true)-$started)*1000);
    $replayFast=req('/commands',$fastRequest,$e); $pickupId=$receiptPayload['items'][0]['pickup_id'];
    check($fast['mode']==='sale_receipt' && !array_intersect(['productions','sales','activity'],array_keys($fast)) && $fast['sale']['id']===$fast['command_result']['record_id'] && $fast['command_result']['request_id']===$fastRequest['request_id'] && $fast['sale']['customer']==='Later sale fixture' && $fast['sale']['photo_ref']['kind']==='sale' && !str_contains(json_encode($fast),'data:image/'),'first save returns just the committed receipt and compact media without reading unrelated production history');
    check($replayFast===$fast && count($fast['pickups'])===1 && $fast['pickups'][0]['id']===$pickupId && $fast['pickups'][0]['user_id']===$sari['id'] && isset($fast['pickup_balances'][$pickupId]['kg']),'request replay returns the original invoice and carried balances without deducting again');
    $db->exec("DELETE FROM records WHERE id='fixture_unrelated_history'");
    $another=req('/bootstrap?compact=1',[],$e,'GET');
    $pickup=$fast['pickups'][0]; $expectedEggs=$pickup['eggs']-$pickup['returned_eggs']; $expectedKg=$pickup['kg']-$pickup['returned_kg'];
    foreach($another['sales'] as $sold) foreach($sold['items'] as $item) if($item['pickup_id']===$pickupId){ $expectedEggs-=$item['eggs']; $expectedKg-=$item['kg']; }
    check($fast['pickup_balances'][$pickupId]['eggs']===$expectedEggs && abs($fast['pickup_balances'][$pickupId]['kg']-$expectedKg)<0.00001 && strlen(json_encode($fast))<strlen(json_encode($another)),'bounded receipt includes authoritative employee balance and is smaller than full history');
    echo 'MEASURE first local receipt '.$receiptMs.' ms; '.strlen(json_encode($fast)).' bytes vs compact full '.strlen(json_encode($another))."; unchanged price poll ".strlen(json_encode($nothing))." bytes\n";
    $priorFast=req('/commands',array_replace($receiptRequest,['receipt_for_role'=>'employee']),$e);
    check($priorFast['command_result']===$confirmation && $priorFast['pickup_balances']===$fast['pickup_balances'],'replay of older sale after another sale returns the original receipt and current carried stock');
    $roleFallback=req('/commands',array_replace($receiptRequest,['receipt_for_role'=>'admin']),$e);
    check(isset($roleFallback['sales']) && $roleFallback['users'][0]['id']===$sari['id'] && count($roleFallback['users'])===1,'role change negotiates a full currently authorized snapshot rather than merging stale role data');
    $replayed=req('/commands',array_replace($receiptRequest,['response_mode'=>'full']),$e);
    check($replayed['command_result']===$confirmation && count($replayed['sales'])===count($another['sales']) && first($replayed,'sales',fn($sale)=>$sale['id']===$confirmation['record_id'])['photo']===$profilePhoto,'idempotent retry returns original sale confirmation even after another sale and response mode change');
    mediaReq('/media/sale/'.$confirmation['record_id'],$e); mediaReq('/media/sale/'.$confirmation['record_id'],$other,403); check(true,'sale receipt photos use the same owner-scoped media endpoint');
    // Both harvest lines are one idempotent transaction; legacy flat harvests remain supported.
    $batch=['date'=>date('Y-m-d'),'notes'=>'Mixed harvest fixture','photo'=>$profilePhoto,'items'=>[['category'=>'good','eggs'=>1240,'kg'=>70,'trays'=>8],['category'=>'cracked','eggs'=>35,'kg'=>2.1,'trays'=>0]]];
    $before=req('/bootstrap?compact=1',[],$a,'GET');
    $bad=$batch; $bad['items'][1]['kg']=0; cmd('production.create',$bad,$e,422);
    $bad=$batch; $bad['items'][1]['category']='good'; cmd('production.create',$bad,$e,422);
    $batchReq=['action'=>'production.create','payload'=>$batch,'request_id'=>'batch-'.bin2hex(random_bytes(8)),'response_mode'=>'compact'];
    $s=req('/commands',$batchReq,$e); $s=req('/commands',$batchReq,$e);
    $lines=array_values(array_filter($s['productions'],fn($p)=>$p['notes']==='Mixed harvest fixture'));
    check(count($lines)===2 && $lines[0]['harvest_id']===$lines[1]['harvest_id'] && $lines[0]['photo_ref']===$lines[1]['photo_ref'],'mixed harvest commits two linked categories once, with one shared photo');
    check($s['inventory']['good']['eggs']===$before['inventory']['good']['eggs']+1240 && $s['inventory']['cracked']['kg']==round($before['inventory']['cracked']['kg']+2.1,3),'invalid second line/duplicate category and repeated batch do not leave extra stock');
    $physical=[]; foreach(['good','cracked'] as $cat){
        $expected=['eggs'=>$s['inventory'][$cat]['eggs'],'kg'=>$s['inventory'][$cat]['kg']];
        $counted=$expected; if($cat==='good'){ $counted['eggs']-=2; $counted['kg']=round($counted['kg']-0.12,3); }
        $physical[]=['category'=>$cat,'expected'=>$expected,'physical'=>$counted];
    }
    $op=['items'=>$physical,'reason'=>'Pecah saat dipindah ke rak'];
    cmd('stock.reconcile',$op,$e,403);
    $bad=$op; $bad['items'][1]['physical']['kg']=0; cmd('stock.reconcile',$bad,$a,422);
    $bad=$op; $bad['items'][1]['expected']['kg']+=1; cmd('stock.reconcile',$bad,$a,409);
    $rc=['action'=>'stock.reconcile','payload'=>$op,'request_id'=>'count-'.bin2hex(random_bytes(8)),'response_mode'=>'compact'];
    req('/commands',$rc,$a); $counted=req('/commands',$rc,$a);
    $ledger=array_values(array_filter($counted['stock_movements'],fn($m)=>$m['kind']==='reconcile' && $m['notes']===$op['reason']));
    check(count($ledger)===2 && $ledger[0]['reference_id']===$ledger[1]['reference_id'] && $counted['inventory']['good']['eggs']===$physical[0]['physical']['eggs'] && $counted['inventory']['good']['kg']==$physical[0]['physical']['kg'],'opname is all-or-nothing, admin-only, and replay does not adjust stock twice');
    check($ledger[0]['physical']['eggs']-$ledger[0]['expected']['eggs']===$ledger[0]['eggs'] && $ledger[1]['physical']['eggs']-$ledger[1]['expected']['eggs']===$ledger[1]['eggs'] && $ledger[0]['method']==='count','warehouse count preserves physical and expected snapshots in each movement');
    cmd('stock.reconcile',$op,$a,409); check(true,'count rejects an outdated expected warehouse balance');
    $prior = $counted['inventory']['good'];
    check($prior['trays'] === $s['inventory']['good']['trays'], 'older counts without trays keep warehouse trays intact');
    $repacked = $prior;
    $repacked['trays'] += 3;
    $oneCategory = ['method' => 'add', 'items' => [['category' => 'good', 'expected' => $prior, 'physical' => $repacked]], 'reason' => 'Telur dikemas ulang di gudang'];
    $beforeRejected = businessSnapshot();
    cmd('stock.reconcile', $oneCategory, $e, 403);
    cmd('stock.reconcile', array_replace($oneCategory, ['reason' => ' ']), $a, 422);
    $bad = $oneCategory;
    unset($bad['items'][0]['expected']['trays']);
    cmd('stock.reconcile', $bad, $a, 422);
    $bad['items'][0]['expected'] = $prior;
    $bad['items'][0]['physical']['trays'] = -1;
    cmd('stock.reconcile', $bad, $a, 422);
    cmd('stock.reconcile', array_replace($oneCategory, ['method' => 'subtract']), $a, 422);
    $bad = $oneCategory;
    $bad['items'][0]['physical']['eggs'] -= 1;
    cmd('stock.reconcile', $bad, $a, 422);
    $bad['items'][0]['physical'] = $prior;
    cmd('stock.reconcile', $bad, $a, 422);
    check($beforeRejected === businessSnapshot(), 'unauthorized and invalid warehouse adjustments cannot change inventory or history');
    $adjusted = req('/commands', ['action'=>'stock.reconcile', 'payload'=>$oneCategory, 'response_mode'=>'compact'], $a);
    $movement = first($adjusted, 'stock_movements', fn($m) => $m['notes'] === $oneCategory['reason']);
    check($adjusted['inventory']['good'] === $repacked && $adjusted['inventory']['cracked'] === $counted['inventory']['cracked']
        && $adjusted['pickups'] === $counted['pickups'] && $adjusted['sales'] === $counted['sales'],
        'counting only warehouse trays changes just the selected category and keeps employee stock and invoices intact');
    check($movement['expected'] === $prior && $movement['physical'] === $repacked
        && $movement['method'] === 'add' && $movement['eggs'] === 0 && $movement['kg'] == 0 && $movement['trays'] === 3,
        'warehouse adjustment records the expected and counted quantities and signed tray difference');
    $stale = $oneCategory;
    array_unshift($stale['items'], ['category' => 'cracked', 'expected' => $adjusted['inventory']['cracked'], 'physical' => ['eggs'=>0, 'kg'=>0, 'trays'=>0]]);
    $beforeConflict = businessSnapshot();
    cmd('stock.reconcile', $stale, $a, 409);
    check($beforeConflict === businessSnapshot(), 'a stale tray balance rejects the whole count including the other category');
    $decrease = ['method' => 'subtract', 'items' => [['category' => 'good', 'expected' => $repacked, 'physical' => $prior]], 'reason' => 'Krat kosong sudah dikeluarkan'];
    $afterRemoval = cmd('stock.reconcile', $decrease, $a);
    $movement = first($afterRemoval, 'stock_movements', fn($m) => $m['notes'] === $decrease['reason']);
    check($afterRemoval['inventory']['good'] === $prior && $movement['method'] === 'subtract' && $movement['trays'] === -3,
        'outgoing adjustments preserve their method and signed delta in the ledger');
    // Earlier imports can contain a weight with no eggs. Repair the observed row without losing its audit trail.
    $db->exec("UPDATE stock SET eggs=0, kg=0.300, trays=2 WHERE stock_key='egg:cracked'");
    $observed = ['eggs'=>0, 'kg'=>0.3, 'trays'=>2];
    $corrected = ['eggs'=>5, 'kg'=>0.3, 'trays'=>0];
    $repair = ['items'=>[['category'=>'cracked', 'expected'=>$observed, 'physical'=>$corrected]], 'reason'=>'Hitung ulang saldo lama'];
    $fixed = cmd('stock.reconcile', $repair, $a);
    $movement = first($fixed, 'stock_movements', fn($m) => $m['notes'] === $repair['reason']);
    check($fixed['inventory']['cracked'] === $corrected && $movement['expected'] === $observed && $movement['physical'] === $corrected,
        'an admin can repair a legacy weight-only warehouse balance and preserve its original quantities');
    $maxStock = ['eggs'=>5, 'kg'=>999999999999.999, 'trays'=>0];
    $boundary = ['items'=>[['category'=>'cracked', 'expected'=>$corrected, 'physical'=>$maxStock]], 'reason'=>'Uji ketelitian desimal'];
    $tooLarge = $boundary;
    $tooLarge['items'][0]['physical']['kg'] = 1000000000000;
    cmd('stock.reconcile', $tooLarge, $a, 422);
    $atLimit = cmd('stock.reconcile', $boundary, $a);
    check($atLimit['inventory']['cracked'] === $maxStock, 'warehouse reconciliation preserves all three decimals up to the SQL column limit');
    $measured = ['eggs'=>5, 'kg'=>1091067335.08, 'trays'=>0];
    $boundary['items'][0] = ['category'=>'cracked', 'expected'=>$maxStock, 'physical'=>$measured];
    $reduced = cmd('stock.reconcile', $boundary, $a);
    check($reduced['inventory']['cracked'] === $measured, 'large decimal balances round-trip through HTTP, PDO, and the stock ledger');
    $warehouseStock=['good'=>['eggs'=>50,'kg'=>5,'trays'=>2],'cracked'=>['eggs'=>20,'kg'=>2,'trays'=>1]];
    $counts=[]; foreach($warehouseStock as $category=>$quantity) $counts[]=['category'=>$category,'expected'=>$reduced['inventory'][$category],'physical'=>$quantity];
    cmd('stock.reconcile',['items'=>$counts,'reason'=>'Hitung persediaan sebelum penjualan gudang'],$a);
    $beforeWarehouse=req('/bootstrap?compact=1',[],$e,'GET');
    $items=[
        ['category'=>'good','eggs'=>10,'kg'=>1,'trays'=>1],
        ['category'=>'cracked','eggs'=>2,'kg'=>0.2,'trays'=>0],
        ['category'=>'good','eggs'=>5,'kg'=>0.5,'trays'=>0,'pickup_id'=>''],
    ];
    $warehousePayload=array_replace($salePayload,['stock_source'=>'warehouse','customer'=>'Pembeli di gudang','photo'=>$profilePhoto,'items'=>$items,'paid'=>0]);
    $badSourceSnapshot=businessSnapshot();
    $giftItems=$items;
    $giftItems[1]['is_free']=true;
    cmd('sale.create',array_replace($warehousePayload,['items'=>$giftItems]),$e,422);
    check(businessSnapshot()===$badSourceSnapshot,'one employee gift override rejects the entire mixed warehouse sale without a stock movement');
    foreach([['stock_source'=>'external'],['stock_source'=>'pickup'],['items'=>[$items[0]+['pickup_id'=>$pickup]]],['customer'=>''],['photo'=>''],
        ['items'=>[$items[0],array_replace($items[1],['eggs'=>21])]],['items'=>[array_replace($items[0],['trays'=>3])]]] as $badFields) {
        cmd('sale.create',array_replace($warehousePayload,$badFields),$e,422);
    }
    check(businessSnapshot()===$badSourceSnapshot,'warehouse sales validate required customer, photo, source and stock atomically across categories');
    $envelope=['action'=>'sale.create','payload'=>$warehousePayload,'request_id'=>'warehouse-'.bin2hex(random_bytes(8)),'response_mode'=>'compact','receipt_for_role'=>'employee'];
    $form=$envelope; $form['payload']['photo']='';
    [$direct]=multipartCommand($form,$e,$png);
    $saved=$direct['sale']; $saleId=$saved['id']; $invoiceNumber=$saved['number'];
    $soldGood=first($direct,'stock_movements',fn($m)=>$m['category']==='good');
    check($direct['mode']==='sale_receipt' && $saved['stock_source']==='warehouse' && $saved['items'][1]['unit_price']===22000 && !$saved['items'][1]['is_free']
        && $saved['items'][0]['unit_price']>0 && $saved['total']==array_sum(array_column($saved['items'],'total'))
        && array_column($saved['items'],'pickup_id')===['','',''] && $direct['pickups']===[] && $direct['pickup_balances']===[]
        && $direct['inventory']==['good'=>['eggs'=>35,'kg'=>3.5,'trays'=>1],'cracked'=>['eggs'=>18,'kg'=>1.8,'trays'=>1]]
        && count($direct['stock_movements'])===2 && $soldGood['eggs']===-15 && $soldGood['kg']==-1.5 && $soldGood['trays']===-1
        && $soldGood['reference_id']===$saleId && $soldGood['kind']==='sale' && $soldGood['user_id']===$sari['id'],
        'one multipart warehouse sale returns a numbered receipt, aggregates repeated categories and uses the active cracked price for an employee sale');
    check($direct===req('/commands',$envelope,$e) && mediaReq('/media/sale/'.$saleId,$e)['body']===$png,
        'JSON replay of a binary sale immediately reopens the same receipt and retains its photo');
    $afterWarehouse=req('/bootstrap?compact=1',[],$e,'GET');
    check(count($afterWarehouse['sales'])===count($beforeWarehouse['sales'])+1 && $afterWarehouse['pickups']===$beforeWarehouse['pickups']
        && $afterWarehouse['inventory']===$direct['inventory'],'warehouse sales appear in employee history without creating or consuming personal pickups');
    $quantities=array_map(fn($item)=>array_intersect_key($item,array_flip(['id','eggs','kg','trays'])),$saved['items']);
    $quantities[0]['eggs']=6; $quantities[0]['kg']=0.6; $quantities[0]['trays']=0;
    $correction=['entity'=>'sale','id'=>$saleId,'reason'=>'Sesuaikan berat setelah timbang ulang','changes'=>['items'=>$quantities]];
    $correctedWarehouse=cmd('correction.apply',$correction,$a);
    $correctionMove=first($correctedWarehouse,'stock_movements',fn($m)=>$m['reference_id']===$saleId && $m['kind']==='correction');
    $replay=req('/commands',$envelope,$e);
    check($replay['sale']['number']===$invoiceNumber && $replay['sale']['items'][0]['unit_price']===$saved['items'][0]['unit_price']
        && $replay['inventory']['good']==['eggs'=>39,'kg'=>3.9,'trays'=>2] && $replay['inventory']===$correctedWarehouse['inventory']
        && $replay['stock_movements']===$direct['stock_movements'] && $correctionMove['eggs']===4 && $correctionMove['kg']==0.4 && $correctionMove['trays']===1,
        'a warehouse correction restores the signed difference and a retry shows the updated inventory and original sale movements');
    $beforeBadCorrection=businessSnapshot(); $correction['changes']['items'][0]['eggs']=100;
    cmd('correction.apply',$correction,$a,422);
    check($beforeBadCorrection===businessSnapshot(),'an overselling correction leaves inventory, invoice, and ledger untouched');
    $jobs=[];
    $raceItem=['category'=>'good','eggs'=>30,'kg'=>3,'trays'=>1];
    foreach([$a,$e] as $token) {
        $pipes=[]; $worker=proc_open([PHP_BINARY,__DIR__.'/command-worker.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        fwrite($pipes[0],json_encode(['token'=>$token,'action'=>'sale.create','payload'=>array_replace($warehousePayload,['items'=>[$raceItem]])])); fclose($pipes[0]); $jobs[]=[$worker,$pipes];
    }
    $results=[];
    foreach($jobs as [$worker,$pipes]) {
        $results[]=trim(stream_get_contents($pipes[1])); $err=stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]); if(proc_close($worker)!==0) throw new RuntimeException($err);
    }
    sort($results); $afterRace=req('/bootstrap?compact=1',[],$a,'GET');
    check($results===['200','422'] && $afterRace['inventory']['good']==['eggs'=>9,'kg'=>0.9,'trays'=>1]
        && count($afterRace['sales'])===count($correctedWarehouse['sales'])+1
        && count($afterRace['stock_movements'])===count($correctedWarehouse['stock_movements'])+1,
        'simultaneous warehouse sales by admin and employee commit exactly one invoice and one stock deduction');
    $target=['good'=>['eggs'=>27,'kg'=>0.9,'trays'=>0],'cracked'=>['eggs'=>7,'kg'=>0.5,'trays'=>0]];
    $counts=[];
    foreach($target as $category=>$quantity) $counts[]=['category'=>$category,'expected'=>$afterRace['inventory'][$category],'physical'=>$quantity];
    cmd('stock.reconcile',['items'=>$counts,'reason'=>'Hitung sebelum uji penjualan berdasarkan berat'],$a);
    $weighed=array_replace($warehousePayload,['items'=>[
        ['category'=>'good','kg'=>0.2],
        ['category'=>'cracked','kg'=>0.25,'eggs'=>null],
        ['category'=>'good','kg'=>0.2,'eggs'=>9,'eggs_estimated'=>true],
        ['category'=>'good','kg'=>0.5,'eggs'=>' '],
    ]]);
    $weightRequest=['action'=>'sale.create','payload'=>$weighed,'request_id'=>'weighed-'.bin2hex(random_bytes(8)),'response_mode'=>'compact','receipt_for_role'=>'employee'];
    $receipt=req('/commands',$weightRequest,$e);
    $weightSale=$receipt['sale'];
    check(array_column($weightSale['items'],'eggs')===[5,4,9,13]
        && array_map(fn($line)=>$line['eggs_estimated']??false,$weightSale['items'])===[true,true,false,true]
        && $receipt['inventory']==['good'=>['eggs'=>0,'kg'=>0,'trays'=>0],'cracked'=>['eggs'=>3,'kg'=>0.25,'trays'=>0]]
        && $weightSale['total']===34300,'mixed warehouse items reserve explicit counts, estimate per category and exhaust the last weight exactly');
    check($receipt===req('/commands',$weightRequest,$e),'a retried weight-only sale returns the original counts without estimating against reduced stock');
    $beforeInvalid=businessSnapshot();
    $smallLine=['category'=>'cracked','kg'=>0.001];
    foreach([[$smallLine,$smallLine,$smallLine],[['category'=>'cracked','kg'=>0.251]],[$smallLine+['eggs'=>0]],[$smallLine+['eggs'=>1.5]],[$smallLine+['eggs'=>false]],[$smallLine+['eggs'=>'x']]] as $invalidLines)
        cmd('sale.create',array_replace($weighed,['items'=>$invalidLines]),$e,422);
    check(businessSnapshot()===$beforeInvalid,'impossible allocations, weight oversells and invalid explicit counts leave all stock and receipts intact');
    $quantities=array_map(fn($item)=>array_intersect_key($item,array_flip(['id','eggs','kg','trays'])),$weightSale['items']);
    $quantities[1]['kg']=0.24;
    $fix=['entity'=>'sale','id'=>$weightSale['id'],'reason'=>'Sesuaikan hasil timbang','changes'=>['items'=>$quantities]];
    $corrected=cmd('correction.apply',$fix,$a);
    $weightSale=first($corrected,'sales',fn($sale)=>$sale['id']===$fix['id']);
    check($weightSale['items'][1]['eggs_estimated']===true,'a correction of weight alone preserves the estimated-count marker');
    $fix['changes']['items'][1]=array_replace($quantities[1],['eggs'=>3,'kg'=>0.25]);
    $corrected=cmd('correction.apply',$fix,$a);
    $weightSale=first($corrected,'sales',fn($sale)=>$sale['id']===$fix['id']);
    check(!isset($weightSale['items'][1]['eggs_estimated']) && $corrected['inventory']['cracked']['eggs']===4,'a manually corrected count replaces the estimate and adjusts stock');
    $s=cmd('pickup.create',array_replace($pick,['category'=>'cracked','eggs'=>4,'kg'=>0.25,'trays'=>0,'area'=>'Timbang di pasar']),$a);
    $weighedPickup=first($s,'pickups',fn($p)=>$p['area']==='Timbang di pasar');
    $partial=['pickup_id'=>$weighedPickup['id'],'category'=>'cracked','kg'=>0.249];
    $cashSale=array_replace($weighed,['stock_source'=>'pickup','customer'=>'Pembeli timbangan','items'=>[$partial]]);
    $s=cmd('sale.create',$cashSale,$a);
    $pickupSale=first($s,'sales',fn($sale)=>$sale['customer']===$cashSale['customer']);
    check($pickupSale['items'][0]['eggs']===3 && $pickupSale['items'][0]['eggs_estimated']===true,'a partial weight-only pickup sale leaves an egg for the remaining weight');
    $cashSale['items'][0]['kg']=0.001;
    $cashSale['customer']='Pembeli telur terakhir';
    $s=cmd('sale.create',$cashSale,$a);
    $lastEgg=first($s,'sales',fn($sale)=>$sale['customer']===$cashSale['customer']);
    check($lastEgg['items'][0]['eggs']===1 && $lastEgg['items'][0]['eggs_estimated']===true,'selling the last gram of a pickup consumes its last egg');
    cmd('user.update',['id'=>$sari['id'],'active'=>false],$a); req('/bootstrap',[],$e,'GET',401); req('/sync/prices',[],$e,'GET',401); mediaReq('/media/production/'.$pendingHarvest['id'],$e,401); check(true,'deactivation immediately revokes bootstrap, five-second sync, and media access');
    req('/auth/login',['identifier'=>'sari','password'=>'PasswordSari42'],'','POST',401); check(true,'inactive employee cannot log in with username');
    req('/auth/logout',[],$other); req('/bootstrap',[],$other,'GET',401); check(true,'logout invalidates token');
    req('/application/config/config.php',[],'','GET',404); check(true,'internal files not exposed by dev router');
    require __DIR__.'/account-policy-checks.php';
    require __DIR__.'/stock-check-checks.php';
    echo "\n$checks integration checks passed.\n";
} catch(Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
