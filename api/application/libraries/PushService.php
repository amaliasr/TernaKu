<?php
/** Private Web Push subscriptions and a transactional price-update outbox. */
class PushService {
    private PDO $db;
    private ?Closure $sender;
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
        return ['enabled'=>$ready,'public_key'=>$ready?$this->config['publicKey']:null];
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
        $active=$this->query('SELECT active FROM users WHERE id=?',[$userId])->fetchColumn();
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
        return $this->transaction(function()use($userId,$token,$subscription,$id){
            if(!$this->active($userId)) throw new ApiProblem('Akun belum disetujui atau tidak aktif.',401);
            if(!$this->query('SELECT user_id FROM tokens WHERE token_hash=? AND user_id=? AND expires_at>NOW()',[hash('sha256',$token),$userId])->fetchColumn()) throw new ApiProblem('Sesi berakhir. Silakan masuk kembali.',401);
            $old=$this->query("SELECT data FROM records WHERE id=? AND kind='push_subscription'",[$id])->fetchColumn(); $old=$old?json_decode($old,true):null;
            if(!$old && (int)$this->query("SELECT COUNT(*) FROM records WHERE kind='push_subscription' AND user_id=?",[$userId])->fetchColumn()>=20) throw new ApiProblem('Batas perangkat notifikasi tercapai. Nonaktifkan perangkat lama dahulu.',429);
            $same=$old && $old['user_id']===$userId && $old['subscription']===$subscription && hash_equals($old['session_hash'],hash('sha256',$token));
            $record=['id'=>$id,'user_id'=>$userId,'subscription'=>$subscription,'session_hash'=>hash('sha256',$token),'binding_id'=>$same?$old['binding_id']:bin2hex(random_bytes(16)),'last_test_at'=>$same?($old['last_test_at']??0):0];
            $this->query("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'push_subscription',?,NOW(),?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),occurred_at=NOW(),data=VALUES(data)",[$id,$userId,self::json($record)]);
            return ['subscribed'=>true,'binding_id'=>$record['binding_id']];
        });
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
        if(!$this->db->inTransaction()) throw new LogicException('Price notifications must share the price transaction.');
        $bentes=(float)$price['cracked_price']===0.0?'Gratis':'Rp'.number_format($price['cracked_price'],0,',','.').'/kg';
        $payload=['type'=>'price.updated','id'=>$price['id'],'tag'=>'price-'.$price['id'],'title'=>'Harga telur diperbarui',
            'body'=>'Mulai '.date('d/m/Y H:i',strtotime($price['effective_at'])).' WIB: telur bagus Rp'.number_format($price['good_price'],0,',','.').'/kg; telur bentes '.$bentes.'.',
            'url'=>'/','effective_at'=>$price['effective_at'],'good_price'=>$price['good_price'],'cracked_price'=>$price['cracked_price']];
        foreach($this->query("SELECT data FROM records WHERE kind='push_subscription'")->fetchAll(PDO::FETCH_COLUMN) as $raw) {
            $sub=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
            if($this->active($sub['user_id'])) $this->enqueue($sub,$price['id'],$payload);
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
        $id=self::subscriptionId(self::endpoint($input['endpoint']));
        return $this->transaction(function()use($userId,$id){
            if(!$this->active($userId)) throw new ApiProblem('Akun belum aktif.',401);
            $raw=$this->query("SELECT data FROM records WHERE id=? AND kind='push_subscription' AND user_id=?",[$id,$userId])->fetchColumn();
            if(!$raw) throw new ApiProblem('Aktifkan notifikasi pada perangkat ini dahulu.',404);
            $sub=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
            if(time()-($sub['last_test_at']??0)<60) throw new ApiProblem('Tunggu satu menit sebelum mencoba notifikasi lagi.',429);
            $sub['last_test_at']=time(); $this->query('UPDATE records SET data=? WHERE id=?',[self::json($sub),$id]);
            $eventId='test_'.bin2hex(random_bytes(12));
            $this->enqueue($sub,$eventId,['type'=>'push.test','id'=>$eventId,'tag'=>$eventId,'title'=>'Notifikasi TernaKu aktif','body'=>'Perangkat ini siap menerima pembaruan harga telur.','url'=>'/']);
            return ['queued'=>true];
        });
    }
    private function deliver(array $sub,array $payload): array {
        if($this->sender) return ($this->sender)($sub,$payload);
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
        if(!self::validConfig($this->config)) return $counts;
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
                if($sub && $sub['binding_id']===$job['binding_id'] && $this->active($job['user_id']) && $job['expires_at']>time()) {
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
