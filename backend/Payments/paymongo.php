<?php
include '../Config/db.php';
include '../Config/header.php';

header('Content-Type: application/json');

$config = require __DIR__ . '/../Config/paymongo.php';
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'create_source':   createSource($config); break;
    case 'retrieve_source': retrieveSource($config); break;
    case 'create_payment':  createPayment($config); break;
    case 'retrieve_payment': retrievePayment($config); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

/**
 * Low-level cURL helper for PayMongo. Auth is HTTP Basic with the configured secret key as username.
 */
function pm_request(array $config, string $method, string $path, array $body = null) {
    $apiBase = rtrim((string)($config['api_base'] ?? 'https://api.paymongo.com/v1'), '/');
    $secretKey = trim((string)($config['secret_key'] ?? ''));

    if ($secretKey === '') {
        return [
            'status' => 401,
            'body' => ['errors' => [['detail' => 'PayMongo secret key is not configured.']]],
            'error' => 'Missing PayMongo secret key',
        ];
    }

    $ch = curl_init($apiBase . $path);
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
        'Authorization: Basic ' . base64_encode($secretKey . ':'),
    ];
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [
        'status' => $code,
        'body'   => $raw ? json_decode($raw, true) : null,
        'error'  => $err,
    ];
}

/**
 * Create a Source for GCash or PayMaya (Maya).
 * Body: { amount (PHP), type: 'gcash'|'paymaya', booking_ref?: string }
 * Returns: { checkout_url, source_id, status }
 */
function createSource(array $config) {
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    $amount  = floatval($d['amount'] ?? 0);
    $type    = strtolower($d['type'] ?? 'gcash');
    if (!in_array($type, ['gcash','paymaya'], true)) {
        echo json_encode(['type'=>'error','message'=>'Invalid payment type']); return;
    }
    if ($amount < 20) { // PayMongo min is ₱20
        echo json_encode(['type'=>'error','message'=>'Amount must be at least ₱20']); return;
    }

    $payload = [
        'data' => [
            'attributes' => [
                'amount'    => intval(round($amount * 100)), // centavos
                'redirect'  => [
                    'success' => $config['success_url'],
                    'failed'  => $config['failed_url'],
                ],
                'type'     => $type,
                'currency' => 'PHP',
            ],
        ],
    ];

    $res = pm_request($config, 'POST', '/sources', $payload);
    if ($res['status'] >= 200 && $res['status'] < 300 && !empty($res['body']['data'])) {
        $src = $res['body']['data'];
        echo json_encode([
            'type'         => 'success',
            'source_id'    => $src['id'],
            'status'       => $src['attributes']['status'] ?? 'pending',
            'checkout_url' => $src['attributes']['redirect']['checkout_url'] ?? null,
        ]);
        return;
    }
    echo json_encode([
        'type' => 'error',
        'message' => $res['body']['errors'][0]['detail'] ?? ('PayMongo error ('.$res['status'].')'),
        'debug' => $res['body'],
    ]);
}

/** Get source status. Used by the frontend to poll after redirect. */
function retrieveSource(array $config) {
    $id = $_GET['source_id'] ?? '';
    if (!$id) { echo json_encode(['type'=>'error','message'=>'source_id required']); return; }
    $res = pm_request($config, 'GET', '/sources/' . urlencode($id));
    if ($res['status'] >= 200 && $res['status'] < 300) {
        $src = $res['body']['data'];
        echo json_encode([
            'type'   => 'success',
            'status' => $src['attributes']['status'] ?? 'unknown', // pending|chargeable|paid|cancelled|expired|failed
            'source' => $src,
        ]);
        return;
    }
    echo json_encode(['type'=>'error','message'=>'Failed to retrieve source','debug'=>$res['body']]);
}

/**
 * Once the source is "chargeable", create the actual Payment to capture the funds.
 * Body: { source_id, amount, description? }
 */
function createPayment(array $config) {
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    $source_id = $d['source_id'] ?? '';
    $amount    = floatval($d['amount'] ?? 0);
    $desc      = $d['description'] ?? 'Myles Boarding House reservation';
    if (!$source_id || $amount < 20) {
        echo json_encode(['type'=>'error','message'=>'source_id and valid amount required']); return;
    }

    $payload = [
        'data' => [
            'attributes' => [
                'amount'      => intval(round($amount * 100)),
                'currency'    => 'PHP',
                'description' => $desc,
                'source'      => ['id' => $source_id, 'type' => 'source'],
            ],
        ],
    ];

    $res = pm_request($config, 'POST', '/payments', $payload);
    if ($res['status'] >= 200 && $res['status'] < 300 && !empty($res['body']['data'])) {
        $p = $res['body']['data'];
        echo json_encode([
            'type'       => 'success',
            'payment_id' => $p['id'],
            'status'     => $p['attributes']['status'] ?? 'unknown',
            'reference'  => $p['attributes']['external_reference_number'] ?? $p['id'],
        ]);
        return;
    }
    echo json_encode([
        'type' => 'error',
        'message' => $res['body']['errors'][0]['detail'] ?? 'Payment failed',
        'debug' => $res['body'],
    ]);
}

function retrievePayment(array $config) {
    $id = $_GET['payment_id'] ?? '';
    if (!$id) {
        echo json_encode(['type'=>'error','message'=>'payment_id required']); return;
    }

    $res = pm_request($config, 'GET', '/payments/' . urlencode($id));
    if ($res['status'] >= 200 && $res['status'] < 300 && !empty($res['body']['data'])) {
        $p = $res['body']['data'];
        echo json_encode([
            'type'      => 'success',
            'status'    => $p['attributes']['status'] ?? 'unknown',
            'payment'   => $p,
            'reference' => $p['attributes']['external_reference_number'] ?? $p['id'],
        ]);
        return;
    }

    echo json_encode(['type'=>'error','message'=>'Failed to retrieve payment','debug'=>$res['body']]);
}
