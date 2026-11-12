<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include __DIR__ . '/../Notifications/sms_helper.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';
require_once __DIR__ . '/../Config/payment_proofs.php';
require_once __DIR__ . '/../Config/payment_actions.php';
require_once __DIR__ . '/../Config/refund_requests.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/log_helper.php';

sec_require_admin();
header('Content-Type: application/json');

if (!ensure_full_payment_requests_table($connect) || !ensure_refund_requests_table($connect)) {
    http_response_code(500);
    echo json_encode(['type' => 'error', 'message' => 'Unable to initialize full payment request storage']);
    exit;
}

switch ($_GET['action'] ?? '') {
    case 'list':
        fullPaymentAdminList();
        break;
    case 'approve':
        approveFullPaymentRequest();
        break;
    case 'reject':
        decideFullPaymentRequest('Rejected');
        break;
    case 'confirm':
        confirmFullPaymentRequest();
        break;
    case 'reject_proof':
        rejectFullPaymentProof();
        break;
    case 'screenshot':
        serveFullPaymentProof();
        break;
    default:
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

function fullPaymentAdminList(): void {
    global $connect;
    $status = trim((string)($_GET['status'] ?? ''));
    $search = trim((string)($_GET['search'] ?? ''));
    $allowedStatuses = ['Requested','Approved','Rejected','Submitted','Confirmed','Cancelled'];
    if ($status !== '' && !in_array($status, $allowedStatuses, true)) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid request status']);
        return;
    }

    $sql = "
        SELECT request.request_id, request.tenant_id, request.user_id, request.total_amount,
               request.status, request.admin_note, request.reference_number,
               request.screenshot_path, request.created_at, request.approved_at,
               request.submitted_at, request.confirmed_at, tenant.full_name,
               tenant.email, tenant.phone, room.room_number,
               (SELECT COUNT(*) FROM full_payment_request_items item_count
                WHERE item_count.request_id = request.request_id) AS installment_count
        FROM full_payment_requests request
        INNER JOIN tenants tenant ON tenant.tenant_id = request.tenant_id
        LEFT JOIN rooms room ON room.room_id = tenant.room_id
        WHERE (? = '' OR request.status = ?)
          AND (? = '' OR tenant.full_name LIKE CONCAT('%', ?, '%')
               OR tenant.email LIKE CONCAT('%', ?, '%')
               OR room.room_number LIKE CONCAT('%', ?, '%'))
        ORDER BY request.created_at DESC, request.request_id DESC
    ";
    $stmt = $connect->prepare($sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load full payment requests']);
        return;
    }
    $stmt->bind_param('ssssss', $status, $status, $search, $search, $search, $search);
    if (!$stmt->execute()) {
        error_log('Full payment request list failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load full payment requests']);
        return;
    }
    $requests = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $row['request_id'] = (int)$row['request_id'];
        $row['tenant_id'] = (int)$row['tenant_id'];
        $row['total_amount'] = (float)$row['total_amount'];
        $row['installment_count'] = (int)$row['installment_count'];
        $row['has_screenshot'] = !empty($row['screenshot_path']);
        unset($row['screenshot_path']);
        $requests[] = $row;
    }
    $stmt->close();

    $items = $connect->prepare("
        SELECT item.payment_id, item.amount, payment.due_date,
               payment.description, payment.status AS payment_status
        FROM full_payment_request_items item
        INNER JOIN payments payment ON payment.payment_id = item.payment_id
        WHERE item.request_id = ?
        ORDER BY payment.due_date ASC, item.payment_id ASC
    ");
    if (!$items) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load requested installments']);
        return;
    }
    foreach ($requests as &$request) {
        $requestId = (int)$request['request_id'];
        $items->bind_param('i', $requestId);
        if (!$items->execute()) {
            error_log('Full payment request item list failed: ' . $items->error);
            $items->close();
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to load requested installments']);
            return;
        }
        $request['installments'] = [];
        $itemResult = $items->get_result();
        while ($row = $itemResult->fetch_assoc()) {
            $row['amount'] = (float)$row['amount'];
            $row['payment_id'] = (int)$row['payment_id'];
            $request['installments'][] = $row;
        }
    }
    unset($request);
    $items->close();
    echo json_encode(['type' => 'success', 'data' => $requests]);
}

function saveFullPaymentQr(array $file): array {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return [null, 'GCash QR upload failed'];
    }
    if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > 5 * 1024 * 1024) {
        return [null, 'GCash QR image must be 5MB or smaller'];
    }
    $info = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $info ? finfo_file($info, (string)($file['tmp_name'] ?? '')) : false;
    if ($info) finfo_close($info);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!is_string($mime) || !isset($extensions[$mime])) {
        return [null, 'GCash QR image must be JPG, PNG, or WEBP'];
    }
    $directory = __DIR__ . '/../uploads/full_payment_qr/';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        return [null, 'Unable to create GCash QR upload folder'];
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    if (!move_uploaded_file((string)$file['tmp_name'], $directory . $filename)) {
        return [null, 'Unable to save GCash QR image'];
    }
    return ['full_payment_qr/' . $filename, null];
}

function lockedFullPaymentRequest(int $requestId): array|false|null {
    global $connect;
    $stmt = $connect->prepare("
        SELECT request_id, tenant_id, user_id, total_amount, status, qr_path,
               reference_number, screenshot_path
        FROM full_payment_requests
        WHERE request_id = ?
        FOR UPDATE
    ");
    if (!$stmt) {
        error_log('Full payment request lock prepare failed: ' . $connect->error);
        return false;
    }
    $stmt->bind_param('i', $requestId);
    if (!$stmt->execute()) {
        error_log('Full payment request lock failed: ' . $stmt->error);
        $stmt->close();
        return false;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
}

function lockedFullPaymentItems(int $requestId): array|false {
    global $connect;
    $stmt = $connect->prepare("
        SELECT item.payment_id, item.amount, payment.amount AS current_amount,
               payment.status, payment.payment_type, payment.description,
               EXISTS (
                   SELECT 1 FROM refund_requests refund
                   WHERE refund.payment_id = payment.payment_id AND refund.status = 'Approved'
               ) AS has_approved_refund
        FROM full_payment_request_items item
        INNER JOIN payments payment ON payment.payment_id = item.payment_id
        WHERE item.request_id = ?
        ORDER BY item.payment_id ASC
        FOR UPDATE
    ");
    if (!$stmt) {
        error_log('Full payment installments lock prepare failed: ' . $connect->error);
        return false;
    }
    $stmt->bind_param('i', $requestId);
    if (!$stmt->execute()) {
        error_log('Full payment installments lock failed: ' . $stmt->error);
        $stmt->close();
        return false;
    }
    $items = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) $items[] = $row;
    $stmt->close();
    return $items;
}

function fullPaymentSnapshotIsCurrent(array $items, float $requestTotal): bool {
    if (count($items) < 2) return false;
    $subtotal = 0.0;
    foreach ($items as $item) {
        $type = (string)($item['payment_type'] ?? '');
        if (!in_array($item['status'], ['Pending','Overdue'], true)
            || (float)$item['current_amount'] <= 0
            || abs((float)$item['amount'] - (float)$item['current_amount']) >= 0.01
            || (bool)$item['has_approved_refund']
            || !in_array($type, ['', 'Pay Monthly', 'Pay One Month Rent'], true)) {
            return false;
        }
        $subtotal += (float)$item['current_amount'];
    }
    return abs(fullPaymentAdminTotal($subtotal) - $requestTotal) < 0.01;
}

function fullPaymentAdminTotal(float $subtotal): float {
    $discountPercent = max(0.0, min(100.0, (float)FULL_PAYMENT_DISCOUNT_PERCENT));
    return round($subtotal * (1 - $discountPercent / 100), 2);
}

function approveFullPaymentRequest(): void {
    global $connect;
    $adminId = sec_current_user_id();
    $requestId = (int)($_POST['request_id'] ?? 0);
    $note = trim((string)($_POST['admin_note'] ?? ''));
    if ($requestId <= 0 || strlen($note) > 2000 || !isset($_FILES['qr_image'])) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Select a request and upload a valid GCash QR image']);
        return;
    }
    [$qrPath, $uploadError] = saveFullPaymentQr($_FILES['qr_image']);
    if ($uploadError !== null || $qrPath === null) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => $uploadError ?: 'Unable to save GCash QR image']);
        return;
    }

    $connect->begin_transaction();
    $requestId = (int)$_POST['request_id'];
    $request = lockedFullPaymentRequest($requestId);
    if ($request === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    if (!$request || $request['status'] !== 'Requested') {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $qrPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This request is no longer awaiting approval']);
        return;
    }
    $items = lockedFullPaymentItems($requestId);
    if ($items === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify covered installments']);
        return;
    }
    if (!fullPaymentSnapshotIsCurrent($items, (float)$request['total_amount'])) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $qrPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'The covered installments changed. Reject this request, then ask the tenant to submit a new one.']);
        return;
    }
    $update = $connect->prepare("
        UPDATE full_payment_requests
        SET status = 'Approved', qr_path = ?, admin_note = NULLIF(?, ''),
            approved_by = ?, approved_at = NOW(), updated_at = NOW()
        WHERE request_id = ? AND status = 'Requested'
    ");
    if (!$update) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $qrPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to approve full payment request']);
        return;
    }
    $update->bind_param('ssii', $qrPath, $note, $adminId, $requestId);
    $ok = $update->execute() && $update->affected_rows === 1;
    $update->close();
    if (!$ok) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $qrPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Request status changed; refresh and try again']);
        return;
    }
    $connect->commit();
    system_notify_user($connect, (int)$request['user_id'], 'Full Payment Approved', 'Your full payment request #' . $requestId . ' was approved. Pay the fixed amount of ₱' . number_format((float)$request['total_amount'], 2) . ' using the GCash QR in your Payments page.', 'full_payment');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_approved', "Admin #{$adminId} approved full payment request #{$requestId}", $adminId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment request approved']);
}

function decideFullPaymentRequest(string $decision): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($data['request_id'] ?? 0);
    $note = trim((string)($data['admin_note'] ?? ''));
    if ($requestId <= 0 || $note === '' || strlen($note) > 2000) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'A note is required']);
        return;
    }
    $adminId = sec_current_user_id();
    $connect->begin_transaction();
    $request = lockedFullPaymentRequest($requestId);
    if ($request === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    if (!$request || $request['status'] !== 'Requested') {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This request is no longer awaiting a decision']);
        return;
    }
    $stmt = $connect->prepare("
        UPDATE full_payment_requests
        SET status = ?, admin_note = ?, updated_at = NOW()
        WHERE request_id = ? AND status = 'Requested'
    ");
    if (!$stmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to reject full payment request']);
        return;
    }
    $stmt->bind_param('ssi', $decision, $note, $requestId);
    $ok = $stmt->execute() && $stmt->affected_rows === 1;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Request status changed; refresh and try again']);
        return;
    }
    $connect->commit();
    system_notify_user($connect, (int)$request['user_id'], 'Full Payment Request Rejected', 'Your full payment request #' . $requestId . ' was rejected. Admin note: ' . $note, 'full_payment');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_rejected', "Admin #{$adminId} rejected full payment request #{$requestId}", $adminId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment request rejected']);
}

function serveFullPaymentProof(): void {
    global $connect;
    $requestId = max(0, (int)($_GET['request_id'] ?? 0));
    $stmt = $connect->prepare("
        SELECT screenshot_path FROM full_payment_requests
        WHERE request_id = ? AND status IN ('Submitted','Confirmed')
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load payment proof']);
        return;
    }
    $stmt->bind_param('i', $requestId);
    if (!$stmt->execute()) {
        error_log('Admin full payment proof lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load payment proof']);
        return;
    }
    $path = (string)($stmt->get_result()->fetch_assoc()['screenshot_path'] ?? '');
    $stmt->close();
    serveAdminFullPaymentImage($path, 'payment_proofs');
}

function serveAdminFullPaymentImage(string $path, string $directoryName): void {
    if (!preg_match('#^' . preg_quote($directoryName, '#') . '/[a-f0-9]{32}\.(?:jpg|png|webp)$#', $path)) {
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Image not found']);
        return;
    }
    $directory = realpath(__DIR__ . '/../uploads/' . $directoryName);
    $filePath = realpath(__DIR__ . '/../uploads/' . $path);
    if (!$directory || !$filePath || !is_file($filePath) || strpos($filePath, $directory . DIRECTORY_SEPARATOR) !== 0) {
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Image not found']);
        return;
    }
    $info = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $info ? finfo_file($info, $filePath) : false;
    if ($info) finfo_close($info);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        http_response_code(415);
        echo json_encode(['type' => 'error', 'message' => 'Unsupported image type']);
        return;
    }
    header_remove('Content-Type');
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: private, no-store');
    readfile($filePath);
}

function confirmFullPaymentRequest(): void {
    global $connect;
    if (!ensure_payment_proofs_table($connect)) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to initialize payment proof storage']);
        return;
    }
    $data = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($data['request_id'] ?? 0);
    if ($requestId <= 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid full payment request']);
        return;
    }
    $adminId = sec_current_user_id();
    $connect->begin_transaction();
    $request = lockedFullPaymentRequest($requestId);
    if ($request === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    if (!$request || $request['status'] !== 'Submitted' || empty($request['screenshot_path']) || empty($request['reference_number'])) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This request has no payment proof awaiting verification']);
        return;
    }
    $items = lockedFullPaymentItems($requestId);
    if ($items === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify covered installments']);
        return;
    }
    if (!fullPaymentSnapshotIsCurrent($items, (float)$request['total_amount'])) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'A covered installment changed. Review the request before confirming.']);
        return;
    }

    $proofInsert = $connect->prepare("
        INSERT INTO payment_proofs (payment_id, screenshot_path)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE screenshot_path = VALUES(screenshot_path), uploaded_at = NOW()
    ");
    if (!$proofInsert) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to record payment proof']);
        return;
    }
    foreach ($items as $item) {
        $paymentId = (int)$item['payment_id'];
        $paymentDescription = 'Paid via full payment request #' . $requestId;
        $paymentUpdated = false;
        if (!mark_rent_payment_paid($connect, $paymentId, 'GCash', (string)$request['reference_number'], $paymentDescription, $paymentUpdated) || !$paymentUpdated) {
            $proofInsert->close();
            $connect->rollback();
            http_response_code(409);
            echo json_encode(['type' => 'error', 'message' => 'Unable to confirm every covered installment']);
            return;
        }
        $proofInsert->bind_param('is', $paymentId, $request['screenshot_path']);
        if (!$proofInsert->execute()) {
            error_log('Full payment proof record failed: ' . $proofInsert->error);
            $proofInsert->close();
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to save installment proof records']);
            return;
        }
    }
    $proofInsert->close();
    $update = $connect->prepare("
        UPDATE full_payment_requests
        SET status = 'Confirmed', confirmed_by = ?, confirmed_at = NOW(), updated_at = NOW()
        WHERE request_id = ? AND status = 'Submitted'
    ");
    if (!$update) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to confirm full payment request']);
        return;
    }
    $update->bind_param('ii', $adminId, $requestId);
    $ok = $update->execute() && $update->affected_rows === 1;
    $update->close();
    if (!$ok) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Request status changed; refresh and try again']);
        return;
    }
    $connect->commit();

    system_notify_user(
        $connect,
        (int)$request['user_id'],
        'Rent Payment Received',
        'Your full rent payment of ₱' . number_format((float)$request['total_amount'], 2) . ' has been verified and recorded as paid.',
        'payment'
    );
    $tenantInfo = $connect->prepare("
        SELECT tenant.full_name, tenant.phone, room.room_number
        FROM tenants tenant
        LEFT JOIN rooms room ON room.room_id = tenant.room_id
        WHERE tenant.tenant_id = ?
    ");
    if ($tenantInfo) {
        $tenantId = (int)$request['tenant_id'];
        $tenantInfo->bind_param('i', $tenantId);
        if (!$tenantInfo->execute()) {
            error_log('Full payment tenant details lookup failed: ' . $tenantInfo->error);
            $tenantInfo->close();
            $tenant = null;
        } else {
            $tenant = $tenantInfo->get_result()->fetch_assoc();
            $tenantInfo->close();
        }
        if ($tenant && !empty($tenant['phone'])) {
            $room = $tenant['room_number'] ?: '—';
            sms_send($tenant['phone'], "Hi {$tenant['full_name']}, we received your full rent payment of PHP " . number_format((float)$request['total_amount'], 2) . " for Room {$room} via GCash. Thank you! — Myle's Boarding House");
        }
    }
    rt_publish('/Tenant/payments.php');
    rt_publish('/Admin/payments.php');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_confirmed', "Admin #{$adminId} confirmed full payment request #{$requestId} for tenant #{$request['tenant_id']}", $adminId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment confirmed and installments marked paid']);
}

function rejectFullPaymentProof(): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($data['request_id'] ?? 0);
    $note = trim((string)($data['admin_note'] ?? ''));
    if ($requestId <= 0 || $note === '' || strlen($note) > 2000) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'A note is required']);
        return;
    }
    $adminId = sec_current_user_id();
    $connect->begin_transaction();
    $request = lockedFullPaymentRequest($requestId);
    if ($request === false) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    if (!$request || $request['status'] !== 'Submitted') {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This request is no longer awaiting proof verification']);
        return;
    }
    $oldScreenshot = (string)($request['screenshot_path'] ?? '');
    $stmt = $connect->prepare("
        UPDATE full_payment_requests
        SET status = 'Approved', admin_note = ?, reference_number = NULL,
            screenshot_path = NULL, submitted_at = NULL, updated_at = NOW()
        WHERE request_id = ? AND status = 'Submitted'
    ");
    if (!$stmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to reject payment proof']);
        return;
    }
    $stmt->bind_param('si', $note, $requestId);
    $ok = $stmt->execute() && $stmt->affected_rows === 1;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Request status changed; refresh and try again']);
        return;
    }
    $connect->commit();
    if (preg_match('#^payment_proofs/[a-f0-9]{32}\.(?:jpg|png|webp)$#', $oldScreenshot)) {
        @unlink(__DIR__ . '/../uploads/' . $oldScreenshot);
    }
    system_notify_user($connect, (int)$request['user_id'], 'Full Payment Proof Needs Correction', 'Your proof for full payment request #' . $requestId . ' was rejected. Admin note: ' . $note . ' You may upload corrected proof.', 'full_payment');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_proof_rejected', "Admin #{$adminId} rejected proof for full payment request #{$requestId}", $adminId);
    echo json_encode(['type' => 'success', 'message' => 'Proof rejected; tenant may submit corrected details']);
}
