<?php
/**
 * MySQL connection for Myle's Boarding House.
 *
 * XAMPP defaults (per your Control Panel screenshot):
 *   - MySQL host: 127.0.0.1
 *   - MySQL port: 3306   <-- standard XAMPP/MariaDB port
 *   - User:       root
 *   - Password:   (empty)
 *
 * Override any of these with environment variables if your XAMPP install
 * uses a different port (e.g. when 3306 is taken and XAMPP falls back to
 * 3307). Just set DB_PORT=3307 before starting Apache/PHP.
 */

$host    = getenv('DB_HOST')     ?: '127.0.0.1';
$user    = getenv('DB_USER')     ?: 'root';
$pass    = getenv('DB_PASSWORD') ?: '';
$dbNameEnv = getenv('DB_NAME');
$port      = (int)(getenv('DB_PORT') ?: 3306);

// Make mysqli throw structured exceptions instead of warnings on bad SQL.
mysqli_report(MYSQLI_REPORT_OFF);

// Try the environment value first (if present), then a few common variants
// so the app can work even when the database name was created with a
// slightly different convention on the developer's machine.
$candidates = [];
if ($dbNameEnv) {
    $candidates[] = $dbNameEnv;
}
$candidates = array_merge($candidates, [
    'Boarding-House-Database',
    'boarding-house-database',
    'boarding_house_database',
]);
$candidates = array_values(array_unique($candidates));

$lastError = null;
$connect = null;
foreach ($candidates as $candidate) {
    $tmp = mysqli_init();
    if ($tmp) {
        $tmp->options(MYSQLI_OPT_CONNECT_TIMEOUT, 2);
    }
    if ($tmp && @$tmp->real_connect($host, $user, $pass, $candidate, $port)) {
        $connect = $tmp;
        $dbName = $candidate;
        break;
    }
    $lastError = $tmp ? $tmp->connect_error : 'Unable to initialize MySQL connection';
    $errorCode = $tmp ? $tmp->connect_errno : 0;
    if ($tmp) {
        $tmp->close();
    }
    if ($errorCode !== 1049) {
        break;
    }
}

if (!$connect) {
    // Write a helpful message to the Apache/PHP error log for debugging.
    error_log('DB connection failed. Tried: ' . implode(', ', $candidates) . '. Last error: ' . $lastError);
    $connect = null;
} else {
    // Force a safe character set so bound parameters can never be misinterpreted
    // by the server's default charset (defense-in-depth alongside prepared stmts).
    @mysqli_set_charset($connect, 'utf8mb4');
}
