<?php

require_once __DIR__ . '/paypal.php';
require_once __DIR__ . '/booking_room_status.php';
require_once __DIR__ . '/booking_payment_records.php';
require_once __DIR__ . '/system_notifications.php';
require_once __DIR__ . '/../Notifications/booking_sms.php';

function paypal_booking_api_request(string $method, string $path, $body = null, array $headers = []): array
{
    try {
        if (isset($GLOBALS['paypal_booking_api_mock']) && is_callable($GLOBALS['paypal_booking_api_mock'])) {
            return ($GLOBALS['paypal_booking_api_mock'])($method, $path, $body, $headers);
        }

        $headers['Authorization'] = 'Bearer ' . pp_token();
        $headers['Content-Type'] = 'application/json';
        return pp_request($method, $path, $body, $headers);
    } catch (Throwable $error) {
        error_log('PayPal booking API request failed: ' . $error->getMessage());
        return ['code'=>0,'data'=>[],'raw'=>''];
    }
}

function paypal_booking_expected_amount(array $booking): float
{
    $monthlyRent = round((float)($booking['monthly_rent'] ?? 0), 2);
    if ((string)($booking['payment_plan'] ?? '') === 'Pay in Full') {
        return round((float)($booking['total_rent'] ?? 0), 2);
    }
    return (string)($booking['payment_plan'] ?? '') === 'Pay One Month Rent'
        ? $monthlyRent
        : round($monthlyRent * 2, 2);
}

function paypal_booking_order_evidence(
    array $order,
    string $orderId,
    int $bookingId,
    float $expectedAmount
): array {
    $units = $order['purchase_units'] ?? [];
    $unit = is_array($units) && count($units) === 1 ? reset($units) : null;
    $orderIdMatches = (string)($order['id'] ?? '') === $orderId;
    $customIdMatches = is_array($unit)
        && (string)($unit['custom_id'] ?? '') === (string)$bookingId;
    $ownershipVerified = $orderIdMatches && $customIdMatches;
    $amount = $unit['amount'] ?? [];
    $amountMatches = is_array($amount)
        && strtoupper((string)($amount['currency_code'] ?? '')) === 'PHP'
        && abs((float)($amount['value'] ?? 0) - $expectedAmount) < 0.01;

    $captures = [];
    foreach (is_array($units) ? $units : [] as $purchaseUnit) {
        foreach (($purchaseUnit['payments']['captures'] ?? []) as $capture) {
            if (is_array($capture)) {
                $captures[] = $capture;
            }
        }
    }

    return [
        'ownership_verified' => $ownershipVerified,
        'order_id_matches' => $orderIdMatches,
        'custom_id_matches' => $customIdMatches,
        'purchase_unit_count' => is_array($units) ? count($units) : 0,
        'amount_matches' => $amountMatches,
        'status' => strtoupper((string)($order['status'] ?? '')),
        'captures' => $captures,
    ];
}

function paypal_booking_capture_evidence(
    array $order,
    array $capture,
    string $orderId,
    int $bookingId,
    float $expectedAmount
): array {
    $orderEvidence = paypal_booking_order_evidence($order, $orderId, $bookingId, $expectedAmount);
    $relatedOrderId = (string)($capture['supplementary_data']['related_ids']['order_id'] ?? '');
    $captureId = trim((string)($capture['id'] ?? ''));
    $captureStatus = strtoupper((string)($capture['status'] ?? ''));
    $captureAmount = $capture['amount'] ?? [];
    $captureAmountMatches = is_array($captureAmount)
        && strtoupper((string)($captureAmount['currency_code'] ?? '')) === 'PHP'
        && abs((float)($captureAmount['value'] ?? 0) - $expectedAmount) < 0.01;
    $associated = $orderEvidence['order_id_matches']
        && $orderEvidence['purchase_unit_count'] === 1
        && $relatedOrderId !== ''
        && hash_equals($orderId, $relatedOrderId)
        && $captureId !== '';

    return [
        'associated' => $associated,
        'completed' => $captureStatus === 'COMPLETED',
        'valid' => $associated
            && $orderEvidence['status'] === 'COMPLETED'
            && $orderEvidence['custom_id_matches']
            && $captureStatus === 'COMPLETED'
            && $orderEvidence['amount_matches']
            && $captureAmountMatches,
        'capture_id' => $captureId,
        'capture_status' => $captureStatus,
        'reason' => !$orderEvidence['order_id_matches']
            ? 'PayPal order ownership could not be verified'
            : (!$orderEvidence['custom_id_matches']
                ? 'PayPal order booking reference does not match; the associated capture must be refunded'
            : ($relatedOrderId === '' || !hash_equals($orderId, $relatedOrderId)
                ? 'PayPal capture does not identify the stored order'
                : (!$captureAmountMatches || !$orderEvidence['amount_matches']
                    ? 'PayPal capture amount or currency does not match the booking'
                    : ($captureStatus !== 'COMPLETED'
                        ? 'PayPal capture is not completed'
                        : 'PayPal order and capture evidence could not be verified')))),
    ];
}

function paypal_booking_load_reconciliation_row(mysqli $connect, int $bookingId, bool $forUpdate = false): ?array
{
    $lock = $forUpdate ? ' FOR UPDATE' : '';
    $stmt = $connect->prepare("
        SELECT b.booking_id, b.room_id, b.status AS booking_status, b.email,
               b.move_in_date, b.check_out_date, b.payment_expires_at,
               b.payment_plan, b.total_rent, b.length_of_stay_months,
               r.monthly_rent, r.room_number,
               q.method, q.status AS request_status, q.amount AS request_amount,
               q.paypal_order_id, q.paypal_capture_id, q.paypal_capture_request_id,
               q.paypal_capture_attempts, q.paypal_refund_id, q.paypal_refund_request_id,
               q.paypal_refund_attempts, q.paypal_retry_at, q.paypal_last_error,
               q.paypal_processing_lease_until
        FROM bookings b
        INNER JOIN rooms r ON r.room_id = b.room_id
        INNER JOIN booking_initial_payment_requests q ON q.booking_id = b.booking_id
        WHERE b.booking_id = ?
        LIMIT 1{$lock}
    ");
    if (!$stmt) {
        error_log('PayPal booking reconciliation lookup prepare failed: ' . $connect->error);
        return null;
    }
    $stmt->bind_param('i', $bookingId);
    if (!$stmt->execute()) {
        error_log('PayPal booking reconciliation lookup failed: ' . $stmt->error);
        $stmt->close();
        return null;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return is_array($row) ? $row : null;
}

function paypal_booking_set_retry(mysqli $connect, int $bookingId, string $message, int $delaySeconds = 120): bool
{
    $stmt = $connect->prepare("
        UPDATE booking_initial_payment_requests
        SET paypal_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
            paypal_processing_lease_until = NULL,
            paypal_last_error = ?, updated_at = NOW()
        WHERE booking_id = ? AND status IN
            ('Capturing','Refund Pending','Refund Processing','Reconciliation Required')
    ");
    if (!$stmt) {
        error_log('PayPal booking retry schedule prepare failed: ' . $connect->error);
        return false;
    }
    $safeMessage = substr($message, 0, 1000);
    $stmt->bind_param('isi', $delaySeconds, $safeMessage, $bookingId);
    $ok = $stmt->execute();
    if (!$ok) {
        error_log('PayPal booking retry schedule failed: ' . $stmt->error);
    }
    $stmt->close();
    return $ok;
}

function paypal_booking_claim_capture_reconciliation(mysqli $connect, int $bookingId, bool $force): bool
{
    if (!$connect->begin_transaction()) {
        return false;
    }
    try {
        $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
        if (!$row || !in_array((string)$row['request_status'], ['Capturing','Reconciliation Required'], true)) {
            $connect->rollback();
            return false;
        }
        if (!$force && $row['paypal_retry_at'] !== null
            && strtotime((string)$row['paypal_retry_at']) > time()) {
            $connect->rollback();
            return false;
        }
        if ($row['paypal_processing_lease_until'] !== null
            && strtotime((string)$row['paypal_processing_lease_until']) > time()) {
            $connect->rollback();
            return false;
        }
        $claim = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET paypal_processing_lease_until = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
                paypal_retry_at = NULL, updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Capturing','Reconciliation Required')
        ");
        if (!$claim) {
            throw new RuntimeException('Unable to claim PayPal capture reconciliation');
        }
        $claim->bind_param('i', $bookingId);
        if (!$claim->execute()) {
            $claim->close();
            throw new RuntimeException('Unable to claim PayPal capture reconciliation');
        }
        $claim->close();
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to save PayPal capture reconciliation lease');
        }
        return true;
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('PayPal capture reconciliation claim failed: ' . $error->getMessage());
        return false;
    }
}

function paypal_booking_mark_reconciliation_required(
    mysqli $connect,
    int $bookingId,
    string $message,
    bool $notify = true
): void {
    $row = paypal_booking_load_reconciliation_row($connect, $bookingId);
    if (!$row) {
        return;
    }
    $wasRequired = (string)$row['request_status'] === 'Reconciliation Required';
    $stmt = $connect->prepare("
        UPDATE booking_initial_payment_requests
        SET status = 'Reconciliation Required',
            paypal_retry_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE),
            paypal_processing_lease_until = NULL,
            paypal_last_error = ?, updated_at = NOW()
        WHERE booking_id = ? AND status NOT IN ('Confirmed','Refunded','Closed')
    ");
    if (!$stmt) {
        error_log('PayPal booking reconciliation state prepare failed: ' . $connect->error);
        return;
    }
    $safeMessage = substr($message, 0, 1000);
    $stmt->bind_param('si', $safeMessage, $bookingId);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok && $notify && !$wasRequired) {
        system_notify_admins(
            $connect,
            'PayPal Booking Needs Reconciliation',
            'Booking #' . $bookingId . ' has an unresolved PayPal capture/refund. ' . $safeMessage,
            'booking_payment'
        );
    }
}

function paypal_booking_begin_capture(
    mysqli $connect,
    int $userId,
    int $bookingId,
    string $orderId
): array {
    if ($bookingId <= 0 || $userId <= 0 || $orderId === '' || !$connect->begin_transaction()) {
        return ['state'=>'error','message'=>'Unable to start PayPal payment processing'];
    }

    try {
        $bookingStmt = $connect->prepare("
            SELECT b.booking_id, b.room_id, b.status, b.email, b.move_in_date, b.check_out_date,
                   b.payment_expires_at, b.length_of_stay_months, b.payment_plan,
                   b.total_rent, r.monthly_rent
            FROM bookings b
            INNER JOIN users u ON u.user_id = ? AND u.is_active = 1
                AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email))
            INNER JOIN rooms r ON r.room_id = b.room_id
            WHERE b.booking_id = ? FOR UPDATE
        ");
        if (!$bookingStmt) {
            throw new RuntimeException('Unable to verify booking ownership');
        }
        $bookingStmt->bind_param('ii', $userId, $bookingId);
        if (!$bookingStmt->execute()) {
            throw new RuntimeException('Unable to verify booking ownership');
        }
        $booking = $bookingStmt->get_result()->fetch_assoc();
        $bookingStmt->close();
        if (!$booking || !in_array((string)$booking['status'], ['Pending','Confirmed'], true)) {
            throw new RuntimeException('Booking is not available for PayPal payment');
        }

        $requestStmt = $connect->prepare("
            SELECT method, status, amount, paypal_order_id, paypal_capture_request_id
            FROM booking_initial_payment_requests
            WHERE booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$requestStmt) {
            throw new RuntimeException('Unable to verify the PayPal checkout request');
        }
        $requestStmt->bind_param('i', $bookingId);
        if (!$requestStmt->execute()) {
            throw new RuntimeException('Unable to verify the PayPal checkout request');
        }
        $request = $requestStmt->get_result()->fetch_assoc();
        $requestStmt->close();
        if (!$request || (string)$request['method'] !== 'PayPal'
            || (string)$request['status'] !== 'Checkout'
            || !hash_equals((string)$request['paypal_order_id'], $orderId)) {
            throw new RuntimeException('PayPal order does not match an available checkout');
        }

        $expectedAmount = paypal_booking_expected_amount($booking);
        if (abs((float)$request['amount'] - $expectedAmount) >= 0.01) {
            throw new RuntimeException('PayPal checkout amount no longer matches the booking');
        }
        if ((string)$booking['status'] === 'Pending') {
            $window = $connect->prepare("
                SELECT payment_expires_at IS NOT NULL AND payment_expires_at > NOW() AS window_open
                FROM bookings WHERE booking_id = ? LIMIT 1
            ");
            if (!$window) {
                throw new RuntimeException('Unable to verify the reservation deadline');
            }
            $window->bind_param('i', $bookingId);
            $window->execute();
            $isOpen = (int)($window->get_result()->fetch_assoc()['window_open'] ?? 0) === 1;
            $window->close();
            if (!$isOpen || !room_has_capacity(
                $connect,
                (int)$booking['room_id'],
                (string)$booking['move_in_date'],
                (string)$booking['check_out_date'],
                $bookingId,
                0,
                (string)$booking['email']
            )) {
                throw new RuntimeException('The reservation expired or room capacity is no longer available');
            }
        } elseif (!room_has_capacity(
            $connect,
            (int)$booking['room_id'],
            (string)$booking['move_in_date'],
            (string)$booking['check_out_date'],
            $bookingId,
            0,
            (string)$booking['email']
        )) {
            throw new RuntimeException('Room capacity is no longer available for this booking');
        }

        $captureRequestId = trim((string)($request['paypal_capture_request_id'] ?? ''));
        if ($captureRequestId === '') {
            $captureRequestId = bin2hex(random_bytes(16));
        }
        $markRequest = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Capturing', paypal_capture_request_id = ?,
                paypal_capture_attempts = 0, paypal_retry_at = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
                paypal_processing_lease_until = NULL, paypal_last_error = NULL, updated_at = NOW()
            WHERE booking_id = ? AND method = 'PayPal' AND status = 'Checkout'
              AND paypal_order_id = ?
        ");
        if (!$markRequest) {
            throw new RuntimeException('Unable to reserve the booking for PayPal capture');
        }
        $markRequest->bind_param('sis', $captureRequestId, $bookingId, $orderId);
        if (!$markRequest->execute() || $markRequest->affected_rows !== 1) {
            $markRequest->close();
            throw new RuntimeException('PayPal checkout changed before capture');
        }
        $markRequest->close();

        if ((string)$booking['status'] === 'Pending') {
            $hold = $connect->prepare("
                UPDATE bookings SET status = 'Pending Verification', updated_at = NOW()
                WHERE booking_id = ? AND status = 'Pending' AND payment_expires_at > NOW()
            ");
            if (!$hold) {
                throw new RuntimeException('Unable to reserve the room while PayPal processes payment');
            }
            $hold->bind_param('i', $bookingId);
            if (!$hold->execute() || $hold->affected_rows !== 1) {
                $hold->close();
                throw new RuntimeException('The reservation expired before PayPal capture could start');
            }
            $hold->close();
        }
        if (!sync_booking_room_status($connect, (int)$booking['room_id'])) {
            throw new RuntimeException('Unable to synchronize the room capture hold');
        }
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to save the PayPal capture hold');
        }
        return [
            'state'=>'started',
            'booking_id'=>$bookingId,
            'order_id'=>$orderId,
            'capture_request_id'=>$captureRequestId,
            'expected_amount'=>$expectedAmount,
            'booking'=>$booking,
        ];
    } catch (Throwable $error) {
        $connect->rollback();
        return ['state'=>'error','message'=>$error->getMessage()];
    }
}

function paypal_booking_note_capture_attempt(mysqli $connect, int $bookingId): ?string
{
    $requestId = null;
    $stmt = $connect->prepare("
        UPDATE booking_initial_payment_requests
        SET paypal_capture_attempts = paypal_capture_attempts + 1,
            paypal_retry_at = DATE_ADD(NOW(), INTERVAL 2 MINUTE), updated_at = NOW()
        WHERE booking_id = ? AND status = 'Capturing'
          AND paypal_capture_request_id IS NOT NULL
    ");
    if (!$stmt) {
        error_log('PayPal capture attempt prepare failed: ' . $connect->error);
        return null;
    }
    $stmt->bind_param('i', $bookingId);
    $ok = $stmt->execute() && $stmt->affected_rows === 1;
    $stmt->close();
    if (!$ok) {
        return null;
    }
    $lookup = $connect->prepare("
        SELECT paypal_capture_request_id FROM booking_initial_payment_requests
        WHERE booking_id = ? AND status = 'Capturing' LIMIT 1
    ");
    if (!$lookup) {
        return null;
    }
    $lookup->bind_param('i', $bookingId);
    $lookup->execute();
    $requestId = $lookup->get_result()->fetch_assoc()['paypal_capture_request_id'] ?? null;
    $lookup->close();
    return is_string($requestId) && $requestId !== '' ? $requestId : null;
}

function paypal_booking_release_uncaptured(mysqli $connect, int $bookingId, string $reason): bool
{
    if (!$connect->begin_transaction()) {
        return false;
    }
    try {
        $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
        if (!$row || !in_array((string)$row['request_status'], ['Capturing','Reconciliation Required'], true)
            || trim((string)$row['paypal_capture_id']) !== '') {
            throw new RuntimeException('PayPal capture outcome is not safe to release');
        }
        $updateRequest = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Checkout', paypal_retry_at = NULL,
                paypal_processing_lease_until = NULL, paypal_last_error = ?, updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Capturing','Reconciliation Required')
              AND paypal_capture_id IS NULL
        ");
        if (!$updateRequest) {
            throw new RuntimeException('Unable to close the unused PayPal checkout');
        }
        $safeReason = substr($reason, 0, 1000);
        $updateRequest->bind_param('si', $safeReason, $bookingId);
        if (!$updateRequest->execute() || $updateRequest->affected_rows !== 1) {
            $updateRequest->close();
            throw new RuntimeException('PayPal checkout changed while it was being closed');
        }
        $updateRequest->close();

        if ((string)$row['booking_status'] === 'Pending Verification') {
            $updateBooking = $connect->prepare("
                UPDATE bookings
                SET status = CASE
                    WHEN payment_expires_at IS NOT NULL AND payment_expires_at <= NOW() THEN 'Expired'
                    ELSE 'Pending'
                END,
                updated_at = NOW()
                WHERE booking_id = ? AND status = 'Pending Verification'
            ");
            if (!$updateBooking) {
                throw new RuntimeException('Unable to release the unused reservation hold');
            }
            $updateBooking->bind_param('i', $bookingId);
            if (!$updateBooking->execute() || $updateBooking->affected_rows !== 1) {
                $updateBooking->close();
                throw new RuntimeException('Booking status changed while releasing the unused hold');
            }
            $updateBooking->close();
        }
        if (!sync_booking_room_status($connect, (int)$row['room_id']) || !$connect->commit()) {
            throw new RuntimeException('Unable to refresh room availability after PayPal checkout');
        }
        return true;
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('PayPal uncaptured booking release failed: ' . $error->getMessage());
        return false;
    }
}

function paypal_booking_schedule_refund(
    mysqli $connect,
    int $bookingId,
    string $captureId,
    string $reason
): bool {
    if (!$connect->begin_transaction()) {
        return false;
    }
    try {
        $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
        if (!$row || !in_array((string)$row['request_status'], ['Capturing','Reconciliation Required'], true)
            || $captureId === '') {
            throw new RuntimeException('PayPal capture is not available for refund reconciliation');
        }
        $refundRequestId = trim((string)($row['paypal_refund_request_id'] ?? ''));
        if ($refundRequestId === '') {
            $refundRequestId = bin2hex(random_bytes(16));
        }
        $stmt = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Refund Pending', paypal_capture_id = ?,
                paypal_refund_request_id = ?, paypal_retry_at = NOW(),
                paypal_processing_lease_until = NULL, paypal_last_error = ?, updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Capturing','Reconciliation Required')
        ");
        if (!$stmt) {
            throw new RuntimeException('Unable to save the PayPal refund obligation');
        }
        $safeReason = substr($reason, 0, 1000);
        $stmt->bind_param('sssi', $captureId, $refundRequestId, $safeReason, $bookingId);
        if (!$stmt->execute() || $stmt->affected_rows !== 1) {
            $stmt->close();
            throw new RuntimeException('PayPal refund state changed during reconciliation');
        }
        $stmt->close();
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to persist the PayPal refund obligation');
        }
        return true;
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('PayPal booking refund scheduling failed: ' . $error->getMessage());
        return false;
    }
}

function paypal_booking_finalize_capture(
    mysqli $connect,
    int $bookingId,
    string $orderId,
    array $capture,
    bool $valid,
    string $reason
): string {
    if (!$connect->begin_transaction()) {
        return 'retry';
    }
    try {
        $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
        if (!$row || !hash_equals((string)$row['paypal_order_id'], $orderId)
            || !in_array((string)$row['request_status'], ['Capturing','Reconciliation Required'], true)) {
            throw new RuntimeException('PayPal capture no longer matches the booking reconciliation record');
        }
        $captureId = trim((string)($capture['id'] ?? ''));
        if ($captureId === '') {
            throw new RuntimeException('PayPal capture ID is missing');
        }
        $valid = $valid
            && in_array((string)$row['booking_status'], ['Pending Verification','Confirmed'], true)
            && (float)$row['request_amount'] > 0;
        if ($valid && (string)$row['booking_status'] === 'Pending Verification'
            && !room_has_capacity(
                $connect,
                (int)$row['room_id'],
                (string)$row['move_in_date'],
                (string)$row['check_out_date'],
                $bookingId,
                0,
                (string)$row['email']
            )) {
            $valid = false;
            $reason = 'The room is no longer available for the captured booking';
        }

        if (!$valid) {
            $refundRequestId = trim((string)($row['paypal_refund_request_id'] ?? ''));
            if ($refundRequestId === '') {
                $refundRequestId = bin2hex(random_bytes(16));
            }
            $update = $connect->prepare("
                UPDATE booking_initial_payment_requests
                SET status = 'Refund Pending', paypal_capture_id = ?,
                    paypal_refund_request_id = ?, paypal_retry_at = NOW(),
                    paypal_processing_lease_until = NULL, paypal_last_error = ?, updated_at = NOW()
                WHERE booking_id = ? AND status IN ('Capturing','Reconciliation Required')
            ");
            if (!$update) {
                throw new RuntimeException('Unable to save the PayPal refund obligation');
            }
            $safeReason = substr($reason, 0, 1000);
            $update->bind_param('sssi', $captureId, $refundRequestId, $safeReason, $bookingId);
            if (!$update->execute() || $update->affected_rows !== 1) {
                $update->close();
                throw new RuntimeException('PayPal booking changed while scheduling its refund');
            }
            $update->close();
            if (!$connect->commit()) {
                throw new RuntimeException('Unable to persist the PayPal refund obligation');
            }
            system_notify_admins(
                $connect,
                'PayPal Booking Refund Started',
                'A completed PayPal capture for booking #' . $bookingId . ' could not be confirmed. A full refund is being retried automatically.',
                'booking_payment'
            );
            return 'refund';
        }

        $expectedAmount = paypal_booking_expected_amount($row);
        if (abs($expectedAmount - (float)$row['request_amount']) >= 0.01) {
            throw new RuntimeException('PayPal request amount no longer matches the booking');
        }
        createConfirmedBookingPayments(
            $connect,
            $row,
            'PayPal',
            $captureId,
            null,
            $captureId,
            $orderId
        );
        $confirmRequest = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Confirmed', paypal_capture_id = ?, paypal_retry_at = NULL,
                paypal_processing_lease_until = NULL, paypal_last_error = NULL, updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Capturing','Reconciliation Required')
              AND paypal_order_id = ?
        ");
        if (!$confirmRequest) {
            throw new RuntimeException('Unable to confirm the PayPal payment request');
        }
        $confirmRequest->bind_param('sis', $captureId, $bookingId, $orderId);
        if (!$confirmRequest->execute() || $confirmRequest->affected_rows !== 1) {
            $confirmRequest->close();
            throw new RuntimeException('PayPal payment request changed before confirmation');
        }
        $confirmRequest->close();
        if ((string)$row['booking_status'] === 'Pending Verification') {
            $bookingUpdate = $connect->prepare("
                UPDATE bookings SET status = 'Confirmed', updated_at = NOW()
                WHERE booking_id = ? AND status = 'Pending Verification'
            ");
            if (!$bookingUpdate) {
                throw new RuntimeException('Unable to confirm the PayPal booking');
            }
            $bookingUpdate->bind_param('i', $bookingId);
            if (!$bookingUpdate->execute() || $bookingUpdate->affected_rows !== 1) {
                $bookingUpdate->close();
                throw new RuntimeException('Booking status changed before PayPal confirmation');
            }
            $bookingUpdate->close();
        }
        if (!sync_booking_room_status($connect, (int)$row['room_id']) || !$connect->commit()) {
            throw new RuntimeException('Unable to commit the PayPal booking payment');
        }
        system_notify_booking_contact(
            $connect,
            (string)$row['email'],
            'Booking Payment Confirmed',
            'Your PayPal initial booking payment for Room ' . (string)($row['room_number'] ?? 'your selected room') . ' has been confirmed.',
            'booking_payment'
        );
        sms_notify_admins_booking_payment($connect, $bookingId, 'PayPal', $expectedAmount, $captureId);
        sms_notify_booking_accepted($connect, $bookingId);
        return 'confirmed';
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('PayPal booking capture finalization failed for booking #' . $bookingId . ': ' . $error->getMessage());
        paypal_booking_set_retry($connect, $bookingId, $error->getMessage());
        return 'retry';
    }
}

function paypal_booking_confirm_refund(mysqli $connect, int $bookingId, string $refundId, string $refundStatus, string $errorText = ''): void
{
    if (strtoupper($refundStatus) === 'COMPLETED') {
        if (!$connect->begin_transaction()) {
            paypal_booking_set_retry($connect, $bookingId, 'PayPal refund completed but local reconciliation could not start');
            return;
        }
        try {
            $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
            if (!$row || !in_array((string)$row['request_status'], ['Refund Processing','Refund Pending'], true)) {
                throw new RuntimeException('PayPal refund state changed during reconciliation');
            }
            $update = $connect->prepare("
                UPDATE booking_initial_payment_requests
                SET status = 'Refunded', paypal_refund_id = ?, paypal_retry_at = NULL,
                    paypal_processing_lease_until = NULL, paypal_last_error = NULL, updated_at = NOW()
                WHERE booking_id = ? AND status IN ('Refund Processing','Refund Pending')
            ");
            if (!$update) {
                throw new RuntimeException('Unable to record the completed PayPal refund');
            }
            $update->bind_param('si', $refundId, $bookingId);
            if (!$update->execute() || $update->affected_rows !== 1) {
                $update->close();
                throw new RuntimeException('PayPal refund state changed before it was recorded');
            }
            $update->close();
            if (in_array((string)$row['booking_status'], ['Pending Verification','Confirmed'], true)) {
                $bookingUpdate = $connect->prepare("
                    UPDATE bookings SET status = 'Rejected', updated_at = NOW()
                    WHERE booking_id = ? AND status IN ('Pending Verification','Confirmed')
                ");
                if (!$bookingUpdate) {
                    throw new RuntimeException('Unable to release the refunded booking hold');
                }
                $bookingUpdate->bind_param('i', $bookingId);
                if (!$bookingUpdate->execute()) {
                    $bookingUpdate->close();
                    throw new RuntimeException('Unable to release the refunded booking hold');
                }
                $bookingUpdate->close();
            }
            if (!sync_booking_room_status($connect, (int)$row['room_id']) || !$connect->commit()) {
                throw new RuntimeException('Unable to commit the PayPal refund reconciliation');
            }
            system_notify_booking_contact(
                $connect,
                (string)$row['email'],
                'PayPal Booking Payment Refunded',
                'The PayPal capture for your booking could not be confirmed, and PayPal has completed the full refund.',
                'booking_payment'
            );
        } catch (Throwable $error) {
            $connect->rollback();
            error_log('PayPal refund persistence failed for booking #' . $bookingId . ': ' . $error->getMessage());
            paypal_booking_set_retry($connect, $bookingId, 'Refund completed at PayPal; local update will be retried');
        }
        return;
    }

    $isFailed = in_array(strtoupper($refundStatus), ['FAILED','CANCELLED'], true);
    $row = paypal_booking_load_reconciliation_row($connect, $bookingId);
    if (!$row) {
        return;
    }
    $attempts = (int)($row['paypal_refund_attempts'] ?? 0);
    $newRequestId = (string)($row['paypal_refund_request_id'] ?? '');
    if ($isFailed) {
        $newRequestId = bin2hex(random_bytes(16));
        $attempts++;
    }
    $delay = min(3600, 60 * (2 ** min($attempts, 6)));
    $message = $errorText !== '' ? $errorText : ('PayPal refund status: ' . ($refundStatus ?: 'unknown'));
    $refundIdForSave = $isFailed
        ? null
        : ($refundId !== '' ? $refundId : (string)($row['paypal_refund_id'] ?? ''));
    $stmt = $connect->prepare("
        UPDATE booking_initial_payment_requests
        SET status = 'Refund Pending', paypal_refund_id = ?,
            paypal_refund_request_id = ?, paypal_refund_attempts = ?,
            paypal_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
            paypal_processing_lease_until = NULL, paypal_last_error = ?, updated_at = NOW()
        WHERE booking_id = ? AND status IN ('Refund Processing','Refund Pending')
    ");
    if (!$stmt) {
        error_log('PayPal refund retry prepare failed: ' . $connect->error);
        return;
    }
    $safeMessage = substr($message, 0, 1000);
    $stmt->bind_param('ssiisi', $refundIdForSave, $newRequestId, $attempts, $delay, $safeMessage, $bookingId);
    if (!$stmt->execute()) {
        error_log('PayPal refund retry update failed: ' . $stmt->error);
    }
    $stmt->close();
    if ($attempts >= 3) {
        system_notify_admins(
            $connect,
            'PayPal Booking Refund Still Pending',
            'PayPal refund reconciliation for booking #' . $bookingId . ' needs attention. ' . $safeMessage,
            'booking_payment'
        );
    }
}

function paypal_booking_process_refund(mysqli $connect, int $bookingId, bool $force = false): string
{
    if (!$connect->begin_transaction()) {
        return 'retry';
    }
    try {
        $row = paypal_booking_load_reconciliation_row($connect, $bookingId, true);
        if (!$row || !in_array((string)$row['request_status'], ['Refund Pending','Refund Processing'], true)) {
            $connect->rollback();
            return 'not_due';
        }
        if (!$force && $row['paypal_retry_at'] !== null
            && strtotime((string)$row['paypal_retry_at']) > time()) {
            $connect->rollback();
            return 'not_due';
        }
        if (!$force && $row['paypal_processing_lease_until'] !== null
            && strtotime((string)$row['paypal_processing_lease_until']) > time()) {
            $connect->rollback();
            return 'leased';
        }
        $lease = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Refund Processing',
                paypal_processing_lease_until = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
                paypal_retry_at = NULL, updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Refund Pending','Refund Processing')
        ");
        if (!$lease) {
            throw new RuntimeException('Unable to claim PayPal refund reconciliation');
        }
        $lease->bind_param('i', $bookingId);
        if (!$lease->execute()) {
            $lease->close();
            throw new RuntimeException('Unable to claim PayPal refund reconciliation');
        }
        $lease->close();
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to save PayPal refund reconciliation lease');
        }
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('PayPal refund reconciliation claim failed: ' . $error->getMessage());
        return 'retry';
    }

    $row = paypal_booking_load_reconciliation_row($connect, $bookingId);
    if (!$row || trim((string)$row['paypal_capture_id']) === '') {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'Refund is pending but the capture ID is missing');
        return 'manual';
    }

    $refundId = trim((string)($row['paypal_refund_id'] ?? ''));
    if ($refundId !== '') {
        $response = paypal_booking_api_request(
            'GET',
            '/v2/payments/refunds/' . rawurlencode($refundId)
        );
        if ($response['code'] >= 200 && $response['code'] < 300) {
            $refundStatus = strtoupper((string)($response['data']['status'] ?? ''));
            paypal_booking_confirm_refund($connect, $bookingId, $refundId, $refundStatus);
            return $refundStatus === 'COMPLETED' ? 'refunded' : 'pending';
        }
    }

    $requestId = trim((string)($row['paypal_refund_request_id'] ?? ''));
    if ($requestId === '') {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'Refund idempotency key is missing');
        return 'manual';
    }
    $response = paypal_booking_api_request(
        'POST',
        '/v2/payments/captures/' . rawurlencode((string)$row['paypal_capture_id']) . '/refund',
        (object)[],
        ['PayPal-Request-Id'=>$requestId]
    );
    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        paypal_booking_confirm_refund(
            $connect,
            $bookingId,
            '',
            '',
            'PayPal refund request outcome is unknown (HTTP ' . (int)$response['code'] . ')'
        );
        return 'pending';
    }
    $refundId = trim((string)($response['data']['id'] ?? ''));
    $refundStatus = strtoupper((string)($response['data']['status'] ?? ''));
    if ($refundId === '') {
        paypal_booking_confirm_refund($connect, $bookingId, '', '', 'PayPal returned no refund reference');
        return 'pending';
    }
    paypal_booking_confirm_refund($connect, $bookingId, $refundId, $refundStatus);
    return $refundStatus === 'COMPLETED' ? 'refunded' : 'pending';
}

function paypal_booking_reconcile_one(mysqli $connect, int $bookingId, bool $force = false): string
{
    $row = paypal_booking_load_reconciliation_row($connect, $bookingId);
    if (!$row || (string)$row['method'] !== 'PayPal') {
        return 'not_found';
    }
    if (in_array((string)$row['request_status'], ['Refund Pending','Refund Processing'], true)) {
        return paypal_booking_process_refund($connect, $bookingId, $force);
    }
    if (!in_array((string)$row['request_status'], ['Capturing','Reconciliation Required'], true)) {
        return 'not_due';
    }
    if (!paypal_booking_claim_capture_reconciliation($connect, $bookingId, $force)) {
        return 'leased';
    }
    $row = paypal_booking_load_reconciliation_row($connect, $bookingId);
    if (!$row) return 'retry';

    $orderId = trim((string)$row['paypal_order_id']);
    if ($orderId === '') {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'Stored PayPal order ID is missing');
        return 'manual';
    }
    $orderResponse = paypal_booking_api_request('GET', '/v2/checkout/orders/' . rawurlencode($orderId));
    if ($orderResponse['code'] < 200 || $orderResponse['code'] >= 300) {
        paypal_booking_set_retry($connect, $bookingId, 'Unable to retrieve PayPal order (HTTP ' . (int)$orderResponse['code'] . ')');
        return 'retry';
    }
    $order = $orderResponse['data'];
    $expectedAmount = paypal_booking_expected_amount($row);
    $orderEvidence = paypal_booking_order_evidence($order, $orderId, $bookingId, $expectedAmount);
    if (!$orderEvidence['order_id_matches'] || $orderEvidence['purchase_unit_count'] !== 1) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order ID or booking ownership could not be verified');
        return 'manual';
    }
    if (count($orderEvidence['captures']) > 1) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order has multiple captures and requires manual reconciliation');
        return 'manual';
    }

    $capture = $orderEvidence['captures'][0] ?? null;
    $orderStatus = $orderEvidence['status'];
    if (is_array($capture) && trim((string)($capture['id'] ?? '')) !== '') {
        $captureId = (string)$capture['id'];
        $captureResponse = paypal_booking_api_request(
            'GET',
            '/v2/payments/captures/' . rawurlencode($captureId)
        );
        if ($captureResponse['code'] < 200 || $captureResponse['code'] >= 300) {
            paypal_booking_set_retry($connect, $bookingId, 'Unable to verify PayPal capture (HTTP ' . (int)$captureResponse['code'] . ')');
            return 'retry';
        }
        $evidence = paypal_booking_capture_evidence(
            $order,
            $captureResponse['data'],
            $orderId,
            $bookingId,
            $expectedAmount
        );
        if (!$evidence['associated']) {
            paypal_booking_mark_reconciliation_required($connect, $bookingId, $evidence['reason']);
            return 'manual';
        }
        if (in_array($evidence['capture_status'], ['DECLINED','FAILED','VOIDED'], true)
            && trim((string)$row['paypal_capture_id']) === '') {
            return paypal_booking_release_uncaptured($connect, $bookingId, 'PayPal capture failed without settling funds')
                ? 'closed'
                : 'retry';
        }
        if (!$evidence['completed']) {
            paypal_booking_set_retry($connect, $bookingId, $evidence['reason']);
            return 'retry';
        }
        $result = paypal_booking_finalize_capture(
            $connect,
            $bookingId,
            $orderId,
            $captureResponse['data'],
            (bool)$evidence['valid'],
            (string)$evidence['reason']
        );
        if ($result === 'refund') {
            return paypal_booking_process_refund($connect, $bookingId, true);
        }
        return $result;
    }

    if (in_array($orderStatus, ['CANCELLED','DENIED','VOIDED','EXPIRED'], true)) {
        if (trim((string)$row['paypal_capture_id']) === '') {
            return paypal_booking_release_uncaptured($connect, $bookingId, 'PayPal order ended without a capture')
                ? 'closed'
                : 'retry';
        }
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order ended but a capture is already recorded');
        return 'manual';
    }

    if ($orderStatus === 'CREATED'
        && (int)($row['paypal_capture_attempts'] ?? 0) === 0
        && trim((string)$row['paypal_capture_id']) === '') {
        return paypal_booking_release_uncaptured($connect, $bookingId, 'PayPal order was not approved and no capture was attempted')
            ? 'closed'
            : 'retry';
    }

    if (!$orderEvidence['amount_matches']) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order amount does not match the booking; capture was not attempted');
        return 'manual';
    }
    if ($orderStatus !== 'APPROVED') {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order is not in an approved or completed state');
        return 'manual';
    }
    if (!$orderEvidence['custom_id_matches']) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal order booking reference does not match; capture was not attempted');
        return 'manual';
    }

    $captureRequestId = trim((string)($row['paypal_capture_request_id'] ?? ''));
    if ($captureRequestId === '') {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal capture idempotency key is missing');
        return 'manual';
    }
    $storedRequestId = paypal_booking_note_capture_attempt($connect, $bookingId);
    if ($storedRequestId === null) {
        paypal_booking_set_retry($connect, $bookingId, 'Unable to persist the PayPal capture attempt');
        return 'retry';
    }
    $captureResponse = paypal_booking_api_request(
        'POST',
        '/v2/checkout/orders/' . rawurlencode($orderId) . '/capture',
        (object)[],
        ['PayPal-Request-Id'=>$storedRequestId]
    );
    if ($captureResponse['code'] < 200 || $captureResponse['code'] >= 300) {
        paypal_booking_set_retry(
            $connect,
            $bookingId,
            'PayPal capture outcome requires reconciliation (HTTP ' . (int)$captureResponse['code'] . ')'
        );
        return 'retry';
    }

    $immediateOrder = $captureResponse['data'];
    $immediateEvidence = paypal_booking_order_evidence(
        $immediateOrder,
        $orderId,
        $bookingId,
        $expectedAmount
    );
    if (!$immediateEvidence['ownership_verified']) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, 'PayPal capture response did not match the stored order');
        return 'manual';
    }
    if (count($immediateEvidence['captures']) !== 1) {
        paypal_booking_set_retry($connect, $bookingId, 'PayPal capture response has no single verifiable capture');
        return 'retry';
    }

    $captured = $immediateEvidence['captures'][0];
    $verifyResponse = paypal_booking_api_request(
        'GET',
        '/v2/payments/captures/' . rawurlencode((string)($captured['id'] ?? ''))
    );
    if ($verifyResponse['code'] < 200 || $verifyResponse['code'] >= 300) {
        paypal_booking_set_retry($connect, $bookingId, 'Unable to verify the PayPal capture response');
        return 'retry';
    }
    $evidence = paypal_booking_capture_evidence(
        $immediateOrder,
        $verifyResponse['data'],
        $orderId,
        $bookingId,
        $expectedAmount
    );
    if (!$evidence['associated']) {
        paypal_booking_mark_reconciliation_required($connect, $bookingId, $evidence['reason']);
        return 'manual';
    }
    if (!$evidence['completed']) {
        paypal_booking_set_retry($connect, $bookingId, $evidence['reason']);
        return 'retry';
    }
    $result = paypal_booking_finalize_capture(
        $connect,
        $bookingId,
        $orderId,
        $verifyResponse['data'],
        (bool)$evidence['valid'],
        (string)$evidence['reason']
    );
    return $result === 'refund'
        ? paypal_booking_process_refund($connect, $bookingId, true)
        : $result;
}

function paypal_booking_run_reconciliation(mysqli $connect, int $limit = 50): array
{
    $limit = max(1, min(500, $limit));
    $stmt = $connect->prepare("
        SELECT booking_id
        FROM booking_initial_payment_requests
        WHERE method = 'PayPal'
          AND status IN ('Capturing','Refund Pending','Refund Processing','Reconciliation Required')
          AND (paypal_retry_at IS NULL OR paypal_retry_at <= NOW())
          AND (paypal_processing_lease_until IS NULL OR paypal_processing_lease_until <= NOW())
        ORDER BY COALESCE(paypal_retry_at, created_at), booking_id
        LIMIT ?
    ");
    if (!$stmt) {
        error_log('PayPal reconciliation queue prepare failed: ' . $connect->error);
        return ['processed'=>0,'confirmed'=>0,'refunded'=>0,'pending'=>0,'errors'=>1];
    }
    $stmt->bind_param('i', $limit);
    if (!$stmt->execute()) {
        error_log('PayPal reconciliation queue query failed: ' . $stmt->error);
        $stmt->close();
        return ['processed'=>0,'confirmed'=>0,'refunded'=>0,'pending'=>0,'errors'=>1];
    }
    $result = $stmt->get_result();
    $bookingIds = [];
    while ($row = $result->fetch_assoc()) {
        $bookingIds[] = (int)$row['booking_id'];
    }
    $stmt->close();

    $summary = ['processed'=>0,'confirmed'=>0,'refunded'=>0,'pending'=>0,'errors'=>0];
    foreach ($bookingIds as $bookingId) {
        $outcome = paypal_booking_reconcile_one($connect, $bookingId);
        $summary['processed']++;
        if ($outcome === 'confirmed') {
            $summary['confirmed']++;
        } elseif ($outcome === 'refunded') {
            $summary['refunded']++;
        } elseif (in_array($outcome, ['retry','manual'], true)) {
            $summary['errors']++;
        } else {
            $summary['pending']++;
        }
    }
    return $summary;
}
