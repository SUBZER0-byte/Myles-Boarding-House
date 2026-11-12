<?php
/**
 * Central security helpers for Myle's Boarding House backend.
 *
 * Provides:
 *   - sec_headers()           : security response headers (XSS, clickjacking, MIME, referrer, perms)
 *   - sec_session_start()     : hardened PHP session bootstrap (httpOnly, samesite, regenerate)
 *   - sec_throttle()          : generic per-IP+key file-based rate limiter
 *   - sec_require_origin()    : reject state-changing requests from foreign origins (CSRF defense)
 *   - sec_current_user_id()   : returns the authenticated session user_id (0 if none)
 *   - sec_login($user)        : record a successful login in the session, regenerating the id
 *   - sec_logout()            : destroy the session safely
 *
 * NOTE: This file is intentionally include-safe. Each function is guarded so
 * multiple includes (header.php pulls this in for every endpoint) never
 * re-declare or double-send headers.
 */

if (!defined('MBH_SECURITY_LOADED')) {
    define('MBH_SECURITY_LOADED', true);

    // ---------- Allowed frontend origins ----------
    if (!defined('MBH_ALLOWED_ORIGINS')) {
        $defaultOrigins = [
            'http://localhost',
            'http://127.0.0.1',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:8080',
            'http://localhost:8081',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5174',
            'http://[::1]:5173',
            'http://[::1]:5174',
            'http://[::1]:8080',
            'http://[::1]:8081',
        ];
        $configuredOriginsJson = getenv('MBH_ALLOWED_ORIGINS');
        if ($configuredOriginsJson === false) {
            $configuredOriginsJson = $_SERVER['MBH_ALLOWED_ORIGINS'] ?? '';
        }
        $configuredOrigins = json_decode((string)$configuredOriginsJson, true);
        if (is_array($configuredOrigins)) {
            foreach ($configuredOrigins as $configuredOrigin) {
                if (!is_string($configuredOrigin)) {
                    continue;
                }
                $configuredOrigin = rtrim(trim($configuredOrigin), '/');
                $parts = parse_url($configuredOrigin);
                if ($parts === false
                    || !isset($parts['scheme'], $parts['host'])
                    || !in_array(strtolower($parts['scheme']), ['http', 'https'], true)
                    || isset($parts['path'])
                    || isset($parts['query'])
                    || isset($parts['fragment'])
                    || isset($parts['user'])
                    || isset($parts['pass'])) {
                    continue;
                }
                $defaultOrigins[] = $configuredOrigin;
            }
        }
        define('MBH_ALLOWED_ORIGINS', json_encode(array_values(array_unique($defaultOrigins))));
    }

    /** Send hardening response headers. Safe to call multiple times. */
    function sec_headers(): void {
        static $sent = false;
        if ($sent) return;
        $sent = true;

        // Prevent MIME sniffing
        header('X-Content-Type-Options: nosniff');
        // Disallow framing (clickjacking)
        header('X-Frame-Options: DENY');
        // Minimal referrer leakage
        header('Referrer-Policy: strict-origin-when-cross-origin');
        // Lock down dangerous browser APIs by default
        header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()');
        // Legacy header, still respected by some browsers
        header('X-XSS-Protection: 0');
        // Lean CSP for a JSON API (no inline scripts ever rendered by PHP)
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    }

    /** Start a hardened PHP session. Idempotent. */
    function sec_session_start(): void {
        if (session_status() === PHP_SESSION_ACTIVE) return;

        $idleTimeout = 8 * 60 * 60;
        ini_set('session.gc_maxlifetime', (string)$idleTimeout);
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
               || (($_SERVER['SERVER_PORT'] ?? 80) == 443);

        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_name('MBHSESSID');
        @session_start();
        if (session_status() !== PHP_SESSION_ACTIVE) {
            error_log('Unable to start the application session');
            return;
        }

        $now = time();
        $lastActivity = (int)($_SESSION['last_activity'] ?? 0);
        if ($lastActivity > 0 && $now - $lastActivity > $idleTimeout) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['last_activity'] = $now;
    }

    /**
     * Generic file-based rate limiter.
     * Returns true while under the limit, false once the threshold is exceeded
     * inside the rolling $window seconds.
     *
     *   sec_throttle('signin', 5, 60)   // 5 hits / 60s per IP
     */
    function sec_throttle(string $key, int $max, int $window): bool {
        $ip   = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $path = sys_get_temp_dir() . '/mbh_thr_' . md5($key . '|' . $ip);
        $now  = time();
        $data = ['count' => 0, 'first' => $now];

        if (is_file($path)) {
            $raw = @file_get_contents($path);
            $j   = $raw ? json_decode($raw, true) : null;
            if (is_array($j) && isset($j['first']) && ($now - $j['first']) < $window) {
                $data = $j;
            }
        }
        $data['count']++;
        @file_put_contents($path, json_encode($data), LOCK_EX);
        return $data['count'] <= $max;
    }

    function sec_throttle_retry_after(string $key, int $window): int {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $path = sys_get_temp_dir() . '/mbh_thr_' . md5($key . '|' . $ip);
        if (!is_file($path)) {
            return 0;
        }

        $raw = @file_get_contents($path);
        $data = $raw ? json_decode($raw, true) : null;
        if (!is_array($data) || !isset($data['first']) || !is_numeric($data['first'])) {
            return 0;
        }

        return max(0, $window - (time() - (int)$data['first']));
    }

    function sec_is_development_origin(string $origin): bool {
        $parts = parse_url($origin);
        if (!$parts || !isset($parts['scheme'], $parts['host'])) {
            return false;
        }

        $scheme = strtolower($parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return false;
        }

        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        $host = strtolower($parts['host']);
        $devPorts = [5173, 5174, 8080, 8081];

        if (in_array($host, ['localhost', '127.0.0.1'], true) && in_array($port, $devPorts, true)) {
            return true;
        }
        if ($host === '::1' && in_array($port, $devPorts, true)) {
            return true;
        }
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return preg_match('/^(10|192\.168|172\.(1[6-9]|2[0-9]|3[0-1]))\./', $host)
                && in_array($port, $devPorts, true);
        }

        return false;
    }

    /**
     * Enforce that state-changing requests (POST/PUT/DELETE) come from one of
     * our allowed origins. This is a CSRF defense that does NOT require
     * frontend changes (no token plumbing). Browsers always set Origin on
     * cross-origin POSTs, so a missing Origin from a browser is suspicious.
     * GET requests are allowed through for backward compatibility with the
     * many GET-based read endpoints in this project.
     */
    function sec_require_origin(): void {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if (!in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) return;

        $allowed = json_decode(MBH_ALLOWED_ORIGINS, true) ?: [];
        $origin  = $_SERVER['HTTP_ORIGIN']  ?? '';
        $referer = $_SERVER['HTTP_REFERER'] ?? '';

        if ($origin !== '' && (in_array($origin, $allowed, true) || sec_is_development_origin($origin))) {
            return;
        }

        if ($origin === '' && $referer !== '' && str_contains($referer, 'http://localhost') && str_contains($referer, '/July14-Myle\'s%20Boarding%20House/')) {
            return;
        }

        if ($referer !== '') {
            $parts = parse_url($referer);
            if ($parts && isset($parts['scheme'], $parts['host'])) {
                $base = $parts['scheme'] . '://' . $parts['host']
                      . (isset($parts['port']) ? ':' . $parts['port'] : '');
                if (in_array($base, $allowed, true) || sec_is_development_origin($base)) {
                    return;
                }
            }
        }

        // Allow same-origin server-to-server (no Origin, no Referer) such as
        // internal cURL or PHP CLI scripts. Block only browser-style requests
        // that *do* present a foreign origin.
        if ($origin === '' && $referer === '') return;

        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Forbidden: bad origin']);
        exit;
    }

    function sec_current_user_id(): int {
        sec_session_start();
        return (int)($_SESSION['user_id'] ?? 0);
    }

    function sec_delete_profile_picture(?string $stored): void {
        $stored = str_replace('\\', '/', trim((string) $stored));
        if ($stored === '' || !preg_match('#^profile_pictures/[A-Za-z0-9._-]+$#', $stored)) return;

        $uploadRoot = realpath(__DIR__ . '/../uploads');
        $filePath = realpath(__DIR__ . '/../uploads/' . $stored);
        if (!$uploadRoot || !$filePath || !is_file($filePath)) return;
        if (strpos($filePath, $uploadRoot . DIRECTORY_SEPARATOR) !== 0) return;
        @unlink($filePath);
    }

    function sec_current_user_type(): string {
        sec_session_start();
        return (string)($_SESSION['user_type'] ?? '');
    }

    function sec_login(array $user): void {
        sec_session_start();
        // Prevent session fixation
        session_regenerate_id(true);
        $_SESSION['user_id']    = (int)$user['user_id'];
        $_SESSION['username']   = (string)$user['username'];
        $_SESSION['user_type']  = (string)$user['user_type'];
        $_SESSION['login_time'] = time();
    }

    function sec_logout(): void {
        sec_session_start();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    /** Generate or return the session CSRF token. */
    function sec_csrf_token(): string {
        sec_session_start();
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    /** Validate CSRF token from header or POST/JSON body. */
    function sec_verify_csrf(?string $token = null): bool {
        sec_session_start();
        if ($token === null || $token === '') {
            $token = $_SERVER['HTTP_X_CSRF_TOKEN']
                  ?? $_POST['csrf_token']
                  ?? '';
        }
        if ($token === '' && in_array(strtoupper($_SERVER['REQUEST_METHOD'] ?? ''), ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
            $raw = file_get_contents('php://input');
            if ($raw) {
                $json = json_decode($raw, true);
                if (is_array($json) && !empty($json['csrf_token'])) {
                    $token = (string) $json['csrf_token'];
                }
            }
        }
        $expected = $_SESSION['csrf_token'] ?? '';
        return $expected !== '' && is_string($token) && hash_equals($expected, $token);
    }

    /** Require an authenticated Admin session. */
    function sec_require_admin(): void {
        if (sec_current_user_id() <= 0) {
            header('Content-Type: application/json');
            http_response_code(401);
            echo json_encode(['type' => 'error', 'message' => 'Admin access required']);
            exit;
        }

        $userType = sec_current_user_type();
        if ($userType !== 'Admin') {
            header('Content-Type: application/json');
            http_response_code(403);
            echo json_encode(['type' => 'error', 'message' => 'Admin access required']);
            exit;
        }
    }
}
