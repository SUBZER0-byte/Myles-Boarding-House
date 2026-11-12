<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'revenue_by_month': revenueByMonth(); break;
    case 'bookings_by_month': bookingsByMonth(); break;
    case 'occupancy_trend':  occupancyTrend(); break;
    case 'complaints_by_status': complaintsByStatus(); break;
    case 'maintenance_by_status': maintenanceByStatus(); break;
    case 'top_paying_tenants': topPayingTenants(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function revenueByMonth() {
    global $connect;
    $res = $connect->query("
        SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, COALESCE(SUM(amount),0) AS total
        FROM payments WHERE status = 'Paid' AND paid_at IS NOT NULL
        GROUP BY month ORDER BY month DESC LIMIT 12
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>array_reverse($rows)]);
}

function bookingsByMonth() {
    global $connect;
    $res = $connect->query("
        SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS total
        FROM bookings
        WHERE created_at IS NOT NULL AND status != 'Cancelled'
        GROUP BY month ORDER BY month DESC LIMIT 12
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>array_reverse($rows)]);
}

function occupancyTrend() {
    global $connect;
    $res = $connect->query("
        SELECT DATE_FORMAT(move_in_date, '%Y-%m') AS month, COUNT(*) AS new_tenants
        FROM tenants WHERE move_in_date IS NOT NULL
        GROUP BY month ORDER BY month DESC LIMIT 12
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>array_reverse($rows)]);
}

function complaintsByStatus() {
    global $connect;
    $res = $connect->query("SELECT status, COUNT(*) AS cnt FROM complaints GROUP BY status");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function maintenanceByStatus() {
    global $connect;
    $res = $connect->query("SELECT status, COUNT(*) AS cnt FROM maintenance_requests GROUP BY status");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function topPayingTenants() {
    global $connect;
    $res = $connect->query("
        SELECT t.tenant_id, t.full_name, COALESCE(SUM(p.amount),0) AS total_paid
        FROM tenants t
        LEFT JOIN payments p ON p.tenant_id = t.tenant_id AND p.status = 'Paid'
        GROUP BY t.tenant_id, t.full_name
        ORDER BY total_paid DESC LIMIT 10
    ");
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}
?>
