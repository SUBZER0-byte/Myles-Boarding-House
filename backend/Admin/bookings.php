<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/booking_room_status.php';
require_once __DIR__ . '/../Config/booking_payment_records.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';
require_once __DIR__ . '/../Notifications/booking_sms.php';
require_once __DIR__ . '/../Config/system_notifications.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':                  listBookings(); break;
    case 'get':                   getBooking(); break;
    case 'update_status':         updateStatus(); break;
    case 'record_payment':        recordPayment(); break;
    case 'confirm_initial_gcash_payment': confirmInitialGcashPayment(); break;
    case 'reject_initial_gcash_payment': rejectInitialGcashPayment(); break;
    case 'delete':                deleteBooking(); break;
    case 'extension_requests':    listExtensionRequests(); break;
    case 'extension_decision':    decideExtensionRequest(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function bookingDatabase(): mysqli {
    global $connect;
    if (!($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        exit;
    }
    return $connect;
}

function promoteGuestToTenantFromBooking(int $bookingId): void {
    $connect = bookingDatabase();

    $bookingStmt = $connect->prepare("
        SELECT b.booking_id, b.full_name, b.email, b.phone, b.room_id, b.reservation_type, b.occupant_count,
               b.move_in_date, b.check_out_date,
               u.user_id, u.user_type
        FROM bookings b
        LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(b.email))
        WHERE b.booking_id = ?
        LIMIT 1
        FOR UPDATE
    ");
    if (!$bookingStmt) throw new RuntimeException('Unable to prepare tenant account conversion');
    $bookingStmt->bind_param("i", $bookingId);
    if (!$bookingStmt->execute()) {
        $bookingStmt->close();
        throw new RuntimeException('Unable to load booking for tenant account conversion');
    }
    $booking = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();

    if (!$booking) throw new RuntimeException('Booking was not found for tenant account conversion');

    $userId = intval($booking['user_id'] ?? 0);
    if ($userId <= 0) throw new RuntimeException('No guest account is linked to this booking');
    if ((string)$booking['user_type'] === 'Admin') {
        throw new RuntimeException('An administrator account cannot be converted to a tenant');
    }

    $roomId = intval($booking['room_id'] ?? 0);
    $reservationType = (string)($booking['reservation_type'] ?? 'capacity_based');
    $occupantCount = max(1, (int)($booking['occupant_count'] ?? 1));
    $fullName = trim((string)($booking['full_name'] ?? ''));
    $email = trim((string)($booking['email'] ?? ''));
    $phone = trim((string)($booking['phone'] ?? ''));
    $moveInDate = trim((string)($booking['move_in_date'] ?? ''));
    $moveOutDate = trim((string)($booking['check_out_date'] ?? '')) ?: null;

    if ($roomId <= 0 || $fullName === '' || $email === '' || $phone === '' || $moveInDate === '') {
        throw new RuntimeException('Booking details are incomplete for tenant account conversion');
    }

    $tenantStmt = $connect->prepare("
        SELECT tenant_id, room_id, is_active
        FROM tenants
        WHERE user_id = ?
        ORDER BY is_active DESC, tenant_id DESC
        LIMIT 1 FOR UPDATE
    ");
    if (!$tenantStmt) throw new RuntimeException('Unable to check for an existing tenant account');
    $tenantStmt->bind_param('i', $userId);
    if (!$tenantStmt->execute()) {
        $tenantStmt->close();
        throw new RuntimeException('Unable to check for an existing tenant account');
    }
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();

    if ($tenant && (int)$tenant['is_active'] === 1 && (int)$tenant['room_id'] !== $roomId) {
        throw new RuntimeException('This account already has an active tenancy in another room');
    }
    if ($tenant) {
        $tenantId = (int)$tenant['tenant_id'];
        $saveTenant = $connect->prepare("
            UPDATE tenants
            SET room_id = ?, reservation_type = ?, occupant_count = ?, full_name = ?, phone = ?, email = ?,
                move_in_date = ?, move_out_date = ?, is_active = 1
            WHERE tenant_id = ?
        ");
        if (!$saveTenant) throw new RuntimeException('Unable to prepare tenant account conversion');
        $saveTenant->bind_param(
            'isisssssi',
            $roomId,
            $reservationType,
            $occupantCount,
            $fullName,
            $phone,
            $email,
            $moveInDate,
            $moveOutDate,
            $tenantId
        );
        if (!$saveTenant->execute()) {
            $saveTenant->close();
            throw new RuntimeException('Unable to update tenant account');
        }
        $saveTenant->close();
        $tenantId = (int)$tenant['tenant_id'];
    } else {
        $saveTenant = $connect->prepare("
            INSERT INTO tenants
                (user_id, room_id, reservation_type, occupant_count, full_name, phone, email, move_in_date, move_out_date, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
        ");
        if (!$saveTenant) throw new RuntimeException('Unable to prepare tenant account creation');
        $saveTenant->bind_param(
            'iisisssss',
            $userId,
            $roomId,
            $reservationType,
            $occupantCount,
            $fullName,
            $phone,
            $email,
            $moveInDate,
            $moveOutDate
        );
        if (!$saveTenant->execute()) {
            $saveTenant->close();
            throw new RuntimeException('Unable to create tenant account');
        }
        $tenantId = (int)$saveTenant->insert_id;
        $saveTenant->close();
    }

    $promote = $connect->prepare("UPDATE users SET user_type = 'Tenant' WHERE user_id = ? AND user_type <> 'Admin'");
    if (!$promote) throw new RuntimeException('Unable to prepare guest account conversion');
    $promote->bind_param('i', $userId);
    if (!$promote->execute()) {
        $promote->close();
        throw new RuntimeException('Unable to convert guest account to tenant');
    }
    $promote->close();

    $payments = $connect->prepare('UPDATE payments SET tenant_id = ? WHERE booking_id = ? AND tenant_id IS NULL');
    if (!$payments) throw new RuntimeException('Unable to link booking payments to the tenant account');
    $payments->bind_param('ii', $tenantId, $bookingId);
    if (!$payments->execute()) {
        $payments->close();
        throw new RuntimeException('Unable to link booking payments to the tenant account');
    }
    $payments->close();
}

function listBookings() {
    $connect = bookingDatabase();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Booking and room availability could not be refreshed']);
        return;
    }
    $res = $connect->query("
                SELECT b.*, r.room_number, r.room_type, r.monthly_rent,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.booking_id AND (p.payment_type IS NULL OR p.payment_type <> 'Security Deposit') AND p.status IN ('Confirmed','Paid')), 0) AS amount_paid,
                    (SELECT MIN(p.due_date) FROM payments p WHERE p.booking_id = b.booking_id AND p.status IN ('Pending','Submitted','Overdue')) AS next_payment_due,
                    COALESCE(
                        (SELECT initial_request.reference_number FROM booking_initial_payment_requests initial_request
                         WHERE initial_request.booking_id = b.booking_id
                           AND initial_request.status = 'Submitted' AND initial_request.method = 'GCash'
                         ORDER BY initial_request.updated_at DESC LIMIT 1),
                        (SELECT legacy_payment.reference_number FROM payments legacy_payment
                         WHERE legacy_payment.booking_id = b.booking_id
                           AND legacy_payment.payment_type = 'Security Deposit'
                           AND legacy_payment.status = 'Submitted' AND legacy_payment.method = 'GCash'
                         ORDER BY legacy_payment.payment_id DESC LIMIT 1)
                    ) AS gcash_submitted_reference,
                    (SELECT initial_request.screenshot_path FROM booking_initial_payment_requests initial_request
                       WHERE initial_request.booking_id = b.booking_id
                         AND initial_request.status = 'Submitted' AND initial_request.method = 'GCash'
                       ORDER BY initial_request.updated_at DESC LIMIT 1) AS gcash_submitted_screenshot
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        WHERE b.status <> 'Pending'
           OR EXISTS (
                SELECT 1 FROM booking_initial_payment_requests initial_request
                WHERE initial_request.booking_id = b.booking_id
                  AND initial_request.status IN ('Submitted','Confirmed')
           )
           OR EXISTS (
                SELECT 1 FROM payments initial_payment
                WHERE initial_payment.booking_id = b.booking_id
                  AND initial_payment.payment_type = CASE
                      WHEN b.payment_plan = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                      ELSE 'Security Deposit'
                  END
                  AND initial_payment.status IN ('Submitted','Confirmed','Paid')
           )
        ORDER BY b.created_at DESC
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function confirmInitialGcashPayment(): void {
    $connect = bookingDatabase();
    $data = json_decode((string)file_get_contents('php://input'), true);
    $bookingId = (int)($data['booking_id'] ?? 0);
    $reference = trim((string)($data['reference'] ?? ''));
    if ($bookingId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Booking reference is required']);
        return;
    }

    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to start payment review']);
        return;
    }
    try {
        $bookingStmt = $connect->prepare("
            SELECT b.booking_id, b.room_id, b.status, b.email, b.move_in_date, b.check_out_date,
                   b.length_of_stay_months, b.payment_plan, b.total_rent, r.monthly_rent, r.room_number
            FROM bookings b
            LEFT JOIN rooms r ON r.room_id = b.room_id
            WHERE b.booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$bookingStmt) throw new RuntimeException('Unable to load booking');
        $bookingStmt->bind_param('i', $bookingId);
        $bookingStmt->execute();
        $booking = $bookingStmt->get_result()->fetch_assoc();
        $bookingStmt->close();
        if (!$booking || !in_array((string)$booking['status'], ['Pending', 'Pending Verification'], true)) {
            throw new RuntimeException('Booking is not available for payment confirmation');
        }
        if (!room_has_capacity(
            $connect,
            (int)$booking['room_id'],
            (string)$booking['move_in_date'],
            (string)$booking['check_out_date'],
            $bookingId,
            0,
            (string)$booking['email']
        )) {
            throw new RuntimeException('The room was just reserved by another guest');
        }

        $requestStmt = $connect->prepare("
            SELECT method, status, amount, reference_number, screenshot_path
            FROM booking_initial_payment_requests
            WHERE booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$requestStmt) throw new RuntimeException('Unable to load submitted GCash payment');
        $requestStmt->bind_param('i', $bookingId);
        $requestStmt->execute();
        $paymentRequest = $requestStmt->get_result()->fetch_assoc();
        $requestStmt->close();
        if (!$paymentRequest) {
            $legacyStmt = $connect->prepare("
                SELECT payment_type
                FROM payments
                WHERE booking_id = ? AND method = 'GCash'
                  AND reference_number = ? AND status = 'Submitted'
                FOR UPDATE
            ");
            if (!$legacyStmt) throw new RuntimeException('Unable to load submitted GCash payment');
            $legacyStmt->bind_param('is', $bookingId, $reference);
            $legacyStmt->execute();
            $legacyPayments = $legacyStmt->get_result();
            $legacyCount = 0;
            $hasLegacyDeposit = false;
            while ($legacyPayment = $legacyPayments->fetch_assoc()) {
                $legacyCount++;
                $hasLegacyDeposit = $hasLegacyDeposit
                    || (string)$legacyPayment['payment_type'] === 'Security Deposit';
            }
            $legacyStmt->close();
            if ($legacyCount !== 2 || !$hasLegacyDeposit) {
                throw new RuntimeException('The initial GCash payment is no longer awaiting review');
            }

            $adminId = sec_current_user_id();
            $legacyUpdate = $connect->prepare("
                UPDATE payments
                SET status = 'Paid', confirmation_date = NOW(), confirmed_by = ?, paid_at = NOW()
                WHERE booking_id = ? AND method = 'GCash'
                  AND reference_number = ? AND status = 'Submitted'
            ");
            if (!$legacyUpdate) throw new RuntimeException('Unable to confirm GCash payment');
            $legacyUpdate->bind_param('iis', $adminId, $bookingId, $reference);
            if (!$legacyUpdate->execute() || $legacyUpdate->affected_rows !== 2) {
                $legacyUpdate->close();
                throw new RuntimeException('The GCash payment changed while it was being reviewed');
            }
            $legacyUpdate->close();
            $confirmBooking = $connect->prepare("
                UPDATE bookings
                SET status = 'Confirmed', updated_at = NOW()
                WHERE booking_id = ? AND status IN ('Pending','Pending Verification')
            ");
            if (!$confirmBooking) throw new RuntimeException('Unable to confirm the booking');
            $confirmBooking->bind_param('i', $bookingId);
            if (!$confirmBooking->execute() || $confirmBooking->affected_rows !== 1) {
                $confirmBooking->close();
                throw new RuntimeException('Booking status changed while payment was being verified');
            }
            $confirmBooking->close();
            promoteGuestToTenantFromBooking($bookingId);
            if (!sync_booking_room_status($connect, (int)$booking['room_id'])) {
                throw new RuntimeException('Unable to accept the paid booking');
            }
            if (!$connect->commit()) throw new RuntimeException('Unable to save the GCash payment confirmation');

            sms_notify_booking_accepted($connect, $bookingId);
            system_notify_booking_contact(
                $connect,
                (string)$booking['email'],
                'Booking Payment Verified',
                "Your payment has been verified successfully! Your booking is now confirmed. Thank you for choosing Myle's Boarding House.",
                'booking_payment'
            );
            rt_publish('/Admin/bookings.php');
            rt_publish('/Admin/payments.php');
            rt_publish('/Admin/tenants.php');
            rt_publish('/Tenant/payments.php');
            rt_publish('/Tenant/tenantdashboard.php');
            rt_publish('/Tenant/room.php');
            rt_publish('/Admin/rooms.php');
            rt_publish('/Landing-Page/rooms.php');
            echo json_encode(['type'=>'success','message'=>'GCash booking payment confirmed']);
            return;
        }
        $expectedAmount = (string)$booking['payment_plan'] === 'Pay in Full'
            ? (float)$booking['total_rent']
            : ((string)$booking['payment_plan'] === 'Pay One Month Rent'
                ? (float)$booking['monthly_rent']
                : (float)$booking['monthly_rent'] * 2);
        if (!$paymentRequest
            || (string)$paymentRequest['method'] !== 'GCash'
            || (string)$paymentRequest['status'] !== 'Submitted'
            || ($reference !== '' && !hash_equals((string)$paymentRequest['reference_number'], $reference))
            || ($reference === '' && trim((string)$paymentRequest['screenshot_path']) === '')
            || abs((float)$paymentRequest['amount'] - $expectedAmount) >= 0.01) {
            throw new RuntimeException('The initial GCash payment is no longer awaiting review');
        }
        $reference = (string)($paymentRequest['reference_number'] ?? '');

        $adminId = sec_current_user_id();
        createConfirmedBookingPayments($connect, $booking, 'GCash', $reference, $adminId);
        $update = $connect->prepare("
            UPDATE booking_initial_payment_requests
            SET status = 'Confirmed', updated_at = NOW()
            WHERE booking_id = ? AND method = 'GCash' AND status = 'Submitted'
              AND COALESCE(reference_number, '') = ?
        ");
        if (!$update) throw new RuntimeException('Unable to confirm GCash payment');
        $update->bind_param('is', $bookingId, $reference);
        if (!$update->execute() || $update->affected_rows !== 1) {
            $update->close();
            throw new RuntimeException('The GCash payment changed while it was being reviewed');
        }
        $update->close();
        $confirmBooking = $connect->prepare("
            UPDATE bookings
            SET status = 'Confirmed', updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Pending','Pending Verification')
        ");
        if (!$confirmBooking) throw new RuntimeException('Unable to confirm the booking');
        $confirmBooking->bind_param('i', $bookingId);
        if (!$confirmBooking->execute() || $confirmBooking->affected_rows !== 1) {
            $confirmBooking->close();
            throw new RuntimeException('Booking status changed while payment was being verified');
        }
        $confirmBooking->close();
        promoteGuestToTenantFromBooking($bookingId);
        if (!sync_booking_room_status($connect, (int)$booking['room_id'])) {
            throw new RuntimeException('Unable to accept the paid booking');
        }
        if (!$connect->commit()) throw new RuntimeException('Unable to save the GCash payment confirmation');

        sms_notify_booking_accepted($connect, $bookingId);
        system_notify_booking_contact(
            $connect,
            (string)$booking['email'],
            'Booking Payment Verified',
            "Your payment has been verified successfully! Your booking is now confirmed. Thank you for choosing Myle's Boarding House.",
            'booking_payment'
        );
        rt_publish('/Admin/bookings.php');
        rt_publish('/Admin/payments.php');
        rt_publish('/Admin/tenants.php');
        rt_publish('/Tenant/payments.php');
        rt_publish('/Tenant/tenantdashboard.php');
        rt_publish('/Tenant/room.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
        echo json_encode(['type'=>'success','message'=>'GCash booking payment confirmed']);
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Initial GCash booking payment confirmation failed: ' . $error->getMessage());
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
    }
}

function rejectInitialGcashPayment(): void {
    $connect = bookingDatabase();
    $data = json_decode((string)file_get_contents('php://input'), true);
    $bookingId = (int)($data['booking_id'] ?? 0);
    if ($bookingId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Booking reference is required']);
        return;
    }

    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to start payment review']);
        return;
    }
    try {
        $bookingStmt = $connect->prepare("
            SELECT b.booking_id, b.status, b.email, b.payment_plan, b.room_id,
                   r.room_number
            FROM bookings b
            LEFT JOIN rooms r ON r.room_id = b.room_id
            WHERE b.booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$bookingStmt) throw new RuntimeException('Unable to load booking');
        $bookingStmt->bind_param('i', $bookingId);
        if (!$bookingStmt->execute()) throw new RuntimeException('Unable to load booking');
        $booking = $bookingStmt->get_result()->fetch_assoc();
        $bookingStmt->close();
        if (!$booking || !in_array((string)$booking['status'], ['Pending', 'Pending Verification'], true)) {
            throw new RuntimeException('Booking is not awaiting payment verification');
        }

        $requestStmt = $connect->prepare("
            SELECT method, status
            FROM booking_initial_payment_requests
            WHERE booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$requestStmt) throw new RuntimeException('Unable to load submitted GCash payment');
        $requestStmt->bind_param('i', $bookingId);
        if (!$requestStmt->execute()) throw new RuntimeException('Unable to load submitted GCash payment');
        $request = $requestStmt->get_result()->fetch_assoc();
        $requestStmt->close();

        if ($request) {
            if ((string)$request['method'] !== 'GCash' || (string)$request['status'] !== 'Submitted') {
                throw new RuntimeException('The initial GCash payment is no longer awaiting review');
            }
            $rejectRequest = $connect->prepare("
                UPDATE booking_initial_payment_requests
                SET status = 'Rejected', updated_at = NOW()
                WHERE booking_id = ? AND method = 'GCash' AND status = 'Submitted'
            ");
            if (!$rejectRequest) throw new RuntimeException('Unable to reject the GCash payment');
            $rejectRequest->bind_param('i', $bookingId);
            if (!$rejectRequest->execute() || $rejectRequest->affected_rows !== 1) {
                $rejectRequest->close();
                throw new RuntimeException('The GCash payment changed while it was being reviewed');
            }
            $rejectRequest->close();
        } else {
            $paymentType = (string)$booking['payment_plan'] === 'Pay One Month Rent'
                ? 'Pay One Month Rent'
                : 'Security Deposit';
            $rejectPayments = $connect->prepare("
                UPDATE payments
                SET status = 'Rejected'
                WHERE booking_id = ? AND payment_type IN ('Security Deposit', ?)
                  AND method = 'GCash' AND status = 'Submitted'
            ");
            if (!$rejectPayments) throw new RuntimeException('Unable to reject the GCash payment');
            $rejectPayments->bind_param('is', $bookingId, $paymentType);
            if (!$rejectPayments->execute() || $rejectPayments->affected_rows < 1) {
                $rejectPayments->close();
                throw new RuntimeException('The initial GCash payment is no longer awaiting review');
            }
            $rejectPayments->close();
        }

        $rejectBooking = $connect->prepare("
            UPDATE bookings
            SET status = 'Rejected', updated_at = NOW()
            WHERE booking_id = ? AND status IN ('Pending','Pending Verification')
        ");
        if (!$rejectBooking) throw new RuntimeException('Unable to reject the booking');
        $rejectBooking->bind_param('i', $bookingId);
        if (!$rejectBooking->execute() || $rejectBooking->affected_rows !== 1) {
            $rejectBooking->close();
            throw new RuntimeException('Booking status changed while payment was being reviewed');
        }
        $rejectBooking->close();
        if (!sync_booking_room_status($connect, (int)$booking['room_id'])) {
            throw new RuntimeException('Unable to refresh room availability');
        }
        if (!$connect->commit()) throw new RuntimeException('Unable to save the payment rejection');

        $message = 'Your payment was rejected. Please contact the administrator or follow the existing payment instructions.';
        system_notify_booking_contact($connect, (string)$booking['email'], 'Booking Payment Rejected', $message, 'booking_payment');
        rt_publish('/Admin/bookings.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
        echo json_encode(['type'=>'success','message'=>'GCash payment rejected and room availability updated']);
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Initial GCash booking payment rejection failed: ' . $error->getMessage());
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
    }
}

function getBooking() {
    $connect = bookingDatabase();
    $id = intval($_GET['booking_id'] ?? 0);
    $stmt = $connect->prepare("
                SELECT b.*, r.room_number, r.room_type, r.monthly_rent,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.booking_id AND (p.payment_type IS NULL OR p.payment_type <> 'Security Deposit') AND p.status IN ('Confirmed','Paid')), 0) AS amount_paid
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        WHERE b.booking_id = ?
    ");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function bookingsHasColumn(string $column): bool {
    $connect = bookingDatabase();
    $safe = str_replace("'", "\\'", $column);
    $res = $connect->query("SHOW COLUMNS FROM bookings LIKE '" . $safe . "'");
    if (!$res) return false;
    return $res->num_rows > 0;
}

function requireBookingAdmin(): bool {
    if (sec_current_user_id() <= 0 || sec_current_user_type() !== 'Admin') {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Admin access required']);
        return false;
    }
    return true;
}

function listExtensionRequests(): void {
    if (!requireBookingAdmin()) return;
    $connect = bookingDatabase();
    $result = $connect->query("
        SELECT scr.request_id, scr.booking_id, scr.original_check_out_date,
               scr.requested_check_out_date, scr.status, scr.created_at,
               b.full_name, b.email, b.room_id, r.room_number,
               COALESCE(NULLIF(b.total_rent / NULLIF(b.length_of_stay_months, 0), 0), r.monthly_rent) AS monthly_rent
        FROM stay_change_requests scr
        INNER JOIN bookings b ON b.booking_id = scr.booking_id
        LEFT JOIN rooms r ON r.room_id = b.room_id
        WHERE scr.request_type = 'Extension'
        ORDER BY FIELD(scr.status, 'Pending', 'Approved', 'Rejected'), scr.created_at DESC
    ");
    if (!$result) {
        error_log('Extension requests query failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Could not load extension requests']);
        return;
    }
    $rows = [];
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function extensionBookingMonths(DateTimeImmutable $start, DateTimeImmutable $end): int {
    $months = ((int)$end->format('Y') - (int)$start->format('Y')) * 12
        + (int)$end->format('n') - (int)$start->format('n');
    if ((int)$end->format('j') > (int)$start->format('j')) $months++;
    return max(1, $months);
}

function extensionInstallmentDate(DateTimeImmutable $start, int $offset): DateTimeImmutable {
    $date = $start->modify('first day of this month')->modify("+{$offset} month");
    $day = min((int)$start->format('d'), (int)$date->format('t'));
    return $date->setDate((int)$date->format('Y'), (int)$date->format('n'), $day);
}

function decideExtensionRequest(): void {
    if (!requireBookingAdmin()) return;
    $connect = bookingDatabase();
    $data = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($data['request_id'] ?? 0);
    $decision = trim((string)($data['decision'] ?? ''));
    if ($requestId <= 0 || !in_array($decision, ['Approved', 'Rejected'], true)) {
        echo json_encode(['type'=>'error','message'=>'Invalid extension request decision']);
        return;
    }

    $connect->begin_transaction();
    $applicableCharge = 0.0;
    try {
        $requestStmt = $connect->prepare("
            SELECT scr.request_id, scr.booking_id, scr.original_check_out_date,
                   scr.requested_check_out_date, scr.status AS request_status,
                   b.room_id, b.move_in_date, b.check_out_date, b.payment_plan, b.total_rent,
                   b.status AS booking_status,
                   COALESCE(NULLIF(b.total_rent / NULLIF(b.length_of_stay_months, 0), 0), r.monthly_rent) AS monthly_rent,
                   (SELECT tenant_id FROM tenants
                    WHERE LOWER(TRIM(email)) = LOWER(TRIM(b.email))
                      AND room_id = b.room_id AND is_active = 1
                    ORDER BY tenant_id DESC LIMIT 1) AS tenant_id
            FROM stay_change_requests scr
            INNER JOIN bookings b ON b.booking_id = scr.booking_id
            LEFT JOIN rooms r ON r.room_id = b.room_id
            WHERE scr.request_id = ? AND scr.request_type = 'Extension'
            LIMIT 1 FOR UPDATE
        ");
        if (!$requestStmt) throw new RuntimeException('Could not load extension request');
        $requestStmt->bind_param('i', $requestId);
        $requestStmt->execute();
        $request = $requestStmt->get_result()->fetch_assoc();
        $requestStmt->close();
        if (!$request || $request['request_status'] !== 'Pending') {
            throw new RuntimeException('This extension request is no longer pending');
        }

        $bookingId = (int)$request['booking_id'];
        if ($decision === 'Approved') {
            if (!in_array($request['booking_status'], ['Confirmed', 'Checked In', 'Active'], true)) {
                throw new RuntimeException('Only an active booking can be extended');
            }
            $oldCheckout = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$request['original_check_out_date']);
            $newCheckout = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$request['requested_check_out_date']);
            $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$request['move_in_date']);
            $monthlyRent = round((float)$request['monthly_rent'], 2);
            if (!$oldCheckout || !$newCheckout || !$checkIn || $newCheckout <= $oldCheckout || $monthlyRent <= 0) {
                throw new RuntimeException('The booking or extension dates are invalid');
            }
            if ((string)$request['check_out_date'] !== (string)$request['original_check_out_date']) {
                throw new RuntimeException('The booking checkout date changed after this request was submitted');
            }

            $roomId = (int)$request['room_id'];
            $newCheckoutText = $newCheckout->format('Y-m-d');
            $oldCheckoutText = $oldCheckout->format('Y-m-d');
            $conflict = $connect->prepare("
                SELECT booking_id FROM bookings
                WHERE room_id = ? AND booking_id <> ?
                  AND status IN ('Pending','Confirmed','Checked In','Active')
                  AND move_in_date < ? AND check_out_date > ?
                LIMIT 1
            ");
            if (!$conflict) throw new RuntimeException('Could not check room availability');
            $conflict->bind_param('iiss', $roomId, $bookingId, $newCheckoutText, $oldCheckoutText);
            $conflict->execute();
            $overlap = $conflict->get_result()->fetch_assoc();
            $conflict->close();
            if ($overlap) throw new RuntimeException('The room is already booked during the requested extension');

            $oldMonths = extensionBookingMonths($checkIn, $oldCheckout);
            $newMonths = extensionBookingMonths($checkIn, $newCheckout);
            $addedMonths = max(0, $newMonths - $oldMonths);
            if ($addedMonths <= 0) throw new RuntimeException('The requested date does not add any billable rent period');
            $applicableCharge = round($monthlyRent * $addedMonths, 2);
            $newTotalRent = round((float)$request['total_rent'] + $applicableCharge, 2);

            $updateBooking = $connect->prepare("
                UPDATE bookings SET check_out_date = ?, length_of_stay_months = ?,
                    total_rent = ?, updated_at = NOW()
                WHERE booking_id = ?
            ");
            if (!$updateBooking) throw new RuntimeException('Could not update the booking');
            $updateBooking->bind_param('sddi', $newCheckoutText, $newMonths, $newTotalRent, $bookingId);
            if (!$updateBooking->execute()) throw new RuntimeException('Could not update the booking');
            $updateBooking->close();

            $tenantId = (int)($request['tenant_id'] ?? 0);
            if ($tenantId <= 0) throw new RuntimeException('No active tenant record was found for this booking');
            $updateTenant = $connect->prepare("
                UPDATE tenants SET move_out_date = ? WHERE tenant_id = ? AND is_active = 1
            ");
            if (!$updateTenant) throw new RuntimeException('Could not update the tenant move-out date');
            $updateTenant->bind_param('si', $newCheckoutText, $tenantId);
            if (!$updateTenant->execute()) {
                throw new RuntimeException('Could not update the tenant move-out date');
            }
            $updateTenant->close();

            $paymentPlan = (string)$request['payment_plan'];
            if ($paymentPlan === 'Pay in Full') {
                $description = 'Extended stay rent';
                $paymentType = 'Extension';
                $insert = $connect->prepare("
                    INSERT INTO payments
                        (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
                    VALUES (?, NULLIF(?, 0), ?, ?, 'Pending', ?, ?, NOW())
                ");
                if (!$insert) throw new RuntimeException('Could not add the extension rent payment');
                $extraRent = $applicableCharge;
                $insert->bind_param('iidsss', $bookingId, $tenantId, $extraRent, $oldCheckoutText, $description, $paymentType);
                if (!$insert->execute()) throw new RuntimeException('Could not add the extension rent payment');
                $insert->close();
            } else {
                $descriptionPrefix = 'Monthly rent installment ';
                for ($index = $oldMonths; $index < $newMonths; $index++) {
                    $dueDate = extensionInstallmentDate($checkIn, $index);
                    if ($dueDate >= $newCheckout) break;
                    $dueText = $dueDate->format('Y-m-d');
                    $exists = $connect->prepare("SELECT payment_id FROM payments WHERE booking_id = ? AND due_date = ? LIMIT 1");
                    if (!$exists) throw new RuntimeException('Could not check existing rent installments');
                    $exists->bind_param('is', $bookingId, $dueText);
                    $exists->execute();
                    $existingPayment = $exists->get_result()->fetch_assoc();
                    $exists->close();
                    if ($existingPayment) continue;

                    $description = $descriptionPrefix . ($index + 1);
                    $paymentType = $paymentPlan;
                    $insert = $connect->prepare("
                        INSERT INTO payments
                            (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
                        VALUES (?, NULLIF(?, 0), ?, ?, 'Pending', ?, ?, NOW())
                    ");
                    if (!$insert) throw new RuntimeException('Could not add an extension rent installment');
                    $insert->bind_param('iidsss', $bookingId, $tenantId, $monthlyRent, $dueText, $description, $paymentType);
                    if (!$insert->execute()) throw new RuntimeException('Could not add an extension rent installment');
                    $insert->close();
                }
            }
        }

        $adminId = sec_current_user_id();
        $updateRequest = $connect->prepare("
            UPDATE stay_change_requests
            SET status = ?, applicable_charge = ?, acted_by = ?, acted_at = NOW()
            WHERE request_id = ? AND status = 'Pending'
        ");
        if (!$updateRequest) throw new RuntimeException('Could not save the extension decision');
        $updateRequest->bind_param('sdii', $decision, $applicableCharge, $adminId, $requestId);
        if (!$updateRequest->execute() || $updateRequest->affected_rows !== 1) {
            throw new RuntimeException('Could not save the extension decision');
        }
        $updateRequest->close();
        $connect->commit();

        rt_publish('/Tenant/room.php');
        rt_publish('/Tenant/payments.php');
        rt_publish('/Admin/bookings.php');
        echo json_encode(['type'=>'success','message'=>$decision === 'Approved' ? 'Extension approved and rent schedule updated' : 'Extension request rejected']);
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Stay extension decision failed: ' . $error->getMessage());
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
    }
}

function updateStatus() {
    $connect = bookingDatabase();
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['booking_id'] ?? 0);
    $status = trim((string)($d['status'] ?? ''));
    
    if (!in_array($status, ['Pending', 'Confirmed', 'Checked In', 'Active', 'Checked Out', 'Cancelled'], true)) {
        echo json_encode(['type'=>'error','message'=>'Invalid status']);
        return;
    }

    $previousStatusStmt = $connect->prepare("
        SELECT b.status, b.email, b.payment_plan, b.room_id, b.move_in_date, b.check_out_date, r.room_number
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        WHERE b.booking_id = ? LIMIT 1
    ");
    if (!$previousStatusStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load booking status']);
        return;
    }
    $previousStatusStmt->bind_param('i', $id);
    if (!$previousStatusStmt->execute()) {
        $previousStatusStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load booking status']);
        return;
    }
    $booking = $previousStatusStmt->get_result()->fetch_assoc();
    $previousStatusStmt->close();
    if (!$booking) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Booking not found']);
        return;
    }
    $previousStatus = (string)$booking['status'];

    $paypalStateStmt = $connect->prepare("
        SELECT method, status FROM booking_initial_payment_requests
        WHERE booking_id = ? LIMIT 1
    ");
    if (!$paypalStateStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify PayPal payment reconciliation']);
        return;
    }
    $paypalStateStmt->bind_param('i', $id);
    if (!$paypalStateStmt->execute()) {
        $paypalStateStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify PayPal payment reconciliation']);
        return;
    }
    $paypalState = $paypalStateStmt->get_result()->fetch_assoc();
    $paypalStateStmt->close();
    if ($paypalState
        && (string)$paypalState['method'] === 'PayPal'
        && in_array((string)$paypalState['status'], [
            'Capturing',
            'Refund Pending',
            'Refund Processing',
            'Reconciliation Required',
        ], true)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal capture/refund reconciliation must finish before changing booking status']);
        return;
    }

    if (in_array($status, ['Confirmed', 'Checked In', 'Active', 'Checked Out'], true)) {
        $paidStmt = $connect->prepare("
            SELECT 1 FROM payments
            WHERE booking_id = ? AND payment_type = ?
              AND status IN ('Confirmed','Paid')
            LIMIT 1
        ");
        if (!$paidStmt) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to verify the initial booking payment']);
            return;
        }
        $initialPaymentType = (string)$booking['payment_plan'] === 'Pay One Month Rent'
            ? 'Pay One Month Rent'
            : 'Security Deposit';
        $paidStmt->bind_param('is', $id, $initialPaymentType);
        $paidStmt->execute();
        $hasPaidInitial = (bool)$paidStmt->get_result()->fetch_assoc();
        $paidStmt->close();
        if (!$hasPaidInitial) {
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'Confirm the initial booking payment before accepting this booking']);
            return;
        }
    }

    $takesNewBed = in_array($status, ['Confirmed', 'Checked In', 'Active'], true)
        && in_array($previousStatus, ['Pending', 'Pending Verification', 'Cancelled', 'Checked Out'], true);
    if ($takesNewBed) {
        if (!$connect->begin_transaction()) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to reserve room capacity']);
            return;
        }
        if (!room_has_capacity(
            $connect,
            (int)$booking['room_id'],
            (string)$booking['move_in_date'],
            (string)$booking['check_out_date'],
            $id,
            0,
            (string)$booking['email']
        )) {
            $connect->rollback();
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'This room is full or already reserved for those dates.']);
            return;
        }
    }

    if (bookingsHasColumn('refund_status')) {
        $stmt = $connect->prepare("
            UPDATE bookings
            SET status = ?,
                refund_status = CASE WHEN ? = 'Cancelled' THEN 'Pending' ELSE refund_status END,
                updated_at = NOW()
            WHERE booking_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM booking_initial_payment_requests request
                  WHERE request.booking_id = bookings.booking_id
                    AND request.method = 'PayPal'
                    AND request.status IN
                        ('Capturing','Refund Pending','Refund Processing','Reconciliation Required')
              )
        ");
        if (!$stmt) {
            if ($takesNewBed) $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update booking status']);
            return;
        }
        $stmt->bind_param("ssi", $status, $status, $id);
    } else {
        $stmt = $connect->prepare("
            UPDATE bookings SET status = ?, updated_at = NOW()
            WHERE booking_id = ?
              AND NOT EXISTS (
                  SELECT 1 FROM booking_initial_payment_requests request
                  WHERE request.booking_id = bookings.booking_id
                    AND request.method = 'PayPal'
                    AND request.status IN
                        ('Capturing','Refund Pending','Refund Processing','Reconciliation Required')
              )
        ");
        if (!$stmt) {
            if ($takesNewBed) $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update booking status']);
            return;
        }
        $stmt->bind_param("si", $status, $id);
    }
    $ok = $stmt->execute() && $stmt->affected_rows === 1;
    if ($takesNewBed) {
        if ($ok) {
            try {
                if (in_array($status, ['Confirmed', 'Checked In', 'Active'], true)) {
                    promoteGuestToTenantFromBooking($id);
                }
                $ok = sync_booking_room_status($connect, (int)$booking['room_id']);
            } catch (Throwable $error) {
                error_log('Booking tenant conversion failed: ' . $error->getMessage());
                $ok = false;
            }
            if ($ok) {
                $ok = $connect->commit();
                if (!$ok) $connect->rollback();
            } else {
                $connect->rollback();
            }
        } else {
            $connect->rollback();
        }
    }
    $stmt->close();

    if ($ok && $status === 'Checked In') {
        $connect->query("UPDATE bookings SET checked_in_at = COALESCE(checked_in_at, NOW()) WHERE booking_id = {$id}");
    }
    if ($ok && $status === 'Checked Out') {
        $connect->query("UPDATE bookings SET checked_out_at = COALESCE(checked_out_at, NOW()) WHERE booking_id = {$id}");
    }
    if ($ok) {
        $roomStmt = $connect->prepare("SELECT room_id FROM bookings WHERE booking_id = ? LIMIT 1");
        if (!$roomStmt) {
            error_log('Booking room lookup prepare failed: ' . $connect->error);
            $ok = false;
        } else {
            $roomStmt->bind_param('i', $id);
            $roomStmt->execute();
            $roomId = (int)($roomStmt->get_result()->fetch_assoc()['room_id'] ?? 0);
            $roomStmt->close();
            if ($roomId > 0) $ok = sync_booking_room_status($connect, $roomId);
        }
    }

    if ($ok) {
        rt_publish('/Admin/bookings.php');
        rt_publish('/Landing-Page/booking.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Admin/tenants.php');
        rt_publish('/Tenant/tenantdashboard.php');
        rt_publish('/Tenant/room.php');
        rt_publish('/Admin/notifications.php');
        rt_publish('/Landing-Page/rooms.php');
    }

    if ($ok && $status === 'Confirmed' && $previousStatus !== 'Confirmed') {
        sms_notify_booking_accepted($connect, $id);
    }
    if ($ok && $status !== $previousStatus) {
        $roomNumber = (string)($booking['room_number'] ?? 'your selected room');
        system_notify_booking_contact(
            $connect,
            (string)$booking['email'],
            'Booking Status Update',
            "Your booking for Room {$roomNumber} is now {$status}.",
            'booking'
        );
    }

    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function recordPayment() {
    $connect = bookingDatabase();
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['booking_id'] ?? 0);
    $amount = floatval($d['amount'] ?? 0);
    $method = trim((string)($d['method'] ?? 'Manual'));
    $ref = trim((string)($d['reference'] ?? ''));
    
    if ($amount <= 0) {
        echo json_encode(['type'=>'error','message'=>'Invalid amount']);
        return;
    }
    if ($method === 'GCash' && $ref !== ''
        && (!ensure_full_payment_requests_table($connect)
            || !ensure_gcash_transaction_references_table($connect))) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to validate the GCash transaction number']);
        return;
    }
    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record booking payment']);
        return;
    }
    try {
        if ($method === 'GCash' && $ref !== '') {
            $reserved = reserve_gcash_transaction_reference($connect, $ref);
            if ($reserved !== true) {
                throw new RuntimeException($reserved === false
                    ? 'This GCash reference has already been submitted'
                    : 'Unable to validate the GCash transaction number');
            }
        }
        $stmt = $connect->prepare("
            INSERT INTO payments (booking_id, tenant_id, amount, due_date, status, description, payment_type,
                method, reference_number, submitted_at, confirmation_date, confirmed_by, paid_at, created_at)
            SELECT ?, t.tenant_id, ?, COALESCE((SELECT MIN(p.due_date) FROM payments p WHERE p.booking_id = b.booking_id AND p.status IN ('Pending','Submitted','Overdue')), CURDATE()),
                'Confirmed', 'Admin-recorded booking payment', 'Manual', ?, ?, NOW(), NOW(), 1, NOW(), NOW()
            FROM bookings b LEFT JOIN tenants t ON t.email = b.email AND t.is_active = 1
            WHERE b.booking_id = ?
        ");
        if (!$stmt) throw new RuntimeException('Unable to prepare booking payment');
        $stmt->bind_param("idssi", $id, $amount, $method, $ref, $id);
        if (!$stmt->execute() || $stmt->affected_rows !== 1) {
            $stmt->close();
            throw new RuntimeException('Unable to record booking payment');
        }
        $stmt->close();
        promoteGuestToTenantFromBooking($id);
        $roomStmt = $connect->prepare('SELECT room_id FROM bookings WHERE booking_id = ? LIMIT 1');
        if (!$roomStmt) throw new RuntimeException('Unable to refresh booking room status');
        $roomStmt->bind_param('i', $id);
        if (!$roomStmt->execute()) {
            $roomStmt->close();
            throw new RuntimeException('Unable to refresh booking room status');
        }
        $roomId = (int)($roomStmt->get_result()->fetch_assoc()['room_id'] ?? 0);
        $roomStmt->close();
        if ($roomId <= 0 || !sync_booking_room_status($connect, $roomId)) {
            throw new RuntimeException('Unable to refresh booking room status');
        }
        if (!$connect->commit()) throw new RuntimeException('Unable to save booking payment');
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Admin booking payment recording failed: ' . $error->getMessage());
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
        return;
    }

    rt_publish('/Admin/bookings.php');
    rt_publish('/Admin/tenants.php');
    rt_publish('/Admin/rooms.php');
    rt_publish('/Tenant/tenantdashboard.php');
    rt_publish('/Tenant/room.php');
    rt_publish('/Landing-Page/booking.php');
    rt_publish('/Landing-Page/rooms.php');
    echo json_encode(['type'=>'success','message'=>'Payment recorded']);
}

function deleteBooking() {
    $connect = bookingDatabase();
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['booking_id'] ?? 0);
    $roomStmt = $connect->prepare("SELECT room_id FROM bookings WHERE booking_id = ? LIMIT 1");
    $roomId = 0;
    if ($roomStmt) {
        $roomStmt->bind_param('i', $id);
        $roomStmt->execute();
        $roomId = (int)($roomStmt->get_result()->fetch_assoc()['room_id'] ?? 0);
        $roomStmt->close();
    }
    $stmt = $connect->prepare("
        DELETE FROM bookings
        WHERE booking_id = ?
          AND NOT EXISTS (
              SELECT 1 FROM booking_initial_payment_requests request
              WHERE request.booking_id = bookings.booking_id
                AND request.method = 'PayPal'
                AND request.status IN
                    ('Capturing','Refund Pending','Refund Processing','Reconciliation Required')
          )
    ");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute() && $stmt->affected_rows === 1;
    $stmt->close();
    if ($ok && $roomId > 0) $ok = sync_booking_room_status($connect, $roomId);
    if ($ok) {
        rt_publish('/Admin/bookings.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
