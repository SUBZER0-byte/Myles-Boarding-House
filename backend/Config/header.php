<?php
/**
 * Shared HTTP header bootstrap for every backend endpoint.
 *
 * Responsibilities:
 *   1) Strict CORS (configured frontend origins and local development origins)
 *   2) Security headers (XSS, clickjacking, MIME sniffing, referrer, CSP)
 *   3) Hardened PHP session bootstrap
 *   4) CSRF-style origin guard on state-changing requests
 */

require_once __DIR__ . '/security.php';

// --- Strict CORS allow-list ---
$allowed_origins = json_decode(MBH_ALLOWED_ORIGINS, true) ?: [];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if ($origin !== '' && (in_array($origin, $allowed_origins, true) || sec_is_development_origin($origin))) {
    header("Access-Control-Allow-Origin: {$origin}");
    header("Vary: Origin");
} elseif ($origin === '') {
    // Fall back to the primary dev origin for same-origin requests without Origin.
    header("Access-Control-Allow-Origin: http://localhost:5173");
    header("Vary: Origin");
}

header("Access-Control-Allow-Credentials: true");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
header("Access-Control-Max-Age: 600");

// Handle preflight requests (OPTIONS) early
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit();
}

// Security headers + session + CSRF/Origin guard
sec_headers();
sec_session_start();
sec_require_origin();
