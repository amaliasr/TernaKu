<?php
require __DIR__ . '/scripts/env.php';
define('ENVIRONMENT', getenv('APP_ENV') ?: 'production');
// Upstream CI3 uses PHP dynamic properties; suppress only their PHP 8.2 deprecations.
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
ini_set('display_errors', '0');
define('SELF', basename(__FILE__));
define('FCPATH', __DIR__ . DIRECTORY_SEPARATOR);
define('BASEPATH', __DIR__ . '/system/');
define('SYSDIR', 'system');
define('APPPATH', __DIR__ . '/application/');
define('VIEWPATH', APPPATH . 'views/');
require BASEPATH . 'core/CodeIgniter.php';
