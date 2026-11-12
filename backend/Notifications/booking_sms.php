<?php
require_once __DIR__ . '/sms_helper.php';

function sms_send_once(mysqli $connect, string $eventKey, string $recipient, string $message): array {
    $phone = sms_normalize_ph($recipient);
    if ($phone === '') {
        return ['ok' => false, 'error' => 'Missing recipient phone number'];
    }

    $claim = $connect->prepare("
        INSERT IGNORE INTO sms_delivery_log (event_key, recipient_phone, status, attempted_at)
        VALUES (?, ?, 'sending', NOW())
    ");
    if (!$claim) {
        error_log('Unable to prepare SMS delivery claim: ' . $connect->error);
        return ['ok' => false, 'error' => 'Unable to record SMS delivery attempt'];
    }
    $claim->bind_param('ss', $eventKey, $phone);
    if (!$claim->execute()) {
        error_log('Unable to claim SMS delivery: ' . $claim->error);
        $claim->close();
        return ['ok' => false, 'error' => 'Unable to record SMS delivery attempt'];
    }
    $claimed = $claim->affected_rows === 1;
    $claim->close();

    if (!$claimed) {
        $retry = $connect->prepare("
            UPDATE sms_delivery_log
            SET status = 'sending', attempted_at = NOW(), sent_at = NULL, last_error = NULL
            WHERE event_key = ? AND recipient_phone = ? AND status = 'failed'
        ");
        if (!$retry) {
            error_log('Unable to prepare SMS delivery retry: ' . $connect->error);
            return ['ok' => false, 'error' => 'Unable to retry SMS delivery'];
        }
        $retry->bind_param('ss', $eventKey, $phone);
        $retried = $retry->execute() && $retry->affected_rows === 1;
        $retry->close();
        if (!$retried) {
            return ['ok' => true, 'duplicate' => true];
        }
    }

    $result = sms_send($phone, $message);
    $status = $result['ok'] ? 'sent' : 'failed';
    $error = $result['error'] ?? null;
    if (!$result['ok'] && !$error) {
        $error = 'TextBee request failed with HTTP status ' . (int)($result['status'] ?? 0);
    }
    $error = $error === null ? null : substr((string)$error, 0, 500);
    $update = $connect->prepare("
        UPDATE sms_delivery_log
        SET status = ?, sent_at = IF(? = 'sent', NOW(), NULL), last_error = ?
        WHERE event_key = ? AND recipient_phone = ?
    ");
    if (!$update) {
        error_log('Unable to prepare SMS delivery result update: ' . $connect->error);
        return $result;
    }
    $update->bind_param('sssss', $status, $status, $error, $eventKey, $phone);
    if (!$update->execute()) {
        error_log('Unable to save SMS delivery result: ' . $update->error);
    }
    $update->close();
    return $result;
}

function sms_notify_admins_booking_payment(
    mysqli $connect,
    int $bookingId,
    string $method,
    float $amount,
    string $reference
): void {
    $bookingStmt = $connect->prepare("SELECT full_name FROM bookings WHERE booking_id = ? LIMIT 1");
    if (!$bookingStmt) {
        error_log('Unable to load booking for payment SMS: ' . $connect->error);
        return;
    }
    $bookingStmt->bind_param('i', $bookingId);
    if (!$bookingStmt->execute()) {
        error_log('Unable to load booking for payment SMS: ' . $bookingStmt->error);
        $bookingStmt->close();
        return;
    }
    $booking = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();
    if (!$booking) return;

    $admins = $connect->query("
        SELECT user_id, phone FROM users
        WHERE user_type = 'Admin' AND is_active = 1 AND phone IS NOT NULL AND TRIM(phone) <> ''
    ");
    if (!$admins) {
        error_log('Unable to load Admin phone numbers for payment SMS: ' . $connect->error);
        return;
    }

    $message = "Booking payment submitted for review: {$booking['full_name']}, PHP "
        . number_format($amount, 2) . " via {$method}. Booking #{$bookingId}.";
    $eventKey = 'booking-payment-submitted:' . $bookingId . ':' . strtolower($method) . ':' . hash('sha256', $reference);
    while ($admin = $admins->fetch_assoc()) {
        sms_send_once($connect, $eventKey, (string)$admin['phone'], $message);
    }
    $admins->free();
}

function sms_notify_admins_rent_payment(
    mysqli $connect,
    int $paymentId,
    int $tenantId,
    string $method,
    float $amount,
    string $reference,
    bool $submittedForReview = false
): void {
    $tenantStmt = $connect->prepare("SELECT full_name FROM tenants WHERE tenant_id = ? LIMIT 1");
    if (!$tenantStmt) {
        error_log('Unable to load tenant for payment SMS: ' . $connect->error);
        return;
    }
    $tenantStmt->bind_param('i', $tenantId);
    if (!$tenantStmt->execute()) {
        error_log('Unable to load tenant for payment SMS: ' . $tenantStmt->error);
        $tenantStmt->close();
        return;
    }
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();
    if (!$tenant) return;

    $admins = $connect->query("
        SELECT user_id, phone FROM users
        WHERE user_type = 'Admin' AND is_active = 1 AND phone IS NOT NULL AND TRIM(phone) <> ''
    ");
    if (!$admins) {
        error_log('Unable to load Admin phone numbers for rent payment SMS: ' . $connect->error);
        return;
    }

    $message = $submittedForReview
        ? "Rent payment submitted for review: {$tenant['full_name']}, PHP " . number_format($amount, 2)
            . " via {$method}. Payment #{$paymentId}."
        : "Rent payment received: {$tenant['full_name']} paid PHP " . number_format($amount, 2)
            . " via {$method}. Payment #{$paymentId}.";
    $eventType = $submittedForReview ? 'rent-payment-submitted' : 'rent-payment-paid';
    $eventKey = $eventType . ':' . $paymentId . ':' . strtolower($method) . ':' . hash('sha256', $reference);
    while ($admin = $admins->fetch_assoc()) {
        sms_send_once($connect, $eventKey, (string)$admin['phone'], $message);
    }
    $admins->free();
}

function sms_notify_booking_accepted(mysqli $connect, int $bookingId): void {
    $stmt = $connect->prepare("
        SELECT b.full_name, b.email, COALESCE(NULLIF(TRIM(u.phone), ''), b.phone) AS phone, r.room_number
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)) AND u.is_active = 1
        WHERE b.booking_id = ? AND b.status IN ('Confirmed', 'Checked In', 'Active')
        LIMIT 1
    ");
    if (!$stmt) {
        error_log('Unable to load accepted booking for SMS: ' . $connect->error);
        return;
    }
    $stmt->bind_param('i', $bookingId);
    if (!$stmt->execute()) {
        error_log('Unable to load accepted booking for SMS: ' . $stmt->error);
        $stmt->close();
        return;
    }
    $booking = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$booking) return;

    $phone = trim((string)($booking['phone'] ?? ''));
    if ($phone === '') {
        error_log("Booking acceptance SMS skipped: no phone number for booking #{$bookingId}");
        return;
    }

    $room = trim((string)($booking['room_number'] ?? ''));
    $message = "Hi {$booking['full_name']}, your booking"
        . ($room !== '' ? " for Room {$room}" : '')
        . " has been accepted. Please review your booking details. — Myle's Boarding House";
    sms_send_once($connect, 'booking-accepted:' . $bookingId, $phone, $message);
}
