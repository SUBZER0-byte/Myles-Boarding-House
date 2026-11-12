<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'my_room':       myRoom(); break;
    case 'available':     availableRooms(); break;
    case 'request_change': requestRoomChange(); break;
    case 'request_extension': requestStayExtension(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function tenantRoomDatabase(): mysqli {
    global $connect;
    if (!($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        exit;
    }
    return $connect;
}

function myRoom() {
    $connect = tenantRoomDatabase();
    $uid = sec_current_user_id();
    if ($uid <= 0) {
        echo json_encode(['type'=>'error','message'=>'Invalid user ID']);
        return;
    }
    $stmt = $connect->prepare("
        SELECT r.*, t.tenant_id, t.move_in_date, t.move_out_date, t.full_name AS tenant_name,
               b.booking_id, b.check_out_date,
               (SELECT scr.requested_check_out_date
                FROM stay_change_requests scr
                WHERE scr.booking_id = b.booking_id
                  AND scr.request_type = 'Extension'
                  AND scr.status = 'Pending'
                ORDER BY scr.created_at DESC, scr.request_id DESC
                LIMIT 1) AS requested_move_out_date,
               (SELECT scr.status
                FROM stay_change_requests scr
                WHERE scr.booking_id = b.booking_id
                  AND scr.request_type = 'Extension'
                ORDER BY scr.created_at DESC, scr.request_id DESC
                LIMIT 1) AS extension_request_status
        FROM tenants t
        INNER JOIN rooms r ON r.room_id = t.room_id
        LEFT JOIN users u ON u.user_id = t.user_id
        LEFT JOIN bookings b ON b.booking_id = (
            SELECT active_booking.booking_id
            FROM bookings active_booking
            WHERE active_booking.room_id = t.room_id
              AND active_booking.status IN ('Confirmed','Checked In','Active')
              AND (
                  (u.email IS NOT NULL AND u.email <> ''
                   AND LOWER(TRIM(active_booking.email)) = LOWER(TRIM(u.email)))
                  OR (t.email IS NOT NULL AND t.email <> ''
                      AND LOWER(TRIM(active_booking.email)) = LOWER(TRIM(t.email)))
              )
            ORDER BY active_booking.created_at DESC, active_booking.booking_id DESC
            LIMIT 1
        )
        WHERE t.user_id = ? AND t.is_active = 1
    ");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $room = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$room) {
        echo json_encode(['type'=>'error','message'=>'No active room assignment found']);
        return;
    }
    echo json_encode(['type'=>'success','data'=>$room]);
}

function requestStayExtension(): void {
    $connect = tenantRoomDatabase();
    $userId = sec_current_user_id();
    $newCheckout = trim((string)(json_decode(file_get_contents('php://input'), true)['requested_check_out_date'] ?? ''));
    $requestedDate = DateTimeImmutable::createFromFormat('!Y-m-d', $newCheckout);
    if ($userId <= 0 || sec_current_user_type() !== 'Tenant') {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Sign in with a tenant account to request a stay extension']);
        return;
    }
    if (!$requestedDate || $requestedDate->format('Y-m-d') !== $newCheckout) {
        echo json_encode(['type'=>'error','message'=>'Select a valid new move-out date']);
        return;
    }

    $connect->begin_transaction();
    try {
    $bookingStmt = $connect->prepare("
        SELECT b.booking_id, COALESCE(b.check_out_date, t.move_out_date) AS check_out_date
        FROM bookings b
        INNER JOIN users u ON u.user_id = ?
        INNER JOIN tenants t ON t.user_id = u.user_id AND t.is_active = 1
        WHERE b.room_id = t.room_id
          AND b.status IN ('Confirmed','Checked In','Active')
          AND (
              (u.email IS NOT NULL AND u.email <> ''
               AND LOWER(TRIM(b.email)) = LOWER(TRIM(u.email)))
              OR (t.email IS NOT NULL AND t.email <> ''
                  AND LOWER(TRIM(b.email)) = LOWER(TRIM(t.email)))
              OR (
                  t.move_in_date = b.move_in_date
                  AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name))
                  AND t.phone = b.phone
              )
          )
        ORDER BY b.created_at DESC, b.booking_id DESC
        LIMIT 1
          FOR UPDATE
    ");
    if (!$bookingStmt) {
          error_log('Stay extension booking lookup failed: ' . $connect->error);
          $connect->rollback();
          http_response_code(500);
          echo json_encode(['type'=>'error','message'=>'Could not look up the active booking']);
          return;
    }
    $bookingStmt->bind_param('i', $userId);
    $bookingStmt->execute();
    $booking = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();
    if (!$booking || empty($booking['check_out_date'])) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'No active booking with a move-out date was found']);
        return;
    }

    $currentCheckout = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$booking['check_out_date']);
    if (!$currentCheckout || $requestedDate <= $currentCheckout) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'The new move-out date must be later than your current move-out date']);
        return;
    }

    $pendingStmt = $connect->prepare("
        SELECT request_id FROM stay_change_requests
        WHERE booking_id = ? AND request_type = 'Extension' AND status = 'Pending'
        LIMIT 1
        FOR UPDATE
    ");
    if (!$pendingStmt) {
        error_log('Stay extension request check failed: ' . $connect->error);
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Could not check existing extension requests']);
        return;
    }
    $bookingId = (int)$booking['booking_id'];
    $pendingStmt->bind_param('i', $bookingId);
    $pendingStmt->execute();
    $existing = $pendingStmt->get_result()->fetch_assoc();
    $pendingStmt->close();
    if ($existing) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'You already have a pending extension request']);
        return;
    }

    $insert = $connect->prepare("
        INSERT INTO stay_change_requests
            (booking_id, request_type, original_check_out_date, requested_check_out_date,
             status, requested_by, created_at)
        VALUES (?, 'Extension', ?, ?, 'Pending', ?, NOW())
    ");
    if (!$insert) {
        error_log('Stay extension request insert failed: ' . $connect->error);
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Could not submit extension request']);
        return;
    }
    $originalDate = (string)$booking['check_out_date'];
    $requestedText = $requestedDate->format('Y-m-d');
    $insert->bind_param('issi', $bookingId, $originalDate, $requestedText, $userId);
    $ok = $insert->execute();
    $insert->close();
    if (!$ok) {
        error_log('Stay extension request insert failed: ' . $connect->error);
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Could not submit extension request']);
        return;
    }
    $connect->commit();
    } catch (Throwable $error) {
        $connect->rollback();
        error_log('Stay extension request failed: ' . $error->getMessage());
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Could not submit extension request']);
        return;
    }

    rt_publish('/Tenant/room.php');
    rt_publish('/Admin/bookings.php');
    echo json_encode(['type'=>'success','message'=>'Stay extension request submitted for admin approval']);
}

function availableRooms() {
    $connect = tenantRoomDatabase();
    $res = $connect->query("SELECT * FROM rooms WHERE status = 'Available' ORDER BY monthly_rent ASC");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function requestRoomChange() {
    $connect = tenantRoomDatabase();
    $d = json_decode(file_get_contents('php://input'), true);
    $user_id = intval($d['user_id'] ?? 0);
    $room_id = intval($d['requested_room_id'] ?? 0);
    $reason = trim((string)($d['reason'] ?? ''));
    if ($user_id <= 0 || $room_id <= 0) {
        echo json_encode(['type'=>'error','message'=>'Missing tenant or requested room']);
        return;
    }

    $tenantStmt = $connect->prepare("SELECT tenant_id, room_id FROM tenants WHERE user_id = ? AND is_active = 1 LIMIT 1");
    $tenantStmt->bind_param("i", $user_id);
    $tenantStmt->execute();
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();
    if (!$tenant) {
        echo json_encode(['type'=>'error','message'=>'Active tenant record not found']);
        return;
    }
    if ((int)$tenant['room_id'] === $room_id) {
        echo json_encode(['type'=>'error','message'=>'You are already assigned to this room']);
        return;
    }

    $roomStmt = $connect->prepare("SELECT room_id FROM rooms WHERE room_id = ? AND status = 'Available' LIMIT 1");
    $roomStmt->bind_param("i", $room_id);
    $roomStmt->execute();
    $requestedRoom = $roomStmt->get_result()->fetch_assoc();
    $roomStmt->close();
    if (!$requestedRoom) {
        echo json_encode(['type'=>'error','message'=>'The requested room is not available']);
        return;
    }

    $stmt = $connect->prepare("
        INSERT INTO room_change_requests (tenant_id, requested_room_id, reason, status, created_at)
        VALUES (?, ?, ?, 'Pending', NOW())
    ");
    $tenant_id = (int)$tenant['tenant_id'];
    $stmt->bind_param("iis", $tenant_id, $room_id, $reason);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Request submitted':'Failed']);
}
?>
