<?php
defined('BASEPATH') OR exit('No direct script access allowed');
$route['default_controller'] = 'api/health';
$route['health'] = 'api/health';
$route['auth/login'] = 'api/login';
$route['auth/registration-status'] = 'api/registration_status';
$route['auth/register'] = 'api/register';
$route['auth/logout'] = 'api/logout';
$route['bootstrap'] = 'api/bootstrap';
$route['sync/prices'] = 'api/sync_prices';
$route['media/(:any)/(:any)'] = 'api/media/$1/$2';
$route['commands'] = 'api/commands';
$route['push/status'] = 'api/push_status';
$route['push/subscribe'] = 'api/push_subscribe';
$route['push/unsubscribe'] = 'api/push_unsubscribe';
$route['push/test'] = 'api/push_test';
$route['404_override'] = 'api/missing';
$route['translate_uri_dashes'] = false;
