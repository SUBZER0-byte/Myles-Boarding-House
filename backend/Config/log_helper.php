<?php
/**
 * Centralized system log helper.
 * Writes to the `system_logs` table for security/audit trails.
 *
 * Usage:
 *   include_once __DIR__ . '/log_helper.php';
 *   sys_log('auth', 'login_success', "User {$username} logged in", $user_id);
 */

if (!function_exists('mbh_client_ip')) {
    function mbh_client_ip(): ?string {
        $headerNames = [
            'HTTP_CF_CONNECTING_IP',
            'HTTP_X_FORWARDED_FOR',
            'HTTP_X_REAL_IP',
            'HTTP_CLIENT_IP',
            'REMOTE_ADDR'
        ];

        foreach ($headerNames as $headerName) {
            if (!isset($_SERVER[$headerName])) {
                continue;
            }

            $value = $_SERVER[$headerName];
            if (!is_string($value)) {
                $value = (string) $value;
            }

            foreach (preg_split('/[,\s]+/', $value) as $candidate) {
                $candidate = trim((string) $candidate);
                if ($candidate === '') {
                    continue;
                }

                if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                    return $candidate;
                }
            }
        }

        return null;
    }
}

if (!function_exists('sys_log')) {
    function sys_log(string $category, string $action, string $message = '', $actor_id = null, string $level = 'info'): void {
        global $connect;
        if (!isset($connect) || !$connect) return;

        $ip  = mbh_client_ip();
        $ua  = $_SERVER['HTTP_USER_AGENT'] ?? null;
        $url = ($_SERVER['REQUEST_METHOD'] ?? '') . ' ' . ($_SERVER['REQUEST_URI'] ?? '');

        try {
            $stmt = $connect->prepare("
                INSERT INTO system_logs
                  (actor_id, category, action, level, message, ip_address, user_agent, request_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ");
            if (!$stmt) return;
            $actor = $actor_id !== null ? intval($actor_id) : null;
            $stmt->bind_param("isssssss", $actor, $category, $action, $level, $message, $ip, $ua, $url);
            $stmt->execute();
            $stmt->close();
        } catch (\Throwable $e) {
            // never let logging break the request
        }
    }
}
