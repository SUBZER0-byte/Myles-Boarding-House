<?php
/**
 * Shared SMS helper for TextBee.
 *
 * Usage from any backend file:
 *     include_once __DIR__ . '/../Notifications/sms_helper.php';
 *     sms_send('09171234567', 'Your room is reserved!');
 *
 * Returns: ['ok' => bool, 'status' => int, 'body' => mixed, 'error' => string|null]
 * Failures never throw — SMS is best-effort and must not break the request flow.
 */

if (!function_exists('sms_normalize_ph')) {
    function sms_normalize_ph(string $raw, string $defaultCC = '+63'): string {
        $n = preg_replace('/[^\d+]/', '', $raw);
        if ($n === '') return '';
        // Already E.164
        if ($n[0] === '+') return $n;
        // 09XXXXXXXXX → +639XXXXXXXXX
        if (strlen($n) === 11 && $n[0] === '0') return $defaultCC . substr($n, 1);
        // 639XXXXXXXXX → +639XXXXXXXXX
        if (strlen($n) === 12 && substr($n, 0, 2) === '63') return '+' . $n;
        // 9XXXXXXXXX → +639XXXXXXXXX
        if (strlen($n) === 10 && $n[0] === '9') return $defaultCC . $n;
        return $n; // last resort, hand off as-is
    }
}

if (!function_exists('sms_send')) {
    function sms_send(string $recipient, string $message): array {
        $config = include __DIR__ . '/../Config/sms.php';
        $out = ['ok' => false, 'status' => 0, 'body' => null, 'error' => null];

        if (empty($config['enabled'])) { $out['error'] = 'TextBee SMS is disabled in config'; return $out; }
        if (trim((string)($config['api_key'] ?? '')) === '') { $out['error'] = 'TextBee API key is not configured'; return $out; }
        if (trim((string)($config['api_base'] ?? '')) === '') { $out['error'] = 'TextBee API base is not configured'; return $out; }
        $to = sms_normalize_ph($recipient, $config['default_country_code'] ?? '+63');
        if ($to === '' || $message === '') { $out['error'] = 'Missing recipient or message'; return $out; }

        $payload = [
            'recipients' => [$to],
            'message' => $message,
        ];
        if (trim((string)($config['device_id'] ?? '')) !== '') {
            $payload['deviceId'] = trim((string)$config['device_id']);
        }

        $ch = curl_init(rtrim($config['api_base'], '/') . '/gateway/send-sms');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-api-key: ' . trim((string)$config['api_key']),
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload),
        ]);
        $raw  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        $out['status'] = $code;
        $out['body']   = $raw ? json_decode($raw, true) : null;
        $out['error']  = $err ?: null;
        $out['ok']     = ($code >= 200 && $code < 300 && is_array($out['body']));

        // Determine error message based on HTTP status code
        $statusMessage = '';
        if ($code === 400) {
            $statusMessage = 'Bad Request - Invalid device ID or request format';
        } elseif ($code === 401) {
            $statusMessage = 'Unauthorized - Invalid or missing API key';
        } elseif ($code === 404) {
            $statusMessage = 'Not Found - Device not registered on account';
        } elseif ($code === 429) {
            $statusMessage = 'Rate Limited - Too many requests';
        } elseif ($code === 500) {
            $statusMessage = 'Server Error - TextBee API error';
        } elseif ($code >= 400) {
            $statusMessage = "HTTP Error {$code}";
        }

        // Enhanced logging with status code and error details
        $logEntry = sprintf(
            "[%s] SMS to=%s | STATUS=%d | ok=%s | msg='%s' | api_response=%s | curl_error=%s | status_info=%s\n",
            date('c'),
            $to,
            $code,
            $out['ok'] ? 'YES' : 'NO',
            substr($message, 0, 50),
            substr((string)$raw, 0, 200),
            (string)$err,
            $statusMessage
        );

        @file_put_contents(
            __DIR__ . '/sms.log',
            $logEntry,
            FILE_APPEND
        );

        // Also echo to error_log for console visibility
        if (!$out['ok']) {
            error_log("❌ SMS FAILED | To: {$to} | Status: {$code} | {$statusMessage} | Error: {$err}");
        } else {
            error_log("✅ SMS SUCCESS | To: {$to} | Status: {$code}");
        }

        return $out;
    }
}
