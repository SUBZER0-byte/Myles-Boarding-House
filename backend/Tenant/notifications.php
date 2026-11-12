<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':         listMine(); break;
    case 'mark_read':    markRead(); break;
    case 'mark_all_read': markAllRead(); break;
    case 'unread_count': unreadCount(); break;
    case 'delete':       deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listMine() {
    global $connect;
    $uid = notificationUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function markRead() {
    global $connect;
    $id = intval($_GET['notification_id'] ?? 0);
    $uid = notificationUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $id, $uid);
    $ok = $stmt->execute();
    $stmt->close();
    rt_publish('/Tenant/notifications.php');
    echo json_encode(['type'=>$ok?'success':'error']);
}

function markAllRead() {
    global $connect;
    $uid = notificationUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?");
    $stmt->bind_param("i", $uid);
    $ok = $stmt->execute();
    $stmt->close();
    rt_publish('/Tenant/notifications.php');
    echo json_encode(['type'=>$ok?'success':'error']);
}

function unreadCount() {
    global $connect;
    $uid = notificationUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load unread notification count']);
        return;
    }
    $stmt->bind_param("i", $uid);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load unread notification count']);
        return;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>['count'=>(int)$row['cnt']]]);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['notification_id'] ?? 0);
    $uid = notificationUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("DELETE FROM notifications WHERE notification_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $id, $uid);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        rt_publish('/Tenant/notifications.php');
    }
    echo json_encode(['type'=>$ok?'success':'error']);
}

function notificationUserId(): int {
    $sessionUid = sec_current_user_id();
    return $sessionUid > 0 ? $sessionUid : intval($_GET['user_id'] ?? 0);
}
?>
