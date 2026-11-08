<?php
// Included only by integration.php, which requires an explicitly disposable test database.
resetTestDatabase();
$db->exec('ALTER TABLE users DROP COLUMN can_check_stock');
StockCheckSchema::migrate($db); StockCheckSchema::migrate($db);
check((int)$db->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='can_check_stock'")->fetchColumn()===1,'stock-check migration upgrades a legacy schema idempotently');
$scHash=password_hash('StockCheckFixture42',PASSWORD_DEFAULT); $scTokens=[];
foreach(['sc_admin'=>'admin','sc_a'=>'employee','sc_b'=>'employee','sc_c'=>'employee','sc_d'=>'employee','sc_normal'=>'employee','sc_lifecycle'=>'employee'] as $id=>$role) {
    $db->prepare('INSERT INTO users(id,name,email,username,password_hash,role) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@test.local',$id,$scHash,$role]);
    $scTokens[$id]=bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))')->execute([hash('sha256',$scTokens[$id]),$id]);
}
$sa=$scTokens['sc_admin']; $ca=$scTokens['sc_a']; $cb=$scTokens['sc_b']; $cc=$scTokens['sc_c']; $cd=$scTokens['sc_d']; $sn=$scTokens['sc_normal'];
$day=date('Y-m-d'); $yesterday=date('Y-m-d',strtotime('-1 day')); $oldDay=date('Y-m-d',strtotime('-30 days')); $edgeDay=date('Y-m-d',strtotime('-29 days'));
function scState(string $token): array { return req('/bootstrap?compact=1',[],$token,'GET'); }
function scPending(string $token,array $warehouseChanges=[],array $harvestChanges=[]): array {
    $ctx=scState($token)['stock_check_context'];
    $warehouse=array_replace_recursive($ctx['warehouse'],$warehouseChanges);
    $harvest=array_replace_recursive($ctx['harvest'],$harvestChanges);
    return ['schema_version'=>2,'date'=>$ctx['date'],'expected_snapshot'=>$ctx['snapshot'],'status'=>'pending','warehouse_actual'=>$warehouse,'harvest_actual'=>$harvest,'reason'=>'Hasil hitung fisik berbeda'];
}
function scLatest(array $state,string $userId): array { return first($state,'stock_checks',fn($r)=>$r['user_id']===$userId && $r['status']!=='superseded'); }
function scWorkers(array $jobs): array {
    $workers=[];
    foreach($jobs as $job) {
        $pipes=[]; $process=proc_open([PHP_BINARY,__DIR__.'/command-worker.php'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
        fwrite($pipes[0],json_encode($job)); fclose($pipes[0]); $workers[]=[$process,$pipes];
    }
    $codes=[];
    foreach($workers as [$process,$pipes]) {
        $out=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
        if(proc_close($process)!==0) throw new RuntimeException($err); $codes[]=(int)$out;
    }
    sort($codes); return $codes;
}
check((int)$db->query('SELECT SUM(can_check_stock) FROM users')->fetchColumn()===0,'no employee is silently appointed by the upgrade');
cmd('user.update',['id'=>'sc_a','can_check_stock'=>true],$ca,403);
cmd('user.update',['id'=>'sc_admin','can_check_stock'=>true],$sa,422);
cmd('user.update',['id'=>'sc_a','can_check_stock'=>'true'],$sa,422);
cmd('user.create',['name'=>'Cannot grant inline','email'=>'noinline@test.local','password'=>'ValidPassword42','role'=>'employee','can_check_stock'=>true],$sa,422);
foreach(['sc_a','sc_b','sc_c','sc_d'] as $id) cmd('user.update',['id'=>$id,'can_check_stock'=>true],$sa);
$state=cmd('user.update',['id'=>'sc_a','can_check_stock'=>true],$sa);
check(count($state['stock_check_assignments'])===4 && first($state,'users',fn($u)=>$u['id']==='sc_a')['can_check_stock'],'admin assignment is explicit and repeated saves do not duplicate assignment history');
check(req('/sync/prices?since=0',[],$ca,'GET')['user']['can_check_stock'],'five-second sync exposes a changed checker permission');
cmd('stock_check.submit',['date'=>$day,'expected_snapshot'=>'bad','status'=>'confirmed'],$sn,403);
check(!isset(scState($sn)['stock_check_context']) && count(scState($sn)['stock_check_assignments'])===0,'ordinary employees receive no checker context or other assignment history');

cmd('price.create',['skm_price'=>28000,'skm_new_price'=>28000,'cracked_price'=>18000,'effective_at'=>$day],$sa);
$harvest=['date'=>$day,'category'=>'skm','eggs'=>1000,'kg'=>60,'trays'=>10,'photo'=>$profilePhoto,'notes'=>'Today harvest'];
$state=cmd('production.create',$harvest,$sn); $todayProd=first($state,'productions',fn($p)=>$p['notes']==='Today harvest');
cmd('production.create',array_replace($harvest,['category'=>'cracked','eggs'=>100,'kg'=>6,'trays'=>1,'notes'=>'Cracked harvest']),$sn);
$state=cmd('production.create',array_replace($harvest,['date'=>$oldDay,'eggs'=>100,'kg'=>6,'trays'=>1,'notes'=>'Old other harvest']),$sn); $oldProd=first($state,'productions',fn($p)=>$p['notes']==='Old other harvest');
$state=cmd('production.create',array_replace($harvest,['date'=>$edgeDay,'eggs'=>100,'kg'=>6,'trays'=>1,'notes'=>'Boundary other harvest']),$sn); $edgeProd=first($state,'productions',fn($p)=>$p['notes']==='Boundary other harvest');
$state=cmd('production.create',array_replace($harvest,['date'=>$oldDay,'eggs'=>100,'kg'=>6,'trays'=>1,'notes'=>'Own old harvest']),$ca); $ownOld=first($state,'productions',fn($p)=>$p['notes']==='Own old harvest');
$sale=['date'=>$day,'stock_source'=>'warehouse','customer'=>'Pelanggan uji','photo'=>$profilePhoto,'payment_method'=>'cash','paid'=>0,'items'=>[['category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>0]]];
$state=cmd('sale.create',$sale,$sn); $otherSale=$state['sales'][0];
$state=scState($ca); $ids=array_column($state['productions'],'id'); $names=first($state,'users',fn($u)=>$u['id']==='sc_normal');
check(in_array($todayProd['id'],$ids,true) && in_array($edgeProd['id'],$ids,true) && !in_array($oldProd['id'],$ids,true) && in_array($ownOld['id'],$ids,true),'checker reads other records within 30 WIB days and keeps all own historical records');
check($names['name']==='sc_normal' && $names['email']==='' && empty($names['username']) && empty($names['photo']) && $names['target']===0,'shared history exposes names without account email, username or profile data');
check(count(scState($cb)['sales'])===1 && count(scState($cb)['stock_checks'])===0 && count(scState($cb)['stock_check_assignments'])===1,'shared sales remain visible while checks and assignment history stay owned');
check(count(scState($sn)['users'])===1 && !in_array($ownOld['id'],array_column(scState($sn)['productions'],'id'),true),'ordinary employee record and identity access remains private');
mediaReq('/media/production/'.$todayProd['id'],$ca); mediaReq('/media/production/'.$edgeProd['id'],$ca); mediaReq('/media/production/'.$ownOld['id'],$ca);
mediaReq('/media/production/'.$oldProd['id'],$ca,403); mediaReq('/media/sale/'.$otherSale['id'],$ca);
mediaReq('/media/production/'.$ownOld['id'],$sn,403);
cmd('correction.apply',['entity'=>'production','id'=>$todayProd['id'],'reason'=>'Attempt another worker edit','changes'=>['kg'=>59]],$ca,403);
cmd('correction.request',['entity'=>'sale','id'=>$otherSale['id'],'reason'=>'Attempt another worker edit','changes'=>['customer'=>'Changed']],$ca,403);
cmd('sale.payment',['id'=>$otherSale['id'],'amount'=>100,'method'=>'cash'],$ca,403);
check(true,'cross-worker photos share the same date boundary and checker permission never grants write access');

$ctx=scState($ca)['stock_check_context'];
check($ctx['harvest']['skm']['eggs']===1000 && $ctx['harvest']['skm']['kg']==60 && $ctx['harvest']['cracked']['eggs']===100,'context totals include all today harvest and exclude prior dates');
$confirm=['schema_version'=>2,'date'=>$day,'expected_snapshot'=>$ctx['snapshot'],'status'=>'confirmed'];
cmd('stock_check.submit',array_replace($confirm,['date'=>$yesterday]),$ca,409);
cmd('stock_check.submit',$confirm+['warehouse_actual'=>$ctx['warehouse']],$ca,422);
cmd('stock_check.submit',scPending($ca),$ca,422);
$request=['action'=>'stock_check.submit','payload'=>$confirm,'request_id'=>'stock-check-confirm-001'];
$before=scState($ca)['inventory']; $state=req('/commands',$request,$ca); req('/commands',$request,$ca);
check(scLatest($state,'sc_a')['status']==='confirmed' && $state['inventory']===$before && count(scState($ca)['stock_checks'])===1,'confirmation and retry create exactly one immutable check without changing stock');
cmd('stock_check.submit',$confirm,$ca,409);
cmd('stock_check.review',['schema_version'=>2,'id'=>scLatest($state,'sc_a')['id'],'decision'=>'approve'],$sa,409);

$invalid=scPending($cb,['skm'=>['eggs'=>1280,'kg'=>77.4]]);
foreach([['skm'=>['eggs'=>0,'kg'=>1,'trays'=>0],'cracked'=>['eggs'=>0,'kg'=>0,'trays'=>0]],['skm'=>['eggs'=>1.5,'kg'=>1,'trays'=>0],'cracked'=>['eggs'=>0,'kg'=>0,'trays'=>0]],['skm'=>['eggs'=>1,'kg'=>1.0001,'trays'=>0],'cracked'=>['eggs'=>0,'kg'=>0,'trays'=>0]]] as $bad) cmd('stock_check.submit',array_replace($invalid,['warehouse_actual'=>array_replace(EggTypes::emptyInventory(),$bad)]),$cb,422);
cmd('stock_check.submit',array_replace($invalid,['reason'=>'x']),$cb,422);
check(true,'physical counts enforce whole eggs and trays, three-decimal weight and discrepancy explanation');

// Stale client context cannot enter the review queue after an intervening movement.
$stale=scPending($cb,['skm'=>['eggs'=>1280,'kg'=>77.4]]);
cmd('sale.create',array_replace($sale,['customer'=>'Second sale']),$sn);
cmd('stock_check.submit',$stale,$cb,409);
check(count(scState($cb)['stock_checks'])===0,'an intervening sale rejects a stale submit before saving any check');

// Admin must correct source records first; reconciliation applies only the remaining warehouse delta.
$payload=scPending($cb,['skm'=>['eggs'=>1180,'kg'=>70.8,'trays'=>12]],['skm'=>['eggs'=>900,'kg'=>54,'trays'=>9]]);
$state=cmd('stock_check.submit',$payload,$cb); $pending=scLatest($state,'sc_b');
check($state['inventory']===$pending['expected']['warehouse'],'submitting a discrepancy never modifies warehouse or source harvest');
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve'],$cb,403);
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve'],$sa,409);
$correction=['entity'=>'production','id'=>$todayProd['id'],'reason'=>'Sesuaikan catatan dengan hitung fisik','changes'=>['eggs'=>900,'kg'=>54,'trays'=>9]];
cmd('correction.apply',$correction,$sa);
$approval=['action'=>'stock_check.review','payload'=>['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve','reason'=>'Sumber panen sudah dikoreksi'],'request_id'=>'stock-check-approve-001'];
$state=req('/commands',$approval,$sa); req('/commands',$approval,$sa);
$moves=array_values(array_filter($state['stock_movements'],fn($r)=>($r['reference_id']??'')===$pending['id']));
check(scLatest($state,'sc_b')['status']==='approved' && $state['inventory']===$payload['warehouse_actual'] && count($moves)===4,'approval after individual admin correction reaches actual stock once without double-counting its correction');
check(first($state,'productions',fn($r)=>$r['id']===$todayProd['id'])['eggs']===900 && count(array_filter($state['activity'],fn($r)=>$r['action']==='correction.apply' && ($r['before']['id']??'')===$todayProd['id']))===1,'source production remains present with its original values retained in the correction audit');
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve'],$sa,409);

// Two pending checkers may not overwrite each other: a completed reconciliation invalidates the next one.
$pC=scPending($cc,['skm'=>['eggs'=>1170,'kg'=>70.2]]); $pD=scPending($cd,['skm'=>['eggs'=>1160,'kg'=>69.6]]);
$cCheck=scLatest(cmd('stock_check.submit',$pC,$cc),'sc_c'); $dCheck=scLatest(cmd('stock_check.submit',$pD,$cd),'sc_d');
$job=['token'=>$sa,'action'=>'stock_check.review','payload'=>['schema_version'=>2,'id'=>$cCheck['id'],'decision'=>'approve']];
check(scWorkers([$job,$job])===[200,409],'concurrent approvals of one check serialize and apply only once');
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'approve'],$sa,409);
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'reject','reason'=>'Hitung ulang setelah penyesuaian'],$sa);
$pD=scPending($cd,['skm'=>['eggs'=>1160,'kg'=>69.6]]); $state=cmd('stock_check.submit',$pD,$cd); $newD=scLatest($state,'sc_d');
$replaced=first($state,'stock_checks',fn($r)=>$r['id']===$dCheck['id']);
check($newD['id']!==$dCheck['id'] && $replaced['status']==='superseded' && $replaced['replaced_by']===$newD['id'] && $replaced['reviewed_by']==='sc_admin' && $replaced['warehouse_actual']===$dCheck['warehouse_actual'],'a fresh attempt preserves rejected evidence and review history with an explicit replacement link');

// Personal sales do not change warehouse balances but must still invalidate a physical check.
cmd('stock_check.review',['schema_version'=>2,'id'=>$newD['id'],'decision'=>'reject','reason'=>'Siapkan penjualan dari bawaan'],$sa);
$state=cmd('pickup.create',['date'=>$day,'category'=>'skm','eggs'=>20,'kg'=>1.2,'trays'=>0,'area'=>'Fixture personal sale'],$sn); $pickup=$state['pickups'][0];
$pD=scPending($cd,['skm'=>['eggs'=>1140,'kg'=>68.4]]); $dCheck=scLatest(cmd('stock_check.submit',$pD,$cd),'sc_d');
$personal=array_replace($sale,['stock_source'=>'pickup','customer'=>'Personal sale','items'=>[['pickup_id'=>$pickup['id'],'category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>0]]]);
$before=scState($cd)['inventory']; cmd('sale.create',$personal,$sn);
check(scState($cd)['inventory']===$before,'personal sale fixture leaves warehouse unchanged');
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'approve'],$sa,409);
check(scLatest(scState($cd),'sc_d')['status']==='pending','even a personal sale invalidates pending approval without losing submitted evidence');
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'reject','reason'=>'Ada penjualan setelah hitungan'],$sa);

// Employee source edits may not satisfy the required admin correction workflow.
$pD=scPending($cd,['skm'=>['eggs'=>1150,'kg'=>69]],['skm'=>['eggs'=>890,'kg'=>53.4]]);
$dCheck=scLatest(cmd('stock_check.submit',$pD,$cd),'sc_d');
cmd('correction.apply',array_replace($correction,['changes'=>['eggs'=>890,'kg'=>53.4]]),$sn);
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'approve'],$sa,409);
check(true,'an employee correction cannot substitute for admin review even when its resulting harvest totals match');
cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'reject','reason'=>'Admin perlu memeriksa ulang'],$sa);

// New harvest and manual counts are also stale, even if entered for an earlier date.
foreach(['production','manual','return'] as $change) {
    $ctx=scState($cd)['stock_check_context']; $pD=scPending($cd,['skm'=>['eggs'=>$ctx['warehouse']['skm']['eggs']-1,'kg'=>round($ctx['warehouse']['skm']['kg']-0.06,3)]]);
    $dCheck=scLatest(cmd('stock_check.submit',$pD,$cd),'sc_d');
    if($change==='production') cmd('production.create',array_replace($harvest,['date'=>$yesterday,'eggs'=>10,'kg'=>0.6,'trays'=>0,'notes'=>'Backdated new row']),$sn);
    if($change==='manual') cmd('stock.reconcile',['reason'=>'Count fixture','items'=>[['category'=>'skm','expected'=>$ctx['warehouse']['skm'],'physical'=>$ctx['warehouse']['skm']]]],$sa);
    if($change==='return') cmd('pickup.return',['id'=>$pickup['id'],'eggs'=>1,'kg'=>0.06,'trays'=>0],$sn);
    cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'approve'],$sa,409);
    cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'reject','reason'=>'Hitungan perlu diperbarui'],$sa);
}
check(true,'backdated new production, manual reconciliation and pickup returns all invalidate older physical counts');

// Mistaken harvest may be corrected to zero by admin, without deleting evidence.
cmd('settings.update',['harvest_auto_stock'=>false],$sa);
$state=cmd('production.create',array_replace($harvest,['category'=>'cracked','eggs'=>2,'kg'=>0.12,'trays'=>0,'notes'=>'Mistaken harvest']),$sn); $mistake=first($state,'productions',fn($r)=>$r['notes']==='Mistaken harvest');
cmd('production.receive',['id'=>$mistake['id']],$cd,403);
$zeroFix=['entity'=>'production','id'=>$mistake['id'],'reason'=>'Panen tercatat dua kali','changes'=>['eggs'=>0,'kg'=>0,'trays'=>0]];
cmd('correction.apply',$zeroFix,$sn,422);
cmd('correction.apply',array_replace($zeroFix,['changes'=>['eggs'=>0,'kg'=>0.12,'trays'=>0]]),$sa,422);
cmd('production.create',array_replace($harvest,['eggs'=>0,'kg'=>0,'trays'=>0]),$sa,422);
$ctx=scState($cd)['stock_check_context']; $actual=$ctx['harvest']; $actual['cracked']['eggs']-=2; $actual['cracked']['kg']=round($actual['cracked']['kg']-0.12,3);
$pD=scPending($cd,[],$actual); $dCheck=scLatest(cmd('stock_check.submit',$pD,$cd),'sc_d');
cmd('correction.apply',$zeroFix,$sa); $state=cmd('stock_check.review',['schema_version'=>2,'id'=>$dCheck['id'],'decision'=>'approve'],$sa);
$zero=first($state,'productions',fn($r)=>$r['id']===$mistake['id']);
check($zero['eggs']==0 && $zero['kg']==0 && $zero['trays']==0 && $zero['stocked_at']===null && scLatest($state,'sc_d')['status']==='approved','admin full-zero source correction resolves mistaken pending harvest while preserving record and warehouse');

// Revocation is effective on existing sessions; history remains available to administrators.
$beforeCount=count(scState($sa)['stock_check_assignments']);
cmd('user.update',['id'=>'sc_lifecycle','can_check_stock'=>true],$sa);
cmd('user.update',['id'=>'sc_lifecycle','role'=>'admin'],$sa);
check(!first(scState($sa),'users',fn($u)=>$u['id']==='sc_lifecycle')['can_check_stock'],'promotion automatically removes checker eligibility');
cmd('user.update',['id'=>'sc_lifecycle','role'=>'employee','can_check_stock'=>true],$sa);
cmd('user.update',['id'=>'sc_lifecycle','active'=>false],$sa);
cmd('user.update',['id'=>'sc_lifecycle','active'=>false,'can_check_stock'=>true],$sa,422);
cmd('user.update',['id'=>'sc_lifecycle','active'=>true,'can_check_stock'=>true],$sa);
cmd('user.delete',['id'=>'sc_lifecycle','reason'=>'Akun uji selesai'],$sa);
$state=scState($sa); $events=array_values(array_filter($state['stock_check_assignments'],fn($r)=>$r['user_id']==='sc_lifecycle'));
check(count($events)===6 && array_column($events,'assigned')===[false,true,false,true,false,true] && first($state,'users',fn($u)=>$u['id']==='sc_lifecycle')['deleted_at']!==null,'promotion, deactivation and soft-delete append unassignment history without erasing earlier days');
cmd('user.update',['id'=>'sc_a','can_check_stock'=>false],$sa);
$state=scState($ca); mediaReq('/media/production/'.$todayProd['id'],$ca,403);
check(!isset($state['stock_check_context']) && count($state['stock_checks'])===1 && !in_array($todayProd['id'],array_column($state['productions'],'id'),true),'revoked checker immediately loses cross-worker reads but keeps own submitted history and session');
$past=$events[5]; $past['created_at']=$yesterday.'T08:00:00+07:00';
$db->prepare('UPDATE records SET data=?,occurred_at=? WHERE id=?')->execute([json_encode($past),$yesterday.' 08:00:00',$past['id']]);
check(first(scState($sa),'stock_check_assignments',fn($r)=>$r['id']===$past['id'])['created_at']===$past['created_at'],'past assignment events remain visible even with no daily check, enabling historical no-action reporting');
cmd('notification.read',['id'=>'all'],$sn);
check(count(array_filter(scState($sn)['notifications'],fn($r)=>!$r['read']))===0,'read-all notifications continue to work after checker workflow changes');

// Tray counts are informational and can be repacked: replay the same zero floor as stock().
cmd('user.update',['id'=>'sc_normal','can_check_stock'=>true],$sa);
$ctx=scState($sn)['stock_check_context']; $physical=$ctx['warehouse']['skm']; $physical['trays']=5;
cmd('stock.reconcile',['reason'=>'Krat dikemas ulang','items'=>[['category'=>'skm','expected'=>$ctx['warehouse']['skm'],'physical'=>$physical]]],$sa);
$payload=scPending($sn,['skm'=>['trays'=>0]],['skm'=>['trays'=>0]]);
$normalCheck=scLatest(cmd('stock_check.submit',$payload,$sn),'sc_normal');
cmd('correction.apply',['entity'=>'production','id'=>$todayProd['id'],'reason'=>'Krat panen tercatat berlebih','changes'=>['trays'=>0]],$sa);
$state=cmd('stock_check.review',['schema_version'=>2,'id'=>$normalCheck['id'],'decision'=>'approve'],$sa);
check($state['inventory']['skm']['trays']===0 && scLatest($state,'sc_normal')['status']==='approved','approval replays the warehouse tray zero floor when a source correction exceeds current trays');
