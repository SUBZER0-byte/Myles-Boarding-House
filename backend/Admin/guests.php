<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once '../Config/phone_validation.php';

sec_require_admin();

header('Content-Type: application/json');

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':       listGuests(); break;
    case 'create':     createGuest(); break;
    case 'update':     updateGuest(); break;
    case 'deactivate': setActive(0); break;
    case 'activate':   setActive(1); break;
    case 'delete':     deleteGuest(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function createGuest() {
    /** @var mysqli $connect */
    global $connect;

    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }

    $fullName = trim((string)($data['full_name'] ?? ''));
    $username = trim((string)($data['username'] ?? ''));
    $email = trim((string)($data['email'] ?? ''));
    $phone = canonical_phone((string)($data['phone'] ?? ''));
    $address = trim((string)($data['address'] ?? ''));
    $birthday = trim((string)($data['birthday'] ?? '')) ?: null;
    $emergencyName = trim((string)($data['emergency_contact_name'] ?? ''));
    $emergencyPhone = canonical_phone((string)($data['emergency_contact_phone'] ?? ''));
    $password = (string)($data['password'] ?? '');

    if (!preg_match("/^[\p{L} .'-]{2,150}$/u", $fullName)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid full name (2–150 characters)']);
        return;
    }
    if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username)) {
        echo json_encode(['type'=>'error','message'=>'Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens']);
        return;
    }
    if (strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid email address (maximum 150 characters)']);
        return;
    }
    if (strlen($password) < 6 || strlen($password) > 200) {
        echo json_encode(['type'=>'error','message'=>'Password must be 6–200 characters long']);
        return;
    }
    if ($phone !== '' && !is_probably_real_mobile_number($phone)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid Philippine mobile number']);
        return;
    }
    if (strlen($address) > 255 || mb_strlen($emergencyName) > 150) {
        echo json_encode(['type'=>'error','message'=>'Address or emergency contact name is too long']);
        return;
    }
    if ($emergencyPhone !== '' && !is_probably_real_mobile_number($emergencyPhone)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid emergency contact mobile number']);
        return;
    }
    $age = null;
    if ($birthday !== null) {
        $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $birthday);
        $dateErrors = DateTimeImmutable::getLastErrors();
        if ($birthDate === false || $birthDate->format('Y-m-d') !== $birthday ||
            ($dateErrors !== false && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0)) ||
            $birthDate > new DateTimeImmutable('today')) {
            echo json_encode(['type'=>'error','message'=>'Enter a valid birthday that is not in the future']);
            return;
        }
        $age = $birthDate->diff(new DateTimeImmutable('today'))->y;
        if ($age > 120) {
            echo json_encode(['type'=>'error','message'=>'Enter a valid birthday']);
            return;
        }
    }

    $uniqueFields = ['username' => $username, 'email' => $email];
    if ($phone !== '') {
        $uniqueFields['phone'] = $phone;
    }
    foreach ($uniqueFields as $column => $value) {
        $check = $connect->prepare("SELECT user_id FROM users WHERE {$column} = ? LIMIT 1");
        if (!$check) {
            error_log('Guest create uniqueness check prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate guest account details']);
            return;
        }
        $check->bind_param('s', $value);
        if (!$check->execute()) {
            $error = $check->error;
            $check->close();
            error_log('Guest create uniqueness check failed: ' . $error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate guest account details']);
            return;
        }
        $exists = $check->get_result()->num_rows > 0;
        $check->close();
        if ($exists) {
            $message = match ($column) {
                'email' => 'Email is already used by another account',
                'phone' => 'Phone number is already used by another account',
                default => 'Username is already used by another account',
            };
            echo json_encode(['type'=>'error','message'=>$message]);
            return;
        }
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $connect->prepare("INSERT INTO users
        (full_name, username, email, phone, address, age, birthday, emergency_contact_name, emergency_contact_phone, password, user_type, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Guest', 1, NOW())");
    if (!$stmt) {
        error_log('Guest create prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to create guest account']);
        return;
    }
    $stmt->bind_param('sssssissss', $fullName, $username, $email, $phone, $address, $age, $birthday, $emergencyName, $emergencyPhone, $passwordHash);
    $ok = $stmt->execute();
    $userId = $stmt->insert_id;
    $error = $stmt->error;
    $stmt->close();
    if (!$ok) {
        error_log('Guest create failed: ' . $error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to create guest account']);
        return;
    }

    rt_publish('/Admin/guests.php');
    echo json_encode(['type'=>'success','message'=>'Guest account created','user_id'=>$userId]);
}

function updateGuest() {
    /** @var mysqli $connect */
    global $connect;

    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }

    $userId = filter_var($data['user_id'] ?? null, FILTER_VALIDATE_INT);
    $fullName = trim((string)($data['full_name'] ?? ''));
    $email = trim((string)($data['email'] ?? ''));
    $phone = canonical_phone((string)($data['phone'] ?? ''));
    $address = trim((string)($data['address'] ?? ''));
    $birthday = trim((string)($data['birthday'] ?? ''));
    $emergencyName = trim((string)($data['emergency_contact_name'] ?? ''));
    $emergencyPhone = canonical_phone((string)($data['emergency_contact_phone'] ?? ''));
    $newPassword = (string)($data['new_password'] ?? '');

    if (!$userId || $userId <= 0) {
        echo json_encode(['type'=>'error','message'=>'Invalid guest account']);
        return;
    }
    if (!preg_match("/^[\p{L} .'\-]{2,150}$/u", $fullName)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid full name (2–150 characters)']);
        return;
    }
    if (strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid email address (maximum 150 characters)']);
        return;
    }
    if ($phone !== '' && !is_probably_real_mobile_number($phone)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid Philippine mobile number']);
        return;
    }
    if (strlen($address) > 255 || mb_strlen($emergencyName) > 150) {
        echo json_encode(['type'=>'error','message'=>'Address or emergency contact name is too long']);
        return;
    }
    if ($emergencyPhone !== '' && !is_probably_real_mobile_number($emergencyPhone)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid emergency contact mobile number']);
        return;
    }
    if ($newPassword !== '' && (strlen($newPassword) < 6 || strlen($newPassword) > 200)) {
        echo json_encode(['type'=>'error','message'=>'New password must be 6–200 characters long']);
        return;
    }

    $birthday = $birthday === '' ? null : $birthday;
    $age = null;
    if ($birthday !== null) {
        $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $birthday);
        $dateErrors = DateTimeImmutable::getLastErrors();
        if (
            $birthDate === false ||
            $birthDate->format('Y-m-d') !== $birthday ||
            ($dateErrors !== false && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0)) ||
            $birthDate > new DateTimeImmutable('today')
        ) {
            echo json_encode(['type'=>'error','message'=>'Enter a valid birthday that is not in the future']);
            return;
        }
        $age = $birthDate->diff(new DateTimeImmutable('today'))->y;
        if ($age > 120) {
            echo json_encode(['type'=>'error','message'=>'Enter a valid birthday']);
            return;
        }
    }

    $uniqueFields = ['email' => $email];
    if ($phone !== '') {
        $uniqueFields['phone'] = $phone;
    }
    foreach ($uniqueFields as $column => $value) {
        $check = $connect->prepare("SELECT user_id FROM users WHERE {$column} = ? AND user_id <> ? LIMIT 1");
        if (!$check) {
            error_log('Guest update uniqueness check prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate guest account details']);
            return;
        }
        $check->bind_param('si', $value, $userId);
        if (!$check->execute()) {
            $error = $check->error;
            $check->close();
            error_log('Guest update uniqueness check failed: ' . $error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate guest account details']);
            return;
        }
        $exists = $check->get_result()->num_rows > 0;
        $check->close();
        if ($exists) {
            $message = match ($column) {
                'email' => 'Email is already used by another account',
                'phone' => 'Phone number is already used by another account',
                default => 'Account detail is already used by another account',
            };
            echo json_encode(['type'=>'error','message'=>$message]);
            return;
        }
    }

    $stmt = $connect->prepare("
        UPDATE users
        SET full_name = ?, email = ?, phone = ?, address = ?, age = ?, birthday = ?,
            emergency_contact_name = ?, emergency_contact_phone = ?
        WHERE user_id = ? AND user_type = 'Guest'
    ");
    if (!$stmt) {
        error_log('Guest update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update guest account']);
        return;
    }
    $stmt->bind_param(
        'ssssisssi',
        $fullName,
        $email,
        $phone,
        $address,
        $age,
        $birthday,
        $emergencyName,
        $emergencyPhone,
        $userId
    );
    $connect->begin_transaction();
    $ok = $stmt->execute();
    $updated = $stmt->affected_rows;
    $error = $stmt->error;
    $stmt->close();

    if (!$ok) {
        $connect->rollback();
        error_log('Guest account update failed: ' . $error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to update guest account']);
        return;
    }

    if ($updated === 0) {
        $exists = $connect->prepare("SELECT user_id FROM users WHERE user_id = ? AND user_type = 'Guest' LIMIT 1");
        $exists->bind_param('i', $userId);
        $exists->execute();
        $guestExists = $exists->get_result()->num_rows > 0;
        $exists->close();
        if (!$guestExists) {
            $connect->rollback();
            echo json_encode(['type'=>'error','message'=>'Guest account not found']);
            return;
        }
    }

    if ($newPassword !== '') {
        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $passwordStmt = $connect->prepare("UPDATE users SET password = ? WHERE user_id = ? AND user_type = 'Guest'");
        if (!$passwordStmt) {
            $connect->rollback();
            error_log('Guest password update prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update guest password']);
            return;
        }
        $passwordStmt->bind_param('si', $passwordHash, $userId);
        $passwordOk = $passwordStmt->execute();
        $passwordError = $passwordStmt->error;
        $passwordStmt->close();
        if (!$passwordOk) {
            $connect->rollback();
            error_log('Guest password update failed: ' . $passwordError);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Failed to update guest password']);
            return;
        }
    }

    $connect->commit();

    rt_publish('/Admin/guests.php');
    rt_publish('/Tenant/settings.php');
    echo json_encode(['type'=>'success','message'=>'Guest account updated']);
}

function listGuests() {
    /** @var mysqli $connect */
    global $connect;

    $selectParts = [
        'user_id', 'full_name', 'username', 'email', 'phone',
        'address', 'age', 'birthday', 'emergency_contact_name', 'emergency_contact_phone',
        'is_active', 'created_at', 'profile_picture',
    ];

    $sql = 'SELECT ' . implode(', ', $selectParts) . "
            FROM users
            WHERE user_type = 'Guest'
            ORDER BY created_at DESC";

    $res = $connect->query($sql);
    $rows = [];
    while ($r = $res->fetch_assoc()) {
        $rows[] = $r;
    }

    echo json_encode(['type'=>'success','data'=>$rows]);
}

function setActive($val) {
    /** @var mysqli $connect */
    global $connect;
    $id = intval($_GET['user_id'] ?? 0);
    $stmt = $connect->prepare("UPDATE users SET is_active = ? WHERE user_id = ? AND user_type = 'Guest'");
    $stmt->bind_param("ii", $val, $id);
    $ok = $stmt->execute();
    $stmt->close();
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?($val?'Activated':'Deactivated'):'Failed']);
}

function deleteGuest() {
    /** @var mysqli $connect */
    global $connect;
    $id = intval($_GET['user_id'] ?? 0);

    $guestInfo = $connect->prepare("SELECT email, phone, profile_picture FROM users WHERE user_id = ? AND user_type = 'Guest' LIMIT 1");
    $guestInfo->bind_param('i', $id);
    $guestInfo->execute();
    $guest = $guestInfo->get_result()->fetch_assoc();
    $guestInfo->close();

    if ($guest && (!empty($guest['email']) || !empty($guest['phone']))) {
        $email = trim((string)($guest['email'] ?? ''));
        $phone = trim((string)($guest['phone'] ?? ''));

        if ($email !== '' || $phone !== '') {
            $bookingRoomUpdate = $connect->prepare(
                "UPDATE rooms r
                 INNER JOIN bookings b ON b.room_id = r.room_id
                 SET r.status = 'Available'
                 WHERE (b.email = ? OR b.phone = ?)
                   AND b.status <> 'Cancelled'"
            );
            if ($bookingRoomUpdate) {
                $bookingRoomUpdate->bind_param('ss', $email, $phone);
                $bookingRoomUpdate->execute();
                $bookingRoomUpdate->close();
            }
        }
    }

    $stmt = $connect->prepare("DELETE FROM users WHERE user_id = ? AND user_type = 'Guest'");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok) {
        if ($guest && !empty($guest['profile_picture'])) {
            sec_delete_profile_picture($guest['profile_picture']);
        }
        rt_publish('/Admin/guests.php');
        rt_publish('/Admin/notifications.php');
        rt_publish('/Admin/rooms.php');
    }

    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}

?>
