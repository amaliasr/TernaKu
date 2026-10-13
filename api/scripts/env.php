<?php
// Minimal env loader. Never exposes secrets or overwrites server environment.
$envFile = dirname(__DIR__) . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        [$name, $value] = explode('=', $line, 2);
        $name = trim($name);
        if (preg_match('/^[A-Z][A-Z0-9_]*$/', $name) && getenv($name) === false) {
            putenv($name . '=' . trim(trim($value), "\"'"));
        }
    }
}
date_default_timezone_set('Asia/Jakarta');
