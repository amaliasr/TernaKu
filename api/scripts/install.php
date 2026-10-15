<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/env.php';
require dirname(__DIR__).'/application/libraries/FarmService.php';
try {
    if (PHP_VERSION_ID < 80100) throw new RuntimeException('PHP 8.1+ diperlukan; gunakan PHP 8.2 untuk versi yang telah diuji.');
    $farm=new FarmService(); $db=$farm->database();
    $sql=preg_replace('/^--.*$/m','',file_get_contents(dirname(__DIR__).'/schema.sql'));
    foreach(explode(';',$sql) as $statement) if(trim($statement)!=='') $db->exec($statement);
    if((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn()>0) { echo "Schema siap. Akun yang sudah ada tidak diubah.\n"; exit(0); }
    $email=getenv('ADMIN_EMAIL') ?: ''; $password=getenv('ADMIN_PASSWORD') ?: ''; $name=getenv('ADMIN_NAME') ?: 'Admin TernaKu';
    if(!filter_var($email,FILTER_VALIDATE_EMAIL) || strlen($password)<12) throw new RuntimeException('Set ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) di environment shell, lalu jalankan ulang. Tidak ada password bawaan.');
    $db->beginTransaction();
    $db->query('SELECT version FROM command_mutex WHERE id=1 FOR UPDATE')->fetchColumn();
    if((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn()>0) { $db->commit(); echo "Schema siap. Akun yang sudah ada tidak diubah.\n"; exit(0); }
    $id='user_'.bin2hex(random_bytes(12));
    $stmt=$db->prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,'admin')");
    $stmt->execute([$id,$name,strtolower($email),password_hash($password,PASSWORD_DEFAULT)]);
    $barn=['id'=>'barn_'.bin2hex(random_bytes(12)),'name'=>'Kandang Ayam Utama','type'=>'ayam','capacity'=>0,'notes'=>'Sumber produksi awal; kelola sesuai kondisi peternakan.'];
    $stmt=$db->prepare("INSERT INTO records(id,kind,occurred_at,data) VALUES(?,'barn',NOW(),?)"); $stmt->execute([$barn['id'],json_encode($barn)]);
    $db->commit(); echo "Instalasi berhasil. Admin pertama dibuat; tetapkan harga telur di aplikasi sebelum mencatat penjualan.\n";
} catch(Throwable $e) { if(isset($db) && $db->inTransaction()) $db->rollBack(); fwrite(STDERR,"Instalasi gagal: ".$e->getMessage()."\n"); exit(1); }
