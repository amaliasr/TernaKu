<?php
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use Jose\Component\Core\AlgorithmManager;
use Jose\Component\KeyManagement\JWKFactory;
use Jose\Component\Signature\Algorithm\ES256;
use Jose\Component\Signature\Algorithm\RS256;
use Jose\Component\Signature\JWSBuilder;
use Jose\Component\Signature\Serializer\CompactSerializer;

/** Provider credentials are loaded only from private files on the API host. */
final class NativePushTransport {
    private ?ClientInterface $client;
    public function __construct(?ClientInterface $client=null) { $this->client=$client; }

    private static function file(string $variable): ?string {
        $path=getenv($variable);
        if(!$path || !is_file($path) || !is_readable($path)) return null;
        $contents=@file_get_contents($path,false,null,0,65537);
        return is_string($contents) && strlen($contents)<=65536 ? $contents : null;
    }
    private static function config(string $platform): ?array {
        if($platform==='android') {
            $account=json_decode(self::file('FCM_SERVICE_ACCOUNT_FILE')??'',true);
            if(!is_array($account) || ($account['type']??'')!=='service_account' ||
                !preg_match('/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/D',$account['project_id']??'') ||
                !filter_var($account['client_email']??'',FILTER_VALIDATE_EMAIL)) return null;
            $config=['project'=>$account['project_id'],'email'=>$account['client_email'],'key'=>$account['private_key']??''];
        } elseif($platform==='ios') {
            $config=['key'=>self::file('APNS_PRIVATE_KEY_FILE'),'keyId'=>getenv('APNS_KEY_ID'),'team'=>getenv('APNS_TEAM_ID'),'bundle'=>getenv('APNS_BUNDLE_ID') ?: 'com.rstudiohub.ternaku'];
            if(!preg_match('/^[A-Z0-9]{10}$/D',(string)$config['keyId']) || !preg_match('/^[A-Z0-9]{10}$/D',(string)$config['team']) ||
                !preg_match('/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/D',$config['bundle']) ||
                !defined('CURL_VERSION_HTTP2') || !(curl_version()['features'] & CURL_VERSION_HTTP2)) return null;
        } else return null;
        if(!is_string($config['key']) || !($private=@openssl_pkey_get_private($config['key']))) return null;
        $details=openssl_pkey_get_details($private);
        if($platform==='android' ? ($details['type']??-1)!==OPENSSL_KEYTYPE_RSA : ($details['ec']['curve_name']??'')!=='prime256v1') return null;
        return $config;
    }
    public static function ready(string $platform): bool {
        $vendor=dirname(__DIR__,2).'/vendor/autoload.php';
        if(!extension_loaded('curl') || !extension_loaded('openssl') || !is_file($vendor)) return false;
        require_once $vendor;
        return class_exists(Client::class) && class_exists(JWKFactory::class) && self::config($platform)!==null;
    }
    public static function status(): array { return ['android'=>self::ready('android'),'ios'=>self::ready('ios')]; }

    private function http(): ClientInterface {
        return $this->client ??= new Client(['allow_redirects'=>false,'http_errors'=>false,'connect_timeout'=>2,'timeout'=>4,'proxy'=>'']);
    }
    private static function jwt(array $claims,array $headers,string $key): string {
        $algorithm=$headers['alg']==='ES256' ? new ES256() : new RS256();
        $signer=new JWSBuilder(new AlgorithmManager([$algorithm]));
        $signed=$signer->create()->withPayload(json_encode($claims,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES))
            ->addSignature(JWKFactory::createFromKey($key),$headers)->build();
        return (new CompactSerializer())->serialize($signed,0);
    }
    /** Reuse short-lived provider tokens across worker invocations; never cache device tokens. */
    private static function cachedToken(array $config,callable $create): string {
        $owner=function_exists('posix_geteuid')?(string)posix_geteuid():PHP_SAPI;
        $name=hash('sha256',$owner.json_encode($config,JSON_THROW_ON_ERROR));
        $path=sys_get_temp_dir().'/ternaku-push-'.$name;
        $old=umask(0077);
        try { $file=fopen($path,'c+'); } finally { umask($old); }
        if(!$file) throw new RuntimeException('Cannot open private push credentials cache.');
        try {
            if(!flock($file,LOCK_EX)) throw new RuntimeException('Cannot lock private push credentials cache.');
            $cached=json_decode(stream_get_contents($file),true);
            if(($cached['expires']??0)>time()+60 && !empty($cached['token'])) return $cached['token'];
            [$token,$expires]=$create();
            rewind($file);
            ftruncate($file,0);
            fwrite($file,json_encode(['token'=>$token,'expires'=>$expires],JSON_THROW_ON_ERROR));
            fflush($file);
            return $token;
        } finally { fclose($file); }
    }
    private function googleToken(array $config): string {
        return self::cachedToken($config,function()use($config){
            $now=time();
            $endpoint='https://oauth2.googleapis.com/token';
            $assertion=self::jwt(['iss'=>$config['email'],'scope'=>'https://www.googleapis.com/auth/firebase.messaging','aud'=>$endpoint,'iat'=>$now,'exp'=>$now+3600],['alg'=>'RS256','typ'=>'JWT'],$config['key']);
            $response=$this->http()->request('POST',$endpoint,['form_params'=>['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$assertion]]);
            $body=json_decode((string)$response->getBody(),true);
            if($response->getStatusCode()!==200 || empty($body['access_token']) || (int)($body['expires_in']??0)<=60) throw new RuntimeException('Google push authentication failed.');
            return [$body['access_token'],$now+min(3600,(int)$body['expires_in'])];
        });
    }
    public function send(array $device,array $payload): array {
        if(!self::ready($device['platform'])) throw new RuntimeException('Native push provider unavailable.');
        $config=self::config($device['platform']);
        if(!$config) throw new RuntimeException('Native push provider unavailable.');
        if($device['platform']==='android') {
            $data=array_map('strval',$payload);
            // Notification messages are always collapsible. The Android service
            // posts each distinct data-only price event to its high-importance channel.
            $message=['token'=>$device['token'],'data'=>$data,'android'=>['priority'=>'HIGH','ttl'=>'604800s','restricted_package_name'=>'com.rstudiohub.ternaku']];
            $response=$this->http()->request('POST','https://fcm.googleapis.com/v1/projects/'.$config['project'].'/messages:send',[
                'headers'=>['Authorization'=>'Bearer '.$this->googleToken($config)],'json'=>['message'=>$message]]);
            $body=json_decode((string)$response->getBody(),true);
            $expired=in_array('UNREGISTERED',array_column($body['error']['details']??[],'errorCode'),true);
        } else {
            $bearer=self::cachedToken($config,function()use($config){
                $now=time();
                return [self::jwt(['iss'=>$config['team'],'iat'=>$now],['alg'=>'ES256','kid'=>$config['keyId']],$config['key']),$now+3000];
            });
            $host=$device['environment']==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com';
            $response=$this->http()->request('POST','https://'.$host.'/3/device/'.$device['token'],[
                'version'=>2.0,'headers'=>['authorization'=>'bearer '.$bearer,'apns-topic'=>$config['bundle'],'apns-push-type'=>'alert','apns-priority'=>'10',
                    'apns-expiration'=>(string)(time()+604800),'apns-collapse-id'=>substr($payload['tag'],0,64)],
                'json'=>$payload+['aps'=>['alert'=>['title'=>$payload['title'],'body'=>$payload['body']],'sound'=>'default']]]);
            $body=json_decode((string)$response->getBody(),true);
            $expired=$response->getStatusCode()===410 || ($body['reason']??null)==='BadDeviceToken';
        }
        $status=$response->getStatusCode();
        return ['success'=>$status===200,'expired'=>$expired,'status'=>$status];
    }
}
