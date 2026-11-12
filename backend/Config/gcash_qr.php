<?php

function gcash_qr_ensure_amount_table(mysqli $connect): bool {
    static $ready = false;
    if ($ready) return true;

    $ok = $connect->query("
        CREATE TABLE IF NOT EXISTS gcash_qr_codes (
          qr_id int(11) NOT NULL AUTO_INCREMENT,
          filename varchar(255) NOT NULL,
          amount decimal(10,2) DEFAULT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp(),
          PRIMARY KEY (qr_id),
          UNIQUE KEY uq_gcash_qr_filename (filename),
          UNIQUE KEY uq_gcash_qr_amount (amount)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    if (!$ok) {
        error_log('Unable to initialize GCash QR amount table: ' . $connect->error);
        return false;
    }

    $ready = true;
    return true;
}

function gcash_qr_available(float $amount): bool {
    global $connect;
    $amount = round($amount, 2);
    $builtInAmounts = [2500.00, 4000.00, 5000.00, 10000.00];
    foreach ($builtInAmounts as $builtInAmount) {
        if (abs($amount - $builtInAmount) < 0.01) {
            return true;
        }
    }

    if (!isset($connect) || !($connect instanceof mysqli)) {
        error_log('Unable to verify fixed-amount GCash QR: database connection unavailable');
        throw new RuntimeException('Unable to validate the GCash QR');
    }
    if (!gcash_qr_ensure_amount_table($connect)) {
        throw new RuntimeException('Unable to validate the GCash QR');
    }
    $stmt = $connect->prepare('SELECT filename FROM gcash_qr_codes WHERE amount = ? LIMIT 1');
    if (!$stmt) {
        error_log('Unable to prepare fixed-amount GCash QR lookup: ' . $connect->error);
        throw new RuntimeException('Unable to validate the GCash QR');
    }
    $stmt->bind_param('d', $amount);
    if (!$stmt->execute()) {
        error_log('Fixed-amount GCash QR lookup failed: ' . $stmt->error);
        $stmt->close();
        throw new RuntimeException('Unable to validate the GCash QR');
    }
    $filename = (string)($stmt->get_result()->fetch_assoc()['filename'] ?? '');
    $stmt->close();
    if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)) {
        return false;
    }

    $qrDir = realpath(__DIR__ . '/../uploads/gcash_qr');
    $qrPath = $qrDir === false ? false : realpath($qrDir . DIRECTORY_SEPARATOR . $filename);
    return $qrDir !== false
        && $qrPath !== false
        && !is_link(__DIR__ . '/../uploads/gcash_qr/' . $filename)
        && is_file($qrPath)
        && dirname($qrPath) === $qrDir;
}
