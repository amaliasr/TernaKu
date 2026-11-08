<?php
/** Stored projections keep photo processing out of repeated dashboard reads. */
final class PerformanceSchema {
    public static function compactExpression(): string {
        $sql='data';
        foreach(['$.photo','$.before.photo','$.after.photo'] as $path) {
            // MariaDB may return NULL when a nested path is absent.
            $sql="IF(JSON_CONTAINS_PATH(data,'one','$path'),JSON_REMOVE($sql,'$path'),$sql)";
        }
        return "IF(JSON_VALID(data),$sql,data)";
    }
    public static function migrate(PDO $db): void {
        $lock='ternaku-projection-'.substr(hash('sha256',(string)$db->query('SELECT DATABASE()')->fetchColumn()),0,32);
        $stmt=$db->prepare('SELECT GET_LOCK(?,30)'); $stmt->execute([$lock]);
        if((int)$stmt->fetchColumn()!==1) throw new RuntimeException('Pembaruan data ringkas sedang berjalan.');
        try {
            $columns=$db->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='records'")->fetchAll(PDO::FETCH_COLUMN);
            $add=[];
            if(!in_array('compact_data',$columns,true)) $add[]='ADD COLUMN compact_data LONGTEXT GENERATED ALWAYS AS ('.self::compactExpression().') STORED';
            if(!in_array('photo_version',$columns,true)) $add[]="ADD COLUMN photo_version CHAR(64) GENERATED ALWAYS AS (IF(JSON_VALID(data),SHA2(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data,'$.photo')),''),256),NULL)) STORED";
            if($add) $db->exec('ALTER TABLE records '.implode(', ',$add));
        } finally {
            $stmt=$db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$lock]);
        }
    }
}
