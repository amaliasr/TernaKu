<?php
// Explicitly disposable integration fixtures for shared pricing and historical conversion.
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
    $db->prepare('INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,?,?,?,?)')->execute([$row['id'],$kind,$row['user_id']??null,date('Y-m-d H:i:s',strtotime($row['date']??$row['effective_at']??$row['created_at']??'now')),json_encode($row,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);
}
function etStored(string $id): array { global $db; $q=$db->prepare('SELECT data FROM records WHERE id=?'); $q->execute([$id]); return json_decode($q->fetchColumn(),true,512,JSON_THROW_ON_ERROR); }
function etTotals(array $inventory): array { $q=['eggs'=>0,'kg'=>0.0,'trays'=>0]; foreach($inventory as $row) foreach($q as $k=>$v) $q[$k]=round($v+$row[$k],3); return $q; }
$legacyProd=['id'=>'et_legacy_prod','user_id'=>'et_employee','date'=>$etDay,'category'=>'good','eggs'=>200,'kg'=>12,'trays'=>4,'locked'=>false,'photo'=>$profilePhoto,'notes'=>'Original harvest'];
$typedProd=array_replace($legacyProd,['id'=>'et_typed_prod','category'=>'skm','eggs'=>60,'kg'=>3.6,'trays'=>2]);
$newProd=array_replace($legacyProd,['id'=>'et_new_prod','category'=>'skm_new','eggs'=>30,'kg'=>3,'trays'=>1]);
$legacyPickup=['id'=>'et_legacy_pickup','user_id'=>'et_employee','date'=>$etDay,'category'=>'good','eggs'=>80,'kg'=>4.8,'trays'=>2,'returned_eggs'=>0,'returned_kg'=>0,'returned_trays'=>0,'locked'=>false,'notes'=>'Carried before migration'];
$oldPayload=['date'=>$etDay,'stock_source'=>'pickup','customer'=>'Original buyer','photo'=>$profilePhoto,'payment_method'=>'credit','paid'=>10000,'items'=>[['pickup_id'=>$legacyPickup['id'],'category'=>'good','eggs'=>30,'kg'=>1.8,'trays'=>1]]];
$oldItem=$oldPayload['items'][0]+['id'=>'et_original_item','unit_price'=>25000,'total'=>45000,'is_free'=>false];
$oldSale=['id'=>'et_original_sale','user_id'=>'et_employee','number'=>'TK-HISTORY','date'=>$etDay,'created_at'=>$etDay.'T08:00:00+07:00','stock_source'=>'pickup','customer'=>'Original buyer','photo'=>$profilePhoto,'items'=>[$oldItem],'total'=>45000,'paid'=>10000,'balance'=>35000,'payment_status'=>'partial','payment_method'=>'credit','locked'=>true,'payments'=>[['id'=>'payment_original','amount'=>10000,'created_at'=>$etDay.'T08:00:00+07:00']]];
foreach([$legacyProd,$typedProd,$newProd] as $p) etRecord('production',$p);
etRecord('pickup',$legacyPickup); etRecord('sale',$oldSale);
$legacyPrice=['id'=>'et_legacy_price','good_price'=>25000,'cracked_price'=>18000,'effective_at'=>date('c',strtotime('-1 day'))]; etRecord('price',$legacyPrice);
foreach([$legacyProd,$typedProd,$newProd] as $p) etRecord('stock_movement',['id'=>'move_'.$p['id'],'user_id'=>$p['user_id'],'category'=>$p['category'],'date'=>$etDay,'kind'=>'production','reference_id'=>$p['id'],'eggs'=>$p['eggs'],'kg'=>$p['kg'],'trays'=>$p['trays']]);
etRecord('stock_movement',['id'=>'move_legacy_pickup','user_id'=>'et_employee','category'=>'good','date'=>$etDay,'kind'=>'pickup','reference_id'=>$legacyPickup['id'],'eggs'=>-80,'kg'=>-4.8,'trays'=>-2]);
foreach(['good'=>[120,7.2,2],'skm'=>[60,3.6,2],'skm_new'=>[30,3,1]] as $type=>$q) $db->prepare('UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key=?')->execute([...$q,'egg:'.$type]);
$beforeInventory=scState($ta)['inventory']; $harvest=EggTypes::emptyInventory(); $harvest['good']=['eggs'=>200,'kg'=>12,'trays'=>4]; $harvest['skm']=['eggs'=>60,'kg'=>3.6,'trays'=>2]; $harvest['skm_new']=['eggs'=>30,'kg'=>3,'trays'=>1];
$finalCheck=['id'=>'et_final_check','schema_version'=>2,'user_id'=>'et_employee','date'=>$etDay,'status'=>'approved','snapshot'=>'original-evidence-snapshot','expected'=>['warehouse'=>$beforeInventory,'harvest'=>$harvest],'warehouse_actual'=>$beforeInventory,'harvest_actual'=>$harvest,'production_ids'=>[$legacyProd['id'],$typedProd['id'],$newProd['id']],'movement_sequence'=>0,'reason'=>'Original count','created_at'=>$etDay.'T08:00:00+07:00','updated_at'=>$etDay.'T09:00:00+07:00','reviewed_at'=>$etDay.'T09:00:00+07:00','reviewed_by'=>'et_admin','review_reason'=>'Original approval'];
etRecord('stock_check',$finalCheck);
$oldV1=array_replace($finalCheck,['id'=>'et_v1_check','date'=>date('Y-m-d',strtotime('-1 day')),'schema_version'=>1,'status'=>'confirmed']);
foreach(['warehouse','harvest'] as $field) $oldV1['expected'][$field]=array_intersect_key($oldV1['expected'][$field],array_flip(['good','cracked']));
foreach(['warehouse_actual','harvest_actual'] as $field) $oldV1[$field]=array_intersect_key($oldV1[$field],array_flip(['good','cracked']));
etRecord('stock_check',$oldV1);
$pending=array_replace($finalCheck,['id'=>'et_pending_check','user_id'=>'et_checker','status'=>'pending','reviewed_at'=>null,'reviewed_by'=>null,'review_reason'=>'']); etRecord('stock_check',$pending);
etRecord('activity',['id'=>'et_audit_original','user_id'=>'et_admin','action'=>'correction.apply','actor_role'=>'admin','description'=>'Original audit','before'=>$legacyProd,'after'=>$legacyProd,'created_at'=>$etDay.'T07:00:00+07:00']);
etRecord('push_job',['id'=>'et_queued_original','payload'=>['body'=>'Harga lama SKM 28000 dan SKM Baru 35000','good_price'=>25000],'created_at'=>date('c')]);
$oldRequestId='et-frozen-original-sale';
$oldRequest=['action'=>'sale.create','payload'=>$oldPayload,'request_id'=>$oldRequestId];
$fingerprint=hash('sha256',json_encode([$oldRequest['action'],$oldPayload],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));
$db->prepare('INSERT INTO command_requests(user_id,request_id,fingerprint) VALUES(?,?,?)')->execute(['et_employee',$oldRequestId,$fingerprint]);
etRecord('command_result',['id'=>'cmd_'.substr(hash('sha256','et_employee|'.$oldRequestId),0,36),'user_id'=>'et_employee','action'=>'sale.create','record_id'=>$oldSale['id'],'request_id'=>$oldRequestId]);
$protected=$db->query("SELECT id,data FROM records WHERE kind IN ('activity','price','push_job','command_result') ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR);
$mediaBefore=$db->query("SELECT id,photo_version FROM records WHERE kind IN ('production','sale') ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR);
$movementCount=(int)$db->query("SELECT COUNT(*) FROM records WHERE kind='stock_movement'")->fetchColumn();

// Conversion is an explicit separate migration, not an installer side effect.
EggTypesSchema::migrate($db);
check(etStored($legacyProd['id'])['category']==='good' && scState($ta)['inventory']['good']['eggs']===120,'ordinary additive installation never converts historical business categories implicitly');
check(SharedGoodPriceMigration::migrate($db),'explicit migration reports the one-time conversion');
$snapshot=businessSnapshot(); check(!SharedGoodPriceMigration::migrate($db) && businessSnapshot()===$snapshot,'conversion is idempotent and does not increment balances or audit rows on retry');
$state=scState($ta);
check($state['inventory']['skm']==['eggs'=>180,'kg'=>10.8,'trays'=>4] && $state['inventory']['good']==['eggs'=>0,'kg'=>0,'trays'=>0] && etTotals($state['inventory'])===etTotals($beforeInventory),'all warehouse good quantities merge into existing SKM with total eggs, weight and trays conserved');
check(etStored($legacyProd['id'])['category']==='skm' && etStored($legacyPickup['id'])['category']==='skm','all original harvest and outstanding pickup identities become SKM');
$migratedSale=$oldSale; $migratedSale['items'][0]['category']='skm';
check(etStored($oldSale['id'])===$migratedSale && $mediaBefore===$db->query("SELECT id,photo_version FROM records WHERE kind IN ('production','sale') ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR),'sale conversion changes only category and preserves unit prices, payments, dates, totals and every photo version');
foreach($protected as $id=>$raw) { $q=$db->prepare('SELECT data FROM records WHERE id=?'); $q->execute([$id]); check($q->fetchColumn()===$raw,'original '.$id.' audit/price/push/retry evidence stays byte-identical'); }
$ledger=['eggs'=>0,'kg'=>0.0,'trays'=>0]; foreach($state['stock_movements'] as $m) if($m['category']==='skm') foreach($ledger as $k=>$v) $ledger[$k]=round($v+$m[$k],3);
check($ledger==['eggs'=>180,'kg'=>10.8,'trays'=>4] && (int)$db->query("SELECT COUNT(*) FROM records WHERE kind='stock_movement'")->fetchColumn()===$movementCount,'historical movement re-keying reproduces merged stock without adding a double-counted transfer');
$closed=etStored($finalCheck['id']); $v1=etStored($oldV1['id']); $invalidated=etStored($pending['id']);
check($closed['status']==='approved' && $closed['reviewed_at']===$finalCheck['reviewed_at'] && $closed['snapshot']===$finalCheck['snapshot'] && $closed['warehouse_actual']['skm']['eggs']===180 && $closed['harvest_actual']['skm']['eggs']===260 && $closed['warehouse_actual']['good']['eggs']===0,'finalized count history aggregates legacy and existing SKM without applying another stock adjustment');
check($v1['schema_version']===1 && $v1['status']==='confirmed' && count($v1['warehouse_actual'])===4 && $v1['warehouse_actual']['skm']['eggs']===120,'version-one finalized counts retain status while becoming readable as SKM history');
check($invalidated['status']==='rejected' && $invalidated['reviewed_by']===null && isset($invalidated['migration_invalidated_at']) && str_contains($invalidated['review_reason'],'pemeriksaan baru'),'pending counts are explicitly invalidated for recount with a system reason');
cmd('stock_check.review',['schema_version'=>2,'id'=>$pending['id'],'decision'=>'approve'],$ta,409);
$audit=etStored('migration_shared_good_v3');
check(strlen($audit['after']['before_records_sha256'])===64 && strlen($audit['after']['after_records_sha256'])===64 && $audit['after']['changed_by_kind']['sale']===1,'migration audit records changed counts and before/after source digests without copying photos');

// Frozen payloads preserve their original retry fingerprint before good -> skm normalization.
$beforeSales=count($state['sales']); $replay=req('/commands',$oldRequest,$te);
check(count($replay['sales'])===$beforeSales && first($replay,'sales',fn($s)=>$s['id']===$oldSale['id'])['items'][0]['category']==='skm','an already-saved pre-migration frozen request returns its converted sale without duplication');
$changedRequest=$oldRequest; $changedRequest['payload']['items'][0]['category']='skm'; req('/commands',$changedRequest,$te,'POST',409);
$newDraft=['action'=>'production.create','payload'=>['date'=>$etDay,'category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0,'photo'=>$profilePhoto,'notes'=>'Frozen draft after migration'],'request_id'=>'et-frozen-harvest-new'];
$state=req('/commands',$newDraft,$te); req('/commands',$newDraft,$te);
check(count(array_filter($state['productions'],fn($p)=>$p['notes']==='Frozen draft after migration' && $p['category']==='skm'))===1 && $state['inventory']['good']['eggs']===0,'an unsaved old good harvest normalizes to SKM once while retaining the original retry payload');
$state=cmd('pickup.create',['date'=>$etDay,'category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0,'area'=>'Old draft pickup'],$te);
$newPickup=first($state,'pickups',fn($p)=>($p['area']??'')==='Old draft pickup');
check($newPickup['category']==='skm','new legacy-alias pickup requests also store canonical SKM');
$beforeSkm=$state['inventory']['skm']; $state=cmd('pickup.return',['id'=>$legacyPickup['id'],'eggs'=>10,'kg'=>0.6,'trays'=>0],$te);
check($state['inventory']['skm']['eggs']===$beforeSkm['eggs']+10 && $state['inventory']['good']['eggs']===0,'returning a migrated outstanding pickup credits SKM directly');
$state=cmd('correction.apply',['entity'=>'production','id'=>$legacyProd['id'],'reason'=>'Periksa panen yang sudah dipindahkan','changes'=>['eggs'=>210,'kg'=>12.6]],$ta);
check(etStored($legacyProd['id'])['category']==='skm' && $state['inventory']['good']['kg']==0,'corrections of historical records keep the migrated identity');
$oldCount=['category'=>'good','expected'=>$beforeInventory['good'],'physical'=>$beforeInventory['good']];
cmd('stock.reconcile',['items'=>[$oldCount],'reason'=>'Hitungan lama sebelum migrasi'],$ta,409);
$canonical=$state['inventory']['skm']; $before=businessSnapshot();
cmd('stock.reconcile',['items'=>[['category'=>'good','expected'=>$canonical,'physical'=>$canonical],['category'=>'skm','expected'=>$canonical,'physical'=>$canonical]],'reason'=>'Duplikat jenis setelah alias'],$ta,422);
check(businessSnapshot()===$before,'canonical normalization rejects duplicate good and SKM count lines before any stock write');

$sale=['date'=>$etDay,'stock_source'=>'warehouse','customer'=>'Legacy rate buyer','photo'=>$profilePhoto,'payment_method'=>'cash','paid'=>0,'items'=>[['category'=>'good','eggs'=>10,'kg'=>0.6,'trays'=>0],['category'=>'skm_new','eggs'=>5,'kg'=>0.5,'trays'=>0]]];
$state=cmd('sale.create',$sale,$te); $fallbackSale=first($state,'sales',fn($s)=>$s['customer']===$sale['customer']);
check(array_column($fallbackSale['items'],'unit_price')===[25000,25000] && array_column($fallbackSale['items'],'category')===['skm','skm_new'],'before shared pricing starts an eligible legacy good price applies equally to both typed stocks');
etRecord('price',['id'=>'et_unequal_price','skm_price'=>28000,'skm_new_price'=>35000,'cracked_price'=>19000,'effective_at'=>date('c',time()-60)]);
$before=businessSnapshot(); cmd('sale.create',array_replace($sale,['customer'=>'Unsafe unequal fallback']),$te,422);
check($before===businessSnapshot(),'unequal prior split prices block good sales rather than choosing an arbitrary rate');
cmd('production.create',['date'=>$etDay,'category'=>'cracked','eggs'=>20,'kg'=>1.2,'trays'=>0],$te);
$crackedSale=array_replace($sale,['customer'=>'Bentes while good not set','items'=>[['category'=>'cracked','eggs'=>1,'kg'=>0.06,'trays'=>0]]]);
$state=cmd('sale.create',$crackedSale,$te);
check(first($state,'sales',fn($s)=>$s['customer']===$crackedSale['customer'])['items'][0]['unit_price']===19000,'bentes keeps the latest record rate even when its good prices are ambiguous');
etRecord('price',['id'=>'et_equal_price','skm_price'=>29000,'skm_new_price'=>29000,'cracked_price'=>20000,'effective_at'=>date('c',time()-30)]);
$state=cmd('sale.create',array_replace($sale,['customer'=>'Equal split fallback']),$te);
check(array_column(first($state,'sales',fn($s)=>$s['customer']==='Equal split fallback')['items'],'unit_price')===[29000,29000],'equal older typed rates can safely serve as one shared good price');
$future=['good_price'=>33000,'cracked_price'=>0,'effective_at'=>date('c',strtotime('+1 day'))]; cmd('price.create',$future,$ta);
$state=cmd('sale.create',array_replace($sale,['customer'=>'Future shared not active']),$te);
check(array_column(first($state,'sales',fn($s)=>$s['customer']==='Future shared not active')['items'],'unit_price')===[29000,29000],'a future first shared-price update does not activate before its effective time');
foreach([['skm_price'=>30000,'skm_new_price'=>30000,'cracked_price'=>0],['good_price'=>0,'cracked_price'=>0],['good_price'=>30000,'cracked_price'=>-1],['good_price'=>30000,'skm_price'=>30000,'cracked_price'=>0]] as $bad) cmd('price.create',$bad+['effective_at'=>$etDay],$ta,422);
$shared=['good_price'=>31000,'cracked_price'=>22000,'effective_at'=>date('c',time()-10)];
$state=cmd('price.create',$shared,$ta); $activeShared=first($state,'prices',fn($p)=>($p['good_price']??null)===31000);
check($activeShared['pricing_mode']==='shared_good' && $activeShared['skm_price']===31000 && $activeShared['skm_new_price']===31000,'new price updates persist one shared rate and equal compatibility aliases');
etRecord('price',['id'=>'et_later_old_schedule','good_price'=>99000,'skm_price'=>80000,'skm_new_price'=>90000,'cracked_price'=>99000,'effective_at'=>date('c',time()-5)]);
$state=cmd('sale.create',array_replace($sale,['customer'=>'Shared overrides old schedule']),$te);
check(array_column(first($state,'sales',fn($s)=>$s['customer']==='Shared overrides old schedule')['items'],'unit_price')===[31000,31000],'an effective shared policy takes precedence over every later old-policy schedule');
$state=cmd('sale.create',array_replace($crackedSale,['customer'=>'Shared bentes rate']),$te);
check(first($state,'sales',fn($s)=>$s['customer']==='Shared bentes rate')['items'][0]['unit_price']===22000,'the bentes rate comes from the same authoritative shared record');
check(etStored($oldSale['id'])===$migratedSale && first($state,'sales',fn($s)=>$s['id']===$fallbackSale['id'])['items']===$fallbackSale['items'],'shared price changes never rewrite prior unit-price snapshots or payments');
$same=['good_price'=>32000,'cracked_price'=>0,'effective_at'=>date('c')];
$beforePrices=count($state['prices']); $state=cmd('price.create',$same,$ta); $firstId=first($state,'prices',fn($p)=>($p['good_price']??null)===32000)['id'];
$state=cmd('price.create',$same,$ta); $secondId=first($state,'prices',fn($p)=>($p['good_price']??null)===32000)['id'];
check(count($state['prices'])===$beforePrices+2 && $firstId!==$secondId && str_contains($state['notifications'][0]['message'],'Telur Bagus (SKM dan SKM Baru): Rp32.000/kg') && str_contains($state['notifications'][0]['message'],'Telur Bentes: Gratis (Rp0/kg)'),'equal shared-price saves still create distinct two-rate notifications');
$before=businessSnapshot(); cmd('sale.create',array_replace($sale,['items'=>[['category'=>'skm_new','eggs'=>30,'kg'=>3,'trays'=>0]]]),$te,422);
check($before===businessSnapshot(),'sharing a price does not pool SKM and SKM Baru stock');

$ctx=scState($tc)['stock_check_context']; $wrong=$ctx['warehouse']; $wrong['good']=['eggs'=>1,'kg'=>0.06,'trays'=>0];
cmd('stock_check.submit',['schema_version'=>2,'date'=>$etDay,'expected_snapshot'=>$ctx['snapshot'],'status'=>'pending','warehouse_actual'=>$wrong,'harvest_actual'=>$ctx['harvest'],'reason'=>'Kolom lama tidak boleh aktif'],$tc,422);
cmd('stock_check.submit',['date'=>$etDay,'expected_snapshot'=>$ctx['snapshot'],'status'=>'confirmed'],$tc,409);
$state=cmd('stock_check.submit',['schema_version'=>2,'date'=>$etDay,'expected_snapshot'=>$ctx['snapshot'],'status'=>'confirmed'],$tc);
check(scLatest($state,'et_checker')['status']==='confirmed' && scLatest($state,'et_checker')['warehouse_actual']['good']['eggs']===0,'a checker can recount after migration while obsolete good quantities remain forbidden');

// Explicit migration guard failures are atomic, and overflow is checked in exact grams.
$marker=etStored('schema_shared_good_v3'); $db->exec("UPDATE records SET data='{}' WHERE id='schema_shared_good_v3'"); $before=businessSnapshot(); $failed=false;
try { SharedGoodPriceMigration::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && businessSnapshot()===$before,'conflicting conversion markers are rejected without any partial changes');
$db->prepare("UPDATE records SET data=? WHERE id='schema_shared_good_v3'")->execute([json_encode($marker)]);
foreach(['production','sale','stock_check'] as $kind) {
    $id='et_after_marker_'.$kind;
    $record=$kind==='production'?array_replace($legacyProd,['id'=>$id,'stocked_at'=>null]):($kind==='sale'?array_replace($oldSale,['id'=>$id]):array_replace($pending,['id'=>$id]));
    etRecord($kind,$record); $before=businessSnapshot(); $failed=false;
    try { SharedGoodPriceMigration::migrate($db); } catch(RuntimeException $error) { $failed=true; }
    check($failed && businessSnapshot()===$before,'marker rerun detects reintroduced legacy '.$kind.' even when warehouse good remains zero');
    $db->prepare('DELETE FROM records WHERE id=?')->execute([$id]);
}
$version=$db->query('SELECT version FROM command_mutex WHERE id=1')->fetchColumn(); $db->exec('DELETE FROM command_mutex'); $before=businessSnapshot(); $failed=false;
try { SharedGoodPriceMigration::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && businessSnapshot()===$before,'conversion refuses to run without its global command mutex');
$db->prepare('INSERT INTO command_mutex(id,version) VALUES(1,?)')->execute([$version]);
$savedStocks=$db->query("SELECT stock_key,eggs,kg,trays FROM stock WHERE stock_key IN ('egg:good','egg:skm')")->fetchAll(PDO::FETCH_ASSOC);
$db->exec("DELETE FROM records WHERE id='schema_shared_good_v3'");
$db->exec("UPDATE stock SET eggs=1,kg=999999999999.999,trays=0 WHERE stock_key='egg:good'");
$db->exec("UPDATE stock SET eggs=1,kg=0.001,trays=0 WHERE stock_key='egg:skm'"); $before=businessSnapshot(); $failed=false;
try { SharedGoodPriceMigration::migrate($db); } catch(RuntimeException $error) { $failed=true; }
check($failed && businessSnapshot()===$before,'exact-gram overflow aborts the conversion before writing any business record');
foreach($savedStocks as $row) $db->prepare('UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key=?')->execute([$row['eggs'],$row['kg'],$row['trays'],$row['stock_key']]);
etRecord('production',array_replace($legacyProd,['id'=>'et_rollback_good']));
$db->exec("INSERT INTO records(id,kind,occurred_at,data) VALUES('et_invalid_json','production',NOW(),'broken-json')"); $before=businessSnapshot(); $failed=false;
try { SharedGoodPriceMigration::migrate($db); } catch(Throwable $error) { $failed=true; }
check($failed && businessSnapshot()===$before && etStored('et_rollback_good')['category']==='good','a malformed later record rolls back earlier category edits and the entire stock conversion');
$db->exec("DELETE FROM records WHERE id IN ('et_rollback_good','et_invalid_json')");
etRecord('schema',['id'=>'schema_shared_good_v3']+$marker);
