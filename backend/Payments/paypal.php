<?php
include '../Config/db.php';
include '../Config/header.php';
require_once __DIR__ . '/../Config/paypal.php';

header('Content-Type: application/json');

$action = $_GET['action'] ?? '';
$requestPayload = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($requestPayload)) {
    $requestPayload = [];
}

switch ($action) {
    case 'create_order':
        createPayPalOrder();
        break;
    case 'get_order':
        getPayPalOrder();
        break;
    case 'capture_order':
        capturePayPalOrder();
        break;
    default:
        echo json_encode(['type' => 'error', 'message' => 'Invalid action']);
}

function paypalRequestPayload(): array {
    global $requestPayload;
    return $requestPayload;
}

function getRequestedPayment(): ?array {
    global $connect;

    $userId = sec_current_user_id();
    if ($userId <= 0 || sec_current_user_type() !== 'Tenant') {
        http_response_code($userId > 0 ? 403 : 401);
        echo json_encode(['type' => 'error', 'message' => 'Tenant authentication is required']);
        return null;
    }

    $tenantStmt = $connect->prepare('SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1 LIMIT 1');
    if (!$tenantStmt) {
        error_log('PayPal tenant lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to verify tenant account']);
        return null;
    }
    $tenantStmt->bind_param('i', $userId);
    $tenantStmt->execute();
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();
    $tenantId = (int)($tenant['tenant_id'] ?? 0);
    if ($tenantId <= 0) {
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'Active tenant record is required']);
        return null;
    }

    $payload = paypalRequestPayload();
    $paymentId = (int)($payload['payment_id'] ?? $_GET['payment_id'] ?? 0);
    if ($paymentId <= 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Payment record is required']);
        return null;
    }

    $stmt = $connect->prepare(
        "SELECT p.payment_id, p.tenant_id, p.amount, p.status, p.description, p.due_date, p.paypal_order_id
         FROM payments p
         LEFT JOIN bookings b ON b.booking_id = p.booking_id
         LEFT JOIN tenants t ON t.tenant_id = ?
         LEFT JOIN users u ON u.user_id = t.user_id
         WHERE p.payment_id = ?
           AND (
               p.tenant_id = ?
               OR (p.booking_id IS NOT NULL AND b.booking_id = p.booking_id
                   AND b.status <> 'Cancelled'
                   AND (
                       (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
                       OR (u.email IS NOT NULL AND u.email <> '' AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
                       OR (t.move_in_date = b.move_in_date AND t.phone = b.phone
                           AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name)))
                   ))
           )
         LIMIT 1"
    );
    if (!$stmt) {
        error_log('PayPal payment lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load tenant payment']);
        return null;
    }

    $stmt->bind_param('iii', $tenantId, $paymentId, $tenantId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!is_array($row)) {
        http_response_code(404);
        echo json_encode(['type' => 'error', 'message' => 'Tenant payment record was not found']);
        return null;
    }
    return $row;
}

function createPayPalOrder(): void {
    $payment = getRequestedPayment();
    if (!$payment) {
        return;
    }

    $paymentId = (int)($payment['payment_id'] ?? 0);
    $expectedAmount = (float)($payment['amount'] ?? 0);
    $status = (string)($payment['status'] ?? '');
    if (!in_array($status, ['Pending', 'Overdue'], true)) {
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'This payment is not awaiting payment']);
        return;
    }

    $payload = paypalRequestPayload();

    $description = trim((string)($payload['description'] ?? ($payment['description'] ?? 'Rent payment')));
    if ($description === '') {
        $description = 'Myle\'s Boarding House rent payment';
    }

    $orderPayload = [
        'intent' => 'CAPTURE',
        'purchase_units' => [[
            'reference_id' => 'payment-' . $paymentId,
            'description' => $description,
            'custom_id' => (string)$paymentId,
            'amount' => [
                'currency_code' => 'PHP',
                'value' => number_format($expectedAmount, 2, '.', ''),
            ],
        ]],
        'application_context' => [
            'brand_name' => "Myle's Boarding House",
            'user_action' => 'PAY_NOW',
            'return_url' => rtrim(pp_cfg()['app_base_url'], '/') . '/payment-success',
            'cancel_url' => rtrim(pp_cfg()['app_base_url'], '/') . '/payment-failed',
        ],
    ];

    $response = pp_request('POST', '/v2/checkout/orders', $orderPayload, [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);

    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        http_response_code(502);
        error_log('PayPal order creation failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        echo json_encode([
            'type' => 'error',
            'message' => 'PayPal order could not be created',
        ]);
        return;
    }

    $approveUrl = '';
    foreach (($response['data']['links'] ?? []) as $link) {
        if (in_array(($link['rel'] ?? ''), ['approve', 'payer-action'], true)) {
            $approveUrl = (string)($link['href'] ?? '');
            break;
        }
    }

    if ($approveUrl === '') {
        http_response_code(502);
        echo json_encode(['type' => 'error', 'message' => 'PayPal approval link was not returned']);
        return;
    }

    $orderId = (string)($response['data']['id'] ?? '');
    if ($orderId === '') {
        http_response_code(502);
        echo json_encode(['type' => 'error', 'message' => 'PayPal did not return an order reference']);
        return;
    }

    global $connect;
    $saveOrder = $connect->prepare(
        "UPDATE payments SET paypal_order_id = ? WHERE payment_id = ? AND status IN ('Pending', 'Overdue')"
    );
    if (!$saveOrder) {
        error_log('PayPal order reference update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to prepare payment record']);
        return;
    }
    $saveOrder->bind_param('si', $orderId, $paymentId);
    $saved = $saveOrder->execute() && $saveOrder->affected_rows === 1;
    $saveOrder->close();
    if (!$saved) {
        http_response_code(409);
        echo json_encode(['type' => 'error', 'message' => 'Payment status changed; refresh your payment history']);
        return;
    }

    echo json_encode([
        'type' => 'success',
        'order_id' => $orderId,
        'approve_url' => $approveUrl,
        'currency' => 'PHP',
        'amount' => number_format($expectedAmount, 2, '.', ''),
    ]);
}

function getPayPalOrder(): void {
    $orderId = trim((string)($_GET['order_id'] ?? ''));
    if ($orderId === '') {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'order_id is required']);
        return;
    }

    $payment = getRequestedPayment();
    if (!$payment) {
        return;
    }
    if (!hash_equals((string)($payment['paypal_order_id'] ?? ''), $orderId)) {
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'PayPal order does not match this tenant payment']);
        return;
    }

    $response = pp_request('GET', '/v2/checkout/orders/' . rawurlencode($orderId), null, [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);

    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        http_response_code(502);
        error_log('PayPal order lookup failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        echo json_encode(['type' => 'error', 'message' => 'PayPal order could not be loaded']);
        return;
    }

    echo json_encode([
        'type' => 'success',
        'status' => strtoupper((string)($response['data']['status'] ?? '')),
        'order' => $response['data'],
    ]);
}

function capturePayPalOrder(): void {
    $payload = paypalRequestPayload();

    $orderId = trim((string)($payload['order_id'] ?? $_GET['order_id'] ?? ''));
    if ($orderId === '') {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'order_id is required']);
        return;
    }

    $payment = getRequestedPayment();
    if (!$payment) {
        return;
    }
    if (!hash_equals((string)($payment['paypal_order_id'] ?? ''), $orderId)) {
        http_response_code(403);
        echo json_encode(['type' => 'error', 'message' => 'PayPal order does not match this tenant payment']);
        return;
    }

    $response = pp_request('POST', '/v2/checkout/orders/' . rawurlencode($orderId) . '/capture', null, [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);

    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        http_response_code(502);
        error_log('PayPal capture failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        echo json_encode([
            'type' => 'error',
            'message' => 'PayPal capture could not be confirmed',
        ]);
        return;
    }

    $paymentStatus = strtoupper((string)($response['data']['status'] ?? ''));
    $captureId = (string)($response['data']['purchase_units'][0]['payments']['captures'][0]['id'] ?? '');
    $captureStatus = strtoupper((string)($response['data']['purchase_units'][0]['payments']['captures'][0]['status'] ?? ''));

    echo json_encode([
        'type' => 'success',
        'order_id' => $orderId,
        'status' => $paymentStatus,
        'capture_status' => $captureStatus,
        'capture_id' => $captureId,
        'amount' => $response['data']['purchase_units'][0]['payments']['captures'][0]['amount'] ?? null,
        'capture' => $response['data'],
    ]);
}
