<?php

function ensure_payment_proofs_table(mysqli $connect): bool {
    static $ready = false;
    if ($ready) return true;

    $ok = $connect->query("
        CREATE TABLE IF NOT EXISTS payment_proofs (
          payment_id INT NOT NULL,
          screenshot_path VARCHAR(255) NOT NULL,
          uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (payment_id),
          CONSTRAINT fk_payment_proofs_payment
            FOREIGN KEY (payment_id) REFERENCES payments (payment_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    if (!$ok) {
        error_log('Unable to initialize payment proof table: ' . $connect->error);
        return false;
    }
    $ready = true;
    return true;
}

function store_payment_screenshot(array $file): array {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return [null, 'GCash screenshot upload failed'];
    }
    if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > 5 * 1024 * 1024) {
        return [null, 'GCash screenshot must be 5MB or smaller'];
    }

    $info = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $info ? finfo_file($info, (string)($file['tmp_name'] ?? '')) : false;
    if ($info) finfo_close($info);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!is_string($mime) || !isset($extensions[$mime])) {
        return [null, 'GCash screenshot must be JPG, PNG, or WEBP'];
    }

    $directory = __DIR__ . '/../uploads/payment_proofs/';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        return [null, 'Unable to create payment screenshot folder'];
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    if (!move_uploaded_file((string)$file['tmp_name'], $directory . $filename)) {
        return [null, 'Unable to save GCash screenshot'];
    }
    return ['payment_proofs/' . $filename, null];
}
