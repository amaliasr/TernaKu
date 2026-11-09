<?php
/** Allowlisted, bounded notification text shared by inbox and device delivery. */
final class NotificationText {
    public static function dateTime(mixed $value): string { return self::time($value,'event'); }
    public static function businessDate(mixed $value): string { return self::time($value,'business'); }
    private static function time(mixed $value,string $mode): string {
        if(!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/D',$value,$m)) return '-';
        if(!checkdate((int)$m[2],(int)$m[3],(int)$m[1])) return '-';
        $dateOnly=!isset($m[4]) || $m[4]==='';
        $hour=$dateOnly?0:(int)$m[4]; $minute=$dateOnly?0:(int)$m[5]; $second=(int)($m[6]??0);
        if($hour>23 || $minute>59 || $second>59) return '-';
        $zone=$m[8]??'';
        if($zone!=='' && $zone!=='Z' && ((int)substr($zone,1,2)>23 || (int)substr($zone,4,2)>59)) return '-';
        try {
            $date=new DateTimeImmutable(sprintf('%s-%s-%sT%02d:%02d:%02d%s',$m[1],$m[2],$m[3],$hour,$minute,$second,$zone!==''?$zone:'+07:00'));
            $date=$date->setTimezone(new DateTimeZone('Asia/Jakarta'));
        } catch(Exception $e) { return '-'; }
        if($dateOnly && $mode!=='effective') return $date->format('d/m/Y').($mode==='event'?' (jam tidak tercatat)':'');
        return $date->format('d/m/Y H:i:s').' WIB';
    }
    public static function actor(string $name): string {
        $first=preg_split('/\s+/u',trim($name),2)[0]??'';
        // Validate the whole first token before shortening it; emails and phone numbers stay private.
        return preg_match("/^\p{L}[\p{L}\p{M}.'’\-]*$/uD",$first) ? mb_substr($first,0,32,'UTF-8') : 'Petugas';
    }
    private static function number(mixed $value): float {
        return (is_float($value)||is_int($value)) && is_finite((float)$value) && $value>=0 ? (float)$value : 0.0;
    }
    private static function decimal(mixed $value,int $digits=3): string {
        $text=number_format(self::number($value),$digits,',','.');
        return $digits>0?rtrim(rtrim($text,'0'),','):$text;
    }
    private static function rupiah(mixed $value): string { return 'Rp'.self::decimal($value,0); }
    private static function bounded(array $lines): string {
        $message=implode("\n",$lines);
        return mb_strlen($message,'UTF-8')<=1000?$message:mb_substr($message,0,997,'UTF-8').'...';
    }
    private static function quantities(array $items): array {
        $empty=['eggs'=>0,'grams'=>0,'trays'=>0,'estimated'=>false];
        $byType=['skm'=>$empty,'skm_new'=>$empty,'cracked'=>$empty]; $total=$empty;
        foreach($items as $item) {
            $type=$item['category']??''; if($type==='good') $type='skm';
            if(!isset($byType[$type])) continue;
            $eggs=self::number($item['eggs']??0); $grams=round(self::number($item['kg']??0)*1000); $trays=self::number($item['trays']??0);
            $estimated=($item['eggs_estimated']??false)===true;
            foreach([$type,'total'] as $key) {
                if($key==='total') $target=&$total; else $target=&$byType[$key];
                $target['eggs']+=$eggs; $target['grams']+=$grams; $target['trays']+=$trays; $target['estimated']=$target['estimated']||$estimated;
                unset($target);
            }
        }
        $line=fn(string $label,array $q):string=>$label.': '.self::decimal($q['eggs'],0).' butir'.($q['estimated']?' (perkiraan)':'').', '.self::decimal($q['grams']/1000).' kg, '.self::decimal($q['trays'],0).' krat';
        return [$line('SKM',$byType['skm']),$line('SKM Baru',$byType['skm_new']),$line('Bentes',$byType['cracked']),$line('Jumlah',$total)];
    }
    private static function invoice(mixed $value): string {
        return is_string($value) && preg_match('/^(?:TK-\d{8}-[a-f0-9]{8}|TRX-\d{8}-\d{4,20})$/iD',$value)?$value:'Belum tercatat';
    }
    /** Details are selected field-by-field. Customer, contact, notes, location and media never enter the text. */
    public static function activity(string $activity,array $details,string $actorName,string $eventAt): array {
        $who=self::actor($actorName); $recorded='Tercatat: '.self::dateTime($eventAt);
        $items=$details['items']??(isset($details['category'])?[$details]:[]);
        if($activity==='sale.create') {
            $methods=['cash'=>'Tunai','transfer'=>'Transfer','qris'=>'QRIS','credit'=>'Piutang'];
            $statuses=['paid'=>'Lunas','partial'=>'Sebagian','unpaid'=>'Belum lunas'];
            return ['title'=>'Penjualan telur','message'=>self::bounded(array_merge([
                "$who mencatat penjualan.",'Nota: '.self::invoice($details['number']??null),
                'Transaksi: '.self::businessDate($details['date']??null),$recorded,
            ],self::quantities($items),[
                'Total penjualan: '.self::rupiah($details['total']??0),
                'Dibayar: '.self::rupiah($details['paid']??0),
                'Sisa tagihan: '.self::rupiah($details['balance']??0),
                'Pembayaran: '.(self::number($details['total']??0)==0?'Gratis':($statuses[$details['payment_status']??'']??'Belum lunas')).' | '.($methods[$details['payment_method']??'']??'-'),
                'Stok: '.(($details['stock_source']??'')==='warehouse'?'Gudang':'Bawaan karyawan'),
            ]))];
        }
        [$title,$action,$status]=match($activity) {
            'production.create'=>['Panen tercatat','mencatat panen','Menunggu diterima'],
            'production.stocked'=>['Panen masuk gudang','mencatat panen','Sudah masuk'],
            'production.receive'=>['Panen diterima di gudang','menerima panen di gudang','Sudah masuk'],
            'pickup.return'=>['Telur kembali ke gudang','mengembalikan telur ke gudang','Sudah masuk'],
            'stock.add'=>['Stok gudang bertambah','menambah stok gudang','Sudah masuk'],
        };
        return ['title'=>$title,'message'=>self::bounded(array_merge(["$who $action."],
            str_starts_with($activity,'production.')?['Tanggal panen: '.self::businessDate($details['date']??null)]:[],
            [$recorded],self::quantities($items),['Gudang: '.$status]))];
    }
    public static function price(array $price,string $actorName): array {
        return ['title'=>'Harga telur diperbarui','message'=>self::bounded([
            self::actor($actorName).' memperbarui harga telur.',
            'Disimpan: '.self::dateTime($price['created_at']??null),
            'Mulai berlaku: '.self::time($price['effective_at']??null,'effective'),
            'Telur Bagus (SKM dan SKM Baru): '.(isset($price['good_price'])?self::rupiah($price['good_price']).'/kg':'Belum diatur'),
            'Telur Bentes: '.(isset($price['cracked_price']) && $price['cracked_price']==0?'Gratis (Rp0/kg)':self::rupiah($price['cracked_price']??0).'/kg'),
        ])];
    }
}
