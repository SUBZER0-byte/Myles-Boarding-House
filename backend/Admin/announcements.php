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
    case 'get':     getOne(); break;
    case 'create':  createOne(); break;
    case 'update':  updateOne(); break;
    case 'publish': togglePublish(); break;
    case 'delete':  deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listAll() {
    global $connect;
    $res = $connect->query("SELECT * FROM announcements ORDER BY created_at DESC");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getOne() {
    global $connect;
    $id = intval($_GET['announcement_id'] ?? 0);
    $stmt = $connect->prepare("SELECT * FROM announcements WHERE announcement_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function createOne() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $author = intval($d['author_id'] ?? 0);
    $pub = intval($d['is_published'] ?? 1);
    $stmt = $connect->prepare("
        INSERT INTO announcements (title, body, author_id, is_published, created_at)
        VALUES (?, ?, ?, ?, NOW())
    ");
    $stmt->bind_param("ssii", $d['title'], $d['body'], $author, $pub);
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $stmt->close();
    if ($ok && $pub === 1) {
        notifyPublishedAnnouncement($connect, (string)$d['title']);
    }
    echo json_encode($ok
        ? ['type'=>'success','message'=>'Created','announcement_id'=>$id]
        : ['type'=>'error','message'=>'Failed']);
}

function updateOne() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['announcement_id'] ?? 0);
    $stmt = $connect->prepare("UPDATE announcements SET title = ?, body = ? WHERE announcement_id = ?");
    $stmt->bind_param("ssi", $d['title'], $d['body'], $id);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function togglePublish() {
    global $connect;
    $id = intval($_GET['announcement_id'] ?? 0);
    $val = intval($_GET['is_published'] ?? 1);
    $announcementStmt = $connect->prepare("SELECT title, is_published FROM announcements WHERE announcement_id = ? LIMIT 1");
    if (!$announcementStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load announcement']);
        return;
    }
    $announcementStmt->bind_param('i', $id);
    if (!$announcementStmt->execute()) {
        $announcementStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load announcement']);
        return;
    }
    $announcement = $announcementStmt->get_result()->fetch_assoc();
    $announcementStmt->close();
    if (!$announcement) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Announcement not found']);
        return;
    }

    $stmt = $connect->prepare("UPDATE announcements SET is_published = ? WHERE announcement_id = ?");
    $stmt->bind_param("ii", $val, $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok && !(int)$announcement['is_published'] && $val === 1) {
        notifyPublishedAnnouncement($connect, (string)$announcement['title']);
    }
    rt_publish('/Admin/announcements.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function notifyPublishedAnnouncement(mysqli $connect, string $title): void {
    $message = "A new announcement is available: {$title}.";
    system_notify_user_type($connect, 'Tenant', 'New Announcement', $message, 'announcement');
    system_notify_user_type($connect, 'Guest', 'New Announcement', $message, 'announcement');
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['announcement_id'] ?? 0);
    $stmt = $connect->prepare("DELETE FROM announcements WHERE announcement_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
