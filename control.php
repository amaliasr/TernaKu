<?php
// CLI only. Run from a private directory above the api.buildmanagement.id document root.
if (PHP_SAPI !== 'cli') exit(1);
umask(0077);
const ORIGINAL_ENV_SHA = 'd112b73210c3837ef9f5ab207d901b992ce408c68377cf3d8940b82770733680';
const GUARD_SHA = '60ff64b67825c5990a31e0ffc02f0787064db7e6ec8b5d14db81bca7e123db9d';
function need($condition, string $description): void {
    if (!$condition) throw new RuntimeException($description);
}
function privateWrite(string $file, string $content, int $mode): void {
    need(!is_link($file), 'Unexpected symlink at target');
    $tmp = tempnam(dirname($file), '.ternaku-tmp-');
    need($tmp && realpath(dirname($tmp)) === realpath(dirname($file)), 'Cannot allocate private temporary file');
    try {
        need(file_put_contents($tmp, $content) === strlen($content), 'Cannot write file');
        need(chmod($tmp, $mode) && rename($tmp, $file), 'Cannot install file');
    } finally {
        if (file_exists($tmp)) unlink($tmp);
    }
}
function run(array $args): void {
    need(count($args) === 4, 'Usage: php control.php action operation-id revision');
    [, $action, $id, $revision] = $args;
    need(in_array($action, ['install','freeze','forward','source'], true), 'Unknown action');
    need(preg_match('/^[a-z0-9-]{12,90}$/D', $id) && preg_match('/^[a-f0-9]{40}$/D', $revision), 'Invalid operation or revision');
    $private = __DIR__;
    $home = dirname($private);
    need(basename($private) === '.ternaku-vps-cutover' && !is_link($private)
        && (fileperms($private) & 0077) === 0, 'Use a private mode 0700 operator directory');
    $base = $home.'/domains/api.buildmanagement.id/public_html/ternaku';
    need(realpath($base) === $base, 'Unexpected TernaKu root');
    foreach (['scripts','application/config','application/logs'] as $dir) {
        need(realpath($base.'/'.$dir) === $base.'/'.$dir, 'Unexpected TernaKu subdirectory');
    }
    $config = $base.'/application/config';
    $env = $base.'/scripts/env.php';
    $guard = $config.'/cutover.php';
    $backup = $private.'/env.before-cutover.php';
    $freeze = $config.'/ternaku-freeze.flag';
    $forward = $config.'/ternaku-forward.flag';
    $done = $private.'/done-'.$id;
    $lock = fopen($private.'/control.lock', 'c+');
    need($lock && flock($lock, LOCK_EX), 'Cannot lock operator directory');
    if (file_exists($done)) { echo "Operation already completed.\n"; return; }
    $original = is_file($backup) ? file_get_contents($backup) : file_get_contents($env);
    $normalized = str_replace("\r\n", "\n", $original);
    need(hash_equals(ORIGINAL_ENV_SHA, hash('sha256', $normalized)), 'Original env loader differs; manual review required');
    $patched = rtrim($original)."\nrequire_once dirname(__DIR__).'/application/config/cutover.php';\n";
    $current = file_get_contents($env);
    if ($action === 'install') {
        need(!is_file($freeze) && !is_file($forward), 'Refusing reinstall after mode transition');
        need($current === $original || $current === $patched, 'Live env loader differs');
        if (!is_file($backup)) privateWrite($backup, $original, 0600);
        if (!is_file($guard)) {
            $url = 'https://raw.githubusercontent.com/amaliasr/TernaKu/'.$revision.'/deploy/legacy/cutover.php';
            $curl = curl_init($url);
            curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => 25, CURLOPT_FAILONERROR => true]);
            $data = curl_exec($curl);
            need(is_string($data) && hash_equals(GUARD_SHA, hash('sha256', $data)), 'Pinned guard download failed');
            privateWrite($guard, $data, 0600);
        }
        need(hash_equals(GUARD_SHA, hash_file('sha256', $guard)), 'Guard digest differs');
        if ($current !== $patched) privateWrite($env, $patched, fileperms($env) & 0777);
    } else {
        need($current === $patched && is_file($guard) && hash_equals(GUARD_SHA, hash_file('sha256', $guard)), 'Guard not installed');
        if ($action === 'freeze') {
            if (!is_file($freeze)) privateWrite($freeze, "freeze\n", 0600);
            if (is_file($forward)) need(unlink($forward), 'Cannot stop forwarding');
        } elseif ($action === 'forward') {
            need(is_file($freeze), 'Source must be frozen before forwarding');
            if (!is_file($forward)) {
                $sessions = fopen($base.'/application/logs/ternaku-source.lock', 'c+');
                need($sessions && flock($sessions, LOCK_EX), 'Cannot confirm drain');
                privateWrite($forward, "forward\n", 0600);
                flock($sessions, LOCK_UN);
            }
        } else {
            need(!is_file($forward), 'Freeze forwarding and reconcile latest target data before returning to source');
            if (is_file($freeze)) need(unlink($freeze), 'Cannot clear source freeze');
        }
    }
    privateWrite($done, $action."\n", 0600); // Re-running the same cron never reverses a later action.
    echo "Operation completed: ".$action.".\n";
}
try { run($argv); }
catch (Throwable $error) { fwrite(STDERR, "Cutover action stopped: ".$error->getMessage()."\n"); exit(1); }
