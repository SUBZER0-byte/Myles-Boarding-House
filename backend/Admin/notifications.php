<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':       listAll(); break;
    case 'unread_count': unreadCount(); break;
    case 'mark_read':  markRead(); break;
    case 'mark_all_read': markOwnAllRead(); break;
    case 'users':      listUsersForNotifications(); break;
    case 'send':       sendNotification(); break;
    case 'broadcast':  broadcast(); break;
    case 'delete':     deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function unreadCount(): void {
    global $connect;
    $uid = sec_current_user_id();
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
    $stmt->bind_param('i', $uid);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load unread notification count']);
        return;
    }
    $count = intval($stmt->get_result()->fetch_assoc()['cnt'] ?? 0);
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>['count'=>$count]]);
}

function currentAdminUserId(): int {
    $uid = sec_current_user_id();
    return $uid > 0 ? $uid : intval($_GET['user_id'] ?? 0);
}

function markRead(): void {
    global $connect;
    $notificationId = intval($_GET['notification_id'] ?? 0);
    $uid = currentAdminUserId();
    if ($notificationId <= 0 || $uid <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid notification']);
        return;
    }
    $stmt = $connect->prepare("UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update notification read status']);
        return;
    }
    $stmt->bind_param('ii', $notificationId, $uid);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update notification read status']);
        return;
    }
    rt_publish('/Admin/notifications.php');
    echo json_encode(['type'=>'success']);
}

function markOwnAllRead(): void {
    global $connect;
    $uid = currentAdminUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update notification read status']);
        return;
    }
    $stmt->bind_param('i', $uid);
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update notification read status']);
        return;
    }
    rt_publish('/Admin/notifications.php');
    echo json_encode(['type'=>'success']);
}

function listUsersForNotifications() {
    global $connect;
    $res = $connect->query("SELECT user_id, username, full_name, user_type, email FROM users WHERE is_active = 1 AND user_type != 'Admin' ORDER BY user_type ASC, full_name ASC, username ASC");
    $rows = [];
    while ($r = $res->fetch_assoc()) {
        $rows[] = [
            'user_id' => (int) ($r['user_id'] ?? 0),
            'username' => $r['username'] ?? null,
            'full_name' => $r['full_name'] ?? null,
            'user_type' => $r['user_type'] ?? null,
            'email' => $r['email'] ?? null,
            'label' => trim(($r['full_name'] ?? '') . ' ' . ($r['username'] ?? '')) ?: ('#' . ($r['user_id'] ?? '')),
        ];
    }
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function listAll() {
    global $connect;
    $uid = currentAdminUserId();
    if ($uid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }

    $stmt = $connect->prepare("
        SELECT n.*, u.username FROM notifications n
        LEFT JOIN users u ON u.user_id = n.user_id
        WHERE n.user_id = ?
        ORDER BY n.created_at DESC LIMIT 200
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load notifications']);
        return;
    }

    $stmt->bind_param('i', $uid);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load notifications']);
        return;
    }

    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function sendNotification() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    $uid = intval($d['user_id'] ?? 0);

    if ($uid <= 0) {
        echo json_encode(['type'=>'error','message'=>'Please select a recipient user.']);
        return;
    }

    $check = $connect->prepare("SELECT user_id FROM users WHERE user_id = ? LIMIT 1");
    if (!$check) {
        echo json_encode(['type'=>'error','message'=>'Unable to validate recipient.']);
        return;
    }
    $check->bind_param('i', $uid);
    $check->execute();
    $user = $check->get_result()->fetch_assoc();
    $check->close();

    if (!$user) {
        echo json_encode(['type'=>'error','message'=>'Selected user does not exist.']);
        return;
    }

    $title = trim((string) ($d['title'] ?? ''));
    $message = trim((string) ($d['message'] ?? ''));
    if ($title === '' || $message === '') {
        echo json_encode(['type'=>'error','message'=>'Title and message are required.']);
        return;
    }

    $type = in_array((string) ($d['type'] ?? 'info'), ['info', 'warning', 'success', 'error'], true)
        ? (string) $d['type']
        : 'info';

    $stmt = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, NOW())
    ");
    $stmt->bind_param("isss", $uid, $title, $message, $type);
    $ok = $stmt->execute();
    $stmt->close();
    rt_publish('/Admin/notifications.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Sent':'Failed']);
}

function broadcast() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $type = $d['type'] ?? 'info';
    $user_type = $d['user_type'] ?? 'Tenant';

    $users = $connect->prepare("SELECT user_id FROM users WHERE user_type = ? AND is_active = 1");
    $users->bind_param("s", $user_type);
    $users->execute();
    $res = $users->get_result();

    $insert = $connect->prepare("
        INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, NOW())
    ");
    $count = 0;
    while ($u = $res->fetch_assoc()) {
        $uid = $u['user_id'];
        $insert->bind_param("isss", $uid, $d['title'], $d['message'], $type);
        if ($insert->execute()) $count++;
    }
    $users->close();
    $insert->close();
    rt_publish('/Admin/notifications.php');
    echo json_encode(['type'=>'success','message'=>"Sent to $count users"]);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['notification_id'] ?? 0);
    $uid = currentAdminUserId();
    if ($id <= 0 || $uid <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid notification']);
        return;
    }
    $stmt = $connect->prepare("DELETE FROM notifications WHERE notification_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $id, $uid);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        rt_publish('/Admin/notifications.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
