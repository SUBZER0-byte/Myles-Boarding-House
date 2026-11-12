<?php
include __DIR__ . '/../Config/db.php';
include __DIR__ . '/../Config/header.php';
include __DIR__ . '/../Config/realtime.php';
require_once __DIR__ . '/../Config/system_notifications.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'conversations': listConversations(); break;
    case 'messages':      listMessages(); break;
    case 'unread_count':  unreadMessageCount(); break;
    case 'send':          sendMessage(); break;
    case 'remove':        removeMessage(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function hasDatabase(): bool {
    global $connect;
    return $connect instanceof mysqli;
}

function verifiedChatUserId($source = null): int {
    global $connect;
    $uid = sec_current_user_id();
    if ($uid <= 0 && is_array($source)) {
        $uid = intval($source['user_id'] ?? 0);
    }
    if ($uid <= 0) {
        $uid = intval($_GET['user_id'] ?? 0);
    }
    if ($uid <= 0 || !hasDatabase()) {
        return 0;
    }

    $stmt = $connect->prepare("SELECT user_id FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1");
    if (!$stmt) {
        return 0;
    }
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    return $row ? $uid : 0;
}

/** Ensure schema exists (idempotent, dev convenience). */
function ensureSchema(): void {
    global $connect;
    if (!hasDatabase()) return;
    $connect->query("CREATE TABLE IF NOT EXISTS chat_messages (
        message_id INT AUTO_INCREMENT PRIMARY KEY,
        from_user_id INT NOT NULL,
        to_user_id INT NOT NULL,
        body TEXT NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        guest_name VARCHAR(255) DEFAULT NULL,
        guest_email VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pair (from_user_id, to_user_id, created_at)
    )");

    // Ensure older installations get the new guest columns if missing.
    // Use @ to suppress harmless errors on older MySQL versions.
    @ $connect->query("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_read TINYINT(1) NOT NULL DEFAULT 0");
    @ $connect->query("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255) DEFAULT NULL");
    @ $connect->query("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255) DEFAULT NULL");
    @ $connect->query("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_path VARCHAR(255) DEFAULT NULL");
    @ $connect->query("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_unsent TINYINT(1) NOT NULL DEFAULT 0");
    $connect->query("CREATE TABLE IF NOT EXISTS chat_message_images (
        image_id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat_message_images_message (message_id),
        CONSTRAINT fk_chat_message_images_message FOREIGN KEY (message_id) REFERENCES chat_messages(message_id) ON DELETE CASCADE
    )");
    $connect->query("CREATE TABLE IF NOT EXISTS chat_message_hidden (
        message_id INT NOT NULL,
        user_id INT NOT NULL,
        hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id),
        INDEX idx_chat_message_hidden_user (user_id),
        CONSTRAINT fk_chat_message_hidden_message FOREIGN KEY (message_id) REFERENCES chat_messages(message_id) ON DELETE CASCADE,
        CONSTRAINT fk_chat_message_hidden_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )");
}

function unreadMessageCount(): void {
    global $connect;
    ensureSchema();
    if (!hasDatabase()) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $me = verifiedChatUserId();
    if ($me <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $stmt = $connect->prepare("SELECT COUNT(*) AS unread_count
        FROM chat_messages m
        WHERE m.to_user_id = ? AND m.is_read = 0 AND m.is_unsent = 0
          AND NOT EXISTS (
              SELECT 1 FROM chat_message_hidden h
              WHERE h.message_id = m.message_id AND h.user_id = ?
          )");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load unread message count']);
        return;
    }
    $stmt->bind_param('ii', $me, $me);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load unread message count']);
        return;
    }
    $count = intval($stmt->get_result()->fetch_assoc()['unread_count'] ?? 0);
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>['count'=>$count]]);
}

function attachChatImages(array &$messages): bool {
    global $connect;
    $messageIds = [];
    foreach ($messages as $index => $message) {
        $messages[$index]['image_paths'] = [];
        if (!empty($message['image_path'])) {
            $messages[$index]['image_paths'][] = $message['image_path'];
        }
        $messageIds[] = intval($message['message_id']);
    }
    if (!$messageIds) return true;

    $idList = implode(',', array_map('intval', $messageIds));
    $result = $connect->query("SELECT message_id, image_path FROM chat_message_images
        WHERE message_id IN ({$idList}) ORDER BY message_id, sort_order, image_id");
    if (!$result) {
        error_log('Unable to load chat image attachments: ' . $connect->error);
        return false;
    }
    $byId = [];
    while ($row = $result->fetch_assoc()) {
        $byId[intval($row['message_id'])][] = $row['image_path'];
    }
    $result->free();
    foreach ($messages as $index => $message) {
        if (isset($byId[intval($message['message_id'])])) {
            $messages[$index]['image_paths'] = array_merge(
                $messages[$index]['image_paths'],
                $byId[intval($message['message_id'])]
            );
        }
    }
    return true;
}

function deleteChatImageFile(?string $path): void {
    if (!$path || !preg_match('#^uploads/chat_messages/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$#', $path)) {
        return;
    }
    $uploadRoot = realpath(__DIR__ . '/../uploads');
    $filePath = realpath(__DIR__ . '/../' . $path);
    if ($uploadRoot === false || $filePath === false || !is_file($filePath)) {
        return;
    }
    if (strpos($filePath, $uploadRoot . DIRECTORY_SEPARATOR) === 0) {
        if (!unlink($filePath)) {
            error_log('Chat image cleanup failed for a validated upload path');
        }
    }
}

function convoTopic(int $a, int $b): string {
    $lo = min($a, $b); $hi = max($a, $b);
    return "chat:{$lo}:{$hi}";
}

function chatUserCanContact(int $targetId): bool {
    global $connect;
    if (sec_current_user_type() !== 'Guest') return true;

    $stmt = $connect->prepare("SELECT user_id FROM users WHERE user_id = ? AND user_type = 'Admin' AND is_active = 1 LIMIT 1");
    if (!$stmt) return false;
    $stmt->bind_param("i", $targetId);
    $stmt->execute();
    $allowed = (bool) $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $allowed;
}

function listConversations() {
    global $connect;
    ensureSchema();

    if (!hasDatabase()) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $me = verifiedChatUserId();
    if ($me <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }

    $userFilter = sec_current_user_type() === 'Guest' ? "AND u.user_type = 'Admin'" : '';
    $sql = "SELECT u.user_id, u.full_name, u.username, u.email, u.user_type, u.profile_picture,
                   (SELECT CASE WHEN m.is_unsent = 1 THEN 'Message unsent'
                                WHEN (m.image_path IS NOT NULL OR EXISTS (
                                    SELECT 1 FROM chat_message_images ci WHERE ci.message_id = m.message_id
                                )) AND m.body = '' THEN '📷 Photo'
                                ELSE m.body END
                      FROM chat_messages m
                      WHERE ((m.from_user_id=u.user_id AND m.to_user_id=?)
                         OR (m.to_user_id=u.user_id AND m.from_user_id=?))
                        AND NOT EXISTS (SELECT 1 FROM chat_message_hidden h WHERE h.message_id=m.message_id AND h.user_id=?)
                      ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                   (SELECT created_at FROM chat_messages m
                      WHERE ((m.from_user_id=u.user_id AND m.to_user_id=?)
                         OR (m.to_user_id=u.user_id AND m.from_user_id=?))
                        AND NOT EXISTS (SELECT 1 FROM chat_message_hidden h WHERE h.message_id=m.message_id AND h.user_id=?)
                      ORDER BY m.created_at DESC LIMIT 1) AS last_at
            FROM users u
            WHERE u.user_id <> ?
              AND u.is_active = 1
                            {$userFilter}
            ORDER BY (last_at IS NULL), last_at DESC, u.username ASC";
    $stmt = $connect->prepare($sql);
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to load users']);
        return;
    }
    $stmt->bind_param("iiiiiii", $me,$me,$me,$me,$me,$me,$me);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();

    echo json_encode(['type'=>'success','data'=>$rows]);
}

function listMessages() {
    global $connect;
    ensureSchema();
    $peer = intval($_GET['peer_id'] ?? 0);
    if ($peer <= 0) {
        echo json_encode(['type' => 'success', 'data' => []]);
        return;
    }

    if (!hasDatabase()) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $me = verifiedChatUserId();
    if ($me <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    if (!chatUserCanContact($peer)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Guests may contact Admin users only']);
        return;
    }
    if ($peer === $me) {
        echo json_encode(['type' => 'success', 'data' => []]);
        return;
    }

    $stmt = $connect->prepare("SELECT m.* FROM chat_messages m
        WHERE ((m.from_user_id=? AND m.to_user_id=?) OR (m.from_user_id=? AND m.to_user_id=?))
          AND NOT EXISTS (SELECT 1 FROM chat_message_hidden h WHERE h.message_id=m.message_id AND h.user_id=?)
        ORDER BY created_at ASC LIMIT 500");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to load messages']);
        return;
    }
    $stmt->bind_param("iiiii", $me,$peer,$peer,$me,$me);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    $markRead = $connect->prepare("UPDATE chat_messages
        SET is_read = 1
        WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0 AND is_unsent = 0");
    if (!$markRead) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to update message read status']);
        return;
    }
    $markRead->bind_param('ii', $peer, $me);
    if (!$markRead->execute()) {
        $markRead->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to update message read status']);
        return;
    }
    $hadUnreadMessages = $markRead->affected_rows > 0;
    $markRead->close();
    if ($hadUnreadMessages) {
        rt_publish("chat-list:{$me}", 'update');
        rt_publish(convoTopic($me, $peer), 'read_status', ['reader_id' => $me]);
    }
    if (!attachChatImages($rows)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to load message images']);
        return;
    }

    echo json_encode(['type'=>'success','data'=>$rows]);
}

function sendMessage() {
    global $connect;
    ensureSchema();
    $isMultipart = isset($_FILES['images']) || isset($_FILES['image']);
    $d = $isMultipart ? $_POST : json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) $d = [];
    if (!hasDatabase()) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $sessionUid = verifiedChatUserId($d);
    if ($sessionUid <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }

    $from = $sessionUid;
    $to   = intval($d['to_user_id'] ?? 0);
    $body = trim((string)($d['body'] ?? ''));
    $imageFiles = [];
    if (isset($_FILES['images']) && is_array($_FILES['images']['name'] ?? null)) {
        $files = $_FILES['images'];
        foreach ($files['name'] as $index => $name) {
            $imageFiles[] = [
                'name' => $name,
                'type' => $files['type'][$index] ?? '',
                'tmp_name' => $files['tmp_name'][$index] ?? '',
                'error' => $files['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                'size' => $files['size'][$index] ?? 0,
            ];
        }
    } elseif (isset($_FILES['image']) && is_array($_FILES['image'])) {
        $imageFiles[] = $_FILES['image'];
    }
    if ($to <= 0 || ($body === '' && !$imageFiles)) {
        echo json_encode(['type'=>'error','message'=>'Missing fields']); return;
    }
    if (count($imageFiles) > 5) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'You can attach up to 5 images per message']);
        return;
    }
    if ($to === $from) {
        echo json_encode(['type'=>'error','message'=>'You cannot send a message to yourself']);
        return;
    }
    if (!chatUserCanContact($to)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Guests may contact Admin users only']);
        return;
    }
    // Per-user spam guard: 30 messages / 60s
    if (!sec_throttle('chat_send_' . $sessionUid, 30, 60)) {
        http_response_code(429);
        echo json_encode(['type'=>'error','message'=>'Sending too fast. Slow down.']);
        return;
    }
    // Hard cap on body length
    if (mb_strlen($body) > 4000) $body = mb_substr($body, 0, 4000);

    $uploadedImagePaths = [];
    $uploadDir = __DIR__ . '/../uploads/chat_messages/';
    $mimeExtensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $totalImageSize = 0;
    foreach ($imageFiles as $imageFile) {
        $uploadError = intval($imageFile['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($uploadError !== UPLOAD_ERR_OK) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>$uploadError === UPLOAD_ERR_INI_SIZE || $uploadError === UPLOAD_ERR_FORM_SIZE
                ? 'An image exceeds the server upload limit'
                : 'One of the selected images could not be uploaded']);
            return;
        }
        $size = intval($imageFile['size'] ?? 0);
        if ($size <= 0 || $size > 30 * 1024 * 1024) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Each chat image must be smaller than 30 MB']);
            return;
        }
        $totalImageSize += $size;
        if ($totalImageSize > 150 * 1024 * 1024) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Selected images must total less than 150 MB']);
            return;
        }
        $tmpName = (string)($imageFile['tmp_name'] ?? '');
        $fileInfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = $fileInfo ? finfo_file($fileInfo, $tmpName) : false;
        if ($fileInfo) finfo_close($fileInfo);
        if (!is_string($mimeType) || !isset($mimeExtensions[$mimeType])) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Only JPG, PNG, and WEBP images are allowed']);
            return;
        }
        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Chat image storage is unavailable']);
            return;
        }
        $storedName = 'chat_' . bin2hex(random_bytes(16)) . '.' . $mimeExtensions[$mimeType];
        if (!move_uploaded_file($tmpName, $uploadDir . $storedName)) {
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to save chat image']);
            return;
        }
        $uploadedImagePaths[] = 'uploads/chat_messages/' . $storedName;
    }

    $connect->begin_transaction();
    $imagePath = null;
    $stmt = $connect->prepare("INSERT INTO chat_messages (from_user_id,to_user_id,body,guest_name,guest_email,image_path) VALUES (?,?,?,?,?,?)");
    $null = null;
    if (!$stmt || !$stmt->bind_param("iissss", $from,$to,$body,$null,$null,$imagePath) || !$stmt->execute()) {
        if ($stmt) $stmt->close();
        $connect->rollback();
        foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to save message']);
        return;
    }
    $id = $stmt->insert_id;
    $stmt->close();
    if ($uploadedImagePaths) {
        $insertImage = $connect->prepare("INSERT INTO chat_message_images (message_id, image_path, sort_order) VALUES (?, ?, ?)");
        if (!$insertImage) {
            $connect->rollback();
            foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Failed to save message images']);
            return;
        }
        foreach ($uploadedImagePaths as $index => $path) {
            $sortOrder = $index;
            if (!$insertImage->bind_param('isi', $id, $path, $sortOrder) || !$insertImage->execute()) {
                $insertImage->close();
                $connect->rollback();
                foreach ($uploadedImagePaths as $uploadedPath) deleteChatImageFile($uploadedPath);
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Failed to save message images']);
                return;
            }
        }
        $insertImage->close();
    }
    if (!$connect->commit()) {
        $connect->rollback();
        foreach ($uploadedImagePaths as $path) deleteChatImageFile($path);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to save message']);
        return;
    }

    $msg = [
        'message_id' => $id,
        'from_user_id' => $from,
        'to_user_id'   => $to,
        'body'         => $body,
        'is_read'      => 0,
        'image_path'   => null,
        'image_paths'  => $uploadedImagePaths,
        'is_unsent'    => 0,
        'created_at'   => date('Y-m-d H:i:s'),
    ];

    $sender = $connect->prepare("SELECT full_name, username FROM users WHERE user_id = ? LIMIT 1");
    $senderName = 'User #' . $from;
    if ($sender) {
        $sender->bind_param('i', $from);
        if ($sender->execute()) {
            $row = $sender->get_result()->fetch_assoc();
            if ($row) {
                $senderName = trim((string)($row['full_name'] ?? '')) ?: trim((string)($row['username'] ?? '')) ?: $senderName;
            }
        }
        $sender->close();
    }
    system_notify_user($connect, $to, 'New message', "You have a new message from {$senderName}.", 'message');

    // INSTANT push to both participants
    rt_publish(convoTopic($from,$to), 'message', $msg);
    // Also bump each user's conversation list
    rt_publish("chat-list:{$from}", 'update');
    rt_publish("chat-list:{$to}",   'update');

    echo json_encode(['type'=>'success','data'=>$msg]);
}

function removeMessage(): void {
    global $connect;
    ensureSchema();
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) $data = [];
    if (!hasDatabase()) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }
    $me = verifiedChatUserId($data);
    if ($me <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        return;
    }
    $messageId = intval($data['message_id'] ?? 0);
    $mode = (string)($data['mode'] ?? '');
    if ($messageId <= 0 || !in_array($mode, ['delete_for_me', 'unsend'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid message removal request']);
        return;
    }
    $stmt = $connect->prepare("SELECT message_id, from_user_id, to_user_id, image_path
        FROM chat_messages WHERE message_id = ? AND (from_user_id = ? OR to_user_id = ?) LIMIT 1");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to remove message']);
        return;
    }
    $stmt->bind_param('iii', $messageId, $me, $me);
    $stmt->execute();
    $message = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$message) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Message not found']);
        return;
    }

    if ($mode === 'unsend') {
        if (intval($message['from_user_id']) !== $me) {
            http_response_code(403);
            echo json_encode(['type'=>'error','message'=>'You can only unsend your own messages']);
            return;
        }
        $imagePaths = [];
        if (is_string($message['image_path']) && $message['image_path'] !== '') {
            $imagePaths[] = $message['image_path'];
        }
        $imageStmt = $connect->prepare("SELECT image_path FROM chat_message_images WHERE message_id = ?");
        if (!$imageStmt) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to unsend message']);
            return;
        }
        $imageStmt->bind_param('i', $messageId);
        if (!$imageStmt->execute()) {
            $imageStmt->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to unsend message']);
            return;
        }
        $imageResult = $imageStmt->get_result();
        while ($image = $imageResult->fetch_assoc()) {
            $imagePaths[] = $image['image_path'];
        }
        $imageStmt->close();

        $connect->begin_transaction();
        $stmt = $connect->prepare("UPDATE chat_messages SET body = '', image_path = NULL, is_unsent = 1
            WHERE message_id = ? AND from_user_id = ? AND is_unsent = 0");
        if (!$stmt) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to unsend message']);
            return;
        }
        $stmt->bind_param('ii', $messageId, $me);
        $ok = $stmt->execute() && $stmt->affected_rows === 1;
        $stmt->close();
        if (!$ok) {
            $connect->rollback();
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'Message was already unsent']);
            return;
        }
        $deleteImages = $connect->prepare("DELETE FROM chat_message_images WHERE message_id = ?");
        if (!$deleteImages) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to remove message images']);
            return;
        }
        $deleteImages->bind_param('i', $messageId);
        $ok = $deleteImages->execute();
        $deleteImages->close();
        if (!$ok || !$connect->commit()) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to unsend message']);
            return;
        }
        foreach ($imagePaths as $imagePath) {
            deleteChatImageFile($imagePath);
        }
    } else {
        $stmt = $connect->prepare("INSERT IGNORE INTO chat_message_hidden (message_id, user_id) VALUES (?, ?)");
        if (!$stmt) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to delete message']);
            return;
        }
        $stmt->bind_param('ii', $messageId, $me);
        $ok = $stmt->execute();
        $stmt->close();
        if (!$ok) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to delete message']);
            return;
        }
    }

    $from = intval($message['from_user_id']);
    $to = intval($message['to_user_id']);
    rt_publish(convoTopic($from, $to), 'message_removed', ['message_id' => $messageId]);
    rt_publish("chat-list:{$from}", 'update');
    rt_publish("chat-list:{$to}", 'update');
    echo json_encode(['type'=>'success','message'=>'Message removed']);
}
