<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once APPPATH.'libraries/FarmService.php';
class Api extends CI_Controller {
    private ?FarmService $farm = null;
    private array $actor = [];
    public function __construct() {
        parent::__construct();
        header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
        $origin=$_SERVER['HTTP_ORIGIN']??''; $allowed=array_filter(array_map('trim',explode(',',getenv('ALLOWED_ORIGINS') ?: 'https://ternaku.rstudiohub.com')));
        header('Vary: Origin');
        if($origin!=='' && !in_array($origin,$allowed,true)) $this->respond(['error'=>'Origin tidak diizinkan.'],403);
        if($origin!=='') header('Access-Control-Allow-Origin: '.$origin);
        header('X-Ternaku-Photo-Upload: multipart'); header('Access-Control-Expose-Headers: X-Ternaku-Photo-Upload');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS'); header('Access-Control-Allow-Headers: Content-Type, Authorization'); header('Access-Control-Max-Age: 600');
        if(($_SERVER['REQUEST_METHOD']??'GET')==='OPTIONS') { http_response_code(204); exit; }
    }
    private function respond(array $body,int $status=200): never { http_response_code($status); echo json_encode($body,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE); exit; }
    private function body(): array {
        if(stripos($_SERVER['CONTENT_TYPE']??'','application/json')!==0) throw new ApiProblem('Gunakan Content-Type application/json.',415);
        if((int)($_SERVER['CONTENT_LENGTH']??0)>3000000) throw new ApiProblem('Ukuran data maksimal 3 MB.',413);
        $raw=file_get_contents('php://input',false,null,0,3000001); if(strlen($raw)>3000000) throw new ApiProblem('Ukuran data maksimal 3 MB.',413);
        return $this->jsonBody($raw);
    }
    private function jsonBody(string $raw): array {
        try { $p=json_decode($raw,true,64,JSON_THROW_ON_ERROR); } catch(Throwable $e) { throw new ApiProblem('JSON tidak valid.',400); }
        if(!is_array($p) || array_is_list($p)) throw new ApiProblem('Body harus berupa objek JSON.',400); return $p;
    }
    private function commandBody(): array {
        $type=strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'',2)[0]));
        if($type!=='multipart/form-data') return $this->body();
        if((int)($_SERVER['CONTENT_LENGTH']??0)>3000000) throw new ApiProblem('Ukuran data maksimal 3 MB.',413);
        $raw=$_POST['command']??null;
        $file=$_FILES['photo']??null;
        if(!is_string($raw) || strlen($raw)>3000000 || !is_array($file) || count($_POST)!==1 || count($_FILES)!==1)
            throw new ApiProblem('Data dan foto harus dikirim bersama.',400);
        $command=$this->jsonBody($raw);
        if(!in_array($command['action']??null,['production.create','sale.create','profile.update','user.update'],true))
            throw new ApiProblem('Perintah ini tidak menerima lampiran foto.',400);
        if(!is_array($command['payload']??null) || ($command['payload']['photo']??null)!=='')
            throw new ApiProblem('Data lampiran foto tidak valid.',400);
        if(in_array($file['error'],[UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE],true) || ($file['size']??0)>1048576)
            throw new ApiProblem('Foto maksimal 1 MB setelah dikompres.',413);
        if($file['error']!==UPLOAD_ERR_OK || !is_string($file['tmp_name']) || !is_uploaded_file($file['tmp_name']))
            throw new ApiProblem('Foto belum selesai diunggah. Silakan coba lagi.',400);
        $mime=$file['type'];
        if(!in_array($mime,['image/jpeg','image/png','image/webp'],true))
            throw new ApiProblem('Foto harus berupa gambar JPEG, PNG, atau WebP.');
        $bytes=file_get_contents($file['tmp_name'],false,null,0,1048577);
        if($bytes===false || $bytes==='') throw new ApiProblem('Foto masih kosong. Silakan pilih kembali.');
        if(strlen($bytes)>1048576) throw new ApiProblem('Foto maksimal 1 MB setelah dikompres.',413);
        // Reconstruct the same payload as JSON clients before idempotency checks and image validation.
        $command['payload']['photo']='data:'.$mime.';base64,'.base64_encode($bytes);
        return $command;
    }
    private function token(): string { $h=$_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??''; return preg_match('/^Bearer ([a-f0-9]{64})$/D',$h,$m)?$m[1]:''; }
    private function run(string $method,bool $auth,callable $fn): void {
        try {
            if(($_SERVER['REQUEST_METHOD']??'GET')!==$method) { header('Allow: '.$method); throw new ApiProblem('Metode tidak diizinkan.',405); }
            $this->farm=new FarmService(); if($auth) $this->actor=$this->farm->authenticate($this->token()); $this->respond(['data'=>$fn()]);
        } catch(ApiProblem $e) { $this->respond(['error'=>$e->getMessage()],$e->status); }
        catch(Throwable $e) { log_message('error',get_class($e).': '.$e->getMessage()); $this->respond(['error'=>'Layanan belum siap atau terjadi kesalahan server. Hubungi admin.'],500); }
    }
    public function health(): void { $this->run('GET',false,fn()=>['status'=>'ok','service'=>'TernaKu API','framework'=>'CodeIgniter 3.1.13','time'=>date('c'),'push_ready'=>PushService::ready()]); }
    public function login(): void { $this->run('POST',false,function(){ $p=$this->body(); if(!in_array($p['response_mode']??'full',['full','compact'],true)) throw new ApiProblem('Format respons tidak valid.'); return $this->farm->login($p,$_SERVER['REMOTE_ADDR']??'unknown',($p['response_mode']??'full')==='compact'); }); }
    public function registration_status(): void { $this->run('GET',false,fn()=>$this->farm->registrationStatus()); }
    public function register(): void { $this->run('POST',false,fn()=>$this->farm->register($this->body(),$_SERVER['REMOTE_ADDR']??'unknown')); }
    public function logout(): void { $this->run('POST',true,function(){ $push=$this->push(); $push->logout($this->actor['id'],$this->token()); $this->farm->logout($this->token()); return ['logged_out'=>true]; }); }
    public function bootstrap(): void { $this->run('GET',true,fn()=>$this->farm->bootstrap(in_array($_GET['compact']??'',['1','true'],true))); }
    public function sync_prices(): void { $this->run('GET',true,function(){ $since=$_GET['since']??null; if($since!==null && (!is_string($since) || !preg_match('/^(0|[1-9][0-9]{0,17})$/D',$since))) throw new ApiProblem('Penanda pembaruan tidak valid.',400); return $this->farm->syncPrices($since); }); }
    public function commands(): void { $this->run('POST',true,function(){ $p=$this->commandBody(); if(!is_string($p['action']??null) || !is_array($p['payload']??null) || !is_string($p['request_id']??'') || !in_array($p['response_mode']??'full',['full','compact'],true)) throw new ApiProblem('Perintah dan payload wajib diisi.'); $receiptRole=$p['receipt_for_role']??null; if($receiptRole!==null && !in_array($receiptRole,['admin','employee'],true)) throw new ApiProblem('Permintaan nota tidak valid.',400); $result=$this->farm->command($p['action'],$p['payload'],$p['request_id']??'',($p['response_mode']??'full')==='compact',$receiptRole); if($p['action']==='price.create' && getenv('PUSH_INLINE_DELIVERY')!=='false') $this->drainPush(); return $result; }); }
    public function media(string $kind='',string $id=''): void { $this->run('GET',true,function() use($kind,$id){
        $media=$this->farm->media($kind,$id); header('Content-Type: '.$media['content_type']); header('Content-Length: '.strlen($media['bytes'])); header('Cache-Control: private, no-store'); header('ETag: "'.$media['version'].'"'); echo $media['bytes']; exit;
    }); }
    private function push(): PushService { return new PushService($this->farm->database()); }
    private function drainPush(): void { try { $this->push()->drain(3,5); } catch(Throwable $e) { log_message('error','Web Push outbox awaits cron retry.'); } }
    public function push_status(): void { $this->run('GET',true,fn()=>$this->push()->status()); }
    public function push_subscribe(): void { $this->run('POST',true,fn()=>$this->push()->subscribe($this->actor['id'],$this->token(),$this->body())); }
    public function push_unsubscribe(): void { $this->run('POST',true,fn()=>$this->push()->unsubscribe($this->actor['id'],$this->body())); }
    public function push_test(): void { $this->run('POST',true,function(){ $result=$this->push()->test($this->actor['id'],$this->body()); $this->drainPush(); return $result; }); }
    public function push_native_subscribe(): void { $this->run('POST',true,fn()=>$this->push()->subscribeNative($this->actor['id'],$this->token(),$this->body())); }
    public function push_native_unsubscribe(): void { $this->run('POST',true,fn()=>$this->push()->unsubscribeNative($this->actor['id'],$this->token(),$this->body())); }
    public function push_native_test(): void { $this->run('POST',true,function(){ $result=$this->push()->testNative($this->actor['id'],$this->token(),$this->body()); $this->drainPush(); return $result; }); }
    public function missing(): void { $this->respond(['error'=>'Endpoint tidak ditemukan.'],404); }
}
