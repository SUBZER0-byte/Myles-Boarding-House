<?php
/**
 * Tenant Cancellation API
 *
 * Actions:
 *   preview    — compute refund breakdown without writing (GET, user_id)
 *   request    — submit a cancellation request (POST, body: user_id)
 *   withdraw   — withdraw a pending request (POST, body: user_id, cancellation_id)
 *   my_status  — return the tenant's current active cancellation (GET, user_id)
 */
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once __DIR__ . '/../Config/log_helper.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'preview':   previewRefund();   break;
    case 'request':   requestCancellation(); break;
    case 'withdraw':  withdrawCancellation(); break;
    case 'my_status': myStatus();        break;
    default: echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

/* ── helpers ──────────────────────────────────────────────── */

function getTenantInfo(int $uid): ?array {
    global $connect;
    $stmt = $connect->prepare("
        SELECT t.tenant_id, t.room_id, t.move_in_date, t.full_name,
               r.monthly_rent, r.room_number
        FROM tenants t
        INNER JOIN rooms r ON r.room_id = t.room_id
        WHERE t.user_id = ? AND t.is_active = 1
        LIMIT 1
    ");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
}

function computeRefund(array $info, string $cancellationDate): array {
    $monthly_rent = (float)$info['monthly_rent'];
    $move_in = new DateTimeImmutable($info['move_in_date']);
    $cancel = new DateTimeImmutable($cancellationDate);

    $cycle_end = $move_in->modify('+1 month');
    $total_days = max(1, (int)$move_in->diff($cycle_end)->days);

    if ($cancel <= $move_in) {
        $days_consumed = 0;
    } elseif ($cancel >= $cycle_end) {
        $days_consumed = $total_days;
    } else {
        $days_consumed = max(0, (int)$move_in->diff($cancel)->days);
    }

    $daily_rate = round($monthly_rent / $total_days, 2);
    $amount_used = round($daily_rate * $days_consumed, 2);
    $refund_amount = round(max(0, $monthly_rent - $amount_used), 2);

    return [
        'monthly_rent'  => $monthly_rent,
        'daily_rate'    => $daily_rate,
        'days_consumed' => $days_consumed,
        'amount_used'   => $amount_used,
        'refund_amount' => $refund_amount,
    ];
}

function expirePendingRequests(?int $uid = null): void {
    global $connect;
    if ($uid) {
        $stmt = $connect->prepare("
            UPDATE cancellation_requests
            SET status = 'Expired'
            WHERE status = 'Pending'
              AND cancellation_expires_at < NOW()
              AND requested_by = ?
        ");
        $stmt->bind_param("i", $uid);
        $stmt->execute();
        $stmt->close();
        return;
    }

    $connect->query("
        UPDATE cancellation_requests
        SET status = 'Expired'
        WHERE status = 'Pending'
          AND cancellation_expires_at < NOW()
    ");
}

/* ── actions ──────────────────────────────────────────────── */

function previewRefund(): void {
    $uid  = intval($_GET['user_id'] ?? 0);
    $info = getTenantInfo($uid);
    if (!$info) {
        echo json_encode(['type' => 'error', 'message' => 'Tenant or room not found']);
        return;
    }
    $today  = (new DateTime())->format('Y-m-d');
    $refund = computeRefund($info, $today);
    $calculated_at = (new DateTimeImmutable())->format('Y-m-d H:i:s');
    echo json_encode([
        'type' => 'success',
        'data' => array_merge($info, $refund, ['cancellation_date' => $today, 'calculated_at' => $calculated_at])
    ]);
}

function requestCancellation(): void {
    global $connect;
    $d   = json_decode(file_get_contents('php://input'), true);
    $uid = intval($d['user_id'] ?? 0);
    expirePendingRequests($uid);

    $info = getTenantInfo($uid);
    if (!$info) {
        echo json_encode(['type' => 'error', 'message' => 'Tenant or room not found']);
        return;
    }

    // Check for an existing pending request
    $chk = $connect->prepare("
        SELECT cancellation_id FROM cancellation_requests
        WHERE tenant_id = ? AND status = 'Pending'
        LIMIT 1
    ");
    $chk->bind_param("i", $info['tenant_id']);
    $chk->execute();
    if ($chk->get_result()->fetch_assoc()) {
        $chk->close();
        echo json_encode(['type' => 'error', 'message' => 'You already have a pending cancellation request']);
        return;
    }
    $chk->close();

    $today  = (new DateTime())->format('Y-m-d');
    $refund = computeRefund($info, $today);
    $status = 'Pending';

    // Same-day booking cancellation should remain pending until the end of the current day.
    // This prevents a request filed on the booking day from being auto-expired immediately.
    $requestTime = new DateTimeImmutable();
    $sameDayBooking = $requestTime->format('Y-m-d') === (new DateTimeImmutable($info['move_in_date']))->format('Y-m-d');
    $expires = $sameDayBooking
        ? $requestTime->setTime(23, 59, 59)->format('Y-m-d H:i:s')
        : $requestTime->modify('+45 minutes')->format('Y-m-d H:i:s');

    $stmt = $connect->prepare("
        INSERT INTO cancellation_requests
          (tenant_id, room_id, monthly_rent, move_in_date, cancellation_date,
           daily_rate, days_consumed, amount_used, refund_amount,
           status, cancellation_expires_at, requested_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");
    $stmt->bind_param(
        "iidssddddssi",
        $info['tenant_id'],
        $info['room_id'],
        $refund['monthly_rent'],
        $info['move_in_date'],
        $today,
        $refund['daily_rate'],
        $refund['days_consumed'],
        $refund['amount_used'],
        $refund['refund_amount'],
        $status,
        $expires,
        $uid
    );
    $ok = $stmt->execute();
    $cid = $stmt->insert_id;
    $stmt->close();

    if (!$ok) {
        echo json_encode(['type' => 'error', 'message' => 'Failed to submit cancellation request']);
        return;
    }

    // Notify all admins
    $admins = $connect->query("SELECT user_id FROM users WHERE user_type = 'Admin' AND is_active = 1");
    $ins = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, 'cancellation', 0, NOW())
    ");
    $title = 'Cancellation Request';
    $msg   = "Tenant {$info['full_name']} (Room {$info['room_number']}) has requested cancellation. Refund: ₱" . number_format($refund['refund_amount'], 2);
    while ($admin = $admins->fetch_assoc()) {
        $aid = $admin['user_id'];
        $ins->bind_param("iss", $aid, $title, $msg);
        $ins->execute();
    }
    $ins->close();

    rt_publish('/Admin/notifications.php');
    rt_publish('/Admin/cancellations.php');

    sys_log(
        'cancellation',
        'cancellation_requested',
        "Tenant {$info['full_name']} requested cancellation for Room {$info['room_number']} (ID #{$cid})",
        $uid
    );

    echo json_encode([
        'type'            => 'success',
        'message'         => 'Cancellation request submitted',
        'cancellation_id' => $cid,
        'expires_at'      => $expires,
        'refund'          => $refund,
    ]);
}

function withdrawCancellation(): void {
    global $connect;
    $d   = json_decode(file_get_contents('php://input'), true);
    $uid = intval($d['user_id'] ?? 0);
    $cid = intval($d['cancellation_id'] ?? 0);
    expirePendingRequests($uid);

    $stmt = $connect->prepare("
        UPDATE cancellation_requests
        SET status = 'Withdrawn'
        WHERE cancellation_id = ? AND requested_by = ? AND status = 'Pending' AND cancellation_expires_at >= NOW()
    ");
    $stmt->bind_param("ii", $cid, $uid);
    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if (!$ok || $affected === 0) {
        echo json_encode(['type' => 'error', 'message' => 'Request not found or already processed']);
        return;
    }

    sys_log('cancellation', 'cancellation_withdrawn', "Tenant (user #{$uid}) withdrew cancellation #{$cid}", $uid);

    echo json_encode(['type' => 'success', 'message' => 'Cancellation request withdrawn']);
}

function myStatus(): void {
    global $connect;
    $uid = intval($_GET['user_id'] ?? 0);
    expirePendingRequests($uid);

    $stmt = $connect->prepare("
        SELECT cr.*, r.room_number
        FROM cancellation_requests cr
        LEFT JOIN rooms r ON r.room_id = cr.room_id
        WHERE cr.requested_by = ?
        ORDER BY cr.created_at DESC
        LIMIT 1
    ");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    echo json_encode(['type' => 'success', 'data' => $row]);
}
?>
