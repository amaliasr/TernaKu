<?php
/** Daily employee counts and an admin-reviewed, concurrency-safe warehouse reconciliation. */
trait StockCheckWorkflow {
    private function canCheckStock(): bool { return $this->actor['role']==='employee' && !empty($this->actor['can_check_stock']); }
    private function stockCheckToday(): string { return (new DateTimeImmutable('now',new DateTimeZone('Asia/Jakarta')))->format('Y-m-d'); }
    private function stockCheckTomorrow(): string { return (new DateTimeImmutable($this->stockCheckToday(),new DateTimeZone('Asia/Jakarta')))->modify('+1 day')->format('Y-m-d').' 00:00:00'; }
    private function stockCheckReadStart(): string { return (new DateTimeImmutable($this->stockCheckToday(),new DateTimeZone('Asia/Jakarta')))->modify('-29 days')->format('Y-m-d').' 00:00:00'; }
    private function stockCheckRecordUsers(array $state): array {
        $ids=[]; foreach(array_merge($state['productions'],$state['sales']) as $record) if($record['user_id']!==$this->actor['id']) $ids[$record['user_id']]=true;
        if(!$ids) return $state['users'];
        $users=$state['users'];
        $rows=$this->query('SELECT id,name,role,active FROM users WHERE id IN ('.implode(',',array_fill(0,count($ids),'?')).') ORDER BY name',array_keys($ids))->fetchAll(PDO::FETCH_ASSOC);
        foreach($rows as $u) $users[]=['id'=>$u['id'],'name'=>$u['name'],'email'=>'','role'=>$u['role'],'active'=>(bool)$u['active'],'target'=>0,'photo'=>''];
        return $users;
    }
    private function stockCheckAssignment(string $id,bool $assigned): void {
        $this->insert('stock_check_assignment',['id'=>$this->id('assignment'),'user_id'=>$id,'assigned'=>$assigned,'created_at'=>$this->now(),'created_by'=>$this->actor['id']]);
    }
    private function stockCheckQuantities(array $p,string $field): array {
        $values=$p[$field]??null;
        if(!is_array($values) || count($values)!==2 || array_diff(array_keys($values),['good','cracked'])) throw new ApiProblem('Isi jumlah telur bagus dan bentes untuk '.($field==='warehouse_actual'?'gudang.':'panen hari ini.'));
        $out=[];
        foreach(['good','cracked'] as $category) {
            $q=$values[$category]??null;
            if(!is_array($q) || count($q)!==3 || array_diff(array_keys($q),['eggs','kg','trays'])) throw new ApiProblem('Isi butir, berat, dan krat pada setiap kategori.');
            $q=$this->countedEggStock($q);
            if(($q['eggs']===0)!==($q['kg']===0.0)) throw new ApiProblem('Butir dan berat harus sama-sama nol atau sama-sama terisi.');
            $out[$category]=$q;
        }
        return $out;
    }
    private function stockCheckSame(array $a,array $b): bool {
        foreach(['good','cracked'] as $c) foreach(['eggs','kg','trays'] as $k) if(round((float)$a[$c][$k]-(float)$b[$c][$k],3)!=0) return false;
        return true;
    }
    private function stockCheckDayProductions(string $date): array {
        $until=(new DateTimeImmutable($date,new DateTimeZone('Asia/Jakarta')))->modify('+1 day')->format('Y-m-d').' 00:00:00';
        $rows=$this->query("SELECT compact_data FROM records WHERE kind='production' AND occurred_at>=? AND occurred_at<? ORDER BY id",[$date.' 00:00:00',$until])->fetchAll(PDO::FETCH_COLUMN);
        return array_map(fn($r)=>json_decode($r,true,512,JSON_THROW_ON_ERROR),$rows);
    }
    private function stockCheckPhysicalCursor(): int {
        return (int)$this->query("SELECT sequence FROM records WHERE kind IN ('production','pickup','sale','stock_movement') OR (kind='activity' AND IF(JSON_VALID(compact_data),JSON_UNQUOTE(JSON_EXTRACT(compact_data,'$.action')),'')='correction.apply') ORDER BY sequence DESC LIMIT 1")->fetchColumn();
    }
    private function stockCheckDetails(string $date,?array $warehouse=null): array {
        $rows=$this->stockCheckDayProductions($date); $harvest=['good'=>['eggs'=>0,'kg'=>0.0,'trays'=>0],'cracked'=>['eggs'=>0,'kg'=>0.0,'trays'=>0]]; $productions=[];
        foreach($rows as $r) {
            foreach(['eggs','kg','trays'] as $key) $harvest[$r['category']][$key]=round($harvest[$r['category']][$key]+$r[$key],3);
            $productions[]=['id'=>$r['id'],'category'=>$r['category'],'eggs'=>(int)$r['eggs'],'kg'=>(float)$r['kg'],'trays'=>(int)$r['trays'],'stocked'=>$this->productionStocked($r)];
        }
        foreach($harvest as &$q) { $q['eggs']=(int)$q['eggs']; $q['trays']=(int)$q['trays']; } unset($q);
        $warehouse=$warehouse??$this->stockBalances(true)['inventory']; $cursor=$this->stockCheckPhysicalCursor();
        $snapshot=hash('sha256',$this->json([$date,$warehouse,$productions,$cursor]));
        return ['date'=>$date,'snapshot'=>$snapshot,'warehouse'=>$warehouse,'harvest'=>$harvest,'productions'=>$productions,'movement_sequence'=>$cursor];
    }
    private function stockCheckContext(string $date,?array $warehouse=null): array {
        $context=$this->stockCheckDetails($date,$warehouse); unset($context['productions'],$context['movement_sequence']); return $context;
    }
    private function submitStockCheck(array $p): void {
        if(!$this->canCheckStock()) throw new ApiProblem('Pemeriksaan ini hanya untuk karyawan yang ditunjuk admin.',403);
        if(array_diff(array_keys($p),['date','expected_snapshot','status','warehouse_actual','harvest_actual','reason'])) throw new ApiProblem('Kolom pemeriksaan tidak didukung.');
        $date=$this->text($p,'date',10,true);
        if($date!==$this->stockCheckToday()) throw new ApiProblem('Pemeriksaan hanya dapat diisi untuk hari ini (WIB). Muat ulang setelah pergantian hari.',409);
        $status=$this->enum($p,'status',['confirmed','pending']); $snapshot=$this->text($p,'expected_snapshot',64,true);
        $context=$this->stockCheckDetails($date);
        if(!hash_equals($context['snapshot'],$snapshot)) throw new ApiProblem('Catatan panen atau stok berubah. Muat ulang dan hitung kembali sebelum mengirim.',409);
        $old=null;
        foreach($this->records('stock_check',$this->actor['id']) as $record) if($record['date']===$date && $record['status']!=='superseded') { $old=$record; break; }
        if($old && in_array($old['status'],['confirmed','approved'],true)) throw new ApiProblem('Pemeriksaan hari ini sudah selesai.',409);
        $warehouse=$status==='confirmed'?$context['warehouse']:$this->stockCheckQuantities($p,'warehouse_actual');
        $harvest=$status==='confirmed'?$context['harvest']:$this->stockCheckQuantities($p,'harvest_actual');
        if($status==='confirmed' && (array_key_exists('warehouse_actual',$p) || array_key_exists('harvest_actual',$p))) throw new ApiProblem('Untuk hitungan berbeda, pilih laporkan selisih.');
        $reason=$status==='pending'?$this->reason($p):$this->text($p,'reason',1000);
        if($status==='pending' && $this->stockCheckSame($warehouse,$context['warehouse']) && $this->stockCheckSame($harvest,$context['harvest'])) throw new ApiProblem('Hitungan sudah sama. Pilih Sudah sesuai untuk mengonfirmasi.');
        $now=$this->now();
        $check=$this->insert('stock_check',['id'=>$this->id('check'),'user_id'=>$this->actor['id'],'date'=>$date,'status'=>$status,'snapshot'=>$snapshot,'expected'=>['warehouse'=>$context['warehouse'],'harvest'=>$context['harvest']],'warehouse_actual'=>$warehouse,'harvest_actual'=>$harvest,'production_ids'=>array_column($context['productions'],'id'),'movement_sequence'=>$context['movement_sequence'],'reason'=>$reason,'created_at'=>$now,'updated_at'=>$now,'reviewed_at'=>null,'reviewed_by'=>null,'review_reason'=>'']);
        if($old) { $old['status']='superseded'; $old['replaced_by']=$check['id']; $old['updated_at']=$now; $this->save('stock_check',$old); }
        $this->audit('stock_check.submit',$status==='confirmed'?'Mengonfirmasi panen dan gudang sudah sesuai':'Melaporkan selisih panen dan gudang',null,$check);
    }
    private function reviewStockCheck(array $p): void {
        $this->admin();
        if(array_diff(array_keys($p),['id','decision','reason'])) throw new ApiProblem('Kolom peninjauan tidak didukung.');
        $id=$this->text($p,'id',40,true); $decision=$this->enum($p,'decision',['approve','reject']);
        $check=$this->record('stock_check',$id,true);
        if($check['status']!=='pending') throw new ApiProblem('Pemeriksaan ini sudah diproses atau diganti dengan hitungan baru.',409);
        $before=$check; $reason=$decision==='reject'?$this->reason($p):$this->text($p,'reason',1000);
        if($decision==='approve') {
            $current=$this->stockCheckDetails($check['date']);
            if(array_column($current['productions'],'id')!==$check['production_ids']) throw new ApiProblem('Ada catatan panen baru setelah pemeriksaan. Minta karyawan menghitung ulang.',409);
            if(!$this->stockCheckSame($current['harvest'],$check['harvest_actual'])) throw new ApiProblem('Koreksi catatan panen satu per satu dahulu hingga totalnya sama dengan hasil hitung karyawan.',409);
            $expected=$check['expected']['warehouse']; $ids=array_fill_keys($check['production_ids'],true);
            $rows=$this->query("SELECT kind,compact_data FROM records WHERE sequence>? AND (kind IN ('production','pickup','sale','stock_movement') OR (kind='activity' AND IF(JSON_VALID(compact_data),JSON_UNQUOTE(JSON_EXTRACT(compact_data,'$.action')),'')='correction.apply')) ORDER BY sequence",[$check['movement_sequence']])->fetchAll(PDO::FETCH_ASSOC);
            foreach($rows as $row) {
                $r=json_decode($row['compact_data'],true,512,JSON_THROW_ON_ERROR);
                if($row['kind']==='stock_movement' && ($r['kind']??'')==='correction' && isset($ids[$r['reference_id']??''])) {
                    foreach(['eggs','kg','trays'] as $k) $expected[$r['category']][$k]=round($expected[$r['category']][$k]+$r[$k],3);
                    // Corrections preserve the stock ledger's informational tray floor.
                    $expected[$r['category']]['trays']=max(0,$expected[$r['category']]['trays']);
                    continue;
                }
                if($row['kind']==='activity' && ($r['actor_role']??'')==='admin' && isset($ids[$r['before']['id']??'']) && ($r['after']['id']??'')===($r['before']['id']??'')) continue;
                throw new ApiProblem('Ada pergerakan stok atau perubahan lain setelah pemeriksaan. Minta hitungan terbaru agar transaksi baru tetap aman.',409);
            }
            if(!$this->stockCheckSame($expected,$current['warehouse'])) throw new ApiProblem('Stok sudah berubah di luar koreksi panen yang diperiksa. Minta hitungan terbaru.',409);
            $now=$this->now();
            foreach(['good','cracked'] as $category) {
                $target=$check['warehouse_actual'][$category]; $was=$current['warehouse'][$category];
                $this->query('UPDATE stock SET eggs=?,kg=?,trays=? WHERE stock_key=?',[$target['eggs'],number_format($target['kg'],3,'.',''),$target['trays'],'egg:'.$category]);
                $this->insert('stock_movement',['id'=>$this->id('movement'),'user_id'=>$this->actor['id'],'category'=>$category,'kind'=>'reconcile','method'=>'count','reference_id'=>$id,'date'=>$now,'created_at'=>$now,'eggs'=>$target['eggs']-$was['eggs'],'kg'=>round($target['kg']-$was['kg'],3),'trays'=>$target['trays']-$was['trays'],'expected'=>$was,'physical'=>$target,'notes'=>'Persetujuan pemeriksaan harian: '.$check['reason']]);
            }
        }
        $check['status']=$decision==='approve'?'approved':'rejected'; $check['reviewed_at']=$this->now(); $check['updated_at']=$check['reviewed_at']; $check['reviewed_by']=$this->actor['id']; $check['review_reason']=$reason;
        $this->save('stock_check',$check);
        $this->audit('stock_check.review',$decision==='approve'?'Menyetujui pemeriksaan dan mencocokkan stok gudang':'Menolak pemeriksaan untuk dihitung ulang',$before,$check);
    }
}
