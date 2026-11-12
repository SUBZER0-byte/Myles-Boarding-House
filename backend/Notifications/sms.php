<?php
/**
 * Public SMS endpoint (admin / app-initiated sends).
 *
 *   POST /Notifications/sms.php?action=send       { recipient, message }
 *   POST /Notifications/sms.php?action=broadcast  { recipients: [...], message }
 *   GET  /Notifications/sms.php?action=test&to=09xxxxxxxxx
 */
include '../Config/db.php';
include '../Config/header.php';
include __DIR__ . '/sms_helper.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'send':       sendOne(); break;
    case 'broadcast':  broadcast(); break;
    case 'test':       testSend(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function sendOne() {
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    $to  = trim($d['recipient'] ?? '');
    $msg = trim($d['message'] ?? '');
    if ($to === '' || $msg === '') {
        echo json_encode(['type'=>'error','message'=>'recipient and message are required', 'status' => 0]); return;
    }
    $r = sms_send($to, $msg);
    
    // Enhanced response with detailed error info
    $response = [
        'type'    => $r['ok'] ? 'success' : 'error',
        'message' => $r['ok'] ? 'SMS sent successfully' : ($r['error'] ?: 'Send failed'),
        'status'  => $r['status'],
        'status_text' => getStatusText($r['status']),
        'data'    => $r['body'],
    ];
    
    // Add detailed error info if failed
    if (!$r['ok']) {
        $response['error_details'] = [
            'status_code' => $r['status'],
            'curl_error' => $r['error'],
            'api_response' => $r['body'],
        ];
    }
    
    echo json_encode($response);
}

function getStatusText(int $code): string {
    $messages = [
        200 => 'OK - Message sent',
        400 => 'Bad Request - Invalid device ID or request format',
        401 => 'Unauthorized - Invalid or missing API key',
        404 => 'Not Found - Device not registered on account',
        429 => 'Rate Limited - Too many requests',
        500 => 'Server Error - TextBee API error',
        0   => 'No Connection - Network error',
    ];
    return $messages[$code] ?? "HTTP {$code}";
}

function broadcast() {
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    $list = $d['recipients'] ?? [];
    $msg  = trim($d['message'] ?? '');
    if (!is_array($list) || count($list) === 0 || $msg === '') {
        echo json_encode(['type'=>'error','message'=>'recipients[] and message are required', 'status' => 0]); return;
    }
    $sent = 0; $failed = 0; $details = [];
    foreach ($list as $to) {
        $r = sms_send((string)$to, $msg);
        if ($r['ok']) $sent++; else $failed++;
        $details[] = [
            'to' => $to,
            'ok' => $r['ok'],
            'status' => $r['status'],
            'status_text' => getStatusText($r['status']),
            'error' => $r['error'],
        ];
    }
    echo json_encode([
        'type'    => 'success',
        'message' => "Sent {$sent}, failed {$failed}",
        'summary' => ['sent' => $sent, 'failed' => $failed, 'total' => count($list)],
        'data'    => $details,
    ]);
}

function testSend() {
    $to = $_GET['to'] ?? '';
    if ($to === '') { echo json_encode(['type'=>'error','message'=>'to is required', 'status' => 0]); return; }
    $r = sms_send($to, "✅ Test from Myle's Boarding House. Your SMS API integration is working.");
    
    $response = [
        'type'    => $r['ok'] ? 'success' : 'error',
        'message' => $r['ok'] ? 'Test SMS sent successfully' : ($r['error'] ?: 'Send failed'),
        'status'  => $r['status'],
        'status_text' => getStatusText($r['status']),
        'data'    => $r['body'],
    ];
    
    if (!$r['ok']) {
        $response['error_details'] = [
            'status_code' => $r['status'],
            'curl_error' => $r['error'],
            'api_response' => $r['body'],
        ];
    }
    
    echo json_encode($response);
}
