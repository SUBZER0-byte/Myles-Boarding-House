<?php

function promote_guest_booking_to_tenant(mysqli $connect, int $bookingId): void
{
    $bookingStmt = $connect->prepare("
        SELECT booking_id, full_name, email, phone, room_id, reservation_type, occupant_count,
               move_in_date, check_out_date
        FROM bookings
        WHERE booking_id = ?
        LIMIT 1
        FOR UPDATE
    ");
    if (!$bookingStmt) throw new RuntimeException('Unable to prepare tenant account conversion');
    $bookingStmt->bind_param('i', $bookingId);
    if (!$bookingStmt->execute()) {
        $bookingStmt->close();
        throw new RuntimeException('Unable to load booking for tenant account conversion');
    }
    $booking = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();
    if (!$booking) throw new RuntimeException('Booking was not found for tenant account conversion');

    $email = trim((string)($booking['email'] ?? ''));
    if ($email === '') throw new RuntimeException('No guest account is linked to this booking');
    $userStmt = $connect->prepare("
        SELECT user_id, user_type
        FROM users
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
        ORDER BY user_id
        LIMIT 1
        FOR UPDATE
    ");
    if (!$userStmt) throw new RuntimeException('Unable to prepare guest account lookup');
    $userStmt->bind_param('s', $email);
    if (!$userStmt->execute()) {
        $userStmt->close();
        throw new RuntimeException('Unable to load the guest account for tenant account conversion');
    }
    $user = $userStmt->get_result()->fetch_assoc();
    $userStmt->close();

    $userId = (int)($user['user_id'] ?? 0);
    if ($userId <= 0) throw new RuntimeException('No guest account is linked to this booking');
    if ((string)$user['user_type'] === 'Admin') {
        throw new RuntimeException('An administrator account cannot be converted to a tenant');
    }

    $roomId = (int)($booking['room_id'] ?? 0);
    $reservationType = (string)($booking['reservation_type'] ?? 'capacity_based');
    $occupantCount = max(1, (int)($booking['occupant_count'] ?? 1));
    $fullName = trim((string)($booking['full_name'] ?? ''));
    $phone = trim((string)($booking['phone'] ?? ''));
    $moveInDate = trim((string)($booking['move_in_date'] ?? ''));
    $moveOutDate = trim((string)($booking['check_out_date'] ?? '')) ?: null;

    if ($roomId <= 0 || $fullName === '' || $moveInDate === '') {
        throw new RuntimeException('Booking details are incomplete for tenant account conversion');
    }

    $tenantStmt = $connect->prepare("
        SELECT tenant_id, room_id, is_active
        FROM tenants
        WHERE user_id = ?
        ORDER BY is_active DESC, tenant_id DESC
        LIMIT 1
        FOR UPDATE
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
