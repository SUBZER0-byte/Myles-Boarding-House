<?php
/**
 * Authentication endpoint — Myle's Boarding House.
 *
 * Hardened against SQL injection and common credential attacks:
 *   - ALL database access uses mysqli prepared statements with bind_param
 *     (no string concatenation of user input into SQL).
 *   - Strict input validation: type, length, whitelist regex, null-byte stripping.
 *   - Generic error messages on sign-in to prevent username enumeration.
 *   - Passwords stored with password_hash(PASSWORD_DEFAULT) and verified
 *     with password_verify (constant-time).
 *   - Role whitelist enforced on signup.
 *   - Optional per-IP throttle on sign-in attempts (in-memory file lock).
 */

include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once '../Config/log_helper.php';
include_once '../Config/phone_validation.php';
include_once '../Config/otp_helper.php';
require_once __DIR__ . '/../Config/system_notifications.php';

header('Content-Type: application/json');

// Force mysqli to throw on hard errors so we never silently run bad SQL
mysqli_report(MYSQLI_REPORT_OFF);

$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {
    case 'signin':         SignInUser();                 break;
    case 'signup':         SignUpUser();                 break;
    case 'send_otp':       SendOtp();                    break;
    case 'verify_otp':     VerifyOtp();                  break;
    case 'request_password_reset': RequestPasswordReset(); break;
    case 'verify_password_reset': VerifyPasswordReset(); break;
    case 'reset_password': ResetPassword();             break;
    case 'signout':        SignOutUser();                break;
    case 'me':
    case 'CurrentUser':
        CurrentUser();
        break;
    case 'check_username': checkUsernameAvailability();  break;
    case 'check_email':    checkEmailAvailability();     break;
    default:
        echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
        break;
}

/* ==========================================================
   INPUT SANITIZERS / VALIDATORS  (anti SQL-injection layer)
   ========================================================== */

/**
 * Remove null bytes and trim. Returns a safe string up to $max chars.
 *
 * @param mixed $value
 */
function sani_str($value, int $max = 255): string {
    if (!is_scalar($value)) return '';
    $s = (string) $value;
    $s = str_replace(["\0"], '', $s);
    $s = trim($s);
    if (mb_strlen($s) > $max) $s = mb_substr($s, 0, $max);
    return $s;
}

/** Username: 3–50 chars, letters/numbers/._- only. */
function valid_username(string $u): bool {
    return (bool) preg_match('/^[A-Za-z0-9._-]{3,50}$/', $u);
}

/** Email: RFC + max length 150 + domain MX/A record check (rejects fake domains). */
function valid_email(string $e): bool {
    if (mb_strlen($e) > 150) return false;
    if (filter_var($e, FILTER_VALIDATE_EMAIL) === false) return false;

    // Block obvious throwaway/fake patterns at the local part
    $parts = explode('@', $e);
    if (count($parts) !== 2) return false;
    [$local, $domain] = $parts;
    $domain = strtolower($domain);

    // Reject reserved/example/test/local domains
    $blocked_domains = [
        'example.com','example.org','example.net','test.com','test.test',
        'localhost','local','invalid','mailinator.com','tempmail.com',
        '10minutemail.com','guerrillamail.com','trashmail.com','yopmail.com',
        'fakeinbox.com','sharklasers.com','throwawaymail.com','getnada.com',
        'maildrop.cc','myles.local'
    ];
    if (in_array($domain, $blocked_domains, true)) return false;
    if (preg_match('/\.(test|example|invalid|localhost|local)$/i', $domain)) return false;

    // Real-domain verification — must have an MX or A record
    if (function_exists('checkdnsrr')) {
        $hasMx = @checkdnsrr($domain, 'MX');
        $hasA  = @checkdnsrr($domain, 'A');
        if (!$hasMx && !$hasA) return false;
    }
    return true;
}

/** Friendlier validator that returns a reason string (for signup messaging). */
function email_reject_reason(string $e): ?string {
    if (mb_strlen($e) > 150) return 'Email is too long.';
    if (filter_var($e, FILTER_VALIDATE_EMAIL) === false) return 'Invalid email format.';
    $parts = explode('@', $e);
    if (count($parts) !== 2) return 'Invalid email format.';
    $domain = strtolower($parts[1]);
    if (preg_match('/\.(test|example|invalid|localhost|local)$/i', $domain))
        return 'This email domain is not allowed.';
    $blocked_domains = [
        'example.com','example.org','example.net','test.com','test.test',
        'mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com',
        'trashmail.com','yopmail.com','fakeinbox.com','sharklasers.com',
        'throwawaymail.com','getnada.com','maildrop.cc','myles.local'
    ];
    if (in_array($domain, $blocked_domains, true))
        return 'Disposable or fake email addresses are not allowed.';
    if (function_exists('checkdnsrr')) {
        $hasMx = @checkdnsrr($domain, 'MX');
        $hasA  = @checkdnsrr($domain, 'A');
        if (!$hasMx && !$hasA)
            return 'Email domain does not exist. Please use a real email.';
    }
    return null;
}

/** Phone: optional, must match Philippines format if provided. */
function valid_phone(string $p): bool {
    if ($p === '') return false;
    return is_probably_real_mobile_number($p);
}

function valid_profile_picture_upload(array $file): bool {
    if ($file['error'] !== UPLOAD_ERR_OK) {
        return false;
    }
    if ($file['size'] > 10 * 1024 * 1024) {
        return false;
    }
    $allowedExt = ['jpg', 'jpeg', 'png', 'webp'];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $allowedExt, true)) {
        return false;
    }
    $mime = @mime_content_type($file['tmp_name']);
    if (!is_string($mime)) {
        $mime = '';
    }
    $mime = strtolower(trim($mime));
    $allowedMime = [
        'image/jpeg',
        'image/png',
        'image/webp',
    ];
    return in_array($mime, $allowedMime, true);
}

/** Full name: letters, spaces, dots, hyphens, apostrophes, 2–150 chars. */
function valid_full_name(string $n): bool {
    return (bool) preg_match("/^[\p{L} .'\-]{2,150}$/u", $n);
}

/** Per-IP throttle wrapper around the shared sec_throttle helper. */
function signin_throttle_ok(): bool {
    // 5 sign-in attempts / 60s per IP
    return sec_throttle('signin', 5, 60);
}

function signup_throttle_ok(): bool {
    // 3 new accounts / 10 min per IP — abuse guard
    return sec_throttle('signup', 3, 600);
}

/* ==========================================================
   SIGN IN
   ========================================================== */
function users_has_column(string $column): bool {
    /** @var mysqli $connect */
    global $connect, $dbName;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        return false;
    }

    static $cache = [];
    if (isset($cache[$column])) {
        return $cache[$column];
    }

    $stmt = $connect->prepare(
        "SELECT COUNT(*) AS count
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = 'users'
            AND COLUMN_NAME = ?"
    );
    if (!$stmt) {
        $cache[$column] = false;
        return false;
    }
    $schema = $dbName ?? '';
    $stmt->bind_param("ss", $schema, $column);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $cache[$column] = ((int)($row['count'] ?? 0)) > 0;
    return $cache[$column];
}

function SignInUser() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    if (!signin_throttle_ok()) {
        echo json_encode([
            'type' => 'error',
            'message' => 'Too many sign-in attempts. Please wait a minute and try again.'
        ]);
        return;
    }

    $data     = json_decode(file_get_contents('php://input'), true) ?: [];
    $username = sani_str($data['username'] ?? '', 150);
    $password = is_string($data['password'] ?? null) ? $data['password'] : '';

    if ($username === '' || $password === '') {
        echo json_encode(['type' => 'error', 'message' => 'Username and password are required']);
        return;
    }
    if (mb_strlen($password) > 200) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid credentials']);
        return;
    }

    // Prepared statement — username is bound, never concatenated.
    $stmt = $connect->prepare(
        "SELECT user_id, username, full_name, email, phone, password, user_type, is_active,
                NULL AS rejection_reason
           FROM users
          WHERE username = ? OR email = ?
          LIMIT 1"
    );
    if (!$stmt) {
        sys_log('auth', 'db_prepare_failed', 'SignInUser prepare failed: ' . ($connect->error ?? 'unknown'));
        echo json_encode(['type' => 'error', 'message' => 'Server error']);
        return;
    }
    $stmt->bind_param("ss", $username, $username);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows !== 1) {
        $stmt->close();
        // Generic error to prevent username enumeration
        echo json_encode(['type' => 'error', 'message' => 'Invalid username or password']);
        return;
    }
    $user = $result->fetch_assoc();
    $stmt->close();

    if (!password_verify($password, $user['password'])) {
        sys_log('auth', 'login_failed', "Failed login for '{$username}'", null, 'security');
        echo json_encode(['type' => 'error', 'message' => 'Invalid username or password']);
        return;
    }

    if ((int) $user['is_active'] === 0) {
        echo json_encode([
            'type' => 'error',
            'message' => 'Your account is deactivated. Please contact the administrator.'
        ]);
        return;
    }

    // Transparently upgrade legacy hashes if PASSWORD_DEFAULT changes.
    if (password_needs_rehash($user['password'], PASSWORD_DEFAULT)) {
        $newHash = password_hash($password, PASSWORD_DEFAULT);
        $upd = $connect->prepare("UPDATE users SET password = ? WHERE user_id = ?");
        if ($upd) {
            $upd->bind_param("si", $newHash, $user['user_id']);
            $upd->execute();
            $upd->close();
        }
    }

    // Establish hardened session (regenerates id, prevents fixation).
    sec_login([
        'user_id'   => $user['user_id'],
        'username'  => $user['username'],
        'user_type' => $user['user_type'],
    ]);

    sys_log('auth', 'login_success', "User {$user['username']} ({$user['user_type']}) signed in", $user['user_id']);

    echo json_encode([
        'type'      => 'success',
        'message'   => 'Sign in successful',
        'user_id'   => $user['user_id'],
        'username'  => $user['username'],
        'full_name' => $user['full_name'] ?? $user['username'],
        'email'     => $user['email'],
        'phone'     => $user['phone'] ?? '',
        'user_type' => $user['user_type']
    ]);
}

function SignOutUser() {
    $uid = $_SESSION['user_id'] ?? null;
    $uname = $_SESSION['username'] ?? '';
    sec_logout();
    sys_log('auth', 'logout', "User {$uname} signed out", $uid);
    echo json_encode(['type' => 'success', 'message' => 'Signed out']);
}

function CurrentUser() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $uid = sec_current_user_id();
    if ($uid <= 0) {
        echo json_encode(['type' => 'error', 'message' => 'Not authenticated']);
        return;
    }

    $stmt = $connect->prepare("SELECT email, username, user_type FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1");
    if (!$stmt) {
        error_log('Current user lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to refresh account']);
        return;
    }
    $stmt->bind_param("i", $uid);
    if (!$stmt->execute()) {
        error_log('Current user lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to refresh account']);
        return;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) {
        http_response_code(401);
        echo json_encode(['type' => 'error', 'message' => 'Account is no longer active']);
        return;
    }

    $_SESSION['user_type'] = (string)$row['user_type'];
    $_SESSION['username'] = (string)$row['username'];

    echo json_encode([
        'type'      => 'success',
        'user_id'   => $uid,
        'username'  => (string)$row['username'],
        'email'     => (string)$row['email'],
        'user_type' => (string)$row['user_type'],
    ]);
}

/* ==========================================================
   SIGN UP
   ========================================================== */
function SendOtp() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $phone = canonical_phone($data['phone'] ?? '');
    $email = sani_str($data['email'] ?? '', 150);

    if (!is_valid_ph_mobile_number($phone)) {
        echo json_encode(['type' => 'error', 'message' => 'Please enter a valid Philippine mobile number.']);
        return;
    }

    if ($email !== '' && email_reject_reason($email) !== null) {
        echo json_encode(['type' => 'error', 'message' => 'Please enter a valid email address.']);
        return;
    }

    $otpCode = generate_otp_code();
    $expiresAt = date('Y-m-d H:i:s', strtotime('+10 minutes'));
    $otpHash = password_hash($otpCode, PASSWORD_DEFAULT);

    $stmt = $connect->prepare("SELECT user_id FROM users WHERE email = ? LIMIT 1");
    if ($stmt) {
        $stmt->bind_param('s', $email);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($existing) {
            echo json_encode(['type' => 'error', 'message' => 'Email address is already registered']);
            return;
        }
    }

    $stmt = $connect->prepare("SELECT user_id FROM users WHERE phone = ? LIMIT 1");
    if ($stmt) {
        $stmt->bind_param('s', $phone);
        $stmt->execute();
        $existing = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($existing) {
            echo json_encode(['type' => 'error', 'message' => 'Phone number is already registered']);
            return;
        }
    }

    $otpFile = __DIR__ . '/../uploads/otp_cache.php';
    $otpData = [];
    if (file_exists($otpFile)) {
        include $otpFile;
    }

    $otpData[$phone] = [
        'code' => $otpHash,
        'expires_at' => $expiresAt,
        'email' => $email,
        'created_at' => date('Y-m-d H:i:s')
    ];

    $smsOtpEnabled = false;
    $settingStmt = $connect->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'registration_sms_otp_enabled' LIMIT 1");
    if ($settingStmt) {
        $settingStmt->bind_result($settingValue);
        if ($settingStmt->execute() && $settingStmt->fetch()) {
            $smsOtpEnabled = filter_var($settingValue, FILTER_VALIDATE_BOOLEAN);
        }
        $settingStmt->close();
    }

    if ($smsOtpEnabled) {
        $smsFile = __DIR__ . '/../Notifications/sms_helper.php';
        $smsResult = null;
        if (file_exists($smsFile)) {
            include_once $smsFile;
            if (function_exists('sms_send')) {
                $smsResult = sms_send($phone, build_otp_message($otpCode));
            }
        }

        if (!is_array($smsResult) || empty($smsResult['ok'])) {
            echo json_encode([
                'type' => 'error',
                'message' => $smsResult['error'] ?? 'Unable to send the OTP SMS. Please try again later.',
            ]);
            return;
        }
    }

    $content = '<?php' . PHP_EOL . '$otpStore = ' . var_export($otpData, true) . ';' . PHP_EOL;
    @file_put_contents($otpFile, $content);

    $response = [
        'type' => 'success',
        'message' => $smsOtpEnabled
            ? 'OTP sent to your phone. Enter the code below to continue.'
            : 'Mock OTP generated for development. Enter the code below to continue.',
        'phone' => $phone
    ];
    if (!$smsOtpEnabled) {
        $response['code'] = $otpCode;
    }
    echo json_encode($response);
}

function VerifyOtp() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $phone = canonical_phone($data['phone'] ?? '');
    $code = sani_str($data['otp'] ?? '', 6);

    if (!is_valid_ph_mobile_number($phone)) {
        echo json_encode(['type' => 'error', 'message' => 'Please enter a valid Philippine mobile number.']);
        return;
    }

    if (!preg_match('/^\d{6}$/', $code)) {
        echo json_encode(['type' => 'error', 'message' => 'OTP must be 6 digits.']);
        return;
    }

    $otpFile = __DIR__ . '/../uploads/otp_cache.php';
    $otpStore = [];
    if (file_exists($otpFile)) {
        include $otpFile;
        if (isset($otpStore) && is_array($otpStore)) {
            $otpStore = $otpStore;
        }
    }

    if (!isset($otpStore[$phone])) {
        echo json_encode(['type' => 'error', 'message' => 'OTP not found or expired.']);
        return;
    }

    $entry = $otpStore[$phone];
    if (is_otp_expired($entry['expires_at'] ?? null)) {
        unset($otpStore[$phone]);
        @file_put_contents($otpFile, '<?php' . PHP_EOL . '$otpStore = ' . var_export($otpStore, true) . ';' . PHP_EOL);
        echo json_encode(['type' => 'error', 'message' => 'OTP expired. Please request a new one.']);
        return;
    }

    if (!password_verify($code, $entry['code'] ?? '')) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid OTP.']);
        return;
    }

    $otpStore[$phone]['verified'] = true;
    @file_put_contents($otpFile, '<?php' . PHP_EOL . '$otpStore = ' . var_export($otpStore, true) . ';' . PHP_EOL);

    echo json_encode(['type' => 'success', 'message' => 'OTP verified successfully.']);
}

function masked_reset_phone(string $phone): string {
    $digits = preg_replace('/\D/', '', $phone) ?? '';
    if (strlen($digits) < 5) {
        return '••••';
    }
    return substr($digits, 0, 2)
        . str_repeat('•', max(3, strlen($digits) - 4))
        . substr($digits, -2);
}

function passwordResetResponseMessage(): string {
    return 'If an account matches that username or email and has a registered phone number, a reset code has been sent.';
}

function RequestPasswordReset(): void {
    global $connect;
    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }
    if (!sec_throttle('password_reset_request', 3, 900)) {
        $retryAfter = sec_throttle_retry_after('password_reset_request', 900);
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        echo json_encode([
            'type' => 'error',
            'message' => 'Too many password reset requests. Please wait before trying again.',
            'retry_after' => $retryAfter,
        ]);
        return;
    }

    unset($_SESSION['password_reset']);
    $data = json_decode(file_get_contents('php://input'), true);
    $identifier = is_array($data) ? sani_str($data['identifier'] ?? '', 150) : '';
    if ($identifier === '') {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter your username or email address.']);
        return;
    }

    $stmt = $connect->prepare(
        'SELECT user_id, phone FROM users WHERE username = ? OR email = ? LIMIT 1'
    );
    if (!$stmt) {
        error_log('Password reset account lookup failed: ' . $connect->error);
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }
    $stmt->bind_param('ss', $identifier, $identifier);
    if (!$stmt->execute()) {
        error_log('Password reset account lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }
    $account = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $response = [
        'type' => 'success',
        'message' => passwordResetResponseMessage(),
    ];
    $phone = $account ? canonical_phone((string)($account['phone'] ?? '')) : '';
    if (!$account || !is_valid_ph_mobile_number($phone)) {
        echo json_encode($response);
        return;
    }

    $settingStmt = $connect->prepare(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'registration_sms_otp_enabled' LIMIT 1"
    );
    if (!$settingStmt) {
        error_log('Password reset SMS setting lookup failed: ' . $connect->error);
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }
    $smsOtpEnabled = false;
    $settingValue = '';
    if (!$settingStmt->execute()) {
        error_log('Password reset SMS setting lookup failed: ' . $settingStmt->error);
        $settingStmt->close();
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }
    $settingStmt->bind_result($settingValue);
    if ($settingStmt->fetch()) {
        $smsOtpEnabled = filter_var($settingValue, FILTER_VALIDATE_BOOLEAN);
    }
    $settingStmt->close();

    $code = generate_otp_code();
    if ($smsOtpEnabled) {
        $smsFile = __DIR__ . '/../Notifications/sms_helper.php';
        if (!is_file($smsFile)) {
            error_log('Password reset SMS failed: SMS helper is missing');
            http_response_code(503);
            echo json_encode(['type' => 'error', 'message' => 'Unable to send the reset code. Please try again later.']);
            return;
        }
        include_once $smsFile;
        if (!function_exists('sms_send')) {
            error_log('Password reset SMS failed: sms_send is unavailable');
            http_response_code(503);
            echo json_encode(['type' => 'error', 'message' => 'Unable to send the reset code. Please try again later.']);
            return;
        }
        $smsResult = sms_send($phone, "Your Myle's Boarding House password reset code is {$code}. It expires in 10 minutes.");
        if (!is_array($smsResult) || empty($smsResult['ok'])) {
            error_log('Password reset SMS delivery failed');
            http_response_code(503);
            echo json_encode(['type' => 'error', 'message' => 'Unable to send the reset code. Please try again later.']);
            return;
        }
    }

    $_SESSION['password_reset'] = [
        'user_id' => (int)$account['user_id'],
        'phone' => $phone,
        'code_hash' => password_hash($code, PASSWORD_DEFAULT),
        'expires_at' => time() + 600,
        'attempts' => 0,
        'verified' => false,
    ];

    $response['phone_hint'] = masked_reset_phone($phone);
    if (!$smsOtpEnabled) {
        $response['code'] = $code;
        $response['message'] = 'Development mode: enter the generated code to continue.';
    }
    echo json_encode($response);
}

function VerifyPasswordReset(): void {
    if (!sec_throttle('password_reset_verify', 10, 900)) {
        $retryAfter = sec_throttle_retry_after('password_reset_verify', 900);
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        echo json_encode([
            'type' => 'error',
            'message' => 'Too many code attempts. Please wait before trying again.',
            'retry_after' => $retryAfter,
        ]);
        return;
    }

    $reset = $_SESSION['password_reset'] ?? null;
    $data = json_decode(file_get_contents('php://input'), true);
    $code = is_array($data) ? sani_str($data['otp'] ?? '', 6) : '';
    if (!is_array($reset) || !preg_match('/^\d{6}$/', $code)) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter the 6-digit reset code.']);
        return;
    }
    if ((int)($reset['expires_at'] ?? 0) < time()) {
        unset($_SESSION['password_reset']);
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'The reset code expired. Request a new code.']);
        return;
    }
    if ((int)($reset['attempts'] ?? 0) >= 5) {
        unset($_SESSION['password_reset']);
        http_response_code(429);
        echo json_encode(['type' => 'error', 'message' => 'Too many incorrect codes. Request a new reset code.']);
        return;
    }

    if (!password_verify($code, (string)($reset['code_hash'] ?? ''))) {
        $_SESSION['password_reset']['attempts'] = (int)$reset['attempts'] + 1;
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid reset code.']);
        return;
    }

    session_regenerate_id(true);
    $resetToken = bin2hex(random_bytes(32));
    $_SESSION['password_reset']['verified'] = true;
    $_SESSION['password_reset']['token_hash'] = hash('sha256', $resetToken);
    $_SESSION['password_reset']['token_expires_at'] = time() + 600;
    echo json_encode([
        'type' => 'success',
        'message' => 'Reset code verified.',
        'reset_token' => $resetToken,
    ]);
}

function ResetPassword(): void {
    global $connect;
    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Password reset is temporarily unavailable.']);
        return;
    }

    $reset = $_SESSION['password_reset'] ?? null;
    $data = json_decode(file_get_contents('php://input'), true);
    $newPassword = is_array($data) && is_string($data['new_password'] ?? null)
        ? $data['new_password']
        : '';
    $resetToken = is_array($data) ? sani_str($data['reset_token'] ?? '', 64) : '';
    if (!is_array($reset)
        || empty($reset['verified'])
        || (int)($reset['token_expires_at'] ?? 0) < time()
        || $resetToken === ''
        || !hash_equals((string)($reset['token_hash'] ?? ''), hash('sha256', $resetToken))) {
        unset($_SESSION['password_reset']);
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Verify a valid reset code before changing your password.']);
        return;
    }
    if (strlen($newPassword) < 6 || strlen($newPassword) > 200) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Password must be 6–200 characters long.']);
        return;
    }

    $userId = (int)($reset['user_id'] ?? 0);
    $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $connect->prepare('UPDATE users SET password = ? WHERE user_id = ?');
    if (!$stmt) {
        error_log('Password reset update failed: ' . $connect->error);
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Unable to update your password right now.']);
        return;
    }
    $stmt->bind_param('si', $passwordHash, $userId);
    if (!$stmt->execute() || $stmt->affected_rows !== 1) {
        error_log('Password reset update failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to update your password right now.']);
        return;
    }
    $stmt->close();
    unset($_SESSION['password_reset']);
    sys_log('auth', 'password_reset', 'Password reset completed', $userId);
    echo json_encode(['type' => 'success', 'message' => 'Password changed successfully. You can now sign in.']);
}

function SignUpUser() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
    $data = [];
    if (stripos($contentType, 'multipart/form-data') !== false) {
        $data = $_POST;
    } else {
        $data = json_decode(file_get_contents('php://input'), true) ?: [];
    }

    $full_name = sani_str($data['full_name'] ?? '', 150);
    $username  = sani_str($data['username']  ?? '', 50);
    $email     = sani_str($data['email']     ?? '', 150);
    $phone     = canonical_phone($data['phone'] ?? '');
    $address   = sani_str($data['address'] ?? '', 255);
    $birthday  = sani_str($data['birthday'] ?? '', 10);
    $emergency_contact_name = sani_str($data['emergency_contact_name'] ?? '', 150);
    $emergency_contact_phone = canonical_phone($data['emergency_contact_phone'] ?? '');
    $otp       = sani_str($data['otp']       ?? '', 6);
    $password  = is_string($data['password'] ?? null) ? $data['password'] : '';
    $user_type = sani_str($data['user_type'] ?? 'Tenant', 20);
    $uploadFile = $_FILES['profile_picture'] ?? null;
    $targetPath = null;
    $cleanupProfilePicture = static function () use (&$targetPath): void {
        if (is_string($targetPath)) {
            @unlink($targetPath);
        }
    };
    $profilePicturePath = null;
    if (is_array($uploadFile) && ($uploadFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        if (!valid_profile_picture_upload($uploadFile)) {
            echo json_encode(['type' => 'error', 'message' => 'Please upload a profile picture in JPG, PNG, or WEBP format, max 10MB.']);
            return;
        }

        $uploadDir = __DIR__ . '/../uploads/profile_pictures/';
        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            sys_log('auth', 'upload_failed', 'Failed to create profile picture uploads directory');
            echo json_encode(['type' => 'error', 'message' => 'Server error uploading profile picture']);
            return;
        }

        $tmpFile = $uploadFile['tmp_name'];
        $mime = mime_content_type($tmpFile) ?: '';
        $ext = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
        $safeBase = preg_replace('/[^A-Za-z0-9_-]/', '_', $username ?: 'user');
        $profile_picture_filename = sprintf('%s_%s.%s', $safeBase, bin2hex(random_bytes(8)), $ext);
        $targetPath = $uploadDir . $profile_picture_filename;
        if (!move_uploaded_file($tmpFile, $targetPath)) {
            sys_log('auth', 'upload_failed', 'Failed to move uploaded profile picture');
            echo json_encode(['type' => 'error', 'message' => 'Unable to save the uploaded profile picture']);
            return;
        }
        $profilePicturePath = 'profile_pictures/' . $profile_picture_filename;
    }

    // Field-level validation
    if (!valid_full_name($full_name)) {
        echo json_encode(['type' => 'error', 'message' => 'Please enter a valid full name (letters only, 2–150 chars).']);
        return;
    }
    if (!valid_username($username)) {
        echo json_encode(['type' => 'error', 'message' => 'Username must be 3–50 chars and may only contain letters, numbers, and . _ -']);
        return;
    }
    $email_reason = email_reject_reason($email);
    if ($email_reason !== null) {
        echo json_encode(['type' => 'error', 'message' => $email_reason]);
        return;
    }
    if (!valid_phone($phone)) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid phone number']);
        return;
    }
    $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $birthday);
    $birthDateErrors = DateTimeImmutable::getLastErrors();
    if (
        $address === '' ||
        $birthDate === false ||
        $birthDate->format('Y-m-d') !== $birthday ||
        ($birthDateErrors !== false && ($birthDateErrors['warning_count'] > 0 || $birthDateErrors['error_count'] > 0)) ||
        $birthDate > new DateTimeImmutable('today')
    ) {
        $cleanupProfilePicture();
        echo json_encode(['type' => 'error', 'message' => 'Please provide a valid address and birthday.']);
        return;
    }
    $today = new DateTimeImmutable('today');
    $age = $birthDate->diff($today)->y;
    if ($age > 120) {
        $cleanupProfilePicture();
        echo json_encode(['type' => 'error', 'message' => 'Please provide a valid birthday.']);
        return;
    }
    if ($emergency_contact_name === '') {
        echo json_encode(['type' => 'error', 'message' => 'Emergency contact name is required']);
        return;
    }
    if (!valid_phone($emergency_contact_phone)) {
        echo json_encode(['type' => 'error', 'message' => 'Enter a valid Philippine emergency contact phone number']);
        return;
    }
    if (!preg_match('/^\d{6}$/', $otp)) {
        echo json_encode(['type' => 'error', 'message' => 'Please enter the 6-digit OTP sent to your phone.']);
        return;
    }
    if (strlen($password) < 6 || strlen($password) > 200) {
        echo json_encode(['type' => 'error', 'message' => 'Password must be 6–200 characters long']);
        return;
    }

    // Role whitelist — public signups default to Guest
    $allowed_roles = ['Guest', 'Tenant']; // Admin cannot self-register
    if (!in_array($user_type, $allowed_roles, true)) {
        $user_type = 'Guest';
    }

    // Uniqueness check — prevent duplicate email addresses (prepared statement)
    $checkStmt = $connect->prepare("SELECT user_id FROM users WHERE email = ? LIMIT 1");
    if (!$checkStmt) {
        sys_log('auth', 'db_prepare_failed', 'SignUpUser email check prepare failed: ' . ($connect->error ?? 'unknown'));
        echo json_encode(['type' => 'error', 'message' => 'Server error']);
        return;
    }
    $checkStmt->bind_param("s", $email);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();
    if ($checkResult->num_rows > 0) {
        $checkStmt->close();
        $cleanupProfilePicture();
        echo json_encode(['type' => 'error', 'message' => 'Email address is already registered']);
        return;
    }
    $checkStmt->close();

    $otpFile = __DIR__ . '/../uploads/otp_cache.php';
    $otpStore = [];
    if (file_exists($otpFile)) {
        include $otpFile;
        if (isset($otpStore) && is_array($otpStore)) {
            $otpStore = $otpStore;
        }
    }

    if (!isset($otpStore[$phone]) || empty($otpStore[$phone]['verified'])) {
        echo json_encode(['type' => 'error', 'message' => 'Please verify your phone number first.']);
        return;
    }

    if (is_otp_expired($otpStore[$phone]['expires_at'] ?? null)) {
        unset($otpStore[$phone]);
        @file_put_contents($otpFile, '<?php' . PHP_EOL . '$otpStore = ' . var_export($otpStore, true) . ';' . PHP_EOL);
        echo json_encode(['type' => 'error', 'message' => 'OTP expired. Please request a new one.']);
        return;
    }

    if (!password_verify($otp, $otpStore[$phone]['code'] ?? '')) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid OTP.']);
        return;
    }

    // Prevent duplicate phone numbers (if provided)
    if ($phone !== '') {
        $checkStmt = $connect->prepare("SELECT user_id FROM users WHERE phone = ? LIMIT 1");
        if (!$checkStmt) {
            sys_log('auth', 'db_prepare_failed', 'SignUpUser phone check prepare failed: ' . ($connect->error ?? 'unknown'));
            $cleanupProfilePicture();
            echo json_encode(['type' => 'error', 'message' => 'Server error']);
            return;
        }
        $checkStmt->bind_param("s", $phone);
        $checkStmt->execute();
        $checkResult = $checkStmt->get_result();
        if ($checkResult->num_rows > 0) {
            $checkStmt->close();
            $cleanupProfilePicture();
            echo json_encode(['type' => 'error', 'message' => 'Phone number is already registered']);
            return;
        }
        $checkStmt->close();
    }

    // Prevent duplicate usernames
    $checkStmt = $connect->prepare("SELECT user_id FROM users WHERE username = ? LIMIT 1");
    if (!$checkStmt) {
        sys_log('auth', 'db_prepare_failed', 'SignUpUser username check prepare failed: ' . ($connect->error ?? 'unknown'));
        $cleanupProfilePicture();
        echo json_encode(['type' => 'error', 'message' => 'Server error']);
        return;
    }
    $checkStmt->bind_param("s", $username);
    $checkStmt->execute();
    $checkResult = $checkStmt->get_result();
    if ($checkResult->num_rows > 0) {
        $checkStmt->close();
        @unlink($targetPath);
        echo json_encode(['type' => 'error', 'message' => 'Username already exists']);
        return;
    }
    $checkStmt->close();

    if (!signup_throttle_ok()) {
        $cleanupProfilePicture();
        $retryAfter = sec_throttle_retry_after('signup', 600);
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        echo json_encode([
            'type' => 'error',
            'message' => 'The registration limit for this network has been reached. Please wait before trying again.',
            'retry_after' => $retryAfter,
        ]);
        return;
    }

    $hashed_password = password_hash($password, PASSWORD_DEFAULT);
    $is_active       = ($user_type === 'Guest') ? 1 : 0;
    if (!users_has_column('address') || !users_has_column('age') || !users_has_column('birthday')) {
        $cleanupProfilePicture();
        error_log('Sign-up blocked: personal information columns are missing from users table');
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Account database needs an update. Please contact the administrator.']);
        return;
    }
    $columns = ['full_name', 'username', 'email', 'phone', 'password'];
    $placeholders = ['?', '?', '?', '?', '?'];
    $values = [$full_name, $username, $email, $phone, $hashed_password];
    $types = 'sssss';

    $columns = array_merge($columns, ['address', 'age', 'birthday']);
    $placeholders = array_merge($placeholders, ['?', '?', '?']);
    $values[] = $address;
    $values[] = $age;
    $values[] = $birthday;
    $types .= 'sis';

    if (!users_has_column('emergency_contact_name') || !users_has_column('emergency_contact_phone')) {
        $cleanupProfilePicture();
        error_log('Sign-up blocked: emergency contact columns are missing from users table');
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Account database needs an update. Please contact the administrator.']);
        return;
    }
    $columns[] = 'emergency_contact_name';
    $placeholders[] = '?';
    $values[] = $emergency_contact_name;
    $types .= 's';
    $columns[] = 'emergency_contact_phone';
    $placeholders[] = '?';
    $values[] = $emergency_contact_phone;
    $types .= 's';

    if (users_has_column('profile_picture')) {
        $columns[] = 'profile_picture';
        $placeholders[] = '?';
        $values[] = $profilePicturePath;
        $types .= 's';
    }
    $columns = array_merge($columns, ['user_type', 'is_active', 'created_at']);
    $placeholders = array_merge($placeholders, ['?', '?', 'NOW()']);
    $values[] = $user_type;
    $values[] = $is_active;
    $types .= 'si';

    // Insert with prepared statement — no user input ever concatenated into SQL.
    $insertStmt = $connect->prepare(
        "INSERT INTO users (" . implode(', ', $columns) . ")
         VALUES (" . implode(', ', $placeholders) . ")"
    );
    if (!$insertStmt) {
        sys_log('auth', 'db_prepare_failed', 'SignUpUser insert prepare failed: ' . ($connect->error ?? 'unknown'));
        $cleanupProfilePicture();
        echo json_encode(['type' => 'error', 'message' => 'Server error']);
        return;
    }
    $insertStmt->bind_param($types, ...$values);

    if ($insertStmt->execute()) {
        $new_user_id = $insertStmt->insert_id;
        $insertStmt->close();
        sys_log('auth', 'signup', "New {$user_type} account: {$username}", $new_user_id);

        $roleLabel = $user_type === 'Guest' ? 'New Guest Registered' : 'New Tenant Registered';
        $welcomeMessage = $user_type === 'Guest'
            ? 'Welcome to the guest portal. Your account has been created and is ready to use.'
            : 'Your tenant account has been created and is pending administrator approval.';

        system_notify_user($connect, $new_user_id, 'Welcome', $welcomeMessage, 'info');
        system_notify_admins($connect, $roleLabel, "{$full_name} ({$username}) registered as a {$user_type} user.", 'user_registration');

        echo json_encode([
            'type'      => 'success',
            'message'   => $user_type === 'Guest'
                ? 'Account created successfully. Welcome to your guest portal.'
                : 'Account created successfully. Your account is waiting for administrator approval.',
            'user_id'   => $new_user_id,
            'username'  => $username,
            'full_name' => $full_name,
            'email'     => $email,
            'phone'     => $phone,
            'user_type' => $user_type
        ]);
    } else {
        $insertStmt->close();
        $cleanupProfilePicture();
        sys_log('auth', 'signup_failed', "Sign-up failed for {$username}", null, 'warning');
        echo json_encode(['type' => 'error', 'message' => 'Failed to create account']);
    }
}

/* ==========================================================
   AVAILABILITY CHECKS
   ========================================================== */
function checkUsernameAvailability() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $username = sani_str($_GET['username'] ?? '', 50);
    if (!valid_username($username)) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid username']);
        return;
    }

    $stmt = $connect->prepare("SELECT COUNT(*) AS count FROM users WHERE username = ?");
    $stmt->bind_param("s", $username);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    echo json_encode(['type' => 'success', 'available' => ((int)$row['count']) === 0]);
}

function checkEmailAvailability() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $email = sani_str($_GET['email'] ?? '', 150);
    if (!valid_email($email)) {
        echo json_encode(['type' => 'error', 'message' => 'Invalid email']);
        return;
    }

    $stmt = $connect->prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    echo json_encode(['type' => 'success', 'available' => ((int)$row['count']) === 0]);
}
