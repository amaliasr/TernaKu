<?php
/** Additive daily stock-check permission; no automatic appointments. */
final class StockCheckSchema {
    public static function migrate(PDO $db): void {
        $name='ternaku-stock-check-'.substr(hash('sha256',(string)$db->query('SELECT DATABASE()')->fetchColumn()),0,24);
        $q=$db->prepare('SELECT GET_LOCK(?,30)'); $q->execute([$name]);
        if((int)$q->fetchColumn()!==1) throw new RuntimeException('Pembaruan pemeriksaan stok sedang berjalan.');
        try {
            $exists=$db->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='can_check_stock'")->fetchColumn();
            if(!$exists) $db->exec('ALTER TABLE users ADD COLUMN can_check_stock TINYINT(1) NOT NULL DEFAULT 0');
        } finally { $q=$db->prepare('SELECT RELEASE_LOCK(?)'); $q->execute([$name]); }
    }
}
