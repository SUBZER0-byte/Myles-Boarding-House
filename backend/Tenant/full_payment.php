<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/tenant_session.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';
require_once __DIR__ . '/../Config/refund_requests.php';
require_once __DIR__ . '/../Config/payment_proofs.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/log_helper.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';

header('Content-Type: application/json');
if (!($connect instanceof mysqli)) {
    http_response_code(503);
    echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
    exit;
}
[$userId, $tenantId] = requireTenantSession();

if (!ensure_full_payment_requests_table($connect)
    || !ensure_refund_requests_table($connect)
    || !ensure_gcash_transaction_references_table($connect)) {
    http_response_code(500);
    echo json_encode(['type' => 'error', 'message' => 'Unable to initialize full payment request storage']);
    exit;
}

switch ($_GET['action'] ?? '') {
    case 'preview':
        fullPaymentPreview($tenantId);
        break;
    case 'request':
        fullPaymentRequest($userId, $tenantId);
        break;
    case 'current':
        fullPaymentCurrent($tenantId);
        break;
    case 'qr':
        serveTenantFullPaymentQr($tenantId);
        break;
    case 'submit_proof':
        submitFullPaymentProof($userId, $tenantId);
        break;
    case 'cancel':
        cancelFullPaymentRequest($userId, $tenantId);
        break;
    default:
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

function fullPaymentInstallments(int $tenantId, bool $lockRows = false): array {
    global $connect;
    /** @var mysqli $connect */
    $sql = "
        SELECT p.payment_id, p.amount, p.due_date, p.description, p.status
        FROM payments p
        WHERE p.tenant_id = ?
          AND p.amount > 0
          AND p.status IN ('Pending','Overdue')
          AND (p.payment_type IS NULL OR p.payment_type = '' OR p.payment_type IN ('Pay Monthly','Pay One Month Rent'))
          AND NOT EXISTS (
              SELECT 1 FROM refund_requests refund
              WHERE refund.payment_id = p.payment_id AND refund.status = 'Approved'
          )
        ORDER BY p.due_date ASC, p.payment_id ASC
    ";
    if ($lockRows) $sql .= ' FOR UPDATE';
    $stmt = $connect->prepare($sql);
    if (!$stmt) {
        error_log('Full payment installment lookup prepare failed: ' . $connect->error);
        if ($lockRows) $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to calculate remaining rent installments']);
        exit;
    }
    $stmt->bind_param('i', $tenantId);
    if (!$stmt->execute()) {
        error_log('Full payment installment lookup failed: ' . $stmt->error);
        $stmt->close();
        if ($lockRows) $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to calculate remaining rent installments']);
        exit;
    }
    $rows = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $row['amount'] = (float)$row['amount'];
        $rows[] = $row;
    }
    $stmt->close();
    return $rows;
}

function fullPaymentTotal(array $installments): float {
    $subtotal = array_reduce(
        $installments,
        static fn(float $sum, array $item): float => $sum + (float)$item['amount'],
        0.0
    );
    $discountPercent = max(0.0, min(100.0, (float)FULL_PAYMENT_DISCOUNT_PERCENT));
    return round($subtotal * (1 - $discountPercent / 100), 2);
}

function fullPaymentPreview(int $tenantId): void {
    $installments = fullPaymentInstallments($tenantId);
    global $connect;
    /** @var mysqli $connect */
    $submittedStmt = $connect->prepare("
        SELECT payment_id FROM payments
        WHERE tenant_id = ? AND status = 'Submitted'
          AND (payment_type IS NULL OR payment_type = '' OR payment_type IN ('Pay Monthly','Pay One Month Rent'))
        LIMIT 1
    ");
    if (!$submittedStmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify submitted rent installments']);
        return;
    }
    $submittedStmt->bind_param('i', $tenantId);
    if (!$submittedStmt->execute()) {
        error_log('Full payment preview submitted installment lookup failed: ' . $submittedStmt->error);
        $submittedStmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify submitted rent installments']);
        return;
    }
    $hasSubmittedInstallment = (bool)$submittedStmt->get_result()->fetch_assoc();
    $submittedStmt->close();
    echo json_encode([
        'type' => 'success',
        'data' => [
            'total_amount' => fullPaymentTotal($installments),
            'installments' => $installments,
            'eligible' => count($installments) >= 2 && !$hasSubmittedInstallment,
        ],
    ]);
}

function fullPaymentRequest(int $userId, int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['type' => 'error', 'message' => 'POST required']);
        return;
    }

    $connect->begin_transaction();
    $tenantLock = $connect->prepare('SELECT tenant_id FROM tenants WHERE tenant_id = ? AND is_active = 1 FOR UPDATE');
    if (!$tenantLock) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify tenant status']);
        return;
    }
    $tenantLock->bind_param('i', $tenantId);
    if (!$tenantLock->execute()) {
        error_log('Tenant status lock failed: ' . $tenantLock->error);
        $tenantLock->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify tenant status']);
        return;
    }
    $tenantExists = (bool)$tenantLock->get_result()->fetch_assoc();
    $tenantLock->close();
    if (!$tenantExists) {
        $connect->rollback();
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Active tenant record required']);
        return;
    }

    $open = $connect->prepare("
        SELECT request_id FROM full_payment_requests
        WHERE tenant_id = ? AND status IN ('Requested','Approved','Submitted')
        LIMIT 1 FOR UPDATE
    ");
    if (!$open) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to check existing requests']);
        return;
    }
    $open->bind_param('i', $tenantId);
    if (!$open->execute()) {
        error_log('Full payment open request lookup failed: ' . $open->error);
        $open->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to check existing requests']);
        return;
    }
    $openRequest = $open->get_result()->fetch_assoc();
    $open->close();
    if ($openRequest) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'You already have an open full payment request']);
        return;
    }

    $submitted = $connect->prepare("
        SELECT payment_id FROM payments
        WHERE tenant_id = ? AND status = 'Submitted'
          AND (payment_type IS NULL OR payment_type = '' OR payment_type IN ('Pay Monthly','Pay One Month Rent'))
        LIMIT 1 FOR UPDATE
    ");
    if (!$submitted) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify pending installment submissions']);
        return;
    }
    $submitted->bind_param('i', $tenantId);
    if (!$submitted->execute()) {
        error_log('Full payment submitted installment lookup failed: ' . $submitted->error);
        $submitted->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify pending installment submissions']);
        return;
    }
    $hasSubmitted = (bool)$submitted->get_result()->fetch_assoc();
    $submitted->close();
    if ($hasSubmitted) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'A rent installment is already submitted for review. Wait for the admin decision before requesting full payment.']);
        return;
    }

    $installments = fullPaymentInstallments($tenantId, true);
    if (count($installments) < 2) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'At least two unpaid rent installments are required']);
        return;
    }
    $total = fullPaymentTotal($installments);
    if ($total <= 0) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'The full payment total must be greater than zero']);
        return;
    }

    $insert = $connect->prepare("
        INSERT INTO full_payment_requests (tenant_id, user_id, total_amount, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Requested', NOW(), NOW())
    ");
    if (!$insert) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to create full payment request']);
        return;
    }
    $insert->bind_param('iid', $tenantId, $userId, $total);
    if (!$insert->execute()) {
        error_log('Full payment request insert failed: ' . $insert->error);
        $insert->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to create full payment request']);
        return;
    }
    $requestId = (int)$insert->insert_id;
    $insert->close();

    $itemInsert = $connect->prepare('INSERT INTO full_payment_request_items (request_id, payment_id, amount) VALUES (?, ?, ?)');
    if (!$itemInsert) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to save covered installments']);
        return;
    }
    foreach ($installments as $item) {
        $paymentId = (int)$item['payment_id'];
        $amount = (float)$item['amount'];
        $itemInsert->bind_param('iid', $requestId, $paymentId, $amount);
        if (!$itemInsert->execute()) {
            error_log('Full payment request item insert failed: ' . $itemInsert->error);
            $itemInsert->close();
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to save covered installments']);
            return;
        }
    }
    $itemInsert->close();
    $connect->commit();

    system_notify_admins(
        $connect,
        'Full Payment Request',
        'Tenant #' . $tenantId . ' requested full payment of ₱' . number_format($total, 2) . '.',
        'full_payment'
    );
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_requested', "Tenant #{$tenantId} requested full payment #{$requestId} for ₱" . number_format($total, 2), $userId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment request submitted', 'data' => ['request_id' => $requestId, 'total_amount' => $total]]);
}

function fullPaymentCurrent(int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    $stmt = $connect->prepare("
        SELECT request_id, total_amount, status, qr_path, admin_note, reference_number,
               created_at, approved_at, submitted_at, confirmed_at
        FROM full_payment_requests
        WHERE tenant_id = ?
        ORDER BY request_id DESC
        LIMIT 1
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load full payment request']);
        return;
    }
    $stmt->bind_param('i', $tenantId);
    if (!$stmt->execute()) {
        error_log('Latest full payment request lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load full payment request']);
        return;
    }
    $request = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$request) {
        echo json_encode(['type' => 'success', 'data' => null]);
        return;
    }

    $requestId = (int)$request['request_id'];
    $items = $connect->prepare("
        SELECT item.payment_id, item.amount, payment.due_date, payment.description, payment.status
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
    $items->bind_param('i', $requestId);
    if (!$items->execute()) {
        error_log('Full payment request item read failed: ' . $items->error);
        $items->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load requested installments']);
        return;
    }
    $request['installments'] = $items->get_result()->fetch_all(MYSQLI_ASSOC);
    $items->close();
    $request['total_amount'] = (float)$request['total_amount'];
    $request['qr_url'] = in_array($request['status'], ['Approved','Submitted','Confirmed'], true) && !empty($request['qr_path'])
        ? '/Tenant/full_payment.php?action=qr&request_id=' . $requestId
        : null;
    unset($request['qr_path']);
    echo json_encode(['type' => 'success', 'data' => $request]);
}

function serveTenantFullPaymentQr(int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    $requestId = max(0, (int)($_GET['request_id'] ?? 0));
    $stmt = $connect->prepare("
        SELECT qr_path FROM full_payment_requests
        WHERE request_id = ? AND tenant_id = ? AND status IN ('Approved','Submitted','Confirmed')
        LIMIT 1
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load QR image']);
        return;
    }
    $stmt->bind_param('ii', $requestId, $tenantId);
    if (!$stmt->execute()) {
        error_log('Full payment QR lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load QR image']);
        return;
    }
    $path = (string)($stmt->get_result()->fetch_assoc()['qr_path'] ?? '');
    $stmt->close();
    serveFullPaymentImage($path, 'full_payment_qr');
}

function serveFullPaymentImage(string $path, string $directoryName): void {
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

function submitFullPaymentProof(int $userId, int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['type' => 'error', 'message' => 'POST required']);
        return;
    }
    $requestId = (int)($_POST['request_id'] ?? 0);
    $reference = trim((string)($_POST['reference_number'] ?? ''));
    if ($requestId <= 0 || $reference === '' || strlen($reference) > 120) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter a valid GCash transaction number']);
        return;
    }
    if (!isset($_FILES['screenshot'])) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Upload a GCash payment screenshot']);
        return;
    }
    [$screenshotPath, $uploadError] = store_payment_screenshot($_FILES['screenshot']);
    if ($uploadError !== null || $screenshotPath === null) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => $uploadError ?: 'Unable to save GCash screenshot']);
        return;
    }

    $connect->begin_transaction();
    $requestStmt = $connect->prepare("
        SELECT request_id FROM full_payment_requests
        WHERE request_id = ? AND tenant_id = ? AND status = 'Approved'
        FOR UPDATE
    ");
    if (!$requestStmt) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    $requestStmt->bind_param('ii', $requestId, $tenantId);
    if (!$requestStmt->execute()) {
        error_log('Full payment proof request lock failed: ' . $requestStmt->error);
        $requestStmt->close();
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify full payment request']);
        return;
    }
    $request = $requestStmt->get_result()->fetch_assoc();
    $requestStmt->close();
    if (!$request) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This full payment request is not awaiting proof']);
        return;
    }

    $reserved = reserve_gcash_transaction_reference($connect, $reference);
    if ($reserved !== true) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code($reserved === false ? 409 : 500);
        echo json_encode(['type' => 'error', 'message' => $reserved === false
            ? 'This GCash reference has already been submitted'
            : 'Unable to validate the GCash transaction number']);
        return;
    }

    $update = $connect->prepare("
        UPDATE full_payment_requests
        SET status = 'Submitted', reference_number = ?, screenshot_path = ?,
            submitted_at = NOW(), updated_at = NOW()
        WHERE request_id = ? AND status = 'Approved'
    ");
    if (!$update) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to submit payment proof']);
        return;
    }
    $update->bind_param('ssi', $reference, $screenshotPath, $requestId);
    $ok = $update->execute() && $update->affected_rows === 1;
    $update->close();
    if (!$ok) {
        $connect->rollback();
        @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Request status changed; refresh and try again']);
        return;
    }
    $connect->commit();

    system_notify_admins($connect, 'Full Payment Proof Submitted', 'Tenant #' . $tenantId . ' submitted proof for full payment request #' . $requestId . '.', 'full_payment');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_proof_submitted', "Tenant #{$tenantId} submitted proof for full payment request #{$requestId}", $userId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment proof submitted for admin review']);
}

function cancelFullPaymentRequest(int $userId, int $tenantId): void {
    global $connect;
    /** @var mysqli $connect */
    $data = json_decode(file_get_contents('php://input'), true);
    $requestId = (int)($data['request_id'] ?? 0);
    if ($requestId <= 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid full payment request']);
        return;
    }
    $stmt = $connect->prepare("
        UPDATE full_payment_requests
        SET status = 'Cancelled', updated_at = NOW()
        WHERE request_id = ? AND tenant_id = ? AND status = 'Requested'
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to cancel full payment request']);
        return;
    }
    $stmt->bind_param('ii', $requestId, $tenantId);
    $executed = $stmt->execute();
    $ok = $executed && $stmt->affected_rows === 1;
    if (!$executed) error_log('Full payment request cancellation failed: ' . $stmt->error);
    $stmt->close();
    if (!$ok) {
        http_response_code($executed ? 409 : 500);
        echo json_encode(['type' => 'error', 'message' => $executed
            ? 'Only a requested full payment can be cancelled'
            : 'Unable to cancel full payment request']);
        return;
    }
    system_notify_admins($connect, 'Full Payment Request Cancelled', 'Tenant #' . $tenantId . ' cancelled full payment request #' . $requestId . '.', 'full_payment');
    rt_publish('/Tenant/full_payment.php');
    rt_publish('/Admin/full_payments.php');
    sys_log('payment', 'full_payment_cancelled', "Tenant #{$tenantId} cancelled full payment request #{$requestId}", $userId);
    echo json_encode(['type' => 'success', 'message' => 'Full payment request cancelled']);
}
