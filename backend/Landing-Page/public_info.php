<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/gcash_qr.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'announcements': publicAnnouncements(); break;
    case 'reviews':       publicReviews(); break;
    case 'stats':         publicStats(); break;
    case 'house_info':    publicHouseInfo(); break;
    case 'gcash_qr':      publicGcashQr(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function publicGcashQr(): void {
    global $connect;
    if (!($connect instanceof mysqli) || !gcash_qr_ensure_amount_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load fixed GCash QR amounts']);
        return;
    }
    $dir = __DIR__ . '/../uploads/gcash_qr/';
    if (!is_dir($dir)) {
        echo json_encode(['type'=>'success','data'=>['images'=>[]]]);
        return;
    }
    $filenames = scandir($dir);
    if ($filenames === false) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load GCash QR']);
        return;
    }
    $amounts = [];
    $amountResult = $connect->query('SELECT filename, amount FROM gcash_qr_codes');
    if (!$amountResult) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load GCash QR amounts']);
        return;
    }
    while ($qr = $amountResult->fetch_assoc()) {
        $amounts[(string)$qr['filename'] ] = $qr['amount'] === null ? null : (float)$qr['amount'];
    }
    $images = [];
    foreach ($filenames as $filename) {
        $qrPath = $dir . $filename;
        if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)
            || is_link($qrPath) || !is_file($qrPath)) {
            continue;
        }
        $images[] = [
            'path' => 'uploads/gcash_qr/' . $filename,
            'amount' => $amounts[$filename] ?? null,
            'uploaded_at' => (int)(filemtime($qrPath) ?: 0),
        ];
    }
    usort($images, static fn(array $a, array $b): int => $b['uploaded_at'] <=> $a['uploaded_at']);
    echo json_encode(['type'=>'success','data'=>['images'=>$images]]);
}

function publicAnnouncements() {
    global $connect;
    $res = $connect->query("
        SELECT announcement_id, title, body, created_at
        FROM announcements WHERE is_published = 1
        ORDER BY created_at DESC LIMIT 5
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function publicReviews() {
    global $connect;
    $res = $connect->query("
        SELECT r.stars, r.category, r.comment, r.created_at, t.full_name
        FROM ratings r
        LEFT JOIN tenants t ON t.tenant_id = r.tenant_id
        WHERE r.moderation_status = 'Approved'
        ORDER BY r.created_at DESC
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function publicStats() {
    global $connect;
    $rooms = $connect->query("SELECT COUNT(*) AS c FROM rooms")->fetch_assoc();
    $available = $connect->query("SELECT COUNT(*) AS c FROM rooms WHERE status = 'Available'")->fetch_assoc();
    $tenants = $connect->query("SELECT COUNT(*) AS c FROM tenants WHERE is_active = 1")->fetch_assoc();
    $avg = $connect->query("SELECT COALESCE(AVG(stars),0) AS a FROM ratings WHERE moderation_status = 'Approved'")->fetch_assoc();
    echo json_encode(['type'=>'success','data'=>[
        'total_rooms'     => (int)$rooms['c'],
        'available_rooms' => (int)$available['c'],
        'happy_tenants'   => (int)$tenants['c'],
        'avg_rating'      => round((float)$avg['a'], 2)
    ]]);
}

function formatOfficeHoursTime(string $time): string {
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time)) {
        return '';
    }
    return date('g:i A', strtotime($time));
}

function publicHouseInfo() {
    global $connect;
    $keys = [
        'house_address_line_1',
        'house_address_line_2',
        'house_contact_phone',
        'house_contact_email',
        'house_weekday_open_time',
        'house_weekday_close_time',
        'house_weekend_open_time',
        'house_weekend_close_time',
        'house_weekend_by_appointment',
        'house_map_lat',
        'house_map_lng',
    ];
    $in = implode("','", $keys);
    $res = $connect->query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('$in')");
    $out = array_fill_keys($keys, null);
    while ($r = $res->fetch_assoc()) {
        $out[$r['setting_key']] = $r['setting_value'];
    }
    $weekdayOpen = formatOfficeHoursTime((string)($out['house_weekday_open_time'] ?? '08:00')) ?: '8:00 AM';
    $weekdayClose = formatOfficeHoursTime((string)($out['house_weekday_close_time'] ?? '18:00')) ?: '6:00 PM';
    $weekendByAppointment = in_array(
        strtolower((string)($out['house_weekend_by_appointment'] ?? '1')),
        ['1', 'true', 'yes'],
        true
    );
    $weekendOpen = formatOfficeHoursTime((string)($out['house_weekend_open_time'] ?? '08:00'));
    $weekendClose = formatOfficeHoursTime((string)($out['house_weekend_close_time'] ?? '18:00'));
    $weekdayHours = 'Weekdays: ' . $weekdayOpen . ' – ' . $weekdayClose;
    $weekendHours = $weekendByAppointment
        ? 'Weekends: By appointment'
        : 'Weekends: ' . ($weekendOpen ?: '8:00 AM') . ' – ' . ($weekendClose ?: '6:00 PM');
    echo json_encode(['type'=>'success','data'=>[
        'house_address_line_1'     => $out['house_address_line_1'] ?? 'Lerma St., Brgy. Bañadero,',
        'house_address_line_2'     => $out['house_address_line_2'] ?? 'Old Albay District, Legazpi City, Albay 4500',
        'house_contact_phone'      => $out['house_contact_phone'] ?? '+63 912 345 6789',
        'house_contact_email'      => $out['house_contact_email'] ?? 'contact@boardinghub.com',
        'house_office_hours_line_1'=> $weekdayHours,
        'house_office_hours_line_2'=> $weekendHours,
        'house_map_lat'            => $out['house_map_lat'] ?? '13.140572300741043',
        'house_map_lng'            => $out['house_map_lng'] ?? '123.729307594821',
    ]]);
}
?>
