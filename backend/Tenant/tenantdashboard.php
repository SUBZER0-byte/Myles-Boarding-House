<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

header('Content-Type: application/json');

$action = isset($_GET['action']) ? $_GET['action'] : 'get_dashboard_data';

switch ($action) {
    case 'get_dashboard_data':
        getDashboardData();
        break;
    default:
        echo json_encode([
            'type' => 'error',
            'message' => 'Invalid action'
        ]);
        break;
}

function getDashboardData() {
    global $connect;

    $user_id = isset($_GET['user_id']) ? intval($_GET['user_id']) : 0;

    if ($user_id <= 0) {
        echo json_encode([
            'type' => 'error',
            'message' => 'Invalid user ID'
        ]);
        return;
    }

    try {
        $tenantStmt = $connect->prepare("
            SELECT tenant_id, full_name, room_id
            FROM tenants
            WHERE user_id = ? AND is_active = 1
        ");
        $tenantStmt->bind_param("i", $user_id);
        $tenantStmt->execute();
        $tenantResult = $tenantStmt->get_result();

        if ($tenantResult->num_rows === 0) {
            echo json_encode([
                'type' => 'error',
                'message' => 'Tenant record not found'
            ]);
            $tenantStmt->close();
            return;
        }

        $tenant    = $tenantResult->fetch_assoc();
        $tenant_id = $tenant['tenant_id'];
        $room_id   = $tenant['room_id'];
        $tenantStmt->close();

        $room_info       = getRoomInfo($room_id);
        $current_balance = getCurrentBalance($tenant_id);
        $next_due        = getNextDuePayment($tenant_id);
        $last_payment    = getLastPayment($tenant_id);
        $announcements   = getRecentAnnouncements();
        $maintenance     = getTenantMaintenance($tenant_id);
        $complaints      = getTenantComplaints($tenant_id);
        $maintenanceSummary = getTenantServiceSummary($tenant_id, 'maintenance_requests');
        $complaintSummary = getTenantServiceSummary($tenant_id, 'complaints');

        echo json_encode([
            'type' => 'success',
            'data' => [
                'tenant_name'      => $tenant['full_name'],
                'room_info'        => $room_info,
                'current_balance'  => $current_balance,
                'next_due_payment' => $next_due,
                'last_payment'     => $last_payment,
                'announcements'    => $announcements,
                'maintenance'      => $maintenance,
                'complaints'       => $complaints,
                'maintenance_summary' => $maintenanceSummary,
                'complaint_summary' => $complaintSummary
            ]
        ]);

    } catch (Exception $e) {
        echo json_encode([
            'type' => 'error',
            'message' => $e->getMessage()
        ]);
    }
}

function getTenantServiceSummary(int $tenant_id, string $table): array {
    global $connect;

    $allowedTables = ['maintenance_requests', 'complaints'];
    if (!in_array($table, $allowedTables, true)) {
        throw new InvalidArgumentException('Invalid service summary table');
    }

    $stmt = $connect->prepare("
        SELECT status, COUNT(*) AS count
        FROM {$table}
        WHERE tenant_id = ?
        GROUP BY status
    ");
    if (!$stmt) {
        throw new RuntimeException('Unable to prepare tenant service summary');
    }
    $stmt->bind_param('i', $tenant_id);
    if (!$stmt->execute()) {
        $error = $stmt->error;
        $stmt->close();
        throw new RuntimeException('Unable to load tenant service summary: ' . $error);
    }

    $summary = [];
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $status = trim((string)$row['status']);
        $summary[$status] = (int)$row['count'];
    }
    $stmt->close();

    return $summary;
}

function getRoomInfo($room_id) {
    global $connect;

    if (!$room_id) {
        return null;
    }

    $stmt = $connect->prepare("
        SELECT room_id, room_number, room_type, monthly_rent, status
        FROM rooms
        WHERE room_id = ?
    ");
    $stmt->bind_param("i", $room_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $room = $result->fetch_assoc();
    $stmt->close();

    return $room ?: null;
}

function getCurrentBalance($tenant_id) {
    global $connect;

    $stmt = $connect->prepare("
        SELECT COALESCE(SUM(amount), 0) AS balance
        FROM payments
        WHERE tenant_id = ?
          AND status IN ('Pending', 'Overdue')
    ");
    $stmt->bind_param("i", $tenant_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (float) $row['balance'];
}

function getNextDuePayment($tenant_id) {
    global $connect;

    $stmt = $connect->prepare("
        SELECT payment_id, amount, due_date, status
        FROM payments
        WHERE tenant_id = ?
          AND status IN ('Pending', 'Overdue')
        ORDER BY due_date ASC
        LIMIT 1
    ");
    $stmt->bind_param("i", $tenant_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return $row ?: null;
}

function getLastPayment($tenant_id) {
    global $connect;

    $stmt = $connect->prepare("
        SELECT payment_id, amount, paid_at, method
        FROM payments
        WHERE tenant_id = ?
          AND status = 'Paid'
        ORDER BY paid_at DESC
        LIMIT 1
    ");
    $stmt->bind_param("i", $tenant_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return $row ?: null;
}

function getRecentAnnouncements() {
    global $connect;

    $stmt = $connect->prepare("
        SELECT announcement_id, title, body, created_at
        FROM announcements
        WHERE is_published = 1
        ORDER BY created_at DESC
        LIMIT 5
    ");
    $stmt->execute();
    $result = $stmt->get_result();

    $items = [];
    while ($row = $result->fetch_assoc()) {
        $items[] = $row;
    }
    $stmt->close();

    return $items;
}

function getTenantMaintenance($tenant_id) {
    global $connect;

    $stmt = $connect->prepare("
        SELECT request_id, title, status, created_at
        FROM maintenance_requests
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 5
    ");
    $stmt->bind_param("i", $tenant_id);
    $stmt->execute();
    $result = $stmt->get_result();

    $items = [];
    while ($row = $result->fetch_assoc()) {
        $items[] = $row;
    }
    $stmt->close();

    return $items;
}

function getTenantComplaints($tenant_id) {
    global $connect;

    $stmt = $connect->prepare("
        SELECT complaint_id, title, status, created_at
        FROM complaints
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 5
    ");
    $stmt->bind_param("i", $tenant_id);
    $stmt->execute();
    $result = $stmt->get_result();

    $items = [];
    while ($row = $result->fetch_assoc()) {
        $items[] = $row;
    }
    $stmt->close();

    return $items;
}
?>
