<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/gcash_qr.php';

sec_require_admin();

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'get_profile':    getProfile(); break;
    case 'update_profile': updateProfile(); break;
    case 'change_password': changePassword(); break;
    case 'upload_profile_picture': uploadProfilePicture(); break;
    case 'upload_user_profile_picture': uploadUserProfilePicture(); break;
    case 'upload_gcash_qr': uploadGcashQr(); break;
    case 'list_gcash_qrs': listGcashQrs(); break;
    case 'crop_gcash_qr': cropGcashQr(); break;
    case 'get_gcash_qr_image': getGcashQrImage(); break;
    case 'update_gcash_qr': updateGcashQr(); break;
    case 'delete_gcash_qr': deleteGcashQr(); break;
    case 'get_settings':   getSettings(); break;
    case 'list_chatbot_faqs': getChatbotFaqs(); break;
    case 'save_chatbot_faq': saveChatbotFaq(); break;
    case 'delete_chatbot_faq': deleteChatbotFaq(); break;
    case 'list_chatbot_suggested_questions': getChatbotSuggestedQuestions(); break;
    case 'save_chatbot_suggested_question': saveChatbotSuggestedQuestion(); break;
    case 'delete_chatbot_suggested_question': deleteChatbotSuggestedQuestion(); break;
    case 'get_admin_api_keys': getAdminApiKeys(); break;
    case 'update_settings': updateSettings(); break;
    case 'payment_mode': paymentMode(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function getChatbotFaqs(): void {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $result = $connect->query(
        'SELECT faq_id, category, question, answer, is_active FROM chatbot_faqs ORDER BY category, sort_order, faq_id'
    );
    if (!$result) {
        error_log('Chatbot FAQ list failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load chatbot FAQs']);
        return;
    }

    echo json_encode(['type' => 'success', 'data' => $result->fetch_all(MYSQLI_ASSOC)]);
}

function saveChatbotFaq(): void {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $data = json_decode(file_get_contents('php://input'), true);
    $faqId = is_array($data) ? (int)($data['faq_id'] ?? 0) : 0;
    $category = is_array($data) ? trim((string)($data['category'] ?? '')) : '';
    $question = is_array($data) ? trim((string)($data['question'] ?? '')) : '';
    $answer = is_array($data) ? trim((string)($data['answer'] ?? '')) : '';
    $isActive = is_array($data) && !empty($data['is_active']) ? 1 : 0;
    $isSuggested = 0;
    $categories = ['rates', 'availability', 'house_rules', 'payment_methods', 'reservation_steps', 'location', 'other'];

    if (!in_array($category, $categories, true)
        || $question === '' || mb_strlen($question) > 255
        || $answer === '' || mb_strlen($answer) > 5000
        || $faqId < 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter a valid FAQ category, question, and answer']);
        return;
    }

    if ($faqId > 0) {
        $stmt = $connect->prepare(
            'UPDATE chatbot_faqs SET category = ?, question = ?, answer = ?, is_active = ?, is_suggested = ? WHERE faq_id = ?'
        );
        if (!$stmt) {
            error_log('Chatbot FAQ update failed: unable to prepare query');
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to prepare FAQ update']);
            return;
        }
        $stmt->bind_param('sssiii', $category, $question, $answer, $isActive, $isSuggested, $faqId);
    } else {
        $stmt = $connect->prepare(
            'INSERT INTO chatbot_faqs (category, question, answer, is_active, is_suggested) VALUES (?, ?, ?, ?, ?)'
        );
        if (!$stmt) {
            error_log('Chatbot FAQ save failed: unable to prepare query');
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to prepare FAQ save']);
            return;
        }
        $stmt->bind_param('sssii', $category, $question, $answer, $isActive, $isSuggested);
    }

    if (!$stmt->execute()) {
        error_log('Chatbot FAQ save failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to save chatbot FAQ']);
        return;
    }
    $stmt->close();
    rt_publish('/Admin/settings.php');
    echo json_encode(['type' => 'success', 'message' => 'Chatbot FAQ saved']);
}

function deleteChatbotFaq(): void {
    global $connect;
    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type' => 'error', 'message' => 'Database connection unavailable']);
        return;
    }

    $data = json_decode(file_get_contents('php://input'), true);
    $faqId = is_array($data) ? (int)($data['faq_id'] ?? 0) : 0;
    if ($faqId <= 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid FAQ ID']);
        return;
    }

    $stmt = $connect->prepare('DELETE FROM chatbot_faqs WHERE faq_id = ?');
    if (!$stmt) {
        error_log('Chatbot FAQ deletion failed: unable to prepare query');
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to prepare FAQ deletion']);
        return;
    }
    $stmt->bind_param('i', $faqId);
    if (!$stmt->execute()) {
        error_log('Chatbot FAQ deletion failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to delete chatbot FAQ']);
        return;
    }
    $stmt->close();
    rt_publish('/Admin/settings.php');
    echo json_encode(['type' => 'success', 'message' => 'Chatbot FAQ deleted']);
}

function getChatbotSuggestedQuestions(): void {
    global $connect;
    $result = $connect->query(
        'SELECT suggested_question_id, question, is_active FROM chatbot_suggested_questions ORDER BY sort_order, suggested_question_id'
    );
    if (!$result) {
        error_log('Chatbot suggested question list failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to load suggested questions']);
        return;
    }

    echo json_encode(['type' => 'success', 'data' => $result->fetch_all(MYSQLI_ASSOC)]);
}

function saveChatbotSuggestedQuestion(): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $question = is_array($data) ? trim((string)($data['question'] ?? '')) : '';
    $id = is_array($data) ? (int)($data['suggested_question_id'] ?? 0) : 0;
    if ($question === '' || mb_strlen($question) > 255 || $id < 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Enter a question of 1 to 255 characters']);
        return;
    }

    $stmt = $id > 0
        ? $connect->prepare('UPDATE chatbot_suggested_questions SET question = ? WHERE suggested_question_id = ?')
        : $connect->prepare('INSERT INTO chatbot_suggested_questions (question) VALUES (?)');
    if (!$stmt) {
        error_log('Chatbot suggested question save failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to prepare suggested question']);
        return;
    }

    if ($id > 0) {
        $stmt->bind_param('si', $question, $id);
    } else {
        $stmt->bind_param('s', $question);
    }
    if (!$stmt->execute()) {
        error_log('Chatbot suggested question save failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to save suggested question']);
        return;
    }
    if ($id > 0 && $stmt->affected_rows === 0) {
        $stmt->close();
        $exists = $connect->prepare('SELECT 1 FROM chatbot_suggested_questions WHERE suggested_question_id = ? LIMIT 1');
        if (!$exists) {
            error_log('Chatbot suggested question existence check failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to verify suggested question']);
            return;
        }
        $exists->bind_param('i', $id);
        if (!$exists->execute()) {
            error_log('Chatbot suggested question existence check failed: ' . $exists->error);
            $exists->close();
            http_response_code(500);
            echo json_encode(['type' => 'error', 'message' => 'Unable to verify suggested question']);
            return;
        }
        $found = (bool)$exists->get_result()->fetch_assoc();
        $exists->close();
        if (!$found) {
            http_response_code(404);
            echo json_encode(['type' => 'error', 'message' => 'Suggested question not found']);
            return;
        }
    } else {
        $stmt->close();
    }
    rt_publish('/Admin/settings.php');
    echo json_encode(['type' => 'success', 'message' => $id > 0 ? 'Suggested question updated' : 'Suggested question added']);
}

function deleteChatbotSuggestedQuestion(): void {
    global $connect;
    $data = json_decode(file_get_contents('php://input'), true);
    $id = is_array($data) ? (int)($data['suggested_question_id'] ?? 0) : 0;
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['type' => 'error', 'message' => 'Invalid suggested question ID']);
        return;
    }

    $stmt = $connect->prepare('DELETE FROM chatbot_suggested_questions WHERE suggested_question_id = ?');
    if (!$stmt) {
        error_log('Chatbot suggested question delete failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to prepare suggested question deletion']);
        return;
    }
    $stmt->bind_param('i', $id);
    if (!$stmt->execute()) {
        error_log('Chatbot suggested question delete failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type' => 'error', 'message' => 'Unable to delete suggested question']);
        return;
    }
    $stmt->close();
    rt_publish('/Admin/settings.php');
    echo json_encode(['type' => 'success', 'message' => 'Suggested question deleted']);
}

function getProfile() {
    global $connect;
    $id = sec_current_user_id();
    $stmt = $connect->prepare("
        SELECT user_id, full_name, username, email, phone, user_type, profile_picture, created_at
        FROM users WHERE user_id = ?
    ");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}

function updateProfile() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $id = sec_current_user_id();
    $stmt = $connect->prepare("UPDATE users SET full_name = ?, email = ?, phone = ? WHERE user_id = ?");
    $stmt->bind_param("sssi", $d['full_name'], $d['email'], $d['phone'], $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function uploadProfilePicture() {
    global $connect;
    $uid = intval($_POST['user_id'] ?? 0);
    if ($uid <= 0 || $uid !== sec_current_user_id() || sec_current_user_type() !== 'Admin' || empty($_FILES['profile_picture']['tmp_name'])) {
        echo json_encode(['type'=>'error','message'=>'No profile picture uploaded']);
        return;
    }
    $file = $_FILES['profile_picture'];
    $mime = mime_content_type($file['tmp_name']) ?: '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) || ($file['size'] ?? 0) > 10 * 1024 * 1024) {
        echo json_encode(['type'=>'error','message'=>'Profile picture must be JPG, PNG, or WEBP and 10MB or smaller']);
        return;
    }
    $stmt = $connect->prepare('SELECT username, profile_picture FROM users WHERE user_id = ? LIMIT 1');
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$user) { echo json_encode(['type'=>'error','message'=>'User not found']); return; }
    $dir = __DIR__ . '/../uploads/profile_pictures/';
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) { echo json_encode(['type'=>'error','message'=>'Unable to create upload folder']); return; }
    $ext = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
    $name = preg_replace('/[^A-Za-z0-9_-]/', '_', $user['username'] ?: 'user') . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $dir . $name)) { echo json_encode(['type'=>'error','message'=>'Unable to save profile picture']); return; }
    $stored = 'profile_pictures/' . $name;
    $update = $connect->prepare('UPDATE users SET profile_picture = ? WHERE user_id = ?');
    $update->bind_param('si', $stored, $uid);
    $ok = $update->execute();
    $update->close();
    if ($ok) {
        sec_delete_profile_picture($user['profile_picture'] ?? null);
        rt_publish('/Admin/settings.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Profile picture updated':'Failed to update profile picture']);
}

function uploadUserProfilePicture(): void {
    global $connect;

    $userId = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT);
    $file = $_FILES['profile_picture'] ?? null;
    if (!$userId || $userId <= 0 || !is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Choose a profile picture to upload']);
        return;
    }
    if (($file['size'] ?? 0) > 10 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Profile picture must be 10MB or smaller']);
        return;
    }

    $mime = mime_content_type($file['tmp_name']) ?: '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Profile picture must be JPG, PNG, or WEBP']);
        return;
    }

    $lookup = $connect->prepare("SELECT username, profile_picture FROM users WHERE user_id = ? AND user_type IN ('Guest', 'Tenant') LIMIT 1");
    if (!$lookup) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load user account']);
        return;
    }
    $lookup->bind_param('i', $userId);
    if (!$lookup->execute()) {
        $lookup->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load user account']);
        return;
    }
    $user = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    if (!$user) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Guest or Tenant login account not found']);
        return;
    }

    $directory = __DIR__ . '/../uploads/profile_pictures/';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to create profile picture folder']);
        return;
    }
    $extension = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
    $baseName = preg_replace('/[^A-Za-z0-9_-]/', '_', (string)($user['username'] ?: 'user'));
    $fileName = $baseName . '_' . bin2hex(random_bytes(8)) . '.' . $extension;
    $targetPath = $directory . $fileName;
    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save profile picture']);
        return;
    }

    $storedPath = 'profile_pictures/' . $fileName;
    $update = $connect->prepare('UPDATE users SET profile_picture = ? WHERE user_id = ?');
    if (!$update) {
        @unlink($targetPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update profile picture']);
        return;
    }
    $update->bind_param('si', $storedPath, $userId);
    $ok = $update->execute();
    $error = $update->error;
    $update->close();
    if (!$ok) {
        @unlink($targetPath);
        error_log('Managed profile picture update failed: ' . $error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update profile picture']);
        return;
    }

    sec_delete_profile_picture($user['profile_picture'] ?? null);
    rt_publish('/Admin/guests.php');
    rt_publish('/Admin/tenants.php');
    echo json_encode(['type'=>'success','message'=>'Profile picture updated','profile_picture'=>$storedPath]);
}

function uploadGcashQr(): void {
    global $connect;
    if (!gcash_qr_ensure_amount_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to initialize fixed GCash QR amounts']);
        return;
    }
    $file = $_FILES['gcash_qr'] ?? null;
    $amount = filter_var($_POST['amount'] ?? null, FILTER_VALIDATE_FLOAT);
    if ($amount === false || $amount <= 0 || round($amount, 2) !== $amount) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a valid fixed amount for this GCash QR']);
        return;
    }
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(400);
        $message = in_array($file['error'] ?? UPLOAD_ERR_NO_FILE, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
            ? 'GCash QR image exceeds the server upload limit'
            : 'Choose a GCash QR image to upload';
        echo json_encode(['type'=>'error','message'=>$message]);
        return;
    }
    if (($file['size'] ?? 0) > 10 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'GCash QR image must be 10MB or smaller']);
        return;
    }

    $image = @getimagesize($file['tmp_name']);
    $mime = $image['mime'] ?? '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'GCash QR image must be JPG, PNG, or WEBP']);
        return;
    }

    $dir = __DIR__ . '/../uploads/gcash_qr/';
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to create GCash QR upload folder']);
        return;
    }
    $ext = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
    $name = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $dir . $name)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save GCash QR image']);
        return;
    }

    $stmt = $connect->prepare('INSERT INTO gcash_qr_codes (filename, amount) VALUES (?, ?)');
    if (!$stmt) {
        @unlink($dir . $name);
        error_log('GCash QR amount insert prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to prepare GCash QR amount storage']);
        return;
    }
    $stmt->bind_param('sd', $name, $amount);
    if (!$stmt->execute()) {
        $databaseError = $stmt->error;
        error_log('GCash QR amount insert failed: ' . $databaseError);
        $duplicate = str_contains(strtolower($databaseError), 'duplicate');
        $stmt->close();
        @unlink($dir . $name);
        http_response_code($duplicate ? 409 : 500);
        echo json_encode(['type'=>'error','message'=>$duplicate
            ? 'A GCash QR already exists for this fixed amount'
            : 'Unable to save GCash QR amount']);
        return;
    }
    $stmt->close();
    rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>'success','message'=>'GCash QR added for ₱' . number_format((float)$amount, 2)]);
}

function listGcashQrs(): void {
    global $connect;
    if (!gcash_qr_ensure_amount_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load fixed GCash QR amounts']);
        return;
    }
    $dir = __DIR__ . '/../uploads/gcash_qr/';
    if (!is_dir($dir)) {
        echo json_encode(['type'=>'success','data'=>['images'=>[]]]);
        return;
    }

    $filenames = scandir($dir);
    if ($filenames === false) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to list GCash QR images']);
        return;
    }
    $amounts = [];
    $amountResult = $connect->query('SELECT filename, amount FROM gcash_qr_codes');
    if (!$amountResult) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load GCash QR amounts']);
        return;
    }
    while ($qr = $amountResult->fetch_assoc()) {
        $amounts[(string)$qr['filename']] = $qr['amount'] === null ? null : (float)$qr['amount'];
    }
    $images = [];
    foreach ($filenames as $filename) {
        if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)) {
            continue;
        }
        $path = $dir . $filename;
        if (is_link($path) || !is_file($path)) {
            continue;
        }
        $modifiedAt = filemtime($path);
        $images[] = [
            'filename' => $filename,
            'path' => 'uploads/gcash_qr/' . $filename,
            'amount' => $amounts[$filename] ?? null,
            'uploaded_at' => (int)($modifiedAt === false ? 0 : $modifiedAt),
            'is_active' => false,
        ];
    }
    usort($images, static fn(array $a, array $b): int => $b['uploaded_at'] <=> $a['uploaded_at']);
    echo json_encode(['type'=>'success','data'=>['images'=>$images]]);
}

function getGcashQrImage(): void {
    $filename = is_string($_GET['filename'] ?? null) ? $_GET['filename'] : '';
    if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid GCash QR image']);
        return;
    }

    $dir = __DIR__ . '/../uploads/gcash_qr/';
    $directoryPath = realpath($dir);
    $imagePath = $dir . $filename;
    $resolvedImagePath = realpath($imagePath);
    if ($directoryPath === false || $resolvedImagePath === false || is_link($imagePath)
        || !is_file($resolvedImagePath) || dirname($resolvedImagePath) !== $directoryPath) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'GCash QR image not found']);
        return;
    }

    $image = @getimagesize($resolvedImagePath);
    $mime = $image['mime'] ?? '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        http_response_code(415);
        echo json_encode(['type'=>'error','message'=>'Saved GCash QR is not a supported image']);
        return;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string)filesize($resolvedImagePath));
    header('Cache-Control: private, no-store');
    readfile($resolvedImagePath);
}

function cropGcashQr(): void {
    $filename = is_string($_POST['filename'] ?? null) ? $_POST['filename'] : '';
    if (!preg_match('/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/', $filename, $matches)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid GCash QR image']);
        return;
    }

    $file = $_FILES['gcash_qr'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Choose a cropped GCash QR image']);
        return;
    }
    if (($file['size'] ?? 0) > 10 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Cropped GCash QR image must be 10MB or smaller']);
        return;
    }

    $image = @getimagesize((string)$file['tmp_name']);
    $mime = $image['mime'] ?? '';
    $extension = $mime === 'image/jpeg' ? 'jpg' : ($mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : ''));
    if ($extension === '' || $extension !== $matches[1]) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Cropped image format must match the saved QR image']);
        return;
    }

    $dir = __DIR__ . '/../uploads/gcash_qr/';
    $directoryPath = realpath($dir);
    $imagePath = $dir . $filename;
    $resolvedImagePath = realpath($imagePath);
    if ($directoryPath === false || $resolvedImagePath === false || is_link($imagePath)
        || !is_file($resolvedImagePath) || dirname($resolvedImagePath) !== $directoryPath) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Saved GCash QR image not found']);
        return;
    }
    $originalModifiedAt = filemtime($resolvedImagePath);

    $token = bin2hex(random_bytes(8));
    $tempPath = $dir . '.crop-' . $token . '.' . $extension;
    $backupPath = $dir . '.backup-' . $token;
    if (!move_uploaded_file((string)$file['tmp_name'], $tempPath)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to save cropped GCash QR image']);
        return;
    }
    if (!rename($resolvedImagePath, $backupPath)) {
        @unlink($tempPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to replace saved GCash QR image']);
        return;
    }
    if (!rename($tempPath, $imagePath)) {
        rename($backupPath, $imagePath);
        @unlink($tempPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to replace saved GCash QR image']);
        return;
    }
    @unlink($backupPath);
    if ($originalModifiedAt !== false) {
        touch($imagePath, $originalModifiedAt);
    }
    rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>'success','message'=>'GCash QR image cropped']);
}

function updateGcashQr(): void {
    global $connect;
    if (!gcash_qr_ensure_amount_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to initialize fixed GCash QR amounts']);
        return;
    }
    $data = !empty($_POST)
        ? $_POST
        : json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($data)) $data = [];
    $filename = is_array($data) && is_string($data['filename'] ?? null) ? $data['filename'] : '';
    $amount = filter_var($data['amount'] ?? null, FILTER_VALIDATE_FLOAT);
    if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)
        || $amount === false || $amount <= 0 || round($amount, 2) !== $amount) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Enter a valid QR image and fixed amount']);
        return;
    }
    $qrDir = realpath(__DIR__ . '/../uploads/gcash_qr');
    $qrPath = $qrDir === false ? false : realpath($qrDir . DIRECTORY_SEPARATOR . $filename);
    if ($qrDir === false || $qrPath === false || is_link(__DIR__ . '/../uploads/gcash_qr/' . $filename)
        || !is_file($qrPath) || dirname($qrPath) !== $qrDir) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'GCash QR image not found']);
        return;
    }

    $replacement = $_FILES['gcash_qr'] ?? null;
    $newFilename = $filename;
    $newPath = null;
    if (is_array($replacement) && ($replacement['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
        if (($replacement['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || ($replacement['size'] ?? 0) > 10 * 1024 * 1024) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Replacement GCash QR image must be 10MB or smaller']);
            return;
        }
        $image = @getimagesize((string)$replacement['tmp_name']);
        $mime = $image['mime'] ?? '';
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Replacement GCash QR image must be JPG, PNG, or WEBP']);
            return;
        }
        $ext = $mime === 'image/png' ? 'png' : ($mime === 'image/webp' ? 'webp' : 'jpg');
        $newFilename = bin2hex(random_bytes(16)) . '.' . $ext;
        $newPath = $qrDir . DIRECTORY_SEPARATOR . $newFilename;
        if (!move_uploaded_file((string)$replacement['tmp_name'], $newPath)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to save replacement GCash QR image']);
            return;
        }
    }

    if (!$connect->begin_transaction()) {
        if ($newPath !== null) @unlink($newPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to prepare GCash QR update']);
        return;
    }
    $exists = $connect->prepare('SELECT qr_id FROM gcash_qr_codes WHERE filename = ? LIMIT 1');
    if (!$exists) {
        $connect->rollback();
        if ($newPath !== null) @unlink($newPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify the saved GCash QR']);
        return;
    }
    $exists->bind_param('s', $filename);
    if (!$exists->execute()) {
        $exists->close();
        $connect->rollback();
        if ($newPath !== null) @unlink($newPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify the saved GCash QR']);
        return;
    }
    $qrExists = (bool)$exists->get_result()->fetch_assoc();
    $exists->close();

    $stmt = $qrExists
        ? $connect->prepare('UPDATE gcash_qr_codes SET filename = ?, amount = ? WHERE filename = ?')
        : $connect->prepare('INSERT INTO gcash_qr_codes (filename, amount) VALUES (?, ?)');
    if (!$stmt) {
        $connect->rollback();
        if ($newPath !== null) @unlink($newPath);
        error_log('GCash QR update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to prepare GCash QR update']);
        return;
    }
    if ($qrExists) {
        $stmt->bind_param('sds', $newFilename, $amount, $filename);
    } else {
        $stmt->bind_param('sd', $newFilename, $amount);
    }
    if (!$stmt->execute()) {
        $error = $stmt->error;
        $stmt->close();
        $connect->rollback();
        if ($newPath !== null) @unlink($newPath);
        http_response_code(str_contains(strtolower($error), 'duplicate') ? 409 : 500);
        echo json_encode(['type'=>'error','message'=>str_contains(strtolower($error), 'duplicate')
            ? 'A GCash QR already exists for this fixed amount'
            : 'Unable to update GCash QR']);
        return;
    }
    $stmt->close();
    if ($newPath !== null) {
        $oldSettingPath = 'uploads/gcash_qr/' . $filename;
        $newSettingPath = 'uploads/gcash_qr/' . $newFilename;
        $setting = $connect->prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'gcash_qr_image' AND setting_value = ?");
        if (!$setting) {
            $connect->rollback();
            @unlink($newPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update the saved GCash QR reference']);
            return;
        }
        $legacySettingPath = 'gcash_qr/' . $filename;
        $setting->bind_param('ss', $newSettingPath, $oldSettingPath);
        if (!$setting->execute()) {
            $setting->close();
            $connect->rollback();
            @unlink($newPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update the saved GCash QR reference']);
            return;
        }
        $setting->close();
        $setting = $connect->prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'gcash_qr_image' AND setting_value = ?");
        if (!$setting) {
            $connect->rollback();
            @unlink($newPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update the saved GCash QR reference']);
            return;
        }
        $legacyNewPath = 'gcash_qr/' . $newFilename;
        $setting->bind_param('ss', $legacyNewPath, $legacySettingPath);
        if (!$setting->execute()) {
            $setting->close();
            $connect->rollback();
            @unlink($newPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update the saved GCash QR reference']);
            return;
        }
        $setting->close();
    }
    if (!$connect->commit()) {
        if ($newPath !== null) @unlink($newPath);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to complete GCash QR update']);
        return;
    }
    if ($newPath !== null) @unlink($qrPath);
    rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>'success','message'=>'GCash QR updated']);
}

function deleteGcashQr(): void {
    global $connect;
    if (!gcash_qr_ensure_amount_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to initialize fixed GCash QR amounts']);
        return;
    }
    $data = json_decode(file_get_contents('php://input'), true);
    $filename = is_array($data) && is_string($data['filename'] ?? null) ? $data['filename'] : '';
    if (!preg_match('/^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/', $filename)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid GCash QR image']);
        return;
    }

    $dir = __DIR__ . '/../uploads/gcash_qr/';
    $directoryPath = realpath($dir);
    $imagePath = $dir . $filename;
    $resolvedImagePath = realpath($imagePath);
    if ($directoryPath === false || $resolvedImagePath === false || is_link($imagePath)
        || !is_file($resolvedImagePath) || dirname($resolvedImagePath) !== $directoryPath) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'GCash QR image not found']);
        return;
    }

    if (!unlink($resolvedImagePath)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to delete GCash QR image']);
        return;
    }

    $stmt = $connect->prepare('DELETE FROM gcash_qr_codes WHERE filename = ?');
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'QR deleted, but its saved amount could not be cleared']);
        return;
    }
    $stmt->bind_param('s', $filename);
    $deleted = $stmt->execute();
    $stmt->close();
    if (!$deleted) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'QR deleted, but its saved amount could not be cleared']);
        return;
    }

    rt_publish('/Admin/settings.php');
    echo json_encode([
        'type'=>'success',
        'message'=>'GCash QR image deleted',
    ]);
}

function gcashQrFilenameFromSetting(mixed $path): ?string {
    if (!is_string($path)
        || !preg_match('/^(?:uploads\/)?gcash_qr\/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$/', $path, $matches)) {
        return null;
    }
    return $matches[1];
}

function changePassword() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $id = sec_current_user_id();
    $current = $d['current_password'] ?? '';
    $new = $d['new_password'] ?? '';

    $stmt = $connect->prepare("SELECT password FROM users WHERE user_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row || !password_verify($current, $row['password'])) {
        echo json_encode(['type'=>'error','message'=>'Current password is incorrect']);
        return;
    }
    if (strlen($new) < 6) {
        echo json_encode(['type'=>'error','message'=>'New password must be at least 6 characters']);
        return;
    }

    $hash = password_hash($new, PASSWORD_DEFAULT);
    $stmt = $connect->prepare("UPDATE users SET password = ? WHERE user_id = ?");
    $stmt->bind_param("si", $hash, $id);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Password changed':'Failed']);
}

function getSettings() {
    global $connect;
    $res = $connect->query("SELECT setting_key, setting_value FROM system_settings");
    $out = [];
    while ($r = $res->fetch_assoc()) {
        $key = (string)$r['setting_key'];
        if (str_starts_with(strtolower($key), 'paymongo_')) {
            continue;
        }
        if ($key === 'gcash_qr_image' && str_starts_with((string)$r['setting_value'], 'gcash_qr/')) {
            $out[$key] = 'uploads/' . $r['setting_value'];
            continue;
        }
        if (preg_match('/secret|password|token|api_key/i', $key)) {
            $out[$key . '_is_set'] = trim((string)($r['setting_value'] ?? '')) !== '';
        } else {
            $out[$key] = $r['setting_value'];
        }
    }
    echo json_encode(['type'=>'success','data'=>$out]);
}

function getAdminApiKeys(): void {
    global $connect;

    if (!$connect instanceof mysqli) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $secretsFile = __DIR__ . '/../Config/secrets.php';
    $secrets = is_file($secretsFile) ? require $secretsFile : [];
    if (!is_array($secrets)) {
        $secrets = [];
    }

    $readConfigValue = static function (string $name, string $default = '') use ($secrets): string {
        $environmentValue = getenv($name);
        if ($environmentValue !== false && trim($environmentValue) !== '') {
            return trim($environmentValue);
        }
        $secretValue = $secrets[$name] ?? $default;
        return is_string($secretValue) ? trim($secretValue) : $default;
    };

    $readDatabaseSetting = static function (string $key) use ($connect): string|false {
        $stmt = $connect->prepare('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1');
        if (!$stmt) {
            error_log('Admin API key read failed: unable to prepare settings query');
            return false;
        }
        $stmt->bind_param('s', $key);
        if (!$stmt->execute()) {
            error_log('Admin API key read failed: ' . $stmt->error);
            $stmt->close();
            return false;
        }
        $value = '';
        $stmt->bind_result($value);
        $fetched = $stmt->fetch();
        $stmt->close();
        if ($fetched === false) {
            return false;
        }
        return $fetched ? (string)$value : '';
    };

    $textbeeApiKey = $readDatabaseSetting('textbee_api_key');
    $paypalClientIdDatabaseValue = $readDatabaseSetting('paypal_client_id');
    $paypalSecretDatabaseValue = $readDatabaseSetting('paypal_secret');
    $paypalWebhookIdDatabaseValue = $readDatabaseSetting('paypal_webhook_id');
    if ($textbeeApiKey === false
        || $paypalClientIdDatabaseValue === false || $paypalSecretDatabaseValue === false
        || $paypalWebhookIdDatabaseValue === false) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to read stored API keys']);
        return;
    }
    echo json_encode([
        'type' => 'success',
        'data' => [
            'textbee_api_key' => $textbeeApiKey,
            'paypal_client_id' => $readConfigValue('PAYPAL_CLIENT_ID', $paypalClientIdDatabaseValue),
            'paypal_secret' => $readConfigValue('PAYPAL_SECRET', $paypalSecretDatabaseValue),
            'paypal_webhook_id' => $readConfigValue('PAYPAL_WEBHOOK_ID', $paypalWebhookIdDatabaseValue),
        ],
    ]);
}

function paymentMode(): void {
    require_once __DIR__ . '/../Config/paypal.php';
    echo json_encode(['type'=>'success','data'=>['mode'=>strtoupper(pp_mode())]]);
}

function updateSettings() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Invalid settings payload']);
        return;
    }
    $allowedKeys = [
        'contact_email',
        'contact_phone',
        'house_name',
        'house_address_line_1',
        'house_address_line_2',
        'house_contact_phone',
        'house_contact_email',
        'house_office_hours_line_1',
        'house_office_hours_line_2',
        'house_weekday_open_time',
        'house_weekday_close_time',
        'house_weekend_open_time',
        'house_weekend_close_time',
        'house_weekend_by_appointment',
        'house_map_lat',
        'house_map_lng',
        'paypal_client_id',
        'paypal_secret',
        'paypal_webhook_id',
        'textbee_api_base',
        'textbee_api_key',
        'textbee_device_id',
        'textbee_enabled',
        'sms_default_country_code',
        'registration_sms_otp_enabled',
    ];
    $isValidTime = static fn($value): bool => is_string($value)
        && preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $value) === 1;
    if (isset($d['house_weekday_open_time'], $d['house_weekday_close_time'])
        && (!$isValidTime((string)$d['house_weekday_open_time'])
            || !$isValidTime((string)$d['house_weekday_close_time'])
            || (string)$d['house_weekday_open_time'] >= (string)$d['house_weekday_close_time'])) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Weekday closing time must be later than a valid opening time']);
        return;
    }
    $weekendByAppointment = in_array(
        strtolower((string)($d['house_weekend_by_appointment'] ?? '1')),
        ['1', 'true', 'yes'],
        true
    );
    if (!$weekendByAppointment && isset($d['house_weekend_open_time'], $d['house_weekend_close_time'])
        && (!$isValidTime((string)$d['house_weekend_open_time'])
            || !$isValidTime((string)$d['house_weekend_close_time'])
            || (string)$d['house_weekend_open_time'] >= (string)$d['house_weekend_close_time'])) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Weekend closing time must be later than a valid opening time']);
        return;
    }
    $stmt = $connect->prepare("
        INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    ");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to prepare settings update']);
        return;
    }
    foreach ($d as $k => $v) {
        if (!in_array($k, $allowedKeys, true)) {
            continue;
        }
        $val = (string)$v;
        $val = trim($val);
        if (in_array($k, [
            'house_weekday_open_time',
            'house_weekday_close_time',
            'house_weekend_open_time',
            'house_weekend_close_time',
        ], true) && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $val)) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Office hours must use valid 24-hour times']);
            $stmt->close();
            return;
        }
        if ($k === 'house_weekend_by_appointment') {
            $val = in_array(strtolower($val), ['1', 'true', 'yes'], true) ? '1' : '0';
        }
        if (preg_match('/secret|password|token|api_key/i', $k)
            && ($val === '' || preg_match('/^[*•●.]+$/u', $val))) {
            continue;
        }
        if ($val === '.') {
            $val = '';
        }
        $stmt->bind_param("ss", $k, $val);
        if (!$stmt->execute()) {
            $stmt->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to save settings']);
            return;
        }
    }
    $stmt->close();
    rt_publish('/Admin/settings.php');
    echo json_encode(['type'=>'success','message'=>'Settings updated']);
}
?>
