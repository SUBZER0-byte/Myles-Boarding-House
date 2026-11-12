<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':    listAll(); break;
    case 'summary': summary(); break;
    case 'category_summary': categorySummary(); break;
    case 'moderate': moderate(); break;
    case 'reply':   reply(); break;
    case 'delete':  deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listAll() {
    global $connect;
    $res = $connect->query("
        SELECT r.*, t.full_name, t.user_id, u.profile_picture FROM ratings r
        LEFT JOIN tenants t ON t.tenant_id = r.tenant_id
        LEFT JOIN users u ON u.user_id = t.user_id
        ORDER BY r.created_at DESC
    ");
    $rows = [];
    while ($x = $res->fetch_assoc()) $rows[] = $x;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function summary() {
    global $connect;
    $res = $connect->query("
        SELECT COUNT(*) AS total,
               COALESCE(AVG(stars),0) AS average,
               SUM(stars=5) AS five,
               SUM(stars=4.5) AS four_half,
               SUM(stars=4) AS four,
               SUM(stars=3.5) AS three_half,
               SUM(stars=3) AS three,
               SUM(stars=2.5) AS two_half,
               SUM(stars=2) AS two,
               SUM(stars=1.5) AS one_half,
               SUM(stars=1) AS one
        FROM ratings WHERE moderation_status = 'Approved'
    ");
    echo json_encode(['type'=>'success','data'=>$res->fetch_assoc()]);
}

function categorySummary(): void {
    global $connect;
    $res = $connect->query("SELECT category, COUNT(*) AS total, COALESCE(AVG(stars), 0) AS average
        FROM ratings WHERE moderation_status = 'Approved' GROUP BY category ORDER BY category");
    if (!$res) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load category rating summary']);
        return;
    }
    echo json_encode(['type'=>'success','data'=>$res->fetch_all(MYSQLI_ASSOC)]);
}

function moderate(): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $ratingId = is_array($data) ? (int)($data['rating_id'] ?? 0) : 0;
    $status = is_array($data) ? (string)($data['moderation_status'] ?? '') : '';
    if ($ratingId <= 0 || !in_array($status, ['Approved', 'Hidden'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Choose Approve or Hide for a valid rating']);
        return;
    }
    $stmt = $connect->prepare('UPDATE ratings SET moderation_status = ? WHERE rating_id = ?');
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update rating moderation']);
        return;
    }
    $stmt->bind_param('si', $status, $ratingId);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update rating moderation']);
        return;
    }
    rt_publish('/Admin/ratings.php');
    rt_publish('/Landing-Page/public_info.php');
    echo json_encode(['type'=>'success','message'=>$status === 'Approved' ? 'Feedback approved' : 'Feedback hidden']);
}

function reply(): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $ratingId = is_array($data) ? (int)($data['rating_id'] ?? 0) : 0;
    $reply = is_array($data) ? trim((string)($data['admin_reply'] ?? '')) : '';
    if ($ratingId <= 0 || $reply === '' || mb_strlen($reply) > 3000) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a reply of 1 to 3,000 characters']);
        return;
    }
    $lookup = $connect->prepare('SELECT t.user_id FROM ratings r INNER JOIN tenants t ON t.tenant_id = r.tenant_id WHERE r.rating_id = ? LIMIT 1');
    if (!$lookup) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load rating']);
        return;
    }
    $lookup->bind_param('i', $ratingId);
    if (!$lookup->execute()) {
        $lookup->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load rating']);
        return;
    }
    $rating = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    if (!$rating) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Rating not found']);
        return;
    }
    $stmt = $connect->prepare('UPDATE ratings SET admin_reply = ?, replied_at = NOW() WHERE rating_id = ?');
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save reply']);
        return;
    }
    $stmt->bind_param('si', $reply, $ratingId);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save reply']);
        return;
    }
    if (!empty($rating['user_id'])) {
        system_notify_user($connect, (int)$rating['user_id'], 'Admin Replied to Your Feedback', 'The administrator replied to your rating feedback.', 'rating');
        rt_publish('/Tenant/ratings.php');
    }
    rt_publish('/Admin/ratings.php');
    echo json_encode(['type'=>'success','message'=>'Reply sent']);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['rating_id'] ?? 0);
    $stmt = $connect->prepare("DELETE FROM ratings WHERE rating_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
