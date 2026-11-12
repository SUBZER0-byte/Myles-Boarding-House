<?php

function tenantIdFromUser($uid): int {
    global $connect;
    $stmt = $connect->prepare("SELECT tenant_id FROM tenants WHERE user_id = ? AND is_active = 1");
    if (!$stmt) {
        error_log('Tenant lookup prepare failed: ' . $connect->error);
        return 0;
    }
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ? (int)$row['tenant_id'] : 0;
}

function requireTenantSession(): array {
    $userId = sec_current_user_id();
    if ($userId <= 0) {
        http_response_code(401);
        echo json_encode(['type'=>'error','message'=>'Authentication required']);
        exit;
    }
    if (sec_current_user_type() !== 'Tenant') {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Tenant access required']);
        exit;
    }

    $tenantId = tenantIdFromUser($userId);
    if ($tenantId <= 0) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Active tenant record required']);
        exit;
    }

    return [$userId, $tenantId];
}
