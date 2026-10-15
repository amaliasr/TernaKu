<?php
defined('BASEPATH') OR exit('No direct script access allowed');
$route['default_controller'] = 'api/health';
$route['health'] = 'api/health';
$route['auth/login'] = 'api/login';
$route['auth/registration-status'] = 'api/registration_status';
$route['auth/register'] = 'api/register';
$route['auth/logout'] = 'api/logout';
$route['bootstrap'] = 'api/bootstrap';
$route['commands'] = 'api/commands';
$route['404_override'] = 'api/missing';
$route['translate_uri_dashes'] = false;
