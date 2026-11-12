<?php

require_once __DIR__ . '/../Config/db.php';
$GLOBALS['booking_room_schema_override'] = [
    'bookings:reservation_type'=>true,
    'bookings:occupant_count'=>true,
    'tenants:reservation_type'=>true,
    'tenants:occupant_count'=>true,
    'booking_room_holds:'=>true,
    'booking_room_holds:reservation_type'=>true,
    'booking_room_holds:occupant_count'=>true,
    'booking_room_holds:move_in_date'=>true,
    'booking_room_holds:check_out_date'=>true,
];
require_once __DIR__ . '/../Config/booking_room_status.php';

if (!isset($connect) || !($connect instanceof mysqli)) {
    fwrite(STDERR, "A database connection is required to run booking capacity tests" . PHP_EOL);
    exit(2);
}

function assertBookingCapacity(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

$roomResult = $connect->query('SELECT room_id FROM rooms ORDER BY room_id LIMIT 1');
$roomId = (int)($roomResult ? ($roomResult->fetch_assoc()['room_id'] ?? 0) : 0);
if ($roomResult) $roomResult->free();
if ($roomId > 0) {
    $secondConnection = (static function (): ?mysqli {
        include __DIR__ . '/../Config/db.php';
        return $connect instanceof mysqli ? $connect : null;
    })();
    if (!$secondConnection) {
        fwrite(STDERR, "A second database connection is required to test room locking" . PHP_EOL);
        exit(2);
    }

    $lockStmt = $connect->prepare('SELECT room_id FROM rooms WHERE room_id = ? FOR UPDATE');
    if (!$lockStmt || !$connect->begin_transaction()) {
        fwrite(STDERR, "Unable to begin the room-lock concurrency test" . PHP_EOL);
        exit(2);
    }
    $lockStmt->bind_param('i', $roomId);
    if (!$lockStmt->execute()) {
        fwrite(STDERR, "Unable to lock the test room row" . PHP_EOL);
        exit(2);
    }
    $lockStmt->get_result()->free();
    $lockStmt->close();

    $asyncQuery = $secondConnection->query(
        "SELECT room_id FROM rooms WHERE room_id = {$roomId} FOR UPDATE",
        MYSQLI_ASYNC
    );
    if (!$asyncQuery) {
        $connect->rollback();
        fwrite(STDERR, "Unable to start the concurrent room-lock query" . PHP_EOL);
        exit(2);
    }
    usleep(250000);
    $read = [$secondConnection];
    $errors = $reject = [];
    $completedWhileLocked = mysqli_poll($read, $errors, $reject, 0, 0);
    if ($completedWhileLocked !== 0) {
        $secondConnection->reap_async_query();
        $connect->rollback();
        fwrite(STDERR, "A second transaction acquired the room row before the first transaction released it" . PHP_EOL);
        exit(1);
    }
    if (!$connect->commit()) {
        $secondConnection->close();
        fwrite(STDERR, "Unable to release the room row after the concurrency check" . PHP_EOL);
        exit(2);
    }

    $deadline = microtime(true) + 5;
    do {
        $read = [$secondConnection];
        $errors = $reject = [];
        $completed = mysqli_poll($read, $errors, $reject, 0, 100000);
    } while ($completed === 0 && microtime(true) < $deadline);
    $lockResult = $completed > 0 ? $secondConnection->reap_async_query() : false;
    $secondConnection->close();
    assertBookingCapacity($lockResult instanceof mysqli_result, 'The waiting room-lock query did not continue after the first transaction committed');
    $lockResult->free();
}

$temporarySchemas = [
    "CREATE TEMPORARY TABLE rooms (
        room_id INT PRIMARY KEY,
        capacity INT NOT NULL,
        status VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB",
    "CREATE TEMPORARY TABLE tenants (
        tenant_id INT PRIMARY KEY,
        room_id INT NOT NULL,
        is_active TINYINT NOT NULL,
        move_in_date DATE,
        move_out_date DATE,
        email VARCHAR(255),
        reservation_type VARCHAR(32) NOT NULL DEFAULT 'capacity_based',
        occupant_count INT UNSIGNED NOT NULL DEFAULT 1
    ) ENGINE=InnoDB",
    "CREATE TEMPORARY TABLE bookings (
        booking_id INT PRIMARY KEY,
        room_id INT NOT NULL,
        status VARCHAR(32) NOT NULL,
        payment_expires_at DATETIME,
        move_in_date DATE NOT NULL,
        check_out_date DATE NOT NULL,
        payment_plan VARCHAR(64) NOT NULL,
        reservation_type VARCHAR(32) NOT NULL DEFAULT 'capacity_based',
        occupant_count INT UNSIGNED NOT NULL DEFAULT 1,
        email VARCHAR(255) NOT NULL,
        updated_at DATETIME
    ) ENGINE=InnoDB",
    "CREATE TEMPORARY TABLE booking_room_holds (
        room_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        move_in_date DATE,
        check_out_date DATE,
        reservation_type VARCHAR(32) NOT NULL DEFAULT 'capacity_based',
        occupant_count INT UNSIGNED NOT NULL DEFAULT 1
    ) ENGINE=InnoDB",
    "CREATE TEMPORARY TABLE booking_initial_payment_requests (
        booking_id INT NOT NULL,
        status VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB",
    "CREATE TEMPORARY TABLE payments (
        booking_id INT NOT NULL,
        payment_type VARCHAR(80),
        status VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB",
];

foreach ($temporarySchemas as $schema) {
    if (!$connect->query($schema)) {
        fwrite(STDERR, 'Unable to create isolated booking test tables: ' . $connect->error . PHP_EOL);
        exit(2);
    }
}

if (!$connect->query("INSERT INTO rooms (room_id, capacity, status) VALUES (1, 4, 'Available')")) {
    fwrite(STDERR, 'Unable to create isolated booking test room: ' . $connect->error . PHP_EOL);
    exit(2);
}

$checkIn = '2099-01-01';
$checkOut = '2099-02-01';

$reset = static function () use ($connect): void {
    foreach (['bookings', 'tenants', 'booking_room_holds', 'booking_initial_payment_requests', 'payments'] as $table) {
        if (!$connect->query("DELETE FROM {$table}")) {
            throw new RuntimeException("Unable to reset isolated {$table} test table");
        }
    }
};

$addBooking = static function (
    int $id,
    string $status,
    string $type,
    int $occupants,
    string $email,
    string $start = '2099-01-01',
    string $end = '2099-02-01',
    ?string $expires = null
) use ($connect): void {
    $stmt = $connect->prepare("
        INSERT INTO bookings
            (booking_id, room_id, status, payment_expires_at, move_in_date, check_out_date,
             payment_plan, reservation_type, occupant_count, email)
        VALUES (?, 1, ?, ?, ?, ?, 'Pay Monthly', ?, ?, ?)
    ");
    if (!$stmt) throw new RuntimeException('Unable to prepare isolated booking test row');
    $stmt->bind_param('isssssis', $id, $status, $expires, $start, $end, $type, $occupants, $email);
    if (!$stmt->execute()) throw new RuntimeException('Unable to insert isolated booking test row');
    $stmt->close();
};

$canReserve = static function (
    string $type = 'capacity_based',
    int $occupants = 1,
    string $start = '2099-01-01',
    string $end = '2099-02-01'
) use ($connect): bool {
    return room_has_capacity_for($connect, 1, $start, $end, $type, $occupants, 0, 0, '', false);
};

try {
    $reset();
    $GLOBALS['booking_room_schema_override'] = [
        'bookings:reservation_type'=>false,
        'bookings:occupant_count'=>false,
        'tenants:reservation_type'=>false,
        'tenants:occupant_count'=>false,
        'booking_room_holds:'=>false,
    ];
    $addBooking(1, 'Pending', 'capacity_based', 1, 'legacy@example.test', $checkIn, $checkOut, '2099-01-01 00:00:00');
    assertBookingCapacity($canReserve('capacity_based', 3), 'Legacy schema did not preserve capacity-based room availability');
    assertBookingCapacity(!$canReserve('capacity_based', 4), 'Legacy schema allowed more requested capacity than the room provides');
    $GLOBALS['booking_room_schema_override'] = [
        'bookings:reservation_type'=>true,
        'bookings:occupant_count'=>true,
        'tenants:reservation_type'=>true,
        'tenants:occupant_count'=>true,
        'booking_room_holds:'=>true,
        'booking_room_holds:reservation_type'=>true,
        'booking_room_holds:occupant_count'=>true,
        'booking_room_holds:move_in_date'=>true,
        'booking_room_holds:check_out_date'=>true,
    ];

    $reset();
    $addBooking(1, 'Pending', 'capacity_based', 1, 'a@example.test', $checkIn, $checkOut, '2099-01-01 00:00:00');
    assertBookingCapacity($canReserve(), 'An individual reservation blocked the remaining capacity');
    $addBooking(2, 'Pending', 'capacity_based', 1, 'b@example.test', $checkIn, $checkOut, '2099-01-01 00:00:00');
    assertBookingCapacity($canReserve('capacity_based', 2), 'Two individual reservations did not leave two capacities available');

    $reset();
    $addBooking(1, 'Pending', 'entire_room', 2, 'a@example.test', $checkIn, $checkOut, '2099-01-01 00:00:00');
    assertBookingCapacity(!$canReserve(), 'A whole-room booking allowed another overlapping capacity reservation');

    $reset();
    $addBooking(1, 'Pending', 'capacity_based', 2, 'a@example.test', $checkIn, $checkOut, '2099-01-01 00:00:00');
    assertBookingCapacity(!$canReserve('entire_room', 1), 'A whole-room booking was allowed to overlap an individual reservation');

    $reset();
    $addBooking(1, 'Pending', 'entire_room', 1, 'a@example.test', '2099-01-01', '2099-02-01', '2099-01-01 00:00:00');
    assertBookingCapacity($canReserve('entire_room', 1, '2099-02-01', '2099-03-01'), 'A non-overlapping whole-room booking was rejected');
    assertBookingCapacity(!$canReserve('capacity_based', 1, '2099-01-15', '2099-02-15'), 'An overlapping whole-room booking did not block capacity');

    $reset();
    $addBooking(1, 'Pending', 'entire_room', 1, 'a@example.test', $checkIn, $checkOut, '2000-01-01 00:00:00');
    assertBookingCapacity($canReserve('entire_room', 1), 'An expired unpaid whole-room booking did not release its capacity');
    assertBookingCapacity(expire_pending_bookings($connect, 1), 'The existing pending-booking expiration could not run');
    $expiredStatus = $connect->query('SELECT status FROM bookings WHERE booking_id = 1')->fetch_assoc()['status'] ?? '';
    assertBookingCapacity($expiredStatus === 'Expired', 'An unpaid whole-room booking did not transition to Expired');

    $reset();
    $addBooking(1, 'Pending Verification', 'entire_room', 2, 'a@example.test');
    if (!$connect->query("INSERT INTO booking_initial_payment_requests (booking_id, status) VALUES (1, 'Submitted')")) {
        throw new RuntimeException('Unable to insert isolated submitted payment test row');
    }
    assertBookingCapacity(!$canReserve(), 'A whole-room reservation awaiting payment review released its capacity');
    $connect->query("UPDATE bookings SET status = 'Confirmed' WHERE booking_id = 1");
    $connect->query("UPDATE booking_initial_payment_requests SET status = 'Confirmed' WHERE booking_id = 1");
    assertBookingCapacity(!$canReserve(), 'A confirmed whole-room booking released its capacity');

    $reset();
    $addBooking(1, 'Rejected', 'entire_room', 2, 'a@example.test');
    assertBookingCapacity($canReserve('entire_room', 1), 'A rejected whole-room booking did not release its capacity');

    $reset();
    if (!$connect->query("
        INSERT INTO booking_room_holds
            (room_id, email, expires_at, move_in_date, check_out_date, reservation_type, occupant_count)
        VALUES (1, 'a@example.test', DATE_ADD(NOW(), INTERVAL 5 MINUTE), '2099-01-01', '2099-02-01', 'entire_room', 1)
    ")) {
        throw new RuntimeException('Unable to insert isolated room hold test row');
    }
    assertBookingCapacity(!$canReserve(), 'An entire-room temporary hold did not reserve the room capacity');
    assertBookingCapacity($canReserve('entire_room', 1, '2099-02-01', '2099-03-01'), 'A date-disjoint temporary hold blocked another stay');

    $reset();
    if (!$connect->query("
        INSERT INTO tenants
            (tenant_id, room_id, is_active, move_in_date, move_out_date, email, reservation_type, occupant_count)
        VALUES (1, 1, 1, '2099-01-01', '2099-02-01', 'tenant@example.test', 'entire_room', 2)
    ")) {
        throw new RuntimeException('Unable to insert isolated tenant test row');
    }
    assertBookingCapacity(!$canReserve(), 'An active whole-room tenant did not block overlapping capacity');
    assertBookingCapacity($canReserve('entire_room', 1, '2099-02-01', '2099-03-01'), 'A non-overlapping tenant stay blocked room capacity');
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}

echo "Booking room capacity tests passed" . PHP_EOL;
