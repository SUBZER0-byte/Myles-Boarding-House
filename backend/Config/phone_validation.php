<?php
/**
 * Phone validation helpers for preventing obvious fake numbers during signup.
 *
 * This is intentionally conservative: it validates the Philippines format and
 * rejects common fake-number patterns (e.g. repeated digits, obvious placeholders).
 */

function normalize_phone(string $raw): string {
    $n = preg_replace('/[^\d+]/', '', trim($raw));
    if ($n === '') {
        return '';
    }

    if (str_starts_with($n, '+')) {
        return $n;
    }

    if (strlen($n) === 11 && str_starts_with($n, '0')) {
        return '+63' . substr($n, 1);
    }

    if (strlen($n) === 12 && str_starts_with($n, '63')) {
        return '+' . $n;
    }

    if (strlen($n) === 10 && str_starts_with($n, '9')) {
        return '+63' . $n;
    }

    return $n;
}

function canonical_phone(string $raw): string {
    $n = preg_replace('/[^\d]/', '', trim((string) $raw));
    if ($n === '') {
        return '';
    }

    if (str_starts_with($n, '63')) {
        return '0' . substr($n, 2);
    }

    if (str_starts_with($n, '+63')) {
        return '0' . substr($n, 3);
    }

    if (str_starts_with($n, '0')) {
        return $n;
    }

    if (strlen($n) === 10 && str_starts_with($n, '9')) {
        return '0' . $n;
    }

    return $n;
}

function is_valid_ph_mobile_number(string $raw): bool {
    $normalized = canonical_phone($raw);
    return preg_match('/^09\d{9}$/', $normalized) === 1;
}

function is_probably_real_mobile_number(string $raw): bool {
    if (!is_valid_ph_mobile_number($raw)) {
        return false;
    }

    $digits = canonical_phone($raw);

    $blockedPrefixes = [
        '000', '111', '222', '333', '444', '555', '666', '777', '888', '999',
        '123', '456', '789', '010', '020', '030', '040', '050', '060', '070', '080', '090'
    ];

    if (in_array(substr($digits, 1, 3), $blockedPrefixes, true)) {
        return false;
    }

    if (preg_match('/(\d)\1{5,}/', substr($digits, 2))) {
        return false;
    }

    if (preg_match('/^09\d{9}$/', $digits) !== 1) {
        return false;
    }

    return true;
}

function active_booking_statuses(): array {
    return ['Pending', 'Pending Verification', 'Confirmed', 'Checked In', 'Active'];
}

function has_active_phone_conflict(
    mysqli $connect,
    string $phone,
    ?int $excludeBookingId = null,
    ?int $excludeTenantId = null,
    ?int $currentUserId = null,
    ?string $currentEmail = null
): array {
    $normalized = canonical_phone($phone);
    if ($normalized === '' || !preg_match('/^09\d{9}$/', $normalized)) {
        return ['booking' => null, 'tenant' => null];
    }

    $statuses = active_booking_statuses();
    $statusPlaceholders = implode(',', array_fill(0, count($statuses), '?'));
    $bookingSql = "SELECT booking_id, status, email, phone
        FROM bookings WHERE status IN ($statusPlaceholders)
          AND (status <> 'Pending'
               OR EXISTS (
                   SELECT 1 FROM booking_initial_payment_requests initial_request
                   WHERE initial_request.booking_id = bookings.booking_id
                     AND initial_request.status IN ('Submitted','Confirmed')
               )
               OR EXISTS (
                   SELECT 1 FROM payments initial_payment
                   WHERE initial_payment.booking_id = bookings.booking_id
                     AND initial_payment.payment_type = CASE
                         WHEN bookings.payment_plan = 'Pay One Month Rent' THEN 'Pay One Month Rent'
                         ELSE 'Security Deposit'
                     END
                     AND initial_payment.status IN ('Submitted','Confirmed','Paid')
               ))";
    $bookingParams = $statuses;
    $bookingTypes = str_repeat('s', count($statuses));
    if ($excludeBookingId !== null) {
        $bookingSql .= " AND booking_id != ?";
        $bookingParams[] = $excludeBookingId;
        $bookingTypes .= 'i';
    }
    $bookingSql .= " LIMIT 1";

    $bookStmt = $connect->prepare($bookingSql);
    $bookingExists = null;
    if ($bookStmt) {
        $bookStmt->bind_param($bookingTypes, ...$bookingParams);
        $bookStmt->execute();
        $result = $bookStmt->get_result();
        while ($candidate = $result->fetch_assoc()) {
            if (canonical_phone((string)($candidate['phone'] ?? '')) !== $normalized) {
                continue;
            }
            $candidate['is_current_user'] = $currentEmail !== null
                && strcasecmp(trim((string)$candidate['email']), trim($currentEmail)) === 0;
            $bookingExists = $candidate;
            break;
        }
        $bookStmt->close();
    }

    $tenantSql = "SELECT tenant_id, user_id, phone
        FROM tenants WHERE is_active = 1";
    $tenantParams = [];
    $tenantTypes = '';
    if ($excludeTenantId !== null) {
        $tenantSql .= " AND tenant_id != ?";
        $tenantParams[] = $excludeTenantId;
        $tenantTypes .= 'i';
    }
    $tenantSql .= " LIMIT 1";

    $tenantStmt = $connect->prepare($tenantSql);
    $tenantExists = null;
    if ($tenantStmt) {
        if ($tenantParams) {
            $tenantStmt->bind_param($tenantTypes, ...$tenantParams);
        }
        $tenantStmt->execute();
        $result = $tenantStmt->get_result();
        while ($candidate = $result->fetch_assoc()) {
            if (canonical_phone((string)($candidate['phone'] ?? '')) !== $normalized) {
                continue;
            }
            $candidate['is_current_user'] = $currentUserId !== null
                && (int)($candidate['user_id'] ?? 0) === $currentUserId;
            $tenantExists = $candidate;
            break;
        }
        $tenantStmt->close();
    }

    return ['booking' => $bookingExists, 'tenant' => $tenantExists];
}
