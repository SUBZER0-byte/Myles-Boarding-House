<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'submit': submitRating(); break;
    case 'mine':   mine(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function tenantIdFromUser($uid) {
    global $connect;
    if (!$connect instanceof mysqli || $uid <= 0 || $uid !== sec_current_user_id() || sec_current_user_type() !== 'Tenant') return 0;
    $stmt = $connect->prepare("SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ? intval($row['tenant_id']) : 0;
}

function submitRating() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid rating data']);
        return;
    }
    $tid = tenantIdFromUser(sec_current_user_id());
    $stars = $d['stars'] ?? null;
    $category = trim((string)($d['category'] ?? ''));
    $comment = trim((string)($d['comment'] ?? ''));
    if ($tid <= 0 || !is_numeric($stars)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid tenant and rating are required']);
        return;
    }
    $stars = (float)$stars;
    if ($stars < 1 || $stars > 5 || abs($stars * 2 - round($stars * 2)) > 0.00001) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Rating must be from 1 to 5 in half-star increments']);
        return;
    }
    if (!in_array($category, ['Facilities', 'Services', 'Overall Satisfaction'], true)
        || $comment === '' || mb_strlen($comment) > 3000) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Choose a rating category and provide feedback (up to 3,000 characters)']);
        return;
    }
    $stmt = $connect->prepare("
        INSERT INTO ratings (tenant_id, category, stars, comment, moderation_status, created_at)
        VALUES (?, ?, ?, ?, 'Pending', NOW())
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save rating']);
        return;
    }
    $stmt->bind_param('isds', $tid, $category, $stars, $comment);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        system_notify_admins(
            $connect,
            'Rating Awaiting Review',
            'A tenant submitted a ' . number_format($stars, 1) . '-star rating' . ($comment !== '' ? ' with written feedback.' : '.'),
            'rating'
        );
        rt_publish('/Admin/ratings.php');
    }
    rt_publish('/Tenant/ratings.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Feedback submitted for review':'Failed']);
}

function mine() {
    global $connect;
    $tid = tenantIdFromUser(sec_current_user_id());
    if ($tid <= 0) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Tenant access required']);
        return;
    }
    $stmt = $connect->prepare("SELECT r.*, t.user_id, u.profile_picture
        FROM ratings r
        INNER JOIN tenants t ON t.tenant_id = r.tenant_id
        LEFT JOIN users u ON u.user_id = t.user_id
        WHERE r.tenant_id = ? ORDER BY r.created_at DESC");
    $stmt->bind_param("i", $tid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}
?>
