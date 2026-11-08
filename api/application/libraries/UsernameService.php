<?php
/** Username rules shared by account writes, installer and the explicit schema upgrade. */
final class UsernameService {
    public static function normalize(mixed $value): string {
        if (!is_string($value)) throw new InvalidArgumentException('Username harus berupa teks.');
        $username=strtolower(trim($value));
        if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/D',$username)) {
            throw new InvalidArgumentException('Username harus 3–32 karakter, diawali huruf atau angka. Gunakan huruf, angka, titik, garis bawah, atau tanda minus.');
        }
        return $username;
    }
    public static function available(PDO $db,string $username,?string $exceptId=null): bool {
        $query=$db->prepare('SELECT id FROM users WHERE username=?'.($exceptId!==null?' AND id<>?':''));
        $query->execute($exceptId===null?[$username]:[$username,$exceptId]);
        return !$query->fetchColumn();
    }
    public static function generate(PDO $db,string $email): string {
        $base=strtolower(explode('@',$email,2)[0]);
        $base=preg_replace('/[^a-z0-9._-]/','',$base);
        $base=preg_replace('/^[^a-z0-9]+/','',$base);
        $base=substr($base,0,32);
        if(strlen($base)<3) $base='user'.($base!==''?'.'.$base:'');
        $candidate=$base;
        for($suffix=2;!self::available($db,$candidate);$suffix++) {
            $ending='.'.(string)$suffix;
            $candidate=substr($base,0,32-strlen($ending)).$ending;
        }
        return $candidate;
    }
    /** Run explicitly before activating new API code; never from a normal HTTP request. */
    public static function migrate(PDO $db): int {
        $lock='ternaku-usernames-'.substr(hash('sha256',(string)$db->query('SELECT DATABASE()')->fetchColumn()),0,32);
        $stmt=$db->prepare('SELECT GET_LOCK(?,30)'); $stmt->execute([$lock]);
        if((int)$stmt->fetchColumn()!==1) throw new RuntimeException('Pembaruan username sedang berjalan. Coba kembali.');
        try {
            $column=$db->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='username'")->fetchColumn();
            if(!$column) $db->exec('ALTER TABLE users ADD COLUMN username VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER email, ADD UNIQUE KEY users_username_unique (username)');
            $index=$db->query("SELECT COUNT(*) FROM (SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND NON_UNIQUE=0 GROUP BY INDEX_NAME HAVING COUNT(*)=1 AND MIN(COLUMN_NAME)='username') AS username_indexes")->fetchColumn();
            if(!$index) $db->exec('ALTER TABLE users ADD UNIQUE KEY users_username_unique (username)');
            $db->beginTransaction();
            $db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
            $users=$db->query("SELECT id,email FROM users WHERE username IS NULL OR username='' ORDER BY created_at,id FOR UPDATE")->fetchAll(PDO::FETCH_ASSOC);
            $update=$db->prepare('UPDATE users SET username=? WHERE id=?');
            foreach($users as $user) $update->execute([self::generate($db,$user['email']),$user['id']]);
            $db->commit();
            return count($users);
        } catch(Throwable $e) {
            if($db->inTransaction()) $db->rollBack();
            throw $e;
        } finally {
            $stmt=$db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$lock]);
        }
    }
}
