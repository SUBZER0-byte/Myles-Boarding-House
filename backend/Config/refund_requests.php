<?php

function ensure_refund_requests_table(mysqli $connect): bool {
    static $ready = false;
    if ($ready) return true;

    $ok = $connect->query("
        CREATE TABLE IF NOT EXISTS refund_requests (
          refund_id INT NOT NULL AUTO_INCREMENT,
          payment_id INT NOT NULL,
          user_id INT NOT NULL,
          refund_amount DECIMAL(10,2) NOT NULL,
          gcash_account_name VARCHAR(120) NOT NULL,
          gcash_number VARCHAR(30) NOT NULL,
          transaction_reference VARCHAR(120) DEFAULT NULL,
          screenshot_path VARCHAR(255) DEFAULT NULL,
          transfer_reference VARCHAR(120) DEFAULT NULL,
          transfer_screenshot_path VARCHAR(255) DEFAULT NULL,
          reason TEXT DEFAULT NULL,
          status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
          admin_note TEXT DEFAULT NULL,
          acted_by INT DEFAULT NULL,
          acted_at DATETIME DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (refund_id),
          KEY idx_refund_requests_payment_status (payment_id, status),
          KEY idx_refund_requests_user (user_id, created_at),
          CONSTRAINT fk_refund_requests_payment
            FOREIGN KEY (payment_id) REFERENCES payments (payment_id) ON DELETE RESTRICT,
          CONSTRAINT fk_refund_requests_user
            FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    if (!$ok) {
        error_log('Unable to initialize refund requests table: ' . $connect->error);
        return false;
    }
    foreach ([
        'gcash_account_name' => 'ALTER TABLE refund_requests ADD COLUMN gcash_account_name VARCHAR(120) NOT NULL DEFAULT \'\' AFTER refund_amount',
        'gcash_number' => 'ALTER TABLE refund_requests ADD COLUMN gcash_number VARCHAR(30) NOT NULL DEFAULT \'\' AFTER gcash_account_name',
        'transfer_reference' => 'ALTER TABLE refund_requests ADD COLUMN transfer_reference VARCHAR(120) DEFAULT NULL AFTER screenshot_path',
        'transfer_screenshot_path' => 'ALTER TABLE refund_requests ADD COLUMN transfer_screenshot_path VARCHAR(255) DEFAULT NULL AFTER transfer_reference',
    ] as $column => $alterSql) {
        $columnResult = $connect->query("SHOW COLUMNS FROM refund_requests LIKE '{$column}'");
        if (!$columnResult) {
            error_log('Unable to inspect refund request schema: ' . $connect->error);
            return false;
        }
        $columnExists = $columnResult->num_rows > 0;
        $columnResult->free();
        if (!$columnExists && !$connect->query($alterSql)) {
            error_log('Unable to add ' . $column . ' to refund requests: ' . $connect->error);
            return false;
        }
    }
    $ready = true;
    return true;
}
