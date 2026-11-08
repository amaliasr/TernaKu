<?php
require_once __DIR__.'/NativePushTransport.php';
/** Private device subscriptions and the transactional notification outbox. */
class PushService {
    private PDO $db;
    private ?Closure $sender;
    private ?NativePushTransport $nativeSender=null;
    private array $config;
    public function __construct(PDO $db, ?callable $sender=null, ?array $config=null) {
        $this->db=$db; $this->sender=$sender ? Closure::fromCallable($sender) : null;
        $this->config=$config ?? self::configuration();
    }
    private static function configuration(): array {
        $file=__DIR__.'/../config/push-keys.php'; $saved=is_file($file)?require $file:[];
        if(!is_array($saved)) $saved=[];
        return ['publicKey'=>getenv('WEB_PUSH_PUBLIC_KEY') ?: ($saved['publicKey']??''),
            'privateKey'=>getenv('WEB_PUSH_PRIVATE_KEY') ?: ($saved['privateKey']??''),
            'subject'=>getenv('WEB_PUSH_SUBJECT') ?: ($saved['subject']??'https://ternaku.rstudiohub.com')];
    }
    private static function loadVendor(): bool {
        $file=dirname(__DIR__,2).'/vendor/autoload.php';
        if(is_file($file)) require_once $file;
        return class_exists('Minishlink\\WebPush\\WebPush');
    }
    private static function validConfig(array $config): bool {
        return self::loadVendor() && extension_loaded('curl') && extension_loaded('openssl') &&
            is_string($config['publicKey']??null) && strlen(self::decode($config['publicKey'])??'')===65 &&
            is_string($config['privateKey']??null) && strlen(self::decode($config['privateKey'])??'')===32 &&
            is_string($config['subject']??null) && (bool)preg_match('~^(https://|mailto:).+~D',$config['subject']);
    }
    public static function ready(): bool { return self::validConfig(self::configuration()); }
    public function status(): array {
        $ready=self::validConfig($this->config);
        return ['enabled'=>$ready,'public_key'=>$ready?$this->config['publicKey']:null,'native'=>NativePushTransport::status()];
    }
    private function query(string $sql,array $values=[]): PDOStatement { $s=$this->db->prepare($sql); $s->execute($values); return $s; }
    private static function json(array $data): string { return json_encode($data,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); }
    private static function decode(string $value): ?string {
        if(!preg_match('/^[A-Za-z0-9_-]+={0,2}$/D',$value)) return null;
        $raw=base64_decode(strtr($value,'-_','+/'),true); return $raw===false?null:$raw;
    }
    public static function endpoint(string $endpoint): string {
        if(strlen($endpoint)>2048 || preg_match('/[\x00-\x20\x7f\\\\]/',$endpoint)) throw new ApiProblem('Alamat layanan notifikasi tidak valid.');
        $url=parse_url($endpoint); $host=strtolower($url['host']??'');
        $allowed=in_array($host,['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'],true) ||
            preg_match('/^[a-z0-9-]+\.notify\.windows\.com$/D',$host);
        if(!$url || ($url['scheme']??'')!=='https' || !$allowed || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || (isset($url['port']) && $url['port']!==443) || empty($url['path']) || $url['path']==='/')
            throw new ApiProblem('Layanan notifikasi browser belum didukung. Gunakan Chrome, Firefox, Edge, atau Safari terbaru.');
        return $endpoint;
    }
    public static function subscription(array $input): array {
        if(array_diff(array_keys($input),['endpoint','keys','expirationTime']) || !is_string($input['endpoint']??null) || !is_array($input['keys']??null)) throw new ApiProblem('Data langganan notifikasi tidak valid.');
        $endpoint=self::endpoint($input['endpoint']); $keys=$input['keys'];
        if(array_diff(array_keys($keys),['p256dh','auth']) || !is_string($keys['p256dh']??null) || !is_string($keys['auth']??null)) throw new ApiProblem('Kunci notifikasi tidak valid.');
        $public=self::decode($keys['p256dh']); $auth=self::decode($keys['auth']);
        if($public===null || strlen($public)!==65 || $public[0]!=="\x04" || $auth===null || strlen($auth)!==16) throw new ApiProblem('Kunci notifikasi tidak valid.');
        // Validate the EC point with OpenSSL; all encryption is delegated to web-push-php.
        $der=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$public;
        if(@openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n")===false) throw new ApiProblem('Kunci browser tidak valid.');
        return ['endpoint'=>$endpoint,'keys'=>['p256dh'=>$keys['p256dh'],'auth'=>$keys['auth']],'contentEncoding'=>'aes128gcm'];
    }
    private function requireEnabled(): void { if(!self::validConfig($this->config)) throw new ApiProblem('Notifikasi HP belum diaktifkan oleh pengelola hosting.',503); }
    private function active(string $userId): bool {
        $active=$this->query('SELECT active FROM users WHERE id=? AND deleted_at IS NULL',[$userId])->fetchColumn();
        $registration=$this->query("SELECT data FROM records WHERE kind='registration' AND user_id=? LIMIT 1",[$userId])->fetchColumn();
        return (bool)$active && (!$registration || (json_decode($registration,true)['status']??'pending')==='approved');
    }
    private static function subscriptionId(string $endpoint): string { return 'ps_'.substr(hash('sha256',$endpoint),0,32); }
    private function transaction(callable $action) {
        $this->db->beginTransaction();
        try {
            $this->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE');
            $result=$action(); $this->db->commit(); return $result;
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    public function subscribe(string $userId,string $token,array $input): array {
        $this->requireEnabled(); $subscription=self::subscription($input); $id=self::subscriptionId($subscription['endpoint']);
        return $this->bind($userId,$token,$subscription,$id);
    }
    private static function nativeId(array $input): string {
        if(!in_array($input['platform']??null,['android','ios'],true) || !is_string($input['installation_id']??null) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iD',$input['installation_id']))
            throw new ApiProblem('Identitas pemasangan aplikasi tidak valid.');
        return 'pn_'.substr(hash('sha256',$input['platform'].'|'.strtolower($input['installation_id'])),0,32);
    }
    public function subscribeNative(string $userId,string $token,array $input): array {
        $id=self::nativeId($input);
        $ios=$input['platform']==='ios';
        $fields=$ios?['installation_id','platform','token','environment']:['installation_id','platform','token'];
        if(array_diff(array_keys($input),$fields) || !is_string($input['token']??null) ||
            !preg_match($ios?'/^(?:[a-f0-9]{2}){16,256}$/iD':'/^[a-zA-Z0-9.:_-]{20,4096}$/D',$input['token']) ||
            ($ios && !in_array($input['environment']??null,['sandbox','production'],true)))
            throw new ApiProblem('Token notifikasi perangkat tidak valid.');
        if(!NativePushTransport::ready($input['platform'])) throw new ApiProblem('Layanan notifikasi untuk perangkat ini belum diaktifkan oleh pengelola.',503);
        // Store only the opaque hash of the installation UUID in the record ID.
        $subscription=['platform'=>$input['platform'],'token'=>$ios?strtolower($input['token']):$input['token']];
        if($ios) $subscription['environment']=$input['environment'];
        return $this->bind($userId,$token,$subscription,$id);
    }
    private function bind(string $userId,string $token,array $subscription,string $id): array {
        return $this->transaction(function()use($userId,$token,$subscription,$id){
            if(!$this->active($userId)) throw new ApiProblem('Akun belum disetujui atau tidak aktif.',401);
            if(!$this->liveSession($userId,hash('sha256',$token))) throw new ApiProblem('Sesi berakhir. Silakan masuk kembali.',401);
            if(isset($subscription['platform'])) {
                // A reinstall/restore can change the installation ID while keeping a delivery token.
                $this->query("DELETE FROM records WHERE kind='push_subscription' AND id<>? AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.subscription.platform'))=? AND BINARY JSON_UNQUOTE(JSON_EXTRACT(data,'$.subscription.token'))=?",[$id,$subscription['platform'],$subscription['token']]);
            }
            $old=$this->query("SELECT data FROM records WHERE id=? AND kind='push_subscription'",[$id])->fetchColumn(); $old=$old?json_decode($old,true):null;
            if((!$old || $old['user_id']!==$userId) && (int)$this->query("SELECT COUNT(*) FROM records WHERE kind='push_subscription' AND user_id=?",[$userId])->fetchColumn()>=20) throw new ApiProblem('Batas perangkat notifikasi tercapai. Nonaktifkan perangkat lama dahulu.',429);
            // A native token may rotate within the same installation/session.
            // Keep its queued prices, but always invalidate them on an account switch.
            $same=$old && $old['user_id']===$userId && hash_equals($old['session_hash'],hash('sha256',$token)) &&
                (isset($subscription['platform']) || $old['subscription']===$subscription);
            $record=['id'=>$id,'user_id'=>$userId,'subscription'=>$subscription,'session_hash'=>hash('sha256',$token),'binding_id'=>$same?$old['binding_id']:bin2hex(random_bytes(16)),'last_test_at'=>$same?($old['last_test_at']??0):0];
            $this->query("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'push_subscription',?,NOW(),?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),occurred_at=NOW(),data=VALUES(data)",[$id,$userId,self::json($record)]);
            return ['subscribed'=>true,'binding_id'=>$record['binding_id']];
        });
    }
    private function liveSession(string $userId,string $hash): bool {
        return (bool)$this->query('SELECT 1 FROM tokens WHERE user_id=? AND token_hash=? AND expires_at>NOW() AND created_at>DATE_SUB(NOW(),INTERVAL 90 DAY)',[$userId,$hash])->fetchColumn();
    }
    public function unsubscribeNative(string $userId,string $token,array $input): array {
        if(array_diff(array_keys($input),['platform','installation_id'])) throw new ApiProblem('Identitas perangkat tidak valid.');
        $id=self::nativeId($input);
        $this->transaction(fn()=>$this->query("DELETE FROM records WHERE id=? AND kind='push_subscription' AND user_id=? AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.session_hash'))=?",[$id,$userId,hash('sha256',$token)]));
        return ['subscribed'=>false];
    }
    public function unsubscribe(string $userId,array $input): array {
        if(array_keys($input)!==['endpoint'] || !is_string($input['endpoint'])) throw new ApiProblem('Alamat notifikasi wajib diisi.');
        $id=self::subscriptionId(self::endpoint($input['endpoint']));
        $this->transaction(fn()=>$this->query("DELETE FROM records WHERE id=? AND kind='push_subscription' AND user_id=?",[$id,$userId]));
        return ['subscribed'=>false];
    }
    public function logout(string $userId,string $token): void {
        $this->transaction(function()use($userId,$token){
            // Share the command mutex with subscribe so a request authenticated
            // just before logout cannot recreate a binding after revocation.
            $this->query('DELETE FROM tokens WHERE token_hash=? AND user_id=?',[hash('sha256',$token),$userId]);
            foreach($this->query("SELECT id,data FROM records WHERE kind='push_subscription' AND user_id=?",[$userId])->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $data=json_decode($row['data'],true);
                if(hash_equals($data['session_hash']??'',hash('sha256',$token))) $this->query('DELETE FROM records WHERE id=?',[$row['id']]);
            }
        });
    }
    /** Called within price.create's existing SQL transaction, never after its commit. */
    public function enqueuePrice(array $price): void {
        $bentes=(float)$price['cracked_price']===0.0?'Gratis':'Rp'.number_format($price['cracked_price'],0,',','.').'/kg';
        $payload=['type'=>'price.updated','id'=>$price['id'],'tag'=>'price-'.$price['id'],'title'=>'Harga telur diperbarui',
            'body'=>'Mulai '.date('d/m/Y H:i',strtotime($price['effective_at'])).' WIB: telur bagus Rp'.number_format($price['good_price'],0,',','.').'/kg; telur bentes '.$bentes.'.',
            'url'=>'/','effective_at'=>$price['effective_at'],'good_price'=>$price['good_price'],'cracked_price'=>$price['cracked_price']];
        $this->broadcast($payload,$this->activeRecipients());
    }
    public function activeRecipients(): array {
        return $this->query("SELECT u.id FROM users u WHERE u.active=1 AND u.deleted_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM records r WHERE r.user_id=u.id AND r.kind='registration'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.data,'$.status')),'pending')<>'approved'
        )")->fetchAll(PDO::FETCH_COLUMN);
    }
    /** Enqueue per device now; the sender performs network delivery after commit. */
    public function broadcast(array $payload,array $recipients): void {
        if(!$this->db->inTransaction()) throw new LogicException('Notifications must share the business transaction.');
        $activeUsers=array_fill_keys($recipients,true);
        foreach($this->query("SELECT data FROM records WHERE kind='push_subscription'")->fetchAll(PDO::FETCH_COLUMN) as $raw) {
            $sub=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
            if(isset($sub['subscription']['platform']) && !$this->liveSession($sub['user_id'],$sub['session_hash'])) {
                $this->query("DELETE FROM records WHERE id=? AND kind='push_subscription' AND data=?",[$sub['id'],$raw]);
                continue;
            }
            if(isset($activeUsers[$sub['user_id']])) $this->enqueue($sub,$payload['id'],$payload);
        }
    }
    private function enqueue(array $sub,string $eventId,array $payload): void {
        $id='pj_'.substr(hash('sha256',$eventId.'|'.$sub['id'].'|'.$sub['binding_id']),0,32);
        $job=['id'=>$id,'subscription_id'=>$sub['id'],'binding_id'=>$sub['binding_id'],'user_id'=>$sub['user_id'],'event_id'=>$eventId,
            'payload'=>$payload+['user_id'=>$sub['user_id'],'binding_id'=>$sub['binding_id']],'attempts'=>0,'expires_at'=>time()+604800];
        $this->query("INSERT IGNORE INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'push_job',?,NOW(),?)",[$id,$sub['user_id'],self::json($job)]);
    }
    public function test(string $userId,array $input): array {
        $this->requireEnabled(); if(array_keys($input)!==['endpoint'] || !is_string($input['endpoint'])) throw new ApiProblem('Pilih perangkat notifikasi.');
        return $this->testDevice($userId,self::subscriptionId(self::endpoint($input['endpoint'])));
    }
    public function testNative(string $userId,string $token,array $input): array {
        if(array_diff(array_keys($input),['platform','installation_id'])) throw new ApiProblem('Identitas perangkat tidak valid.');
        $id=self::nativeId($input);
        if(!NativePushTransport::ready($input['platform'])) throw new ApiProblem('Layanan notifikasi perangkat belum aktif.',503);
        return $this->testDevice($userId,$id,hash('sha256',$token));
    }
    private function testDevice(string $userId,string $id,?string $sessionHash=null): array {
        return $this->transaction(function()use($userId,$id,$sessionHash){
            if(!$this->active($userId)) throw new ApiProblem('Akun belum aktif.',401);
            $raw=$this->query("SELECT data FROM records WHERE id=? AND kind='push_subscription' AND user_id=?",[$id,$userId])->fetchColumn();
            if(!$raw) throw new ApiProblem('Aktifkan notifikasi pada perangkat ini dahulu.',404);
            $sub=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
            if($sessionHash!==null && !hash_equals($sub['session_hash'],$sessionHash)) throw new ApiProblem('Aktifkan notifikasi pada sesi ini dahulu.',404);
            if(time()-($sub['last_test_at']??0)<60) throw new ApiProblem('Tunggu satu menit sebelum mencoba notifikasi lagi.',429);
            $sub['last_test_at']=time(); $this->query('UPDATE records SET data=? WHERE id=?',[self::json($sub),$id]);
            $eventId='test_'.bin2hex(random_bytes(12));
            $this->enqueue($sub,$eventId,['type'=>'push.test','id'=>$eventId,'tag'=>$eventId,'title'=>'Notifikasi TernaKu aktif','body'=>'Perangkat ini siap menerima pembaruan harga telur.','url'=>'/']);
            return ['queued'=>true];
        });
    }
    private function deliver(array $sub,array $payload): array {
        if($this->sender) return ($this->sender)($sub,$payload);
        if(isset($sub['platform'])) return ($this->nativeSender ??= new NativePushTransport())->send($sub,$payload);
        if(!self::validConfig($this->config)) throw new RuntimeException('Web Push unavailable');
        $endpoint=self::endpoint($sub['endpoint']); $host=parse_url($endpoint,PHP_URL_HOST); $addresses=[];
        foreach(dns_get_record($host,DNS_A|DNS_AAAA) ?: [] as $record) {
            $ip=$record['ip']??$record['ipv6']??null;
            if($ip && filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) $addresses[]=$ip;
        }
        if(!$addresses) return ['success'=>false,'expired'=>false,'status'=>0];
        $ip=$addresses[0]; if(str_contains($ip,':')) $ip='['.$ip.']';
        $webPush=new Minishlink\WebPush\WebPush(['VAPID'=>$this->config],['TTL'=>604800,'urgency'=>'high'],4,[
            'allow_redirects'=>false,'connect_timeout'=>2,'timeout'=>4,'verify'=>true,'proxy'=>'',
            'curl'=>[CURLOPT_RESOLVE=>[$host.':443:'.$ip],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_REDIR_PROTOCOLS=>CURLPROTO_HTTPS],
        ]);
        $report=$webPush->sendOneNotification(Minishlink\WebPush\Subscription::create($sub),self::json($payload));
        return ['success'=>$report->isSuccess(),'expired'=>$report->isSubscriptionExpired(),'status'=>$report->getResponse()?->getStatusCode()??0];
    }
    /** Bounded delivery. A cron worker retries independently of any open browser. */
    public function drain(int $limit=20,float $seconds=8): array {
        $counts=['sent'=>0,'retry'=>0,'cancelled'=>0,'failed'=>0];
        $lock='ternaku-push-'.substr(hash('sha256',(string)$this->query('SELECT DATABASE()')->fetchColumn()),0,32);
        if((int)$this->query('SELECT GET_LOCK(?,0)',[$lock])->fetchColumn()!==1) return $counts;
        $deadline=microtime(true)+max(1,min(50,$seconds));
        try {
            $rows=$this->query("SELECT id,data FROM records WHERE kind='push_job' AND occurred_at<=NOW() ORDER BY occurred_at,sequence LIMIT ".max(1,min(100,$limit)))->fetchAll(PDO::FETCH_ASSOC);
            foreach($rows as $row) {
                if(microtime(true)>=$deadline) break;
                $job=json_decode($row['data'],true,512,JSON_THROW_ON_ERROR);
                $raw=$this->query("SELECT data FROM records WHERE id=? AND kind='push_subscription' AND user_id=?",[$job['subscription_id'],$job['user_id']])->fetchColumn();
                $sub=$raw?json_decode($raw,true,512,JSON_THROW_ON_ERROR):null;
                $kind='push_cancelled';
                if($sub && $sub['binding_id']===$job['binding_id'] && $this->active($job['user_id']) && $job['expires_at']>time() &&
                    (!isset($sub['subscription']['platform']) || $this->liveSession($job['user_id'],$sub['session_hash']))) {
                    try { $report=$this->deliver($sub['subscription'],$job['payload']); }
                    catch(Throwable $e) { $report=['success'=>false,'expired'=>false,'status'=>0]; }
                    $job['attempts']++; $job['last_status']=(int)$report['status'];
                    if($report['success']) $kind='push_sent';
                    elseif($report['expired']) {
                        $this->query("DELETE FROM records WHERE id=? AND kind='push_subscription' AND data=?",[$sub['id'],self::json($sub)]); $kind='push_failed';
                    } else $kind='push_job';
                }
                if($kind==='push_job') {
                    $wait=min(3600,30*(2**min(7,$job['attempts']-1)));
                    $this->query("UPDATE records SET occurred_at=DATE_ADD(NOW(),INTERVAL $wait SECOND),data=? WHERE id=? AND kind='push_job'",[self::json($job),$row['id']]); $counts['retry']++;
                } else {
                    $job['completed_at']=date('c'); $this->query("UPDATE records SET kind=?,data=? WHERE id=? AND kind='push_job'",[$kind,self::json($job),$row['id']]);
                    $counts[$kind==='push_sent'?'sent':($kind==='push_failed'?'failed':'cancelled')]++;
                }
            }
            // Receipts are private and only needed for operational retry/dedup history.
            $this->query("DELETE FROM records WHERE kind IN ('push_sent','push_cancelled','push_failed') AND created_at<DATE_SUB(NOW(),INTERVAL 30 DAY)");
            return $counts;
        } finally { $this->query('SELECT RELEASE_LOCK(?)',[$lock]); }
    }
}
