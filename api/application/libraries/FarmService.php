<?php
require_once __DIR__.'/PushService.php';
/** TernaKu transactional domain service; used by CI3 and the CLI installer. */
class ApiProblem extends RuntimeException {
    public int $status;
    public function __construct(string $message, int $status = 422) { parent::__construct($message); $this->status = $status; }
}
class FarmService {
    private PDO $db;
    private array $actor = [];
    private const COLLECTIONS = ['barn'=>'barns','production'=>'productions','pickup'=>'pickups','sale'=>'sales','price'=>'prices','feed'=>'feeds','feed_purchase'=>'feed_purchases','feed_usage'=>'feed_usages','notification'=>'notifications','activity'=>'activity','correction'=>'corrections','stock_movement'=>'stock_movements'];
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
    private function publicUser(array $u): array { return ['id'=>$u['id'],'name'=>$u['name'],'email'=>$u['email'],'role'=>$u['role'],'active'=>(bool)$u['active'],'target'=>(float)$u['target'],'registration_status'=>$this->registrationRecord($u['id'])['status']??'approved']; }
    private function text(array $p, string $key, int $max = 2000, bool $required = false): string {
        $v = $p[$key] ?? '';
        if (!is_string($v)) throw new ApiProblem("Kolom $key harus berupa teks.");
        $v = trim($v);
        if (($required && $v === '') || mb_strlen($v) > $max) throw new ApiProblem("Kolom $key wajib diisi dan maksimal $max karakter.");
        return $v;
    }
    private function number(array $p, string $key, float $minimum = 0, bool $integer = false, float $maximum = 1000000000000): float {
        $v = $p[$key] ?? null;
        if (!is_numeric($v) || is_bool($v) || !is_finite((float)$v) || (float)$v < $minimum || (float)$v > $maximum || ($integer && floor((float)$v) != (float)$v) || (!$integer && abs((float)$v * 1000 - round((float)$v * 1000)) > 0.000001)) throw new ApiProblem("Nilai $key tidak valid (berat maksimal 3 angka desimal).");
        return round((float)$v, $integer ? 0 : 3);
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
    private function quantity(array $p): array { return ['eggs'=>(int)$this->number($p,'eggs',1,true,100000000),'kg'=>$this->number($p,'kg',0.001,false,1000000),'trays'=>(int)$this->number($p+['trays'=>0],'trays',0,true,1000000)]; }
    private function photo(array $p): string {
        $photo = $this->text($p,'photo',1800000);
        if ($photo !== '' && !preg_match('~^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$~D',$photo) && !filter_var($photo,FILTER_VALIDATE_URL)) throw new ApiProblem('Foto harus berupa URL HTTPS atau gambar JPEG, PNG, atau WebP.');
        if ($photo !== '' && strpos($photo,'data:') !== 0 && strpos($photo,'https://') !== 0) throw new ApiProblem('URL foto harus menggunakan HTTPS.');
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
    private function records(string $kind): array { return array_map(fn($r)=>json_decode($r,true,512,JSON_THROW_ON_ERROR),$this->query('SELECT data FROM records WHERE kind=? ORDER BY occurred_at DESC,sequence DESC',[$kind])->fetchAll(PDO::FETCH_COLUMN)); }
    private function save(string $kind, array $r): void { $this->query('UPDATE records SET data=? WHERE id=? AND kind=?',[$this->json($r),$r['id'],$kind]); }
    private function audit(string $action, string $description, $before = null, $after = null): void {
        $this->insert('activity',['user_id'=>$this->actor['id'],'action'=>$action,'description'=>$description,'created_at'=>$this->now(),'before'=>$before,'after'=>$after]);
    }
    private function movement(string $kind,array $record,array $q,string $notes='',?string $date=null): void {
        $this->insert('stock_movement',['date'=>$date ?? $record['date'],'created_at'=>$this->now(),'user_id'=>$record['user_id'],'category'=>$record['category'],'kind'=>$kind,'reference_id'=>$record['id'],'eggs'=>$q['eggs'],'kg'=>$q['kg'],'trays'=>$q['trays'],'notes'=>$notes]);
    }
    private function stock(string $key, int $eggs, float $kg, int $trays = 0): void {
        $r=$this->query('SELECT eggs,kg,trays FROM stock WHERE stock_key=? FOR UPDATE',[$key])->fetch(PDO::FETCH_ASSOC);
        if (!$r) throw new ApiProblem('Stok tidak ditemukan.',404);
        $newEggs=(int)$r['eggs']+$eggs; $newKg=round((float)$r['kg']+$kg,3); $newTrays=(int)$r['trays']+$trays;
        if ($newEggs<0 || $newKg<0) throw new ApiProblem('Stok tidak mencukupi. Periksa jumlah butir dan berat aktual.');
        if (strpos($key,'egg:')===0 && (($newEggs===0) !== ($newKg==0))) throw new ApiProblem('Sisa jumlah butir dan berat harus sama-sama habis atau sama-sama masih tersedia. Periksa berat aktual.');
        // Tray count is informational: employees may re-pack trays without changing egg stock.
        $this->query('UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key=?',[$newEggs,$newKg,max(0,$newTrays),$key]);
    }
    public function authenticate(string $token): array {
        if (!preg_match('/^[a-f0-9]{64}$/D',$token)) throw new ApiProblem('Silakan masuk terlebih dahulu.',401);
        $u=$this->query('SELECT u.* FROM users u JOIN tokens t ON t.user_id=u.id WHERE t.token_hash=? AND t.expires_at>NOW() AND u.active=1',[hash('sha256',$token)])->fetch(PDO::FETCH_ASSOC);
        if (!$u || ($this->registrationRecord($u['id'])['status']??'approved')!=='approved') throw new ApiProblem('Sesi berakhir atau akun belum disetujui/nonaktif. Silakan masuk kembali.',401);
        return $this->actor=$this->publicUser($u);
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
        if(array_diff(array_keys($p),['name','email','password','password_confirmation','setup_token'])) throw new ApiProblem('Kolom pendaftaran tidak didukung. Peran dan status ditentukan oleh sistem.');
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
            $this->query('INSERT INTO users(id,name,email,password_hash,role,active,target) VALUES(?,?,?,?,?,?,0)',[$id,$name,$email,$hash,$role,$active]);
            $r=$this->insert('registration',['user_id'=>$id,'status'=>$first?'approved':'pending','created_at'=>$this->now(),'reviewed_at'=>$first?$this->now():null,'reviewed_by'=>$first?$id:null]);
            $this->actor=['id'=>$id,'name'=>$name,'email'=>$email,'role'=>$role,'active'=>(bool)$active,'target'=>0,'registration_status'=>$r['status']];
            $this->audit($first?'auth.setup':'auth.register',$first?'Membuat admin pertama':'Mendaftar sebagai karyawan; menunggu persetujuan admin',null,$this->actor);
            if($first) {
                if(!$this->query("SELECT id FROM records WHERE kind='barn' LIMIT 1")->fetchColumn()) $this->insert('barn',['name'=>'Kandang Ayam Utama','type'=>'ayam','capacity'=>0,'notes'=>'Sumber produksi awal; kelola sesuai kondisi peternakan.']);
            } else {
                foreach($this->query("SELECT id FROM users WHERE role='admin' AND active=1")->fetchAll(PDO::FETCH_COLUMN) as $uid) $this->insert('notification',['user_id'=>$uid,'title'=>'Pendaftaran karyawan baru','message'=>$name.' ('.$email.') menunggu persetujuan. Buka menu Karyawan untuk meninjau.','created_at'=>$this->now(),'read'=>false]);
            }
            $this->db->commit();
            return ['status'=>$first?'active':'pending','message'=>$first?'Admin pertama berhasil dibuat. Silakan masuk.':'Pendaftaran berhasil. Akun Anda menunggu persetujuan admin.'];
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    public function login(array $p, string $ip): array {
        $email=strtolower($this->text($p,'email',190,true)); $password=$p['password']??'';
        if(!is_string($password) || strlen($password)>200 || $password==='') throw new ApiProblem('Kata sandi wajib diisi.');
        $key=hash('sha256',$ip.'|'.$email);
        return $this->authTransaction(function() use($email,$password,$key): array {
            $a=$this->lockedAttempts($key);
            if ((int)$a>=10) { $this->db->commit(); throw new ApiProblem('Terlalu banyak percobaan. Coba kembali dalam 15 menit.',429); }
            $this->query('UPDATE login_attempts SET attempts=attempts+1 WHERE attempt_key=?',[$key]);
            $u=$this->query('SELECT * FROM users WHERE email=?',[$email])->fetch(PDO::FETCH_ASSOC);
            $valid=password_verify($password,$u['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
            if (!$u || !$valid) { $this->db->commit(); throw new ApiProblem('Email atau kata sandi salah, atau akun tidak aktif.',401); }
            $registration=$this->registrationRecord($u['id']);
            if (!$u['active'] || ($registration['status']??'approved')!=='approved') {
                $this->db->commit();
                if(($registration['status']??'')==='pending') throw new ApiProblem('Akun Anda masih menunggu persetujuan admin.',403);
                if(($registration['status']??'')==='rejected') throw new ApiProblem('Pendaftaran belum disetujui. Hubungi admin peternakan.',403);
                throw new ApiProblem('Email atau kata sandi salah, atau akun tidak aktif.',401);
            }
            $this->query('DELETE FROM login_attempts WHERE attempt_key=?',[$key]);
            $this->query('DELETE FROM tokens WHERE expires_at<=NOW()');
            $token=bin2hex(random_bytes(32)); $ttl=max(1,min(168,(int)(getenv('TOKEN_TTL_HOURS') ?: 12)));
            $this->query('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,?)',[hash('sha256',$token),$u['id'],date('Y-m-d H:i:s',time()+$ttl*3600)]);
            $this->actor=$this->publicUser($u); $this->audit('auth.login','Masuk ke aplikasi');
            $this->db->commit(); return ['token'=>$token,'user'=>$this->actor];
        });
    }
    public function logout(string $token): void {
        $this->db->beginTransaction();
        try { $this->query('DELETE FROM tokens WHERE token_hash=?',[hash('sha256',$token)]); $this->audit('auth.logout','Keluar dari aplikasi'); $this->db->commit(); }
        catch (Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    public function bootstrap(): array {
        $this->db->beginTransaction();
        try { $state = $this->readState(); $this->db->commit(); return $state; }
        catch (Throwable $e) { $this->db->rollBack(); throw $e; }
    }
    private function readState(): array {
        $admin=$this->actor['role']==='admin'; $state=[];
        foreach (self::COLLECTIONS as $kind=>$collection) {
            $r=$this->records($kind);
            if ($kind==='notification' || (!$admin && in_array($kind,['production','pickup','sale','correction','stock_movement'],true))) $r=array_values(array_filter($r,fn($i)=>($i['user_id']??'')===$this->actor['id']));
            if (!$admin && $kind==='activity') $r=[];
            // Feed purchasing costs/suppliers are management data; stock remains shared below.
            if (!$admin && $kind==='feed_purchase') $r=[];
            if (!$admin && $kind==='feed_usage') $r=array_values(array_filter($r,fn($i)=>$i['user_id']===$this->actor['id']));
            $state[$collection]=$r;
        }
        $state['users']=array_map(fn($u)=>$this->publicUser($u),$this->query('SELECT * FROM users'.($admin?'':' WHERE id='.$this->db->quote($this->actor['id'])).' ORDER BY name')->fetchAll(PDO::FETCH_ASSOC));
        $state['inventory']=[]; $state['feed_inventory']=[];
        foreach($this->query('SELECT * FROM stock')->fetchAll(PDO::FETCH_ASSOC) as $s) {
            if (strpos($s['stock_key'],'egg:')===0) $state['inventory'][substr($s['stock_key'],4)]=['eggs'=>(int)$s['eggs'],'kg'=>(float)$s['kg'],'trays'=>(int)$s['trays']];
            else $state['feed_inventory'][substr($s['stock_key'],5)]=(float)$s['kg'];
        }
        return $state;
    }
    private function pickupBalance(array $p,?string $excludeSale = null): array {
        $q=['eggs'=>$p['eggs']-$p['returned_eggs'],'kg'=>round($p['kg']-$p['returned_kg'],3),'trays'=>$p['trays']-$p['returned_trays']];
        foreach($this->records('sale') as $sale) if($sale['id']!==$excludeSale) foreach($sale['items'] as $i) if($i['pickup_id']===$p['id']) foreach(['eggs','kg','trays'] as $k) $q[$k]=round($q[$k]-$i[$k],3);
        return $q;
    }
    private function checkBalance(array $q,array $b): void {
        if($q['eggs']>$b['eggs'] || round($q['kg']-$b['kg'],3)>0) throw new ApiProblem('Jumlah melebihi sisa telur yang dibawa. Periksa butir dan kilogram.');
        if((($b['eggs']-$q['eggs'])==0) !== (round($b['kg']-$q['kg'],3)==0)) throw new ApiProblem('Sisa jumlah butir dan berat harus sama-sama habis atau sama-sama masih tersedia. Periksa berat aktual.');
    }
    private function currentPrice(): array {
        $prices=array_values(array_filter($this->records('price'),fn($p)=>strtotime($p['effective_at'])<=time()));
        usort($prices,fn($a,$b)=>strtotime($b['effective_at'])<=>strtotime($a['effective_at']) ?: strcmp($b['created_at'],$a['created_at']));
        if (!$prices) throw new ApiProblem('Admin belum menetapkan harga yang berlaku saat ini.');
        return $prices[0];
    }
    private function reason(array $p): string { $reason=$this->text($p,'reason',1000,true); if(mb_strlen($reason)<5) throw new ApiProblem('Alasan koreksi minimal 5 karakter.'); return $reason; }
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
            $out[$key]=in_array($key,['eggs','kg','trays'],true)?$this->number([$key=>$value],$key,$key==='trays'?0:($key==='kg'?0.001:1),$key!=='kg'):$this->text([$key=>$value],$key,$key==='notes'?2000:190);
        } return $out;
    }
    private function applyCorrection(string $entity,string $id,string $reason,array $changes,bool $review=false): void {
        $r=$this->record($entity,$id,true); $this->owned($r);
        if($this->actor['role']!=='admin' && ($entity!=='production' || $r['locked'])) throw new ApiProblem('Data ini harus dikoreksi melalui persetujuan admin.',403);
        $changes=$this->changes($entity,$changes); $updated=array_replace($r,$changes);
        if($entity==='production') {
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
            $newItems=[]; $reserved=[]; $total=0;
            foreach($r['items'] as $item) {
                if(!isset($quantities[$item['id']])) throw new ApiProblem('ID item koreksi tidak cocok dengan penjualan.');
                $newItem=array_replace($item,$quantities[$item['id']]); $newItem['total']=round($newItem['kg']*$item['unit_price']); $total+=$newItem['total'];
                if(!is_finite($total) || $total>1000000000000) throw new ApiProblem('Total transaksi maksimal Rp1.000.000.000.000.');
                $pid=$item['pickup_id']; $used=$reserved[$pid]??['eggs'=>0,'kg'=>0]; $reserved[$pid]=['eggs'=>$used['eggs']+$newItem['eggs'],'kg'=>round($used['kg']+$newItem['kg'],3)]; $newItems[]=$newItem;
            }
            foreach($reserved as $pid=>$q) $this->checkBalance($q,$this->pickupBalance($this->record('pickup',$pid,true),$r['id']));
            if($total<$r['paid']) throw new ApiProblem('Total koreksi lebih kecil dari pembayaran yang sudah diterima. Pengembalian uang/refund belum didukung.');
            $updated['items']=$newItems; $updated['total']=$total; $updated['balance']=$total-$r['paid']; $updated['payment_status']=$r['paid']==$total?'paid':($r['paid']>0?'partial':'unpaid');
        }
        if($entity==='sale' && array_filter($updated['items'],fn($item)=>$item['category']==='cracked' && $item['unit_price']==0)) $this->text($updated,'customer',190,true);
        $this->save($entity,$updated); $this->audit('correction.apply',$reason,$r,$updated);
    }
    public function command(string $action,array $p,string $requestId = ''): array {
        if($requestId !== '' && !preg_match('/^[A-Za-z0-9_-]{8,80}$/D',$requestId)) throw new ApiProblem('ID permintaan tidak valid.');
        $fingerprint=hash('sha256',$this->json([$action,$p]));
        $this->db->beginTransaction();
        try {
            // A short command mutex keeps cross-document invariants deterministic; stock/pickups
            // are additionally row-locked. Suitable for this farm-scale workload.
            $this->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
            $active=$this->query('SELECT active,role FROM users WHERE id=?',[$this->actor['id']])->fetch(PDO::FETCH_ASSOC);
            if(!$active || !$active['active'] || ($this->registrationRecord($this->actor['id'])['status']??'approved')!=='approved') throw new ApiProblem('Akun belum disetujui atau tidak aktif.',401);
            $this->actor['role']=$active['role'];
            if($requestId!=='') {
                $old=$this->query('SELECT fingerprint FROM command_requests WHERE user_id=? AND request_id=?',[$this->actor['id'],$requestId])->fetchColumn();
                if($old) {
                    if(!hash_equals($old,$fingerprint)) throw new ApiProblem('ID permintaan sudah digunakan untuk perubahan berbeda.',409);
                    $this->db->commit(); return $this->bootstrap();
                }
            }
            $this->dispatch($action,$p);
            if($requestId!=='') $this->query('INSERT INTO command_requests(user_id,request_id,fingerprint) VALUES(?,?,?)',[$this->actor['id'],$requestId,$fingerprint]);
            $this->query('UPDATE command_mutex SET version=version+1 WHERE id=1');
            $this->db->commit(); return $this->bootstrap();
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    private function dispatch(string $action,array $p): void {
        switch($action) {
            case 'production.create':
                $q=$this->quantity($p); $category=$this->enum($p,'category',['good','cracked']);
                $barn=$this->text($p,'barn_id',40); if($barn!=='') $this->record('barn',$barn);
                $r=$this->insert('production',$q+['date'=>$this->date($p),'user_id'=>$this->actor['id'],'barn_id'=>$barn,'category'=>$category,'notes'=>$this->text($p,'notes'),'photo'=>$this->photo($p),'location'=>$this->text($p,'location',190),'created_at'=>$this->now(),'locked'=>false]);
                $this->stock('egg:'.$category,$q['eggs'],$q['kg'],$q['trays']); $this->movement('production',$r,$q,$r['notes']); $this->audit($action,'Mencatat produksi telur',null,$r); break;
            case 'pickup.create':
                $q=$this->quantity($p); $category=$this->enum($p,'category',['good','cracked']);
                $this->stock('egg:'.$category,-$q['eggs'],-$q['kg'],-$q['trays']);
                $r=$this->insert('pickup',$q+['date'=>$this->date($p),'user_id'=>$this->actor['id'],'category'=>$category,'area'=>$this->text($p,'area',190),'notes'=>$this->text($p,'notes'),'returned_eggs'=>0,'returned_kg'=>0,'returned_trays'=>0,'created_at'=>$this->now(),'locked'=>false]);
                $this->movement('pickup',$r,['eggs'=>-$q['eggs'],'kg'=>-$q['kg'],'trays'=>-$q['trays']],$r['notes']); $this->audit($action,'Mengambil telur untuk dijual',null,$r); break;
            case 'pickup.return':
                $r=$this->record('pickup',$this->text($p,'id',40,true),true); $this->owned($r); $q=$this->quantity($p); $this->checkBalance($q,$this->pickupBalance($r));
                foreach(['eggs','kg','trays'] as $k) $r['returned_'.$k]=round($r['returned_'.$k]+$q[$k],3);
                $this->stock('egg:'.$r['category'],$q['eggs'],$q['kg'],$q['trays']); $this->save('pickup',$r);
                $this->movement('return',$r,$q,$this->text($p,'notes'),$this->now());
                $this->audit($action,'Mengembalikan telur: '.$this->text($p,'notes'),null,['pickup_id'=>$r['id'],'quantity'=>$q]); break;
            case 'sale.create': $this->createSale($p); break;
            case 'sale.payment':
                $r=$this->record('sale',$this->text($p,'id',40,true),true); $this->owned($r); $amount=$this->number($p,'amount',1,true);
                if($amount>$r['balance']) throw new ApiProblem('Pembayaran melebihi sisa tagihan.');
                $before=$r; $r['paid']+=$amount; $r['balance']=$r['total']-$r['paid']; $r['payment_status']=$r['balance']===0.0 || $r['balance']===0?'paid':'partial';
                $this->save('sale',$r); $this->audit($action,'Mencatat pembayaran penjualan',$before,$r); break;
            case 'price.create':
                $this->admin(); $effective=$this->date($p,'effective_at');
                $r=$this->insert('price',['good_price'=>$this->number($p,'good_price',1,true,10000000),'cracked_price'=>$this->number($p,'cracked_price',0,true,10000000),'effective_at'=>$effective,'created_at'=>$this->now(),'created_by'=>$this->actor['id']]);
                foreach($this->query('SELECT id FROM users WHERE active=1')->fetchAll(PDO::FETCH_COLUMN) as $uid) $this->insert('notification',['user_id'=>$uid,'title'=>'Harga telur diperbarui','message'=>'Mulai '.date('d/m/Y H:i',strtotime($effective)).' WIB: telur bagus Rp'.number_format($r['good_price'],0,',','.').'/kg dan telur bentes '.($r['cracked_price']==0?'Gratis':'Rp'.number_format($r['cracked_price'],0,',','.').'/kg').'.','created_at'=>$this->now(),'read'=>false]);
                (new PushService($this->db))->enqueuePrice($r);
                $this->audit($action,'Menetapkan harga telur',null,$r); break;
            case 'user.create': $this->createUser($p); break;
            case 'user.update': $this->updateUser($p); break;
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
                $id=$this->text($p,'id',40,true); $list=$id==='all'?$this->records('notification'):[$this->record('notification',$id,true)];
                $count=0; foreach($list as $r) { if($r['user_id']!==$this->actor['id']) { if($id==='all') continue; throw new ApiProblem('Notifikasi bukan milik Anda.',403); } if(!$r['read']) { $r['read']=true; $this->save('notification',$r); $count++; } }
                if($count>0) $this->audit($action,'Menandai '.$count.' notifikasi sebagai dibaca'); break;
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
    private function createSale(array $p): void {
        $items=$p['items']??null; if(!is_array($items) || count($items)<1 || count($items)>100) throw new ApiProblem('Transaksi harus berisi 1–100 item.');
        $price=$this->currentPrice();
        if(isset($p['expected_price_id']) && $this->text($p,'expected_price_id',40,true)!==$price['id']) throw new ApiProblem('Harga telur berubah. Periksa harga terbaru lalu simpan kembali.',409);
        $out=[]; $total=0; $reserved=[];
        foreach($items as $item) {
            if(!is_array($item)) throw new ApiProblem('Item tidak valid.');
            $pickup=$this->record('pickup',$this->text($item,'pickup_id',40,true),true); $this->ownOnly($pickup);
            $category=$this->enum($item,'category',['good','cracked']); if($category!==$pickup['category']) throw new ApiProblem('Kategori penjualan berbeda dengan telur yang diambil.');
            $q=$this->quantity($item); $bal=$this->pickupBalance($pickup); $id=$pickup['id'];
            $used=$reserved[$id]??['eggs'=>0,'kg'=>0]; $this->checkBalance(['eggs'=>$q['eggs']+$used['eggs'],'kg'=>round($q['kg']+$used['kg'],3)],$bal); $reserved[$id]=['eggs'=>$q['eggs']+$used['eggs'],'kg'=>round($q['kg']+$used['kg'],3)];
            if(array_key_exists('is_free',$item) && !is_bool($item['is_free'])) throw new ApiProblem('Pilihan gratis tidak valid.');
            if(($item['is_free']??false) && $category!=='cracked') throw new ApiProblem('Hanya telur bentes yang boleh diberikan gratis.');
            $free=$category==='cracked' && (($item['is_free']??false) || $price['cracked_price']==0);
            $unit=$free?0:$price[$category==='good'?'good_price':'cracked_price']; $itemTotal=round($q['kg']*$unit);
            $out[]=$q+['id'=>$this->id('item'),'pickup_id'=>$id,'category'=>$category,'unit_price'=>$unit,'is_free'=>$free,'total'=>$itemTotal]; $total+=$itemTotal;
            if(!is_finite($total) || $total>1000000000000) throw new ApiProblem('Total transaksi maksimal Rp1.000.000.000.000.');
        }
        $paid=$this->number($p,'paid',0,true); if($paid>$total) throw new ApiProblem('Nominal pembayaran melebihi total transaksi.');
        $hasFree=(bool)array_filter($out,fn($item)=>$item['is_free']);
        $customer=$this->text($p,'customer',190); if($hasFree && $customer==='') throw new ApiProblem('Nama penerima telur gratis wajib diisi.');
        $method=$this->enum($p,'payment_method',['cash','transfer','qris','credit']);
        $r=$this->insert('sale',['number'=>'TK-'.date('Ymd').'-'.strtoupper(bin2hex(random_bytes(4))),'date'=>$this->date($p),'user_id'=>$this->actor['id'],'customer'=>$customer,'phone'=>$this->text($p,'phone',40),'items'=>$out,'total'=>$total,'paid'=>$paid,'balance'=>$total-$paid,'payment_method'=>$total==0?'cash':$method,'payment_status'=>$paid==$total?'paid':($paid>0?'partial':'unpaid'),'notes'=>$this->text($p,'notes'),'photo'=>$this->photo($p),'created_at'=>$this->now(),'locked'=>true]);
        $this->audit('sale.create','Mencatat penjualan '.$r['number'],null,$r);
    }
    private function createUser(array $p): void {
        $this->admin(); $email=strtolower($this->text($p,'email',190,true)); if(!filter_var($email,FILTER_VALIDATE_EMAIL)) throw new ApiProblem('Format email tidak valid.');
        $password=$this->text($p,'password',200,true); if(mb_strlen($password)<10) throw new ApiProblem('Kata sandi minimal 10 karakter.');
        if($this->query('SELECT id FROM users WHERE email=?',[$email])->fetchColumn()) throw new ApiProblem('Email sudah digunakan.');
        $id=$this->id('user'); $name=$this->text($p,'name',120,true); $role=$this->enum($p,'role',['admin','employee']); $target=$this->number($p+['target'=>0],'target',0,true);
        $this->query('INSERT INTO users(id,name,email,password_hash,role,target) VALUES(?,?,?,?,?,?)',[$id,$name,$email,password_hash($password,PASSWORD_DEFAULT),$role,$target]);
        $this->audit('user.create','Membuat akun karyawan',null,['id'=>$id,'name'=>$name,'email'=>$email,'role'=>$role,'target'=>$target]);
    }
    private function updateUser(array $p): void {
        if(array_diff(array_keys($p),['id','name','target','active'])) throw new ApiProblem('Kolom perubahan akun tidak didukung.');
        $this->admin(); $id=$this->text($p,'id',40,true); $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC); if(!$u) throw new ApiProblem('Pengguna tidak ditemukan.',404);
        $before=$this->publicUser($u); $name=isset($p['name'])?$this->text($p,'name',120,true):$u['name']; $target=isset($p['target'])?$this->number($p,'target',0,true):(float)$u['target']; $active=isset($p['active'])?$p['active']:(bool)$u['active'];
        if(!is_bool($active)) throw new ApiProblem('Status aktif tidak valid.');
        if($active && in_array($before['registration_status'],['pending','rejected'],true)) throw new ApiProblem('Pendaftaran harus disetujui melalui tindakan Setujui pendaftaran.');
        if(!$active && $id===$this->actor['id']) throw new ApiProblem('Anda tidak dapat menonaktifkan akun sendiri.');
        if(!$active && $u['role']==='admin' && (int)$this->query("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1")->fetchColumn()<=1) throw new ApiProblem('Minimal satu admin harus aktif.');
        $this->query('UPDATE users SET name=?,target=?,active=? WHERE id=?',[$name,$target,(int)$active,$id]);
        if(!$active) $this->query('DELETE FROM tokens WHERE user_id=?',[$id]);
        $this->audit('user.update','Memperbarui akun karyawan',$before,array_replace($before,['name'=>$name,'target'=>$target,'active'=>$active]));
    }
    private function reviewRegistration(array $p,bool $approved): void {
        if(array_diff(array_keys($p),['id'])) throw new ApiProblem('Kolom persetujuan pendaftaran tidak didukung.');
        $this->admin(); $id=$this->text($p,'id',40,true);
        $u=$this->query('SELECT * FROM users WHERE id=? FOR UPDATE',[$id])->fetch(PDO::FETCH_ASSOC);
        if(!$u) throw new ApiProblem('Pengguna tidak ditemukan.',404);
        $r=$this->registrationRecord($id);
        if($u['role']!=='employee' || !$r || !in_array($r['status'],$approved?['pending','rejected']:['pending'],true)) throw new ApiProblem('Pendaftaran ini sudah diproses atau tidak dapat ditinjau.',409);
        $before=$this->publicUser($u); $r['status']=$approved?'approved':'rejected'; $r['reviewed_at']=$this->now(); $r['reviewed_by']=$this->actor['id'];
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
        $r=$this->insert('feed_purchase',['number'=>'PB-'.date('Ymd').'-'.strtoupper(bin2hex(random_bytes(4))),'date'=>$this->date($p),'supplier'=>$this->text($p,'supplier',190,true),'items'=>$out,'total'=>$total,'paid'=>$paid,'balance'=>$total-$paid,'notes'=>$this->text($p,'notes'),'created_at'=>$this->now(),'user_id'=>$this->actor['id']]);
        $this->audit('feed.purchase','Mencatat pembelian pakan '.$r['number'],null,$r);
    }
}
