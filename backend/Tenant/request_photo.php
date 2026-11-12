<?php
include '../Config/db.php';
include '../Config/header.php';
require_once __DIR__ . '/../Config/request_photo.php';

$requestType = (string)($_GET['type'] ?? '');
$requestId = intval($_GET['id'] ?? 0);
$userId = sec_current_user_id();
$userType = sec_current_user_type();

if ($requestId <= 0 || !in_array($requestType, ['complaint', 'maintenance'], true)
    || !in_array($userType, ['Admin', 'Tenant'], true) || $userId <= 0) {
    http_response_code(403);
    exit('Forbidden');
}

$table = $requestType === 'complaint' ? 'complaints' : 'maintenance_requests';
$idColumn = $requestType === 'complaint' ? 'complaint_id' : 'request_id';
$stmt = $connect->prepare("SELECT photo_path, tenant_id FROM {$table} WHERE {$idColumn} = ? LIMIT 1");
if (!$stmt) {
    http_response_code(500);
    exit('Unable to load request photo');
}
$stmt->bind_param('i', $requestId);
if (!$stmt->execute()) {
    $stmt->close();
    http_response_code(500);
    exit('Unable to load request photo');
}
$request = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$request || empty($request['photo_path'])) {
    http_response_code(404);
    exit('Request photo not found');
}

if ($userType === 'Tenant') {
    $ownerStmt = $connect->prepare('SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1 LIMIT 1');
    if (!$ownerStmt) {
        http_response_code(500);
        exit('Unable to verify request owner');
    }
    $ownerStmt->bind_param('i', $userId);
    $ownerStmt->execute();
    $owner = $ownerStmt->get_result()->fetch_assoc();
    $ownerStmt->close();
    if (!$owner || (int)$owner['tenant_id'] !== (int)$request['tenant_id']) {
        http_response_code(403);
        exit('Forbidden');
    }
}

$filePath = request_photo_file_path((string)$request['photo_path']);
if ($filePath === null) {
    http_response_code(404);
    exit('Request photo not found');
}
$mime = mime_content_type($filePath) ?: 'application/octet-stream';
if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
    http_response_code(415);
    exit('Unsupported image');
}

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($filePath));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
readfile($filePath);
?>