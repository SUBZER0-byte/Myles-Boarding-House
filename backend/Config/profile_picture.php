<?php
include __DIR__ . '/db.php';
include __DIR__ . '/header.php';

$userId = (int) ($_GET['user_id'] ?? 0);
$currentUserId = sec_current_user_id();

if ($userId <= 0 || $currentUserId <= 0) {
    http_response_code(403);
    exit('Forbidden');
}

$stmt = $connect->prepare('SELECT profile_picture FROM users WHERE user_id = ? LIMIT 1');
$stmt->bind_param('i', $userId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

$stored = str_replace('\\', '/', trim((string) ($row['profile_picture'] ?? '')));
$stored = ltrim($stored, '/');
if ($stored === '' || !preg_match('#^profile_pictures/[A-Za-z0-9._-]+$#', $stored)) {
    http_response_code(404);
    exit('Profile picture not found');
}

$uploadRoot = realpath(__DIR__ . '/../uploads');
$filePath = realpath(__DIR__ . '/../uploads/' . $stored);
if (!$uploadRoot || !$filePath || !is_file($filePath) || strpos($filePath, $uploadRoot) !== 0) {
    http_response_code(404);
    exit('Profile picture not found');
}

$mime = mime_content_type($filePath) ?: 'application/octet-stream';
if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
    http_response_code(415);
    exit('Unsupported image');
}

header('Content-Type: ' . $mime);
header('Content-Disposition: inline; filename="' . basename($filePath) . '"');
header('Content-Length: ' . filesize($filePath));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
readfile($filePath);
