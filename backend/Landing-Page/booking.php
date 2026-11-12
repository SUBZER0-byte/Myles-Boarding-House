<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once '../Config/log_helper.php';
include_once '../Config/phone_validation.php';
include __DIR__ . '/../Notifications/sms_helper.php';
require_once __DIR__ . '/../Notifications/booking_sms.php';
require_once __DIR__ . '/../Config/paypal.php';
require_once __DIR__ . '/../Config/paypal_booking_reconciliation.php';
require_once __DIR__ . '/../Config/booking_room_status.php';
require_once __DIR__ . '/../Config/booking_payment_records.php';
require_once __DIR__ . '/../Config/gcash_qr.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/payment_proofs.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

if (in_array($action, [
    'create',
    'acquire_room_hold',
    'release_room_hold',
    'check',
    'boundary_dates',
    'cancel',
    'submit_initial_gcash_payment',
    'create_initial_order',
    'capture_initial_order',
    'record_initial_payment',
], true)) {
    $connectForExpiration = bookingDatabase();
    $availabilityUpdated = $action === 'check'
        ? sync_booking_room_status($connectForExpiration, null)
        : expire_pending_bookings($connectForExpiration);
    if (!$availabilityUpdated) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Booking expiration could not be processed']);
        exit;
    }
}

switch ($action) {
    case 'create':  createBooking(); break;
    case 'acquire_room_hold': acquireRoomHold(); break;
    case 'release_room_hold': releaseRoomHold(); break;
    case 'check':   checkBooking(); break;
    case 'boundary_dates': getRoomBoundaryDates(); break;
    case 'cancel':  cancelBooking(); break;
    case 'create_initial_order': createInitialPayPalOrder(); break;
    case 'get_initial_order': getInitialPayPalOrder(); break;
    case 'capture_initial_order': captureInitialPayPalOrder(); break;
    case 'record_initial_payment': recordInitialBookingPayment(); break;
    case 'submit_initial_gcash_payment': submitInitialGcashPayment(); break;
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

function bookingAllocationSchemaReady(mysqli $connect): bool
{
    $requiredSchema = [
        ['booking_room_holds', null],
        ['booking_room_holds', 'move_in_date'],
        ['booking_room_holds', 'check_out_date'],
        ['booking_room_holds', 'reservation_type'],
        ['booking_room_holds', 'occupant_count'],
        ['bookings', 'reservation_type'],
        ['bookings', 'occupant_count'],
        ['tenants', 'reservation_type'],
        ['tenants', 'occupant_count'],
    ];
    foreach ($requiredSchema as [$table, $column]) {
        if (booking_room_schema_has($connect, $table, $column) !== true) {
            return false;
        }
    }
    return true;
}

function bookingAccountEmail(mysqli $connect, int $userId): ?string
{
    $stmt = $connect->prepare('SELECT email FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1');
    if (!$stmt) {
        error_log('Booking hold account lookup prepare failed: ' . $connect->error);
        throw new RuntimeException('Unable to verify your account');
    }
    $stmt->bind_param('i', $userId);
    if (!$stmt->execute()) {
        error_log('Booking hold account lookup failed: ' . $stmt->error);
        $stmt->close();
        throw new RuntimeException('Unable to verify your account');
    }
    $email = trim((string)($stmt->get_result()->fetch_assoc()['email'] ?? ''));
    $stmt->close();
    if ($email === '') {
        return null;
    }
    return $email;
}

function scheduledRoomBoundaryDates(mysqli $connect, int $roomId, string $excludeEmail = ''): array
{
    $dates = [];
    $statuses = active_booking_statuses();
    $statusPlaceholders = implode(',', array_fill(0, count($statuses), '?'));
    $bookingStmt = $connect->prepare("
        SELECT b.move_in_date, b.check_out_date
        FROM bookings b
        WHERE b.room_id = ?
          AND b.status IN ($statusPlaceholders)
          AND LOWER(TRIM(COALESCE(b.email, ''))) <> LOWER(TRIM(?))
          AND (
              b.status <> 'Pending'
              OR b.payment_expires_at > NOW()
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
          )
    ");
    if (!$bookingStmt) {
        error_log('Scheduled room boundary lookup prepare failed: ' . $connect->error);
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $bookingParams = array_merge([$roomId], $statuses, [$excludeEmail]);
    $bookingTypes = 'i' . str_repeat('s', count($statuses)) . 's';
    $bookingStmt->bind_param($bookingTypes, ...$bookingParams);
    if (!$bookingStmt->execute()) {
        error_log('Scheduled room boundary lookup failed: ' . $bookingStmt->error);
        $bookingStmt->close();
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $bookingResult = $bookingStmt->get_result();
    while ($row = $bookingResult->fetch_assoc()) {
        foreach (['move_in_date', 'check_out_date'] as $column) {
            if (!empty($row[$column])) $dates[] = (string)$row[$column];
        }
    }
    $bookingStmt->close();

    $holdStmt = $connect->prepare("
        SELECT move_in_date, check_out_date
        FROM booking_room_holds
        WHERE room_id = ? AND expires_at > NOW()
          AND LOWER(TRIM(email)) <> LOWER(TRIM(?))
    ");
    if (!$holdStmt) {
        error_log('Scheduled room hold boundary lookup prepare failed: ' . $connect->error);
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $holdStmt->bind_param('is', $roomId, $excludeEmail);
    if (!$holdStmt->execute()) {
        error_log('Scheduled room hold boundary lookup failed: ' . $holdStmt->error);
        $holdStmt->close();
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $holdResult = $holdStmt->get_result();
    while ($row = $holdResult->fetch_assoc()) {
        foreach (['move_in_date', 'check_out_date'] as $column) {
            if (!empty($row[$column])) $dates[] = (string)$row[$column];
        }
    }
    $holdStmt->close();

    $hasTenantMoveOut = booking_room_schema_has($connect, 'tenants', 'move_out_date');
    if ($hasTenantMoveOut === null) {
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $moveOutColumn = $hasTenantMoveOut ? 'move_out_date' : 'NULL AS move_out_date';
    $tenantStmt = $connect->prepare("
        SELECT move_in_date, $moveOutColumn
        FROM tenants
        WHERE room_id = ? AND is_active = 1
          AND LOWER(TRIM(COALESCE(email, ''))) <> LOWER(TRIM(?))
    ");
    if (!$tenantStmt) {
        error_log('Scheduled tenant boundary lookup prepare failed: ' . $connect->error);
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $tenantStmt->bind_param('is', $roomId, $excludeEmail);
    if (!$tenantStmt->execute()) {
        error_log('Scheduled tenant boundary lookup failed: ' . $tenantStmt->error);
        $tenantStmt->close();
        throw new RuntimeException('Unable to check scheduled room dates');
    }
    $tenantResult = $tenantStmt->get_result();
    while ($row = $tenantResult->fetch_assoc()) {
        foreach (['move_in_date', 'move_out_date'] as $column) {
            if (!empty($row[$column])) $dates[] = (string)$row[$column];
        }
    }
    $tenantStmt->close();

    $dates = array_values(array_unique($dates));
    sort($dates);
    return $dates;
}

function getRoomBoundaryDates(): void
{
    $connect = bookingDatabase();
    if (!bookingAllocationSchemaReady($connect)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Room booking is not ready. Apply migrations 031_booking_room_holds.sql and 032_whole_room_bookings.sql.']);
        return;
    }
    $roomId = filter_var($_GET['room_id'] ?? null, FILTER_VALIDATE_INT);
    if ($roomId === false || $roomId === null || $roomId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }
    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to check scheduled room dates']);
        return;
    }
    try {
        $email = bookingAccountEmail($connect, $userId);
        if ($email === null) {
            http_response_code(403);
            echo json_encode(['type'=>'error','message'=>'An active account email is required to check scheduled room dates']);
            return;
        }
        $dates = scheduledRoomBoundaryDates($connect, $roomId, $email);
    } catch (Throwable $error) {
        error_log('Scheduled room boundary dates failed: ' . $error->getMessage());
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Scheduled room dates could not be loaded']);
        return;
    }
    echo json_encode(['type'=>'success','data'=>['room_id'=>$roomId,'dates'=>$dates]]);
}

function acquireRoomHold(): void
{
    $connect = bookingDatabase();
    if (!bookingAllocationSchemaReady($connect)) {
        http_response_code(503);
        echo json_encode([
            'type'=>'error',
            'message'=>'Room booking is not ready. Apply migrations 031_booking_room_holds.sql and 032_whole_room_bookings.sql.',
        ]);
        return;
    }
    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to reserve a room']);
        return;
    }
    $data = bookingJsonPayload();
    $roomId = (int)($data['room_id'] ?? 0);
    $reservationType = 'capacity_based';
    $occupantCount = 1;
    if ($roomId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }

    try {
        $email = bookingAccountEmail($connect, $userId);
        if ($email === null) {
            http_response_code(403);
            echo json_encode(['type'=>'error','message'=>'An active account email is required to reserve a room']);
            return;
        }
        $checkIn = trim((string)($data['move_in_date'] ?? ''));
        $checkOut = trim((string)($data['check_out_date'] ?? ''));
        $hasRequestedDates = $checkIn !== '' && $checkOut !== '';
        if ($checkIn !== '' || $checkOut !== '') {
            $parsedCheckIn = DateTimeImmutable::createFromFormat('!Y-m-d', $checkIn);
            $parsedCheckOut = DateTimeImmutable::createFromFormat('!Y-m-d', $checkOut);
            if (!$parsedCheckIn || !$parsedCheckOut
                || $parsedCheckIn->format('Y-m-d') !== $checkIn
                || $parsedCheckOut->format('Y-m-d') !== $checkOut
                || $parsedCheckOut <= $parsedCheckIn
                || $parsedCheckIn < new DateTimeImmutable('today')) {
                http_response_code(400);
                echo json_encode(['type'=>'error','message'=>'A valid check-in and check-out date range is required']);
                return;
            }
        }
        if (!$connect->begin_transaction()) {
            throw new RuntimeException('Unable to start the room reservation');
        }

        $roomStmt = $connect->prepare('SELECT status, capacity FROM rooms WHERE room_id = ? FOR UPDATE');
        if (!$roomStmt) throw new RuntimeException('Unable to check room availability');
        $roomStmt->bind_param('i', $roomId);
        if (!$roomStmt->execute()) {
            $roomStmt->close();
            throw new RuntimeException('Unable to check room availability');
        }
        $room = $roomStmt->get_result()->fetch_assoc();
        $roomStmt->close();
        if (!$room || (string)$room['status'] === 'Maintenance') {
            throw new BookingException(!$room ? 'Room not found' : 'Room is not available for booking');
        }
        if ($occupantCount > (int)$room['capacity']) {
            throw new BookingException('The number of occupants cannot exceed the room capacity');
        }

        if ($checkIn === '' || $checkOut === '') {
            $dateResult = $connect->query('SELECT CURDATE() AS check_in, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS check_out');
            if (!$dateResult) throw new RuntimeException('Unable to check room availability');
            $dates = $dateResult->fetch_assoc();
            $dateResult->free();
            if (!$dates) throw new RuntimeException('Unable to check room availability');
            $checkIn = (string)$dates['check_in'];
            $checkOut = (string)$dates['check_out'];
        }
        if ($hasRequestedDates) {
            $scheduledDates = scheduledRoomBoundaryDates($connect, $roomId, $email);
            if (in_array($checkIn, $scheduledDates, true) || in_array($checkOut, $scheduledDates, true)) {
                throw new BookingException('Move-in and move-out dates already scheduled by another guest cannot be selected for this room.');
            }
        }
        if (!room_has_capacity_for(
            $connect,
            $roomId,
            $checkIn,
            $checkOut,
            $reservationType,
            $occupantCount,
            0,
            0,
            '',
            false,
            $email
        )) {
            throw new BookingException('This room is already being reserved or is unavailable');
        }

        $holdCheckIn = $hasRequestedDates ? $checkIn : null;
        $holdCheckOut = $hasRequestedDates ? $checkOut : null;
        $holdStmt = $connect->prepare("
            INSERT INTO booking_room_holds
                (user_id, email, room_id, move_in_date, check_out_date, reservation_type, occupant_count, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                email = VALUES(email),
                room_id = VALUES(room_id),
                move_in_date = VALUES(move_in_date),
                check_out_date = VALUES(check_out_date),
                reservation_type = VALUES(reservation_type),
                occupant_count = VALUES(occupant_count),
                expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
                updated_at = NOW()
        ");
        if (!$holdStmt) throw new RuntimeException('Room reservations are not ready. Apply migration 032_whole_room_bookings.sql.');
        $holdStmt->bind_param('isisssi', $userId, $email, $roomId, $holdCheckIn, $holdCheckOut, $reservationType, $occupantCount);
        if (!$holdStmt->execute()) {
            error_log('Room hold creation failed: ' . $holdStmt->error);
            $holdStmt->close();
            throw new RuntimeException('Unable to reserve this room. Please try again.');
        }
        $holdStmt->close();

        if (!sync_booking_room_status($connect, $roomId)) {
            throw new RuntimeException('Unable to update room availability');
        }
        if (!$connect->commit()) throw new RuntimeException('Unable to save the room reservation');

        rt_publish('/Landing-Page/rooms.php');
        rt_publish('/Admin/rooms.php');
        echo json_encode([
            'type'=>'success',
            'message'=>'This room is held for you for 5 minutes while you complete the booking.',
        ]);
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Room hold creation failed: ' . $error->getMessage());
        http_response_code($error instanceof BookingException ? 409 : 500);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
    }
}

function releaseRoomHold(): void
{
    $connect = bookingDatabase();
    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to release the room reservation']);
        return;
    }
    $stmt = $connect->prepare('DELETE FROM booking_room_holds WHERE user_id = ?');
    if (!$stmt) {
        error_log('Room hold release prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'The room reservation could not be released']);
        return;
    }
    $stmt->bind_param('i', $userId);
    if (!$stmt->execute()) {
        error_log('Room hold release failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'The room reservation could not be released']);
        return;
    }
    $stmt->close();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    rt_publish('/Landing-Page/rooms.php');
    rt_publish('/Admin/rooms.php');
    echo json_encode(['type'=>'success','message'=>'Room reservation released']);
}

function createBooking() {
    $connect = bookingDatabase();
    if (!bookingAllocationSchemaReady($connect)) {
        http_response_code(503);
        echo json_encode([
            'type'=>'error',
            'message'=>'Room booking is not ready. Apply migrations 031_booking_room_holds.sql and 032_whole_room_bookings.sql.',
        ]);
        return;
    }
    $d = json_decode(file_get_contents('php://input'), true);

    $required = ['full_name','email','phone','room_id','move_in_date','check_out_date','payment_plan'];
    foreach ($required as $k) {
        if (empty($d[$k])) {
            echo json_encode(['type'=>'error','message'=>"Missing field: $k"]);
            return;
        }
    }

    $phone = canonical_phone($d['phone'] ?? '');
    if (!preg_match('/^09\d{9}$/', $phone)) {
        echo json_encode(['type'=>'error','message'=>'Invalid Philippines phone number. Must be in format: 09XXXXXXXXX']);
        return;
    }

    $room_id = intval($d['room_id']);
    $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', trim((string)$d['move_in_date']));
    $checkOut = DateTimeImmutable::createFromFormat('!Y-m-d', trim((string)$d['check_out_date']));
    $today = new DateTimeImmutable('today');
    if (!$checkIn || !$checkOut || $checkIn->format('Y-m-d') !== $d['move_in_date'] || $checkOut->format('Y-m-d') !== $d['check_out_date']) {
        echo json_encode(['type'=>'error','message'=>'Invalid check-in or check-out date']);
        return;
    }
    if ($checkOut <= $checkIn) {
        echo json_encode(['type'=>'error','message'=>'Check-out date must be later than check-in date']);
        return;
    }
    $nextMonth = $checkIn->modify('first day of next month');
    $minimumCheckOut = $nextMonth->setDate(
        (int)$nextMonth->format('Y'),
        (int)$nextMonth->format('n'),
        min((int)$checkIn->format('j'), (int)$nextMonth->format('t'))
    );
    if ($checkOut < $minimumCheckOut) {
        echo json_encode(['type'=>'error','message'=>'Check-out date must be at least one month after check-in']);
        return;
    }
    if ($checkIn < $today) {
        echo json_encode(['type'=>'error','message'=>'Check-in date cannot be in the past']);
        return;
    }
    $paymentPlan = trim((string)$d['payment_plan']);
    if (!in_array($paymentPlan, ['Pay in Full', 'Pay Monthly', 'Pay One Month Rent'], true)) {
        echo json_encode(['type'=>'error','message'=>'Invalid payment plan']);
        return;
    }
    $reservationType = 'capacity_based';
    $occupantCount = 1;

    $currentUserId = sec_current_user_id();
    if ($currentUserId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to create a booking']);
        return;
    }
    try {
        $currentEmail = bookingAccountEmail($connect, $currentUserId);
    } catch (RuntimeException $error) {
        error_log('Booking account lookup failed: ' . $error->getMessage());
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify your account']);
        return;
    }
    if ($currentEmail === null) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'An active account email is required to create a booking']);
        return;
    }
    // The booking must use the authenticated account email so its payment can be securely authorized.
    $d['email'] = $currentEmail;

    $lockKey = 'mbh_booking_' . sha1(strtolower(trim((string)$d['email'])) . '|' . $phone . '|' . $room_id . '|' . $d['move_in_date'] . '|' . $d['check_out_date']);
    $lockStmt = $connect->prepare('SELECT GET_LOCK(?, 5) AS lock_acquired');
    $lockAcquired = false;
    if ($lockStmt) {
        $lockStmt->bind_param('s', $lockKey);
        $lockStmt->execute();
        $lockAcquired = (int)($lockStmt->get_result()->fetch_assoc()['lock_acquired'] ?? 0) === 1;
        $lockStmt->close();
    }
    if (!$lockAcquired) {
        echo json_encode(['type'=>'error','message'=>'The booking is already being processed. Please try again.']);
        return;
    }

    $checkOutText = $checkOut->format('Y-m-d');
    $checkInText = $checkIn->format('Y-m-d');
    try {
        if (!$connect->begin_transaction()) {
            throw new BookingException('Unable to start booking transaction. Please try again.');
        }

        // Lock the room and check the date range inside the same transaction as the insert.
        $check = $connect->prepare("
            SELECT r.status, r.room_number, r.monthly_rent, r.capacity
            FROM rooms r
            WHERE r.room_id = ? FOR UPDATE
        ");
        $check->bind_param('i', $room_id);
        $check->execute();
        $room = $check->get_result()->fetch_assoc();
        $check->close();
        if (!$room || $room['status'] === 'Maintenance') {
            throw new BookingException(!$room ? 'Room not found' : 'Room is not available for booking');
        }
        if ($occupantCount > (int)$room['capacity']) {
            throw new BookingException('The number of occupants cannot exceed the room capacity');
        }

        // Treat retries of the same request as idempotent before conflict checks.
        $statuses = active_booking_statuses();
        $statusPlaceholders = implode(',', array_fill(0, count($statuses), '?'));
        $existingStmt = $connect->prepare("SELECT booking_id, phone FROM bookings
            WHERE email = ? AND room_id = ? AND move_in_date = ? AND check_out_date = ?
          AND payment_plan = ? AND reservation_type = ? AND occupant_count = ?
          AND status IN ($statusPlaceholders)
              AND (status <> 'Pending'
                   OR created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
                   OR EXISTS (
                       SELECT 1 FROM booking_initial_payment_requests initial_request
                       WHERE initial_request.booking_id = bookings.booking_id
                         AND initial_request.status IN ('Submitted','Confirmed')
                   ))
            ORDER BY booking_id DESC LIMIT 1 FOR UPDATE");
        $existingParams = array_merge(
            [(string)$d['email'], $room_id, $checkInText, $checkOutText, $paymentPlan, $reservationType, $occupantCount],
            $statuses
        );
        $existingTypes = 'sissssi' . str_repeat('s', count($statuses));
        $existingStmt->bind_param($existingTypes, ...$existingParams);
        $existingStmt->execute();
        $existing = $existingStmt->get_result()->fetch_assoc();
        $existingStmt->close();
        if ($existing && canonical_phone((string)$existing['phone']) === $phone) {
            $existingId = (int)$existing['booking_id'];
            $deadlineStmt = $connect->prepare("
                SELECT UNIX_TIMESTAMP(b.payment_expires_at) AS payment_expires_at_epoch,
                       UNIX_TIMESTAMP(NOW()) AS server_now_epoch,
                       CASE
                           WHEN b.payment_plan = 'Pay in Full' THEN b.total_rent
                           WHEN b.payment_plan = 'Pay One Month Rent' THEN r.monthly_rent
                           ELSE r.monthly_rent * 2
                       END AS initial_payment_amount
                FROM bookings b
                INNER JOIN rooms r ON r.room_id = b.room_id
                WHERE b.booking_id = ? LIMIT 1
            ");
            if (!$deadlineStmt) throw new BookingException('Unable to load the existing booking payment deadline');
            $deadlineStmt->bind_param('i', $existingId);
            if (!$deadlineStmt->execute()) {
                $deadlineStmt->close();
                throw new BookingException('Unable to load the existing booking payment deadline');
            }
            $existingDeadline = $deadlineStmt->get_result()->fetch_assoc();
            $deadlineStmt->close();
            $releaseHold = $connect->prepare('DELETE FROM booking_room_holds WHERE user_id = ?');
            if (!$releaseHold) throw new BookingException('Unable to finalize your room reservation');
            $releaseHold->bind_param('i', $currentUserId);
            if (!$releaseHold->execute()) {
                $releaseHold->close();
                throw new BookingException('Unable to finalize your room reservation');
            }
            $releaseHold->close();
            if (!sync_booking_room_status($connect, $room_id)) {
                throw new BookingException('Unable to update room availability');
            }
            if (!$connect->commit()) {
                throw new RuntimeException('Unable to finalize the existing GCash payment submission');
            }
            echo json_encode([
                'type'=>'success',
                'message'=>'Your booking request is saved and awaiting its initial payment.',
                'booking_id'=>$existingId,
                'initial_payment_amount'=>(float)($existingDeadline['initial_payment_amount'] ?? 0),
                'payment_expires_at_epoch'=>(int)($existingDeadline['payment_expires_at_epoch'] ?? 0),
                'server_now_epoch'=>(int)($existingDeadline['server_now_epoch'] ?? 0),
            ]);
            return;
        }

        $scheduledDates = scheduledRoomBoundaryDates($connect, $room_id, $currentEmail);
        if (in_array($checkInText, $scheduledDates, true) || in_array($checkOutText, $scheduledDates, true)) {
            throw new BookingException('Move-in and move-out dates already scheduled by another guest cannot be selected for this room.');
        }

        if (!room_has_capacity_for(
            $connect,
            $room_id,
            $checkInText,
            $checkOutText,
            $reservationType,
            $occupantCount,
            0,
            0,
            '',
            true,
            $currentEmail
        )) {
            throw new BookingException('Sorry! This room is currently being reserved by another guest. Please select another available room.');
        }

        $activeConflict = has_active_phone_conflict($connect, $phone, null, null, $currentUserId, $currentEmail);
        if ($activeConflict['booking']) {
            $isCurrentUser = !empty($activeConflict['booking']['is_current_user']);
            throw new BookingException($isCurrentUser ? 'Your account already has an active booking.' : 'This tenant already has an active booking.');
        }
        if ($activeConflict['tenant']) {
            $isCurrentUser = !empty($activeConflict['tenant']['is_current_user']);
            throw new BookingException($isCurrentUser ? 'Your account already has an active booking.' : 'This tenant already has an active booking.');
        }

        $months = bookingMonths($checkIn, $checkOut);
        $monthlyRent = (float)$room['monthly_rent'];
        $totalRent = round($monthlyRent * $months, 2);
        $notes = trim((string)($d['notes'] ?? ''));
        $stmt = $connect->prepare("INSERT INTO bookings
            (full_name, email, phone, room_id, reservation_type, occupant_count, move_in_date, check_out_date,
             length_of_stay_months, payment_plan, total_rent, notes, status, created_at, updated_at, payment_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW(), NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE))");
        if (!$stmt) throw new BookingException('Booking database is not ready. Apply migration 032_whole_room_bookings.sql.');
        $stmt->bind_param(
            'sssissssdsds',
            $d['full_name'],
            $d['email'],
            $phone,
            $room_id,
            $reservationType,
            $occupantCount,
            $checkInText,
            $checkOutText,
            $months,
            $paymentPlan,
            $totalRent,
            $notes
        );
        if (!$stmt->execute()) {
            $stmt->close();
            throw new BookingException('Failed to submit booking.');
        }
        $id = $stmt->insert_id;
        $stmt->close();
        $releaseHold = $connect->prepare('DELETE FROM booking_room_holds WHERE user_id = ?');
        if (!$releaseHold) throw new BookingException('Unable to finalize your room reservation');
        $releaseHold->bind_param('i', $currentUserId);
        if (!$releaseHold->execute()) {
            $releaseHold->close();
            throw new BookingException('Unable to finalize your room reservation');
        }
        $releaseHold->close();
        $deadlineStmt = $connect->prepare("
            SELECT UNIX_TIMESTAMP(payment_expires_at) AS payment_expires_at_epoch,
                   UNIX_TIMESTAMP(NOW()) AS server_now_epoch
            FROM bookings WHERE booking_id = ? LIMIT 1
        ");
        if (!$deadlineStmt) throw new BookingException('Unable to load the payment deadline');
        $deadlineStmt->bind_param('i', $id);
        if (!$deadlineStmt->execute()) {
            $deadlineStmt->close();
            throw new BookingException('Unable to load the payment deadline');
        }
        $deadline = $deadlineStmt->get_result()->fetch_assoc();
        $deadlineStmt->close();
        if (!$deadline) throw new BookingException('Unable to load the payment deadline');
        if (!sync_booking_room_status($connect, $room_id)) {
            throw new BookingException('Unable to update room availability');
        }
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to finalize the existing GCash payment submission');
        }

        $roomNumber = (string)($room['room_number'] ?? $room_id);
        system_notify_booking_contact(
            $connect,
            (string)$d['email'],
            'Booking Saved — Payment Required',
            "Your room is temporarily reserved. Please complete your payment before the payment deadline. If you fail to submit your payment before the deadline, your temporary reservation will automatically expire.",
            'booking'
        );
        system_notify_admins(
            $connect,
            'New Guest Booking',
            "A new booking was created for Room {$roomNumber} ({$checkInText} to {$checkOutText}). Booking #{$id} requires its initial GCash payment within 15 minutes.",
            'booking'
        );

        sys_log('booking', 'create', "Booking #{$id} by {$d['full_name']} for room {$room_id}", null);
        rt_publish('/Landing-Page/rooms.php');
        rt_publish('/Landing-Page/booking.php');
        rt_publish('/Admin/bookings.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Admin/notifications.php');

        $initialPaymentAmount = $paymentPlan === 'Pay in Full'
            ? $totalRent
            : ($paymentPlan === 'Pay One Month Rent' ? $monthlyRent : $monthlyRent * 2);
        echo json_encode([
            'type'=>'success',
            'message'=>'Your room is temporarily reserved. Please complete your payment before the payment deadline. If you fail to submit your payment before the deadline, your temporary reservation will automatically expire.',
            'booking_id'=>$id,
            'initial_payment_amount'=>$initialPaymentAmount,
            'payment_expires_at_epoch'=>(int)$deadline['payment_expires_at_epoch'],
            'server_now_epoch'=>(int)$deadline['server_now_epoch'],
        ]);
    } catch (BookingException $e) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>$e->getMessage()]);
    } catch (Throwable $e) {
        $connect->rollback();
        error_log('Booking transaction failed: ' . $e->getMessage());
        echo json_encode(['type'=>'error','message'=>'Unable to submit booking. Please try again.']);
    } finally {
        $release = $connect->prepare('SELECT RELEASE_LOCK(?)');
        if ($release) { $release->bind_param('s', $lockKey); $release->execute(); $release->close(); }
    }
}

class BookingException extends RuntimeException {}

function bookingMonths(DateTimeImmutable $checkIn, DateTimeImmutable $checkOut): int {
    $months = ((int)$checkOut->format('Y') - (int)$checkIn->format('Y')) * 12
        + (int)$checkOut->format('n') - (int)$checkIn->format('n');
    if ((int)$checkOut->format('j') > (int)$checkIn->format('j')) $months++;
    return max(1, $months);
}

function getPayPalBooking(int $userId, int $bookingId): ?array {
    $connect = bookingDatabase();
    $stmt = $connect->prepare("
        SELECT b.booking_id, b.room_id, b.status, b.email, b.move_in_date, b.payment_plan, b.total_rent,
               b.payment_expires_at, (b.payment_expires_at IS NULL OR b.payment_expires_at > NOW()) AS payment_window_open,
               b.check_out_date, b.length_of_stay_months, r.monthly_rent,
               COALESCE(
                   initial_request.status,
                   (SELECT CASE
                       WHEN legacy_initial.status = 'Submitted' THEN 'Submitted'
                       WHEN legacy_initial.status IN ('Confirmed','Paid') THEN 'Confirmed'
                       ELSE NULL
                    END
                    FROM payments legacy_initial
                    WHERE legacy_initial.booking_id = b.booking_id
                      AND legacy_initial.payment_type = 'Security Deposit'
                      AND legacy_initial.status IN ('Submitted','Confirmed','Paid')
                    ORDER BY legacy_initial.payment_id DESC
                    LIMIT 1)
               ) AS initial_payment_status,
               COALESCE(
                   initial_request.paypal_order_id,
                   (SELECT legacy_payment.paypal_order_id
                    FROM payments legacy_payment
                    WHERE legacy_payment.booking_id = b.booking_id
                      AND COALESCE(legacy_payment.payment_type, '') <> 'Security Deposit'
                      AND legacy_payment.status IN ('Pending','Overdue')
                      AND legacy_payment.paypal_order_id IS NOT NULL
                    ORDER BY legacy_payment.due_date ASC, legacy_payment.payment_id ASC
                    LIMIT 1)
               ) AS paypal_order_id,
               initial_request.paypal_order_history
        FROM bookings b
        INNER JOIN users u ON u.user_id = ? AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email))
        INNER JOIN rooms r ON r.room_id = b.room_id
        LEFT JOIN booking_initial_payment_requests initial_request
            ON initial_request.booking_id = b.booking_id
        WHERE b.booking_id = ? AND b.status IN ('Pending','Pending Verification','Confirmed')
          AND NOT EXISTS (
              SELECT 1 FROM payments paid_initial
              WHERE paid_initial.booking_id = b.booking_id
                AND paid_initial.payment_type = 'Security Deposit'
                AND paid_initial.status IN ('Confirmed','Paid')
          )
        LIMIT 1
    ");
    if (!$stmt) {
        error_log('PayPal booking lookup prepare failed: ' . $connect->error);
        throw new RuntimeException('Unable to verify booking ownership');
    }
    $stmt->bind_param('ii', $userId, $bookingId);
    $stmt->execute();
    $booking = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return is_array($booking) ? $booking : null;
}

function getInitialBookingPaymentRequest(): ?array {
    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to pay for this booking']);
        return null;
    }
    $payload = bookingJsonPayload();
    $bookingId = (int)($payload['booking_id'] ?? $_GET['booking_id'] ?? 0);
    if ($bookingId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Booking reference is required']);
        return null;
    }
    try {
        $booking = getPayPalBooking($userId, $bookingId);
    } catch (Throwable $error) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load this booking']);
        return null;
    }
    if (!$booking) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Booking was not found for this account']);
        return null;
    }
    return $booking;
}

function bookingJsonPayload(): array {
    static $payload = null;
    if ($payload === null) {
        if ($_POST || $_FILES) {
            $payload = $_POST;
        } else {
            $decoded = json_decode((string)file_get_contents('php://input'), true);
            $payload = is_array($decoded) ? $decoded : [];
        }
    }
    return $payload;
}

function initialBookingPaymentAmount(array $booking): float {
    $monthlyRent = round((float)$booking['monthly_rent'], 2);
    if ($booking['payment_plan'] === 'Pay in Full') {
        return round((float)$booking['total_rent'], 2);
    }
    return $booking['payment_plan'] === 'Pay One Month Rent'
        ? $monthlyRent
        : round($monthlyRent * 2, 2);
}

function submitInitialGcashPayment(): void {
    $booking = getInitialBookingPaymentRequest();
    if (!$booking) return;
    if ((string)$booking['status'] !== 'Pending') {
        if ((string)$booking['status'] === 'Pending Verification'
            && (string)($booking['initial_payment_status'] ?? '') === 'Submitted') {
            echo json_encode([
                'type'=>'success',
                'message'=>'Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed.',
            ]);
            return;
        }
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'This booking is not awaiting its initial payment']);
        return;
    }

    $data = bookingJsonPayload();
    $reference = trim((string)($data['reference'] ?? ''));
    $hasScreenshot = isset($_FILES['screenshot'])
        && (int)($_FILES['screenshot']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    if (($data['method'] ?? '') !== 'GCash'
        || (!$hasScreenshot && $reference === '')
        || strlen($reference) > 120) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a valid GCash transaction reference or upload a payment screenshot']);
        return;
    }

    $amount = initialBookingPaymentAmount($booking);
    $connect = bookingDatabase();
    try {
        $qrAvailable = gcash_qr_available($amount);
    } catch (Throwable $error) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
        return;
    }
    if (!$qrAvailable) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'No GCash QR is configured']);
        return;
    }

    $uploadedScreenshotPath = null;
    if ($hasScreenshot) {
        [$uploadedScreenshotPath, $uploadError] = store_payment_screenshot($_FILES['screenshot']);
        if ($uploadError !== null) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$uploadError]);
            return;
        }
    }

    $bookingId = (int)$booking['booking_id'];
    if (!ensure_full_payment_requests_table($connect)
        || !ensure_gcash_transaction_references_table($connect)) {
        if ($uploadedScreenshotPath !== null) {
            @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
        }
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to validate the GCash transaction reference']);
        return;
    }
    if (!$connect->begin_transaction()) {
        if ($uploadedScreenshotPath !== null) {
            @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
        }
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to start GCash payment submission']);
        return;
    }
    try {
        $bookingLock = $connect->prepare("
            SELECT status, room_id, move_in_date, check_out_date, email,
                   (payment_expires_at IS NULL OR payment_expires_at > NOW()) AS payment_window_open
            FROM bookings WHERE booking_id = ? LIMIT 1 FOR UPDATE
        ");
        if (!$bookingLock) throw new RuntimeException('Unable to lock this booking');
        $bookingLock->bind_param('i', $bookingId);
        $bookingLock->execute();
        $lockedBooking = $bookingLock->get_result()->fetch_assoc();
        $bookingLock->close();
        if (!$lockedBooking || (string)$lockedBooking['status'] !== 'Pending') {
            throw new RuntimeException('This booking is not awaiting its initial payment');
        }
        if (!(int)$lockedBooking['payment_window_open']) {
            throw new RuntimeException('The 15-minute payment deadline has expired');
        }
        if ((string)$lockedBooking['status'] === 'Pending'
            && !room_has_capacity(
                $connect,
                (int)$lockedBooking['room_id'],
                (string)$lockedBooking['move_in_date'],
                (string)$lockedBooking['check_out_date'],
                $bookingId,
                0,
                (string)$lockedBooking['email']
            )) {
            throw new RuntimeException('The room was just reserved by another guest');
        }

        $existingStmt = $connect->prepare("
            SELECT method, status, reference_number, screenshot_path
            FROM booking_initial_payment_requests
            WHERE booking_id = ?
            LIMIT 1 FOR UPDATE
        ");
        if (!$existingStmt) throw new RuntimeException('Unable to check for a previous booking payment');
        $existingStmt->bind_param('i', $bookingId);
        $existingStmt->execute();
        $existing = $existingStmt->get_result()->fetch_assoc();
        $existingStmt->close();
        if (!$existing) {
            $legacyStmt = $connect->prepare("
                SELECT reference_number
                FROM payments
                WHERE booking_id = ? AND payment_type = 'Security Deposit'
                  AND method = 'GCash' AND status = 'Submitted'
                LIMIT 1 FOR UPDATE
            ");
            if (!$legacyStmt) throw new RuntimeException('Unable to check for a previous GCash submission');
            $legacyStmt->bind_param('i', $bookingId);
            $legacyStmt->execute();
            $legacySubmission = $legacyStmt->get_result()->fetch_assoc();
            $legacyStmt->close();
            if ($legacySubmission) {
                if ((string)$legacySubmission['reference_number'] === $reference && !$hasScreenshot) {
                    if (!$connect->commit()) {
                        throw new RuntimeException('Unable to save the GCash payment submission');
                    }
                    echo json_encode(['type'=>'success','message'=>'GCash payment is already submitted for admin review']);
                    return;
                }
                throw new RuntimeException('An initial GCash payment is already submitted for this booking');
            }
        }
        if ($existing) {
            if ((string)$existing['method'] === 'GCash'
                && (string)$existing['reference_number'] === $reference
                && (string)$existing['status'] === 'Submitted') {
                if (!$connect->commit()) {
                    throw new RuntimeException('Unable to finalize the existing GCash payment submission');
                }
                if ($uploadedScreenshotPath !== null) {
                    @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
                }
                echo json_encode(['type'=>'success','message'=>'GCash payment is already submitted for admin review']);
                return;
            }
            if (!in_array((string)$existing['status'], ['Checkout','Rejected'], true)) {
                throw new RuntimeException('An initial payment is already submitted or confirmed for this booking');
            }
        }

        if ($reference !== '') {
            $reserved = reserve_gcash_transaction_reference($connect, $reference);
            if ($reserved !== true) {
                throw new RuntimeException($reserved === false
                    ? 'This GCash reference has already been submitted'
                    : 'Unable to validate the GCash transaction reference');
            }
        }

        $saveRequest = $connect->prepare("
            INSERT INTO booking_initial_payment_requests
                (booking_id, method, status, amount, reference_number, screenshot_path,
                 paypal_order_id, paypal_capture_id, created_at)
            VALUES (?, 'GCash', 'Submitted', ?, ?, ?, NULL, NULL, NOW())
            ON DUPLICATE KEY UPDATE
                method = VALUES(method),
                status = VALUES(status),
                amount = VALUES(amount),
                reference_number = VALUES(reference_number),
                screenshot_path = VALUES(screenshot_path),
                paypal_order_id = NULL,
                paypal_capture_id = NULL,
                updated_at = NOW()
        ");
        if (!$saveRequest) throw new RuntimeException('Unable to save the GCash payment submission');
        $bookingAmount = initialBookingPaymentAmount($booking);
        $saveRequest->bind_param('idss', $bookingId, $bookingAmount, $reference, $uploadedScreenshotPath);
        if (!$saveRequest->execute()) {
            $saveRequest->close();
            throw new RuntimeException('Unable to save the GCash payment submission');
        }
        $saveRequest->close();
        $markVerification = $connect->prepare("
            UPDATE bookings
            SET status = 'Pending Verification', updated_at = NOW()
            WHERE booking_id = ? AND status = 'Pending' AND payment_expires_at > NOW()
        ");
        if (!$markVerification) throw new RuntimeException('Unable to mark the booking as awaiting payment verification');
        $markVerification->bind_param('i', $bookingId);
        if (!$markVerification->execute() || $markVerification->affected_rows !== 1) {
            $markVerification->close();
            throw new RuntimeException('The payment deadline has expired; this reservation is no longer active');
        }
        $markVerification->close();
        if (!sync_booking_room_status($connect, (int)$lockedBooking['room_id'])) {
            throw new RuntimeException('Unable to refresh room availability after payment submission');
        }
        if (!$connect->commit()) {
            throw new RuntimeException('Unable to save the GCash payment submission');
        }

        sms_notify_admins_booking_payment($connect, $bookingId, 'GCash', $amount, $reference);
        system_notify_booking_contact(
            $connect,
            (string)$booking['email'],
            'GCash Payment Submitted',
            'Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed.',
            'booking_payment'
        );
        system_notify_admins(
            $connect,
            'Guest Booking Payment Needs Review',
            'A GCash initial payment of ₱' . number_format($amount, 2) . " was submitted for booking #{$bookingId}.",
            'booking_payment'
        );
        rt_publish('/Admin/bookings.php');
        rt_publish('/Admin/payments.php');
        rt_publish('/Landing-Page/booking.php');
        rt_publish('/Landing-Page/rooms.php');
        rt_publish('/Admin/rooms.php');
        echo json_encode([
            'type'=>'success',
            'message'=>'Your payment has been successfully submitted! Your reservation is now awaiting administrator verification. Please allow 30–60 minutes for the administrator to verify your payment. You will receive an update once your payment has been reviewed. Your reservation is not yet confirmed.',
        ]);
    } catch (Throwable $error) {
        $connect->rollback();
        if ($uploadedScreenshotPath !== null) {
            @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
        }
        error_log('Initial GCash payment submission failed: ' . $error->getMessage());
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
    }
}

function createInitialPayPalOrder(): void {
    $booking = getInitialBookingPaymentRequest();
    if (!$booking) return;
    if ((string)$booking['status'] === 'Pending' && !(int)$booking['payment_window_open']) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'The 15-minute payment deadline has expired']);
        return;
    }
    if (!in_array((string)$booking['status'], ['Pending','Confirmed'], true)
        || in_array((string)($booking['initial_payment_status'] ?? ''), ['Submitted','Confirmed'], true)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'This booking is not awaiting its initial payment']);
        return;
    }
    $bookingId = (int)$booking['booking_id'];
    if ((string)$booking['status'] === 'Pending' && !booking_room_still_free(bookingDatabase(), $booking)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'The room was just reserved by another guest. You have not been charged.']);
        return;
    }
    $amount = initialBookingPaymentAmount($booking);
    if (!empty($booking['paypal_order_id'])) {
        $existingOrderId = (string)$booking['paypal_order_id'];
        $existingOrder = pp_request('GET', '/v2/checkout/orders/' . rawurlencode($existingOrderId), null, [
            'Authorization' => 'Bearer ' . pp_token(),
            'Content-Type' => 'application/json',
        ]);
        if ($existingOrder['code'] >= 200 && $existingOrder['code'] < 300) {
            $existingStatus = strtoupper((string)($existingOrder['data']['status'] ?? ''));
            $existingApproveUrl = '';
            foreach (($existingOrder['data']['links'] ?? []) as $link) {
                if (in_array(($link['rel'] ?? ''), ['approve','payer-action'], true)) {
                    $existingApproveUrl = (string)($link['href'] ?? '');
                    break;
                }
            }
            if (in_array($existingStatus, ['CREATED','APPROVED'], true) && $existingApproveUrl !== '') {
                echo json_encode(['type'=>'success','order_id'=>$existingOrderId,'approve_url'=>$existingApproveUrl,'amount'=>number_format($amount, 2, '.', ''),'currency'=>'PHP']);
                return;
            }
            if (!in_array($existingStatus, ['CANCELLED','VOIDED','EXPIRED'], true)) {
                http_response_code(409);
                echo json_encode(['type'=>'error','message'=>'An existing PayPal payment for this booking needs to be reviewed']);
                return;
            }
        } else {
            http_response_code(502);
            error_log('PayPal existing booking order lookup failed: HTTP ' . (int)$existingOrder['code'] . ' - ' . trim((string)$existingOrder['raw']));
            echo json_encode(['type'=>'error','message'=>'The existing PayPal checkout could not be checked']);
            return;
        }

        $orderHistory = json_decode((string)($booking['paypal_order_history'] ?? ''), true);
        if (!is_array($orderHistory)) $orderHistory = [];
        $orderHistory[] = [
            'order_id'=>$existingOrderId,
            'status'=>$existingStatus,
            'closed_at'=>gmdate('c'),
        ];
        $orderHistoryJson = json_encode($orderHistory, JSON_UNESCAPED_SLASHES);
        $clear = bookingDatabase()->prepare("
            UPDATE booking_initial_payment_requests
            SET paypal_order_history = ?, paypal_order_id = NULL,
                paypal_capture_request_id = NULL, paypal_capture_attempts = 0,
                updated_at = NOW()
            WHERE booking_id = ? AND status = 'Checkout' AND paypal_order_id = ?
        ");
        if (!$clear) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to restart PayPal checkout']);
            return;
        }
        $clear->bind_param('sis', $orderHistoryJson, $bookingId, $existingOrderId);
        $cleared = $clear->execute();
        $clear->close();
        if (!$cleared) {
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'Booking payment changed; refresh and try again']);
            return;
        }
    }

    $response = pp_request('POST', '/v2/checkout/orders', [
        'intent' => 'CAPTURE',
        'purchase_units' => [[
            'reference_id' => 'booking-' . $bookingId,
            'custom_id' => (string)$bookingId,
            'description' => 'Initial booking payment #' . $bookingId,
            'amount' => ['currency_code'=>'PHP','value'=>number_format($amount, 2, '.', '')],
        ]],
        'application_context' => [
            'brand_name' => "Myle's Boarding House",
            'user_action' => 'PAY_NOW',
            'return_url' => rtrim(pp_cfg()['app_base_url'], '/') . '/payment-success',
            'cancel_url' => rtrim(pp_cfg()['app_base_url'], '/') . '/payment-failed',
        ],
    ], [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);
    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        http_response_code(502);
        error_log('PayPal booking order creation failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        echo json_encode(['type'=>'error','message'=>'PayPal checkout could not be created']);
        return;
    }

    $orderId = (string)($response['data']['id'] ?? '');
    $approveUrl = '';
    foreach (($response['data']['links'] ?? []) as $link) {
        if (in_array(($link['rel'] ?? ''), ['approve','payer-action'], true)) {
            $approveUrl = (string)($link['href'] ?? '');
            break;
        }
    }
    if ($orderId === '' || $approveUrl === '') {
        http_response_code(502);
        echo json_encode(['type'=>'error','message'=>'PayPal did not return a valid checkout link']);
        return;
    }

    $connect = bookingDatabase();
    $save = $connect->prepare("
        INSERT INTO booking_initial_payment_requests
            (booking_id, method, status, amount, paypal_order_id, created_at)
        VALUES (?, 'PayPal', 'Checkout', ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            method = IF(status = 'Checkout', VALUES(method), method),
            amount = IF(status = 'Checkout', VALUES(amount), amount),
            paypal_order_id = IF(status = 'Checkout', VALUES(paypal_order_id), paypal_order_id),
            updated_at = IF(status = 'Checkout', NOW(), updated_at)
    ");
    if (!$save) {
        error_log('PayPal booking order save prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save the PayPal checkout reference']);
        return;
    }
    $save->bind_param('ids', $bookingId, $amount, $orderId);
    $saved = $save->execute();
    $save->close();
    if (!$saved) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'Booking payment changed; refresh and try again']);
        return;
    }

    $verifyRequest = $connect->prepare("
        SELECT method, status, paypal_order_id
        FROM booking_initial_payment_requests
        WHERE booking_id = ? LIMIT 1
    ");
    if (!$verifyRequest) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify the PayPal checkout reference']);
        return;
    }
    $verifyRequest->bind_param('i', $bookingId);
    $verifyRequest->execute();
    $savedRequest = $verifyRequest->get_result()->fetch_assoc();
    $verifyRequest->close();
    if (!$savedRequest
        || $savedRequest['method'] !== 'PayPal'
        || $savedRequest['status'] !== 'Checkout'
        || !hash_equals((string)$savedRequest['paypal_order_id'], $orderId)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'Booking payment changed; refresh and try again']);
        return;
    }
    echo json_encode(['type'=>'success','order_id'=>$orderId,'approve_url'=>$approveUrl,'amount'=>number_format($amount, 2, '.', ''),'currency'=>'PHP']);
}

function getInitialPayPalOrder(): void {
    $booking = getInitialBookingPaymentRequest();
    if (!$booking) return;
    $orderId = trim((string)($_GET['order_id'] ?? ''));
    if ($orderId === '' || !hash_equals((string)($booking['paypal_order_id'] ?? ''), $orderId)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'PayPal order does not match this booking']);
        return;
    }
    $response = pp_request('GET', '/v2/checkout/orders/' . rawurlencode($orderId), null, [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);
    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        http_response_code(502);
        error_log('PayPal booking order lookup failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        echo json_encode(['type'=>'error','message'=>'PayPal order could not be loaded']);
        return;
    }
    echo json_encode(['type'=>'success','status'=>strtoupper((string)($response['data']['status'] ?? '')),'order'=>$response['data']]);
}

function captureInitialPayPalOrder(): void {
    $booking = getInitialBookingPaymentRequest();
    if (!$booking) return;
    $orderId = trim((string)(bookingJsonPayload()['order_id'] ?? ''));
    if ($orderId === '' || !hash_equals((string)($booking['paypal_order_id'] ?? ''), $orderId)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'PayPal order does not match this booking']);
        return;
    }

    $connect = bookingDatabase();
    $userId = sec_current_user_id();
    $begin = paypal_booking_begin_capture($connect, $userId, (int)$booking['booking_id'], $orderId);
    if (($begin['state'] ?? '') !== 'started') {
        http_response_code(409);
        echo json_encode([
            'type'=>'error',
            'message'=>(string)($begin['message'] ?? 'PayPal capture could not be started'),
        ]);
        return;
    }
    $outcome = paypal_booking_reconcile_one($connect, (int)$booking['booking_id'], true);
    if ($outcome === 'confirmed') {
        rt_publish('/Tenant/payments.php');
        rt_publish('/Admin/payments.php');
        rt_publish('/Landing-Page/booking.php');
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
        echo json_encode([
            'type'=>'success',
            'message'=>'PayPal payment recorded; booking confirmed and room reserved',
            'order_id'=>$orderId,
            'capture_status'=>'COMPLETED',
        ]);
        return;
    }
    if ($outcome === 'refunded') {
        http_response_code(409);
        echo json_encode([
            'type'=>'error',
            'message'=>'The booking could not be confirmed. PayPal refunded the capture.',
            'order_id'=>$orderId,
        ]);
        return;
    }
    if ($outcome === 'closed') {
        http_response_code(409);
        echo json_encode([
            'type'=>'error',
            'message'=>'The PayPal order was not captured; the reservation hold was released.',
            'order_id'=>$orderId,
        ]);
        return;
    }
    http_response_code(202);
    echo json_encode([
        'type'=>'pending',
        'message'=>'PayPal payment is being reconciled. The room remains held until the capture or refund is resolved.',
        'order_id'=>$orderId,
    ]);
}

function recordInitialBookingPayment(?array $data = null): void {
    $connect = bookingDatabase();
    $userId = sec_current_user_id();
    $data = $data ?? bookingJsonPayload();
    $bookingId = (int)($data['booking_id'] ?? 0);
    if ($userId <= 0 || $bookingId <= 0) {
        http_response_code($userId > 0 ? 400 : 401);
        echo json_encode(['type'=>'error','message'=>'Booking reference and authenticated account are required']);
        return;
    }
    $booking = getPayPalBooking($userId, $bookingId);
    if (!$booking || (string)($booking['initial_payment_status'] ?? '') !== 'Capturing') {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'No PayPal capture is awaiting reconciliation for this booking']);
        return;
    }
    $orderId = trim((string)($booking['paypal_order_id'] ?? ''));
    $requestedOrderId = trim((string)($data['paypal_order_id'] ?? $data['order_id'] ?? ''));
    if ($orderId === '' || ($requestedOrderId !== '' && !hash_equals($orderId, $requestedOrderId))) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'PayPal order does not match this booking']);
        return;
    }
    $outcome = paypal_booking_reconcile_one($connect, $bookingId, true);
    echo json_encode([
        'type'=>$outcome === 'confirmed' ? 'success' : 'pending',
        'message'=>$outcome === 'confirmed'
            ? 'PayPal booking payment was reconciled'
            : 'PayPal booking payment remains under reconciliation',
        'order_id'=>$orderId,
    ]);
}

function checkBooking() {
    $connect = bookingDatabase();
    $email = $_GET['email'] ?? '';
    $stmt = $connect->prepare("
                SELECT b.*, r.room_number, r.room_type, r.monthly_rent, r.status AS room_status,
                    COALESCE(
                        initial_request.status,
                        (SELECT CASE
                            WHEN legacy_initial.status = 'Submitted' THEN 'Submitted'
                            WHEN legacy_initial.status IN ('Confirmed','Paid') THEN 'Confirmed'
                            ELSE NULL
                         END
                         FROM payments legacy_initial
                         WHERE legacy_initial.booking_id = b.booking_id
                           AND legacy_initial.payment_type = 'Security Deposit'
                           AND legacy_initial.status IN ('Submitted','Confirmed','Paid')
                         ORDER BY legacy_initial.payment_id DESC
                         LIMIT 1)
                    ) AS initial_payment_status,
                    CASE
                        WHEN b.payment_plan = 'Pay in Full' THEN b.total_rent
                        WHEN b.payment_plan = 'Pay One Month Rent' THEN r.monthly_rent
                        ELSE r.monthly_rent * 2
                    END AS initial_payment_amount,
                    UNIX_TIMESTAMP(NOW()) AS server_now_epoch,
                    UNIX_TIMESTAMP(b.payment_expires_at) AS payment_expires_at_epoch,
                    EXISTS (
                        SELECT 1 FROM payments paid_initial
                        WHERE paid_initial.booking_id = b.booking_id
                          AND paid_initial.payment_type = CASE
                              WHEN b.payment_plan = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                              ELSE 'Security Deposit'
                          END
                          AND paid_initial.status IN ('Confirmed','Paid')
                    ) AS initial_payment_paid,
                    GREATEST(0, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.booking_id AND p.status IN ('Confirmed','Paid')), 0)
                        - COALESCE((SELECT SUM(r.refund_amount) FROM refund_requests r INNER JOIN payments refunded_payment ON refunded_payment.payment_id = r.payment_id WHERE refunded_payment.booking_id = b.booking_id AND r.status = 'Approved'), 0)) AS amount_paid,
                    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.booking_id AND (p.payment_type IS NULL OR p.payment_type <> 'Security Deposit') AND p.status NOT IN ('Cancelled','Rejected','Confirmed','Paid')), 0) AS amount_due,
                    (SELECT MIN(p.due_date) FROM payments p WHERE p.booking_id = b.booking_id AND p.status IN ('Pending','Submitted','Overdue')) AS next_payment_due
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        LEFT JOIN booking_initial_payment_requests initial_request
            ON initial_request.booking_id = b.booking_id
        WHERE b.email = ?
        ORDER BY b.created_at DESC
    ");
    if (!$stmt) {
        error_log('Booking lookup prepare failed: ' . $connect->error);
        echo json_encode(['type'=>'error','message'=>'Booking database is not ready. Apply the booking reservation database migration first.']);
        return;
    }
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function cancelBooking() {
    $connect = bookingDatabase();
    $d          = json_decode(file_get_contents('php://input'), true);
    $booking_id = intval($d['booking_id'] ?? 0);

    if (!$booking_id) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Missing booking_id']);
        return;
    }

    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Sign in to cancel this booking']);
        return;
    }

    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to start booking cancellation']);
        return;
    }
    try {
        $stmt = $connect->prepare("
            SELECT b.booking_id, b.room_id, b.status, b.full_name, b.phone, b.notes,
                   b.email, b.payment_plan, r.room_number, r.monthly_rent
            FROM bookings b
            INNER JOIN users u
                ON u.user_id = ? AND u.is_active = 1
               AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email))
            LEFT JOIN rooms r ON r.room_id = b.room_id
            WHERE b.booking_id = ?
            LIMIT 1 FOR UPDATE
        ");
        if (!$stmt) throw new RuntimeException('Unable to load booking for cancellation');
        $stmt->bind_param('ii', $userId, $booking_id);
        if (!$stmt->execute()) throw new RuntimeException('Unable to load booking for cancellation');
        $booking = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$booking) throw new RuntimeException('Booking not found');
        if (!in_array((string)$booking['status'], ['Pending', 'Pending Verification', 'Confirmed'], true)) {
            throw new RuntimeException('Only Pending, Pending Verification, or Confirmed bookings can be cancelled');
        }

        $requestStmt = $connect->prepare("
            SELECT method, status
            FROM booking_initial_payment_requests
            WHERE booking_id = ?
            LIMIT 1 FOR UPDATE
        ");
        if (!$requestStmt) throw new RuntimeException('Unable to verify the initial payment request');
        $requestStmt->bind_param('i', $booking_id);
        if (!$requestStmt->execute()) throw new RuntimeException('Unable to verify the initial payment request');
        $paymentRequest = $requestStmt->get_result()->fetch_assoc();
        $requestStmt->close();

        if ($paymentRequest
            && (string)$paymentRequest['method'] === 'PayPal'
            && in_array((string)$paymentRequest['status'], [
                'Capturing',
                'Refund Pending',
                'Refund Processing',
                'Reconciliation Required',
            ], true)) {
            throw new RuntimeException('This booking cannot be cancelled until PayPal capture/refund reconciliation completes');
        }

        if ($paymentRequest
            && (string)$paymentRequest['method'] === 'GCash'
            && (string)$paymentRequest['status'] === 'Submitted') {
            $rejectRequest = $connect->prepare("
                UPDATE booking_initial_payment_requests
                SET status = 'Rejected', updated_at = NOW()
                WHERE booking_id = ? AND method = 'GCash' AND status = 'Submitted'
            ");
            if (!$rejectRequest) throw new RuntimeException('Unable to close the submitted GCash payment request');
            $rejectRequest->bind_param('i', $booking_id);
            if (!$rejectRequest->execute() || $rejectRequest->affected_rows !== 1) {
                $rejectRequest->close();
                throw new RuntimeException('The GCash payment request changed during cancellation');
            }
            $rejectRequest->close();
        }

        if ((string)$booking['status'] === 'Pending Verification') {
            $initialPaymentType = (string)$booking['payment_plan'] === 'Pay One Month Rent'
                ? 'Pay One Month Rent'
                : 'Security Deposit';
            $rejectLegacy = $connect->prepare("
                UPDATE payments
                SET status = 'Rejected'
                WHERE booking_id = ? AND method = 'GCash' AND status = 'Submitted'
                  AND payment_type IN ('Security Deposit', ?)
            ");
            if (!$rejectLegacy) throw new RuntimeException('Unable to close legacy GCash payment submissions');
            $rejectLegacy->bind_param('is', $booking_id, $initialPaymentType);
            if (!$rejectLegacy->execute()) {
                $rejectLegacy->close();
                throw new RuntimeException('Unable to close legacy GCash payment submissions');
            }
            $rejectLegacy->close();
        }

        $refundColumn = $connect->query("SHOW COLUMNS FROM bookings LIKE 'refund_status'");
        if (!$refundColumn) throw new RuntimeException('Unable to check booking refund status');
        $hasRefundStatus = $refundColumn->num_rows > 0;
        $refundColumn->free();
        $updateSql = $hasRefundStatus
            ? "UPDATE bookings SET status = 'Cancelled', refund_status = 'Pending', updated_at = NOW() WHERE booking_id = ? AND status IN ('Pending','Pending Verification','Confirmed')"
            : "UPDATE bookings SET status = 'Cancelled', updated_at = NOW() WHERE booking_id = ? AND status IN ('Pending','Pending Verification','Confirmed')";
        $update = $connect->prepare($updateSql);
        if (!$update) throw new RuntimeException('Unable to cancel booking');
        $update->bind_param('i', $booking_id);
        if (!$update->execute() || $update->affected_rows !== 1) {
            $update->close();
            throw new RuntimeException('Booking status changed while cancellation was being processed');
        }
        $update->close();

        if ($booking['room_id'] && !sync_booking_room_status($connect, (int)$booking['room_id'])) {
            throw new RuntimeException('Unable to refresh room availability after cancellation');
        }
        if (!$connect->commit()) throw new RuntimeException('Unable to save booking cancellation');
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Booking cancellation failed: ' . $error->getMessage());
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
        return;
    }

    // Notify all active admins to process the refund
    $guestName  = $booking['full_name'];
    $email      = (string)$booking['email'];
    $roomNumber = $booking['room_number'] ?? 'N/A';
    $rent       = $booking['monthly_rent'] ? '₱' . number_format((float)$booking['monthly_rent'], 2) : 'N/A';

    // Extract GCash reference from notes if present (format: "Payment: gcash • Ref: XXXXXX")
    $paymentRef = '';
    if (!empty($booking['notes']) && preg_match('/Ref:\s*([^\s\n]+)/i', $booking['notes'], $m)) {
        $paymentRef = $m[1];
    }

    $notifTitle = '⚠️ Booking Cancelled — Refund Required';
    $notifMsg   = "Guest {$guestName} ({$email}) cancelled their booking for Room {$roomNumber}. "
                . "Amount paid: {$rent}."
                . ($paymentRef ? " GCash Ref: {$paymentRef}." : "")
                . " Please process the refund and contact the guest.";

    $admins = $connect->query("SELECT user_id FROM users WHERE user_type = 'Admin' AND is_active = 1");
    $ins = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, 'booking_cancellation', 0, NOW())
    ");
    while ($admin = $admins->fetch_assoc()) {
        $aid = $admin['user_id'];
        $ins->bind_param("iss", $aid, $notifTitle, $notifMsg);
        $ins->execute();
    }
    $ins->close();

    // Push realtime update so admin notification badge refreshes instantly
    rt_publish('/Landing-Page/booking.php');
    rt_publish('/Landing-Page/rooms.php');
    rt_publish('/Admin/bookings.php');
    rt_publish('/Admin/rooms.php');
    rt_publish('/Admin/notifications.php');

    sys_log('booking', 'cancel', "Booking #{$booking_id} cancelled by guest {$guestName} ({$email}) — Room {$roomNumber}, refund {$rent}", null);

    echo json_encode(['type'=>'success','message'=>'Booking cancelled successfully']);
}
?>
