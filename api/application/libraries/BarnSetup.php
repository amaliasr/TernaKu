<?php
/** Explicit setup for the two chicken barns; existing production references stay intact. */
final class BarnSetup {
    public const NAMES = ['Kandang Depan','Kandang Utama'];
    private const LEGACY_NAME = 'Kandang Ayam Utama';

    public static function defaults(): array {
        return array_map(fn(string $name):array=>[
            'name'=>$name,'type'=>'ayam','capacity'=>0,'notes'=>'Sumber produksi telur; pilih sesuai kandang tempat panen.',
        ],self::NAMES);
    }

    private static function nameKey(string $name): string { return mb_strtolower(trim($name),'UTF-8'); }

    /** A preview performs only SELECTs. Unknown names are reported and never renamed. */
    public static function plan(PDO $db,bool $lock=false): array {
        $rows=$db->query("SELECT id,data FROM records WHERE kind='barn' ORDER BY id".($lock?' FOR UPDATE':''))->fetchAll(PDO::FETCH_ASSOC);
        $barns=[]; $byName=[];
        foreach($rows as $row) {
            $barn=json_decode($row['data'],true,512,JSON_THROW_ON_ERROR);
            if(!is_array($barn) || ($barn['id']??null)!==$row['id'] || !is_string($barn['name']??null) || !is_string($barn['type']??null)) {
                throw new RuntimeException('Data kandang '.$row['id'].' tidak lengkap. Periksa sebelum menyiapkan kandang.');
            }
            $barns[$row['id']]=$barn;
            $byName[self::nameKey($barn['name'])][]=$barn;
        }
        $plan=['create'=>[],'rename'=>[],'reuse'=>[],'unchanged'=>[]]; $used=[];
        foreach(self::NAMES as $name) {
            $matches=$byName[self::nameKey($name)]??[];
            if(count($matches)>1) throw new RuntimeException('Nama '.$name.' dipakai lebih dari satu kandang. Pilih ID yang benar terlebih dahulu; tidak ada data diubah.');
            if($matches) {
                $barn=$matches[0];
                if($barn['type']!=='ayam') throw new RuntimeException($name.' sudah dipakai kandang selain ayam. Tidak ada data diubah.');
                $plan['reuse'][]=['id'=>$barn['id'],'name'=>$barn['name']]; $used[$barn['id']]=true;
                continue;
            }
            if($name==='Kandang Utama') {
                $legacy=array_values(array_filter($barns,fn(array $barn):bool=>$barn['name']===self::LEGACY_NAME));
                if(count($legacy)>1) throw new RuntimeException('Kandang Ayam Utama ditemukan lebih dari satu. Pilih ID yang benar terlebih dahulu; tidak ada data diubah.');
                if($legacy) {
                    $barn=$legacy[0];
                    if($barn['type']!=='ayam') throw new RuntimeException('Kandang Ayam Utama bukan kandang ayam. Tidak ada data diubah.');
                    $plan['rename'][]=['id'=>$barn['id'],'from'=>$barn['name'],'to'=>$name]; $used[$barn['id']]=true;
                    continue;
                }
            }
            $plan['create'][]=$name;
        }
        foreach($barns as $barn) if(!isset($used[$barn['id']])) $plan['unchanged'][]=['id'=>$barn['id'],'name'=>$barn['name']];
        return $plan;
    }

    public static function apply(PDO $db): array {
        if($db->inTransaction()) throw new RuntimeException('Penyiapan kandang harus memulai transaksi tersendiri.');
        $db->beginTransaction();
        try {
            if($db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn()===false) throw new RuntimeException('Mutex transaksi belum tersedia. Periksa instalasi database.');
            $plan=self::plan($db,true); $before=[]; $after=[];
            foreach($plan['rename'] as $change) {
                $q=$db->prepare("SELECT data FROM records WHERE kind='barn' AND id=?"); $q->execute([$change['id']]);
                $barn=json_decode($q->fetchColumn(),true,512,JSON_THROW_ON_ERROR); $before[]=$barn;
                $barn['name']=$change['to'];
                $q=$db->prepare("UPDATE records SET data=? WHERE kind='barn' AND id=?");
                $q->execute([self::json($barn),$barn['id']]); $after[]=$barn;
            }
            foreach(self::defaults() as $default) if(in_array($default['name'],$plan['create'],true)) {
                $barn=['id'=>'barn_'.bin2hex(random_bytes(12))]+$default;
                $q=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES(?,'barn',NOW(),?)");
                $q->execute([$barn['id'],self::json($barn)]); $after[]=$barn;
            }
            $auditId=null;
            if($after) {
                $auditId='activity_'.bin2hex(random_bytes(12));
                $audit=['id'=>$auditId,'user_id'=>null,'actor_role'=>'system','action'=>'barn.setup','description'=>'Menyiapkan Kandang Depan dan Kandang Utama tanpa mengubah riwayat panen.',
                    'created_at'=>(new DateTimeImmutable('now',new DateTimeZone('Asia/Jakarta')))->format('Y-m-d\TH:i:s.uP'),'before'=>$before,'after'=>$after];
                $q=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES(?,'activity',NOW(),?)"); $q->execute([$auditId,self::json($audit)]);
                $db->exec('UPDATE command_mutex SET version=version+1 WHERE id=1');
            }
            $db->commit();
            return $plan+['changed'=>count($after),'audit_id'=>$auditId,'saved'=>array_map(fn(array $barn):array=>['id'=>$barn['id'],'name'=>$barn['name']],$after)];
        } catch(Throwable $error) { if($db->inTransaction()) $db->rollBack(); throw $error; }
    }
    private static function json(array $value): string { return json_encode($value,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); }
}
