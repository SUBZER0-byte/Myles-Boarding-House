<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include __DIR__ . '/../Notifications/sms_helper.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/payment_proofs.php';
require_once __DIR__ . '/../Config/payment_actions.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';

sec_require_admin();

header('Content-Type: application/json');
if (!($connect instanceof mysqli)) {
    http_response_code(503);
    echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
    exit;
}
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':
        if (!ensure_payment_proofs_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to initialize payment proof storage']);
            break;
        }
        $tenantId = max(0, (int)($_GET['tenant_id'] ?? 0));
        if ($tenantId > 0) ensureTenantStaySchedule($tenantId);
        else ensureTenantMonthlyPayments();
        listPayments();
        break;
    case 'screenshot':
        if (!ensure_payment_proofs_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to initialize payment proof storage']);
            break;
        }
        servePaymentScreenshot();
        break;
    case 'tenants':            listPaymentTenants(); break;
    case 'get':                getPayment(); break;
    case 'create':             createPayment(); break;
    case 'mark_paid':          markPaid(); break;
    case 'update_status':      markPaid(); break;
    case 'delete':             deletePayment(); break;
    case 'summary':
        $tenantId = max(0, (int)($_GET['tenant_id'] ?? 0));
        ensureTenantMonthlyPayments($tenantId > 0 ? $tenantId : null);
        summary($tenantId);
        break;
    case 'generate_next_month': generateNextMonthRent(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function getTenantAnchorDate(int $tenantId): ?string {
    global $connect;
    /** @var mysqli $connect */

    $tenantStmt = $connect->prepare("SELECT phone, email FROM tenants WHERE tenant_id = ? AND is_active = 1 LIMIT 1");
    if (!$tenantStmt) {
        return null;
    }

    $tenantStmt->bind_param('i', $tenantId);
    $tenantStmt->execute();
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();

    if (!$tenant) {
        return null;
    }

    $phone = trim((string)($tenant['phone'] ?? ''));
    $email = trim((string)($tenant['email'] ?? ''));
    if ($phone === '' && $email === '') {
        return null;
    }

    $bookingSql = "SELECT DATE(MIN(created_at)) AS anchor_date FROM bookings WHERE created_at IS NOT NULL AND (";
    $params = [];
    $types = "";
    if ($phone !== '') {
        $bookingSql .= "phone = ?";
        $params[] = $phone;
        $types .= "s";
    }
    if ($email !== '') {
        if ($params) {
            $bookingSql .= " OR ";
        }
        $bookingSql .= "email = ?";
        $params[] = $email;
        $types .= "s";
    }
    $bookingSql .= ") LIMIT 1";

    $bookingStmt = $connect->prepare($bookingSql);
    if (!$bookingStmt) {
        return null;
    }
    if ($params) {
        $bookingStmt->bind_param($types, ...$params);
    }
    $bookingStmt->execute();
    $bookingRow = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();

    return !empty($bookingRow['anchor_date']) ? $bookingRow['anchor_date'] : null;
}

function addMonthsPreservingDay(string $anchorDate, int $months): string {
    $date = new DateTimeImmutable($anchorDate);
    $target = $date->modify("+{$months} month");
    $day = min((int)$date->format('d'), (int)$target->format('t'));
    return $target->setDate((int)$target->format('Y'), (int)$target->format('n'), $day)->format('Y-m-d');
}

function ensureTenantMonthlyPayments(?int $tenantId = null, int $offsetMonths = 1): int {
    global $connect;
    /** @var mysqli $connect */

    $baseSql = "SELECT t.tenant_id, t.user_id, r.monthly_rent
                FROM tenants t
                LEFT JOIN rooms r ON r.room_id = t.room_id
                WHERE t.is_active = 1";

    $params = [];
    $types = "";
    if ($tenantId !== null) {
        $baseSql .= " AND t.tenant_id = ?";
        $params[] = $tenantId;
        $types .= "i";
    }

    $stmt = $connect->prepare($baseSql);
    if ($stmt === false) {
        return 0;
    }
    if ($params) {
        $stmt->bind_param($types, ...$params);
    }
    $stmt->execute();
    $tenants = $stmt->get_result();
    $generated = 0;

    while ($tenant = $tenants->fetch_assoc()) {
        $tenantIdValue = intval($tenant['tenant_id'] ?? 0);
        $amount = floatval($tenant['monthly_rent'] ?? 0);
        if ($tenantIdValue <= 0) continue;

        $anchorDate = getTenantAnchorDate($tenantIdValue);
        if ($anchorDate === null || $amount <= 0) {
            continue;
        }

        $targetDueDate = addMonthsPreservingDay($anchorDate, max(1, $offsetMonths));
        $exists = $connect->prepare("SELECT payment_id FROM payments WHERE tenant_id = ? AND due_date = ? LIMIT 1");
        $exists->bind_param("is", $tenantIdValue, $targetDueDate);
        $exists->execute();
        $alreadyExists = $exists->get_result()->fetch_assoc();
        $exists->close();

        if ($alreadyExists) {
            continue;
        }

        $description = 'Rent for ' . DateTimeImmutable::createFromFormat('!Y-m-d', $targetDueDate)->format('F Y');
        $insert = $connect->prepare("INSERT INTO payments (tenant_id, amount, due_date, status, description, created_at)
            VALUES (?, ?, ?, 'Pending', ?, NOW())");
        $insert->bind_param("idss", $tenantIdValue, $amount, $targetDueDate, $description);
        if ($insert->execute()) {
            $generated++;
            system_notify_user(
                $connect,
                (int)($tenant['user_id'] ?? 0),
                'Upcoming Rent Payment',
                'Your rent payment of ₱' . number_format($amount, 2) . ' is due on ' . $targetDueDate . '.',
                'payment'
            );
        }
        $insert->close();
    }

    $stmt->close();

    if ($generated > 0) {
        rt_publish('/Admin/payments.php');
        rt_publish('/Tenant/payments.php');
    }

    return $generated;
}

function generateNextMonthRent() {
    $count = ensureTenantMonthlyPayments(null, 1);
    echo json_encode([
        'type' => 'success',
        'message' => $count > 0 ? "Generated {$count} next-month rent payment(s)." : 'No new next-month rent payment was needed.',
        'count' => $count,
    ]);
}

function listPayments() {
    global $connect;
    /** @var mysqli $connect */
    $status = $_GET['status'] ?? '';
    $tenantId = max(0, (int)($_GET['tenant_id'] ?? 0));
    $sql = "SELECT p.*, t.full_name, r.room_number,
                   (proof.payment_id IS NOT NULL) AS has_payment_screenshot,
                   CASE WHEN p.status = 'Pending' AND p.due_date < CURDATE()
                        THEN 'Overdue' ELSE p.status END AS display_status
            FROM payments p
            INNER JOIN tenants t ON t.tenant_id = p.tenant_id
            LEFT JOIN rooms r ON r.room_id = t.room_id
            LEFT JOIN payment_proofs proof ON proof.payment_id = p.payment_id";
    $filters = [];
    $types = '';
    $params = [];
    if ($tenantId > 0) {
        $filters[] = 'p.tenant_id = ?';
        $types .= 'i';
        $params[] = $tenantId;
    }
    if ($status !== '') {
        $filters[] = "CASE WHEN p.status = 'Pending' AND p.due_date < CURDATE() THEN 'Overdue' ELSE p.status END = ?";
        $types .= 's';
        $params[] = $status;
    }
    if ($filters) {
        $sql .= ' WHERE ' . implode(' AND ', $filters);
    }
    $sql .= " ORDER BY p.due_date ASC, p.payment_id ASC";
    $stmt = $connect->prepare($sql);
    if ($types !== '') $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function listPaymentTenants(): void {
    global $connect;
    /** @var mysqli $connect */
    $result = $connect->query("
        SELECT t.tenant_id, t.full_name, t.email,
               COALESCE(
                   (SELECT b.move_in_date FROM bookings b
                    LEFT JOIN users u ON u.user_id = t.user_id
                    WHERE b.status <> 'Cancelled' AND (
                        (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
                        OR (u.email IS NOT NULL AND u.email <> '' AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
                        OR (t.move_in_date = b.move_in_date AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name)) AND t.phone = b.phone)
                    ) ORDER BY b.created_at DESC LIMIT 1),
                   t.move_in_date
               ) AS move_in_date,
               COALESCE(
                   (SELECT b.check_out_date FROM bookings b
                    LEFT JOIN users u ON u.user_id = t.user_id
                    WHERE b.status <> 'Cancelled' AND (
                        (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
                        OR (u.email IS NOT NULL AND u.email <> '' AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
                        OR (t.move_in_date = b.move_in_date AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name)) AND t.phone = b.phone)
                    ) ORDER BY b.created_at DESC LIMIT 1),
                   t.move_out_date
               ) AS move_out_date,
               t.is_active, r.room_number
        FROM tenants t
        LEFT JOIN rooms r ON r.room_id = t.room_id
        ORDER BY t.is_active DESC, t.full_name ASC
    ");
    if (!$result) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load tenant payment list']);
        return;
    }
    $rows = [];
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function stayMonths(DateTimeImmutable $checkIn, DateTimeImmutable $checkOut): int {
    $months = ((int)$checkOut->format('Y') - (int)$checkIn->format('Y')) * 12
        + (int)$checkOut->format('n') - (int)$checkIn->format('n');
    if ((int)$checkOut->format('j') > (int)$checkIn->format('j')) $months++;
    return max(1, $months);
}

function ensureTenantStaySchedule(int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    $stmt = $connect->prepare("
        SELECT t.tenant_id, b.booking_id,
               COALESCE(b.move_in_date, t.move_in_date) AS move_in_date,
               COALESCE(b.check_out_date, t.move_out_date) AS check_out_date,
               COALESCE(b.payment_plan, 'Pay Monthly') AS payment_plan,
               COALESCE(r.monthly_rent, tenant_room.monthly_rent) AS monthly_rent
        FROM tenants t
        LEFT JOIN users u ON u.user_id = t.user_id
        LEFT JOIN bookings b ON (
            (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
            OR (u.email IS NOT NULL AND u.email <> '' AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
            OR (t.move_in_date = b.move_in_date AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name)) AND t.phone = b.phone)
        ) AND b.status <> 'Cancelled'
        LEFT JOIN rooms r ON r.room_id = b.room_id
        LEFT JOIN rooms tenant_room ON tenant_room.room_id = t.room_id
        WHERE t.tenant_id = ?
          AND COALESCE(b.move_in_date, t.move_in_date) IS NOT NULL
          AND COALESCE(b.check_out_date, t.move_out_date) IS NOT NULL
        ORDER BY b.created_at DESC
        LIMIT 1
    ");
    if (!$stmt) {
        error_log('Admin payment schedule lookup failed: ' . $connect->error);
        return;
    }
    $stmt->bind_param('i', $tenantId);
    $stmt->execute();
    $booking = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$booking) return;

    $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$booking['move_in_date']);
    $checkOut = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$booking['check_out_date']);
    $rent = (float)$booking['monthly_rent'];
    if (!$checkIn || !$checkOut || $checkOut <= $checkIn || $rent <= 0) return;

    $plan = (string)$booking['payment_plan'];
    $months = stayMonths($checkIn, $checkOut);
    $isFull = $plan === 'Pay in Full';
    $bookingId = (int)($booking['booking_id'] ?? 0);
    $limit = $isFull ? 1 : ($plan === 'Pay One Month Rent' ? $months : $months - 1);

    for ($index = 0; $index < $limit; $index++) {
        $dueDate = addMonthsPreservingDay($checkIn->format('Y-m-d'), $index);
        if ($dueDate >= $checkOut->format('Y-m-d')) break;
        $exists = $connect->prepare("
            SELECT payment_id FROM payments
            WHERE tenant_id = ? AND (booking_id = ? OR (booking_id IS NULL AND ? = 0))
              AND due_date = ?
            LIMIT 1
        ");
        if (!$exists) {
            error_log('Admin payment schedule existence check failed: ' . $connect->error);
            return;
        }
        $exists->bind_param('iiis', $tenantId, $bookingId, $bookingId, $dueDate);
        $exists->execute();
        $alreadyExists = $exists->get_result()->fetch_assoc();
        $exists->close();
        if ($alreadyExists) continue;

        $amount = $isFull
            ? max(0, round($rent * $months - $rent, 2))
            : $rent;
        $description = $isFull
            ? 'Full stay rent after security deposit credit'
            : 'Monthly rent installment ' . ($index + 1);
        $paymentType = $plan;
        if ($bookingId > 0) {
            $insert = $connect->prepare("
                INSERT INTO payments
                    (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
                VALUES (?, ?, ?, ?, 'Pending', ?, ?, NOW())
            ");
            if (!$insert) {
                error_log('Admin payment schedule insert prepare failed: ' . $connect->error);
                return;
            }
            $insert->bind_param('iidsss', $bookingId, $tenantId, $amount, $dueDate, $description, $paymentType);
        } else {
            $insert = $connect->prepare("
                INSERT INTO payments
                    (tenant_id, amount, due_date, status, description, payment_type, created_at)
                VALUES (?, ?, ?, 'Pending', ?, ?, NOW())
            ");
            if (!$insert) {
                error_log('Admin payment schedule insert prepare failed: ' . $connect->error);
                return;
            }
            $insert->bind_param('idsss', $tenantId, $amount, $dueDate, $description, $paymentType);
        }
        if (!$insert->execute()) error_log('Admin payment schedule insert failed: ' . $insert->error);
        $insert->close();
        if ($isFull) break;
    }
}

function getPayment() {
    global $connect;
    /** @var mysqli $connect */
    $id = intval($_GET['payment_id'] ?? 0);
    $stmt = $connect->prepare("SELECT * FROM payments WHERE payment_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$row]);
}

function createPayment() {
    global $connect;
    /** @var mysqli $connect */
    $d = json_decode(file_get_contents('php://input'), true);
    $tenant_id = intval($d['tenant_id'] ?? 0);
    $amount = floatval($d['amount'] ?? 0);
    $stmt = $connect->prepare("
        INSERT INTO payments (tenant_id, amount, due_date, status, description, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
    ");
    $status = $d['status'] ?? 'Pending';
    $desc = $d['description'] ?? '';
    $stmt->bind_param("idsss", $tenant_id, $amount, $d['due_date'], $status, $desc);
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $stmt->close();
    if ($ok) {
        $tenantStmt = $connect->prepare("SELECT user_id FROM tenants WHERE tenant_id = ? LIMIT 1");
        if ($tenantStmt) {
            $tenantStmt->bind_param('i', $tenant_id);
            if ($tenantStmt->execute()) {
                $tenantUserId = (int)($tenantStmt->get_result()->fetch_assoc()['user_id'] ?? 0);
                system_notify_user(
                    $connect,
                    $tenantUserId,
                    'Rent Payment Added',
                    'A rent payment of ₱' . number_format($amount, 2) . ' is due on ' . (string)$d['due_date'] . '.',
                    'payment'
                );
            } else {
                error_log('Rent payment notification tenant lookup failed: ' . $tenantStmt->error);
            }
            $tenantStmt->close();
        } else {
            error_log('Rent payment notification tenant lookup failed: ' . $connect->error);
        }
        rt_publish('/Admin/payments.php');
        rt_publish('/Tenant/payments.php');
    }
    echo json_encode($ok
        ? ['type'=>'success','message'=>'Payment created','payment_id'=>$id]
        : ['type'=>'error','message'=>'Failed']);
}

function markPaid() {
    global $connect;
    /** @var mysqli $connect */
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['payment_id'] ?? 0);
    $status = trim((string)($d['status'] ?? 'Paid'));
    $method = trim((string)($d['method'] ?? 'Cash'));
    $reference = trim((string)($d['reference'] ?? ''));
    $allowedStatuses = ['Pending', 'Overdue', 'Submitted', 'Paid', 'Rejected'];
    if ($id <= 0 || !in_array($status, $allowedStatuses, true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid payment status']);
        return;
    }
    if ($status === 'Paid' && !in_array($method, ['Cash', 'GCash'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Payment method must be Cash or GCash']);
        return;
    }
    if ($status === 'Paid' && $method === 'GCash' && $reference === '') {
        if (!ensure_payment_proofs_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to verify payment evidence']);
            return;
        }
        $proof = $connect->prepare('SELECT 1 FROM payment_proofs WHERE payment_id = ? LIMIT 1');
        if (!$proof) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to verify payment evidence']);
            return;
        }
        $proof->bind_param('i', $id);
        $proof->execute();
        $hasScreenshot = (bool)$proof->get_result()->fetch_assoc();
        $proof->close();
        if (!$hasScreenshot) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Enter a GCash transaction number or verify an uploaded screenshot']);
            return;
        }
    }

    $reserveReference = $status === 'Paid' && $method === 'GCash' && $reference !== '';
    if ($reserveReference) {
        if (!ensure_full_payment_requests_table($connect)
            || !ensure_gcash_transaction_references_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate the GCash transaction number']);
            return;
        }
        if (!$connect->begin_transaction()) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update payment status']);
            return;
        }
        $existing = $connect->prepare('SELECT reference_number FROM payments WHERE payment_id = ? FOR UPDATE');
        if (!$existing) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to verify the payment record']);
            return;
        }
        $existing->bind_param('i', $id);
        if (!$existing->execute()) {
            $existing->close();
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to verify the payment record']);
            return;
        }
        $currentReference = (string)($existing->get_result()->fetch_assoc()['reference_number'] ?? '');
        $existing->close();
        if ($currentReference !== $reference) {
            $reserved = reserve_gcash_transaction_reference($connect, $reference);
            if ($reserved !== true) {
                $connect->rollback();
                http_response_code($reserved === false ? 409 : 500);
                echo json_encode(['type'=>'error','message'=>$reserved === false
                    ? 'This GCash reference has already been submitted'
                    : 'Unable to validate the GCash transaction number']);
                return;
            }
        }
    }

    if ($status === 'Paid') {
        $ok = mark_rent_payment_paid($connect, $id, $method, $reference, null, $updated);
        if (!$ok) {
            if ($reserveReference) $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update payment status']);
            return;
        }
        if ($reserveReference && !$connect->commit()) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update payment status']);
            return;
        }
    } else {
        $stmt = $connect->prepare("
            UPDATE payments
            SET status = ?, paid_at = NULL
            WHERE payment_id = ? AND status <> 'Cancelled'
        ");
        if (!$stmt) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update payment status']);
            return;
        }
        $stmt->bind_param("si", $status, $id);
        $ok = $stmt->execute();
        $updated = $stmt->affected_rows > 0;
        $stmt->close();
    }

    if ($ok && $updated && $status === 'Paid') {
        // Look up tenant phone + amount for the SMS receipt
        $q = $connect->prepare("
            SELECT t.user_id, t.full_name, t.phone, p.amount, r.room_number
            FROM payments p
            INNER JOIN tenants t ON t.tenant_id = p.tenant_id
            LEFT JOIN rooms r ON r.room_id = t.room_id
            WHERE p.payment_id = ?
        ");
        $q->bind_param("i", $id);
        $q->execute();
        if ($row = $q->get_result()->fetch_assoc()) {
            system_notify_user(
                $connect,
                (int)$row['user_id'],
                'Rent Payment Received',
                'Your rent payment of ₱' . number_format((float)$row['amount'], 2) . ' has been recorded as paid.',
                'payment'
            );
            if (!empty($row['phone'])) {
                $amt = number_format((float)$row['amount'], 2);
                $room = $row['room_number'] ?: '—';
                sms_send($row['phone'], "Hi {$row['full_name']}, we received your payment of PHP {$amt} for Room {$room} via {$method}. Thank you! — Myle's Boarding House");
            }
        }
        $q->close();
    }

    if ($ok && $updated) {
        rt_publish('/Admin/payments.php');
        rt_publish('/Tenant/payments.php');
    }
    echo json_encode([
        'type' => $ok && $updated ? 'success' : 'error',
        'message' => $ok && $updated ? ($status === 'Paid' ? 'Payment marked as paid' : 'Payment status updated') : ($ok ? 'Payment status did not change' : 'Failed'),
    ]);
}

function servePaymentScreenshot(): void {
    global $connect;
    /** @var mysqli $connect */
    $paymentId = max(0, (int)($_GET['payment_id'] ?? 0));
    $stmt = $connect->prepare('SELECT screenshot_path FROM payment_proofs WHERE payment_id = ? LIMIT 1');
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load payment screenshot']);
        return;
    }
    $stmt->bind_param('i', $paymentId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $relativePath = (string)($row['screenshot_path'] ?? '');
    if (!preg_match('/^payment_proofs\/[a-f0-9]{32}\.(jpg|png|webp)$/', $relativePath)) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Payment screenshot not found']);
        return;
    }
    $filePath = __DIR__ . '/../uploads/' . $relativePath;
    if (!is_file($filePath)) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Payment screenshot file not found']);
        return;
    }
    $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][pathinfo($filePath, PATHINFO_EXTENSION)];
    header_remove('Content-Type');
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: private, no-store');
    readfile($filePath);
}

function deletePayment() {
    global $connect;
    /** @var mysqli $connect */
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['payment_id'] ?? 0);
    $stmt = $connect->prepare("DELETE FROM payments WHERE payment_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        rt_publish('/Admin/payments.php');
        rt_publish('/Tenant/payments.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}

function summary(int $tenantId = 0): void {
    global $connect;
    /** @var mysqli $connect */
    $sql = "
        SELECT CASE WHEN p.status = 'Pending' AND p.due_date < CURDATE()
                    THEN 'Overdue' ELSE p.status END AS status,
               COUNT(*) AS cnt, COALESCE(SUM(p.amount),0) AS total
        FROM payments p
    ";
    if ($tenantId > 0) $sql .= " WHERE p.tenant_id = " . $tenantId;
    $sql .= " GROUP BY status";
    $res = $connect->query($sql);
    $out = [];
    while ($r = $res->fetch_assoc()) $out[] = $r;
    echo json_encode(['type'=>'success','data'=>$out]);
}
?>
