<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

sec_require_admin();

header('Content-Type: application/json');

$action = isset($_GET['action']) ? $_GET['action'] : 'get_dashboard_data';

switch ($action) {
    case 'get_dashboard_data':
        getDashboardData();
        break;
    case 'get_recent_activity':
        getRecentActivity();
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

    try {
        $totalRooms      = getTotalRooms();
        $occupancyStats  = getOccupancyStats();
        $totalTenants    = getTotalTenants();
        $monthlyRevenue  = getMonthlyRevenue();
        $pendingPayments = getPendingPayments();
        $complaints      = getComplaintStats();
        $maintenance     = getMaintenanceStats();
        $maintenanceRooms = getMaintenanceRoomCount();

        echo json_encode([
            'type' => 'success',
            'data' => [
                'totalRooms'        => $totalRooms,
                'occupiedRooms'     => $occupancyStats['occupied'],
                'availableRooms'    => $occupancyStats['available'],
                'reservedRooms'     => $occupancyStats['reserved'],
                'totalTenants'      => $totalTenants,
                'monthlyRevenue'    => $monthlyRevenue,
                'pendingPayments'   => $pendingPayments,
                'openComplaints'    => $complaints['open'] + $complaints['inProgress'],
                'complaintStats'    => $complaints,
                'pendingMaintenance'=> $maintenance['pending'],
                'ongoingMaintenance'=> $maintenance['ongoing'],
                'completedMaintenance' => $maintenance['completed'],
                'cancelledMaintenance' => $maintenance['cancelled'],
                'maintenanceRooms'  => $maintenanceRooms
            ]
        ]);

    } catch (Exception $e) {
        echo json_encode([
            'type' => 'error',
            'message' => 'Failed to fetch dashboard data: ' . $e->getMessage()
        ]);
    }
}

function getTotalRooms() {
    global $connect;

    $stmt = $connect->prepare("SELECT COUNT(*) AS total FROM rooms");
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (int) $row['total'];
}

function getOccupancyStats() {
    global $connect;

    $stats = [
        'occupied'  => 0,
        'available' => 0,
        'reserved'  => 0
    ];

    $stmt = $connect->prepare("
        SELECT status, COUNT(*) AS count
        FROM rooms
        GROUP BY status
    ");
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        $status = strtolower($row['status']);
        if ($status === 'occupied') {
            $stats['occupied'] += (int) $row['count'];
        } elseif ($status === 'available') {
            $stats['available'] += (int) $row['count'];
        } elseif ($status === 'reserved') {
            $stats['reserved'] += (int) $row['count'];
        }
    }
    $stmt->close();

    return $stats;
}

function getTotalTenants() {
    global $connect;

    $stmt = $connect->prepare("
        SELECT COUNT(*) AS total
        FROM tenants
        WHERE is_active = 1
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (int) $row['total'];
}

function getMonthlyRevenue() {
    global $connect;

    $month = date('n');
    $year  = date('Y');

    $stmt = $connect->prepare("
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments
        WHERE status = 'Paid'
          AND MONTH(paid_at) = ?
          AND YEAR(paid_at) = ?
    ");
    $stmt->bind_param("ii", $month, $year);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (float) $row['total'];
}

function getPendingPayments() {
    global $connect;

    $stmt = $connect->prepare("
        SELECT COUNT(*) AS total
        FROM payments
        WHERE status IN ('Pending', 'Overdue')
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (int) $row['total'];
}

function getComplaintStats() {
    global $connect;

    $stats = ['open' => 0, 'inProgress' => 0, 'resolved' => 0, 'cancelled' => 0];
    $stmt = $connect->prepare("
        SELECT status, COUNT(*) AS count
        FROM complaints
        GROUP BY status
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    while ($row = $result->fetch_assoc()) {
        $status = strtolower(trim((string)$row['status']));
        if (in_array($status, ['open', 'submitted', 'acknowledged'], true)) {
            $stats['open'] += (int)$row['count'];
        } elseif ($status === 'in progress') {
            $stats['inProgress'] += (int)$row['count'];
        } elseif ($status === 'resolved') {
            $stats['resolved'] += (int)$row['count'];
        } elseif ($status === 'cancelled' || $status === 'canceled') {
            $stats['cancelled'] += (int)$row['count'];
        }
    }
    $stmt->close();

    return $stats;
}

function getMaintenanceStats() {
    global $connect;

    $stats = ['pending' => 0, 'ongoing' => 0, 'completed' => 0, 'cancelled' => 0];

    $stmt = $connect->prepare("
        SELECT status, COUNT(*) AS count
        FROM maintenance_requests
        GROUP BY status
    ");
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        $status = strtolower(trim((string)$row['status']));
        if (in_array($status, ['pending', 'submitted', 'acknowledged'], true)) {
            $stats['pending'] += (int) $row['count'];
        } elseif ($status === 'ongoing' || $status === 'in progress') {
            $stats['ongoing'] += (int) $row['count'];
        } elseif ($status === 'completed' || $status === 'resolved') {
            $stats['completed'] += (int) $row['count'];
        } elseif ($status === 'cancelled' || $status === 'canceled') {
            $stats['cancelled'] += (int) $row['count'];
        }
    }
    $stmt->close();

    return $stats;
}

function getMaintenanceRoomCount() {
    global $connect;

    $stmt = $connect->prepare("SELECT COUNT(*) AS total FROM rooms WHERE status = 'Maintenance'");
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();

    return (int) ($row['total'] ?? 0);
}

function getRecentActivity() {
    global $connect;

    try {
        $activities = [];

        $stmt = $connect->prepare("
            SELECT p.payment_id, p.amount, p.paid_at, t.full_name
            FROM payments p
            INNER JOIN tenants t ON t.tenant_id = p.tenant_id
            WHERE p.status = 'Paid'
            ORDER BY p.paid_at DESC
            LIMIT 5
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        while ($row = $result->fetch_assoc()) {
            $activities[] = [
                'type'      => 'payment',
                'message'   => $row['full_name'] . ' paid ₱' . number_format($row['amount'], 2),
                'timestamp' => $row['paid_at']
            ];
        }
        $stmt->close();

        $stmt = $connect->prepare("
            SELECT c.complaint_id, c.title, c.created_at, t.full_name
            FROM complaints c
            INNER JOIN tenants t ON t.tenant_id = c.tenant_id
            ORDER BY c.created_at DESC
            LIMIT 5
        ");
        $stmt->execute();
        $result = $stmt->get_result();
        while ($row = $result->fetch_assoc()) {
            $activities[] = [
                'type'      => 'complaint',
                'message'   => $row['full_name'] . ' filed: ' . $row['title'],
                'timestamp' => $row['created_at']
            ];
        }
        $stmt->close();

        usort($activities, function ($a, $b) {
            return strtotime($b['timestamp']) - strtotime($a['timestamp']);
        });

        echo json_encode([
            'type' => 'success',
            'data' => array_slice($activities, 0, 10)
        ]);

    } catch (Exception $e) {
        echo json_encode([
            'type' => 'error',
            'message' => 'Failed to fetch recent activity: ' . $e->getMessage()
        ]);
    }
}
?>
