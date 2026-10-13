<?php
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try { $p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR); $farm=new FarmService(); $farm->authenticate($p['token']); $farm->command($p['action'],$p['payload']); echo '200'; }
catch(ApiProblem $e) { echo $e->status; }
catch(Throwable $e) { fwrite(STDERR,$e->getMessage()); exit(1); }
