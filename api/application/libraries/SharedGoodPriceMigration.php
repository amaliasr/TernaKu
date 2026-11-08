<?php
/** Explicit conversion authorized by the owner; the ordinary installer never calls this. */
final class SharedGoodPriceMigration {
    private const MARKER = 'schema_shared_good_v3';
    private static function json(array $value): string { return json_encode($value,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); }
    private static function counts(array $counts): array {
        $result=EggTypes::emptyInventory();
        foreach(EggTypes::ALL as $type) if(isset($counts[$type])) $result[$type]=$counts[$type];
        foreach(['eggs','kg','trays'] as $field) {
            $value=($result['skm'][$field]??0)+($result['good'][$field]??0);
            $result['skm'][$field]=$field==='kg'?round($value,3):(int)$value;
        }
        $result['good']=['eggs'=>0,'kg'=>0.0,'trays'=>0];
        return $result;
    }
    private static function grams(string $decimal): int {
        if(!preg_match('/^(\d{1,12})(?:\.(\d{1,3}))?$/D',$decimal,$parts)) throw new RuntimeException('Saldo kilogram tidak valid. Migrasi dibatalkan.');
        return (int)$parts[1]*1000+(int)str_pad($parts[2]??'',3,'0');
    }
    private static function hasLegacyBusinessRows(PDO $db): bool {
        $countPaths=[];
        foreach(['warehouse_actual','harvest_actual','expected.warehouse','expected.harvest'] as $path) foreach(['eggs','kg','trays'] as $field) $countPaths[]="COALESCE(JSON_EXTRACT(compact_data,'$.".$path.".good.".$field."'),0)<>0";
        $sql="SELECT id FROM records WHERE (kind IN ('production','pickup','stock_movement') AND JSON_UNQUOTE(JSON_EXTRACT(compact_data,'$.category'))='good')"
            ." OR (kind='sale' AND JSON_SEARCH(compact_data,'one','good',NULL,'$.items[*].category') IS NOT NULL)"
            ." OR (kind='stock_check' AND (".implode(' OR ',$countPaths).")) LIMIT 1";
        return $db->query($sql)->fetchColumn()!==false;
    }
    public static function migrate(PDO $db): bool {
        $db->beginTransaction();
        try {
            if($db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn()===false) throw new RuntimeException('Mutex transaksi belum tersedia.');
            $raw=$db->query("SELECT kind,data FROM records WHERE id='".self::MARKER."' FOR UPDATE")->fetch(PDO::FETCH_ASSOC);
            if($raw) {
                $marker=json_decode($raw['data'],true,512,JSON_THROW_ON_ERROR);
                if($raw['kind']!=='schema' || ($marker['version']??null)!==3 || ($marker['legacy_policy']??null)!=='legacy_to_skm' || ($marker['pricing_mode']??null)!=='shared_good') throw new RuntimeException('Penanda migrasi tidak cocok. Tidak ada perubahan.');
                if((int)$db->query("SELECT COUNT(*) FROM stock WHERE stock_key='egg:good' AND eggs=0 AND kg=0 AND trays=0")->fetchColumn()!==1) throw new RuntimeException('Stok bagus lama muncul kembali setelah migrasi. Periksa sumber perubahan sebelum melanjutkan.');
                if(self::hasLegacyBusinessRows($db)) throw new RuntimeException('Catatan bagus lama muncul kembali setelah migrasi. Hentikan penulis lama dan periksa datanya.');
                $db->commit(); return false;
            }
            $stock=$db->query("SELECT stock_key,eggs,kg,trays FROM stock WHERE stock_key IN ('egg:good','egg:skm','egg:skm_new','egg:cracked') FOR UPDATE")->fetchAll(PDO::FETCH_ASSOC);
            $balances=[]; foreach($stock as $row) $balances[substr($row['stock_key'],4)]=array_intersect_key($row,array_flip(['eggs','kg','trays']));
            if(count($balances)!==4) throw new RuntimeException('Jalankan migrasi jenis telur dasar terlebih dahulu agar empat saldo tersedia.');
            foreach($balances as $balance) if(!ctype_digit((string)$balance['eggs']) || !ctype_digit((string)$balance['trays'])) throw new RuntimeException('Saldo butir atau krat tidak valid. Tidak ada perubahan.');
            $eggs=(int)$balances['skm']['eggs']+(int)$balances['good']['eggs']; $trays=(int)$balances['skm']['trays']+(int)$balances['good']['trays'];
            $grams=self::grams($balances['skm']['kg'])+self::grams($balances['good']['kg']);
            if(!is_int($eggs) || !is_int($trays) || $eggs<0 || $trays<0 || $grams>999999999999999) throw new RuntimeException('Saldo gabungan melebihi kapasitas database. Tidak ada perubahan.');
            $kg=intdiv($grams,1000).'.'.str_pad((string)($grams%1000),3,'0',STR_PAD_LEFT);
            $now=date('c'); $counts=[]; $beforeHash=hash_init('sha256'); $afterHash=hash_init('sha256'); $cursor=0;
            $update=$db->prepare('UPDATE records SET data=? WHERE id=?');
            do {
                // Bounded batches keep old embedded photos out of an unbounded migration buffer.
                $q=$db->prepare("SELECT id,sequence,kind,data FROM records WHERE sequence>? AND kind IN ('production','pickup','sale','stock_movement','stock_check') ORDER BY sequence LIMIT 20");
                $q->execute([$cursor]); $rows=$q->fetchAll(PDO::FETCH_ASSOC);
                foreach($rows as $row) {
                    $cursor=(int)$row['sequence']; $r=json_decode($row['data'],true,512,JSON_THROW_ON_ERROR); $before=$r;
                    if(in_array($row['kind'],['production','pickup','stock_movement'],true) && ($r['category']??null)==='good') $r['category']='skm';
                    if($row['kind']==='sale') foreach($r['items'] as &$item) { if(($item['category']??null)==='good') $item['category']='skm'; } unset($item);
                    if($row['kind']==='stock_check') {
                        foreach(['warehouse_actual','harvest_actual'] as $field) if(isset($r[$field])) $r[$field]=self::counts($r[$field]);
                        foreach(['warehouse','harvest'] as $field) if(isset($r['expected'][$field])) $r['expected'][$field]=self::counts($r['expected'][$field]);
                        if(($r['status']??null)==='pending') {
                            $r['status']='rejected'; $r['migration_invalidated_at']=$now; $r['updated_at']=$now; $r['reviewed_at']=$now; $r['reviewed_by']=null;
                            $r['review_reason']='Telur bagus lama sudah digabungkan ke SKM. Lakukan pemeriksaan baru dengan hitungan terbaru.';
                        }
                    }
                    if($r===$before) continue;
                    $encoded=self::json($r); if($encoded===$row['data']) continue; $update->execute([$encoded,$row['id']]);
                    $counts[$row['kind']]=($counts[$row['kind']]??0)+1;
                    hash_update($beforeHash,$row['id'].'|'.$row['kind'].'|'.hash('sha256',$row['data'])."\n");
                    hash_update($afterHash,$row['id'].'|'.$row['kind'].'|'.hash('sha256',$encoded)."\n");
                }
            } while(count($rows)===20);
            $db->prepare("UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key='egg:skm'")->execute([$eggs,$kg,$trays]);
            $db->exec("UPDATE stock SET eggs=0,kg=0,trays=0 WHERE stock_key='egg:good'");
            $afterBalances=$balances; $afterBalances['skm']=['eggs'=>(string)$eggs,'kg'=>$kg,'trays'=>(string)$trays]; $afterBalances['good']=['eggs'=>'0','kg'=>'0.000','trays'=>'0'];
            $proof=['changed_by_kind'=>$counts,'before_records_sha256'=>hash_final($beforeHash),'after_records_sha256'=>hash_final($afterHash)];
            $audit=['id'=>'migration_shared_good_v3','user_id'=>null,'actor_role'=>'system','action'=>'schema.legacy_to_skm','description'=>'Menggabungkan semua telur bagus lama ke SKM dan memakai satu harga telur bagus','created_at'=>$now,'before'=>['inventory'=>$balances],'after'=>['inventory'=>$afterBalances]+$proof];
            $marker=['version'=>3,'legacy_policy'=>'legacy_to_skm','pricing_mode'=>'shared_good','created_at'=>$now,'audit_id'=>$audit['id']]+$proof;
            $insert=$db->prepare('INSERT INTO records(id,kind,occurred_at,data) VALUES(?,?,NOW(),?)');
            // No stock movement: historical movements were already re-keyed into SKM above.
            $insert->execute([$audit['id'],'activity',self::json($audit)]); $insert->execute([self::MARKER,'schema',self::json($marker)]);
            $db->exec('UPDATE command_mutex SET version=version+1 WHERE id=1'); $db->commit(); return true;
        } catch(Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
    }
}
