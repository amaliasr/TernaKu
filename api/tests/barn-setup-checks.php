<?php
require_once dirname(__DIR__).'/application/libraries/BarnSetup.php';
function barnFixture(string $id,string $name,array $extra=[]): array {
    global $db;
    $barn=['id'=>$id,'name'=>$name]+$extra+['type'=>'ayam','capacity'=>0,'notes'=>''];
    $q=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES(?,'barn','2026-01-01 00:00:00',?)"); $q->execute([$id,json_encode($barn,JSON_THROW_ON_ERROR)]);
    return $barn;
}
function barnSetupRejected(string $message): void {
    global $db; $before=businessSnapshot(); $failed=false;
    try { BarnSetup::apply($db); } catch(Throwable $error) { $failed=true; }
    check($failed && !$db->inTransaction() && businessSnapshot()===$before,$message);
}
resetTestDatabase();
$legacyBarn=barnFixture('barn_original','Kandang Ayam Utama',['capacity'=>7000,'notes'=>'Catatan pemilik dipertahankan','extra_label'=>'nilai lama']);
barnFixture('barn_custom','Kandang Milik Tetangga');
$barnInsert=$db->prepare('INSERT INTO records(id,kind,occurred_at,data) VALUES(?,?,NOW(),?)');
foreach([
    ['production',['id'=>'historical_named','barn_id'=>'barn_original','eggs'=>13,'kg'=>0.7,'photo'=>'data:image/history','date'=>'2025-01-01']],
    ['production',['id'=>'historical_blank','barn_id'=>'','eggs'=>27,'kg'=>1.5,'photo'=>'data:image/blank','date'=>'2025-01-02']],
    ['sale',['id'=>'historical_sale','items'=>[['unit_price'=>29000,'kg'=>1.1]],'total'=>31900,'paid'=>20000]],
    ['feed_usage',['id'=>'historical_feed','barn_id'=>'barn_original','quantity'=>5]],
] as [$kind,$record]) $barnInsert->execute([$record['id'],$kind,json_encode($record,JSON_THROW_ON_ERROR)]);
$db->exec("UPDATE stock SET eggs=40,kg=2.2,trays=1 WHERE stock_key='egg:skm'");
$protectedBarnRows=$db->query("SELECT id,data FROM records WHERE kind<>'barn' OR id='barn_custom' ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR);
$barnStock=$db->query('SELECT * FROM stock ORDER BY stock_key')->fetchAll(PDO::FETCH_ASSOC);
$barnPreviewBefore=businessSnapshot(); $barnPlan=BarnSetup::plan($db);
check($barnPlan['create']===['Kandang Depan'] && $barnPlan['rename']===[['id'=>'barn_original','from'=>'Kandang Ayam Utama','to'=>'Kandang Utama']]
    && $barnPlan['unchanged']===[['id'=>'barn_custom','name'=>'Kandang Milik Tetangga']] && businessSnapshot()===$barnPreviewBefore,'barn preview reports only the exact default rename and missing front barn without writes');
$barnApplied=BarnSetup::apply($db);
$renamedBarn=json_decode($db->query("SELECT data FROM records WHERE id='barn_original'")->fetchColumn(),true);
check($barnApplied['changed']===2 && $renamedBarn===array_replace($legacyBarn,['name'=>'Kandang Utama'])
    && (int)$db->query("SELECT COUNT(*) FROM records WHERE kind='barn'")->fetchColumn()===3,'barn setup preserves original ID and every non-name field while adding only the missing barn');
check($protectedBarnRows===$db->query("SELECT id,data FROM records WHERE kind NOT IN ('barn','activity') OR id='barn_custom' ORDER BY id")->fetchAll(PDO::FETCH_KEY_PAIR)
    && $barnStock===$db->query('SELECT * FROM stock ORDER BY stock_key')->fetchAll(PDO::FETCH_ASSOC),'barn setup preserves blank/named historical harvest, photos, financial records, feed references, extra barns and all stock byte-for-byte');
$barnAudit=json_decode($db->query("SELECT data FROM records WHERE kind='activity'")->fetchColumn(),true);
check($barnAudit['action']==='barn.setup' && $barnAudit['actor_role']==='system' && $barnAudit['user_id']===null
    && $barnAudit['before']===[$legacyBarn] && count($barnAudit['after'])===2,'barn setup writes one explicit system audit with original and saved barn values');
$barnAfter=businessSnapshot(); $rerunBarn=BarnSetup::apply($db);
check($rerunBarn['changed']===0 && $rerunBarn['audit_id']===null && count($rerunBarn['reuse'])===2 && businessSnapshot()===$barnAfter,'repeated barn setup changes no IDs, audits, version counters or business data');

resetTestDatabase();
barnFixture('barn_existing_front',' kandang depan '); barnFixture('barn_existing_main','KANDANG UTAMA'); barnFixture('barn_legacy_extra','Kandang Ayam Utama');
$barnAfter=businessSnapshot(); $caseResult=BarnSetup::apply($db);
check($caseResult['changed']===0 && count($caseResult['reuse'])===2 && $caseResult['unchanged']===[['id'=>'barn_legacy_extra','name'=>'Kandang Ayam Utama']]
    && businessSnapshot()===$barnAfter,'case-normalized canonical barns are reused without renaming them or an extra legacy barn');

resetTestDatabase();
barnFixture('barn_other','Kandang Belakang'); barnFixture('barn_similar','kandang ayam utama');
$unknownResult=BarnSetup::apply($db);
check($unknownResult['changed']===2 && count($unknownResult['unchanged'])===2 && !$unknownResult['rename']
    && (int)$db->query("SELECT COUNT(*) FROM records WHERE kind='barn'")->fetchColumn()===4,'unknown and merely similar names stay unchanged instead of guessing which barn they identify');

resetTestDatabase();
barnFixture('barn_duplicate_1','Kandang Utama'); barnFixture('barn_duplicate_2',' kandang utama ');
barnSetupRejected('ambiguous canonical duplicates abort before adding a missing barn');
resetTestDatabase();
barnFixture('barn_duplicate_1','Kandang Ayam Utama'); barnFixture('barn_duplicate_2','Kandang Ayam Utama');
barnSetupRejected('duplicate legacy default names abort without guessing a historical ID');
resetTestDatabase();
barnFixture('barn_wrong_type','Kandang Depan',['type'=>'sapi']);
barnSetupRejected('a canonical name used for another animal type is not repurposed');
resetTestDatabase();
$db->exec('DELETE FROM command_mutex');
barnSetupRejected('missing command mutex prevents setup without partial writes');
resetTestDatabase();
$db->exec("INSERT INTO records(id,kind,occurred_at,data) VALUES('barn_invalid','barn',NOW(),'{broken')");
barnSetupRejected('malformed existing barn data fails closed without creating replacements');
resetTestDatabase();
barnFixture('barn_original','Kandang Ayam Utama');
$db->exec("CREATE TRIGGER barn_test_audit_failure BEFORE INSERT ON records FOR EACH ROW BEGIN IF NEW.kind='activity' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fixture audit failure'; END IF; END");
try { barnSetupRejected('audit failure rolls back the rename and created barn together'); }
finally { $db->exec('DROP TRIGGER barn_test_audit_failure'); }
