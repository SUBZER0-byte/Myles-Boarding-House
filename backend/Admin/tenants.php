<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
include_once '../Config/phone_validation.php';
require_once __DIR__ . '/../Config/booking_room_status.php';

sec_require_admin();

header('Content-Type: application/json');

function users_has_column(string $column): bool {
    /** @var mysqli $connect */
    global $connect, $dbName;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        return false;
    }

    static $cache = [];
    if (isset($cache[$column])) {
        return $cache[$column];
    }

    $stmt = $connect->prepare(
        "SELECT COUNT(*) AS count
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = 'users'
            AND COLUMN_NAME = ?"
    );
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

function valid_tenant_stay_dates(?string $moveInDate, ?string $moveOutDate): bool {
    if ($moveInDate === null) {
        return $moveOutDate === null;
    }

    $moveIn = DateTimeImmutable::createFromFormat('!Y-m-d', $moveInDate);
    if ($moveIn === false || $moveIn->format('Y-m-d') !== $moveInDate) {
        return false;
    }
    if ($moveOutDate === null) {
        return true;
    }

    $moveOut = DateTimeImmutable::createFromFormat('!Y-m-d', $moveOutDate);
    return $moveOut !== false
        && $moveOut->format('Y-m-d') === $moveOutDate
        && $moveOut > $moveIn;
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':       listTenants(); break;
    case 'suggest_usernames': suggestUsernames(); break;
    case 'get':        getTenant(); break;
    case 'create':     createTenant(); break;
    case 'update':     updateTenant(); break;
    case 'deactivate': deactivateTenant(); break;
    case 'delete':     deleteTenant(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function suggestUsernames(): void {
    /** @var mysqli $connect */
    global $connect;

    $query = trim((string)($_GET['query'] ?? ''));
    if (mb_strlen($query) < 2) {
        echo json_encode(['type'=>'success','data'=>[]]);
        return;
    }

    $pattern = '%' . $query . '%';
    $stmt = $connect->prepare("
         SELECT u.user_id, u.username, u.full_name, u.email, u.phone, u.address, u.birthday,
             u.emergency_contact_name, u.emergency_contact_phone, u.user_type
        FROM users u
        WHERE u.username LIKE ?
          AND u.user_type = 'Tenant'
          AND u.is_active = 1
          AND NOT EXISTS (
              SELECT 1
              FROM tenants t
              WHERE t.user_id = u.user_id AND t.is_active = 1
          )
        ORDER BY u.username ASC
        LIMIT 8
    ");
    if (!$stmt) {
        error_log('Tenant username suggestions prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load account suggestions']);
        return;
    }

    $stmt->bind_param('s', $pattern);
    if (!$stmt->execute()) {
        error_log('Tenant username suggestions query failed: ' . $stmt->error);
        $stmt->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load account suggestions']);
        return;
    }
    $result = $stmt->get_result();
    $users = [];
    while ($row = $result->fetch_assoc()) {
        $users[] = $row;
    }
    $stmt->close();

    echo json_encode(['type'=>'success','data'=>$users]);
}

function listTenants() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $selectParts = [
        't.tenant_id',
        't.user_id',
        't.room_id',
        't.full_name',
        'u.username',
        't.phone',
        't.email',
        'u.address',
        'u.age',
        'u.birthday',
        'u.emergency_contact_name',
        'u.emergency_contact_phone',
        't.move_in_date',
        't.move_out_date',
        't.is_active',
        'r.room_number',
        'r.room_type',
        'u.profile_picture',
    ];

    $sql = "SELECT " . implode(', ', $selectParts) . "
            FROM tenants t
            LEFT JOIN rooms r ON r.room_id = t.room_id
            LEFT JOIN users u ON u.user_id = t.user_id
            ORDER BY t.full_name ASC";

    $res = $connect->query($sql);
    $rows = [];
    while ($r = $res->fetch_assoc()) {
        $rows[] = $r;
    }

    echo json_encode(['type'=>'success','data'=>$rows]);
}

function getTenant() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $id = intval($_GET['tenant_id'] ?? 0);
    $stmt = $connect->prepare("SELECT * FROM tenants WHERE tenant_id = ?");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$row]);
}

function createTenant() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }

    $phone = canonical_phone($d['phone'] ?? '');
    if (!preg_match('/^09\d{9}$/', $phone)) {
        echo json_encode(['type'=>'error','message'=>'Invalid Philippines phone number. Must be in format: 09XXXXXXXXX']);
        return;
    }
    $fullName = trim((string)($d['full_name'] ?? ''));
    $email = trim((string)($d['email'] ?? ''));
    if (!preg_match("/^[\p{L} .'-]{2,150}$/u", $fullName)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid full name (2–150 characters)']);
        return;
    }
    if (strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid email address (maximum 150 characters)']);
        return;
    }

    $phoneConflict = has_active_phone_conflict($connect, $phone);
    if ($phoneConflict['booking'] || $phoneConflict['tenant']) {
        echo json_encode(['type'=>'error','message'=>'This phone number is already associated with an active booking or tenant.']);
        return;
    }

    $moveInDate = trim((string)($d['move_in_date'] ?? '')) ?: null;
    $moveOutDate = trim((string)($d['move_out_date'] ?? '')) ?: null;
    if ($moveInDate === null || !valid_tenant_stay_dates($moveInDate, $moveOutDate)) {
        echo json_encode(['type'=>'error','message'=>'Move-out date must be after the move-in date.']);
        return;
    }

    $username = trim((string)($d['username'] ?? ''));
    $user_id = null;
    if ($username !== '') {
        $userLookup = $connect->prepare("
            SELECT u.user_id
            FROM users u
            WHERE u.username = ? AND u.user_type = 'Tenant' AND u.is_active = 1
              AND NOT EXISTS (
                  SELECT 1 FROM tenants t
                  WHERE t.user_id = u.user_id AND t.is_active = 1
              )
            LIMIT 1
        ");
        if (!$userLookup) {
            error_log('Tenant account lookup prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to look up the account username']);
            return;
        }
        $userLookup->bind_param('s', $username);
        if (!$userLookup->execute()) {
            error_log('Tenant account lookup failed: ' . $userLookup->error);
            $userLookup->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to look up the account username']);
            return;
        }
        $linkedUser = $userLookup->get_result()->fetch_assoc();
        $userLookup->close();
        if (!$linkedUser) {
            echo json_encode(['type'=>'error','message'=>'No eligible Tenant account was found with that username']);
            return;
        }
        $user_id = (int)$linkedUser['user_id'];
    }
    if ($user_id === null && (
        trim((string)($d['address'] ?? '')) !== '' ||
        trim((string)($d['birthday'] ?? '')) !== '' ||
        trim((string)($d['emergency_contact_name'] ?? '')) !== '' ||
        trim((string)($d['emergency_contact_phone'] ?? '')) !== ''
    )) {
        echo json_encode(['type'=>'error','message'=>'Link an eligible tenant login to save address, birthday, or emergency contact details']);
        return;
    }
    $roomInput = trim((string)($d['room_id'] ?? ''));
    $room_id = $roomInput === '' ? null : filter_var($roomInput, FILTER_VALIDATE_INT);
    if ($room_id !== null && ($room_id === false || $room_id <= 0)) {
        echo json_encode(['type'=>'error','message'=>'Select a valid room']);
        return;
    }
    $room_id = $room_id === false ? null : $room_id;

    if ($user_id !== null) {
        $userData = [
            'full_name' => trim((string)($d['full_name'] ?? '')),
            'email' => trim((string)($d['email'] ?? '')),
            'phone' => $phone,
            'address' => trim((string)($d['address'] ?? '')),
            'birthday' => trim((string)($d['birthday'] ?? '')) ?: null,
            'emergency_contact_name' => trim((string)($d['emergency_contact_name'] ?? '')),
            'emergency_contact_phone' => canonical_phone((string)($d['emergency_contact_phone'] ?? '')),
        ];
        if ($userData['full_name'] === '' || strlen($userData['email']) > 150 || filter_var($userData['email'], FILTER_VALIDATE_EMAIL) === false ||
            strlen($userData['address']) > 255 || mb_strlen($userData['emergency_contact_name']) > 150 ||
            ($userData['emergency_contact_phone'] !== '' && !is_probably_real_mobile_number($userData['emergency_contact_phone']))) {
            echo json_encode(['type'=>'error','message'=>'Enter valid tenant account profile details']);
            return;
        }
        $age = null;
        if ($userData['birthday'] !== null) {
            $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', $userData['birthday']);
            $dateErrors = DateTimeImmutable::getLastErrors();
            if ($birthDate === false || $birthDate->format('Y-m-d') !== $userData['birthday'] ||
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

        foreach (['username' => $username, 'email' => $userData['email'], 'phone' => $phone] as $column => $value) {
            $check = $connect->prepare("SELECT user_id FROM users WHERE {$column} = ? AND user_id <> ? LIMIT 1");
            if (!$check) {
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Unable to validate tenant account details']);
                return;
            }
            $check->bind_param('si', $value, $user_id);
            if (!$check->execute()) {
                $check->close();
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Unable to validate tenant account details']);
                return;
            }
            $exists = $check->get_result()->num_rows > 0;
            $check->close();
            if ($exists) {
                echo json_encode(['type'=>'error','message'=>'Tenant account email, phone, or username is already used']);
                return;
            }
        }
    }

    $connect->begin_transaction();
    if (ROOM_CAPACITY_ENFORCE_ADMIN_TENANTS && $room_id !== null && $moveInDate !== null
        && !room_has_capacity($connect, (int)$room_id, $moveInDate, $moveOutDate ?? '9999-12-31')) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'This room is full or already reserved for those dates.']);
        return;
    }
    if ($user_id !== null) {
        $userUpdate = $connect->prepare("UPDATE users SET full_name = ?, email = ?, phone = ?, address = ?, age = ?, birthday = ?, emergency_contact_name = ?, emergency_contact_phone = ? WHERE user_id = ? AND user_type <> 'Admin'");
        if (!$userUpdate) {
            $connect->rollback();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update tenant account']);
            return;
        }
        $userUpdate->bind_param('ssssisssi', $userData['full_name'], $userData['email'], $phone, $userData['address'], $age, $userData['birthday'], $userData['emergency_contact_name'], $userData['emergency_contact_phone'], $user_id);
        $userOk = $userUpdate->execute();
        $userUpdate->close();
        if (!$userOk) {
            $connect->rollback();
            echo json_encode(['type'=>'error','message'=>'Failed to update tenant account']);
            return;
        }
    }

    $stmt = $connect->prepare("
        INSERT INTO tenants (user_id, room_id, full_name, phone, email, move_in_date, move_out_date, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())
    ");
    if (!$stmt) {
        $connect->rollback();
        error_log('Tenant insert prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to create tenant']);
        return;
    }
    $stmt->bind_param("iisssss",
        $user_id, $room_id,
        $fullName, $phone, $email, $moveInDate, $moveOutDate
    );
    $ok = $stmt->execute();
    $id = $stmt->insert_id;
    $insertError = $stmt->error;
    $stmt->close();
    if (!$ok) {
        $connect->rollback();
        error_log('Tenant insert failed: ' . $insertError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to create tenant']);
        return;
    }
    $connect->commit();
    rt_publish('/Admin/tenants.php');
    rt_publish('/Tenant/tenantdashboard.php');

    echo json_encode(['type'=>'success','message'=>'Tenant created','tenant_id'=>$id,'user_id'=>$user_id]);
}

function updateTenant() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $d = json_decode(file_get_contents('php://input'), true);
    if (!is_array($d)) {
        echo json_encode(['type'=>'error','message'=>'Invalid request data']);
        return;
    }

    $id = filter_var($d['tenant_id'] ?? null, FILTER_VALIDATE_INT);
    $fullName = trim((string)($d['full_name'] ?? ''));
    $username = trim((string)($d['username'] ?? ''));
    $email = trim((string)($d['email'] ?? ''));
    $phone = canonical_phone((string)($d['phone'] ?? ''));
    $address = trim((string)($d['address'] ?? ''));
    $birthday = trim((string)($d['birthday'] ?? '')) ?: null;
    $emergencyName = trim((string)($d['emergency_contact_name'] ?? ''));
    $emergencyPhone = canonical_phone((string)($d['emergency_contact_phone'] ?? ''));
    $newPassword = (string)($d['new_password'] ?? '');
    $roomInput = trim((string)($d['room_id'] ?? ''));
    $roomId = $roomInput === '' ? null : filter_var($roomInput, FILTER_VALIDATE_INT);

    if (!$id || $id <= 0) {
        echo json_encode(['type'=>'error','message'=>'Invalid tenant record']);
        return;
    }
    if (!preg_match("/^[\p{L} .'-]{2,150}$/u", $fullName)) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid full name (2–150 characters)']);
        return;
    }
    if (strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        echo json_encode(['type'=>'error','message'=>'Enter a valid email address (maximum 150 characters)']);
        return;
    }
    if ($phone === '' || !preg_match('/^09\d{9}$/', $phone)) {
        echo json_encode(['type'=>'error','message'=>'Invalid Philippines phone number. Must be in format: 09XXXXXXXXX']);
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
    if ($roomId !== null && ($roomId === false || $roomId <= 0)) {
        echo json_encode(['type'=>'error','message'=>'Select a valid room']);
        return;
    }
    $roomId = $roomId === false ? null : $roomId;

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

    $tenantLookup = $connect->prepare('SELECT user_id, room_id, move_in_date, move_out_date FROM tenants WHERE tenant_id = ? LIMIT 1');
    if (!$tenantLookup) {
        error_log('Tenant update lookup prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load tenant record']);
        return;
    }
    $tenantLookup->bind_param('i', $id);
    if (!$tenantLookup->execute()) {
        error_log('Tenant update lookup failed: ' . $tenantLookup->error);
        $tenantLookup->close();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load tenant record']);
        return;
    }
    $tenantRow = $tenantLookup->get_result()->fetch_assoc();
    $tenantLookup->close();
    if (!$tenantRow) {
        echo json_encode(['type'=>'error','message'=>'Tenant record not found']);
        return;
    }
    $userId = $tenantRow['user_id'] !== null ? (int)$tenantRow['user_id'] : null;
    if ($userId === null && $username !== '') {
        if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username)) {
            echo json_encode(['type'=>'error','message'=>'Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens']);
            return;
        }
        $userLookup = $connect->prepare("SELECT u.user_id FROM users u
            WHERE u.username = ? AND u.user_type = 'Tenant' AND u.is_active = 1
              AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.user_id = u.user_id AND t.is_active = 1)
            LIMIT 1");
        if (!$userLookup) {
            error_log('Tenant account link prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to look up the account username']);
            return;
        }
        $userLookup->bind_param('s', $username);
        if (!$userLookup->execute()) {
            $userLookup->close();
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to look up the account username']);
            return;
        }
        $linkedUser = $userLookup->get_result()->fetch_assoc();
        $userLookup->close();
        if (!$linkedUser) {
            echo json_encode(['type'=>'error','message'=>'No eligible Tenant account was found with that username']);
            return;
        }
        $userId = (int)$linkedUser['user_id'];
    }
    if ($userId === null && ($address !== '' || $birthday !== null || $emergencyName !== '' || $emergencyPhone !== '')) {
        echo json_encode(['type'=>'error','message'=>'Link an eligible tenant login to save address, birthday, or emergency contact details']);
        return;
    }
    if ($userId === null && $newPassword !== '') {
        echo json_encode(['type'=>'error','message'=>'Link a tenant login before changing its password']);
        return;
    }

    $phoneConflict = has_active_phone_conflict($connect, $phone, null, $id);
    if ($phoneConflict['booking'] || $phoneConflict['tenant']) {
        echo json_encode(['type'=>'error','message'=>'This phone number is already associated with an active booking or tenant.']);
        return;
    }

    $moveInDate = trim((string)($d['move_in_date'] ?? '')) ?: null;
    $moveOutDate = trim((string)($d['move_out_date'] ?? '')) ?: null;
    if ($moveInDate === null || !valid_tenant_stay_dates($moveInDate, $moveOutDate)) {
        echo json_encode(['type'=>'error','message'=>'Enter valid stay dates; move-out must be after move-in.']);
        return;
    }

    if ($userId !== null) {
        foreach (['email' => $email, 'phone' => $phone] as $column => $value) {
            $check = $connect->prepare("SELECT user_id FROM users WHERE {$column} = ? AND user_id <> ? LIMIT 1");
            if (!$check) {
                error_log('Tenant update uniqueness check prepare failed: ' . $connect->error);
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Unable to validate tenant account details']);
                return;
            }
            $check->bind_param('si', $value, $userId);
            if (!$check->execute()) {
                $error = $check->error;
                $check->close();
                error_log('Tenant update uniqueness check failed: ' . $error);
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Unable to validate tenant account details']);
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
    }

    $connect->begin_transaction();
    $stayChanged = (int)($tenantRow['room_id'] ?? 0) !== (int)($roomId ?? 0)
        || (string)($tenantRow['move_in_date'] ?? '') !== (string)($moveInDate ?? '')
        || (string)($tenantRow['move_out_date'] ?? '') !== (string)($moveOutDate ?? '');
    if (ROOM_CAPACITY_ENFORCE_ADMIN_TENANTS && $stayChanged && $roomId !== null && $moveInDate !== null
        && !room_has_capacity($connect, (int)$roomId, $moveInDate, $moveOutDate ?? '9999-12-31', 0, (int)$id)) {
        $connect->rollback();
        echo json_encode(['type'=>'error','message'=>'This room is full or already reserved for those dates.']);
        return;
    }
    if ($userId !== null) {
        $userStmt = $connect->prepare("UPDATE users SET full_name = ?, email = ?, phone = ?, address = ?, age = ?, birthday = ?, emergency_contact_name = ?, emergency_contact_phone = ? WHERE user_id = ? AND user_type <> 'Admin'");
        if (!$userStmt) {
            $connect->rollback();
            error_log('Tenant account update prepare failed: ' . $connect->error);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to update tenant account']);
            return;
        }
        $userStmt->bind_param('ssssisssi', $fullName, $email, $phone, $address, $age, $birthday, $emergencyName, $emergencyPhone, $userId);
        $userOk = $userStmt->execute();
        $userError = $userStmt->error;
        $userStmt->close();
        if (!$userOk) {
            $connect->rollback();
            error_log('Tenant account update failed: ' . $userError);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Failed to update tenant account']);
            return;
        }

        if ($newPassword !== '') {
            $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
            $passwordStmt = $connect->prepare("UPDATE users SET password = ? WHERE user_id = ? AND user_type <> 'Admin'");
            if (!$passwordStmt) {
                $connect->rollback();
                error_log('Tenant password update prepare failed: ' . $connect->error);
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Unable to update tenant password']);
                return;
            }
            $passwordStmt->bind_param('si', $passwordHash, $userId);
            $passwordOk = $passwordStmt->execute();
            $passwordError = $passwordStmt->error;
            $passwordStmt->close();
            if (!$passwordOk) {
                $connect->rollback();
                error_log('Tenant password update failed: ' . $passwordError);
                http_response_code(500);
                echo json_encode(['type'=>'error','message'=>'Failed to update tenant password']);
                return;
            }
        }
    }

    $stmt = $connect->prepare('UPDATE tenants SET user_id = ?, full_name = ?, phone = ?, email = ?, room_id = ?, move_in_date = ?, move_out_date = ? WHERE tenant_id = ?');
    if (!$stmt) {
        $connect->rollback();
        error_log('Tenant update prepare failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to update tenant record']);
        return;
    }
    $stmt->bind_param('isssissi', $userId, $fullName, $phone, $email, $roomId, $moveInDate, $moveOutDate, $id);
    $tenantOk = $stmt->execute();
    $tenantError = $stmt->error;
    $stmt->close();
    if (!$tenantOk) {
        $connect->rollback();
        error_log('Tenant update failed: ' . $tenantError);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Failed to update tenant record']);
        return;
    }

    $connect->commit();
    rt_publish('/Admin/tenants.php');
    rt_publish('/Tenant/tenantdashboard.php');
    echo json_encode(['type'=>'success','message'=>'Updated','user_id'=>$userId]);
}

function deactivateTenant() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $id = intval($_GET['tenant_id'] ?? 0);

    $tenantLookup = $connect->prepare("SELECT user_id FROM tenants WHERE tenant_id = ? LIMIT 1");
    $tenantLookup->bind_param("i", $id);
    $tenantLookup->execute();
    $tenant = $tenantLookup->get_result()->fetch_assoc();
    $tenantLookup->close();

    $stmt = $connect->prepare("UPDATE tenants SET is_active = 0 WHERE tenant_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok && $tenant && !empty($tenant['user_id'])) {
        $roleReset = $connect->prepare("UPDATE users SET user_type = 'Guest' WHERE user_id = ? AND user_type = 'Tenant'");
        $roleReset->bind_param("i", $tenant['user_id']);
        $roleReset->execute();
        $roleReset->close();
    }

    if ($ok) {
        rt_publish('/Admin/tenants.php');
        rt_publish('/Tenant/tenantdashboard.php');
    }

    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deactivated':'Failed']);
}

function deleteTenant() {
    /** @var mysqli $connect */
    global $connect;

    if (!isset($connect) || !($connect instanceof mysqli)) {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
        return;
    }

    $id = intval($_GET['tenant_id'] ?? 0);

    $tenantLookup = $connect->prepare("SELECT user_id, room_id FROM tenants WHERE tenant_id = ? LIMIT 1");
    $tenantLookup->bind_param("i", $id);
    $tenantLookup->execute();
    $tenant = $tenantLookup->get_result()->fetch_assoc();
    $tenantLookup->close();

    $roomId = intval($tenant['room_id'] ?? 0);
    if ($roomId > 0) {
        $roomReset = $connect->prepare("UPDATE rooms SET status = 'Available' WHERE room_id = ?");
        $roomReset->bind_param("i", $roomId);
        $roomReset->execute();
        $roomReset->close();
    }

    $stmt = $connect->prepare("DELETE FROM tenants WHERE tenant_id = ?");
    $stmt->bind_param("i", $id);
    $ok = $stmt->execute();
    $stmt->close();

    if ($ok && $tenant && !empty($tenant['user_id'])) {
        $roleReset = $connect->prepare("UPDATE users SET user_type = 'Guest' WHERE user_id = ? AND user_type = 'Tenant'");
        $roleReset->bind_param("i", $tenant['user_id']);
        $roleReset->execute();
        $roleReset->close();
    }

    if ($ok) {
        rt_publish('/Admin/tenants.php');
        rt_publish('/Tenant/tenantdashboard.php');
        rt_publish('/Admin/rooms.php');
    }

    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Deleted':'Failed']);
}
?>
