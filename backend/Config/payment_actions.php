<?php

function mark_rent_payment_paid(
    mysqli $connect,
    int $paymentId,
    string $method,
    string $reference,
    ?string $description = null,
    ?bool &$updated = null
): bool {
    $stmt = $connect->prepare("
        UPDATE payments
        SET status = 'Paid',
            submitted_at = COALESCE(submitted_at, NOW()),
            paid_at = COALESCE(paid_at, NOW()),
            method = ?,
            reference_number = ?,
            description = COALESCE(?, description)
        WHERE payment_id = ? AND status <> 'Cancelled'
    ");
    if (!$stmt) {
        error_log('Rent payment confirmation prepare failed: ' . $connect->error);
        return false;
    }
    $stmt->bind_param('sssi', $method, $reference, $description, $paymentId);
    $ok = $stmt->execute();
    $updated = $stmt->affected_rows > 0;
    if (!$ok) error_log('Rent payment confirmation failed: ' . $stmt->error);
    $stmt->close();
    return $ok;
}
