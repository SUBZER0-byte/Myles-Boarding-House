<?php
/**
 * PayPal configuration and API helpers.
 *
 * Configuration is loaded from environment variables first, then backend/Config/secrets.php.
 * Secrets are never returned to the browser or written to logs.
 */

function pp_read_secret(string $name, array $secrets = [], string $default = ''): string
{
    $value = getenv($name);
    if ($value !== false && trim((string)$value) !== '') {
        return trim((string)$value);
    }

    $secretValue = $secrets[$name] ?? $default;
    return is_string($secretValue) ? trim($secretValue) : $default;
}

function pp_read_database_setting(string $key): string
{
    global $connect;
    if (!isset($connect)) {
        require_once __DIR__ . '/db.php';
    }
    if (!$connect instanceof mysqli) {
        return '';
    }

    $stmt = $connect->prepare('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1');
    if (!$stmt) {
        error_log('PayPal configuration read failed: unable to prepare settings query');
        return '';
    }
    $stmt->bind_param('s', $key);
    if (!$stmt->execute()) {
        error_log('PayPal configuration read failed: ' . $stmt->error);
        $stmt->close();
        return '';
    }

    $value = '';
    $stmt->bind_result($value);
    $stmt->fetch();
    $stmt->close();
    return trim((string)$value);
}

function pp_base(?string $mode = null): string
{
    $mode = strtolower((string)($mode ?? pp_cfg()['env'] ?? 'sandbox'));
    return $mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
}

function pp_cfg(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $secretsFile = __DIR__ . '/secrets.php';
    $secrets = is_file($secretsFile) ? (require $secretsFile) : [];
    if (!is_array($secrets)) {
        $secrets = [];
    }

    $mode = strtolower(pp_read_secret('PAYPAL_ENV', $secrets, 'sandbox'));
    if (!in_array($mode, ['sandbox', 'live'], true)) {
        $mode = 'sandbox';
    }

    $appBaseUrl = rtrim(pp_read_secret('APP_BASE_URL', $secrets, 'http://localhost:5173'), '/');

    $clientId = pp_read_secret('PAYPAL_CLIENT_ID', $secrets, '');
    $paypalSecret = pp_read_secret('PAYPAL_SECRET', $secrets, '');
    $webhookId = pp_read_secret('PAYPAL_WEBHOOK_ID', $secrets, '');
    $config = [
        'env' => $mode,
        'client_id' => $clientId !== '' ? $clientId : pp_read_database_setting('paypal_client_id'),
        'secret' => $paypalSecret !== '' ? $paypalSecret : pp_read_database_setting('paypal_secret'),
        'webhook_id' => $webhookId !== '' ? $webhookId : pp_read_database_setting('paypal_webhook_id'),
        'app_base_url' => $appBaseUrl,
        'app_env' => strtolower(pp_read_secret('APP_ENV', $secrets, 'development')),
    ];

    if ($config['env'] === 'live' && !preg_match('#^https://#i', $config['app_base_url'])) {
        error_log('PayPal live configuration error: APP_BASE_URL must use HTTPS when PAYPAL_ENV=live.');
        throw new RuntimeException('PayPal configuration error: APP_BASE_URL must use HTTPS in live mode.');
    }

    $GLOBALS['paypal_config'] = $config;
    return $config;
}

function pp_mode(): string
{
    return pp_cfg()['env'] ?? 'sandbox';
}

function pp_token(): string
{
    static $token = null;
    static $expiresAt = 0.0;

    $now = microtime(true);
    if ($token !== null && $now < ($expiresAt - 60)) {
        return $token;
    }

    $cfg = pp_cfg();
    $cacheKey = md5($cfg['env'] . ':' . ($cfg['client_id'] ?? '') . ':' . ($cfg['secret'] ?? ''));
    $cacheFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'paypal_access_token_' . $cacheKey . '.json';

    if (is_file($cacheFile)) {
        $cached = @json_decode((string)@file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['token']) && isset($cached['expires_at']) && $now < ((float)$cached['expires_at'] - 60)) {
            $token = (string)$cached['token'];
            $expiresAt = (float)$cached['expires_at'];
            return $token;
        }
    }

    $basicAuth = base64_encode(($cfg['client_id'] ?? '') . ':' . ($cfg['secret'] ?? ''));
    $response = pp_request(
        'POST',
        '/v1/oauth2/token',
        'grant_type=client_credentials',
        [
            'Authorization' => 'Basic ' . $basicAuth,
            'Content-Type' => 'application/x-www-form-urlencoded',
        ]
    );

    if ($response['code'] >= 400 || empty($response['data']['access_token'])) {
        $detail = trim((string)($response['raw'] ?? '')) ?: 'unknown error';
        error_log('PayPal token request failed: HTTP ' . (int)$response['code'] . ' - ' . $detail);
        throw new RuntimeException('PayPal authentication failed.');
    }

    $token = (string)$response['data']['access_token'];
    $expiresIn = (float)($response['data']['expires_in'] ?? 3600);
    $expiresAt = $now + max(0.0, $expiresIn);

    @file_put_contents($cacheFile, json_encode([
        'token' => $token,
        'expires_at' => $expiresAt,
    ], JSON_PRETTY_PRINT));

    return $token;
}

function pp_request(string $method, string $path, $jsonBody = null, array $extraHeaders = []): array
{
    $method = strtoupper($method);
    $apiBase = pp_base();
    $url = rtrim($apiBase, '/') . $path;

    $headers = [];
    foreach ($extraHeaders as $name => $value) {
        if ($value === null || $value === '') {
            continue;
        }
        $headers[] = $name . ': ' . (string)$value;
    }

    $body = null;
    if ($jsonBody !== null) {
        if (is_array($jsonBody) || is_object($jsonBody)) {
            $body = json_encode($jsonBody, JSON_UNESCAPED_SLASHES);
            if (!isset($extraHeaders['Content-Type'])) {
                $headers[] = 'Content-Type: application/json';
            }
        } else {
            $body = (string)$jsonBody;
            if (!isset($extraHeaders['Content-Type'])) {
                $headers[] = 'Content-Type: application/json';
            }
        }
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADER => false,
    ]);

    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }

    $rawResponse = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '') {
        error_log('PayPal cURL error: ' . $curlError);
    }

    $decoded = [];
    if (is_string($rawResponse) && trim($rawResponse) !== '') {
        $decoded = json_decode($rawResponse, true);
        if (!is_array($decoded)) {
            $decoded = [];
        }
    }

    return [
        'code' => $httpCode,
        'data' => $decoded,
        'raw' => (string)$rawResponse,
    ];
}
