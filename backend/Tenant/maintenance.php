<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/request_photo.php';
require_once __DIR__ . '/../Config/tenant_session.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':   listMine(); break;
    case 'create': createOne(); break;
    case 'cancel': cancelOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listMine() {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    [, $tid] = requireTenantSession();
    $stmt = $connect->prepare("SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC");
    $stmt->bind_param("i", $tid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();

    $historyStmt = $connect->prepare("SELECT h.request_id, h.status, h.changed_at, u.full_name AS changed_by_name
        FROM maintenance_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
        INNER JOIN maintenance_requests m ON m.request_id = h.request_id
        WHERE m.tenant_id = ? ORDER BY h.changed_at ASC, h.history_id ASC");
    if ($historyStmt) {
        $historyStmt->bind_param('i', $tid);
        if ($historyStmt->execute()) {
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
        $historyStmt->close();
    }
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function createOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $d = !empty($_POST) ? $_POST : (json_decode(file_get_contents('php://input'), true) ?: []);
    [$userId, $tid] = requireTenantSession();
    $title = trim((string)($d['title'] ?? ''));
    $description = trim((string)($d['description'] ?? ''));
    $category = trim((string)($d['category'] ?? 'Other'));
    $priority = trim((string)($d['priority'] ?? 'Medium'));
    $allowedCategories = ['Plumbing', 'Electrical', 'Noise', 'Security', 'Sanitation', 'Internet', 'Other'];
    if ($title === '' || mb_strlen($title) > 180 || $description === '' || !in_array($category, $allowedCategories, true)
        || !in_array($priority, ['Low', 'Medium', 'High', 'Urgent'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a title, description, category, and valid priority']);
        return;
    }

    $photoPath = null;
    if (isset($_FILES['photo']) && ($_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        $upload = store_request_photo($_FILES['photo'], 'maintenance');
        if ($upload['error'] !== null) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$upload['error']]);
            return;
        }
        $photoPath = $upload['path'];
    }

    $stmt = $connect->prepare("INSERT INTO maintenance_requests
        (tenant_id, title, category, description, priority, photo_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Submitted', NOW(), NOW())");
    if (!$stmt) {
        delete_request_photo($photoPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to create maintenance request']);
        return;
    }
    $stmt->bind_param('isssss', $tid, $title, $category, $description, $priority, $photoPath);
    $connect->begin_transaction();
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $insertError = $stmt->error;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        delete_request_photo($photoPath);
        error_log('Maintenance request insert failed: ' . $insertError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to submit request']);
        return;
    }

    $historyStmt = $connect->prepare("INSERT INTO maintenance_status_history (request_id, status, changed_by, changed_at) VALUES (?, 'Submitted', ?, NOW())");
    if (!$historyStmt) {
        $connect->rollback();
        delete_request_photo($photoPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record request status']);
        return;
    }
    $historyStmt->bind_param('ii', $id, $userId);
    $historyOk = $historyStmt->execute();
    $historyError = $historyStmt->error;
    $historyStmt->close();
    if (!$historyOk) {
        $connect->rollback();
        delete_request_photo($photoPath);
        error_log('Maintenance status history insert failed: ' . $historyError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record request status']);
        return;
    }
    $connect->commit();

    $tenantStmt = $connect->prepare("SELECT t.full_name, r.room_number FROM tenants t LEFT JOIN rooms r ON r.room_id = t.room_id WHERE t.tenant_id = ? LIMIT 1");
    $tenantName = 'A tenant';
    $roomNumber = 'Unassigned';
    if ($tenantStmt) {
        $tenantStmt->bind_param('i', $tid);
        if ($tenantStmt->execute()) {
            $tenantRow = $tenantStmt->get_result()->fetch_assoc();
            $tenantName = (string)($tenantRow['full_name'] ?? $tenantName);
            $roomNumber = (string)($tenantRow['room_number'] ?? $roomNumber);
        }
        $tenantStmt->close();
    }
    system_notify_admins($connect, 'New Maintenance Request', "{$tenantName} (Room {$roomNumber}) reported {$category}: {$title}.", 'maintenance');
    rt_publish('/Admin/maintenance.php');
    rt_publish('/Tenant/maintenance.php');
    echo json_encode(['type'=>'success','message'=>'Request submitted','request_id'=>$id]);
}

function cancelOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $id = intval($_GET['request_id'] ?? 0);
    [$userId, $tid] = requireTenantSession();
    $stmt = $connect->prepare("UPDATE maintenance_requests SET status = 'Cancelled', updated_at = NOW() WHERE request_id = ? AND tenant_id = ? AND status = 'Submitted'");
    $stmt->bind_param('ii', $id, $tid);
    $connect->begin_transaction();
    $ok = $stmt->execute();
    $changed = $stmt->affected_rows > 0;
    $stmt->close();
    if (!$ok || !$changed) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'Only submitted requests can be cancelled']);
        return;
    }
    $historyStmt = $connect->prepare("INSERT INTO maintenance_status_history (request_id, status, changed_by, changed_at) VALUES (?, 'Cancelled', ?, NOW())");
    if (!$historyStmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record maintenance status history']);
        return;
    }
    $historyStmt->bind_param('ii', $id, $userId);
    $historyOk = $historyStmt->execute();
    $historyStmt->close();
    if (!$historyOk) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record maintenance status history']);
        return;
    }
    $connect->commit();
    rt_publish('/Tenant/maintenance.php');
    rt_publish('/Admin/maintenance.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Cancelled':'Failed']);
}
?>
