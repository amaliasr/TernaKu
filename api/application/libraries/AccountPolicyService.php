<?php
/** Explicit, additive account-policy upgrade and owner protection. Never run DDL on login. */
final class AccountPolicyService {
    public static function migrate(PDO $db): void {
        $lock='ternaku-account-policy-'.substr(hash('sha256',(string)$db->query('SELECT DATABASE()')->fetchColumn()),0,24);
        $stmt=$db->prepare('SELECT GET_LOCK(?,30)'); $stmt->execute([$lock]);
        if((int)$stmt->fetchColumn()!==1) throw new RuntimeException('Pembaruan akun sedang berjalan. Coba kembali.');
        try {
            $columns=$db->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'")->fetchAll(PDO::FETCH_COLUMN);
            $changes=[];
            if(!in_array('is_superadmin',$columns,true)) $changes[]='ADD COLUMN is_superadmin TINYINT(1) NOT NULL DEFAULT 0';
            if(!in_array('deleted_at',$columns,true)) $changes[]='ADD COLUMN deleted_at DATETIME NULL';
            if($changes) $db->exec('ALTER TABLE users '.implode(', ',$changes));
        } finally { $stmt=$db->prepare('SELECT RELEASE_LOCK(?)'); $stmt->execute([$lock]); }
    }
    public static function protect(PDO $db,string $id,string $expectedEmail): bool {
        if(!preg_match('/^[A-Za-z0-9_-]{1,40}$/D',$id) || !filter_var($expectedEmail,FILTER_VALIDATE_EMAIL)) throw new RuntimeException('ID dan email akun tujuan wajib diisi dengan tepat.');
        $db->beginTransaction();
        try {
            $db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
            $q=$db->prepare('SELECT id,name,email,role,active,is_superadmin,deleted_at FROM users WHERE id=? FOR UPDATE'); $q->execute([$id]); $user=$q->fetch(PDO::FETCH_ASSOC);
            if(!$user || strtolower($user['email'])!==strtolower(trim($expectedEmail))) throw new RuntimeException('ID dan email tidak cocok. Tidak ada akun yang diubah.');
            if(!$user['active'] || $user['deleted_at']!==null) throw new RuntimeException('Akun tujuan harus aktif dan belum dihapus.');
            $q=$db->prepare("SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.status')) FROM records WHERE kind='registration' AND user_id=? LIMIT 1"); $q->execute([$id]); $status=$q->fetchColumn();
            if($status!==false && $status!=='approved') throw new RuntimeException('Akun tujuan harus sudah disetujui.');
            $q=$db->prepare('SELECT id FROM users WHERE is_superadmin=1 AND id<>? LIMIT 1'); $q->execute([$id]);
            if($q->fetchColumn()) throw new RuntimeException('Superadmin lain sudah dilindungi. Tidak ada perubahan.');
            if($user['is_superadmin']) { $db->commit(); return false; }
            $db->prepare("UPDATE users SET role='admin',is_superadmin=1 WHERE id=?")->execute([$id]);
            // Existing admins only gain protection, so their current sessions remain valid.
            if($user['role']!=='admin') $db->prepare('DELETE FROM tokens WHERE user_id=?')->execute([$id]);
            $record=['id'=>'activity_'.bin2hex(random_bytes(12)),'user_id'=>$id,'action'=>'user.superadmin','description'=>'Menetapkan akun superadmin yang dilindungi','created_at'=>date('c'),'before'=>['id'=>$id,'role'=>$user['role'],'is_superadmin'=>false],'after'=>['id'=>$id,'role'=>'admin','is_superadmin'=>true]];
            $db->prepare("INSERT INTO records(id,kind,user_id,occurred_at,data) VALUES(?,'activity',?,NOW(),?)")->execute([$record['id'],$id,json_encode($record,JSON_THROW_ON_ERROR)]);
            $db->exec('UPDATE command_mutex SET version=version+1 WHERE id=1');
            $db->commit(); return true;
        } catch(Throwable $e) { if($db->inTransaction()) $db->rollBack(); throw $e; }
    }
}
