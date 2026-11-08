<?php
/** Separate SKM stock identities with one shared good-egg selling price. */
final class EggTypes {
    public const ACTIVE = ['skm','skm_new','cracked'];
    public const ALL = ['skm','skm_new','cracked','good'];
    public const PRICE_FIELDS = ['skm'=>'good_price','skm_new'=>'good_price','cracked'=>'cracked_price','good'=>'good_price'];
    public const LABELS = ['skm'=>'Telur SKM','skm_new'=>'Telur SKM Baru','cracked'=>'Telur bentes','good'=>'Telur SKM'];
    public static function emptyInventory(): array { return array_fill_keys(self::ALL,['eggs'=>0,'kg'=>0.0,'trays'=>0]); }
    public static function priceMessage(array $price): string {
        if(($price['pricing_mode']??null)==='shared_good') {
            return 'Mulai '.date('d/m/Y H:i',strtotime($price['effective_at'])).' WIB: Telur bagus (SKM dan SKM Baru) Rp'.number_format($price['good_price'],0,',','.').'/kg; Telur bentes '.($price['cracked_price']==0?'Gratis':'Rp'.number_format($price['cracked_price'],0,',','.').'/kg').'.';
        }
        // Historical events keep their original pricing policy when explicitly re-enqueued.
        $parts=[];
        foreach(['skm'=>'skm_price','skm_new'=>'skm_new_price','cracked'=>'cracked_price','good'=>'good_price'] as $category=>$field) {
            if(!array_key_exists($field,$price)) continue;
            $parts[]=self::LABELS[$category].' '.($price[$field]==0?'Gratis':'Rp'.number_format($price[$field],0,',','.').'/kg');
        }
        return 'Mulai '.date('d/m/Y H:i',strtotime($price['effective_at'])).' WIB: '.implode('; ',$parts).'.';
    }
    public static function normalizeCommand(string $action,array $payload): array {
        if(in_array($action,['production.create','pickup.create','sale.create','stock.reconcile'],true)) {
            if(($payload['category']??null)==='good') $payload['category']='skm';
            if(isset($payload['items']) && is_array($payload['items'])) foreach($payload['items'] as &$item) {
                if(is_array($item) && ($item['category']??null)==='good') $item['category']='skm';
            }
            unset($item);
        }
        return $payload;
    }
}
