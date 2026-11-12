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
    case 'list':       listAll(); break;
    case 'report':     recurringReport(); break;
    case 'get':        getOne(); break;
    case 'update_status': updateStatus(); break;
    case 'reply':      reply(); break;
    case 'delete':     deleteOne(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function listAll() {
    global $connect;
    $status = $_GET['status'] ?? '';
    $sql = "SELECT c.*, t.full_name, r.room_number FROM complaints c
            INNER JOIN tenants t ON t.tenant_id = c.tenant_id
            LEFT JOIN rooms r ON r.room_id = t.room_id";
    if ($status !== '') {
        $stmt = $connect->prepare($sql . " WHERE c.status = ? ORDER BY c.created_at DESC");
        $stmt->bind_param('s', $status);
    } else {
        $stmt = $connect->prepare($sql . " ORDER BY c.created_at DESC");
    }
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load complaints']);
        return;
    }
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();

    $historyStmt = $connect->prepare("SELECT h.complaint_id, h.status, h.changed_at, u.full_name AS changed_by_name
        FROM complaint_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
        ORDER BY h.changed_at ASC, h.history_id ASC");
    if ($historyStmt && $historyStmt->execute()) {
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
    if ($historyStmt) $historyStmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function recurringReport(): void {
    global $connect;
    $result = $connect->query("SELECT COALESCE(NULLIF(c.category, ''), 'Other') AS category,
            COALESCE(r.room_number, 'Unassigned') AS room_number, COUNT(*) AS complaint_count,
            MAX(c.created_at) AS latest_report
        FROM complaints c
        INNER JOIN tenants t ON t.tenant_id = c.tenant_id
        LEFT JOIN rooms r ON r.room_id = t.room_id
        WHERE c.status <> 'Cancelled'
        GROUP BY COALESCE(NULLIF(c.category, ''), 'Other'), COALESCE(r.room_number, 'Unassigned')
        HAVING COUNT(*) >= 2
        ORDER BY complaint_count DESC, latest_report DESC");
    if (!$result) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load recurring complaints']);
        return;
    }
    echo json_encode(['type'=>'success','data'=>$result->fetch_all(MYSQLI_ASSOC)]);
}

function getOne() {
    global $connect;
    $id = intval($_GET['complaint_id'] ?? 0);
    $stmt = $connect->prepare("
        SELECT c.*, t.full_name FROM complaints c
        INNER JOIN tenants t ON t.tenant_id = c.tenant_id
        WHERE c.complaint_id = ?
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
    $id = intval($d['complaint_id'] ?? 0);
    $status = trim((string)($d['status'] ?? ''));
    if ($status === 'Open') $status = 'Submitted';
    if ($id <= 0 || !in_array($status, ['Submitted','Acknowledged','In Progress','Resolved','Cancelled'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid complaint status']);
        return;
    }
    $previousStmt = $connect->prepare("
        SELECT c.status, c.title, t.user_id
        FROM complaints c
        INNER JOIN tenants t ON t.tenant_id = c.tenant_id
        WHERE c.complaint_id = ? LIMIT 1
    ");
    if (!$previousStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load complaint']);
        return;
    }
    $previousStmt->bind_param('i', $id);
    if (!$previousStmt->execute()) {
        $previousStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load complaint']);
        return;
    }
    $complaint = $previousStmt->get_result()->fetch_assoc();
    $previousStmt->close();
    if (!$complaint) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Complaint not found']);
        return;
    }

    $connect->begin_transaction();
    $stmt = $connect->prepare("UPDATE complaints SET status = ?, updated_at = NOW() WHERE complaint_id = ?");
    if (!$stmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update complaint status']);
        return;
    }
    $stmt->bind_param('si', $status, $id);
    $ok = $stmt->execute();
    $updateError = $stmt->error;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        error_log('Complaint status update failed: ' . $updateError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update complaint status']);
        return;
    }
    if ((string)$complaint['status'] !== $status) {
        $historyStmt = $connect->prepare('INSERT INTO complaint_status_history (complaint_id, status, changed_by, changed_at) VALUES (?, ?, ?, NOW())');
        if (!$historyStmt) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to record complaint status history']);
            return;
        }
        $changedBy = sec_current_user_id();
        $historyStmt->bind_param('isi', $id, $status, $changedBy);
        $historyOk = $historyStmt->execute();
        $historyStmt->close();
        if (!$historyOk) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to record complaint status history']);
            return;
        }
    }
    $connect->commit();
    if ((string)$complaint['status'] !== $status) {
        system_notify_user(
            $connect,
            (int)$complaint['user_id'],
            'Complaint Status Update',
            "Your complaint \"{$complaint['title']}\" is now {$status}.",
            'complaint'
        );
        rt_publish('/Tenant/complaints.php');
    }
    rt_publish('/Admin/complaints.php');
    echo json_encode(['type'=>'success','message'=>'Updated']);
}

function reply() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['complaint_id'] ?? 0);
    $complaintStmt = $connect->prepare("
        SELECT c.title, t.user_id
        FROM complaints c
        INNER JOIN tenants t ON t.tenant_id = c.tenant_id
        WHERE c.complaint_id = ? LIMIT 1
    ");
    if (!$complaintStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load complaint']);
        return;
    }
    $complaintStmt->bind_param('i', $id);
    if (!$complaintStmt->execute()) {
        $complaintStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load complaint']);
        return;
    }
    $complaint = $complaintStmt->get_result()->fetch_assoc();
    $complaintStmt->close();
    if (!$complaint) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Complaint not found']);
        return;
    }

    $stmt = $connect->prepare("UPDATE complaints SET admin_reply = ?, replied_at = NOW() WHERE complaint_id = ?");
    $stmt->bind_param("si", $d['reply'], $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        system_notify_user(
            $connect,
            (int)$complaint['user_id'],
            'New Complaint Reply',
            "The admin replied to your complaint \"{$complaint['title']}\". View the complaint to read the response.",
            'complaint'
        );
        rt_publish('/Tenant/complaints.php');
    }
    rt_publish('/Admin/complaints.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Reply sent':'Failed']);
}

function deleteOne() {
    global $connect;
    $id = intval($_GET['complaint_id'] ?? 0);
    $lookup = $connect->prepare('SELECT photo_path FROM complaints WHERE complaint_id = ? LIMIT 1');
    $lookup->bind_param('i', $id);
    $lookup->execute();
    $complaint = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    $stmt = $connect->prepare("DELETE FROM complaints WHERE complaint_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok && $complaint) {
        delete_request_photo($complaint['photo_path'] ?? null);
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
