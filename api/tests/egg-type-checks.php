<?php
// Dedicated fixtures inside integration.php's disposable database.
resetTestDatabase();
$etTokens=[]; $etHash=password_hash('EggTypeFixturePassword42',PASSWORD_DEFAULT);
foreach(['et_admin'=>'admin','et_employee'=>'employee','et_checker'=>'employee'] as $id=>$role) {
    $db->prepare('INSERT INTO users(id,name,email,username,password_hash,role,can_check_stock) VALUES(?,?,?,?,?,?,?)')->execute([$id,$id,$id.'@test.local',$id,$etHash,$role,$id==='et_checker'?1:0]);
    $etTokens[$id]=bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))')->execute([hash('sha256',$etTokens[$id]),$id]);
}
$ta=$etTokens['et_admin']; $te=$etTokens['et_employee']; $tc=$etTokens['et_checker']; $etDay=date('Y-m-d');
function etRecord(string $kind,array $row): void {
    global $db;
    $db->prepare('INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,?,?,?,?)')->execute([$row['id'],$kind,$row['user_id']??null,date('Y-m-d H:i:s',strtotime($row['date']??$row['effective_at']??$row['created_at']??'now')),json_encode($row,JSON_THROW_ON_ERROR)]);
}
function etSum(array $inventory): array {
    $sum=['eggs'=>0,'kg'=>0.0,'trays'=>0];
    foreach($inventory as $q) foreach($sum as $key=>$v) $sum[$key]=round($v+$q[$key],3);
    return $sum;
}
$legacyProd=['id'=>'et_legacy_prod','user_id'=>'et_employee','date'=>$etDay,'category'=>'good','eggs'=>150,'kg'=>9,'trays'=>3,'locked'=>false,'photo'=>$profilePhoto,'notes'=>'Original unclassified harvest'];
$legacyPickup=['id'=>'et_legacy_pickup','user_id'=>'et_employee','date'=>$etDay,'category'=>'good','eggs'=>50,'kg'=>3,'trays'=>1,'returned_eggs'=>0,'returned_kg'=>0,'returned_trays'=>0,'locked'=>false,'notes'=>'Legacy carried stock'];
$legacyPrice=['id'=>'et_legacy_price','good_price'=>25000,'cracked_price'=>18000,'effective_at'=>date('c',strtotime('-1 day'))];
etRecord('production',$legacyProd); etRecord('pickup',$legacyPickup); etRecord('price',$legacyPrice);
$db->exec("UPDATE stock SET eggs=100,kg=6,trays=2 WHERE stock_key='egg:good'");
$db->exec("DELETE FROM stock WHERE stock_key IN ('egg:skm','egg:skm_new')");
$original=$db->query('SELECT id,data FROM records ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
$db->exec('DELETE FROM command_mutex'); $failed=false;
try { EggTypesSchema::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && (int)$db->query('SELECT COUNT(*) FROM stock')->fetchColumn()===2,'egg-type migration refuses to write when the global transaction mutex is missing');
$db->exec('INSERT INTO command_mutex(id,version) VALUES(1,0)');
$db->exec("DELETE FROM stock WHERE stock_key='egg:cracked'"); $failed=false;
try { EggTypesSchema::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && (int)$db->query('SELECT COUNT(*) FROM stock')->fetchColumn()===1,'incomplete legacy stock blocks migration without creating partial typed balances');
$db->exec("INSERT INTO stock(stock_key,eggs,kg,trays) VALUES('egg:cracked',0,0,0)");
EggTypesSchema::migrate($db); $afterMigration=businessSnapshot(); EggTypesSchema::migrate($db);
$state=scState($ta);
check(businessSnapshot()===$afterMigration && count($state['inventory'])===4 && $state['inventory']['good']==['eggs'=>100,'kg'=>6,'trays'=>2] && $state['inventory']['skm']['eggs']===0 && $state['inventory']['skm_new']['eggs']===0,'egg-type upgrade is idempotent and creates empty typed stock without relabeling legacy balances');
$after=$db->query("SELECT id,data FROM records WHERE kind<>'schema' ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR);
check($after===$original && $db->query("SELECT COUNT(*) FROM records WHERE id='schema_egg_types_v2'")->fetchColumn()==1,'migration preserves legacy JSON byte-for-byte and writes one explicit schema marker');
$marker=$db->query("SELECT data FROM records WHERE id='schema_egg_types_v2'")->fetchColumn();
$db->exec("UPDATE records SET data='{}' WHERE id='schema_egg_types_v2'"); $failed=false;
try { EggTypesSchema::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && $db->query("SELECT data FROM records WHERE id='schema_egg_types_v2'")->fetchColumn()==='{}','a conflicting migration marker is rejected rather than silently overwritten');
$db->prepare("UPDATE records SET data=? WHERE id='schema_egg_types_v2'")->execute([$marker]);

$harvest=['date'=>$etDay,'category'=>'skm','eggs'=>100,'kg'=>6,'trays'=>2,'photo'=>$profilePhoto];
cmd('production.create',array_replace($harvest,['category'=>'good']),$te,422);
cmd('pickup.create',array_replace($harvest,['category'=>'good']),$te,422);
cmd('price.create',['good_price'=>25000,'cracked_price'=>18000,'effective_at'=>$etDay],$ta,422);
cmd('production.create',array_replace($harvest,['category'=>'parent_good']),$te,422);
check(scState($ta)['inventory']===$state['inventory'],'ambiguous legacy harvest, new pickup and old price payloads fail without reallocating stock');
$legacySale=['date'=>$etDay,'stock_source'=>'warehouse','customer'=>'Legacy buyer','photo'=>$profilePhoto,'payment_method'=>'cash','paid'=>0,'items'=>[['category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0]]];
$legacyReceipt=cmd('sale.create',$legacySale,$te); $firstLegacy=$legacyReceipt['sales'][0];
check($firstLegacy['items'][0]['category']==='good' && $firstLegacy['items'][0]['unit_price']===25000 && $legacyReceipt['inventory']['good']['eggs']===90,'explicit warehouse legacy sale uses only legacy balance and legacy price');
$typedSale=array_replace($legacySale,['customer'=>'Typed buyer','items'=>[['category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>0]]]);
$before=businessSnapshot(); cmd('sale.create',$typedSale,$te,422);
check($before===businessSnapshot(),'missing typed price never falls back to legacy good price');
foreach([['skm_price'=>0,'skm_new_price'=>32000,'cracked_price'=>0],['skm_price'=>28000,'cracked_price'=>0],['skm_price'=>28000,'skm_new_price'=>32000,'cracked_price'=>0,'good_price'=>25000]] as $badPrice) cmd('price.create',$badPrice+['effective_at'=>$etDay],$ta,422);
$prices=['skm_price'=>28000,'skm_new_price'=>35000,'cracked_price'=>18000,'effective_at'=>$etDay];
cmd('price.create',$prices,$ta);
$before=businessSnapshot(); cmd('sale.create',$typedSale,$te,422);
check($before===businessSnapshot(),'an empty SKM balance cannot consume abundant unclassified legacy eggs');
$batch=['date'=>$etDay,'photo'=>$profilePhoto,'items'=>[['category'=>'skm','eggs'=>100,'kg'=>6,'trays'=>2],['category'=>'skm_new','eggs'=>50,'kg'=>5,'trays'=>1],['category'=>'cracked','eggs'=>20,'kg'=>1.2,'trays'=>0]]];
$state=cmd('production.create',$batch,$te);
check($state['inventory']['skm']['eggs']===100 && $state['inventory']['skm_new']['eggs']===50 && $state['inventory']['cracked']['eggs']===20 && $state['inventory']['good']['eggs']===90,'one harvest records three independent types and leaves legacy good untouched');
$context=scState($tc)['stock_check_context'];
check($context['schema_version']===2 && count($context['warehouse'])===4 && $context['harvest']['good']['eggs']===150 && $context['harvest']['skm_new']['eggs']===50,'v2 stock context separates all four warehouse and harvest identities');
$mixed=array_replace($typedSale,['items'=>[['category'=>'skm','kg'=>0.6],['category'=>'skm_new','kg'=>0.5],['category'=>'cracked','kg'=>0.6]]]);
$state=cmd('sale.create',$mixed,$te); $mixedSale=first($state,'sales',fn($s)=>$s['customer']==='Typed buyer');
check(array_column($mixedSale['items'],'eggs')===[10,5,10] && array_column($mixedSale['items'],'unit_price')===[28000,35000,18000] && $mixedSale['total']===45100,'weight-only allocation and unit-price snapshots are computed separately for SKM, SKM Baru and bentes');
$before=businessSnapshot();
cmd('sale.create',array_replace($typedSale,['items'=>[['category'=>'skm_new','eggs'=>46,'kg'=>4.6,'trays'=>0]]]),$te,422);
check($before===businessSnapshot(),'SKM Baru oversell cannot borrow from SKM or unclassified stock');

// A pre-existing future legacy schedule must not erase independently configured typed prices.
$scheduled=['id'=>'et_future_legacy','good_price'=>27000,'cracked_price'=>21000,'effective_at'=>date('c',strtotime('+1 day'))]; etRecord('price',$scheduled);
$state=cmd('sale.create',array_replace($legacySale,['customer'=>'Before legacy schedule']),$te);
check(first($state,'sales',fn($s)=>$s['customer']==='Before legacy schedule')['items'][0]['unit_price']===25000,'future legacy good price stays inactive until its scheduled time');
$scheduled['effective_at']=date('c',time()-1);
$db->prepare('UPDATE records SET occurred_at=?,data=? WHERE id=?')->execute([date('Y-m-d H:i:s',time()-1),json_encode($scheduled),$scheduled['id']]);
$state=cmd('sale.create',array_replace($mixed,['customer'=>'After legacy schedule']),$te); $afterScheduled=first($state,'sales',fn($s)=>$s['customer']==='After legacy schedule');
check(array_column($afterScheduled['items'],'unit_price')===[28000,35000,21000] && first($state,'sales',fn($s)=>$s['id']===$mixedSale['id'])['items']===$mixedSale['items'],'activating a legacy schedule preserves typed rates and all original sale price snapshots');
$state=cmd('sale.create',array_replace($legacySale,['customer'=>'Current legacy rate']),$te);
check(first($state,'sales',fn($s)=>$s['customer']==='Current legacy rate')['items'][0]['unit_price']===27000,'legacy stock resolves its own latest eligible good price independently');

// Existing carried eggs remain unclassified through sales, returns and corrections.
$carried=array_replace($legacySale,['stock_source'=>'pickup','customer'=>'Old pickup buyer','items'=>[['pickup_id'=>$legacyPickup['id'],'category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0]]]);
$state=cmd('sale.create',$carried,$te); $carriedSale=first($state,'sales',fn($s)=>$s['customer']==='Old pickup buyer');
cmd('sale.create',array_replace($carried,['items'=>[['pickup_id'=>$legacyPickup['id'],'category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>0]]]),$te,422);
$stockBefore=$state['inventory']; $state=cmd('pickup.return',['id'=>$legacyPickup['id'],'eggs'=>10,'kg'=>0.6,'trays'=>0],$te);
check($state['inventory']['good']['eggs']===$stockBefore['good']['eggs']+10 && $state['inventory']['skm']===$stockBefore['skm'] && $carriedSale['items'][0]['category']==='good','legacy pickup sale and return preserve its identity without crediting typed stock');
$state=cmd('correction.apply',['entity'=>'production','id'=>$legacyProd['id'],'reason'=>'Koreksi jumlah panen lama','changes'=>['eggs'=>160,'kg'=>9.6]],$ta);
check(first($state,'productions',fn($p)=>$p['id']===$legacyProd['id'])['category']==='good' && $state['inventory']['good']['eggs']===$stockBefore['good']['eggs']+20,'correcting legacy production retains its category and adjusts only legacy warehouse');

// Classification conserves each quantity and never rewrites source business history.
$context=scState($tc)['stock_check_context']; $actual=$context['warehouse']; $actual['good']['eggs']-=1; $actual['good']['kg']=round($actual['good']['kg']-0.06,3);
$pendingPayload=['schema_version'=>2,'date'=>$etDay,'expected_snapshot'=>$context['snapshot'],'status'=>'pending','warehouse_actual'=>$actual,'harvest_actual'=>$context['harvest'],'reason'=>'Periksa stok sebelum pemilahan'];
foreach([null,1,'2'] as $oldVersion) {
    $oldConfirm=['date'=>$etDay,'expected_snapshot'=>$context['snapshot'],'status'=>'confirmed'];
    if($oldVersion!==null) $oldConfirm['schema_version']=$oldVersion;
    cmd('stock_check.submit',$oldConfirm,$tc,409);
}
check(count(scState($tc)['stock_checks'])===0,'legacy clients cannot confirm unseen typed balances without explicit version-two support');
$pending=scLatest(cmd('stock_check.submit',$pendingPayload,$tc),'et_checker');
$legacyApproval=['id'=>$pending['id'],'decision'=>'approve']; $before=businessSnapshot();
cmd('stock_check.review',$legacyApproval,$ta,409);
check(businessSnapshot()===$before,'legacy admin clients cannot approve typed counts they cannot display');
$state=scState($ta); $transfer=['category'=>'skm_new','eggs'=>20,'kg'=>1.2,'trays'=>1,'expected_source'=>$state['inventory']['good'],'expected_target'=>$state['inventory']['skm_new'],'reason'=>'Pilahan fisik sudah diperiksa'];
cmd('stock.classify',$transfer,$te,403);
cmd('stock.classify',array_replace($transfer,['category'=>'cracked']),$ta,422);
cmd('stock.classify',array_replace($transfer,['eggs'=>0]),$ta,422);
cmd('stock.classify',array_replace($transfer,['trays'=>99]),$ta,422);
cmd('stock.classify',array_replace($transfer,['expected_target'=>array_replace($transfer['expected_target'],['eggs'=>999])]),$ta,409);
$sumBefore=etSum($state['inventory']); $historyBefore=$db->query("SELECT id,data FROM records WHERE kind IN ('production','pickup','sale') ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR);
$classify=['action'=>'stock.classify','payload'=>$transfer,'request_id'=>'et-classify-idempotent'];
$state=req('/commands',$classify,$ta); req('/commands',$classify,$ta);
$moves=array_values(array_filter($state['stock_movements'],fn($m)=>in_array($m['kind'],['classify_in','classify_out'],true)));
check(etSum($state['inventory'])===$sumBefore && $state['inventory']['good']['eggs']===$transfer['expected_source']['eggs']-20 && $state['inventory']['skm_new']['eggs']===$transfer['expected_target']['eggs']+20 && count($moves)===2 && $moves[0]['reference_id']===$moves[1]['reference_id'],'classification moves exact quantities atomically with a paired audit trail and idempotent retry');
check($historyBefore===$db->query("SELECT id,data FROM records WHERE kind IN ('production','pickup','sale') ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR),'classification never changes any historical production, pickup or sale document');
cmd('stock.classify',$transfer,$ta,409);
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve'],$ta,409);
check(true,'old classification snapshots and counts made before a transfer require a fresh stock view');
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'reject','reason'=>'Hitung ulang setelah pemilahan'],$ta);
$state=scState($ta); $raceTransfer=['category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>0,'expected_source'=>$state['inventory']['good'],'expected_target'=>$state['inventory']['skm'],'reason'=>'Pemilahan bersamaan diperiksa'];
$job=['token'=>$ta,'action'=>'stock.classify','payload'=>$raceTransfer];
check(scWorkers([$job,$job])===[200,409] && scState($ta)['inventory']['good']['eggs']===$raceTransfer['expected_source']['eggs']-10,'concurrent classification commands cannot transfer the same counted legacy eggs twice');

// Version-one physical evidence remains readable, but it cannot overwrite the new ledger.
$oldCheck=$pending; $oldCheck['id']='et_old_pending'; unset($oldCheck['schema_version']); $oldCheck['status']='pending';
foreach(['warehouse','harvest'] as $field) $oldCheck['expected'][$field]=array_intersect_key($oldCheck['expected'][$field],array_flip(['good','cracked']));
foreach(['warehouse_actual','harvest_actual'] as $field) $oldCheck[$field]=array_intersect_key($oldCheck[$field],array_flip(['good','cracked']));
etRecord('stock_check',$oldCheck); $before=businessSnapshot();
cmd('stock_check.review',['schema_version'=>2,'id'=>$oldCheck['id'],'decision'=>'approve'],$ta,409);
check($before===businessSnapshot(),'a legacy pending check cannot approve into the v2 ledger or mutate its historical snapshots');
cmd('stock_check.review',['schema_version'=>2,'id'=>$oldCheck['id'],'decision'=>'reject','reason'=>'Hitung lagi dengan jenis terbaru'],$ta);
$oldClosed=$oldCheck; $oldClosed['id']='et_old_confirmed'; $oldClosed['status']='confirmed'; etRecord('stock_check',$oldClosed);
$ctx=scState($tc)['stock_check_context']; $state=cmd('stock_check.submit',['schema_version'=>2,'date'=>$etDay,'expected_snapshot'=>$ctx['snapshot'],'status'=>'confirmed'],$tc); $newCheck=scLatest($state,'et_checker');
check($newCheck['schema_version']===2 && $newCheck['status']==='confirmed' && first($state,'stock_checks',fn($r)=>$r['id']==='et_old_confirmed')['status']==='superseded','a new versioned count can replace same-day legacy confirmation while keeping previous evidence');

$syncBefore=count(scState($ta)['prices']); $same=$prices; $same['effective_at']=date('c');
$state=cmd('price.create',$same,$ta); $firstId=$state['prices'][0]['id'];
$state=cmd('price.create',$same,$ta); $secondId=$state['prices'][0]['id'];
check(count($state['prices'])===$syncBefore+2 && $firstId!==$secondId && str_contains($state['notifications'][0]['message'],'Telur SKM Baru') && str_contains($state['notifications'][0]['message'],'Telur SKM '),'saving equal typed rates twice creates distinct events and notifications naming both SKM types');
