<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/booking_room_status.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':   listRooms(); break;
    case 'get':    getRoom(); break;
    case 'create': createRoom(); break;
    case 'update': updateRoom(); break;
    case 'delete': deleteRoom(); break;
    case 'set_status': setStatus(); break;
    case 'list_images': listRoomImages(); break;
    case 'add_images': addRoomImages(); break;
    case 'update_image': updateRoomImageCaption(); break;
    case 'move_image': moveRoomImage(); break;
    case 'delete_image': deleteRoomImageAction(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function adminRoomsDatabase(): mysqli {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        exit;
    }
    return $connect;
}

function listRooms() {
    $connect = adminRoomsDatabase();
    if (!sync_booking_room_status($connect, null)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $res = $connect->query("
        SELECT r.*,
               (SELECT COUNT(*) FROM tenants t
                WHERE t.room_id = r.room_id AND t.is_active = 1
                  AND t.move_in_date <= CURDATE()
                  AND COALESCE(t.move_out_date, '9999-12-31') > CURDATE()) AS occupants
        FROM rooms r ORDER BY r.room_number ASC
    ");
    if (!$res) {
        error_log('Room list query failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Rooms could not be loaded']);
        return;
    }
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getRoom() {
    $connect = adminRoomsDatabase();
    $id = intval($_GET['room_id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }
    if (!sync_booking_room_status($connect, $id)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room availability could not be refreshed']);
        return;
    }
    $stmt = $connect->prepare("SELECT * FROM rooms WHERE room_id = ?");
    if (!$stmt) {
        error_log('Room lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    $stmt->bind_param("i", $id);
    if (!$stmt->execute()) {
        error_log('Room lookup failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$row]);
}

function deleteRoomImage(?string $storedImage): void {
    $filename = basename((string) $storedImage);
    if ($filename === '' || $filename === '.' || $filename === '..') return;

    $uploadRoot = realpath(__DIR__ . '/../uploads');
    $roomsDir = realpath(__DIR__ . '/../uploads/rooms');
    $filePath = $roomsDir === false ? false : realpath($roomsDir . DIRECTORY_SEPARATOR . $filename);
    if ($uploadRoot === false || $roomsDir === false || $filePath === false || !is_file($filePath)) return;
    if (strpos($filePath, $roomsDir . DIRECTORY_SEPARATOR) !== 0) return;
    if (strpos($filePath, $uploadRoot . DIRECTORY_SEPARATOR) !== 0) return;
    @unlink($filePath);
}

function roomCoverUploadError(array $file): ?string {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return in_array($file['error'] ?? UPLOAD_ERR_NO_FILE, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'The room image exceeds the server upload limit'
            : 'Choose a room image to upload';
    }
    if (($file['size'] ?? 0) <= 0) {
        return 'The room image is empty or invalid';
    }
    $fileInfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = $fileInfo ? finfo_file($fileInfo, (string)($file['tmp_name'] ?? '')) : false;
    if ($fileInfo) finfo_close($fileInfo);
    return in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)
        ? null
        : 'Room image must be JPG, PNG, or WEBP';
}

function createRoom() {
    $connect = adminRoomsDatabase();
    // Accept both JSON body and multipart/form-data (for image uploads)
    if (!empty($_FILES) || !empty($_POST)) {
        $d = $_POST;
    } else {
        $d = json_decode(file_get_contents('php://input'), true) ?: [];
    }
    if (isset($_FILES['image']) && ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        $uploadError = roomCoverUploadError($_FILES['image']);
        if ($uploadError !== null) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$uploadError]);
            return;
        }
    }

    $cap = intval($d['capacity'] ?? 1);
    $rent = floatval($d['monthly_rent'] ?? 0);

    // extract into variables so bind_param receives variables (by reference)
    $room_number = $d['room_number'] ?? '';
    $room_type = $d['room_type'] ?? '';
    $status = $d['status'] ?? 'Available';
    $description = $d['description'] ?? '';

    // Handle uploaded image (if any)
    $imagePath = null;
    if (!empty($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = __DIR__ . '/../uploads/rooms/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $tmp = $_FILES['image']['tmp_name'];
        $name = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($_FILES['image']['name']));
        $target = $uploadDir . time() . '_' . $name;
        if (move_uploaded_file($tmp, $target)) {
            // store only the filename in DB (we'll build the path on the frontend)
            $imagePath = basename($target);
        }
    } elseif (!empty($d['image'])) {
        // allow client to pass an image URL/path in JSON (optional)
        // store only the basename (filename)
        $imagePath = basename($d['image']);
    }

    $stmt = $connect->prepare(
        "INSERT INTO rooms (room_number, room_type, capacity, monthly_rent, status, description, image, created_at)\n        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())"
    );
    if (!$stmt) {
        error_log('Room insert prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be created']);
        return;
    }
    $stmt->bind_param("ssidsss",
        $room_number, $room_type, $cap, $rent,
        $status, $description, $imagePath
    );
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $stmt->close();
    if ($ok) {
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
    }
    echo json_encode($ok
        ? ['type'=>'success','message'=>'Room created','room_id'=>$id]
        : ['type'=>'error','message'=>'Failed to add room or the room number already exists']);
}

function updateRoom() {
    $connect = adminRoomsDatabase();
    // Accept both JSON body and multipart/form-data (for image uploads)
    if (!empty($_FILES) || !empty($_POST)) {
        $d = $_POST;
    } else {
        $d = json_decode(file_get_contents('php://input'), true) ?: [];
    }
    if (isset($_FILES['image']) && ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        $uploadError = roomCoverUploadError($_FILES['image']);
        if ($uploadError !== null) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$uploadError]);
            return;
        }
    }
    $id = intval($d['room_id'] ?? 0);
    $cap = intval($d['capacity'] ?? 1);
    $rent = floatval($d['monthly_rent'] ?? 0);

    // extract into variables for bind_param
    $room_number = $d['room_number'] ?? '';
    $room_type = $d['room_type'] ?? '';
    $status = $d['status'] ?? '';
    $description = $d['description'] ?? '';

    $oldStmt = $connect->prepare("SELECT image FROM rooms WHERE room_id = ? LIMIT 1");
    if (!$oldStmt) {
        error_log('Room image lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    $oldStmt->bind_param("i", $id);
    $oldStmt->execute();
    $oldRoom = $oldStmt->get_result()->fetch_assoc();
    $oldStmt->close();
    if (!$oldRoom) {
        echo json_encode(['type'=>'error','message'=>'Room not found']);
        return;
    }
    $oldImagePath = basename((string) ($oldRoom['image'] ?? ''));

    // Handle uploaded image (if any)
    $imagePath = null;
    if (!empty($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $uploadDir = __DIR__ . '/../uploads/rooms/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $tmp = $_FILES['image']['tmp_name'];
        $name = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($_FILES['image']['name']));
        $target = $uploadDir . time() . '_' . $name;
        if (move_uploaded_file($tmp, $target)) {
            $imagePath = basename($target);
        }
    } elseif (isset($d['existing_image'])) {
        // keep existing image if provided; store only the filename
        $imagePath = basename($d['existing_image']);
    }

    if ($imagePath !== null) {
        $stmt = $connect->prepare(
            "UPDATE rooms SET room_number = ?, room_type = ?, capacity = ?, monthly_rent = ?,\n               status = ?, description = ?, image = ? WHERE room_id = ?"
        );
    } else {
        $stmt = $connect->prepare(
            "UPDATE rooms SET room_number = ?, room_type = ?, capacity = ?, monthly_rent = ?,\n               status = ?, description = ? WHERE room_id = ?"
        );
    }
    if (!$stmt) {
        error_log('Room update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be updated']);
        return;
    }
    if ($imagePath !== null) {
        $stmt->bind_param("ssidsssi",
            $room_number, $room_type, $cap, $rent,
            $status, $description, $imagePath, $id
        );
    } else {
        $stmt->bind_param("ssidssi",
            $room_number, $room_type, $cap, $rent,
            $status, $description, $id
        );
    }
    $ok = $stmt->execute();
    $stmt->close();
    if (!$ok && $imagePath !== null && $imagePath !== $oldImagePath) {
        deleteRoomImage($imagePath);
    }
    if ($ok) {
        if ($imagePath !== null && $imagePath !== $oldImagePath) {
            deleteRoomImage($oldImagePath);
        }
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function deleteRoom() {
    $connect = adminRoomsDatabase();
    $id = intval($_GET['room_id'] ?? 0);

    $selectStmt = $connect->prepare("SELECT image FROM rooms WHERE room_id = ? LIMIT 1");
    if (!$selectStmt) {
        error_log('Room lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be loaded']);
        return;
    }
    $selectStmt->bind_param("i", $id);
    $selectStmt->execute();
    $room = $selectStmt->get_result()->fetch_assoc();
    $selectStmt->close();

    if (!$room) {
        echo json_encode(['type' => 'error', 'message' => 'Room not found']);
        return;
    }

    $photoStmt = $connect->prepare("SELECT filename FROM room_images WHERE room_id = ?");
    if (!$photoStmt) {
        $message = roomPhotoStorageError($connect);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>$message]);
        return;
    }
    $photoStmt->bind_param("i", $id);
    $photoStmt->execute();
    $photoResult = $photoStmt->get_result();
    $photoFilenames = [];
    while ($photo = $photoResult->fetch_assoc()) {
        $photoFilenames[] = $photo['filename'];
    }
    $photoStmt->close();

    $stmt = $connect->prepare("DELETE FROM rooms WHERE room_id = ?");
    if (!$stmt) {
        error_log('Room delete prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room could not be deleted']);
        return;
    }
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok) {
        deleteRoomImage($room['image'] ?? null);
        foreach ($photoFilenames as $filename) {
            deleteRoomPhotoFile($filename);
        }
    }

    if ($ok) {
        rt_publish('/Admin/rooms.php');
        rt_publish('/Landing-Page/rooms.php');
    }

    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}

function setStatus() {
    $connect = adminRoomsDatabase();
    $id = intval($_GET['room_id'] ?? 0);
    $status = $_GET['status'] ?? '';
    $stmt = $connect->prepare("UPDATE rooms SET status = ? WHERE room_id = ?");
    if (!$stmt) {
        error_log('Room status update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room status could not be updated']);
        return;
    }
    $stmt->bind_param("si", $status, $id);
    $ok = $stmt->execute();
    $stmt->close();
    rt_publish('/Admin/rooms.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Status updated':'Failed']);
}

function roomImageJsonBody(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function roomPhotoFilePath(string $filename): ?string {
    $safeFilename = basename($filename);
    if ($safeFilename === '' || $safeFilename === '.' || $safeFilename === '..') return null;

    $uploadRoot = realpath(__DIR__ . '/../uploads');
    $roomsDir = realpath(__DIR__ . '/../uploads/rooms');
    $filePath = $roomsDir === false ? false : realpath($roomsDir . DIRECTORY_SEPARATOR . $safeFilename);
    if ($uploadRoot === false || $roomsDir === false || $filePath === false || !is_file($filePath)) return null;
    if (strpos($filePath, $roomsDir . DIRECTORY_SEPARATOR) !== 0) return null;
    if (strpos($filePath, $uploadRoot . DIRECTORY_SEPARATOR) !== 0) return null;
    return $filePath;
}

function deleteRoomPhotoFile(string $filename): void {
    $filePath = roomPhotoFilePath($filename);
    if ($filePath !== null) unlink($filePath);
}

function roomPhotoStorageError(mysqli $connect): string {
    if ($connect->errno === 1146 || stripos($connect->error, 'room_images') !== false && stripos($connect->error, "doesn't exist") !== false) {
        return 'Room photo storage is not installed. Import backend/migrations/add_room_images.sql into the application database.';
    }
    error_log('Room photo database error: ' . $connect->error);
    return 'Room photos could not be saved. Check the database connection and server log.';
}

function listRoomImages(): void {
    $connect = adminRoomsDatabase();
    $roomId = intval($_GET['room_id'] ?? 0);
    if ($roomId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required']);
        return;
    }

    $stmt = $connect->prepare(
        "SELECT image_id, filename, caption, sort_order FROM room_images WHERE room_id = ? ORDER BY sort_order ASC, image_id ASC"
    );
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>roomPhotoStorageError($connect)]);
        return;
    }
    $stmt->bind_param("i", $roomId);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be loaded']);
        return;
    }
    $result = $stmt->get_result();
    $images = [];
    while ($image = $result->fetch_assoc()) {
        $images[] = $image;
    }
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$images]);
}

function addRoomImages(): void {
    $connect = adminRoomsDatabase();
    $roomId = intval($_POST['room_id'] ?? 0);
    if ($roomId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid room ID is required','errors'=>[]]);
        return;
    }
    $files = $_FILES['images'] ?? null;
    if (!is_array($files) || !isset($files['name']) || !is_array($files['name'])) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Select at least one room photo','errors'=>[]]);
        return;
    }

    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be saved','errors'=>[]]);
        return;
    }

    $roomStmt = $connect->prepare("SELECT room_id FROM rooms WHERE room_id = ? LIMIT 1 FOR UPDATE");
    if (!$roomStmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be saved','errors'=>[]]);
        return;
    }
    $roomStmt->bind_param("i", $roomId);
    if (!$roomStmt->execute()) {
        $roomStmt->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be saved','errors'=>[]]);
        return;
    }
    $roomExists = $roomStmt->get_result()->fetch_assoc();
    $roomStmt->close();
    if (!$roomExists) {
        $connect->rollback();
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Room not found','errors'=>[]]);
        return;
    }

    $countStmt = $connect->prepare("SELECT COUNT(*) AS total FROM room_images WHERE room_id = ?");
    if (!$countStmt) {
        $message = roomPhotoStorageError($connect);
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>$message,'errors'=>[]]);
        return;
    }
    $countStmt->bind_param("i", $roomId);
    if (!$countStmt->execute()) {
        $countStmt->close();
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photos could not be saved','errors'=>[]]);
        return;
    }
    $existingCount = intval($countStmt->get_result()->fetch_assoc()['total'] ?? 0);
    $countStmt->close();

    $uploadDir = __DIR__ . '/../uploads/rooms/';
    $errors = [];
    $uploadedCount = 0;
    $sortOrder = $existingCount;
    $successfulItems = [];
    $captions = $_POST['captions'] ?? [];
    $mimeExtensions = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    foreach ($files['name'] as $index => $originalName) {
        $name = basename((string)$originalName);
        $uploadError = intval($files['error'][$index] ?? UPLOAD_ERR_NO_FILE);
        if ($uploadError !== UPLOAD_ERR_OK) {
            $message = $uploadError === UPLOAD_ERR_INI_SIZE || $uploadError === UPLOAD_ERR_FORM_SIZE
                ? 'The file exceeds the upload size limit'
                : 'The file could not be uploaded';
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>$message];
            continue;
        }
        if ($existingCount + $uploadedCount >= 12) {
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'The room photo limit is 12'];
            continue;
        }

        $size = intval($files['size'][$index] ?? 0);
        if ($size <= 0) {
            $errors[] = [
                'index'=>intval($index),
                'filename'=>$name,
                'message'=>'The file is empty or invalid',
            ];
            continue;
        }

        $tmpName = (string)($files['tmp_name'][$index] ?? '');
        $fileInfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = $fileInfo ? finfo_file($fileInfo, $tmpName) : false;
        if ($fileInfo) finfo_close($fileInfo);
        if (!is_string($mimeType) || !isset($mimeExtensions[$mimeType])) {
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'Only JPG, PNG, and WEBP photos are allowed'];
            continue;
        }

        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true)) {
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'The room photo folder is unavailable'];
            continue;
        }
        $storedName = 'room_' . $roomId . '_' . bin2hex(random_bytes(16)) . '.' . $mimeExtensions[$mimeType];
        $target = $uploadDir . $storedName;
        if (!move_uploaded_file($tmpName, $target)) {
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'The photo could not be stored'];
            continue;
        }

        $caption = trim((string)($captions[$index] ?? ''));
        $insertStmt = $connect->prepare(
            "INSERT INTO room_images (room_id, filename, caption, sort_order) VALUES (?, ?, ?, ?)"
        );
        if (!$insertStmt) {
            deleteRoomPhotoFile($storedName);
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'The photo could not be saved'];
            continue;
        }
        $insertStmt->bind_param("issi", $roomId, $storedName, $caption, $sortOrder);
        $inserted = $insertStmt->execute();
        $insertStmt->close();
        if (!$inserted) {
            deleteRoomPhotoFile($storedName);
            $errors[] = ['index'=>intval($index),'filename'=>$name,'message'=>'The photo could not be saved'];
            continue;
        }

        $uploadedCount++;
        $sortOrder++;
        $successfulItems[] = [
            'index'=>intval($index),
            'filename'=>$name,
            'stored_filename'=>$storedName,
        ];
    }

    if (!$connect->commit()) {
        $connect->rollback();
        foreach ($successfulItems as $item) {
            deleteRoomPhotoFile($item['stored_filename']);
            $errors[] = [
                'index'=>$item['index'],
                'filename'=>$item['filename'],
                'message'=>'The photo could not be saved',
            ];
        }
        $uploadedCount = 0;
    }
    $partial = count($errors) > 0;
    if ($uploadedCount > 0) {
        rt_publish('/Landing-Page/rooms.php');
    }
    echo json_encode([
        'type'=>$partial ? 'error' : 'success',
        'message'=>$partial ? 'Some room photos could not be uploaded' : 'Room photos uploaded',
        'uploaded_count'=>$uploadedCount,
        'errors'=>$errors,
    ]);
}

function updateRoomImageCaption(): void {
    $connect = adminRoomsDatabase();
    $data = roomImageJsonBody();
    $imageId = intval($data['image_id'] ?? 0);
    $caption = trim((string)($data['caption'] ?? ''));
    if ($imageId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid photo ID is required']);
        return;
    }

    $stmt = $connect->prepare("UPDATE room_images SET caption = ? WHERE image_id = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo label could not be saved']);
        return;
    }
    $stmt->bind_param("si", $caption, $imageId);
    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo label could not be saved']);
        return;
    }
    if ($affected === 0) {
        $checkStmt = $connect->prepare("SELECT image_id FROM room_images WHERE image_id = ? LIMIT 1");
        if (!$checkStmt) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Photo label could not be saved']);
            return;
        }
        $checkStmt->bind_param("i", $imageId);
        if (!$checkStmt->execute()) {
            $checkStmt->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Photo label could not be saved']);
            return;
        }
        $exists = $checkStmt->get_result()->fetch_assoc();
        $checkStmt->close();
        if (!$exists) {
            http_response_code(404);
            echo json_encode(['type'=>'error','message'=>'Room photo not found']);
            return;
        }
    }
    echo json_encode(['type'=>'success','message'=>'Photo label saved']);
}

function moveRoomImage(): void {
    $connect = adminRoomsDatabase();
    $data = roomImageJsonBody();
    $imageId = intval($data['image_id'] ?? 0);
    $direction = $data['direction'] ?? '';
    if ($imageId <= 0 || !in_array($direction, ['up', 'down'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid photo and direction are required']);
        return;
    }

    $findStmt = $connect->prepare("SELECT room_id FROM room_images WHERE image_id = ? LIMIT 1");
    if (!$findStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $findStmt->bind_param("i", $imageId);
    if (!$findStmt->execute()) {
        $findStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $row = $findStmt->get_result()->fetch_assoc();
    $findStmt->close();
    if (!$row) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Room photo not found']);
        return;
    }
    $roomId = intval($row['room_id']);

    $listStmt = $connect->prepare(
        "SELECT image_id FROM room_images WHERE room_id = ? ORDER BY sort_order ASC, image_id ASC"
    );
    if (!$listStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $listStmt->bind_param("i", $roomId);
    if (!$listStmt->execute()) {
        $listStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $result = $listStmt->get_result();
    $imageIds = [];
    while ($image = $result->fetch_assoc()) {
        $imageIds[] = intval($image['image_id']);
    }
    $listStmt->close();

    $position = array_search($imageId, $imageIds, true);
    if ($position === false) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Room photo not found']);
        return;
    }
    $targetPosition = $direction === 'up' ? $position - 1 : $position + 1;
    if ($targetPosition < 0 || $targetPosition >= count($imageIds)) {
        echo json_encode(['type'=>'success','message'=>'Photo order unchanged']);
        return;
    }
    $swapId = $imageIds[$targetPosition];
    $imageIds[$targetPosition] = $imageId;
    $imageIds[$position] = $swapId;

    if (!$connect->begin_transaction()) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $updateStmt = $connect->prepare("UPDATE room_images SET sort_order = ? WHERE image_id = ? AND room_id = ?");
    if (!$updateStmt) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
        return;
    }
    $ok = true;
    foreach ($imageIds as $sortOrder => $id) {
        $updateStmt->bind_param("iii", $sortOrder, $id, $roomId);
        if (!$updateStmt->execute()) {
            $ok = false;
            break;
        }
    }
    $updateStmt->close();
    if ($ok && $connect->commit()) {
        echo json_encode(['type'=>'success','message'=>'Photo order saved']);
    } else {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Photo order could not be saved']);
    }
}

function deleteRoomImageAction(): void {
    $connect = adminRoomsDatabase();
    $data = roomImageJsonBody();
    $imageId = intval($data['image_id'] ?? 0);
    if ($imageId <= 0) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'A valid photo ID is required']);
        return;
    }

    $findStmt = $connect->prepare("SELECT filename FROM room_images WHERE image_id = ? LIMIT 1");
    if (!$findStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photo could not be removed']);
        return;
    }
    $findStmt->bind_param("i", $imageId);
    if (!$findStmt->execute()) {
        $findStmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photo could not be removed']);
        return;
    }
    $photo = $findStmt->get_result()->fetch_assoc();
    $findStmt->close();
    if (!$photo) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Room photo not found']);
        return;
    }

    $deleteStmt = $connect->prepare("DELETE FROM room_images WHERE image_id = ?");
    if (!$deleteStmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photo could not be removed']);
        return;
    }
    $deleteStmt->bind_param("i", $imageId);
    $ok = $deleteStmt->execute();
    $deleteStmt->close();
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Room photo could not be removed']);
        return;
    }
    deleteRoomPhotoFile((string)$photo['filename']);
    echo json_encode(['type'=>'success','message'=>'Room photo removed']);
}
?>
