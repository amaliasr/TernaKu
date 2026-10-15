<?php
/** Generate persistent VAPID keys once. The private key is never printed. */
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/vendor/autoload.php';
$target=dirname(__DIR__).'/application/config/push-keys.php';
if(is_file($target)) { fwrite(STDERR,"Web Push keys already exist; keep them to preserve browser subscriptions.\n"); exit(1); }
$subject=getenv('WEB_PUSH_SUBJECT') ?: 'https://ternaku.rstudiohub.com';
if(!preg_match('~^(https://|mailto:).+~D',$subject)) { fwrite(STDERR,"Set a valid WEB_PUSH_SUBJECT.\n"); exit(1); }
$keys=Minishlink\WebPush\VAPID::createVapidKeys(); $keys['subject']=$subject;
$handle=fopen($target,'x');
if(!$handle) { fwrite(STDERR,"Cannot create private Web Push configuration.\n"); exit(1); }
fwrite($handle,"<?php\n// Private server configuration; never commit or publish.\nreturn ".var_export($keys,true).";\n"); fclose($handle); chmod($target,0600);
echo "Web Push keys saved in protected application/config/push-keys.php. No database migration is required.\n";
