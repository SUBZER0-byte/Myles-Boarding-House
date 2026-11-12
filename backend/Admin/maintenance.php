<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/request_photo.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':          listAll(); break;
    case 'get':           getOne(); break;
    case 'update_status': updateStatus(); break;
    case 'delete':        deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listAll() {
    global $connect;
    $res = $connect->query("
        SELECT m.request_id, m.tenant_id, m.title, m.category, m.description, m.priority, m.status, m.photo_path, m.created_at, m.updated_at,
               t.full_name, r.room_number
        FROM maintenance_requests m
        INNER JOIN tenants t ON t.tenant_id = m.tenant_id
        LEFT JOIN rooms r ON r.room_id = t.room_id
        ORDER BY m.created_at DESC
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;

    $historyStmt = $connect->prepare("SELECT h.request_id, h.status, h.changed_at, u.full_name AS changed_by_name
        FROM maintenance_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
        ORDER BY h.changed_at ASC, h.history_id ASC");
    if ($historyStmt && $historyStmt->execute()) {
        $historyResult = $historyStmt->get_result();
        $historyById = [];
        while ($history = $historyResult->fetch_assoc()) {
            $historyById[(int)$history['request_id']][] = [
                'status' => $history['status'],
                'changed_at' => $history['changed_at'],
                'changed_by_name' => $history['changed_by_name'],
            ];
        }
        foreach ($rows as &$row) {
            $row['status_history'] = $historyById[(int)$row['request_id']] ?? [];
        }
        unset($row);
    }
    if ($historyStmt) $historyStmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getOne() {
    global $connect;
    $id = intval($_GET['request_id'] ?? 0);
    $stmt = $connect->prepare("
        SELECT request_id, tenant_id, title, category, description, priority, status, photo_path, created_at, updated_at
        FROM maintenance_requests WHERE request_id = ?
    ");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function updateStatus() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }
    $id = intval($d['request_id'] ?? 0);
    $requestedStatus = trim((string)($d['status'] ?? ''));
    $statusMap = ['Pending'=>'Submitted', 'Ongoing'=>'In Progress', 'Completed'=>'Resolved'];
    $status = $statusMap[$requestedStatus] ?? $requestedStatus;
    if ($id <= 0 || !in_array($status, ['Submitted', 'Acknowledged', 'In Progress', 'Resolved', 'Cancelled'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid maintenance status']);
        return;
    }
    $previousStmt = $connect->prepare("
        SELECT m.status, m.title, t.user_id
        FROM maintenance_requests m
        INNER JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.request_id = ? LIMIT 1
    ");
    if (!$previousStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load maintenance request']);
        return;
    }
    $previousStmt->bind_param('i', $id);
    if (!$previousStmt->execute()) {
        $previousStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load maintenance request']);
        return;
    }
    $request = $previousStmt->get_result()->fetch_assoc();
    $previousStmt->close();
    if (!$request) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Maintenance request not found']);
        return;
    }

    $connect->begin_transaction();
    $stmt = $connect->prepare("UPDATE maintenance_requests SET status = ?, updated_at = NOW() WHERE request_id = ?");
    if (!$stmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update maintenance status']);
        return;
    }
    $stmt->bind_param('si', $status, $id);
    $ok = $stmt->execute();
    $error = $stmt->error;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        error_log('Maintenance status update failed: ' . $error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update maintenance status']);
        return;
    }
    if ((string)$request['status'] !== $status) {
        $historyStmt = $connect->prepare('INSERT INTO maintenance_status_history (request_id, status, changed_by, changed_at) VALUES (?, ?, ?, NOW())');
        if (!$historyStmt) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to record maintenance status history']);
            return;
        }
        $changedBy = sec_current_user_id();
        $historyStmt->bind_param('isi', $id, $status, $changedBy);
        $historyOk = $historyStmt->execute();
        $historyStmt->close();
        if (!$historyOk) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to record maintenance status history']);
            return;
        }
    }
    $connect->commit();
    if ((string)$request['status'] !== $status) {
        system_notify_user(
            $connect,
            (int)$request['user_id'],
            'Maintenance Request Update',
            "Your maintenance request \"{$request['title']}\" is now {$status}.",
            'maintenance'
        );
        rt_publish('/Tenant/maintenance.php');
    }
    echo json_encode(['type'=>'success','message'=>'Updated']);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['request_id'] ?? 0);
    $lookup = $connect->prepare('SELECT photo_path FROM maintenance_requests WHERE request_id = ? LIMIT 1');
    $lookup->bind_param('i', $id);
    $lookup->execute();
    $request = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    $stmt = $connect->prepare("DELETE FROM maintenance_requests WHERE request_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok && $request) {
        delete_request_photo($request['photo_path'] ?? null);
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
