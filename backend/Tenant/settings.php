<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/phone_validation.php';

header('Content-Type: application/json');

function users_has_column(string $column): bool {
    global $connect, $dbName;
    static $cache = [];
    if (isset($cache[$column])) return $cache[$column];

    $stmt = $connect->prepare("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?");
    if (!$stmt) {
        $cache[$column] = false;
        return false;
    }

    $stmt->bind_param('ss', $dbName, $column);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $cache[$column] = ((int) ($row['count'] ?? 0)) > 0;
    return $cache[$column];
}

function getProfile() {
    global $connect;
    $uid = intval($_GET['user_id'] ?? 0);
    $stmt = $connect->prepare("
         SELECT u.user_id, u.full_name, u.username, u.email, u.phone, u.user_type,
             u.address, u.age, u.birthday, u.profile_picture,
             u.emergency_contact_name, u.emergency_contact_phone,
               t.tenant_id, t.move_in_date, r.room_number
        FROM users u
        LEFT JOIN tenants t ON t.user_id = u.user_id AND t.is_active = 1
        LEFT JOIN rooms r ON r.room_id = t.room_id
        WHERE u.user_id = ?
    ");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        echo json_encode(['type'=>'error','message'=>'User not found']);
        return;
    }

    echo json_encode(['type'=>'success','data'=>$row]);
}

function uploadProfilePicture() {
    global $connect;
    $uid = intval($_POST['user_id'] ?? 0);
    if ($uid <= 0 || $uid !== sec_current_user_id() || empty($_FILES['profile_picture']['tmp_name'])) {
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
        rt_publish('/Tenant/settings.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Profile picture updated':'Failed to update profile picture']);
}

function updateProfile() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }

    $id = sec_current_user_id();
    $userType = sec_current_user_type();
    $requestedUserId = filter_var($d['user_id'] ?? null, FILTER_VALIDATE_INT);
    if ($id <= 0 || !in_array($userType, ['Tenant', 'Guest'], true) || $requestedUserId !== $id) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'You may only update your own profile']);
        return;
    }

    $fullName = trim((string)($d['full_name'] ?? ''));
    $email = trim((string)($d['email'] ?? ''));
    $phone = trim((string)($d['phone'] ?? ''));
    $updateEmergencyContact = array_key_exists('emergency_contact_name', $d)
        && array_key_exists('emergency_contact_phone', $d) ? 1 : 0;
    $emergencyName = trim((string)($d['emergency_contact_name'] ?? ''));
    $emergencyPhone = canonical_phone((string)($d['emergency_contact_phone'] ?? ''));
    $address = trim((string)($d['address'] ?? ''));
    $birthday = trim((string)($d['birthday'] ?? '')) ?: null;
    $ageInput = trim((string)($d['age'] ?? ''));
    $age = $ageInput === '' ? null : filter_var($ageInput, FILTER_VALIDATE_INT);

    if ($fullName === '' || mb_strlen($fullName) > 150 || strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid name and email address']);
        return;
    }
    if (strlen($address) > 255) {
        echo json_encode(['type'=>'error','message'=>'Address must be 255 characters or fewer']);
        return;
    }
    if ($updateEmergencyContact && (mb_strlen($emergencyName) > 150
        || ($emergencyPhone !== '' && !preg_match('/^09\d{9}$/', $emergencyPhone)))) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid emergency contact name and Philippines phone number']);
        return;
    }
    if ($age === false || ($age !== null && ($age < 0 || $age > 120))) {
        echo json_encode(['type'=>'error','message'=>'Age must be a number from 0 to 120']);
        return;
    }
    if ($birthday !== null) {
        $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $birthday);
        $dateErrors = DateTimeImmutable::getLastErrors();
        if ($birthDate === false || $birthDate->format('Y-m-d') !== $birthday ||
            ($dateErrors !== false && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0)) ||
            $birthDate > new DateTimeImmutable('today')) {
            echo json_encode(['type'=>'error','message'=>'Enter a valid birthday that is not in the future']);
            return;
        }
    }

    $stmt = $connect->prepare("UPDATE users SET full_name = ?, email = ?, phone = ?, address = ?, age = ?, birthday = ?, emergency_contact_name = IF(?, ?, emergency_contact_name), emergency_contact_phone = IF(?, ?, emergency_contact_phone) WHERE user_id = ? AND user_type = ?");
    if (!$stmt) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update profile']);
        return;
    }
    $stmt->bind_param('ssssisisisis', $fullName, $email, $phone, $address, $age, $birthday, $updateEmergencyContact, $emergencyName, $updateEmergencyContact, $emergencyPhone, $id, $userType);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        rt_publish('/Tenant/settings.php');
        rt_publish('/Admin/tenants.php');
    }
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Updated':'Failed']);
}

function changePassword() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['user_id'] ?? 0);
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
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Password changed':'Failed']);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'get_profile':     getProfile(); break;
    case 'update_profile':  updateProfile(); break;
    case 'change_password': changePassword(); break;
    case 'upload_profile_picture': uploadProfilePicture(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}
?>
