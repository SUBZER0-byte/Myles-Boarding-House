<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/refund_requests.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';

header('Content-Type: application/json');
if (!($connect instanceof mysqli)) {
    http_response_code(503);
    echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
    exit;
}

$action = $_GET['action'] ?? '';
$userId = sec_current_user_id();
$userType = sec_current_user_type();

if ($action === 'screenshot') {
    if ($userId <= 0 || $userType !== 'Admin') {
        http_response_code($userId <= 0 ? 401 : 403);
        echo json_encode(['type' => 'error', 'message' => 'Admin access required']);
        exit;
    }
    serveRefundScreenshot('screenshot_path');
    exit;
}

if ($action === 'transfer_screenshot') {
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type' => 'error', 'message' => 'Authentication required']);
        exit;
    }
    if (!ensure_refund_requests_table($connect)) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to initialize refund requests']);
        exit;
    }
    if ($userType !== 'Admin') {
        $refundId = (int)($_GET['refund_id'] ?? 0);
        $owner = $connect->prepare('SELECT 1 FROM refund_requests WHERE refund_id = ? AND user_id = ? LIMIT 1');
        if (!$owner) {
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to verify refund request ownership']);
            exit;
        }
        $owner->bind_param('ii', $refundId, $userId);
        if (!$owner->execute()) {
            $owner->close();
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to verify refund request ownership']);
            exit;
        }
        $isOwner = (bool)$owner->get_result()->fetch_assoc();
        $owner->close();
        if (!$isOwner) {
            http_response_code(403);
            echo json_encode(['type' => 'error', 'message' => 'Refund request access denied']);
            exit;
        }
    }
    serveRefundScreenshot('transfer_screenshot_path');
    exit;
}

if ($userId <= 0) {
    http_response_code(401);
    echo json_encode(['type' => 'error', 'message' => 'Authentication required']);
    exit;
}

if (!ensure_refund_requests_table($connect)) {
    http_response_code(500);
    echo json_encode(['type' => 'error', 'message' => 'Unable to initialize refund requests']);
    exit;
}

switch ($action) {
    case 'eligible':
        eligiblePayments($userId, $userType);
        break;
    case 'mine':
        myRefundRequests($userId);
        break;
    case 'submit':
        submitRefundRequest($userId, $userType);
        break;
    case 'admin_list':
        if ($userType !== 'Admin') {
            http_response_code(403);
            echo json_encode(['type' => 'error', 'message' => 'Admin access required']);
            exit;
        }
        adminRefundRequests();
        break;
    case 'decide':
        if ($userType !== 'Admin') {
            http_response_code(403);
            echo json_encode(['type' => 'error', 'message' => 'Admin access required']);
            exit;
        }
        decideRefundRequest($userId);
        break;
    default:
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

function paymentOwnershipClause(string $userType): ?array {
    if ($userType === 'Tenant') {
        return [
            "p.tenant_id = (SELECT t.tenant_id FROM tenants t WHERE t.user_id = ? AND t.is_active = 1 LIMIT 1)",
            'i',
        ];
    }
    if ($userType === 'Guest') {
        return [
            "p.booking_id IN (SELECT b.booking_id FROM bookings b INNER JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)) WHERE u.user_id = ?)",
            'i',
        ];
    }
    return null;
}

function eligiblePayments(int $userId, string $userType): void {
    global $connect;
    /** @var mysqli $connect */
    $ownership = paymentOwnershipClause($userType);
    if ($ownership === null) {
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Tenant or guest access required']);
        return;
    }

    $paymentFilter = (int)($_GET['payment_id'] ?? 0);
    $bookingFilter = (int)($_GET['booking_id'] ?? 0);
    $rentPeriodEligibility = $userType === 'Tenant' ? "
          AND p.due_date IS NOT NULL
          AND CURDATE() < LEAST(
              DATE_ADD(p.due_date, INTERVAL 1 MONTH),
              COALESCE(b.check_out_date, t.move_out_date, DATE_ADD(p.due_date, INTERVAL 1 MONTH))
          )
    " : '';
    $sql = "
        SELECT p.payment_id, p.booking_id, p.amount, p.due_date, p.paid_at,
               p.method, p.reference_number, p.description, p.payment_type,
               COALESCE((
                   SELECT SUM(r.refund_amount)
                   FROM refund_requests r
                   WHERE r.payment_id = p.payment_id AND r.status = 'Approved'
               ), 0) AS refunded_amount,
               EXISTS (
                   SELECT 1 FROM refund_requests pending
                   WHERE pending.payment_id = p.payment_id AND pending.status = 'Pending'
               ) AS has_pending_request,
               COALESCE(b.full_name, t.full_name) AS payer_name
        FROM payments p
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        WHERE {$ownership[0]}
          AND p.status IN ('Confirmed','Paid')
          {$rentPeriodEligibility}
          AND (? = 0 OR p.payment_id = ?)
          AND (? = 0 OR p.booking_id = ?)
          AND p.amount > COALESCE((
              SELECT SUM(r.refund_amount)
              FROM refund_requests r
              WHERE r.payment_id = p.payment_id AND r.status = 'Approved'
          ), 0)
        ORDER BY COALESCE(p.paid_at, p.due_date) DESC, p.payment_id DESC
    ";
    $stmt = $connect->prepare($sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load eligible payments']);
        return;
    }
    $stmt->bind_param('iiiii', $userId, $paymentFilter, $paymentFilter, $bookingFilter, $bookingFilter);
    $stmt->execute();
    $rows = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $row['remaining_amount'] = max(0, (float)$row['amount'] - (float)$row['refunded_amount']);
        $rows[] = $row;
    }
    $stmt->close();
    echo json_encode(['type' => 'success', 'data' => $rows]);
}

function myRefundRequests(int $userId): void {
    global $connect;
    /** @var mysqli $connect */
    $stmt = $connect->prepare("
        SELECT r.refund_id, r.payment_id, r.refund_amount, r.gcash_account_name,
               r.gcash_number, r.transaction_reference,
               r.transfer_reference, r.transfer_screenshot_path,
               r.screenshot_path, r.reason, r.status, r.admin_note, r.created_at,
               p.amount AS payment_amount, p.method, p.reference_number,
               p.description, p.due_date, p.booking_id,
               COALESCE(b.room_id, t.room_id) AS room_id
        FROM refund_requests r
        INNER JOIN payments p ON p.payment_id = r.payment_id
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load refund requests']);
        return;
    }
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $rows = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    $stmt->close();
    echo json_encode(['type' => 'success', 'data' => $rows]);
}

function saveRefundScreenshot(array $file): array {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return [null, 'Screenshot upload failed'];
    }
    if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > 5 * 1024 * 1024) {
        return [null, 'Screenshot must be 5MB or smaller'];
    }
    $info = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $info ? finfo_file($info, (string)($file['tmp_name'] ?? '')) : false;
    if ($info) finfo_close($info);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!is_string($mime) || !isset($extensions[$mime])) {
        return [null, 'Screenshot must be JPG, PNG, or WEBP'];
    }

    $directory = __DIR__ . '/../uploads/refunds/';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        return [null, 'Unable to create screenshot upload folder'];
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    if (!move_uploaded_file((string)$file['tmp_name'], $directory . $filename)) {
        return [null, 'Unable to save screenshot'];
    }
    return ['refunds/' . $filename, null];
}

function submitRefundRequest(int $userId, string $userType): void {
    global $connect;
    /** @var mysqli $connect */
    $ownership = paymentOwnershipClause($userType);
    if ($ownership === null) {
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Tenant or guest access required']);
        return;
    }

    $paymentId = (int)($_POST['payment_id'] ?? 0);
    $gcashAccountName = trim((string)($_POST['gcash_account_name'] ?? ''));
    $gcashNumber = trim((string)($_POST['gcash_number'] ?? ''));
    $transactionReference = trim((string)($_POST['transaction_reference'] ?? ''));
    $reason = trim((string)($_POST['reason'] ?? ''));
    if ($paymentId <= 0 || $gcashAccountName === '' || strlen($gcashAccountName) > 120
        || $gcashNumber === '' || strlen($gcashNumber) > 30
        || strlen($transactionReference) > 120 || strlen($reason) > 2000) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter a valid GCash account name and number']);
        return;
    }

    $screenshotPath = null;
    if (isset($_FILES['screenshot']) && (int)($_FILES['screenshot']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        [$screenshotPath, $uploadError] = saveRefundScreenshot($_FILES['screenshot']);
        if ($uploadError !== null) {
            http_response_code(400);
            echo json_encode(['type' => 'error', 'message' => $uploadError]);
            return;
        }
    }

    $connect->begin_transaction();
    $rentPeriodActive = $userType === 'Tenant' ? "
            (
                p.due_date IS NOT NULL
                AND CURDATE() < LEAST(
                    DATE_ADD(p.due_date, INTERVAL 1 MONTH),
                    COALESCE(b.check_out_date, t.move_out_date, DATE_ADD(p.due_date, INTERVAL 1 MONTH))
                )
            )" : "1";
    $sql = "SELECT p.amount, p.reference_number, {$rentPeriodActive} AS refund_period_active
            FROM payments p
            LEFT JOIN bookings b ON b.booking_id = p.booking_id
            LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
            WHERE p.payment_id = ? AND {$ownership[0]}
              AND p.status IN ('Confirmed','Paid')
            FOR UPDATE";
    $stmt = $connect->prepare($sql);
    if (!$stmt) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify payment']);
        return;
    }
    $stmt->bind_param('ii', $paymentId, $userId);
    $stmt->execute();
    $payment = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$payment) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Paid payment not found']);
        return;
    }
    if (!(bool)$payment['refund_period_active']) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This rent period has ended and is no longer refundable']);
        return;
    }

    $pending = $connect->prepare("SELECT 1 FROM refund_requests WHERE payment_id = ? AND status = 'Pending' LIMIT 1");
    $pending->bind_param('i', $paymentId);
    $pending->execute();
    $hasPending = (bool)$pending->get_result()->fetch_assoc();
    $pending->close();
    if ($hasPending) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'A refund request for this payment is already pending']);
        return;
    }

    if ($transactionReference === '' && trim((string)$payment['reference_number']) === '' && $screenshotPath === null) {
        $connect->rollback();
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Provide a transaction number or GCash payment screenshot']);
        return;
    }

    $refunded = $connect->prepare("SELECT COALESCE(SUM(refund_amount), 0) AS total FROM refund_requests WHERE payment_id = ? AND status = 'Approved'");
    $refunded->bind_param('i', $paymentId);
    $refunded->execute();
    $alreadyRefunded = (float)($refunded->get_result()->fetch_assoc()['total'] ?? 0);
    $refunded->close();
    $refundAmount = round(max(0, (float)$payment['amount'] - $alreadyRefunded), 2);
    if ($refundAmount <= 0) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This payment has no remaining refundable amount']);
        return;
    }

    $stmt = $connect->prepare("
        INSERT INTO refund_requests
            (payment_id, user_id, refund_amount, gcash_account_name, gcash_number, transaction_reference, screenshot_path, reason)
        VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''))
    ");
    $stmt->bind_param('iidsssss', $paymentId, $userId, $refundAmount, $gcashAccountName, $gcashNumber, $transactionReference, $screenshotPath, $reason);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        if ($screenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $screenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Failed to submit refund request']);
        return;
    }
    $connect->commit();
    rt_publish('/Payments/refunds.php');
    echo json_encode(['type' => 'success', 'message' => 'Refund request submitted for admin review', 'refund_amount' => $refundAmount]);
}

function adminRefundRequests(): void {
    global $connect;
    /** @var mysqli $connect */
    $stmt = $connect->prepare("
        SELECT r.refund_id, r.payment_id, r.user_id, r.refund_amount,
               r.gcash_account_name, r.gcash_number, r.transaction_reference,
               r.screenshot_path, r.transfer_reference, r.transfer_screenshot_path,
               r.reason, r.status,
               r.admin_note, r.created_at, p.amount AS payment_amount,
               p.method, p.reference_number, p.description, p.payment_type,
               p.booking_id, p.due_date, COALESCE(b.full_name, t.full_name) AS payer_name,
               COALESCE(b.email, t.email, u.email) AS payer_email,
               r.acted_at
        FROM refund_requests r
        INNER JOIN payments p ON p.payment_id = r.payment_id
        INNER JOIN users u ON u.user_id = r.user_id
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        ORDER BY CASE WHEN r.status = 'Pending' THEN 0 ELSE 1 END, r.created_at DESC
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load refund requests']);
        return;
    }
    $stmt->execute();
    $rows = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) $rows[] = $row;
    $stmt->close();
    echo json_encode(['type' => 'success', 'data' => $rows]);
}

function serveRefundScreenshot(string $column): void {
    global $connect;
    /** @var mysqli $connect */
    if (!in_array($column, ['screenshot_path', 'transfer_screenshot_path'], true)) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid screenshot type']);
        return;
    }
    $refundId = (int)($_GET['refund_id'] ?? 0);
    $stmt = $connect->prepare("SELECT {$column} AS screenshot_path FROM refund_requests WHERE refund_id = ? AND {$column} IS NOT NULL");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load screenshot']);
        return;
    }
    $stmt->bind_param('i', $refundId);
    $stmt->execute();
    $path = (string)($stmt->get_result()->fetch_assoc()['screenshot_path'] ?? '');
    $stmt->close();

    if (!preg_match('#^refunds/[a-f0-9]{32}\.(?:jpg|png|webp)$#', $path)) {
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Screenshot not found']);
        return;
    }
    $directory = realpath(__DIR__ . '/../uploads/refunds');
    $filePath = realpath(__DIR__ . '/../uploads/' . $path);
    if (!$directory || !$filePath || !is_file($filePath) || strpos($filePath, $directory . DIRECTORY_SEPARATOR) !== 0) {
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Screenshot not found']);
        return;
    }
    $info = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $info ? finfo_file($info, $filePath) : false;
    if ($info) finfo_close($info);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        http_response_code(415);
        echo json_encode(['type' => 'error', 'message' => 'Unsupported screenshot type']);
        return;
    }
    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="payment-screenshot"');
    header('Cache-Control: private, no-store');
    readfile($filePath);
}

function decideRefundRequest(int $adminId): void {
    global $connect;
    /** @var mysqli $connect */
    $isMultipart = stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
    $data = $isMultipart ? $_POST : json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) $data = [];
    $refundId = (int)($data['refund_id'] ?? 0);
    $decision = (string)($data['decision'] ?? '');
    $adminNote = trim((string)($data['admin_note'] ?? ''));
    $transferReference = trim((string)($data['transfer_reference'] ?? ''));
    if ($refundId <= 0 || !in_array($decision, ['Approved', 'Rejected'], true)
        || strlen($adminNote) > 2000 || strlen($transferReference) > 120
        || ($decision === 'Approved' && $transferReference === '')) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => $decision === 'Approved'
            ? 'Enter the GCash transfer transaction number before approving the refund'
            : 'Invalid refund decision']);
        return;
    }

    $transferScreenshotPath = null;
    $hasScreenshot = isset($_FILES['transfer_screenshot'])
        && (int)($_FILES['transfer_screenshot']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    if ($decision === 'Approved' && $hasScreenshot) {
        [$transferScreenshotPath, $uploadError] = saveRefundScreenshot($_FILES['transfer_screenshot']);
        if ($uploadError !== null || $transferScreenshotPath === null) {
            http_response_code(400);
            echo json_encode(['type' => 'error', 'message' => $uploadError ?: 'Unable to save GCash transfer screenshot']);
            return;
        }
    }
    if ($decision === 'Approved' && !ensure_gcash_transaction_references_table($connect)) {
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to validate the GCash transfer transaction number']);
        return;
    }

    if (!$connect->begin_transaction()) {
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to begin refund review']);
        return;
    }
    $lookup = $connect->prepare("SELECT payment_id FROM refund_requests WHERE refund_id = ?");
    if (!$lookup) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load refund request']);
        return;
    }
    $lookup->bind_param('i', $refundId);
    $lookup->execute();
    $requestLookup = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    if (!$requestLookup) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Pending refund request not found']);
        return;
    }
    $paymentId = (int)$requestLookup['payment_id'];
    $payment = $connect->prepare("SELECT amount FROM payments WHERE payment_id = ? FOR UPDATE");
    if (!$payment) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify payment balance']);
        return;
    }
    $payment->bind_param('i', $paymentId);
    $payment->execute();
    $paymentRow = $payment->get_result()->fetch_assoc();
    $payment->close();
    if (!$paymentRow) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Payment not found']);
        return;
    }

    $requestStmt = $connect->prepare("SELECT refund_amount FROM refund_requests WHERE refund_id = ? AND status = 'Pending' FOR UPDATE");
    if (!$requestStmt) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify refund request']);
        return;
    }
    $requestStmt->bind_param('i', $refundId);
    $requestStmt->execute();
    $request = $requestStmt->get_result()->fetch_assoc();
    $requestStmt->close();
    if (!$request) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Pending refund request not found']);
        return;
    }

    if ($decision === 'Approved') {
        $reserved = reserve_gcash_transaction_reference($connect, $transferReference);
        if ($reserved !== true) {
            $connect->rollback();
            if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
            http_response_code($reserved === false ? 409 : 500);
            echo json_encode(['type' => 'error', 'message' => $reserved === false
                ? 'This GCash transaction number has already been used'
                : 'Unable to validate the GCash transfer transaction number']);
            return;
        }
        $paymentAmount = (float)$paymentRow['amount'];
        $sum = $connect->prepare("SELECT COALESCE(SUM(refund_amount), 0) AS total FROM refund_requests WHERE payment_id = ? AND status = 'Approved'");
        if (!$sum) {
            $connect->rollback();
            if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to calculate remaining refundable balance']);
            return;
        }
        $sum->bind_param('i', $paymentId);
        $sum->execute();
        $alreadyRefunded = (float)($sum->get_result()->fetch_assoc()['total'] ?? 0);
        $sum->close();
        if ((float)$request['refund_amount'] > max(0, $paymentAmount - $alreadyRefunded)) {
            $connect->rollback();
            if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
            http_response_code(409);
            echo json_encode(['type' => 'error', 'message' => "Refund amount exceeds the payment's remaining refundable balance"]);
            return;
        }
    }

    $update = $connect->prepare("
        UPDATE refund_requests
        SET status = ?, admin_note = NULLIF(?, ''), acted_by = ?, acted_at = NOW(),
            transfer_reference = IF(? = 'Approved', ?, transfer_reference),
            transfer_screenshot_path = IF(? = 'Approved', ?, transfer_screenshot_path)
        WHERE refund_id = ? AND status = 'Pending'
    ");
    if (!$update) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to update refund request']);
        return;
    }
    $update->bind_param('ssissssi', $decision, $adminNote, $adminId, $decision, $transferReference, $decision, $transferScreenshotPath, $refundId);
    $ok = $update->execute() && $update->affected_rows === 1;
    $update->close();
    if (!$ok) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to update refund request']);
        return;
    }
    if (!$connect->commit()) {
        $connect->rollback();
        if ($transferScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $transferScreenshotPath);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to save refund decision']);
        return;
    }
    rt_publish('/Payments/refunds.php');
    echo json_encode(['type' => 'success', 'message' => 'Refund request ' . strtolower($decision)]);
}
