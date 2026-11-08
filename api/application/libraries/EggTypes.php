<?php
/** Leaf stock identities. Legacy good is never an aggregate or an inferred new type. */
final class EggTypes {
    public const ACTIVE = ['skm','skm_new','cracked'];
    public const ALL = ['skm','skm_new','cracked','good'];
    public const PRICE_FIELDS = ['skm'=>'skm_price','skm_new'=>'skm_new_price','cracked'=>'cracked_price','good'=>'good_price'];
    public const LABELS = ['skm'=>'Telur SKM','skm_new'=>'Telur SKM Baru','cracked'=>'Telur bentes','good'=>'Telur bagus lama (belum dipilah)'];
    public static function emptyInventory(): array { return array_fill_keys(self::ALL,['eggs'=>0,'kg'=>0.0,'trays'=>0]); }
    public static function priceMessage(array $price): string {
        $parts=[];
        foreach(self::ALL as $category) {
            $field=self::PRICE_FIELDS[$category];
            if(!array_key_exists($field,$price)) continue;
            $parts[]=self::LABELS[$category].' '.($price[$field]==0?'Gratis':'Rp'.number_format($price[$field],0,',','.').'/kg');
        }
        return 'Mulai '.date('d/m/Y H:i',strtotime($price['effective_at'])).' WIB: '.implode('; ',$parts).'.';
    }
}
