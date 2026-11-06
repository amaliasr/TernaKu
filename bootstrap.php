<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
$expectedControl = '5d9ea14fd5974b37a116a4ed707b46da29fae3695c695fb6076e6198333f93b1';
$expectedGuard = '60ff64b67825c5990a31e0ffc02f0787064db7e6ec8b5d14db81bca7e123db9d';
$expectedOriginal = 'd112b73210c3837ef9f5ab207d901b992ce408c68377cf3d8940b82770733680';
$revision = '2bc905af24f0cb50e1944233a03500925c537755';
function checkCondition(bool $ok, string $reason): void {
    if (!$ok) throw new RuntimeException($reason);
}
function installExact(string $target, string $source, string $expected): void {
    checkCondition(!is_link($source) && !is_link($target)
        && hash_equals($expected, hash_file('sha256', $source)), 'Unexpected deployment file');
    if (is_file($target)) {
        checkCondition(hash_equals($expected, hash_file('sha256', $target)), 'Existing deployment file differs');
        return;
    }
    $scratch = tempnam(dirname($target), '.ternaku-install-');
    checkCondition($scratch !== false && dirname($scratch) === dirname($target), 'Cannot allocate file');
    try {
        checkCondition(copy($source, $scratch) && chmod($scratch, 0600)
            && hash_equals($expected, hash_file('sha256', $scratch))
            && rename($scratch, $target), 'Cannot install deployment file');
    } finally {
        if (file_exists($scratch)) unlink($scratch);
    }
}
try {
    $base = dirname(__DIR__, 2);
    $home = dirname($base, 4);
    checkCondition(__DIR__ === $home.'/domains/api.buildmanagement.id/public_html/ternaku/scripts/migration-20261106'
        && preg_match('~^/home/u[0-9]+$~D', $home) && realpath(__DIR__) === __DIR__, 'Unexpected target');
    $private = $home.'/.ternaku-vps-cutover';
    $config = $base.'/application/config';
    checkCondition(realpath($config) === $config, 'Unexpected app config location');
    $action = $argv[1] ?? '';
    if ($action === 'status' && count($argv) === 2) {
        $mode = is_file($config.'/ternaku-forward.flag') ? 'forward' : (is_file($config.'/ternaku-freeze.flag') ? 'freeze' : 'source');
        $saved = is_file($config.'/push-keys.php') ? require $config.'/push-keys.php' : [];
        $key = getenv('WEB_PUSH_PUBLIC_KEY');
        if ($key === false && is_file($base.'/.env')) {
            foreach (file($base.'/.env', FILE_IGNORE_NEW_LINES) as $line) {
                if (preg_match('/^\s*WEB_PUSH_PUBLIC_KEY\s*=\s*(.*)$/D', $line, $m)) { $key = trim($m[1], " \t\"'"); break; }
            }
        }
        $key = $key ?: ($saved['publicKey'] ?? '');
        echo 'TernaKu mode='.$mode.' guard='.(is_file($config.'/cutover.php') ? 'present' : 'pending')
            .' public-key-sha256='.($key ? hash('sha256', $key) : 'unconfigured')."\n";
        exit;
    }
    $id = $argv[2] ?? '';
    checkCondition(count($argv) === 3 && in_array($action, ['install','freeze','forward','source'], true)
        && preg_match('/^'.$action.'-20261106-[a-z0-9-]{1,30}$/D', $id), 'Invalid action or operation id');
    if (!is_dir($private)) {
        checkCondition($action === 'install' && mkdir($private, 0700), 'Private operator directory unavailable');
    }
    checkCondition(!is_link($private) && realpath($private) === $private && (fileperms($private) & 0077) === 0,
        'Unexpected operator directory permissions');
    if ($action === 'install') {
        $original = is_file($private.'/env.before-cutover.php') ? $private.'/env.before-cutover.php' : $base.'/scripts/env.php';
        checkCondition(hash_equals($expectedOriginal, hash('sha256', str_replace("\r\n", "\n", file_get_contents($original)))),
            'Original loader differs');
        installExact($private.'/control.php', __DIR__.'/control.php', $expectedControl);
        // With the copy already pinned and present, the private controller needs no outbound network.
        installExact($config.'/cutover.php', __DIR__.'/cutover.php', $expectedGuard);
    }
    checkCondition(is_file($private.'/control.php') && !is_link($private.'/control.php')
        && hash_equals($expectedControl, hash_file('sha256', $private.'/control.php')), 'Private controller differs');
    $argv = [$private.'/control.php', $action, $id, $revision];
    require $private.'/control.php';
} catch (Throwable $e) {
    fwrite(STDERR, 'TernaKu bootstrap stopped: '.$e->getMessage()."\n");
    exit(1);
}
