<?php
// Legacy shared-host API only. Load from scripts/env.php after the existing env loader.
final class TernaKuLegacyCutover
{
    private const HOST = 'ternaku.rstudiohub.com';
    private const PORT = 443;
    private const ADDRESS = '82.29.161.209';
    private const LIMIT = 3000000;
    private static $sourceLock;

    public static function enter(): void
    {
        $lock = @fopen(__DIR__.'/../logs/ternaku-source.lock', 'c+');
        if (!$lock || !flock($lock, LOCK_SH)) {
            if (PHP_SAPI !== 'cli') self::cors();
            self::unavailable();
        }
        clearstatcache();
        $freeze = is_file(__DIR__.'/ternaku-freeze.flag');
        $forward = is_file(__DIR__.'/ternaku-forward.flag');
        if (!$freeze && !$forward) {
            self::$sourceLock = $lock; // Held for the lifetime of this entire HTTP or CLI invocation.
            if (PHP_SAPI !== 'cli') {
                header('X-TernaKu-Legacy-Mode: source-guarded');
                if (strtok($_SERVER['REQUEST_URI'] ?? '', '?') === '/ternaku/health') {
                    $file = __DIR__.'/push-keys.php';
                    $saved = is_file($file) ? require $file : [];
                    $public = getenv('WEB_PUSH_PUBLIC_KEY') ?: ($saved['publicKey'] ?? '');
                    if (is_string($public) && $public !== '') header('X-TernaKu-Push-Fingerprint: '.hash('sha256', $public));
                }
            }
            return;
        }
        flock($lock, LOCK_UN);
        if (PHP_SAPI === 'cli') { fclose($lock); exit(0); }
        self::cors();
        if ($freeze && $forward) {
            fclose($lock);
            header('X-TernaKu-Legacy-Mode: forward');
            self::proxy();
        }
        $drained = $freeze && flock($lock, LOCK_EX | LOCK_NB);
        if ($drained) flock($lock, LOCK_UN);
        fclose($lock);
        header('X-TernaKu-Legacy-Mode: freeze');
        header('X-TernaKu-Source-Drained: '.($drained ? 'yes' : 'no'));
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            http_response_code(204);
            header('Cache-Control: no-store');
            exit;
        }
        self::unavailable();
    }

    private static function cors(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = array_map('trim', explode(',', getenv('ALLOWED_ORIGINS') ?: 'https://ternaku.rstudiohub.com'));
        header('Vary: Origin');
        if ($origin === '') return;
        if (!in_array($origin, $allowed, true)) self::error(403, 'Origin tidak diizinkan.');
        header('Access-Control-Allow-Origin: '.$origin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Max-Age: 600');
    }

    private static function unavailable(): never
    {
        if (PHP_SAPI === 'cli') exit(1);
        header('Retry-After: 30');
        self::error(503, 'TernaKu sedang memindahkan data. Coba lagi sebentar.');
    }

    private static function error(int $status, string $message): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    private static function proxy(): never
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (!in_array($method, ['GET', 'POST', 'OPTIONS'], true)) {
            header('Allow: GET, POST, OPTIONS');
            self::error(405, 'Metode tidak diizinkan.');
        }
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        if (!preg_match('~^/ternaku(?:/index\.php)?((?:/[a-zA-Z0-9_-]+)*/?)(\?[^\x00-\x20\x7f#]{0,2048})?$~D', $uri, $m)) {
            self::error(404, 'Endpoint tidak ditemukan.');
        }
        $path = '/ternaku/'.ltrim($m[1], '/').($m[2] ?? '');
        $headers = [];
        $incoming = [
            'Accept' => $_SERVER['HTTP_ACCEPT'] ?? '',
            'Content-Type' => $_SERVER['CONTENT_TYPE'] ?? '',
            'Authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
            'Origin' => $_SERVER['HTTP_ORIGIN'] ?? '',
            'Access-Control-Request-Method' => $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'] ?? '',
            'Access-Control-Request-Headers' => $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? '',
            'If-None-Match' => $_SERVER['HTTP_IF_NONE_MATCH'] ?? '',
        ];
        foreach ($incoming as $name => $value) {
            if ($value === '') continue;
            if (preg_match('/[\x00-\x1f\x7f]/', $value)) self::error(400, 'Header tidak valid.');
            $headers[] = $name.': '.$value;
        }
        $headers[] = 'Expect:';
        $headers[] = 'Accept-Encoding: identity';
        if (!extension_loaded('curl')) self::error(502, 'TernaKu belum dapat terhubung ke server.');
        $tmp = fopen('php://temp/maxmemory:2097152', 'w+b');
        if (!$tmp) self::error(502, 'TernaKu belum dapat terhubung ke server.');
        $url = 'https://'.self::HOST.':'.self::PORT.$path;
        $curl = curl_init($url);
        $response = [];
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_PROXY => '',
            CURLOPT_RESOLVE => [self::HOST.':'.self::PORT.':'.self::ADDRESS],
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 65,
            CURLOPT_WRITEFUNCTION => static fn($handle, string $chunk): int => (int)fwrite($tmp, $chunk),
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$response): int {
                if (preg_match('~^HTTP/\S+ \d{3}~', $line)) $response = [];
                elseif (str_contains($line, ':')) {
                    [$key, $value] = explode(':', $line, 2);
                    $response[strtolower(trim($key))] = trim($value);
                }
                return strlen($line);
            },
        ]);
        if ($method === 'POST') {
            if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > self::LIMIT) self::error(413, 'Ukuran data maksimal 3 MB.');
            $body = file_get_contents('php://input', false, null, 0, self::LIMIT + 1);
            if ($body === false || strlen($body) > self::LIMIT) self::error(413, 'Ukuran data maksimal 3 MB.');
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        $ok = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        if (!$ok || $status < 200 || ($status >= 300 && $status < 400 && $status !== 304)) {
            header('Retry-After: 15');
            self::error(502, 'TernaKu belum dapat terhubung ke server. Coba lagi sebentar.');
        }
        $type = strtolower(trim(explode(';', $response['content-type'] ?? '')[0]));
        if (!in_array($status, [204, 304], true) && !in_array($type, ['application/json','image/jpeg','image/png','image/webp'], true)) {
            self::error(502, 'Server TernaKu belum dapat melayani permintaan ini.');
        }
        http_response_code($status);
        foreach (['content-type', 'etag', 'cache-control', 'allow', 'retry-after', 'referrer-policy', 'x-content-type-options'] as $key) {
            if (isset($response[$key]) && !preg_match('/[\x00-\x1f\x7f]/', $response[$key])) header($key.': '.$response[$key]);
        }
        if (!in_array($status, [204, 304], true)) {
            header('Content-Length: '.ftell($tmp));
            rewind($tmp);
            fpassthru($tmp);
        }
        fclose($tmp);
        exit;
    }
}
TernaKuLegacyCutover::enter();
