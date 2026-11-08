<?php
/** Disposable database only: verify stored projections and measure repeat read cost. */
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/scripts/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
require dirname(__DIR__).'/application/libraries/PerformanceSchema.php';
if(getenv('ALLOW_TEST_RESET')!=='1' || !preg_match('/^[a-zA-Z0-9_]+_test$/D',getenv('DB_NAME')?:'')) exit("Dedicated test database required.\n");
$db=(new FarmService())->database();
$checks=0;
function verifyProjection(bool $ok,string $message): void {
    global $checks; if(!$ok) throw new RuntimeException($message); $checks++; echo "PASS $message\n";
}
try {
    $original=$db->query('SELECT id,SHA2(data,256) FROM records ORDER BY id')->fetchAll(PDO::FETCH_NUM);
    $db->exec('ALTER TABLE records DROP COLUMN compact_data, DROP COLUMN photo_version');
    PerformanceSchema::migrate($db); PerformanceSchema::migrate($db);
    verifyProjection($original===$db->query('SELECT id,SHA2(data,256) FROM records ORDER BY id')->fetchAll(PDO::FETCH_NUM),'repeated projection migration preserves every source record byte');
    $insert=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES(?,'perf_fixture',NOW(),?)");
    $insert->execute(['perf_invalid','not-json']);
    $invalid=$db->query("SELECT compact_data,photo_version FROM records WHERE id='perf_invalid'")->fetch(PDO::FETCH_ASSOC);
    verifyProjection($invalid===['compact_data'=>'not-json','photo_version'=>null],'projection migration tolerates malformed legacy JSON without exposing restricted rows');
    $photo='data:image/jpeg;base64,'.str_repeat('AAAA',16384);
    $cases=[[],['photo'=>''],['before'=>'text'],['after'=>['photo'=>$photo,'name'=>'history']],['before'=>['photo'=>$photo],'after'=>['name'=>'retained']],['photo'=>$photo,'before'=>['photo'=>$photo],'after'=>['photo'=>$photo,'name'=>'kept']]];
    foreach($cases as $i=>$extra) {
        $record=['id'=>'perf_'.$i,'name'=>'Kept record']+$extra;
        $insert->execute([$record['id'],json_encode($record)]);
        $stmt=$db->prepare('SELECT compact_data,photo_version,data FROM records WHERE id=?');$stmt->execute([$record['id']]);$row=$stmt->fetch(PDO::FETCH_ASSOC);
        $expected=$record;unset($expected['photo']);
        foreach(['before','after'] as $key) if(isset($expected[$key]) && is_array($expected[$key])) unset($expected[$key]['photo']);
        verifyProjection(json_decode($row['compact_data'],true)===$expected,'compact data removes only documented photo paths in case '.$i);
        verifyProjection($row['photo_version']===(empty($record['photo'])?null:hash('sha256',$record['photo'])),'stored media version matches existing SHA-256 reference in case '.$i);
        verifyProjection(json_decode($row['data'],true)===$record,'full record retains original media in case '.$i);
    }
    $updated=['id'=>'perf_5','name'=>'Updated','photo'=>''];
    $db->prepare('UPDATE records SET data=? WHERE id=?')->execute([json_encode($updated),'perf_5']);
    verifyProjection($db->query("SELECT photo_version FROM records WHERE id='perf_5'")->fetchColumn()===null,'photo removal invalidates its version immediately');
    for($i=10;$i<60;$i++) $insert->execute(['perf_'.$i,json_encode(['id'=>'perf_'.$i,'photo'=>$photo,'before'=>['photo'=>$photo],'after'=>['photo'=>$photo]])]);
    $legacy=PerformanceSchema::compactExpression();
    $measure=function(string $projection) use($db): array {
        $start=microtime(true);$rows=$db->query("SELECT $projection FROM records WHERE kind='perf_fixture' ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
        return ['ms'=>round((microtime(true)-$start)*1000,3),'rows'=>$rows];
    };
    $before=$measure($legacy);$after=$measure('compact_data');
    verifyProjection($before['rows']===$after['rows'],'stored compact projection matches legacy response exactly');
    echo 'READ_TIMING ',json_encode(['legacy_ms'=>$before['ms'],'stored_ms'=>$after['ms'],'fixture_count'=>count($after['rows'])]),"\n";
    echo "$checks performance projection checks passed.\n";
} finally {
    $db->exec("DELETE FROM records WHERE kind='perf_fixture'");
}
