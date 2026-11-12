<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/booking_room_status.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

if (in_array($action, ['list', 'list_available', 'featured'], true)
    && expire_pending_bookings(databaseConnection()) === false) {
    http_response_code(500);
    echo json_encode(['type'=>'error','message'=>'Booking expiration could not be processed']);
    exit;
}

switch ($action) {
    case 'list':           listAll(); break;
    case 'list_available': listAvailable(); break;
    case 'get':            getRoom(); break;
    case 'featured':       featured(); break;
    case 'list_images':    listRoomImages(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function databaseConnection(): mysqli {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        exit;
    }
    return $connect;
}

function listAll() {
    $connect = databaseConnection();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $excludeHoldEmail = '';
    $userId = sec_current_user_id();
    if ($userId > 0) {
        $userStmt = $connect->prepare('SELECT email FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1');
        if (!$userStmt) {
            error_log('Room listing account lookup prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
            return;
        }
        $userStmt->bind_param('i', $userId);
        if (!$userStmt->execute()) {
            error_log('Room listing account lookup failed: ' . $userStmt->error);
            $userStmt->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
            return;
        }
        $excludeHoldEmail = trim((string)($userStmt->get_result()->fetch_assoc()['email'] ?? ''));
        $userStmt->close();
    }

    $checkIn = trim((string)($_GET['check_in_date'] ?? ''));
    $checkOut = trim((string)($_GET['check_out_date'] ?? ''));
    $hasDateRange = $checkIn !== '' && $checkOut !== '';
    if ($hasDateRange) {
        $validCheckIn = DateTimeImmutable::createFromFormat('!Y-m-d', $checkIn);
        $validCheckOut = DateTimeImmutable::createFromFormat('!Y-m-d', $checkOut);
        if (!$validCheckIn || !$validCheckOut || $validCheckIn->format('Y-m-d') !== $checkIn
            || $validCheckOut->format('Y-m-d') !== $checkOut || $validCheckOut <= $validCheckIn
            || $validCheckIn < new DateTimeImmutable('today')) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'A valid check-in and check-out date range is required']);
            return;
        }

    }

    $stmt = $connect->prepare("
        SELECT r.room_id, r.room_number, r.room_type, r.capacity, r.monthly_rent,
               r.description, r.status, r.image,
               (SELECT COUNT(*) FROM tenants t
                WHERE t.room_id = r.room_id AND t.is_active = 1
                  AND t.move_in_date <= CURDATE()
                  AND COALESCE(t.move_out_date, '9999-12-31') > CURDATE()) AS occupants
        FROM rooms r
        ORDER BY r.room_number ASC
    ");
        if (!$stmt) {
            error_log('Date-based room availability prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
            return;
        }
        if (!$stmt->execute()) {
            error_log('Room listing query failed: ' . $stmt->error);
            $stmt->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
            return;
        }
        $result = $stmt->get_result();
        $rows = [];
        if (!$hasDateRange) {
            $currentDates = $connect->query('SELECT CURDATE() AS check_in, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS check_out');
            if (!$currentDates) {
                error_log('Current room date lookup failed: ' . $connect->error);
                $stmt->close();
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
                return;
            }
            $currentRange = $currentDates->fetch_assoc();
            $currentDates->free();
            if (!$currentRange) {
                $stmt->close();
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
                return;
            }
            $checkIn = (string)$currentRange['check_in'];
            $checkOut = (string)$currentRange['check_out'];
        }
        while ($room = $result->fetch_assoc()) {
            $snapshot = room_capacity_snapshot(
                $connect,
                (int)$room['room_id'],
                $checkIn,
                $checkOut,
                0,
                0,
                '',
                false,
                $excludeHoldEmail
            );
            if ($snapshot === null) {
                $stmt->close();
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
                return;
            }
            $availableBeds = (string)$snapshot['status'] === 'Maintenance'
                ? 0
                : max(0, (int)$snapshot['capacity'] - (int)$snapshot['occupied_beds']);
            $room['available_beds'] = $availableBeds;
            if ($hasDateRange) {
                $room['available_for_dates'] = $availableBeds > 0 ? 1 : 0;
            }
            $rows[] = $room;
        }
        $stmt->close();
        echo json_encode(['type'=>'success','data'=>$rows]);
}

function listAvailable() {
    $connect = databaseConnection();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $dates = $connect->query('SELECT CURDATE() AS check_in, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS check_out');
    if (!$dates) {
        error_log('Available room date lookup failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
        return;
    }
    $range = $dates->fetch_assoc();
    $dates->free();
    if (!$range) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
        return;
    }
    $res = $connect->query("
        SELECT room_id, room_number, room_type, capacity, monthly_rent, description, status, image
        FROM rooms ORDER BY monthly_rent ASC
    ");
    if (!$res) {
        error_log('Available room list failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Available rooms could not be loaded']);
        return;
    }
    $rows = [];
    while ($room = $res->fetch_assoc()) {
        if (room_has_capacity($connect, (int)$room['room_id'], $range['check_in'], $range['check_out'], 0, 0, '', false)) {
            $rows[] = $room;
        }
    }
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getRoom() {
    $connect = databaseConnection();
    $id = intval($_GET['room_id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }
    if (!sync_booking_room_status($connect, $id)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $stmt = $connect->prepare("SELECT * FROM rooms WHERE room_id = ?");
    if (!$stmt) {
        error_log('Room lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    $stmt->bind_param("i", $id);
    if (!$stmt->execute()) {
        error_log('Room lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function listRoomImages(): void {
    $connect = databaseConnection();
    $roomId = intval($_GET['room_id'] ?? 0);
    if ($roomId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }

    $stmt = $connect->prepare(
        "SELECT image_id, filename, caption, sort_order FROM room_images WHERE room_id = ? ORDER BY sort_order ASC, image_id ASC"
    );
    if (!$stmt) {
        error_log('Room photo list prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be loaded']);
        return;
    }
    $stmt->bind_param("i", $roomId);
    if (!$stmt->execute()) {
        error_log('Room photo list query failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be loaded']);
        return;
    }

    $result = $stmt->get_result();
    $images = [];
    while ($image = $result->fetch_assoc()) {
        $images[] = $image;
    }
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$images]);
}

function featured() {
    $connect = databaseConnection();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $dates = $connect->query('SELECT CURDATE() AS check_in, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS check_out');
    if (!$dates) {
        error_log('Featured room date lookup failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
        return;
    }
    $range = $dates->fetch_assoc();
    $dates->free();
    if (!$range) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be checked']);
        return;
    }
    $res = $connect->query("
        SELECT room_id, room_number, room_type, capacity, monthly_rent, description, image
        FROM rooms ORDER BY monthly_rent ASC
    ");
    if (!$res) {
        error_log('Featured room list failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Featured rooms could not be loaded']);
        return;
    }
    $rows = [];
    while ($room = $res->fetch_assoc()) {
        if (room_has_capacity($connect, (int)$room['room_id'], $range['check_in'], $range['check_out'], 0, 0, '', false)) {
            $rows[] = $room;
            if (count($rows) >= 6) break;
        }
    }
    echo json_encode(['type'=>'success','data'=>$rows]);
}
?>
