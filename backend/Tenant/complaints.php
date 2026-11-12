<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/request_photo.php';
require_once __DIR__ . '/../Notifications/sms_helper.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':   listMine(); break;
    case 'get':    getOne(); break;
    case 'create': createOne(); break;
    case 'cancel': cancelOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function tenantIdFromUser(int $uid): int {
    global $connect;
    if (!$connect instanceof mysqli || $uid <= 0 || $uid !== sec_current_user_id()) {
        return 0;
    }

    $userType = strtolower(trim((string) sec_current_user_type()));
    if ($userType === 'tenant') {
        $stmt = $connect->prepare("SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1 LIMIT 1");
        if (!$stmt) {
            return 0;
        }
        $stmt->bind_param("i", $uid);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        return $row ? intval($row['tenant_id']) : 0;
    }

    $stmt = $connect->prepare("SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1 LIMIT 1");
    if (!$stmt) {
        return 0;
    }
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ? intval($row['tenant_id']) : 0;
}

function listMine() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $tid = tenantIdFromUser(sec_current_user_id());
    if ($tid <= 0) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Tenant access required']);
        return;
    }
    $stmt = $connect->prepare("SELECT * FROM complaints WHERE tenant_id = ? ORDER BY created_at DESC");
    if (!$stmt) {
        echo json_encode(['type'=>'error','message'=>'Failed to load complaints']);
        return;
    }
    $stmt->bind_param("i", $tid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();

    $historyStmt = $connect->prepare("SELECT h.complaint_id, h.status, h.changed_at, u.full_name AS changed_by_name
        FROM complaint_status_history h
        LEFT JOIN users u ON u.user_id = h.changed_by
        INNER JOIN complaints c ON c.complaint_id = h.complaint_id
        WHERE c.tenant_id = ? ORDER BY h.changed_at ASC, h.history_id ASC");
    if ($historyStmt) {
        $historyStmt->bind_param('i', $tid);
        if ($historyStmt->execute()) {
            $historyResult = $historyStmt->get_result();
            $historyById = [];
            while ($history = $historyResult->fetch_assoc()) {
                $historyById[(int)$history['complaint_id']][] = [
                    'status' => $history['status'],
                    'changed_at' => $history['changed_at'],
                    'changed_by_name' => $history['changed_by_name'],
                ];
            }
            foreach ($rows as &$row) {
                $row['status_history'] = $historyById[(int)$row['complaint_id']] ?? [];
            }
            unset($row);
        }
        $historyStmt->close();
    }
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $id = intval($_GET['complaint_id'] ?? 0);
    $stmt = $connect->prepare("SELECT * FROM complaints WHERE complaint_id = ?");
    if (!$stmt) {
        echo json_encode(['type'=>'error','message'=>'Failed to load complaint']);
        return;
    }
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function createOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $d = !empty($_POST) ? $_POST : (json_decode(file_get_contents('php://input'), true) ?: []);
    $userId = sec_current_user_id();
    $tid = tenantIdFromUser($userId);
    if ($tid <= 0) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Tenant access required']);
        return;
    }

    $title = trim((string)($d['title'] ?? ''));
    $description = trim((string)($d['description'] ?? ''));
    $categoryInput = trim((string)($d['category'] ?? 'Other'));
    $categoryMap = [
        'plumbing' => 'Plumbing',
        'electrical' => 'Electrical',
        'noise' => 'Noise',
        'security' => 'Security',
        'sanitation' => 'Sanitation',
        'internet' => 'Internet',
        'general' => 'General',
        'other' => 'Other',
    ];
    $category = $categoryMap[strtolower($categoryInput)] ?? $categoryInput;
    $isUrgent = !empty($d['is_urgent']) ? 1 : 0;
    $allowedCategories = ['Plumbing', 'Electrical', 'Noise', 'Security', 'Sanitation', 'Internet', 'General', 'Other'];
    if ($title === '' || mb_strlen($title) > 180 || $description === '' || !in_array($category, $allowedCategories, true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a title, description, and valid complaint category']);
        return;
    }

    $photoPath = null;
    if (isset($_FILES['photo']) && ($_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        $upload = store_request_photo($_FILES['photo'], 'complaints');
        if ($upload['error'] !== null) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$upload['error']]);
            return;
        }
        $photoPath = $upload['path'];
    }

    $stmt = $connect->prepare("INSERT INTO complaints
        (tenant_id, title, description, category, is_urgent, photo_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'Submitted', NOW(), NOW())");
    if (!$stmt) {
        delete_request_photo($photoPath);
        echo json_encode(['type'=>'error','message'=>'Failed to create complaint']);
        return;
    }
    $stmt->bind_param('isssis', $tid, $title, $description, $category, $isUrgent, $photoPath);
    $connect->begin_transaction();
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $insertError = $stmt->error;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        delete_request_photo($photoPath);
        error_log('Tenant complaint insert failed: ' . $insertError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to file complaint']);
        return;
    }

    $historyStmt = $connect->prepare("INSERT INTO complaint_status_history (complaint_id, status, changed_by, changed_at) VALUES (?, 'Submitted', ?, NOW())");
    if (!$historyStmt) {
        $connect->rollback();
        delete_request_photo($photoPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record complaint status']);
        return;
    }
    $historyStmt->bind_param('ii', $id, $userId);
    $historyOk = $historyStmt->execute();
    $historyError = $historyStmt->error;
    $historyStmt->close();
    if (!$historyOk) {
        $connect->rollback();
        delete_request_photo($photoPath);
        error_log('Complaint status history insert failed: ' . $historyError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record complaint status']);
        return;
    }
    $connect->commit();

    $tenantName = 'A tenant';
    $roomNumber = 'Unknown room';
    $tenantStmt = $connect->prepare("SELECT t.full_name, r.room_number FROM tenants t LEFT JOIN rooms r ON r.room_id = t.room_id WHERE t.tenant_id = ? LIMIT 1");
    if ($tenantStmt) {
        $tenantStmt->bind_param('i', $tid);
        if ($tenantStmt->execute()) {
            $tenantRow = $tenantStmt->get_result()->fetch_assoc();
            $tenantName = (string)($tenantRow['full_name'] ?? $tenantName);
            $roomNumber = (string)($tenantRow['room_number'] ?? $roomNumber);
        }
        $tenantStmt->close();
    }

    $alertPrefix = $isUrgent ? 'URGENT ' : '';
    system_notify_admins($connect, "{$alertPrefix}Tenant Complaint", "{$tenantName} (Room {$roomNumber}) reported {$category}: {$title}.", 'complaint');

    $smsSent = 0;
    $smsFailures = 0;
    if ($isUrgent) {
        $admins = $connect->query("SELECT DISTINCT phone FROM users WHERE user_type = 'Admin' AND is_active = 1 AND phone IS NOT NULL AND phone <> ''");
        if ($admins) {
            $smsMessage = "URGENT complaint: {$tenantName}, Room {$roomNumber}, {$category}. {$title}. Please review Admin Panel. This is not a substitute for local emergency services.";
            while ($admin = $admins->fetch_assoc()) {
                $smsResult = sms_send((string)$admin['phone'], $smsMessage);
                if ($smsResult['ok']) $smsSent++;
                else {
                    $smsFailures++;
                    error_log('Urgent complaint SMS failed: ' . (string)($smsResult['error'] ?? 'SMS delivery failed'));
                }
            }
            $admins->free();
        }
        if ($smsSent === 0) $smsFailures = max(1, $smsFailures);
    }

    rt_publish('/Admin/complaints.php');
    rt_publish('/Tenant/complaints.php');
    echo json_encode(['type'=>'success','message'=>'Complaint filed','complaint_id'=>$id,'sms_sent'=>$smsSent,'sms_failures'=>$smsFailures]);
}

function cancelOne() {
    global $connect;
    if (!$connect instanceof mysqli) {
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $id = intval($_GET['complaint_id'] ?? 0);
    $userId = sec_current_user_id();
    $tenantId = tenantIdFromUser($userId);
    if ($tenantId <= 0) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Tenant access required']);
        return;
    }
    $stmt = $connect->prepare("UPDATE complaints SET status = 'Cancelled', updated_at = NOW() WHERE complaint_id = ? AND tenant_id = ? AND status = 'Submitted'");
    if (!$stmt) {
        echo json_encode(['type'=>'error','message'=>'Failed to cancel complaint']);
        return;
    }
    $stmt->bind_param('ii', $id, $tenantId);
    $connect->begin_transaction();
    $ok = $stmt->execute();
    $changed = $stmt->affected_rows > 0;
    $stmt->close();
    if (!$ok || !$changed) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'Only submitted complaints can be cancelled']);
        return;
    }
    $historyStmt = $connect->prepare("INSERT INTO complaint_status_history (complaint_id, status, changed_by, changed_at) VALUES (?, 'Cancelled', ?, NOW())");
    if (!$historyStmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record complaint status history']);
        return;
    }
    $historyStmt->bind_param('ii', $id, $userId);
    $historyOk = $historyStmt->execute();
    $historyStmt->close();
    if (!$historyOk) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record complaint status history']);
        return;
    }
    $connect->commit();
    rt_publish('/Tenant/complaints.php');
    rt_publish('/Admin/complaints.php');
    echo json_encode(['type'=>'success','message'=>'Cancelled']);
}
?>
