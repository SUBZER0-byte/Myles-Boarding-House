<?php
include '../Config/db.php';
include '../Config/header.php';
include_once '../Config/log_helper.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? 'list';

switch ($action) {
    case 'list':   listLogs(); break;
    case 'write':  writeLog(); break;
    case 'clear':  clearOld(); break;
    case 'delete': deleteOne(); break;
    case 'stats':  stats(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listLogs() {
    global $connect;
    $limit    = max(1, min(500, intval($_GET['limit'] ?? 200)));
    $category = $_GET['category'] ?? '';
    $level    = $_GET['level'] ?? '';
    $q        = trim($_GET['q'] ?? '');

    $sql = "SELECT l.*, u.username AS actor_username
            FROM system_logs l
            LEFT JOIN users u ON u.user_id = l.actor_id
            WHERE 1=1";
    $params = []; $types = '';
    if ($category !== '') { $sql .= " AND l.category = ?"; $params[] = $category; $types .= 's'; }
    if ($level !== '')    { $sql .= " AND l.level = ?";    $params[] = $level;    $types .= 's'; }
    if ($q !== '')        { $sql .= " AND (l.message LIKE ? OR l.action LIKE ?)"; $like = "%$q%"; $params[] = $like; $params[] = $like; $types .= 'ss'; }
    $sql .= " ORDER BY l.log_id DESC LIMIT ?";
    $params[] = $limit; $types .= 'i';

    $stmt = $connect->prepare($sql);
    if ($types) $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function writeLog() {
    $d = json_decode(file_get_contents('php://input'), true) ?: [];
    sys_log(
        $d['category'] ?? 'general',
        $d['action'] ?? 'event',
        $d['message'] ?? '',
        $d['actor_id'] ?? null,
        $d['level'] ?? 'info'
    );
    echo json_encode(['type'=>'success']);
}

function clearOld() {
    global $connect;
    $days = max(1, intval($_GET['days'] ?? 90));
    $connect->query("DELETE FROM system_logs WHERE created_at < (NOW() - INTERVAL $days DAY)");
    echo json_encode(['type'=>'success','message'=>"Cleared logs older than $days days"]);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['log_id'] ?? 0);
    if ($id <= 0) {
        echo json_encode(['type' => 'error', 'message' => 'Missing or invalid log_id']);
        return;
    }
    $stmt = $connect->prepare("DELETE FROM system_logs WHERE log_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type' => $ok ? 'success' : 'error', 'message' => $ok ? 'Log deleted' : 'Failed to delete log']);
}

function stats() {
    global $connect;
    $res = $connect->query("
      SELECT category, level, COUNT(*) AS total
      FROM system_logs GROUP BY category, level ORDER BY total DESC
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}
