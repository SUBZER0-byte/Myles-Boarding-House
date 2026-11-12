<?php

function system_notify_user(mysqli $connect, int $userId, string $title, string $message, string $type = 'info'): bool {
    if ($userId <= 0) {
        return false;
    }

    $stmt = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, NOW())
    ");
    if (!$stmt) {
        error_log('System notification prepare failed: ' . $connect->error);
        return false;
    }

    $stmt->bind_param('isss', $userId, $title, $message, $type);
    $ok = $stmt->execute();
    if (!$ok) {
        error_log('System notification insert failed: ' . $stmt->error);
    }
    $stmt->close();

    if ($ok && function_exists('rt_publish')) {
        rt_publish('/Admin/notifications.php');
        rt_publish('/Tenant/notifications.php');
    }

    return $ok;
}

function system_notify_admins(mysqli $connect, string $title, string $message, string $type = 'info'): void {
    $result = $connect->query("SELECT user_id FROM users WHERE user_type = 'Admin' AND is_active = 1");
    if (!$result) {
        error_log('System notification admin lookup failed: ' . $connect->error);
        return;
    }

    while ($admin = $result->fetch_assoc()) {
        system_notify_user($connect, (int)$admin['user_id'], $title, $message, $type);
    }
    $result->free();
}

function system_notify_booking_contact(mysqli $connect, string $email, string $title, string $message, string $type = 'info'): void {
    $stmt = $connect->prepare("
        SELECT user_id FROM users
        WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))
          AND user_type IN ('Guest', 'Tenant') AND is_active = 1
    ");
    if (!$stmt) {
        error_log('System notification booking contact lookup failed: ' . $connect->error);
        return;
    }

    $stmt->bind_param('s', $email);
    if (!$stmt->execute()) {
        error_log('System notification booking contact lookup failed: ' . $stmt->error);
        $stmt->close();
        return;
    }

    $result = $stmt->get_result();
    while ($user = $result->fetch_assoc()) {
        system_notify_user($connect, (int)$user['user_id'], $title, $message, $type);
    }
    $stmt->close();
}

function system_notify_user_type(mysqli $connect, string $userType, string $title, string $message, string $type = 'info'): void {
    $stmt = $connect->prepare("SELECT user_id FROM users WHERE user_type = ? AND is_active = 1");
    if (!$stmt) {
        error_log('System notification recipient lookup failed: ' . $connect->error);
        return;
    }

    $stmt->bind_param('s', $userType);
    if (!$stmt->execute()) {
        error_log('System notification recipient lookup failed: ' . $stmt->error);
        $stmt->close();
        return;
    }

    $result = $stmt->get_result();
    while ($user = $result->fetch_assoc()) {
        system_notify_user($connect, (int)$user['user_id'], $title, $message, $type);
    }
    $stmt->close();
}
