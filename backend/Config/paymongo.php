<?php
/**
 * PayMongo configuration loaded from environment variables or Config/secrets.php.
 */

$secretsFile = __DIR__ . '/secrets.php';
$secrets = is_file($secretsFile) ? require $secretsFile : [];
if (!is_array($secrets)) {
    $secrets = [];
}

$readConfigValue = static function (string $name, string $default = '') use ($secrets): string {
    $value = getenv($name);
    if ($value !== false && trim($value) !== '') {
        return trim($value);
    }
    $secretValue = $secrets[$name] ?? $default;
    return is_string($secretValue) ? trim($secretValue) : $default;
};

$appBaseUrl = rtrim($readConfigValue('APP_BASE_URL'), '/');
$secretKey = $readConfigValue('PAYMONGO_SECRET_KEY');
if (str_starts_with($secretKey, 'sk_live_')
    && !preg_match('#^https://#i', $appBaseUrl)) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode([
        'type' => 'error',
        'message' => 'PayMongo configuration error: APP_BASE_URL must use HTTPS when a live secret key is configured.',
    ]);
    exit;
}

$config = [
    'secret_key' => $secretKey,
    'public_key' => $readConfigValue('PAYMONGO_PUBLIC_KEY'),
    'webhook_secret' => $readConfigValue('PAYMONGO_WEBHOOK_SECRET'),
    'api_base' => rtrim($readConfigValue('PAYMONGO_API_BASE', 'https://api.paymongo.com/v1'), '/'),
    'success_url' => $appBaseUrl . '/payment/success',
    'failed_url' => $appBaseUrl . '/payment/failed',
];
$GLOBALS['paymongo_config'] = $config;

if (!function_exists('paymongo_mode')) {
    function paymongo_mode(): string {
        $secretKey = (string)($GLOBALS['paymongo_config']['secret_key'] ?? '');
        return str_starts_with($secretKey, 'sk_live_') ? 'live' : 'test';
    }
}

return $config;
