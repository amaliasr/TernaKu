<?php
/** Add leaf balances without relabeling, reallocating or rewriting historical eggs. */
final class EggTypesSchema {
    public static function migrate(PDO $db): void {
        $db->beginTransaction();
        try {
            if($db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn()===false) throw new RuntimeException('Mutex transaksi belum tersedia. Periksa instalasi database.');
            if(count($db->query("SELECT stock_key FROM stock WHERE stock_key IN ('egg:good','egg:cracked') FOR UPDATE")->fetchAll(PDO::FETCH_COLUMN))!==2) throw new RuntimeException('Saldo stok lama belum lengkap. Tidak ada data yang diubah.');
            $raw=$db->query("SELECT data FROM records WHERE id='schema_egg_types_v2' AND kind='schema' FOR UPDATE")->fetchColumn();
            if($raw!==false) {
                $existing=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
                if(($existing['version']??null)!==2 || ($existing['legacy_category']??null)!=='good' || ($existing['legacy_policy']??null)!=='unclassified') throw new RuntimeException('Penanda jenis telur tidak sesuai. Periksa migrasi sebelumnya.');
            } elseif($db->query("SELECT id FROM records WHERE id='schema_egg_types_v2'")->fetchColumn()!==false) throw new RuntimeException('ID penanda migrasi sudah dipakai data lain.');
            $changed=$db->exec("INSERT IGNORE INTO stock(stock_key,eggs,kg,trays) VALUES('egg:skm',0,0,0),('egg:skm_new',0,0,0)")>0;
            $marker=['version'=>2,'legacy_category'=>'good','legacy_policy'=>'unclassified','created_at'=>date('c')];
            if($raw===false) {
                $q=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES('schema_egg_types_v2','schema',NOW(),?)");
                $q->execute([json_encode($marker,JSON_THROW_ON_ERROR)]); $changed=true;
            }
            if($changed) $db->exec('UPDATE command_mutex SET version=version+1 WHERE id=1');
            $db->commit();
        } catch(Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
    }
}
