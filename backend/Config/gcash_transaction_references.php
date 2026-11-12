<?php

require_once __DIR__ . '/refund_requests.php';
require_once __DIR__ . '/full_payment_requests.php';

function ensure_gcash_transaction_references_table(mysqli $connect): bool {
    static $ready = false;
    if ($ready) {
        return true;
    }

    if (!ensure_refund_requests_table($connect)
        || !ensure_full_payment_requests_table($connect)) {
        return false;
    }

    $ok = $connect->query("
        CREATE TABLE IF NOT EXISTS gcash_transaction_references (
          reference_number VARCHAR(120) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (reference_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    if (!$ok) {
        error_log('Unable to initialize GCash transaction reference storage: ' . $connect->error);
        return false;
    }

    $ok = $connect->query("
        INSERT IGNORE INTO gcash_transaction_references (reference_number)
        SELECT reference_number FROM payments
        WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> ''
        UNION
        SELECT reference_number FROM booking_initial_payment_requests
        WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> ''
        UNION
        SELECT reference_number FROM full_payment_requests
        WHERE reference_number IS NOT NULL AND TRIM(reference_number) <> ''
        UNION
        SELECT transaction_reference FROM refund_requests
        WHERE transaction_reference IS NOT NULL AND TRIM(transaction_reference) <> ''
        UNION
        SELECT transfer_reference FROM refund_requests
        WHERE transfer_reference IS NOT NULL AND TRIM(transfer_reference) <> ''
    ");
    if (!$ok) {
        error_log('Unable to load existing GCash transaction references: ' . $connect->error);
        return false;
    }

    $ready = true;
    return true;
}

/**
 * Reserves a reference in the current transaction.
 *
 * Returns true when reserved, false when it has already been used, and null
 * when a database operation fails.
 */
function reserve_gcash_transaction_reference(mysqli $connect, string $reference): ?bool {
    $reference = trim($reference);
    if ($reference === '') {
        return true;
    }

    $existing = $connect->prepare("
        SELECT 1 FROM payments WHERE reference_number = ?
        UNION ALL
        SELECT 1 FROM booking_initial_payment_requests WHERE reference_number = ?
        UNION ALL
        SELECT 1 FROM full_payment_requests WHERE reference_number = ?
        UNION ALL
        SELECT 1 FROM refund_requests WHERE transaction_reference = ?
        UNION ALL
        SELECT 1 FROM refund_requests WHERE transfer_reference = ?
        LIMIT 1
    ");
    if (!$existing) {
        error_log('GCash transaction reference lookup prepare failed: ' . $connect->error);
        return null;
    }
    $existing->bind_param('sssss', $reference, $reference, $reference, $reference, $reference);
    if (!$existing->execute()) {
        error_log('GCash transaction reference lookup failed: ' . $existing->error);
        $existing->close();
        return null;
    }
    $isUsed = (bool)$existing->get_result()->fetch_assoc();
    $existing->close();
    if ($isUsed) {
        return false;
    }

    $reserve = $connect->prepare('INSERT INTO gcash_transaction_references (reference_number) VALUES (?)');
    if (!$reserve) {
        error_log('GCash transaction reference reservation prepare failed: ' . $connect->error);
        return null;
    }
    $reserve->bind_param('s', $reference);
    if (!$reserve->execute()) {
        $errorCode = $reserve->errno;
        if ($errorCode !== 1062) {
            error_log('GCash transaction reference reservation failed: ' . $reserve->error);
        }
        $reserve->close();
        return $errorCode === 1062 ? false : null;
    }
    $reserve->close();
    return true;
}
