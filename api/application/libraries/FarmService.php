<?php
require_once __DIR__.'/PushService.php';
require_once __DIR__.'/UsernameService.php';
require_once __DIR__.'/AccountPolicyService.php';
require_once __DIR__.'/StockCheckSchema.php';
require_once __DIR__.'/StockCheckWorkflow.php';
require_once __DIR__.'/EggTypes.php';
require_once __DIR__.'/EggTypesSchema.php';
/** TernaKu transactional domain service; used by CI3 and the CLI installer. */
class ApiProblem extends RuntimeException {
    public int $status;
    public function __construct(string $message, int $status = 422) { parent::__construct($message); $this->status = $status; }
}
class FarmService {
    use StockCheckWorkflow;
    private PDO $db;
    private array $actor = [];
    private string $authTokenHash = '';
    private ?array $commandResult = null;
    private const COLLECTIONS = ['barn'=>'barns','production'=>'productions','pickup'=>'pickups','sale'=>'sales','price'=>'prices','feed'=>'feeds','feed_purchase'=>'feed_purchases','feed_usage'=>'feed_usages','notification'=>'notifications','activity'=>'activity','correction'=>'corrections','stock_movement'=>'stock_movements','stock_check'=>'stock_checks','stock_check_assignment'=>'stock_check_assignments'];
    public function __construct(?PDO $db = null) {
        $this->db = $db ?: new PDO('mysql:host='.(getenv('DB_HOST') ?: '127.0.0.1').';port='.(getenv('DB_PORT') ?: '3306').';dbname='.(getenv('DB_NAME') ?: 'ternaku').';charset=utf8mb4', getenv('DB_USER') ?: 'ternaku', getenv('DB_PASSWORD') ?: '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES=>false]);
        $this->db->exec("SET time_zone = '+07:00'");
    }
    public function database(): PDO { return $this->db; }
    private function query(string $sql, array $values = []): PDOStatement { $s = $this->db->prepare($sql); $s->execute($values); return $s; }
    private function now(): string { return (new DateTimeImmutable())->format('Y-m-d\TH:i:s.uP'); }
    private function id(string $prefix): string { return $prefix.'_'.bin2hex(random_bytes(12)); }
    private function json($value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
    private function registrationRecord(string $userId): ?array {
        $data=$this->query("SELECT data FROM records WHERE kind='registration' AND user_id=? LIMIT 1",[$userId])->fetchColumn();
        return $data?json_decode($data,true,512,JSON_THROW_ON_ERROR):null;
    }
    private function publicUser(array $u,bool $includePhoto = true,bool $compact = false): array {
        $user=['id'=>$u['id'],'name'=>$u['name'],'email'=>$u['email'],'username'=>$u['username']??null,'role'=>$u['role'],'active'=>(bool)$u['active'],'is_superadmin'=>(bool)($u['is_superadmin']??false),'deleted_at'=>$u['deleted_at']??null,'can_check_stock'=>(bool)($u['can_check_stock']??false),'target'=>(float)$u['target'],'registration_status'=>$this->registrationRecord($u['id'])['status']??'approved'];
        if(!$includePhoto) return $user;
        if($compact) {
            $version=$this->query("SELECT photo_version FROM records WHERE kind='user_profile' AND user_id=? LIMIT 1",[$u['id']])->fetchColumn();
            $user['photo']=''; if($version) $user['photo_ref']=['kind'=>'profile','id'=>$u['id'],'version'=>$version]; return $user;
        }
        $profile=$this->query("SELECT data FROM records WHERE kind='user_profile' AND user_id=? LIMIT 1",[$u['id']])->fetchColumn();
        $photo=$profile ? (json_decode($profile,true,512,JSON_THROW_ON_ERROR)['photo']??'') : '';
        return $user+['photo'=>$photo];
    }
    private function text(array $p, string $key, int $max = 2000, bool $required = false): string {
        $v = $p[$key] ?? '';
        if (!is_string($v)) throw new ApiProblem("Kolom $key harus berupa teks.");
        $v = trim($v);
        if (($required && $v === '') || mb_strlen($v) > $max) throw new ApiProblem("Kolom $key wajib diisi dan maksimal $max karakter.");
        return $v;
    }
    private function number(array $p, string $key, float $minimum = 0, bool $integer = false, float $maximum = 1000000000000): float {
        $v = $p[$key] ?? null;
        if (!is_numeric($v) || is_bool($v) || !is_finite((float)$v) || (float)$v < $minimum || (float)$v > $maximum || ($integer && floor((float)$v) != (float)$v) || (!$integer && abs((float)$v - round((float)$v, 3)) > 0.000000001)) throw new ApiProblem("Nilai $key tidak valid (berat maksimal 3 angka desimal).");
        return round((float)$v, $integer ? 0 : 3);
    }
    private function username(array $p,string $email,?string $exceptId=null): string {
        if(!array_key_exists('username',$p)) return UsernameService::generate($this->db,$email);
        try { $username=UsernameService::normalize($p['username']); }
        catch(InvalidArgumentException $e) { throw new ApiProblem($e->getMessage()); }
        if(!UsernameService::available($this->db,$username,$exceptId)) throw new ApiProblem('Username sudah digunakan. Pilih username lain.');
        return $username;
    }
    private function enum(array $p, string $key, array $choices): string { $v = $this->text($p,$key,50,true); if (!in_array($v,$choices,true)) throw new ApiProblem("Pilihan $key tidak valid."); return $v; }
    private function date(array $p, string $key = 'date'): string {
        $v = $this->text($p,$key,50,true);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/D',$v)) throw new ApiProblem("Format $key tidak valid.");
        try { $d = new DateTimeImmutable($v, new DateTimeZone('Asia/Jakarta')); } catch (Exception $e) { throw new ApiProblem("Tanggal $key tidak valid."); }
        if ($d->format('Y-m-d') !== substr($v,0,10)) throw new ApiProblem("Tanggal $key tidak valid.");
        if ($key === 'date' && $d->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('Y-m-d') > date('Y-m-d')) throw new ApiProblem('Tanggal transaksi tidak boleh di masa depan.');
        return strlen($v) === 10 ? $v : $d->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('c');
    }
    private function quantity(array $p, bool $allowMissingEggs = false): array {
        $eggs=$p['eggs']??null;
        $missing=$eggs===null || (is_string($eggs) && trim($eggs)==='');
        return [
            'eggs'=>$allowMissingEggs && $missing ? null : (int)$this->number($p,'eggs',1,true,100000000),
            'kg'=>$this->number($p,'kg',0.001,false,1000000),
            'trays'=>(int)$this->number($p+['trays'=>0],'trays',0,true,1000000)
        ];
    }
    private function photo(array $p): string {
        $photo = $this->text($p,'photo',1398130);
        if ($photo==='') return '';
        if (!preg_match('~^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$~D',$photo,$match)) throw new ApiProblem('Foto harus berupa gambar JPEG, PNG, atau WebP.');
        $bytes=base64_decode($match[2],true);
        if ($bytes===false || base64_encode($bytes)!==$match[2]) throw new ApiProblem('Data foto tidak valid.');
        if (strlen($bytes)>1048576) throw new ApiProblem('Foto maksimal 1 MB setelah dikompres.');
        $image=@getimagesizefromstring($bytes);
        if (!$image || ($image['mime']??'')!==$match[1]) throw new ApiProblem('Isi foto tidak sesuai dengan format JPEG, PNG, atau WebP.');
        return $photo;
    }
    private function admin(): void { if (($this->actor['role'] ?? '') !== 'admin') throw new ApiProblem('Akses ini hanya untuk admin.',403); }
    private function owned(array $r): void { if ($this->actor['role'] !== 'admin' && ($r['user_id'] ?? '') !== $this->actor['id']) throw new ApiProblem('Anda tidak dapat mengakses data karyawan lain.',403); }
    private function ownOnly(array $r): void { if (($r['user_id'] ?? '') !== $this->actor['id']) throw new ApiProblem('Penjualan harus berasal dari pengambilan Anda sendiri.',403); }
    private function insert(string $kind, array $r): array {
        $r['id'] = $r['id'] ?? $this->id($kind);
        $time = $r['created_at'] ?? $this->now();
        $this->query('INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,?,?,?,?)',[$r['id'],$kind,$r['user_id'] ?? null,date('Y-m-d H:i:s',strtotime($r['date'] ?? $r['effective_at'] ?? $time)),$this->json($r)]);
        return $r;
    }
    private function record(string $kind, string $id, bool $lock = false): array {
        $r = $this->query('SELECT data FROM records WHERE id=? AND kind=?'.($lock?' FOR UPDATE':''),[$id,$kind])->fetchColumn();
        if (!$r) throw new ApiProblem('Data tidak ditemukan.',404);
        return json_decode($r,true,512,JSON_THROW_ON_ERROR);
    }
    private function records(string $kind,?string $owner = null,bool $withoutPhotos = false,bool $mediaReferences = false,?string $onlyId = null,?string $recentOthersFor = null): array {
        $projection=$withoutPhotos?'compact_data':'data';
        $withMedia=$mediaReferences && in_array($kind,['production','sale'],true);
        if($withMedia) $projection.=', photo_version';
        $values=[$kind]; if($owner!==null) $values[]=$owner; if($onlyId!==null) $values[]=$onlyId;
        if($recentOthersFor!==null) array_push($values,$recentOthersFor,$this->stockCheckReadStart(),$this->stockCheckTomorrow());
        $rows=$this->query('SELECT '.$projection.' FROM records WHERE kind=?'.($owner!==null?' AND user_id=?':'').($onlyId!==null?' AND id=?':'').($recentOthersFor!==null?' AND (user_id=? OR (occurred_at>=? AND occurred_at<?))':'').' ORDER BY occurred_at DESC,sequence DESC',$values)->fetchAll(PDO::FETCH_NUM);
        return array_map(function($row) use($kind,$withMedia): array {
            $record=json_decode($row[0],true,512,JSON_THROW_ON_ERROR);
            if($withMedia) { $record['photo']=''; if($row[1]!==null) $record['photo_ref']=['kind'=>$kind,'id'=>$record['id'],'version'=>$row[1]]; }
            return $record;
        },$rows);
    }
    private function publicUsers(bool $admin,bool $compact): array {
        $owner=$admin?null:$this->actor['id']; $params=$owner===null?[]:[$owner];
        $users=$this->query('SELECT id,name,email,username,role,active,is_superadmin,deleted_at,can_check_stock,target FROM users'.($owner===null?'':' WHERE id=?').' ORDER BY name',$params)->fetchAll(PDO::FETCH_ASSOC);
        $registrations=[]; foreach($this->records('registration',$owner) as $r) $registrations[$r['user_id']]=$r['status'];
        $projection=$compact?'photo_version':"JSON_UNQUOTE(JSON_EXTRACT(data,'$.photo'))";
        $profiles=$this->query("SELECT user_id,$projection FROM records WHERE kind='user_profile'".($owner===null?'':' AND user_id=?'),$params)->fetchAll(PDO::FETCH_KEY_PAIR);
        return array_map(function($u) use($registrations,$profiles,$compact): array {
            $user=['id'=>$u['id'],'name'=>$u['name'],'email'=>$u['email'],'username'=>$u['username']??null,'role'=>$u['role'],'active'=>(bool)$u['active'],'is_superadmin'=>(bool)($u['is_superadmin']??false),'deleted_at'=>$u['deleted_at']??null,'can_check_stock'=>(bool)($u['can_check_stock']??false),'target'=>(float)$u['target'],'registration_status'=>$registrations[$u['id']]??'approved','photo'=>$compact?'':($profiles[$u['id']]??'')];
            if($compact && !empty($profiles[$u['id']])) $user['photo_ref']=['kind'=>'profile','id'=>$u['id'],'version'=>$profiles[$u['id']]];
            return $user;
        },$users);
    }
    private function settings(): array {
        $raw=$this->query("SELECT data FROM records WHERE kind='settings' AND id='settings_global'")->fetchColumn();
        $settings=$raw?json_decode($raw,true,512,JSON_THROW_ON_ERROR):[];
        return ['harvest_auto_stock'=>$settings['harvest_auto_stock']??true];
    }
    private function productionStocked(array $production): bool {
        // Before this setting existed every saved harvest was already added to stock.
        return !array_key_exists('stocked_at',$production) || $production['stocked_at']!==null;
    }
    private function save(string $kind, array $r): void { $this->query('UPDATE records SET data=? WHERE id=? AND kind=?',[$this->json($r),$r['id'],$kind]); }
    private function audit(string $action, string $description, $before = null, $after = null): void {
        $this->insert('activity',['user_id'=>$this->actor['id'],'actor_role'=>$this->actor['role'],'action'=>$action,'description'=>$description,'created_at'=>$this->now(),'before'=>$before,'after'=>$after]);
    }
    private function notifyFarmActivity(string $activity,float $kg): void {
        $name=preg_split('/\s+/u',trim($this->actor['name']),2)[0]??'';
        $name=preg_match("/^\p{L}[\p{L}\p{M}.'’\-]*$/uD",$name) ? mb_substr($name,0,32) : 'Petugas';
        $weight=rtrim(rtrim(number_format($kg,3,',','.'),'0'),',').' kg telur';
        [$title,$message]=match($activity) {
            'sale.create'=>['Penjualan telur',"$name menjual $weight."],
            'production.stocked'=>['Panen masuk gudang',"$name mencatat panen $weight yang langsung masuk gudang."],
            'production.create'=>['Panen tercatat',"$name mencatat panen $weight."],
            'production.receive'=>['Panen diterima di gudang',"$name menerima $weight dari panen."],
            'pickup.return'=>['Telur kembali ke gudang',"$name mengembalikan $weight ke gudang."],
            'stock.add'=>['Stok gudang bertambah',$kg>0 ? "$name menambahkan $weight ke gudang." : "$name menambah persediaan di gudang."],
        };
        $eventId=$this->id('event');
        $notice=['type'=>'farm.activity','event_id'=>$eventId,'activity'=>$activity,'title'=>$title,'message'=>$message,'read'=>false,'created_at'=>$this->now()];
        $push=new PushService($this->db);
        $recipients=$push->activeRecipients();
        foreach($recipients as $userId) $this->insert('notification',$notice+['user_id'=>$userId]);
        $push->broadcast(['type'=>'farm.activity','id'=>$eventId,'tag'=>'farm-'.$eventId,'activity'=>$activity,'title'=>$title,'body'=>$message,'url'=>'/'],$recipients);
    }
    private function movement(string $kind,array $record,array $q,string $notes='',?string $date=null): array {
        return $this->insert('stock_movement',['date'=>$date ?? $record['date'],'created_at'=>$this->now(),'user_id'=>$record['user_id'],'category'=>$record['category'],'kind'=>$kind,'reference_id'=>$record['id'],'eggs'=>$q['eggs'],'kg'=>$q['kg'],'trays'=>$q['trays'],'notes'=>$notes]);
    }
    private function stock(string $key, int $eggs, float $kg, int $trays = 0, bool $requireTrays = false): void {
        $r=$this->query('SELECT eggs,kg,trays FROM stock WHERE stock_key=? FOR UPDATE',[$key])->fetch(PDO::FETCH_ASSOC);
        if (!$r) throw new ApiProblem('Stok tidak ditemukan.',404);
        $newEggs=(int)$r['eggs']+$eggs; $newKg=round((float)$r['kg']+$kg,3); $newTrays=(int)$r['trays']+$trays;
        if ($newEggs<0 || $newKg<0) throw new ApiProblem('Stok tidak mencukupi. Periksa jumlah butir dan berat aktual.');
        if ($requireTrays && $newTrays<0) throw new ApiProblem('Jumlah krat melebihi stok di gudang.');
        if (strpos($key,'egg:')===0 && (($newEggs===0) !== ($newKg==0))) throw new ApiProblem('Sisa jumlah butir dan berat harus sama-sama habis atau sama-sama masih tersedia. Periksa berat aktual.');
        // Tray count is informational: employees may re-pack trays without changing egg stock.
        $this->query('UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key=?',[$newEggs,number_format($newKg,3,'.',''),max(0,$newTrays),$key]);
    }
    public function authenticate(string $token): array {
        if (!preg_match('/^[a-f0-9]{64}$/D',$token)) throw new ApiProblem('Silakan masuk terlebih dahulu.',401);
        $hash=hash('sha256',$token);
        $u=$this->query('SELECT u.*,t.expires_at<LEAST(DATE_ADD(NOW(),INTERVAL 29 DAY),DATE_ADD(t.created_at,INTERVAL 90 DAY)) AS refresh_session FROM users u JOIN tokens t ON t.user_id=u.id WHERE t.token_hash=? AND t.expires_at>NOW() AND t.created_at>DATE_SUB(NOW(),INTERVAL 90 DAY) AND u.active=1 AND u.deleted_at IS NULL',[$hash])->fetch(PDO::FETCH_ASSOC);
        if (!$u || ($this->registrationRecord($u['id'])['status']??'approved')!=='approved') throw new ApiProblem('Sesi berakhir atau akun belum disetujui/nonaktif. Silakan masuk kembali.',401);
        // Renew at most once daily, not on every five-second price poll.
        if($u['refresh_session']) $this->query('UPDATE tokens SET expires_at=LEAST(DATE_ADD(NOW(),INTERVAL 30 DAY),DATE_ADD(created_at,INTERVAL 90 DAY)) WHERE token_hash=? AND expires_at>NOW() AND created_at>DATE_SUB(NOW(),INTERVAL 90 DAY) AND expires_at<LEAST(DATE_ADD(NOW(),INTERVAL 29 DAY),DATE_ADD(created_at,INTERVAL 90 DAY))',[$hash]);
        $this->authTokenHash=$hash;
        return $this->actor=$this->publicUser($u,false);
    }
    private function setupToken(): string {
        $token=getenv('SETUP_TOKEN') ?: '';
        $file=__DIR__.'/../config/setup-token.php';
        if($token==='' && is_file($file)) { $value=require $file; if(is_string($value)) $token=$value; }
        // An empty/example/short key must never expose first-admin registration.
        return strlen($token)>=32 && strlen($token)<=512 && !preg_match('/replace|change.?me|example|isi.?token/i',$token)?$token:'';
    }
    private function usersCount(): int {
        try { return (int)$this->query('SELECT COUNT(*) FROM users')->fetchColumn(); }
        catch(PDOException $e) { if($e->getCode()==='42S02') return 0; throw $e; }
    }
    public function registrationStatus(): array {
        $first=$this->usersCount()===0;
        return ['first_admin_required'=>$first,'setup_enabled'=>$first && $this->setupToken()!==''];
    }
    private function verifySetupToken(array $p): void {
        $expected=$this->setupToken();
        if($expected==='') throw new ApiProblem('Pendaftaran admin pertama belum diaktifkan. Pemilik hosting perlu mengatur SETUP_TOKEN.',503);
        $given=$p['setup_token']??'';
        if(!is_string($given) || strlen($given)>512 || !hash_equals($expected,$given)) throw new ApiProblem('Kunci pemasangan tidak valid.',403);
    }
    private function ensureSchema(): void {
        // DDL is allowed only after owner-key verification. IF NOT EXISTS preserves all data.
        $lock='ternaku-install-'.substr(hash('sha256',(string)$this->query('SELECT DATABASE()')->fetchColumn()),0,32);
        if((int)$this->query('SELECT GET_LOCK(?,10)',[$lock])->fetchColumn()!==1) throw new ApiProblem('Pemasangan sedang berjalan. Coba kembali.',409);
        try {
            $sql=preg_replace('/^--.*$/m','',file_get_contents(dirname(__DIR__,2).'/schema.sql'));
            foreach(explode(';',$sql) as $statement) if(trim($statement)!=='') $this->db->exec($statement);
        } finally { $this->query('SELECT RELEASE_LOCK(?)',[$lock]); }
    }
    private function registrationAttempt(string $ip,string $email): void {
        $keys=[hash('sha256','registration-ip|'.$ip)=>10,hash('sha256','registration-email|'.$email)=>5];
        ksort($keys,SORT_STRING);
        $this->authTransaction(function() use($keys): void {
            foreach($keys as $key=>$limit) {
                $attempts=$this->lockedAttempts($key);
                if($attempts>=$limit) { $this->db->commit(); throw new ApiProblem('Terlalu banyak pendaftaran. Coba kembali dalam 15 menit.',429); }
                $this->query('UPDATE login_attempts SET attempts=attempts+1 WHERE attempt_key=?',[$key]);
            }
        });
    }
    private function lockedAttempts(string $key): int {
        // Upsert takes an exclusive row lock directly. Reset only this key's expired window;
        // a table-wide DELETE here creates next-key locks and deadlocks on MySQL 8.
        $this->query('INSERT INTO login_attempts(attempt_key,attempts,started_at) VALUES(?,0,NOW()) ON DUPLICATE KEY UPDATE attempts=IF(started_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE),0,attempts),started_at=IF(started_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE),NOW(),started_at)',[$key]);
        return (int)$this->query('SELECT attempts FROM login_attempts WHERE attempt_key=? FOR UPDATE',[$key])->fetchColumn();
    }
    private function authTransaction(callable $operation): mixed {
        for($attempt=0;$attempt<5;$attempt++) {
            $this->db->beginTransaction();
            try {
                $result=$operation();
                if($this->db->inTransaction()) $this->db->commit();
                return $result;
            } catch(Throwable $e) {
                if($this->db->inTransaction()) $this->db->rollBack();
                if(!$e instanceof PDOException || !in_array((int)($e->errorInfo[1]??0),[1213,1205],true)) throw $e;
                // Retry the entire rolled-back transaction, never a partial counter increment.
                if($attempt===4) throw new ApiProblem('Layanan sedang sibuk. Coba kembali sebentar lagi.',503);
                usleep(random_int(10000,30000)*($attempt+1));
            }
        }
        throw new ApiProblem('Layanan sedang sibuk. Coba kembali sebentar lagi.',503);
    }
    public function register(array $p,string $ip): array {
        if(array_diff(array_keys($p),['name','email','username','password','password_confirmation','setup_token'])) throw new ApiProblem('Kolom pendaftaran tidak didukung. Peran dan status ditentukan oleh sistem.');
        $name=$this->text($p,'name',120,true); $email=strtolower($this->text($p,'email',190,true));
        if(!filter_var($email,FILTER_VALIDATE_EMAIL)) throw new ApiProblem('Format email tidak valid.');
        $password=$p['password']??null;
        if(!is_string($password) || mb_strlen($password)<12 || strlen($password)>72 || str_contains($password,"\0")) throw new ApiProblem('Kata sandi minimal 12 karakter dan maksimal 72 byte, tanpa karakter null.');
        if(!is_string($p['password_confirmation']??null) || !hash_equals($password,$p['password_confirmation'])) throw new ApiProblem('Konfirmasi kata sandi tidak sama.');
        if($this->usersCount()===0) { $this->verifySetupToken($p); $this->ensureSchema(); }
        $this->registrationAttempt($ip,$email);
        // Hash before holding the farm-wide mutex so password work does not block stock updates.
        $hash=password_hash($password,PASSWORD_DEFAULT);
        $this->db->beginTransaction();
        try {
            $this->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
            $first=$this->usersCount()===0;
            if($first) $this->verifySetupToken($p);
            elseif(isset($p['setup_token']) && $p['setup_token']!=='') throw new ApiProblem('Admin pertama sudah dibuat. Muat ulang formulir untuk mendaftar sebagai karyawan.',409);
            if($this->query('SELECT id FROM users WHERE email=?',[$email])->fetchColumn()) throw new ApiProblem('Email sudah terdaftar. Silakan masuk atau hubungi admin.',409);
            $id=$this->id('user'); $role=$first?'admin':'employee'; $active=$first?1:0;
            $username=$this->username($p,$email);
            $this->query('INSERT INTO users(id,name,email,username,password_hash,role,active,target) VALUES(?,?,?,?,?,?,?,0)',[$id,$name,$email,$username,$hash,$role,$active]);
            $r=$this->insert('registration',['user_id'=>$id,'status'=>$first?'approved':'pending','created_at'=>$this->now(),'reviewed_at'=>$first?$this->now():null,'reviewed_by'=>$first?$id:null]);
            $this->actor=['id'=>$id,'name'=>$name,'email'=>$email,'username'=>$username,'role'=>$role,'active'=>(bool)$active,'target'=>0,'registration_status'=>$r['status']];
            $this->audit($first?'auth.setup':'auth.register',$first?'Membuat admin pertama':'Mendaftar sebagai karyawan; menunggu persetujuan admin',null,$this->actor);
            if($first) {
                if(!$this->query("SELECT id FROM records WHERE kind='barn' LIMIT 1")->fetchColumn()) $this->insert('barn',['name'=>'Kandang Ayam Utama','type'=>'ayam','capacity'=>0,'notes'=>'Sumber produksi awal; kelola sesuai kondisi peternakan.']);
            } else {
                foreach($this->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN) as $uid) $this->insert('notification',['user_id'=>$uid,'title'=>'Pendaftaran karyawan baru','message'=>$name.' ('.$email.') menunggu persetujuan. Buka menu Karyawan untuk meninjau.','created_at'=>$this->now(),'read'=>false]);
            }
            $this->db->commit();
            return ['status'=>$first?'active':'pending','username'=>$username,'message'=>$first?'Admin pertama berhasil dibuat. Silakan masuk.':'Pendaftaran berhasil. Akun Anda menunggu persetujuan admin.'];
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    public function login(array $p, string $ip,bool $compact = false): array {
        $field=array_key_exists('identifier',$p)?'identifier':(array_key_exists('username',$p)?'username':'email');
        $identifier=strtolower($this->text($p,$field,190,true)); $password=$p['password']??'';
        if(!is_string($password) || strlen($password)>200 || $password==='') throw new ApiProblem('Kata sandi wajib diisi.');
        // Email and username aliases share one account/IP attempt budget.
        $column=str_contains($identifier,'@')?'email':'username';
        $validIdentifier=$column==='email' || preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/D',$identifier);
        $userId=$validIdentifier?$this->query('SELECT id FROM users WHERE '.$column.'=?',[$identifier])->fetchColumn():false;
        $key=hash('sha256',$ip.'|'.($userId?'account:'.$userId:'identifier:'.$identifier));
        return $this->authTransaction(function() use($userId,$password,$key,$compact): array {
            $a=$this->lockedAttempts($key);
            if ((int)$a>=10) { $this->db->commit(); throw new ApiProblem('Terlalu banyak percobaan. Coba kembali dalam 15 menit.',429); }
            $this->query('UPDATE login_attempts SET attempts=attempts+1 WHERE attempt_key=?',[$key]);
            $u=$userId?$this->query('SELECT * FROM users WHERE id=?',[$userId])->fetch(PDO::FETCH_ASSOC):false;
            $valid=password_verify($password,$u['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
            if (!$u || !$valid) { $this->db->commit(); throw new ApiProblem('Username/email atau kata sandi salah, atau akun tidak aktif.',401); }
            $registration=$this->registrationRecord($u['id']);
            if (!$u['active'] || $u['deleted_at']!==null || ($registration['status']??'approved')!=='approved') {
                $this->db->commit();
                if(($registration['status']??'')==='pending') throw new ApiProblem('Akun Anda masih menunggu persetujuan admin.',403);
                if(($registration['status']??'')==='rejected') throw new ApiProblem('Pendaftaran belum disetujui. Hubungi admin peternakan.',403);
                throw new ApiProblem('Username/email atau kata sandi salah, atau akun tidak aktif.',401);
            }
            $this->query('DELETE FROM login_attempts WHERE attempt_key=?',[$key]);
            $this->query('DELETE FROM tokens WHERE expires_at<=NOW() OR created_at<=DATE_SUB(NOW(),INTERVAL 90 DAY)');
            $token=bin2hex(random_bytes(32));
            $this->query('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))',[hash('sha256',$token),$u['id']]);
            $this->actor=$this->publicUser($u,true,$compact); $this->audit('auth.login','Masuk ke aplikasi');
            $this->db->commit(); return ['token'=>$token,'user'=>$this->actor];
        });
    }
    public function logout(string $token): void {
        $this->db->beginTransaction();
        try { $this->query('DELETE FROM tokens WHERE token_hash=?',[hash('sha256',$token)]); $this->audit('auth.logout','Keluar dari aplikasi'); $this->db->commit(); }
        catch (Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    public function bootstrap(bool $compact = false): array {
        $this->db->beginTransaction();
        try { $state = $this->readState($compact); $this->db->commit(); return $state; }
        catch (Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    // All writers to these streams serialize on the same command mutex. The sequence
    // therefore covers simultaneous price changes (including identical/rerated prices)
    // without relying on client clocks, effective dates or second-resolution times.
    private const SYNC_SCOPE = "(kind='price' OR (user_id=? AND kind IN ('notification','notice_read')))";
    private function priceCursor(): string {
        return (string)$this->query('SELECT COALESCE(MAX(sequence),0) FROM records WHERE '.self::SYNC_SCOPE,[$this->actor['id']])->fetchColumn();
    }
    public function syncPrices(?string $since=null): array {
        $this->db->beginTransaction();
        try {
            $data=['user'=>$this->actor,'settings'=>$this->settings()];
            if($since===null) {
                $data+=['prices'=>$this->records('price'),'notifications'=>$this->records('notification',$this->actor['id'])];
            } else {
                $rows=$this->query('SELECT sequence,kind,data FROM records WHERE sequence>? AND '.self::SYNC_SCOPE.' ORDER BY sequence LIMIT 101',[(int)$since,$this->actor['id']])->fetchAll(PDO::FETCH_ASSOC);
                $data+=['mode'=>'delta','since'=>$since,'cursor'=>$since,'more'=>count($rows)>100,'prices'=>[],'notifications'=>[],'read_notices'=>[]];
                foreach(array_slice($rows,0,100) as $row) {
                    $r=json_decode($row['data'],true,512,JSON_THROW_ON_ERROR);
                    if($row['kind']==='notice_read') $data['read_notices'][]=$r['target'];
                    elseif($row['kind']==='price') $data['prices'][]=$r;
                    else $data['notifications'][]=$r;
                    $data['cursor']=(string)$row['sequence'];
                }
            }
            // Authentication provides a safe user without profile image bytes on this path.
            unset($data['user']['photo'],$data['user']['photo_ref']);
            $this->db->commit(); return $data;
        } catch(Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    public function media(string $kind,string $id): array {
        if(!in_array($kind,['production','sale','profile'],true) || !preg_match('/^[A-Za-z0-9_-]{1,40}$/D',$id)) throw new ApiProblem('Media tidak ditemukan.',404);
        if($kind==='profile') {
            if($this->actor['role']!=='admin' && $id!==$this->actor['id']) throw new ApiProblem('Foto profil bukan milik Anda.',403);
            $raw=$this->query("SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.photo')) FROM records WHERE kind='user_profile' AND user_id=? LIMIT 1",[$id])->fetchColumn();
        } else {
            // Authorize metadata before loading potentially large image bytes.
            $record=$this->query('SELECT user_id,occurred_at FROM records WHERE kind=? AND id=?',[$kind,$id])->fetch(PDO::FETCH_ASSOC);
            if(!$record) throw new ApiProblem('Media tidak ditemukan.',404);
            $recent=$this->canCheckStock() && $record['occurred_at']>=$this->stockCheckReadStart() && $record['occurred_at']<$this->stockCheckTomorrow();
            if(!$recent) $this->owned($record);
            $raw=$this->query("SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.photo')) FROM records WHERE kind=? AND id=?",[$kind,$id])->fetchColumn();
        }
        if(!is_string($raw) || !preg_match('~^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$~D',$raw,$match)) throw new ApiProblem('Media tidak ditemukan.',404);
        $bytes=base64_decode($match[2],true); $image=$bytes===false?false:@getimagesizefromstring($bytes);
        if(!$image || ($image['mime']??'')!==$match[1]) throw new ApiProblem('Media tidak valid.',404);
        return ['content_type'=>$match[1],'bytes'=>$bytes,'version'=>hash('sha256',$raw)];
    }
    private function readState(bool $compact = false): array {
        $admin=$this->actor['role']==='admin'; $checker=$this->canCheckStock(); $state=[];
        if($compact) $state['price_cursor']=$this->priceCursor();
        foreach (self::COLLECTIONS as $kind=>$collection) {
            // Skip restricted tables entirely, and scope ownership in SQL before reading JSON.
            if(!$admin && in_array($kind,['activity','feed_purchase'],true)) { $state[$collection]=[]; continue; }
            $shared=$checker && in_array($kind,['production','sale'],true);
            $own=$kind==='notification' || (!$admin && !$shared && in_array($kind,['production','pickup','sale','correction','stock_movement','feed_usage','stock_check','stock_check_assignment'],true));
            $state[$collection]=$this->records($kind,$own?$this->actor['id']:null,$compact,$compact,null,$shared?$this->actor['id']:null);
        }
        $state['settings']=$this->settings();
        $state['users']=$this->publicUsers($admin,$compact);
        if($checker) $state['users']=$this->stockCheckRecordUsers($state);
        $balances=$this->stockBalances();
        if($admin || $checker) $state['stock_check_context']=$this->stockCheckContext($this->stockCheckToday(),$balances['inventory']);
        return $state+$balances;
    }
    private function stockBalances(bool $eggsOnly=false): array {
        $balances=['inventory'=>EggTypes::emptyInventory(),'feed_inventory'=>[]];
        $sql='SELECT stock_key,eggs,kg,trays FROM stock'.($eggsOnly?" WHERE stock_key IN ('egg:good','egg:cracked','egg:skm','egg:skm_new')":'');
        foreach($this->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $stock) {
            $key=$stock['stock_key'];
            if(str_starts_with($key,'egg:')) $balances['inventory'][substr($key,4)]=['eggs'=>(int)$stock['eggs'],'kg'=>(float)$stock['kg'],'trays'=>(int)$stock['trays']];
            else $balances['feed_inventory'][substr($key,5)]=(float)$stock['kg'];
        }
        return $balances;
    }
    private function warehouseSaleMovements(array $sale,array $beforeItems,string $kind,string $notes,?string $date=null): array {
        // Reconcile old and new quantities per category; repeated lines can have different prices.
        $deltas=[]; $ids=[];
        foreach([1=>$beforeItems,-1=>$sale['items']] as $direction=>$items) {
            foreach($items as $item) {
                $category=$item['category'];
                $delta=$deltas[$category]??['eggs'=>0,'kg'=>0,'trays'=>0];
                foreach($delta as $field=>$value) $delta[$field]=$value+$direction*$item[$field];
                $delta['kg']=round($delta['kg'],3);
                $deltas[$category]=$delta;
            }
        }
        foreach($deltas as $category=>$q) {
            if(!$q['eggs'] && !$q['kg'] && !$q['trays']) continue;
            $this->stock('egg:'.$category,$q['eggs'],$q['kg'],$q['trays'],true);
            $movement=$this->movement($kind,$sale+['category'=>$category],$q,$notes,$date);
            $ids[]=$movement['id'];
        }
        return $ids;
    }
    private function carriedQuantities(array $pickups,?string $excludeSale = null): array {
        if(!$pickups) return [];
        $owner=reset($pickups)['user_id']; $balances=[];
        foreach($pickups as $id=>$p) {
            if($p['user_id']!==$owner) throw new LogicException('Mixed pickup owners.');
            $balances[$id]=['eggs'=>$p['eggs']-$p['returned_eggs'],'kg'=>round($p['kg']-$p['returned_kg'],3),'trays'=>$p['trays']-$p['returned_trays']];
        }
        // One scan of item quantities for this owner, not one scan of all invoices
        // (and photo documents) per line on the submitted receipt.
        $args=[$owner]; if($excludeSale!==null) $args[]=$excludeSale;
        $stmt=$this->query("SELECT JSON_EXTRACT(data,'$.items') FROM records WHERE kind='sale' AND user_id=?".($excludeSale!==null?' AND id<>?':''),$args);
        while(($json=$stmt->fetchColumn())!==false) foreach(json_decode($json,true,512,JSON_THROW_ON_ERROR) as $i) {
            $id=$i['pickup_id']; if(!isset($balances[$id])) continue;
            foreach(['eggs','kg','trays'] as $k) $balances[$id][$k]=round($balances[$id][$k]-$i[$k],3);
        }
        return $balances;
    }
    private function pickupBalance(array $p,?string $excludeSale = null): array { return $this->carriedQuantities([$p['id']=>$p],$excludeSale)[$p['id']]; }
    private function checkBalance(array $q,array $b): void {
        if($q['eggs']>$b['eggs'] || round($q['kg']-$b['kg'],3)>0) throw new ApiProblem('Jumlah melebihi sisa telur yang dibawa. Periksa butir dan kilogram.');
        if((($b['eggs']-$q['eggs'])==0) !== (round($b['kg']-$q['kg'],3)==0)) throw new ApiProblem('Sisa jumlah butir dan berat harus sama-sama habis atau sama-sama masih tersedia. Periksa berat aktual.');
    }
    private function proportionalEggs(int $grams, int $eggs, int $totalGrams): int {
        // Match Math.round on positive values in the web preview.
        $share=((float)$grams*$eggs)/$totalGrams;
        $whole=(int)$share;
        return $whole+($share-$whole>=0.5 ? 1 : 0);
    }
    /** All writers already hold the command mutex. Allocate from that transaction's stock. */
    private function resolveSaleEggs(array &$items, string $source, array $pickupBalances): void {
        $groups=[];
        foreach($items as $index=>$item) {
            $key=$source==='warehouse' ? $item['category'] : $item['pickup_id'];
            $groups[$key][]=$index;
        }
        $warehouseBalances=null;
        foreach($groups as $key=>$indices) {
            $manualEggs=0;
            $manualGrams=0;
            $weightOnly=[];
            foreach($indices as $index) {
                $grams=(int)round($items[$index]['kg']*1000);
                if($items[$index]['eggs']===null) {
                    $weightOnly[$index]=$grams;
                } else {
                    $manualEggs+=$items[$index]['eggs'];
                    $manualGrams+=$grams;
                }
            }
            if(!$weightOnly) {
                // Warehouse movements validate their complete per-category balance at debit.
                if($source==='pickup') $this->checkBalance(['eggs'=>$manualEggs,'kg'=>$manualGrams/1000],$pickupBalances[$key]);
                continue;
            }
            if($source==='warehouse') {
                $warehouseBalances??=$this->stockBalances(true)['inventory'];
                $balance=$warehouseBalances[$key]??null;
                if(!$balance) throw new ApiProblem('Stok gudang tidak ditemukan.');
            } else {
                $balance=$pickupBalances[$key];
            }
            $stockEggs=$balance['eggs']-$manualEggs;
            $stockGrams=(int)round($balance['kg']*1000)-$manualGrams;
            $soldGrams=array_sum($weightOnly);
            $linesLeft=count($weightOnly);
            $maxEggs=$stockEggs-($soldGrams<$stockGrams ? 1 : 0);
            if($soldGrams>$stockGrams || $maxEggs<$linesLeft) {
                throw new ApiProblem('Stok tidak cukup untuk berat atau jumlah butir yang dijual. Periksa kembali timbangannya.');
            }
            // Reserve one egg per reported weight, including any weight left in stock.
            $estimated=$this->proportionalEggs($soldGrams,$stockEggs,$stockGrams);
            $soldEggs=min($maxEggs,max($linesLeft,$estimated));
            foreach($weightOnly as $index=>$grams) {
                $linesLeft--;
                $share=$this->proportionalEggs($grams,$soldEggs,$soldGrams);
                $count=min($soldEggs-$linesLeft,max(1,$share));
                if($count>100000000) throw new ApiProblem('Perkiraan jumlah butir melebihi batas per item. Periksa beratnya.');
                $items[$index]['eggs']=$count;
                $items[$index]['eggs_estimated']=true;
                $soldEggs-=$count;
                $soldGrams-=$grams;
            }
        }
    }
    private function currentPrice(): array {
        // Resolve each field separately: a scheduled legacy price cannot erase a typed rate.
        $raw=$this->query("SELECT compact_data FROM records WHERE kind='price' AND occurred_at<=NOW() ORDER BY occurred_at DESC,sequence DESC LIMIT 1")->fetchColumn();
        if($raw===false) throw new ApiProblem('Admin belum menetapkan harga yang berlaku saat ini.');
        $latest=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
        $result=['id'=>$latest['id'],'effective_at'=>$latest['effective_at']];
        foreach(EggTypes::PRICE_FIELDS as $field) {
            if(array_key_exists($field,$latest)) { $result[$field]=$latest[$field]; continue; }
            // Fields are fixed server constants, not client input. Read only one eligible value.
            $value=$this->query("SELECT JSON_EXTRACT(compact_data,'$.".$field."') FROM records WHERE kind='price' AND occurred_at<=NOW() AND JSON_CONTAINS_PATH(compact_data,'one','$.".$field."') ORDER BY occurred_at DESC,sequence DESC LIMIT 1")->fetchColumn();
            if($value!==false) $result[$field]=json_decode($value,true,512,JSON_THROW_ON_ERROR);
        }
        return $result;
    }
    private function reason(array $p): string { $reason=$this->text($p,'reason',1000,true); if(mb_strlen($reason)<5) throw new ApiProblem('Alasan koreksi minimal 5 karakter.'); return $reason; }
    private function countedEggStock(array $values): array {
        $eggs = (int)$this->number($values, 'eggs', 0, true);
        $kg = $this->number($values, 'kg', 0, false, 999999999999.999);
        $quantity = ['eggs' => $eggs, 'kg' => $kg];
        if (array_key_exists('trays', $values)) {
            $quantity['trays'] = (int)$this->number($values, 'trays', 0, true);
        }
        return $quantity;
    }

    private function reconcileStock(array $payload): void {
        $this->admin();
        $reason = $this->text($payload, 'reason', 2000, true);
        $method = $this->enum($payload + ['method' => 'count'], 'method', ['count', 'add', 'subtract']);
        $rows = $payload['items'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || count($rows) < 1 || count($rows) > count(EggTypes::ALL)) {
            throw new ApiProblem('Pilih jenis telur yang ingin dicocokkan.');
        }

        $counts = [];
        foreach ($rows as $row) {
            if (!is_array($row) || !is_array($row['expected'] ?? null) || !is_array($row['physical'] ?? null)) {
                throw new ApiProblem('Isi stok tercatat dan hasil hitung fisik.');
            }
            $category = $this->enum($row, 'category', EggTypes::ALL);
            if (isset($counts[$category])) throw new ApiProblem('Kategori telur tidak boleh berulang.');
            $expected = $this->countedEggStock($row['expected']);
            $physical = $this->countedEggStock($row['physical']);
            if (($physical['eggs'] === 0) !== ($physical['kg'] === 0.0)) {
                throw new ApiProblem('Jumlah butir dan berat akhir harus sama-sama nol atau sama-sama terisi.');
            }
            if (isset($expected['trays']) !== isset($physical['trays'])) {
                throw new ApiProblem('Isi jumlah krat tercatat dan jumlah krat hasil hitung.');
            }

            $stock = $this->query('SELECT eggs,kg,trays FROM stock WHERE stock_key=? FOR UPDATE', ['egg:'.$category])->fetch(PDO::FETCH_ASSOC);
            if (!$stock) throw new ApiProblem('Stok tidak ditemukan.', 404);
            if ($expected['eggs'] !== (int)$stock['eggs'] || $expected['kg'] !== (float)$stock['kg']
                || (isset($expected['trays']) && $expected['trays'] !== (int)$stock['trays'])) {
                throw new ApiProblem('Stok berubah saat dihitung. Cek stok terbaru, lalu cocokkan lagi.', 409);
            }
            $counts[$category] = ['category' => $category, 'expected' => $expected, 'physical' => $physical];
        }

        $date = $this->now();
        $reference = $this->id('count');
        $weightChange = 0;
        foreach ($counts as $category => $count) {
            $expected = $count['expected'];
            $physical = $count['physical'];
            $eggs = $physical['eggs'] - $expected['eggs'];
            $kg = round($physical['kg'] - $expected['kg'], 3);
            $weightChange += $kg;
            // Older devices count eggs and weight only. Preserve their current tray balance.
            $trays = isset($physical['trays']) ? $physical['trays'] - $expected['trays'] : 0;
            if ($method === 'add' && (min($eggs, $kg, $trays) < 0 || max($eggs, $kg, $trays) == 0)) {
                throw new ApiProblem('Isi jumlah yang ditambahkan. Stok akhir harus lebih banyak dari stok tercatat.');
            }
            if ($method === 'subtract' && (max($eggs, $kg, $trays) > 0 || min($eggs, $kg, $trays) == 0)) {
                throw new ApiProblem('Isi jumlah yang dikurangi. Stok akhir harus lebih sedikit dari stok tercatat.');
            }
            // Persist the verified end balance directly while the row is locked.
            // An explicit decimal string keeps PDO from truncating large weights.
            $this->query('UPDATE stock SET eggs=?, kg=?, trays=COALESCE(?,trays) WHERE stock_key=?', [
                $physical['eggs'], number_format($physical['kg'], 3, '.', ''), $physical['trays'] ?? null, 'egg:'.$category,
            ]);
            $this->insert('stock_movement', $count + [
                'kind' => 'reconcile', 'method' => $method, 'reference_id' => $reference, 'date' => $date, 'created_at' => $date,
                'user_id' => $this->actor['id'], 'eggs' => $eggs, 'kg' => $kg, 'trays' => $trays, 'notes' => $reason,
            ]);
        }
        $this->audit('stock.reconcile', 'Menyesuaikan stok gudang: '.$reason, null, [
            'id' => $reference, 'method' => $method, 'counts' => array_values($counts), 'reason' => $reason,
        ]);
        if($method==='add') $this->notifyFarmActivity('stock.add',$weightChange);
    }
    private function classifyStock(array $p): void {
        $this->admin();
        if(array_diff(array_keys($p),['category','eggs','kg','trays','expected_source','expected_target','reason'])) throw new ApiProblem('Kolom pemilahan stok tidak didukung.');
        $category=$this->enum($p,'category',['skm','skm_new']); $q=$this->quantity($p); $reason=$this->reason($p);
        $before=[];
        foreach(['source'=>'good','target'=>$category] as $key=>$type) {
            $input=$p['expected_'.$key]??null;
            if(!is_array($input) || count($input)!==3 || array_diff(array_keys($input),['eggs','kg','trays'])) throw new ApiProblem('Muat ulang stok asal dan tujuan sebelum memilah.');
            $expected=$this->countedEggStock($input);
            $row=$this->query('SELECT eggs,kg,trays FROM stock WHERE stock_key=? FOR UPDATE',['egg:'.$type])->fetch(PDO::FETCH_ASSOC);
            if(!$row) throw new ApiProblem('Jenis stok belum siap. Hubungi atasan.',409);
            $actual=['eggs'=>(int)$row['eggs'],'kg'=>(float)$row['kg'],'trays'=>(int)$row['trays']];
            if($expected!==$actual) throw new ApiProblem('Stok berubah sejak dibuka. Muat ulang sebelum memilah.',409);
            $before[$key]=$actual;
        }
        $this->stock('egg:good',-$q['eggs'],-$q['kg'],-$q['trays'],true);
        $this->stock('egg:'.$category,$q['eggs'],$q['kg'],$q['trays']);
        $reference=$this->id('classify'); $now=$this->now();
        $record=['id'=>$reference,'date'=>$now,'user_id'=>$this->actor['id']];
        $this->movement('classify_out',$record+['category'=>'good'],['eggs'=>-$q['eggs'],'kg'=>-$q['kg'],'trays'=>-$q['trays']],$reason,$now);
        $this->movement('classify_in',$record+['category'=>$category],$q,$reason,$now);
        $this->audit('stock.classify','Memilah stok bagus lama menjadi '.EggTypes::LABELS[$category].': '.$reason,$before,['id'=>$reference,'source'=>'good','category'=>$category,'quantity'=>$q,'reason'=>$reason]);
    }
    private function changes(string $entity,array $changes): array {
        $allowed=['production'=>['eggs','kg','trays','notes'],'pickup'=>['eggs','kg','trays','notes','area'],'sale'=>['notes','customer','items']];
        if(!isset($allowed[$entity]) || !$changes || array_diff(array_keys($changes),$allowed[$entity])) throw new ApiProblem('Kolom koreksi tidak didukung. Nilai penjualan dan snapshot harga tidak dapat diubah.');
        $out=[]; foreach($changes as $key=>$value) {
            if($key==='items') {
                if(!is_array($value) || count($value)<1 || count($value)>100) throw new ApiProblem('Koreksi harus mencantumkan seluruh item penjualan yang sudah ada.');
                $out['items']=[]; $ids=[];
                foreach($value as $item) {
                    if(!is_array($item) || array_diff(array_keys($item),['id','eggs','kg','trays'])) throw new ApiProblem('Koreksi hanya dapat mengubah kuantitas item; harga dan sumber tidak dapat diganti.');
                    $id=$this->text($item,'id',40,true); if(isset($ids[$id])) throw new ApiProblem('Item koreksi tidak boleh duplikat.'); $ids[$id]=true;
                    $out['items'][]=['id'=>$id]+$this->quantity($item);
                }
                continue;
            }
            $allowZero=$entity==='production' && $this->actor['role']==='admin';
            $out[$key]=in_array($key,['eggs','kg','trays'],true)?$this->number([$key=>$value],$key,$key==='trays' || $allowZero?0:($key==='kg'?0.001:1),$key!=='kg'):$this->text([$key=>$value],$key,$key==='notes'?2000:190,$key==='customer');
        } return $out;
    }
    private function applyCorrection(string $entity,string $id,string $reason,array $changes,bool $review=false): void {
        $r=$this->record($entity,$id,true); $this->owned($r);
        if($this->actor['role']!=='admin' && ($entity!=='production' || $r['locked'])) throw new ApiProblem('Data ini harus dikoreksi melalui persetujuan admin.',403);
        $changes=$this->changes($entity,$changes); $updated=array_replace($r,$changes);
        if($entity==='production' && ($updated['eggs']==0 || $updated['kg']==0)
            && ($this->actor['role']!=='admin' || $updated['eggs']!=0 || $updated['kg']!=0 || $updated['trays']!=0)) {
            throw new ApiProblem('Panen kosong hanya dapat dikoreksi admin dengan butir, berat, dan krat semuanya nol.');
        }
        if($entity==='production' && $this->productionStocked($r)) {
            $delta=['eggs'=>(int)($updated['eggs']-$r['eggs']),'kg'=>round($updated['kg']-$r['kg'],3),'trays'=>(int)($updated['trays']-$r['trays'])];
            $this->stock('egg:'.$r['category'],$delta['eggs'],$delta['kg'],$delta['trays']);
            if($delta['eggs']!==0 || $delta['kg']!=0 || $delta['trays']!==0) $this->movement('correction',$r,$delta,'Koreksi oleh '.$this->actor['name'].': '.$reason,$this->now());
        }
        if($entity==='pickup') {
            $available=$this->pickupBalance($r);
            $remaining=['eggs'=>$available['eggs']+$updated['eggs']-$r['eggs'],'kg'=>round($available['kg']+$updated['kg']-$r['kg'],3)];
            $this->checkBalance(['eggs'=>0,'kg'=>0],$remaining);
            $delta=['eggs'=>(int)($r['eggs']-$updated['eggs']),'kg'=>round($r['kg']-$updated['kg'],3),'trays'=>(int)($r['trays']-$updated['trays'])];
            $this->stock('egg:'.$r['category'],$delta['eggs'],$delta['kg'],$delta['trays']);
            if($delta['eggs']!==0 || $delta['kg']!=0 || $delta['trays']!==0) $this->movement('correction',$r,$delta,'Koreksi pengambilan oleh '.$this->actor['name'].': '.$reason,$this->now());
        }
        if($entity==='sale' && isset($changes['items'])) {
            if(count($changes['items'])!==count($r['items'])) throw new ApiProblem('Item penjualan tidak boleh ditambah atau dihapus lewat koreksi.');
            $quantities=[]; foreach($changes['items'] as $item) $quantities[$item['id']]=$item;
            $warehouse=($r['stock_source']??'pickup')==='warehouse';
            $newItems=[]; $reserved=[]; $total=0;
            foreach($r['items'] as $item) {
                if(!isset($quantities[$item['id']])) throw new ApiProblem('ID item koreksi tidak cocok dengan penjualan.');
                $newItem=array_replace($item,$quantities[$item['id']]);
                if($newItem['eggs']!=$item['eggs']) unset($newItem['eggs_estimated']);
                $newItem['total']=round($newItem['kg']*$item['unit_price']); $total+=$newItem['total'];
                if(!is_finite($total) || $total>1000000000000) throw new ApiProblem('Total transaksi maksimal Rp1.000.000.000.000.');
                $newItems[]=$newItem;
                if(!$warehouse) {
                    $pid=$item['pickup_id']; $used=$reserved[$pid]??['eggs'=>0,'kg'=>0]; $reserved[$pid]=['eggs'=>$used['eggs']+$newItem['eggs'],'kg'=>round($used['kg']+$newItem['kg'],3)];
                }
            }
            foreach($reserved as $pid=>$q) $this->checkBalance($q,$this->pickupBalance($this->record('pickup',$pid,true),$r['id']));
            if($total<$r['paid']) throw new ApiProblem('Total koreksi lebih kecil dari pembayaran yang sudah diterima. Pengembalian uang/refund belum didukung.');
            $updated['items']=$newItems; $updated['total']=$total; $updated['balance']=$total-$r['paid']; $updated['payment_status']=$r['paid']==$total?'paid':($r['paid']>0?'partial':'unpaid');
            if($warehouse) $this->warehouseSaleMovements($updated,$r['items'],'correction','Koreksi penjualan oleh '.$this->actor['name'].': '.$reason,$this->now());
        }
        if($entity==='sale' && array_filter($updated['items'],fn($item)=>$item['category']==='cracked' && $item['unit_price']==0)) $this->text($updated,'customer',190,true);
        $this->save($entity,$updated); $this->audit('correction.apply',$reason,$r,$updated);
    }
    public function command(string $action,array $p,string $requestId = '',bool $compact = false,?string $receiptRole = null): array {
        if($requestId !== '' && !preg_match('/^[A-Za-z0-9_-]{8,80}$/D',$requestId)) throw new ApiProblem('ID permintaan tidak valid.');
        $this->commandResult=null;
        $resultId='cmd_'.substr(hash('sha256',$this->actor['id'].'|'.$requestId),0,36);
        $digest=hash('sha256',$this->json([$action,$p]));
        $sensitive=in_array($action,['user.create','profile.password'],true) || ($action==='user.update' && array_key_exists('password',$p));
        // Salt sensitive request fingerprints too: a stored retry key must not become
        // a cheap password-guessing oracle. Bcrypt's 60 bytes fit the existing column.
        $fingerprint=$sensitive?password_hash($digest,PASSWORD_BCRYPT):$digest;
        $this->db->beginTransaction();
        try {
            // A short command mutex keeps cross-document invariants deterministic; stock/pickups
            // are additionally row-locked. Suitable for this farm-scale workload.
            $this->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
            $active=$this->query('SELECT * FROM users WHERE id=?',[$this->actor['id']])->fetch(PDO::FETCH_ASSOC);
            $session=$this->query('SELECT user_id FROM tokens WHERE token_hash=? AND user_id=? AND expires_at>NOW() AND created_at>DATE_SUB(NOW(),INTERVAL 90 DAY)',[$this->authTokenHash,$this->actor['id']])->fetchColumn();
            if(!$session || !$active || !$active['active'] || $active['deleted_at']!==null || ($this->registrationRecord($this->actor['id'])['status']??'approved')!=='approved') throw new ApiProblem('Sesi berakhir atau akun tidak aktif. Silakan masuk kembali.',401);
            $this->actor=$this->publicUser($active,false);
            if($requestId!=='') {
                $old=$this->query('SELECT fingerprint FROM command_requests WHERE user_id=? AND request_id=?',[$this->actor['id'],$requestId])->fetchColumn();
                if($old) {
                    if(!hash_equals($old,$digest) && !($sensitive && password_verify($digest,$old))) throw new ApiProblem('ID permintaan sudah digunakan untuk perubahan berbeda.',409);
                    $saved=$this->query("SELECT data FROM records WHERE kind='command_result' AND id=? AND user_id=?",[$resultId,$this->actor['id']])->fetchColumn();
                    $result=$saved?json_decode($saved,true,512,JSON_THROW_ON_ERROR):null;
                    $this->db->commit(); return $this->commandState($compact,$result,$receiptRole);
                }
            }
            $this->dispatch($action,$p);
            if($this->commandResult!==null) {
                $this->commandResult['request_id']=$requestId;
                if($requestId!=='') $this->insert('command_result',$this->commandResult+['id'=>$resultId,'user_id'=>$this->actor['id'],'created_at'=>$this->now()]);
            }
            if($requestId!=='') $this->query('INSERT INTO command_requests(user_id,request_id,fingerprint) VALUES(?,?,?)',[$this->actor['id'],$requestId,$fingerprint]);
            $this->query('UPDATE command_mutex SET version=version+1 WHERE id=1');
            $this->db->commit(); return $this->commandState($compact,$this->commandResult,$receiptRole);
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    private function commandState(bool $compact,?array $result,?string $receiptRole): array {
        if($compact && $receiptRole===$this->actor['role'] && ($result['action']??null)==='sale.create') {
            $this->db->beginTransaction();
            try {
                $sale=$this->records('sale',$this->actor['id'],true,true,$result['record_id'])[0]??null;
                if(!$sale) throw new ApiProblem('Nota yang sudah disimpan belum dapat dibuka.',503);
                $receipt=['mode'=>'sale_receipt','sale'=>$sale,'command_result'=>['action'=>'sale.create','record_id'=>$sale['id'],'request_id'=>$result['request_id']]];
                if(($sale['stock_source']??'pickup')==='warehouse') {
                    $movements=[];
                    foreach($result['movement_ids'] as $id) $movements[]=$this->record('stock_movement',$id);
                    $receipt+=['pickups'=>[],'pickup_balances'=>(object)[],'inventory'=>$this->stockBalances(true)['inventory'],'stock_movements'=>$movements];
                    $this->db->commit();
                    return $receipt;
                }
                $pickups=[]; foreach(array_unique(array_column($sale['items'],'pickup_id')) as $id) {
                    $row=$this->record('pickup',$id); $this->ownOnly($row); $pickups[$id]=$row;
                }
                $balances=$this->carriedQuantities($pickups);
                foreach($balances as $id=>&$b) {
                    $p=$pickups[$id]; $b['trays']=max(0,$b['trays']);
                    $b['status']=$b['kg']<=0 && $b['eggs']<=0 ? ($p['returned_kg']>0 || $p['returned_eggs']>0?'Dikembalikan':'Terjual') : ($b['eggs']<$p['eggs']-$p['returned_eggs']?'Sebagian terjual':'Dibawa');
                } unset($b);
                $this->db->commit();
                return $receipt+['pickups'=>array_values($pickups),'pickup_balances'=>$balances];
            } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        }
        $state=$this->bootstrap($compact);
        if($result!==null) $state['command_result']=['action'=>$result['action'],'record_id'=>$result['record_id'],'request_id'=>$result['request_id']];
        return $state;
    }
    private function dispatch(string $action,array $p): void {
        switch($action) {
            case 'settings.update':
                $this->admin();
                if(array_diff(array_keys($p),['harvest_auto_stock']) || !is_bool($p['harvest_auto_stock']??null)) throw new ApiProblem('Pengaturan stok panen harus berupa aktif atau nonaktif.');
                $before=$this->settings(); $after=['harvest_auto_stock'=>$p['harvest_auto_stock']];
                $this->query("INSERT INTO records(id,kind,occurred_at,data) VALUES('settings_global','settings',NOW(),?) ON DUPLICATE KEY UPDATE data=VALUES(data)",[$this->json($after)]);
                $this->audit($action,'Mengubah pengaturan stok panen otomatis',$before,$after); break;
            case 'production.create':
                $rows=array_key_exists('items',$p)?$p['items']:[$p];
                if(!is_array($rows) || count($rows)<1 || count($rows)>count(EggTypes::ACTIVE) || array_keys($rows)!==range(0,count($rows)-1)) throw new ApiProblem('Isi satu sampai tiga jenis telur untuk panen.');
                $items=[]; foreach($rows as $item) {
                    if(!is_array($item)) throw new ApiProblem('Baris panen tidak valid.');
                    $category=$this->enum($item,'category',EggTypes::ACTIVE); if(isset($items[$category])) throw new ApiProblem('Jenis telur tidak boleh berulang.');
                    $items[$category]=$this->quantity($item);
                }
                $barn=$this->text($p,'barn_id',40); if($barn!=='') $this->record('barn',$barn);
                $automatic=$this->settings()['harvest_auto_stock']; $now=$this->now(); $photo=$this->photo($p); $ref=null;
                $common=['harvest_id'=>$this->id('harvest'),'date'=>$this->date($p),'user_id'=>$this->actor['id'],'barn_id'=>$barn,'notes'=>$this->text($p,'notes'),'location'=>$this->text($p,'location',190),'created_at'=>$now,'locked'=>false,'stocked_at'=>$automatic?$now:null,'stocked_by'=>$automatic?$this->actor['id']:null];
                foreach($items as $category=>$q) {
                    $r=$this->insert('production',$common+$q+['category'=>$category]+($ref?['photo_ref'=>$ref]:['photo'=>$photo]));
                    if($automatic) { $this->stock('egg:'.$category,$q['eggs'],$q['kg'],$q['trays']); $this->movement('production',$r,$q,$r['notes']); }
                    if($photo!=='' && !$ref) $ref=['kind'=>'production','id'=>$r['id'],'version'=>hash('sha256',$photo)];
                }
                $this->audit($action,$automatic?'Mencatat panen dan menambah stok':'Mencatat panen yang menunggu penerimaan stok',null,['harvest_id'=>$common['harvest_id'],'date'=>$common['date'],'items'=>$items]);
                $this->notifyFarmActivity($automatic?'production.stocked':$action,array_sum(array_column($items,'kg')));
                break;
            case 'stock.reconcile':
                $this->reconcileStock($p);
                break;
            case 'stock.classify':
                $this->classifyStock($p);
                break;
            case 'production.receive':
                if(array_diff(array_keys($p),['id'])) throw new ApiProblem('Penerimaan stok harus mencakup seluruh panen.');
                $r=$this->record('production',$this->text($p,'id',40,true),true); $this->owned($r);
                if($this->productionStocked($r)) throw new ApiProblem('Panen ini sudah diterima ke stok.',409);
                $before=$r; $r['stocked_at']=$this->now(); $r['stocked_by']=$this->actor['id'];
                $q=['eggs'=>$r['eggs'],'kg'=>$r['kg'],'trays'=>$r['trays']];
                $this->stock('egg:'.$r['category'],$q['eggs'],$q['kg'],$q['trays']); $this->save('production',$r);
                $this->movement('production',$r,$q,'Penerimaan panen: '.$r['notes'],$r['stocked_at']);
                $this->audit($action,'Menerima seluruh panen ke stok',$before,$r);
                $this->notifyFarmActivity($action,$q['kg']);
                break;
            case 'pickup.create':
                $q=$this->quantity($p); $category=$this->enum($p,'category',EggTypes::ACTIVE);
                $this->stock('egg:'.$category,-$q['eggs'],-$q['kg'],-$q['trays']);
                $r=$this->insert('pickup',$q+['date'=>$this->date($p),'user_id'=>$this->actor['id'],'category'=>$category,'area'=>$this->text($p,'area',190),'notes'=>$this->text($p,'notes'),'returned_eggs'=>0,'returned_kg'=>0,'returned_trays'=>0,'created_at'=>$this->now(),'locked'=>false]);
                $this->movement('pickup',$r,['eggs'=>-$q['eggs'],'kg'=>-$q['kg'],'trays'=>-$q['trays']],$r['notes']); $this->audit($action,'Mengambil telur untuk dijual',null,$r); break;
            case 'pickup.return':
                $r=$this->record('pickup',$this->text($p,'id',40,true),true); $this->owned($r); $q=$this->quantity($p); $this->checkBalance($q,$this->pickupBalance($r));
                foreach(['eggs','kg','trays'] as $k) $r['returned_'.$k]=round($r['returned_'.$k]+$q[$k],3);
                $this->stock('egg:'.$r['category'],$q['eggs'],$q['kg'],$q['trays']); $this->save('pickup',$r);
                $this->movement('return',$r,$q,$this->text($p,'notes'),$this->now());
                $this->audit($action,'Mengembalikan telur: '.$this->text($p,'notes'),null,['pickup_id'=>$r['id'],'quantity'=>$q]);
                $this->notifyFarmActivity($action,$q['kg']);
                break;
            case 'sale.create': $this->createSale($p); break;
            case 'sale.payment':
            case 'feed.payment':
            case 'sale.due':
            case 'feed.due': $this->updateInvoice($action,$p); break;
            case 'price.create':
                $this->admin(); $effective=$this->date($p,'effective_at');
                if(array_diff(array_keys($p),['skm_price','skm_new_price','cracked_price','effective_at'])) throw new ApiProblem('Perbarui aplikasi untuk mengatur harga SKM, SKM Baru, dan bentes.');
                $r=$this->insert('price',['skm_price'=>$this->number($p,'skm_price',1,true,10000000),'skm_new_price'=>$this->number($p,'skm_new_price',1,true,10000000),'cracked_price'=>$this->number($p,'cracked_price',0,true,10000000),'effective_at'=>$effective,'created_at'=>$this->now(),'created_by'=>$this->actor['id']]);
                foreach((new PushService($this->db))->activeRecipients() as $uid) $this->insert('notification',['user_id'=>$uid,'title'=>'Harga telur diperbarui','message'=>EggTypes::priceMessage($r),'created_at'=>$this->now(),'read'=>false]);
                (new PushService($this->db))->enqueuePrice($r);
                $this->audit($action,'Menetapkan harga telur',null,$r); break;
            case 'user.create': $this->createUser($p); break;
            case 'profile.update': $this->updateProfile($p); break;
            case 'profile.password': $this->changeOwnPassword($p); break;
            case 'user.update': $this->updateUser($p); break;
            case 'user.delete': $this->deleteUser($p); break;
            case 'stock_check.submit': $this->submitStockCheck($p); break;
            case 'stock_check.review': $this->reviewStockCheck($p); break;
            case 'user.approve': $this->reviewRegistration($p,true); break;
            case 'user.reject': $this->reviewRegistration($p,false); break;
            case 'barn.create':
                $this->admin(); $r=$this->insert('barn',['name'=>$this->text($p,'name',120,true),'type'=>$this->enum($p+['type'=>'ayam'],'type',['ayam']),'capacity'=>$this->number($p+['capacity'=>0],'capacity',0,true,1000000),'notes'=>$this->text($p,'notes')]);
                $this->audit($action,'Menambahkan sumber/kandang ayam',null,$r); break;
            case 'feed.create':
                $this->admin(); $r=$this->insert('feed',['name'=>$this->text($p,'name',120,true),'unit'=>$this->enum($p+['unit'=>'kg'],'unit',['kg']),'min_stock'=>$this->number($p,'min_stock',0,false,1000000)]);
                $this->query('INSERT INTO stock(stock_key) VALUES(?)',['feed:'.$r['id']]); $this->audit($action,'Menambahkan jenis pakan',null,$r); break;
            case 'feed.purchase': $this->purchaseFeed($p); break;
            case 'feed.use':
                $feed=$this->text($p,'feed_id',40,true); $barn=$this->text($p,'barn_id',40,true); $this->record('feed',$feed); $this->record('barn',$barn); $qty=$this->number($p,'quantity',0.001,false,1000000);
                $this->stock('feed:'.$feed,0,-$qty); $r=$this->insert('feed_usage',['date'=>$this->date($p),'feed_id'=>$feed,'barn_id'=>$barn,'quantity'=>$qty,'notes'=>$this->text($p,'notes'),'created_at'=>$this->now(),'user_id'=>$this->actor['id']]);
                $this->audit($action,'Mencatat pemakaian pakan',null,$r); break;
            case 'notification.read':
                $id=$this->text($p,'id',40,true); $list=$id==='all'?$this->records('notification',$this->actor['id']):[$this->record('notification',$id,true)];
                $count=0; foreach($list as $r) { if($r['user_id']!==$this->actor['id']) { if($id==='all') continue; throw new ApiProblem('Notifikasi bukan milik Anda.',403); } if(!$r['read']) { $r['read']=true; $this->save('notification',$r); $count++; } }
                if($count>0) { $this->insert('notice_read',['user_id'=>$this->actor['id'],'target'=>$id]); $this->audit($action,'Menandai '.$count.' notifikasi sebagai dibaca'); } break;
            case 'correction.request':
                $entity=$this->enum($p,'entity',['production','pickup','sale']); $id=$this->text($p,'id',40,true); $record=$this->record($entity,$id,true); $this->owned($record); $reason=$this->reason($p);
                if(!isset($p['changes']) || !is_array($p['changes'])) throw new ApiProblem('Perubahan harus diisi.');
                $r=$this->insert('correction',['user_id'=>$this->actor['id'],'entity'=>$entity,'record_id'=>$id,'reason'=>$reason,'changes'=>$this->changes($entity,$p['changes']),'status'=>'pending','created_at'=>$this->now()]);
                $this->audit($action,'Mengajukan koreksi: '.$reason,null,$r); break;
            case 'correction.apply':
                if(!isset($p['changes']) || !is_array($p['changes'])) throw new ApiProblem('Perubahan harus diisi.');
                $this->applyCorrection($this->enum($p,'entity',['production','pickup','sale']),$this->text($p,'id',40,true),$this->reason($p),$p['changes']); break;
            case 'correction.review':
                $this->admin(); $r=$this->record('correction',$this->text($p,'id',40,true),true);
                if($r['status']!=='pending') throw new ApiProblem('Koreksi sudah ditinjau.');
                if(!is_bool($p['approved']??null)) throw new ApiProblem('Keputusan koreksi tidak valid.');
                if($p['approved']) $this->applyCorrection($r['entity'],$r['record_id'],$r['reason'],$r['changes'],true);
                $r['status']=$p['approved']?'approved':'rejected'; $r['reviewed_at']=$this->now(); $r['reviewed_by']=$this->actor['id']; $this->save('correction',$r); $this->audit($action,'Meninjau koreksi',null,$r); break;
            case 'record.lock':
                $this->admin(); $entity=$this->enum($p,'entity',['production','pickup','sale']); $r=$this->record($entity,$this->text($p,'id',40,true),true);
                if(!is_bool($p['locked']??null)) throw new ApiProblem('Status kunci tidak valid.');
                $r['locked']=$p['locked']; $this->save($entity,$r); $this->audit($action,$r['locked']?'Mengunci data':'Membuka kunci data',null,$r); break;
            default: throw new ApiProblem('Perintah tidak dikenal atau fitur masih Coming Soon.',404);
        }
    }
    private function invoiceDue(array $p,string $date): ?string {
        if(!isset($p['due_date']) || $p['due_date']==='') return null;
        if(!is_string($p['due_date']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$p['due_date'])) throw new ApiProblem('Isi tanggal jatuh tempo yang valid.');
        $due=$this->date($p,'due_date');
        if($due<substr($date,0,10)) throw new ApiProblem('Jatuh tempo tidak boleh sebelum tanggal nota.');
        return $due;
    }
    private function invoicePayment(string $kind,float $amount,?string $method=null): array {
        $entry=['kind'=>$kind,'amount'=>$amount,'recorded_at'=>$this->now(),'user_id'=>$this->actor['id']];
        if($method!==null) $entry['method']=$method;
        return $entry;
    }
    private function updateInvoice(string $action,array $p): void {
        $supplier=strpos($action,'feed.')===0;
        if($supplier) $this->admin();
        $kind=$supplier?'feed_purchase':'sale';
        $r=$this->record($kind,$this->text($p,'id',40,true),true); $this->owned($r);
        $before=['id'=>$r['id'],'number'=>$r['number'],'paid'=>$r['paid'],'balance'=>$r['balance'],'due_date'=>$r['due_date']??null];
        if(substr($action,-4)==='.due') {
            if($r['balance']<=0) throw new ApiProblem('Nota ini sudah lunas.');
            $due=$this->invoiceDue($p,$r['date']); if($due===null) throw new ApiProblem('Isi tanggal jatuh tempo.');
            $r['due_date']=$due; $this->save($kind,$r);
            $this->audit($action,'Mengatur jatuh tempo '.$r['number'],$before,['id'=>$r['id'],'due_date'=>$due]); return;
        }
        if(($supplier || array_key_exists('expected_paid',$p)) && $this->number($p,'expected_paid',0,true)!==(float)$r['paid']) throw new ApiProblem('Pembayaran sudah berubah. Buka kembali nota dan periksa riwayatnya.',409);
        $amount=$this->number($p,'amount',1,true); if($amount>$r['balance']) throw new ApiProblem('Pembayaran melebihi sisa tagihan.');
        $method=isset($p['method']) && $p['method']!==''?$this->enum($p,'method',['cash','transfer','qris']):null;
        $entry=$this->invoicePayment('installment',$amount,$method);
        $r['payments'][]=$entry; $r['paid']+=$amount; $r['balance']=$r['total']-$r['paid'];
        if(!$supplier) $r['payment_status']=$r['balance']==0?'paid':'partial';
        $this->save($kind,$r);
        $this->audit($action,'Mencatat pembayaran '.($supplier?'ke pemasok ':'pelanggan ').$r['number'],$before,['id'=>$r['id'],'paid'=>$r['paid'],'balance'=>$r['balance'],'payment'=>$entry]);
    }
    private function createSale(array $p): void {
        $source=$this->enum($p+['stock_source'=>'pickup'],'stock_source',['pickup','warehouse']);
        $customer=$this->text($p,'customer',190,true);
        $photo=$this->photo($p); if($photo==='') throw new ApiProblem('Foto dokumentasi penjualan wajib diisi.');
        $items=$p['items']??null; if(!is_array($items) || count($items)<1 || count($items)>100) throw new ApiProblem('Transaksi harus berisi 1–100 item.');
        $price=$this->currentPrice();
        if(isset($p['expected_price_id']) && $this->text($p,'expected_price_id',40,true)!==$price['id']) throw new ApiProblem('Harga telur berubah. Periksa harga terbaru lalu simpan kembali.',409);
        $out=[]; $total=0; $pickups=[];
        foreach($items as $item) {
            if(!is_array($item)) throw new ApiProblem('Item tidak valid.');
            $id=$this->text($item,'pickup_id',40,$source==='pickup');
            if($source==='warehouse') {
                if($id!=='') throw new ApiProblem('Penjualan dari gudang hanya boleh menggunakan stok gudang.');
                continue;
            }
            if(isset($pickups[$id])) continue;
            $pickup=$this->record('pickup',$id,true); $this->ownOnly($pickup); $pickups[$id]=$pickup;
        }
        $balances=$this->carriedQuantities($pickups);
        foreach($items as $item) {
            $id=''; $category=$this->enum($item,'category',EggTypes::ALL); $q=$this->quantity($item,true);
            if($source==='pickup') {
                $id=trim($item['pickup_id']);
                if($category!==$pickups[$id]['category']) throw new ApiProblem('Kategori penjualan berbeda dengan telur yang diambil.');
            }
            if(array_key_exists('is_free',$item) && !is_bool($item['is_free'])) throw new ApiProblem('Pilihan gratis tidak valid.');
            $requestedFree=$item['is_free']??false;
            if($requestedFree && $category!=='cracked') throw new ApiProblem('Hanya telur bentes yang boleh diberikan gratis.');
            if($requestedFree && $price['cracked_price']>0 && $this->actor['role']!=='admin') {
                throw new ApiProblem('Hanya atasan yang bisa memberikan telur bentes gratis. Gunakan harga yang berlaku.');
            }
            $free=$category==='cracked' && ($requestedFree || $price['cracked_price']==0);
            $field=EggTypes::PRICE_FIELDS[$category];
            if(!array_key_exists($field,$price)) throw new ApiProblem('Harga '.EggTypes::LABELS[$category].' belum tersedia. Minta atasan menetapkan harga sebelum menjual.');
            $unit=$free?0:$price[$field]; $itemTotal=round($q['kg']*$unit);
            $out[]=$q+['id'=>$this->id('item'),'pickup_id'=>$id,'category'=>$category,'unit_price'=>$unit,'is_free'=>$free,'total'=>$itemTotal]; $total+=$itemTotal;
            if(!is_finite($total) || $total>1000000000000) throw new ApiProblem('Total transaksi maksimal Rp1.000.000.000.000.');
        }
        $this->resolveSaleEggs($out,$source,$balances);
        $paid=$this->number($p,'paid',0,true); if($paid>$total) throw new ApiProblem('Nominal pembayaran melebihi total transaksi.');
        $method=$this->enum($p,'payment_method',['cash','transfer','qris','credit']);
        $date=$this->date($p);
        $r=$this->insert('sale',['stock_source'=>$source,'due_date'=>$this->invoiceDue($p,$date),'payments'=>$paid>0?[$this->invoicePayment('initial',$paid,$method==='credit'?null:$method)]:[],'number'=>'TK-'.date('Ymd').'-'.strtoupper(bin2hex(random_bytes(4))),'date'=>$date,'user_id'=>$this->actor['id'],'customer'=>$customer,'phone'=>$this->text($p,'phone',40),'items'=>$out,'total'=>$total,'paid'=>$paid,'balance'=>$total-$paid,'payment_method'=>$total==0?'cash':$method,'payment_status'=>$paid==$total?'paid':($paid>0?'partial':'unpaid'),'notes'=>$this->text($p,'notes'),'photo'=>$photo,'created_at'=>$this->now(),'locked'=>true]);
        $this->commandResult=['action'=>'sale.create','record_id'=>$r['id'],'request_id'=>''];
        if($source==='warehouse') $this->commandResult['movement_ids']=$this->warehouseSaleMovements($r,[],'sale','Penjualan gudang '.$r['number']);
        $this->audit('sale.create','Mencatat penjualan '.$r['number'],null,$r);
        $this->notifyFarmActivity('sale.create',array_sum(array_column($out,'kg')));
    }
    private function createUser(array $p): void {
        if(array_key_exists('can_check_stock',$p)) throw new ApiProblem('Tunjuk pemeriksa stok melalui pengaturan akun setelah akun dibuat.');
        if(array_diff(array_keys($p),['name','email','username','password','password_confirmation','role','target'])) throw new ApiProblem('Kolom akun tidak didukung.');
        $this->admin(); $email=strtolower($this->text($p,'email',190,true)); if(!filter_var($email,FILTER_VALIDATE_EMAIL)) throw new ApiProblem('Format email tidak valid.');
        $password=$this->accountPassword($p,'password',10,false);
        if($this->query('SELECT id FROM users WHERE email=?',[$email])->fetchColumn()) throw new ApiProblem('Email sudah digunakan.');
        $id=$this->id('user'); $name=$this->text($p,'name',120,true); $role=$this->enum($p,'role',['admin','employee']); $target=$this->number($p+['target'=>0],'target',0,true);
        $username=$this->username($p,$email);
        $this->query('INSERT INTO users(id,name,email,username,password_hash,role,target) VALUES(?,?,?,?,?,?,?)',[$id,$name,$email,$username,password_hash($password,PASSWORD_DEFAULT),$role,$target]);
        $this->audit('user.create','Membuat akun karyawan',null,['id'=>$id,'name'=>$name,'email'=>$email,'username'=>$username,'role'=>$role,'target'=>$target]);
    }
    private function updateProfile(array $p): void {
        if (array_diff(array_keys($p),['name','username','photo'])) throw new ApiProblem('Profil hanya dapat mengubah nama, username, dan foto.');
        $name=$this->text($p,'name',120,true);
        $id=$this->actor['id'];
        $before=$this->query('SELECT name,email,username FROM users WHERE id=?',[$id])->fetch(PDO::FETCH_ASSOC);
        $username=array_key_exists('username',$p)?$this->username($p,$before['email'],$id):$before['username'];
        $this->query('UPDATE users SET name=?,username=? WHERE id=?',[$name,$username,$id]);
        if (array_key_exists('photo',$p)) {
            $photo=$this->photo($p);
            $profileId='profile_'.substr(hash('sha256',$id),0,32);
            $this->query("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'user_profile',?,NOW(),?) ON DUPLICATE KEY UPDATE data=VALUES(data)",[$profileId,$id,$this->json(['photo'=>$photo])]);
        }
        $this->audit('profile.update','Memperbarui profil sendiri',['name'=>$before['name'],'username'=>$before['username']],['name'=>$name,'username'=>$username,'photo_changed'=>array_key_exists('photo',$p)]);
    }
    private function updateUser(array $p): void {
        if(array_diff(array_keys($p),['id','name','email','username','photo','target','active','role','password','password_confirmation','can_check_stock'])) throw new ApiProblem('Kolom perubahan akun tidak didukung.');
        $this->admin(); $id=$this->text($p,'id',40,true); $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC); if(!$u) throw new ApiProblem('Pengguna tidak ditemukan.',404);
        if($u['deleted_at']!==null) throw new ApiProblem('Akun ini sudah dihapus. Riwayatnya tetap tersimpan.');
        $before=$this->publicUser($u,false); $name=array_key_exists('name',$p)?$this->text($p,'name',120,true):$u['name']; $target=array_key_exists('target',$p)?$this->number($p,'target',0,true):(float)$u['target']; $active=array_key_exists('active',$p)?$p['active']:(bool)$u['active'];
        $role=array_key_exists('role',$p)?$this->enum($p,'role',['admin','employee']):$u['role'];
        $passwordChanged=array_key_exists('password',$p) || array_key_exists('password_confirmation',$p);
        if($u['is_superadmin'] && ($passwordChanged || !$active || $role!=='admin')) throw new ApiProblem('Superadmin dilindungi. Kata sandi, peran, dan status aktifnya tidak dapat diubah.');
        $passwordHash=$passwordChanged?password_hash($this->accountPassword($p,'password',12),PASSWORD_DEFAULT):$u['password_hash'];
        $email=$u['email'];
        $username=array_key_exists('username',$p)?$this->username($p,$email,$id):$u['username'];
        if(array_key_exists('email',$p)) {
            $email=strtolower($this->text($p,'email',190,true));
            if(!filter_var($email,FILTER_VALIDATE_EMAIL)) throw new ApiProblem('Format email tidak valid.');
            if($this->query('SELECT id FROM users WHERE LOWER(email)=? AND id<>?',[$email,$id])->fetchColumn()) throw new ApiProblem('Email sudah digunakan.');
        }
        $photoChanged=array_key_exists('photo',$p);
        if($photoChanged && !is_string($p['photo'])) throw new ApiProblem('Kolom photo harus berupa teks.');
        $photo=$photoChanged?$this->photo($p):null;
        if(!is_bool($active)) throw new ApiProblem('Status aktif tidak valid.');
        $canCheck=array_key_exists('can_check_stock',$p)?$p['can_check_stock']:(bool)$u['can_check_stock'];
        if(!is_bool($canCheck)) throw new ApiProblem('Penugasan pemeriksaan stok harus berupa aktif atau tidak aktif.');
        $eligible=$role==='employee' && $active && $before['registration_status']==='approved';
        if(array_key_exists('can_check_stock',$p) && $canCheck && !$eligible) throw new ApiProblem('Pemeriksa stok harus karyawan aktif yang sudah disetujui.');
        if(!$eligible) $canCheck=false;
        if(($active || $role==='admin') && in_array($before['registration_status'],['pending','rejected'],true)) throw new ApiProblem('Pendaftaran harus disetujui melalui tindakan Setujui pendaftaran.');
        if(!$active && $id===$this->actor['id']) throw new ApiProblem('Anda tidak dapat menonaktifkan akun sendiri.');
        if((!$active || $role!=='admin') && $u['role']==='admin' && $u['active'] && (int)$this->query("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL")->fetchColumn()<=1) throw new ApiProblem('Minimal satu admin harus aktif.');
        try { $this->query('UPDATE users SET name=?,email=?,username=?,target=?,active=?,role=?,password_hash=?,can_check_stock=? WHERE id=?',[$name,$email,$username,$target,(int)$active,$role,$passwordHash,(int)$canCheck,$id]); }
        catch(PDOException $e) { if(($e->errorInfo[1]??null)===1062) throw new ApiProblem('Email atau username sudah digunakan.'); throw $e; }
        if($photoChanged) {
            $profileId='profile_'.substr(hash('sha256',$id),0,32);
            $this->query("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'user_profile',?,NOW(),?) ON DUPLICATE KEY UPDATE data=VALUES(data)",[$profileId,$id,$this->json(['photo'=>$photo])]);
        }
        if(!$active || $passwordChanged || $role!==$u['role']) $this->revokeAccountSessions($id,$id===$this->actor['id'] && $active);
        if($canCheck!==(bool)$u['can_check_stock']) $this->stockCheckAssignment($id,$canCheck);
        $this->audit('user.update','Memperbarui akun pengguna',$before,array_replace($before,['name'=>$name,'email'=>$email,'username'=>$username,'target'=>$target,'active'=>$active,'role'=>$role,'can_check_stock'=>$canCheck,'password_changed'=>$passwordChanged,'photo_changed'=>$photoChanged]));
        if($id===$this->actor['id']) $this->actor=$this->publicUser(array_replace($u,['name'=>$name,'email'=>$email,'username'=>$username,'target'=>$target,'active'=>$active,'role'=>$role,'can_check_stock'=>$canCheck]),false);
    }
    private function accountPassword(array $p,string $field,int $minimum=12,bool $requireConfirmation=true): string {
        $password=$p[$field]??null;
        if(!is_string($password) || mb_strlen($password)<$minimum || strlen($password)>72 || str_contains($password,"\0")) throw new ApiProblem("Kata sandi minimal $minimum karakter dan maksimal 72 byte, tanpa karakter null.");
        if(($requireConfirmation || array_key_exists('password_confirmation',$p)) && (!is_string($p['password_confirmation']??null) || !hash_equals($password,$p['password_confirmation']))) throw new ApiProblem('Konfirmasi kata sandi tidak sama.');
        return $password;
    }
    private function revokeAccountSessions(string $id,bool $keepCurrent=false): void {
        $this->query('DELETE FROM tokens WHERE user_id=?'.($keepCurrent?' AND token_hash<>?':''),$keepCurrent?[$id,$this->authTokenHash]:[$id]);
    }
    private function changeOwnPassword(array $p): void {
        if(array_diff(array_keys($p),['current_password','new_password','password_confirmation'])) throw new ApiProblem('Kolom perubahan kata sandi tidak didukung.');
        $id=$this->actor['id'];
        $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC);
        if($u['is_superadmin']) throw new ApiProblem('Kata sandi superadmin dilindungi dan tidak dapat diubah.');
        $attemptKey=hash('sha256','password-change|'.$id);
        if($this->lockedAttempts($attemptKey)>=10) { $this->db->commit(); throw new ApiProblem('Terlalu banyak percobaan kata sandi. Coba kembali dalam 15 menit.',429); }
        $current=$p['current_password']??null;
        if(!is_string($current) || strlen($current)>200 || !password_verify($current,$u['password_hash'])) {
            $this->query('UPDATE login_attempts SET attempts=attempts+1 WHERE attempt_key=?',[$attemptKey]);
            $this->db->commit();
            throw new ApiProblem('Kata sandi saat ini tidak sesuai.');
        }
        $password=$this->accountPassword($p,'new_password');
        $this->query('UPDATE users SET password_hash=? WHERE id=?',[password_hash($password,PASSWORD_DEFAULT),$id]);
        $this->query('DELETE FROM login_attempts WHERE attempt_key=?',[$attemptKey]);
        $this->revokeAccountSessions($id,true);
        $this->audit('profile.password','Mengganti kata sandi sendiri',null,['id'=>$id,'password_changed'=>true]);
    }
    private function deleteUser(array $p): void {
        $this->admin();
        if(array_diff(array_keys($p),['id','reason'])) throw new ApiProblem('Kolom penghapusan akun tidak didukung.');
        $id=$this->text($p,'id',40,true); $reason=$this->text($p,'reason',500,true);
        $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC);
        if(!$u) throw new ApiProblem('Pengguna tidak ditemukan.',404);
        if($u['is_superadmin']) throw new ApiProblem('Superadmin dilindungi dan tidak dapat dihapus.');
        if($u['role']!=='employee' || $id===$this->actor['id']) throw new ApiProblem('Hanya akun karyawan yang dapat dihapus melalui menu ini.');
        if($u['deleted_at']!==null) throw new ApiProblem('Akun ini sudah dihapus.');
        $pickups=[]; foreach($this->records('pickup',$id,true) as $pickup) $pickups[$pickup['id']]=$pickup;
        foreach($this->carriedQuantities($pickups) as $balance) if($balance['eggs']>0 || $balance['kg']>0) throw new ApiProblem('Karyawan masih membawa telur. Selesaikan penjualan atau kembalikan telur ke gudang sebelum menghapus akun.');
        $before=$this->publicUser($u,false); $deletedAt=date('Y-m-d H:i:s');
        $this->query('UPDATE users SET active=0,deleted_at=?,can_check_stock=0 WHERE id=?',[$deletedAt,$id]);
        if($u['can_check_stock']) $this->stockCheckAssignment($id,false);
        $this->revokeAccountSessions($id);
        $this->audit('user.delete','Menghapus akun karyawan: '.$reason,$before,array_replace($before,['active'=>false,'deleted_at'=>$deletedAt,'can_check_stock'=>false,'reason'=>$reason]));
    }
    private function reviewRegistration(array $p,bool $approved): void {
        if(array_diff(array_keys($p),['id'])) throw new ApiProblem('Kolom persetujuan pendaftaran tidak didukung.');
        $this->admin(); $id=$this->text($p,'id',40,true);
        $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC);
        if(!$u) throw new ApiProblem('Pengguna tidak ditemukan.',404);
        if($u['deleted_at']!==null) throw new ApiProblem('Akun ini sudah dihapus.');
        $r=$this->registrationRecord($id);
        if($u['role']!=='employee' || !$r || !in_array($r['status'],$approved?['pending','rejected']:['pending'],true)) throw new ApiProblem('Pendaftaran ini sudah diproses atau tidak dapat ditinjau.',409);
        $before=$this->publicUser($u,false); $r['status']=$approved?'approved':'rejected'; $r['reviewed_at']=$this->now(); $r['reviewed_by']=$this->actor['id'];
        $this->save('registration',$r); $this->query('UPDATE users SET active=? WHERE id=?',[$approved?1:0,$id]);
        $this->query('DELETE FROM tokens WHERE user_id=?',[$id]);
        $this->audit($approved?'user.approve':'user.reject',($approved?'Menyetujui':'Menolak').' pendaftaran '.$u['name'],$before,array_replace($before,['active'=>$approved,'registration_status'=>$r['status']]));
        if($approved) $this->insert('notification',['user_id'=>$id,'title'=>'Pendaftaran disetujui','message'=>'Selamat bergabung. Admin telah menyetujui akun Anda.','created_at'=>$this->now(),'read'=>false]);
    }
    private function purchaseFeed(array $p): void {
        $this->admin(); $items=$p['items']??null; if(!is_array($items) || count($items)<1 || count($items)>100) throw new ApiProblem('Pembelian harus memiliki 1–100 item.'); $out=[]; $total=0;
        foreach($items as $item) {
            if(!is_array($item)) throw new ApiProblem('Item pakan tidak valid.');
            $feed=$this->text($item,'feed_id',40,true); $this->record('feed',$feed); $qty=$this->number($item,'quantity',0.001,false,1000000); $unit=$this->number($item,'unit_price',1,true,100000000); $sum=round($qty*$unit);
            $out[]=['feed_id'=>$feed,'quantity'=>$qty,'unit_price'=>$unit,'total'=>$sum]; $total+=$sum; $this->stock('feed:'.$feed,0,$qty);
            if(!is_finite($total) || $total>1000000000000) throw new ApiProblem('Total pembelian maksimal Rp1.000.000.000.000.');
        }
        $paid=$this->number($p,'paid',0,true); if($paid>$total) throw new ApiProblem('Pembayaran melebihi total pembelian.');
        $date=$this->date($p);
        $r=$this->insert('feed_purchase',['due_date'=>$this->invoiceDue($p,$date),'payments'=>$paid>0?[$this->invoicePayment('initial',$paid)]:[],'number'=>'PB-'.date('Ymd').'-'.strtoupper(bin2hex(random_bytes(4))),'date'=>$date,'supplier'=>$this->text($p,'supplier',190,true),'items'=>$out,'total'=>$total,'paid'=>$paid,'balance'=>$total-$paid,'notes'=>$this->text($p,'notes'),'created_at'=>$this->now(),'user_id'=>$this->actor['id']]);
        $this->audit('feed.purchase','Mencatat pembelian pakan '.$r['number'],null,$r);
    }
}
