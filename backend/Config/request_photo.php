<?php

function store_request_photo(array $file, string $requestType): array {
    if (!in_array($requestType, ['complaints', 'maintenance'], true)) {
        return ['path' => null, 'error' => 'Invalid request type'];
    }
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $message = in_array($file['error'] ?? UPLOAD_ERR_NO_FILE, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'Photo must be 10MB or smaller'
            : 'Photo upload failed';
        return ['path' => null, 'error' => $message];
    }
    if (($file['size'] ?? 0) <= 0 || ($file['size'] ?? 0) > 10 * 1024 * 1024) {
        return ['path' => null, 'error' => 'Photo must be 10MB or smaller'];
    }

    $fileInfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $fileInfo ? finfo_file($fileInfo, (string)($file['tmp_name'] ?? '')) : false;
    if ($fileInfo) {
        finfo_close($fileInfo);
    }
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!is_string($mime) || !isset($extensions[$mime])) {
        return ['path' => null, 'error' => 'Photo must be JPG, PNG, or WEBP'];
    }

    $directory = __DIR__ . '/../uploads/request_photos/' . $requestType . '/';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        return ['path' => null, 'error' => 'Unable to create photo upload folder'];
    }

    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    if (!move_uploaded_file((string)($file['tmp_name'] ?? ''), $directory . $filename)) {
        return ['path' => null, 'error' => 'Unable to save photo'];
    }

    return ['path' => 'request_photos/' . $requestType . '/' . $filename, 'error' => null];
}

function request_photo_file_path(?string $storedPath): ?string {
    $storedPath = str_replace('\\', '/', trim((string)$storedPath));
    if (!preg_match('#^request_photos/(?:complaints|maintenance)/[A-Fa-f0-9]{32}\.(?:jpg|png|webp)$#', $storedPath)) {
        return null;
    }

    $uploadRoot = realpath(__DIR__ . '/../uploads');
    $photosRoot = realpath(__DIR__ . '/../uploads/request_photos');
    $filePath = realpath(__DIR__ . '/../uploads/' . $storedPath);
    if (!$uploadRoot || !$photosRoot || !$filePath || !is_file($filePath)
        || strpos($filePath, $photosRoot . DIRECTORY_SEPARATOR) !== 0
        || strpos($filePath, $uploadRoot . DIRECTORY_SEPARATOR) !== 0) {
        return null;
    }
    return $filePath;
}

function delete_request_photo(?string $storedPath): void {
    $filePath = request_photo_file_path($storedPath);
    if ($filePath !== null) {
        @unlink($filePath);
    }
}
