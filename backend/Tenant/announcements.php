<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list': listPublished(); break;
    case 'get':  getOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listPublished() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $res = $connect->query("
        SELECT * FROM announcements WHERE is_published = 1 ORDER BY created_at DESC
    ");
    if (!$res) {
        echo json_encode(['type'=>'error','message'=>'Failed to load announcements']);
        return;
    }
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $id = intval($_GET['announcement_id'] ?? 0);
    $stmt = $connect->prepare("SELECT * FROM announcements WHERE announcement_id = ? AND is_published = 1");
    if (!$stmt) {
        echo json_encode(['type'=>'error','message'=>'Failed to load announcement']);
        return;
    }
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}
?>
