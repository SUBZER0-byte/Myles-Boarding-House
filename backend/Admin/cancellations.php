<?php
/**
 * Admin Cancellation API
 *
 * Actions:
 *   list    — all cancellation requests with tenant + room info (GET)
 *   approve — approve a request: create refund payment, deactivate tenant, free room (POST)
 *   reject  — reject with a reason (POST)
 */
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once __DIR__ . '/../Config/log_helper.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':          listRequests(); break;
    case 'list_bookings': listCancelledBookings(); break;
    case 'process_booking_refund': processBookingRefund(); break;
    case 'approve':       approveRequest(); break;
    case 'reject':        rejectRequest();  break;
    default: echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

/* ── actions ──────────────────────────────────────────────── */

function listRequests(): void {
    global $connect;
    expirePendingRequests();
    $status = strtolower(trim((string)($_GET['status'] ?? 'Pending')));

    if ($status === 'all') {
        $stmt = $connect->prepare("
            SELECT
                cr.*,
                COALESCE(t.full_name, 'Unknown Tenant') AS tenant_name,
                COALESCE(t.email, '—') AS tenant_email,
                COALESCE(t.phone, '—') AS tenant_phone,
                COALESCE(r.room_number, '—') AS room_number
            FROM cancellation_requests cr
            LEFT JOIN tenants t ON t.tenant_id = cr.tenant_id
            LEFT JOIN rooms r ON r.room_id = cr.room_id
            ORDER BY cr.created_at DESC
        ");
        $stmt->execute();
    } else {
        $stmt = $connect->prepare("
            SELECT
                cr.*,
                COALESCE(t.full_name, 'Unknown Tenant') AS tenant_name,
                COALESCE(t.email, '—') AS tenant_email,
                COALESCE(t.phone, '—') AS tenant_phone,
                COALESCE(r.room_number, '—') AS room_number
            FROM cancellation_requests cr
            LEFT JOIN tenants t ON t.tenant_id = cr.tenant_id
            LEFT JOIN rooms r ON r.room_id = cr.room_id
            WHERE cr.status = ?
            ORDER BY cr.created_at DESC
        ");
        $stmt->bind_param("s", $status);
        $stmt->execute();
    }

    $res  = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type' => 'success', 'data' => $rows]);
}

function expirePendingRequests(): void {
    global $connect;
    $connect->query("
        UPDATE cancellation_requests
        SET status = 'Expired'
        WHERE status = 'Pending'
          AND cancellation_expires_at < NOW()
    ");
}

function approveRequest(): void {
    global $connect;
    $d      = json_decode(file_get_contents('php://input'), true);
    $cid    = intval($d['cancellation_id'] ?? 0);
    $adminId = intval($d['admin_user_id'] ?? 0);

    // Lock and fetch the request
    $stmt = $connect->prepare("
        SELECT
            cr.*,
            COALESCE(t.user_id, 0) AS tenant_user_id,
            COALESCE(t.full_name, 'Unknown Tenant') AS tenant_name,
            COALESCE(r.room_number, '—') AS room_number
        FROM cancellation_requests cr
        LEFT JOIN tenants t ON t.tenant_id = cr.tenant_id
        LEFT JOIN rooms r ON r.room_id = cr.room_id
        WHERE cr.cancellation_id = ? AND cr.status = 'Pending' AND cr.cancellation_expires_at >= NOW()
        FOR UPDATE
    ");
    $connect->begin_transaction();
    $stmt->bind_param("i", $cid);
    $stmt->execute();
    $req = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$req) {
        $connect->rollback();
        expirePendingRequests();
        echo json_encode(['type' => 'error', 'message' => 'Request not found, expired, or already processed']);
        return;
    }

    // 1. Mark the cancellation as Approved
    $upd = $connect->prepare("
        UPDATE cancellation_requests
        SET status = 'Approved', acted_by = ?, acted_at = NOW()
        WHERE cancellation_id = ?
    ");
    $upd->bind_param("ii", $adminId, $cid);
    $upd->execute(); $upd->close();

    // 2. Create refund payment record (Paid, negative description = credit)
    $desc = "Refund — Cancellation #{$cid}";
    $refund = (float)$req['refund_amount'];
    $ins = $connect->prepare("
        INSERT INTO payments (tenant_id, amount, due_date, status, description, method, paid_at, created_at)
        VALUES (?, ?, CURDATE(), 'Paid', ?, 'Refund', NOW(), NOW())
    ");
    $ins->bind_param("ids", $req['tenant_id'], $refund, $desc);
    $ins->execute(); $ins->close();

    // 3. Deactivate the tenant record and revert the user back to Guest after move-out
    $deact = $connect->prepare("UPDATE tenants SET is_active = 0 WHERE tenant_id = ?");
    $deact->bind_param("i", $req['tenant_id']);
    $deact->execute(); $deact->close();

    $roleReset = $connect->prepare("UPDATE users SET user_type = 'Guest' WHERE user_id = ? AND user_type = 'Tenant'");
    $roleReset->bind_param("i", $req['tenant_user_id']);
    $roleReset->execute(); $roleReset->close();

    // 4. Mark the room as Available
    $roomUpd = $connect->prepare("UPDATE rooms SET status = 'Available' WHERE room_id = ?");
    $roomUpd->bind_param("i", $req['room_id']);
    $roomUpd->execute(); $roomUpd->close();

    $connect->commit();

    // 5. Notify the tenant
    $tenantUserId = intval($req['tenant_user_id']);
    $notif = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, 'Cancellation Approved', ?, 'cancellation', 0, NOW())
    ");
    $notifMsg = "Your cancellation request has been approved. A refund of ₱" . number_format($refund, 2) . " has been recorded.";
    $notif->bind_param("is", $tenantUserId, $notifMsg);
    $notif->execute(); $notif->close();

    rt_publish('/Admin/notifications.php');
    rt_publish('/Tenant/cancellations.php');
    rt_publish('/Admin/rooms.php');
    rt_publish('/Admin/payments.php');

    sys_log(
        'cancellation',
        'cancellation_approved',
        "Admin approved cancellation #{$cid} for tenant {$req['tenant_name']} (Room {$req['room_number']}); refund ₱" . number_format($refund, 2),
        $adminId
    );

    echo json_encode(['type' => 'success', 'message' => 'Cancellation approved and refund recorded']);
}

function rejectRequest(): void {
    global $connect;
    $d      = json_decode(file_get_contents('php://input'), true);
    $cid    = intval($d['cancellation_id'] ?? 0);
    $reason = trim($d['rejection_reason'] ?? '');
    $adminId = intval($d['admin_user_id'] ?? 0);

    $stmt = $connect->prepare("
        SELECT
            cr.*,
            COALESCE(t.user_id, 0) AS tenant_user_id,
            COALESCE(t.full_name, 'Unknown Tenant') AS tenant_name,
            COALESCE(r.room_number, '—') AS room_number
        FROM cancellation_requests cr
        LEFT JOIN tenants t ON t.tenant_id = cr.tenant_id
        LEFT JOIN rooms r ON r.room_id = cr.room_id
        WHERE cr.cancellation_id = ? AND cr.status = 'Pending' AND cr.cancellation_expires_at >= NOW()
    ");
    $stmt->bind_param("i", $cid);
    $stmt->execute();
    $req = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$req) {
        expirePendingRequests();
        echo json_encode(['type' => 'error', 'message' => 'Request not found, expired, or already processed']);
        return;
    }

    $upd = $connect->prepare("
        UPDATE cancellation_requests
        SET status = 'Rejected', rejection_reason = ?, acted_by = ?, acted_at = NOW()
        WHERE cancellation_id = ?
    ");
    $upd->bind_param("sii", $reason, $adminId, $cid);
    $ok = $upd->execute(); $upd->close();

    if (!$ok) {
        echo json_encode(['type' => 'error', 'message' => 'Failed to reject request']);
        return;
    }

    // Notify the tenant
    $tenantUserId = intval($req['tenant_user_id']);
    $notif = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, 'Cancellation Rejected', ?, 'cancellation', 0, NOW())
    ");
    $notifMsg = "Your cancellation request was rejected." . ($reason ? " Reason: {$reason}" : "");
    $notif->bind_param("is", $tenantUserId, $notifMsg);
    $notif->execute(); $notif->close();

    rt_publish('/Admin/notifications.php');
    rt_publish('/Tenant/cancellations.php');

    sys_log(
        'cancellation',
        'cancellation_rejected',
        "Admin rejected cancellation #{$cid} for tenant {$req['tenant_name']}: {$reason}",
        $adminId
    );

    echo json_encode(['type' => 'success', 'message' => 'Cancellation rejected']);
}

function listCancelledBookings(): void {
    global $connect;
    $res = $connect->query("
        SELECT b.*, r.room_number, r.monthly_rent
        FROM bookings b
        LEFT JOIN rooms r ON r.room_id = b.room_id
        WHERE b.status = 'Cancelled'
        ORDER BY b.created_at DESC
    ");
    $rows = [];
    if ($res) {
        while ($r = $res->fetch_assoc()) $rows[] = $r;
    }
    echo json_encode(['type' => 'success', 'data' => $rows]);
}

function processBookingRefund(): void {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $bookingId = intval($d['booking_id'] ?? 0);
    $adminId = intval($d['admin_user_id'] ?? 0);
    $notes = trim((string)($d['refund_notes'] ?? ''));

    if (!$bookingId) {
        echo json_encode(['type' => 'error', 'message' => 'Missing booking_id']);
        return;
    }

    $hasRefundCols = false;
    $refundCheck = $connect->query("SHOW COLUMNS FROM bookings LIKE 'refund_status'");
    if ($refundCheck && $refundCheck->num_rows > 0) {
        $hasRefundCols = true;
    }

    if ($hasRefundCols) {
        $stmt = $connect->prepare("
            UPDATE bookings
            SET refund_status = 'Processed',
                refund_processed_at = NOW(),
                refund_processed_by = ?,
                refund_notes = ?
            WHERE booking_id = ?
              AND status = 'Cancelled'
              AND refund_status = 'Pending'
        ");
        $stmt->bind_param("isi", $adminId, $notes, $bookingId);
        $ok = $stmt->execute();
        $affected = $stmt->affected_rows;
        $stmt->close();
    } else {
        $stmt = $connect->prepare("UPDATE bookings SET status = 'Cancelled' WHERE booking_id = ? AND status = 'Cancelled'");
        $stmt->bind_param("i", $bookingId);
        $ok = $stmt->execute();
        $affected = $stmt->affected_rows;
        $stmt->close();
    }

    if (!$ok || $affected === 0) {
        echo json_encode(['type' => 'error', 'message' => 'Cancelled booking not found or refund already processed']);
        return;
    }

    sys_log('booking', 'guest_refund_processed', "Admin marked guest booking #{$bookingId} refund as processed", $adminId);
    rt_publish('/Admin/cancellations.php');
    rt_publish('/Admin/notifications.php');

    echo json_encode(['type' => 'success', 'message' => 'Guest refund marked as processed']);
}
?>
