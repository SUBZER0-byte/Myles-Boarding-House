<?php

function booking_room_schema_has(mysqli $connect, string $table, ?string $column = null): ?bool
{
    $override = $GLOBALS['booking_room_schema_override'] ?? null;
    if (is_array($override)) {
        $key = $table . ':' . ($column ?? '');
        if (array_key_exists($key, $override)) {
            return (bool)$override[$key];
        }
    }

    static $schema = [];
    $cacheKey = spl_object_id($connect) . ':' . $table . ':' . ($column ?? '');
    if (array_key_exists($cacheKey, $schema)) {
        return $schema[$cacheKey];
    }

    if ($column === null) {
        $stmt = $connect->prepare('
            SELECT 1 FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1
        ');
    } else {
        $stmt = $connect->prepare('
            SELECT 1 FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1
        ');
    }
    if (!$stmt) {
        error_log('Booking schema lookup prepare failed: ' . $connect->error);
        return null;
    }
    if ($column === null) {
        $stmt->bind_param('s', $table);
    } else {
        $stmt->bind_param('ss', $table, $column);
    }
    if (!$stmt->execute()) {
        error_log('Booking schema lookup failed: ' . $stmt->error);
        $stmt->close();
        return null;
    }
    $exists = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
    $schema[$cacheKey] = $exists;
    return $exists;
}

function room_capacity_snapshot(
    mysqli $connect,
    int $roomId,
    string $checkIn,
    string $checkOut,
    int $excludeBookingId = 0,
    int $excludeTenantId = 0,
    string $excludeEmail = '',
    bool $lockRoom = true,
    string $excludeHoldEmail = ''
): ?array
{
    $roomLock = $lockRoom ? ' FOR UPDATE' : '';
    $roomStmt = $connect->prepare('SELECT capacity, status FROM rooms WHERE room_id = ?' . $roomLock);
    if (!$roomStmt) {
        error_log('Room capacity lookup prepare failed: ' . $connect->error);
        return null;
    }
    $roomStmt->bind_param('i', $roomId);
    if (!$roomStmt->execute()) {
        error_log('Room capacity lookup failed: ' . $roomStmt->error);
        $roomStmt->close();
        return null;
    }
    $room = $roomStmt->get_result()->fetch_assoc();
    $roomStmt->close();
    if (!$room) {
        return null;
    }

    $tenantEmailFilter = '';
    $tenantParams = [$roomId, $excludeTenantId, $checkOut, $checkIn];
    $tenantTypes = 'iiss';
    if ($excludeEmail !== '') {
        $tenantEmailFilter = ' AND LOWER(TRIM(t.email)) <> LOWER(TRIM(?))';
        $tenantParams[] = $excludeEmail;
        $tenantTypes .= 's';
    }
    $bookingParams = [
        $roomId,
        $excludeBookingId,
        $checkOut,
        $checkIn,
        $checkOut,
        $checkIn,
    ];
    $bookingTypes = 'iissss';
    $validReservation = "(
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
    )";
    $bookingFilter = "b.room_id = ? AND b.booking_id <> ?
        AND b.status IN ('Pending','Pending Verification','Confirmed','Checked In','Active')
        AND b.move_in_date < ? AND b.check_out_date > ?
        AND {$validReservation}
        AND NOT EXISTS (
            SELECT 1 FROM tenants t
            WHERE t.room_id = b.room_id AND t.is_active = 1
              AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email))
              AND t.move_in_date < ? AND COALESCE(t.move_out_date, '9999-12-31') > ?
        )";
    $temporaryFilter = "b.room_id = ? AND b.booking_id <> ?
        AND b.status = 'Pending'
        AND b.check_out_date > CURDATE()
        AND {$validReservation}
        AND NOT EXISTS (
            SELECT 1 FROM tenants t
            WHERE t.room_id = b.room_id AND t.is_active = 1
              AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email))
              AND t.move_in_date < b.check_out_date
              AND COALESCE(t.move_out_date, '9999-12-31') > b.move_in_date
        )";
    $temporaryParams = [$roomId, $excludeBookingId];
    $reservedFilter = "b.room_id = ? AND b.booking_id <> ?
        AND b.status IN ('Pending Verification','Confirmed')
        AND b.check_out_date > CURDATE()
        AND {$validReservation}
        AND NOT EXISTS (
            SELECT 1 FROM tenants t
            WHERE t.room_id = b.room_id AND t.is_active = 1
              AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email))
              AND t.move_in_date < b.check_out_date
              AND COALESCE(t.move_out_date, '9999-12-31') > b.move_in_date
        )";
    $reservedParams = [$roomId, $excludeBookingId];
    $activeParams = $bookingParams;
    $hasBookingReservationType = booking_room_schema_has($connect, 'bookings', 'reservation_type');
    $hasBookingOccupants = booking_room_schema_has($connect, 'bookings', 'occupant_count');
    $hasTenantReservationType = booking_room_schema_has($connect, 'tenants', 'reservation_type');
    $hasTenantOccupants = booking_room_schema_has($connect, 'tenants', 'occupant_count');
    $hasHoldTable = booking_room_schema_has($connect, 'booking_room_holds');
    if ($hasBookingReservationType === null || $hasBookingOccupants === null
        || $hasTenantReservationType === null || $hasTenantOccupants === null
        || $hasHoldTable === null) {
        return null;
    }
    $bookingAllocation = $hasBookingReservationType && $hasBookingOccupants
        ? "CASE WHEN b.reservation_type = 'entire_room' THEN r.capacity
               ELSE LEAST(GREATEST(b.occupant_count, 1), r.capacity) END"
        : '1';
    $tenantAllocation = $hasTenantReservationType && $hasTenantOccupants
        ? "CASE WHEN t.reservation_type = 'entire_room' THEN r.capacity
               ELSE LEAST(GREATEST(t.occupant_count, 1), r.capacity) END"
        : '1';
    $holdEmailFilter = '';
    $holdParams = [];
    $holdTypes = '';
    $holdAllocation = '0';
    if ($hasHoldTable) {
        $hasHoldReservationType = booking_room_schema_has($connect, 'booking_room_holds', 'reservation_type');
        $hasHoldOccupants = booking_room_schema_has($connect, 'booking_room_holds', 'occupant_count');
        $hasHoldCheckIn = booking_room_schema_has($connect, 'booking_room_holds', 'move_in_date');
        $hasHoldCheckOut = booking_room_schema_has($connect, 'booking_room_holds', 'check_out_date');
        if ($hasHoldReservationType === null || $hasHoldOccupants === null
            || $hasHoldCheckIn === null || $hasHoldCheckOut === null) {
            return null;
        }
        $holdAllocation = $hasHoldReservationType && $hasHoldOccupants
            ? "CASE WHEN h.reservation_type = 'entire_room' THEN r.capacity
                   ELSE LEAST(GREATEST(h.occupant_count, 1), r.capacity) END"
            : '1';
        $holdDateFilter = '1 = 1';
        if ($hasHoldCheckIn && $hasHoldCheckOut) {
            $holdDateFilter = '(h.move_in_date IS NULL OR h.check_out_date IS NULL
                OR (h.move_in_date < ? AND h.check_out_date > ?))';
            $holdParams = [$checkOut, $checkIn];
            $holdTypes = 'ss';
        }
        $holdParams = array_merge([$roomId], $holdParams);
        $holdTypes = 'i' . $holdTypes;
        if ($excludeHoldEmail !== '') {
            $holdEmailFilter = ' AND LOWER(TRIM(h.email)) <> LOWER(TRIM(?))';
            $holdParams[] = $excludeHoldEmail;
            $holdTypes .= 's';
        }
        $holdSql = "(SELECT COALESCE(SUM({$holdAllocation}), 0)
            FROM booking_room_holds h
            INNER JOIN rooms r ON r.room_id = h.room_id
            WHERE h.room_id = ? AND h.expires_at > NOW()
              AND {$holdDateFilter}{$holdEmailFilter}) AS hold_beds";
    } else {
        $holdSql = '0 AS hold_beds';
    }
    $tenantBedsSql = "(SELECT COALESCE(SUM({$tenantAllocation}), 0)
        FROM tenants t
        INNER JOIN rooms r ON r.room_id = t.room_id
        WHERE t.room_id = ? AND t.is_active = 1 AND t.tenant_id <> ?
          AND t.move_in_date < ? AND COALESCE(t.move_out_date, '9999-12-31') > ?{$tenantEmailFilter}) AS tenant_beds";
    $bookingBedsSql = "(SELECT COALESCE(SUM({$bookingAllocation}), 0)
        FROM bookings b
        INNER JOIN rooms r ON r.room_id = b.room_id
        WHERE {$bookingFilter}) AS booking_beds";
    $capacityStmt = $connect->prepare("
        SELECT capacity_counts.tenant_beds,
               capacity_counts.booking_beds,
               capacity_counts.hold_beds AS active_hold_beds,
               capacity_counts.tenant_beds + capacity_counts.booking_beds + capacity_counts.hold_beds AS occupied_beds,
               (SELECT COUNT(*) FROM bookings b
                WHERE {$temporaryFilter}) AS temporary_beds,
               (SELECT COUNT(*) FROM bookings b
                WHERE {$reservedFilter}) AS reserved_beds,
               (SELECT COUNT(*) FROM bookings b
                WHERE {$bookingFilter}
                  AND b.status IN ('Checked In','Active')) AS active_booking_beds
        FROM (
            SELECT
                {$tenantBedsSql},
                {$holdSql},
                {$bookingBedsSql}
        ) AS capacity_counts
    ");
    if (!$capacityStmt) {
        error_log('Room capacity count prepare failed: ' . $connect->error);
        return null;
    }
    $capacityParams = array_merge(
        $temporaryParams,
        $reservedParams,
        $activeParams,
        $tenantParams,
        $holdParams,
        $bookingParams
    );
    $capacityTypes = 'iiii' . $bookingTypes . $tenantTypes . $holdTypes . $bookingTypes;
    $capacityStmt->bind_param($capacityTypes, ...$capacityParams);
    if (!$capacityStmt->execute()) {
        error_log('Room capacity count failed: ' . $capacityStmt->error);
        $capacityStmt->close();
        return null;
    }
    $occupied = $capacityStmt->get_result()->fetch_assoc();
    $capacityStmt->close();
    if (!$occupied) {
        error_log('Room capacity count returned no result');
        return null;
    }

    return array_merge($room, $occupied);
}

function room_has_capacity(
    mysqli $connect,
    int $roomId,
    string $checkIn,
    string $checkOut,
    int $excludeBookingId = 0,
    int $excludeTenantId = 0,
    string $excludeEmail = '',
    bool $lockRoom = true,
    string $excludeHoldEmail = ''
): bool {
    $reservationType = 'capacity_based';
    $occupantCount = 1;
    if ($excludeBookingId > 0) {
        $bookingStmt = $connect->prepare('SELECT reservation_type, occupant_count FROM bookings WHERE booking_id = ? LIMIT 1');
        if (!$bookingStmt) {
            error_log('Booking allocation lookup prepare failed: ' . $connect->error);
            return false;
        }
        $bookingStmt->bind_param('i', $excludeBookingId);
        if (!$bookingStmt->execute()) {
            error_log('Booking allocation lookup failed: ' . $bookingStmt->error);
            $bookingStmt->close();
            return false;
        }
        $bookingAllocation = $bookingStmt->get_result()->fetch_assoc();
        $bookingStmt->close();
        if (!$bookingAllocation) {
            return false;
        }
        $reservationType = (string)$bookingAllocation['reservation_type'];
        $occupantCount = (int)$bookingAllocation['occupant_count'];
    }

    return room_has_capacity_for(
        $connect,
        $roomId,
        $checkIn,
        $checkOut,
        $reservationType,
        $occupantCount,
        $excludeBookingId,
        $excludeTenantId,
        $excludeEmail,
        $lockRoom,
        $excludeHoldEmail
    );
}

function room_has_capacity_for(
    mysqli $connect,
    int $roomId,
    string $checkIn,
    string $checkOut,
    string $reservationType,
    int $occupantCount,
    int $excludeBookingId = 0,
    int $excludeTenantId = 0,
    string $excludeEmail = '',
    bool $lockRoom = true,
    string $excludeHoldEmail = ''
): bool {
    $snapshot = room_capacity_snapshot(
        $connect,
        $roomId,
        $checkIn,
        $checkOut,
        $excludeBookingId,
        $excludeTenantId,
        $excludeEmail,
        $lockRoom,
        $excludeHoldEmail
    );
    if ($snapshot === null || (string)$snapshot['status'] === 'Maintenance'
        || !in_array($reservationType, ['capacity_based', 'entire_room'], true)) {
        return false;
    }
    $capacity = (int)$snapshot['capacity'];
    if ($occupantCount < 1 || $occupantCount > $capacity) {
        return false;
    }
    $requestedCapacity = $reservationType === 'entire_room' ? $capacity : $occupantCount;
    return (int)$snapshot['occupied_beds'] + $requestedCapacity <= $capacity;
}

function booking_room_still_free(mysqli $connect, array $booking): bool
{
    $bookingId = (int)($booking['booking_id'] ?? 0);
    $emailStmt = $connect->prepare('SELECT email FROM bookings WHERE booking_id = ? LIMIT 1');
    if (!$emailStmt) {
        error_log('Booking email lookup prepare failed: ' . $connect->error);
        return false;
    }
    $emailStmt->bind_param('i', $bookingId);
    if (!$emailStmt->execute()) {
        error_log('Booking email lookup failed: ' . $emailStmt->error);
        $emailStmt->close();
        return false;
    }
    $email = trim((string)($emailStmt->get_result()->fetch_assoc()['email'] ?? ''));
    $emailStmt->close();
    if ($bookingId <= 0 || $email === '') {
        return false;
    }

    $transactionStarted = false;
    try {
        if (!$connect->begin_transaction()) {
            throw new RuntimeException('Unable to start room availability check');
        }
        $transactionStarted = true;
        $free = room_has_capacity(
            $connect,
            (int)($booking['room_id'] ?? 0),
            (string)($booking['move_in_date'] ?? ''),
            (string)($booking['check_out_date'] ?? ''),
            $bookingId,
            0,
            $email
        );
        $connect->rollback();
        return $free;
    } catch (Throwable $error) {
        if ($transactionStarted) {
            $connect->rollback();
        }
        error_log('Booking room availability check failed: ' . $error->getMessage());
        return false;
    }
}

function expire_pending_bookings(mysqli $connect, ?int $roomId = null): bool
{
    if ($roomId !== null && $roomId <= 0) {
        return false;
    }

    $roomFilter = $roomId === null ? '' : ' AND b.room_id = ?';
    $expirePending = $connect->prepare("
        UPDATE bookings b
        SET b.status = 'Expired', b.updated_at = NOW()
        WHERE b.status = 'Pending'
          AND b.payment_expires_at IS NOT NULL AND b.payment_expires_at <= NOW(){$roomFilter}
          AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.booking_id = b.booking_id
                AND p.payment_type = CASE
                    WHEN b.payment_plan = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                    ELSE 'Security Deposit'
                END
                AND p.status IN ('Submitted','Paid','Confirmed')
          )
          AND NOT EXISTS (
              SELECT 1 FROM booking_initial_payment_requests initial_request
              WHERE initial_request.booking_id = b.booking_id
                AND initial_request.status IN ('Submitted','Confirmed')
          )
    ");
    if (!$expirePending) {
        error_log('Expired booking cleanup prepare failed: ' . $connect->error);
        return false;
    }
    if ($roomId !== null) {
        $expirePending->bind_param('i', $roomId);
    }
    $expired = $expirePending->execute();
    if (!$expired) {
        error_log('Expired booking cleanup failed: ' . $expirePending->error);
    }
    $expirePending->close();
    if (!$expired) {
        return false;
    }

    $roomFilter = $roomId === null ? '' : ' AND b.room_id = ?';
    $markVerification = $connect->prepare("
        UPDATE bookings b
        SET b.status = 'Pending Verification', b.updated_at = NOW()
        WHERE b.status = 'Pending'{$roomFilter}
          AND (
              EXISTS (
                  SELECT 1 FROM booking_initial_payment_requests initial_request
                  WHERE initial_request.booking_id = b.booking_id
                    AND initial_request.status = 'Submitted'
              )
              OR EXISTS (
                  SELECT 1 FROM payments initial_payment
                  WHERE initial_payment.booking_id = b.booking_id
                    AND initial_payment.payment_type = CASE
                        WHEN b.payment_plan = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                        ELSE 'Security Deposit'
                    END
                    AND initial_payment.status = 'Submitted'
              )
          )
    ");
    if (!$markVerification) {
        error_log('Payment verification booking update prepare failed: ' . $connect->error);
        return false;
    }
    if ($roomId !== null) {
        $markVerification->bind_param('i', $roomId);
    }
    $marked = $markVerification->execute();
    if (!$marked) {
        error_log('Payment verification booking update failed: ' . $markVerification->error);
    }
    $markVerification->close();
    return $marked;
}

function sync_booking_room_status(mysqli $connect, ?int $roomId): bool
{
    if ($roomId !== null && $roomId <= 0) {
        return false;
    }

    if (!expire_pending_bookings($connect, $roomId)) {
        return false;
    }

    $dateResult = $connect->query('SELECT CURDATE() AS check_in, DATE_ADD(CURDATE(), INTERVAL 1 DAY) AS check_out');
    if (!$dateResult) {
        error_log('Room status date lookup failed: ' . $connect->error);
        return false;
    }
    $dates = $dateResult->fetch_assoc();
    $dateResult->free();
    if (!$dates) {
        error_log('Room status date lookup returned no result');
        return false;
    }

    $roomSql = 'SELECT room_id, status FROM rooms' . ($roomId === null ? '' : ' WHERE room_id = ?');
    $roomStmt = $connect->prepare($roomSql);
    if (!$roomStmt) {
        error_log('Room status lookup prepare failed: ' . $connect->error);
        return false;
    }
    if ($roomId !== null) {
        $roomStmt->bind_param('i', $roomId);
    }
    if (!$roomStmt->execute()) {
        error_log('Room status lookup failed: ' . $roomStmt->error);
        $roomStmt->close();
        return false;
    }
    $rooms = $roomStmt->get_result();
    $update = $connect->prepare('UPDATE rooms SET status = ? WHERE room_id = ? AND status <> \'Maintenance\'');
    if (!$update) {
        error_log('Room status update prepare failed: ' . $connect->error);
        $roomStmt->close();
        return false;
    }
    $confirmedBooking = $connect->prepare("
        SELECT 1 FROM bookings
        WHERE room_id = ? AND status = 'Confirmed' AND check_out_date > CURDATE()
        LIMIT 1
    ");
    if (!$confirmedBooking) {
        error_log('Confirmed booking room status prepare failed: ' . $connect->error);
        $update->close();
        $roomStmt->close();
        return false;
    }

    $ok = true;
    while ($room = $rooms->fetch_assoc()) {
        if ((string)$room['status'] === 'Maintenance') {
            continue;
        }
        $snapshot = room_capacity_snapshot(
            $connect,
            (int)$room['room_id'],
            (string)$dates['check_in'],
            (string)$dates['check_out'],
            0,
            0,
            '',
            false
        );
        if ($snapshot === null) {
            $ok = false;
            break;
        }
        $confirmedRoomId = (int)$room['room_id'];
        $confirmedBooking->bind_param('i', $confirmedRoomId);
        if (!$confirmedBooking->execute()) {
            error_log('Confirmed booking room status lookup failed: ' . $confirmedBooking->error);
            $ok = false;
            break;
        }
        $hasConfirmedBooking = (bool)$confirmedBooking->get_result()->fetch_assoc();
        if ($hasConfirmedBooking
            || (int)$snapshot['tenant_beds'] > 0
            || (int)$snapshot['active_booking_beds'] > 0) {
            $status = 'Occupied';
        } elseif ((int)$snapshot['reserved_beds'] > 0) {
            $status = 'Reserved';
        } elseif ((int)$snapshot['temporary_beds'] > 0 || (int)$snapshot['active_hold_beds'] > 0) {
            $status = 'Reserving';
        } elseif ((int)$snapshot['occupied_beds'] >= (int)$snapshot['capacity']) {
            $status = 'Reserved';
        } elseif (in_array((string)$snapshot['status'], ['Reserved', 'Occupied', 'Reserving'], true)) {
            $status = 'Available';
        } else {
            $status = (string)$snapshot['status'];
        }

        $roomIdToUpdate = (int)$room['room_id'];
        $update->bind_param('si', $status, $roomIdToUpdate);
        if (!$update->execute()) {
            error_log('Room status synchronization failed: ' . $update->error);
            $ok = false;
            break;
        }
    }
    $confirmedBooking->close();
    $update->close();
    $roomStmt->close();
    return $ok;
}
