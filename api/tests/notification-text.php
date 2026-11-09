<?php
/** No database or device access; run with php api/tests/notification-text.php. */
if(PHP_SAPI!=='cli') exit;
$checks=0;
function check(bool $ok,string $message): void {
    global $checks;
    if(!$ok) throw new RuntimeException('FAIL '.$message);
    $checks++; echo 'PASS '.$message."\n";
}
try { require __DIR__.'/notification-text-checks.php'; echo "$checks notification text checks passed.\n"; }
catch(Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
