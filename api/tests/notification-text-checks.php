<?php
/** Pure formatter checks, also included in the isolated integration suite. */
require_once dirname(__DIR__).'/application/libraries/NotificationText.php';
$noticeMoment='2026-11-09T03:04:05.123456Z';
$noticePrice=['good_price'=>28000,'cracked_price'=>0,'created_at'=>$noticeMoment,'effective_at'=>'2026-11-10'];
$noticeExpected="Amalia memperbarui harga telur.\nDisimpan: 09/11/2026 10:04:05 WIB\nMulai berlaku: 10/11/2026 00:00:00 WIB\nTelur Bagus (SKM dan SKM Baru): Rp28.000/kg\nTelur Bentes: Gratis (Rp0/kg)";
check(NotificationText::price($noticePrice,'Amalia Safira')['message']===$noticeExpected,'price notice includes actor, exact saved/effective WIB time and shared/free prices');
$noticeZone=date_default_timezone_get();
try {
    foreach(['UTC','America/New_York','Asia/Tokyo'] as $zone) {
        date_default_timezone_set($zone);
        check(NotificationText::dateTime($noticeMoment)==='09/11/2026 10:04:05 WIB'
            && NotificationText::dateTime('2026-11-09 10:04:05')==='09/11/2026 10:04:05 WIB'
            && NotificationText::price($noticePrice,'Amalia Safira')['message']===$noticeExpected,'notification timezone stays WIB under server zone '.$zone);
    }
} finally { date_default_timezone_set($noticeZone); }
check(NotificationText::dateTime('2026-11-09')==='09/11/2026 (jam tidak tercatat)'
    && NotificationText::businessDate('2026-11-09')==='09/11/2026'
    && NotificationText::dateTime('2026-11-09T23:59:59-05:00')==='10/11/2026 11:59:59 WIB','date-only business dates do not invent event time and explicit offsets convert across midnight');
foreach(['tomorrow','2026-02-30','2026-11-09T24:00:00Z','2026-11-09T00:00:60Z','2026-11-09T00:00:00+24:00',null] as $invalid)
    check(NotificationText::dateTime($invalid)==='-','invalid or missing notification timestamps stay visibly unknown');
check(NotificationText::actor(str_repeat('界',40).' Nama')===str_repeat('界',32)
    && NotificationText::actor('Amalia Safira')==='Amalia'
    && NotificationText::actor(str_repeat('a',40).'@mail.example')==='Petugas'
    && NotificationText::actor('+628123456789')==='Petugas','actor first names are safely limited before private identifiers can enter notifications');
$noticeSale=['number'=>'TK-20261109-a12b34c5','date'=>'2026-11-08','total'=>89400,'paid'=>40000,'balance'=>49400,'payment_method'=>'cash','payment_status'=>'partial','stock_source'=>'warehouse',
    'customer'=>'RAHASIA pelanggan','customer_phone'=>'RAHASIA kontak','notes'=>'RAHASIA catatan','photo'=>'data:image/RAHASIA','location'=>'RAHASIA lokasi',
    'items'=>[
        ['category'=>'skm','eggs'=>10,'kg'=>0.6,'trays'=>1],
        ['category'=>'good','eggs'=>7,'kg'=>0.4,'trays'=>0,'eggs_estimated'=>true],
        ['category'=>'skm_new','eggs'=>12,'kg'=>0.75,'trays'=>1],
        ['category'=>'cracked','eggs'=>5,'kg'=>0.3,'trays'=>0],
    ]];
$noticeSaleText=NotificationText::activity('sale.create',$noticeSale,'Amalia Safira',$noticeMoment);
check($noticeSaleText===['title'=>'Penjualan telur','message'=>"Amalia mencatat penjualan.\nNota: TK-20261109-a12b34c5\nTransaksi: 08/11/2026\nTercatat: 09/11/2026 10:04:05 WIB\nSKM: 17 butir (perkiraan), 1 kg, 1 krat\nSKM Baru: 12 butir, 0,75 kg, 1 krat\nBentes: 5 butir, 0,3 kg, 0 krat\nJumlah: 34 butir (perkiraan), 2,05 kg, 2 krat\nTotal penjualan: Rp89.400\nDibayar: Rp40.000\nSisa tagihan: Rp49.400\nPembayaran: Sebagian | Tunai\nStok: Gudang"],'sale notice aggregates types, labels estimated eggs and separates business date, recording time and payment details');
check(!str_contains(json_encode($noticeSaleText),'RAHASIA') && !str_contains(json_encode($noticeSaleText),'data:image'),'customer, contact, notes, photos and location never enter notification text');
$noticeFree=NotificationText::activity('sale.create',array_replace($noticeSale,['number'=>'buyer@example.com','total'=>0,'paid'=>0,'balance'=>0,'stock_source'=>'pickup','payment_method'=>'credit','payment_status'=>'paid']),'operator@example.com',$noticeMoment)['message'];
check(str_starts_with($noticeFree,'Petugas mencatat penjualan.') && str_contains($noticeFree,'Nota: Belum tercatat') && str_contains($noticeFree,'Pembayaran: Gratis | Piutang') && str_ends_with($noticeFree,'Stok: Bawaan karyawan') && !str_contains($noticeFree,'@'),'unsafe invoice/name fields stay private; free sales and carried stock stay explicit');
foreach(['production.create'=>'Menunggu diterima','production.stocked'=>'Sudah masuk','production.receive'=>'Sudah masuk'] as $activity=>$status) {
    $text=NotificationText::activity($activity,['date'=>'2026-11-08','items'=>$noticeSale['items']],'Amalia Safira',$noticeMoment)['message'];
    check(str_contains($text,"Tanggal panen: 08/11/2026\nTercatat: 09/11/2026 10:04:05 WIB") && str_contains($text,'Jumlah: 34 butir (perkiraan), 2,05 kg, 2 krat') && str_ends_with($text,'Gudang: '.$status),'harvest notice shows separate dates, type quantities and stock status for '.$activity);
}
foreach(['pickup.return','stock.add'] as $activity) {
    $text=NotificationText::activity($activity,['date'=>'2020-01-01','category'=>'skm','eggs'=>3,'kg'=>0.18,'trays'=>0],'Amalia',$noticeMoment)['message'];
    check(str_contains($text,'Jumlah: 3 butir, 0,18 kg, 0 krat') && str_contains($text,'Tercatat: 09/11/2026 10:04:05 WIB') && !str_contains($text,'2020'),'warehouse notice uses only actual event time and changed quantities for '.$activity);
}
$noticeMaximum=$noticeSale;
$noticeMaximum['items']=array_map(fn($i)=>['category'=>['skm','skm_new','cracked'][$i%3],'eggs'=>100000000,'kg'=>1000000,'trays'=>1000000,'eggs_estimated'=>true],range(0,99));
$noticeMaximum['number']='TRX-20261109-12345678901234567890';
$noticeMaximum['total']=1000000000000; $noticeMaximum['paid']=999999999999; $noticeMaximum['balance']=1;
$noticeMax=NotificationText::activity('sale.create',$noticeMaximum,str_repeat('界',40),$noticeMoment);
$noticePayload=['type'=>'farm.activity','id'=>'event_'.str_repeat('a',24),'tag'=>'farm-event_'.str_repeat('a',24),'activity'=>'sale.create','title'=>$noticeMax['title'],'body'=>$noticeMax['message'],'url'=>'/'];
$noticeNative=$noticePayload+['aps'=>['alert'=>['title'=>$noticePayload['title'],'body'=>$noticePayload['body']],'sound'=>'default']];
check(mb_strlen($noticeMax['message'],'UTF-8')<=1000 && str_ends_with($noticeMax['message'],'Stok: Gudang')
    && strlen(json_encode($noticePayload))<3000 && strlen(json_encode($noticeNative))<3800
    && count(array_filter($noticePayload,'is_array'))===0,'maximum quantities, money and Unicode actor retain every detail within Web Push/APNs budgets and flat FCM payload');
