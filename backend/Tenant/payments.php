<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';
require_once __DIR__ . '/../Config/paypal.php';
require_once __DIR__ . '/../Config/system_notifications.php';
require_once __DIR__ . '/../Config/gcash_qr.php';
require_once __DIR__ . '/../Config/refund_requests.php';
require_once __DIR__ . '/../Config/payment_proofs.php';
require_once __DIR__ . '/../Config/tenant_session.php';
require_once __DIR__ . '/../Config/full_payment_requests.php';
require_once __DIR__ . '/../Config/gcash_transaction_references.php';
require_once __DIR__ . '/../Notifications/booking_sms.php';

function paymentBelongsToTenant(int $paymentId, int $tenantId): bool {
    global $connect;
    /** @var mysqli $connect */
    if ($paymentId <= 0 || $tenantId <= 0) {
        return false;
    }

    // TODO: Match through tenants.booking_id once that column exists.
    $stmt = $connect->prepare("
        SELECT 1
        FROM payments p
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = ?
        LEFT JOIN users u ON u.user_id = t.user_id
        WHERE p.payment_id = ?
          AND (
              p.tenant_id = ?
              OR (p.booking_id IS NOT NULL
                  AND b.booking_id = p.booking_id
                  AND b.status <> 'Cancelled'
                  AND (
                      (t.email IS NOT NULL AND t.email <> ''
                       AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
                      OR (u.email IS NOT NULL AND u.email <> ''
                          AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
                      OR (t.move_in_date = b.move_in_date
                          AND t.phone = b.phone
                          AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name)))
                  ))
          )
        LIMIT 1
    ");
    if (!$stmt) {
        error_log('Tenant payment ownership check failed: ' . $connect->error);
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify payment ownership']);
        exit;
    }
    $stmt->bind_param("iii", $tenantId, $paymentId, $tenantId);
    $stmt->execute();
    $belongs = $stmt->get_result()->num_rows > 0;
    $stmt->close();
    return $belongs;
}

function fullPaymentRequestBlocksPayment(int $paymentId, int $tenantId): ?bool {
    global $connect;
    /** @var mysqli $connect */
    $stmt = $connect->prepare("
        SELECT 1
        FROM full_payment_request_items item
        INNER JOIN full_payment_requests request ON request.request_id = item.request_id
        WHERE item.payment_id = ?
          AND request.tenant_id = ?
          AND request.status IN ('Requested','Approved','Submitted')
        LIMIT 1
    ");
    if (!$stmt) {
        error_log('Full payment request check prepare failed: ' . $connect->error);
        return null;
    }
    $stmt->bind_param('ii', $paymentId, $tenantId);
    if (!$stmt->execute()) {
        error_log('Full payment request check failed: ' . $stmt->error);
        $stmt->close();
        return null;
    }
    $blocked = (bool)$stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $blocked;
}

function verifyPayPalCapture(string $captureId): ?array {
    if ($captureId === '') {
        return null;
    }

    $response = pp_request('GET', '/v2/payments/captures/' . rawurlencode($captureId), null, [
        'Authorization' => 'Bearer ' . pp_token(),
        'Content-Type' => 'application/json',
    ]);

    if ($response['code'] < 200 || $response['code'] >= 300 || !is_array($response['data'])) {
        error_log('PayPal payment verification failed: HTTP ' . (int)$response['code'] . ' - ' . trim((string)$response['raw']));
        return null;
    }

    return $response['data'];
}

function verifyPayMongoPayment(string $gatewayPaymentId): ?array {
    $config = require __DIR__ . '/../Config/paymongo.php';
    $secretKey = trim((string)($config['secret_key'] ?? ''));
    if ($secretKey === '') {
        http_response_code(503);
        echo json_encode(['type'=>'error','message'=>'Online payment verification is not configured']);
        exit;
    }

    $ch = curl_init(rtrim((string)$config['api_base'], '/') . '/payments/' . rawurlencode($gatewayPaymentId));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Authorization: Basic ' . base64_encode($secretKey . ':'),
        ],
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $status < 200 || $status >= 300) {
        error_log('PayMongo payment verification failed: ' . ($error !== '' ? $error : 'HTTP ' . $status));
        http_response_code(502);
        echo json_encode(['type'=>'error','message'=>'Unable to verify payment with PayMongo']);
        exit;
    }

    $response = json_decode($raw, true);
    if (!is_array($response) || empty($response['data']['attributes'])) {
        http_response_code(502);
        echo json_encode(['type'=>'error','message'=>'PayMongo returned an invalid payment response']);
        exit;
    }

    return $response['data'];
}

header('Content-Type: application/json');
if (!($connect instanceof mysqli)) {
    http_response_code(503);
    echo json_encode(['type'=>'error','message'=>'Database connection unavailable']);
    exit;
}
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'history':   history(); break;
    case 'pending':   pending(); break;
    case 'submit':    submitPayment(); break;
    case 'receipt':   receipt(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function monthDateForOffset(int $offsetMonths = 0): string {
    $dt = new DateTimeImmutable('first day of this month');
    return $dt->modify("+{$offsetMonths} month")->format('Y-m-01');
}

function addMonthsPreservingDay(string $anchorDate, int $months): string {
    $date = new DateTimeImmutable($anchorDate);
    $target = $date->modify('first day of this month')->modify("+{$months} month");
    $day = min((int)$date->format('d'), (int)$target->format('t'));
    return $target->setDate((int)$target->format('Y'), (int)$target->format('n'), $day)->format('Y-m-d');
}

function getTenantAnchorDate(int $tenantId): ?string {
    global $connect;
    /** @var mysqli $connect */

    $tenantStmt = $connect->prepare("SELECT phone, email FROM tenants WHERE tenant_id = ? AND is_active = 1 LIMIT 1");
    if (!$tenantStmt) {
        return null;
    }

    $tenantStmt->bind_param('i', $tenantId);
    $tenantStmt->execute();
    $tenant = $tenantStmt->get_result()->fetch_assoc();
    $tenantStmt->close();

    if (!$tenant) {
        return null;
    }

    $phone = trim((string)($tenant['phone'] ?? ''));
    $email = trim((string)($tenant['email'] ?? ''));
    if ($phone === '' && $email === '') {
        return null;
    }

    $bookingSql = "SELECT DATE(MIN(created_at)) AS anchor_date FROM bookings WHERE created_at IS NOT NULL AND (";
    $params = [];
    $types = "";
    if ($phone !== '') {
        $bookingSql .= "phone = ?";
        $params[] = $phone;
        $types .= "s";
    }
    if ($email !== '') {
        if ($params) {
            $bookingSql .= " OR ";
        }
        $bookingSql .= "email = ?";
        $params[] = $email;
        $types .= "s";
    }
    $bookingSql .= ") LIMIT 1";

    $bookingStmt = $connect->prepare($bookingSql);
    if (!$bookingStmt) {
        return null;
    }
    if ($params) {
        $bookingStmt->bind_param($types, ...$params);
    }
    $bookingStmt->execute();
    $bookingRow = $bookingStmt->get_result()->fetch_assoc();
    $bookingStmt->close();

    return !empty($bookingRow['anchor_date']) ? $bookingRow['anchor_date'] : null;
}

function ensureTenantMonthlyPayments(?int $tenantId = null, int $offsetMonths = 1): int {
    global $connect;
    /** @var mysqli $connect */

    if ($tenantId === null || $tenantId <= 0) {
        return 0;
    }

    $tenantInfo = $connect->prepare("SELECT r.monthly_rent FROM tenants t LEFT JOIN rooms r ON r.room_id = t.room_id WHERE t.tenant_id = ? AND t.is_active = 1 LIMIT 1");
    $tenantInfo->bind_param("i", $tenantId);
    $tenantInfo->execute();
    $tenantRow = $tenantInfo->get_result()->fetch_assoc();
    $tenantInfo->close();

    if (!$tenantRow || floatval($tenantRow['monthly_rent'] ?? 0) <= 0) {
        return 0;
    }

    $anchorDate = getTenantAnchorDate($tenantId);
    if ($anchorDate === null) {
        return 0;
    }

    $targetDate = addMonthsPreservingDay($anchorDate, max(1, $offsetMonths));
    $exists = $connect->prepare("SELECT payment_id FROM payments WHERE tenant_id = ? AND due_date = ? LIMIT 1");
    $exists->bind_param("is", $tenantId, $targetDate);
    $exists->execute();
    $alreadyExists = $exists->get_result()->fetch_assoc();
    $exists->close();

    if ($alreadyExists) {
        return 0;
    }

    $amount = floatval($tenantRow['monthly_rent'] ?? 0);
    $description = 'Rent for ' . DateTimeImmutable::createFromFormat('!Y-m-d', $targetDate)->format('F Y');
    $insert = $connect->prepare("INSERT INTO payments (tenant_id, amount, due_date, status, description, created_at)
        VALUES (?, ?, ?, 'Pending', ?, NOW())");
    $insert->bind_param("idss", $tenantId, $amount, $targetDate, $description);
    $ok = $insert->execute();
    $insert->close();

    if ($ok) {
        rt_publish('/Tenant/payments.php');
        rt_publish('/Admin/payments.php');
    }

    return $ok ? 1 : 0;
}

function ensureTenantPaymentRows(int $tenantId): void {
    if ($tenantId <= 0) {
        return;
    }

    if (!ensureTenantBookingPayments($tenantId)) {
        ensureTenantMonthlyPayments($tenantId, 1);
        ensureTenantMonthlyPayments($tenantId, 2);
    }
}

function ensureTenantBookingPayments(int $tenantId): bool {
    global $connect;
    /** @var mysqli $connect */

    $stmt = $connect->prepare("
        SELECT b.booking_id, COALESCE(b.move_in_date, t.move_in_date) AS move_in_date,
               COALESCE(b.check_out_date, t.move_out_date) AS check_out_date,
               COALESCE(b.payment_plan, 'Pay Monthly') AS payment_plan,
               COALESCE(r.monthly_rent, tenant_room.monthly_rent) AS monthly_rent
        FROM tenants t
        LEFT JOIN users u ON u.user_id = t.user_id
        LEFT JOIN bookings b
            ON (
                (t.email IS NOT NULL AND t.email <> ''
                 AND LOWER(TRIM(t.email)) = LOWER(TRIM(b.email)))
                OR (u.email IS NOT NULL AND u.email <> ''
                    AND LOWER(TRIM(u.email)) = LOWER(TRIM(b.email)))
                OR (t.move_in_date = b.move_in_date
                    AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(b.full_name))
                    AND t.phone = b.phone)
            )
            AND b.status <> 'Cancelled'
        LEFT JOIN rooms r ON r.room_id = b.room_id
        LEFT JOIN rooms tenant_room ON tenant_room.room_id = t.room_id
        WHERE t.tenant_id = ?
          AND t.is_active = 1
          AND COALESCE(b.move_in_date, t.move_in_date) IS NOT NULL
          AND COALESCE(b.check_out_date, t.move_out_date) IS NOT NULL
        ORDER BY b.move_in_date ASC
    ");
    if (!$stmt) {
        error_log('Tenant booking payment schedule lookup failed: ' . $connect->error);
        return false;
    }

    $stmt->bind_param("i", $tenantId);
    $stmt->execute();
    $bookings = $stmt->get_result();
    $hasSchedule = false;

    while ($booking = $bookings->fetch_assoc()) {
        $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$booking['move_in_date']);
        $checkOut = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$booking['check_out_date']);
        $monthlyRent = (float)($booking['monthly_rent'] ?? 0);
        if (!$checkIn || !$checkOut || $checkOut <= $checkIn || $monthlyRent <= 0) {
            continue;
        }

        $hasSchedule = true;
        $paymentPlan = (string)($booking['payment_plan'] ?? 'Pay Monthly');
        $isFullPayment = $paymentPlan === 'Pay in Full';
        $installmentCount = $isFullPayment
            ? 1
            : ($paymentPlan === 'Pay One Month Rent'
                ? bookingMonthsForPeriod($checkIn, $checkOut)
                : max(1, bookingMonthsForPeriod($checkIn, $checkOut) - 1));
        if (!$isFullPayment && $installmentCount > 1 && !empty($booking['booking_id'])) {
            $securityDeposit = $connect->prepare("
                SELECT payment_id FROM payments
                WHERE booking_id = ? AND payment_type = 'Security Deposit'
                  AND status IN ('Confirmed','Paid')
                LIMIT 1
            ");
            if ($securityDeposit) {
                $bookingIdForDeposit = (int)$booking['booking_id'];
                $securityDeposit->bind_param("i", $bookingIdForDeposit);
                $securityDeposit->execute();
                $depositPaid = $securityDeposit->get_result()->num_rows > 0;
                $securityDeposit->close();
                if ($depositPaid) {
                    $finalDueDate = addMonthsPreservingDay(
                        $checkIn->format('Y-m-d'),
                        $installmentCount
                    );
                    $finalInstallment = $connect->prepare("
                        UPDATE payments
                        SET status = 'Cancelled',
                            description = 'Final month covered by security deposit'
                        WHERE booking_id = ?
                          AND due_date = ?
                          AND payment_type <> 'Security Deposit'
                          AND status IN ('Pending','Overdue')
                    ");
                    if ($finalInstallment) {
                        $finalInstallment->bind_param("is", $bookingIdForDeposit, $finalDueDate);
                        $finalInstallment->execute();
                        $finalInstallment->close();
                    }
                }
            }
        }
        $monthCount = 0;

        while ($monthCount < $installmentCount) {
            $dueDate = new DateTimeImmutable(addMonthsPreservingDay($checkIn->format('Y-m-d'), $monthCount));
            if ($dueDate >= $checkOut) {
                break;
            }
            $dueText = $dueDate->format('Y-m-d');
            $bookingId = !empty($booking['booking_id']) ? (int)$booking['booking_id'] : null;
            if ($bookingId !== null) {
                $exists = $connect->prepare("
                    SELECT payment_id FROM payments
                    WHERE booking_id = ? AND due_date = ? LIMIT 1
                ");
            } else {
                $exists = $connect->prepare("
                    SELECT payment_id FROM payments
                    WHERE tenant_id = ? AND booking_id IS NULL AND due_date = ? LIMIT 1
                ");
            }
            if (!$exists) {
                $stmt->close();
                error_log('Tenant booking payment schedule check failed: ' . $connect->error);
                return $hasSchedule;
            }
            $existsId = $bookingId ?? $tenantId;
            $exists->bind_param("is", $existsId, $dueText);
            $exists->execute();
            $alreadyExists = $exists->get_result()->fetch_assoc();
            $exists->close();

            if ($alreadyExists) {
                $paymentId = (int)$alreadyExists['payment_id'];
                $update = $connect->prepare("UPDATE payments SET tenant_id = ? WHERE payment_id = ?");
                if ($update) {
                    $update->bind_param("ii", $tenantId, $paymentId);
                    $update->execute();
                    $update->close();
                }
            } else {
                $periodStart = $dueDate->format('Y-m-01');
                $periodEnd = $dueDate->format('Y-m-t');
                $legacyPayment = $connect->prepare("
                    SELECT payment_id
                    FROM payments
                    WHERE tenant_id = ?
                      AND booking_id IS NULL
                      AND due_date BETWEEN ? AND ?
                    ORDER BY payment_id ASC
                    LIMIT 1
                ");
                if (!$legacyPayment) {
                    $stmt->close();
                    error_log('Tenant legacy payment lookup failed: ' . $connect->error);
                    return $hasSchedule;
                }
                $legacyPayment->bind_param("iss", $tenantId, $periodStart, $periodEnd);
                $legacyPayment->execute();
                $legacyRow = $legacyPayment->get_result()->fetch_assoc();
                $legacyPayment->close();

                $amount = $isFullPayment
                    ? max(0, round($monthlyRent * bookingMonthsForPeriod($checkIn, $checkOut) - $monthlyRent, 2))
                    : $monthlyRent;
                $description = $isFullPayment
                    ? 'Full stay rent after security deposit credit'
                    : 'Monthly rent installment ' . ($monthCount + 1);
                if ($legacyRow) {
                    $legacyPaymentId = (int)$legacyRow['payment_id'];
                    $update = $connect->prepare("
                        UPDATE payments
                        SET booking_id = ?, due_date = ?, amount = ?, description = ?, payment_type = ?
                        WHERE payment_id = ?
                    ");
                    if (!$update) {
                        $stmt->close();
                        error_log('Tenant legacy payment update failed: ' . $connect->error);
                        return $hasSchedule;
                    }
                    $update->bind_param(
                        "isdssi",
                        $bookingId,
                        $dueText,
                        $amount,
                        $description,
                        $paymentPlan,
                        $legacyPaymentId
                    );
                    if (!$update->execute()) {
                        error_log('Tenant legacy payment update failed: ' . $update->error);
                        $update->close();
                        $stmt->close();
                        return $hasSchedule;
                    }
                    $update->close();
                    $monthCount++;
                    if ($isFullPayment) {
                        break;
                    }
                    continue;
                }
                if ($bookingId !== null) {
                    $insert = $connect->prepare("
                        INSERT INTO payments
                            (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
                        VALUES (?, ?, ?, ?, 'Pending', ?, ?, NOW())
                    ");
                } else {
                    $insert = $connect->prepare("
                        INSERT INTO payments
                            (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
                        VALUES (NULL, ?, ?, ?, 'Pending', ?, ?, NOW())
                    ");
                }
                if (!$insert) {
                    $stmt->close();
                    error_log('Tenant booking payment schedule insert failed: ' . $connect->error);
                    return $hasSchedule;
                }
                if ($bookingId !== null) {
                    $insert->bind_param(
                        "iidsss",
                        $bookingId,
                        $tenantId,
                        $amount,
                        $dueText,
                        $description,
                        $paymentPlan
                    );
                } else {
                    $insert->bind_param("idsss", $tenantId, $amount, $dueText, $description, $paymentPlan);
                }
                if (!$insert->execute()) {
                    error_log('Tenant booking payment schedule insert failed: ' . $insert->error);
                    $insert->close();
                    $stmt->close();
                    return $hasSchedule;
                }
                $insert->close();
            }

            $monthCount++;
            if ($isFullPayment) {
                break;
            }
        }
    }

    $stmt->close();
    return $hasSchedule;
}

function bookingMonthsForPeriod(DateTimeImmutable $checkIn, DateTimeImmutable $checkOut): int {
    $months = ((int)$checkOut->format('Y') - (int)$checkIn->format('Y')) * 12
        + (int)$checkOut->format('n') - (int)$checkIn->format('n');
    if ((int)$checkOut->format('j') > (int)$checkIn->format('j')) {
        $months++;
    }
    return max(1, $months);
}

function history() {
    global $connect;
    /** @var mysqli $connect */
    [, $tid] = requireTenantSession();
    if (!ensure_refund_requests_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to initialize payment history']);
        return;
    }
    if (!ensure_payment_proofs_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to initialize payment history']);
        return;
    }
    ensureTenantPaymentRows($tid);
    $stmt = $connect->prepare("
        SELECT p.*,
               EXISTS(SELECT 1 FROM payment_proofs proof WHERE proof.payment_id = p.payment_id) AS has_payment_screenshot,
               COALESCE((
                   SELECT SUM(refund.refund_amount)
                   FROM refund_requests refund
                   WHERE refund.payment_id = p.payment_id AND refund.status = 'Approved'
               ), 0) AS refunded_amount,
               (
                   p.status IN ('Confirmed','Paid')
                   AND p.due_date IS NOT NULL
                   AND CURDATE() < LEAST(
                       DATE_ADD(p.due_date, INTERVAL 1 MONTH),
                       COALESCE(b.check_out_date, t.move_out_date, DATE_ADD(p.due_date, INTERVAL 1 MONTH))
                   )
                   AND p.amount > COALESCE((
                       SELECT SUM(refund.refund_amount)
                       FROM refund_requests refund
                       WHERE refund.payment_id = p.payment_id AND refund.status = 'Approved'
                   ), 0)
                   AND NOT EXISTS (
                       SELECT 1 FROM refund_requests pending_refund
                       WHERE pending_refund.payment_id = p.payment_id AND pending_refund.status = 'Pending'
                   )
               ) AS refund_available,
               COALESCE(b.move_in_date, t.move_in_date) AS check_in_date,
               COALESCE(b.check_out_date, t.move_out_date, (
                    SELECT matched_booking.check_out_date
                    FROM bookings matched_booking
                    WHERE matched_booking.status <> 'Cancelled'
                      AND (
                           (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(matched_booking.email)) = LOWER(TRIM(t.email)))
                           OR (tu.email IS NOT NULL AND tu.email <> '' AND LOWER(TRIM(matched_booking.email)) = LOWER(TRIM(tu.email)))
                           OR (t.move_in_date = matched_booking.move_in_date
                               AND t.phone = matched_booking.phone
                               AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(matched_booking.full_name)))
                      )
                    ORDER BY matched_booking.created_at DESC
                    LIMIT 1
               )) AS check_out_date
        FROM payments p
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        LEFT JOIN users tu ON tu.user_id = t.user_id
        WHERE p.tenant_id = ?
           OR (p.booking_id IS NOT NULL AND EXISTS (
                SELECT 1
                FROM bookings owned_booking
                INNER JOIN tenants owned_tenant
                    ON owned_tenant.tenant_id = ?
                LEFT JOIN users owned_user ON owned_user.user_id = owned_tenant.user_id
                WHERE owned_booking.booking_id = p.booking_id
                  AND owned_booking.status <> 'Cancelled'
                  AND (
                      (owned_tenant.email IS NOT NULL AND owned_tenant.email <> ''
                       AND LOWER(TRIM(owned_tenant.email)) = LOWER(TRIM(owned_booking.email)))
                      OR (owned_user.email IS NOT NULL AND owned_user.email <> ''
                          AND LOWER(TRIM(owned_user.email)) = LOWER(TRIM(owned_booking.email)))
                      OR (owned_tenant.move_in_date = owned_booking.move_in_date
                          AND owned_tenant.phone = owned_booking.phone
                          AND LOWER(TRIM(owned_tenant.full_name)) = LOWER(TRIM(owned_booking.full_name)))
                  )
           ))
        ORDER BY p.due_date DESC
    ");
    $stmt->bind_param("ii", $tid, $tid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function pending() {
    global $connect;
    /** @var mysqli $connect */
    [, $tid] = requireTenantSession();
    ensureTenantPaymentRows($tid);
    $stmt = $connect->prepare("
        SELECT p.*, COALESCE(b.move_in_date, t.move_in_date) AS check_in_date,
               COALESCE(b.check_out_date, t.move_out_date, (
                    SELECT matched_booking.check_out_date
                    FROM bookings matched_booking
                    WHERE matched_booking.status <> 'Cancelled'
                      AND (
                           (t.email IS NOT NULL AND t.email <> '' AND LOWER(TRIM(matched_booking.email)) = LOWER(TRIM(t.email)))
                           OR (tu.email IS NOT NULL AND tu.email <> '' AND LOWER(TRIM(matched_booking.email)) = LOWER(TRIM(tu.email)))
                           OR (t.move_in_date = matched_booking.move_in_date
                               AND t.phone = matched_booking.phone
                               AND LOWER(TRIM(t.full_name)) = LOWER(TRIM(matched_booking.full_name)))
                      )
                    ORDER BY matched_booking.created_at DESC
                    LIMIT 1
               )) AS check_out_date
        FROM payments p
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        LEFT JOIN users tu ON tu.user_id = t.user_id
        WHERE (p.tenant_id = ?
           OR (p.booking_id IS NOT NULL AND EXISTS (
                SELECT 1
                FROM bookings owned_booking
                INNER JOIN tenants owned_tenant
                    ON owned_tenant.tenant_id = ?
                LEFT JOIN users owned_user ON owned_user.user_id = owned_tenant.user_id
                WHERE owned_booking.booking_id = p.booking_id
                  AND owned_booking.status <> 'Cancelled'
                  AND (
                      (owned_tenant.email IS NOT NULL AND owned_tenant.email <> ''
                       AND LOWER(TRIM(owned_tenant.email)) = LOWER(TRIM(owned_booking.email)))
                      OR (owned_user.email IS NOT NULL AND owned_user.email <> ''
                          AND LOWER(TRIM(owned_user.email)) = LOWER(TRIM(owned_booking.email)))
                      OR (owned_tenant.move_in_date = owned_booking.move_in_date
                          AND owned_tenant.phone = owned_booking.phone
                          AND LOWER(TRIM(owned_tenant.full_name)) = LOWER(TRIM(owned_booking.full_name)))
                  )
           )))
          AND p.status IN ('Pending','Overdue')
        ORDER BY p.due_date ASC
    ");
    $stmt->bind_param("ii", $tid, $tid);
    $stmt->execute();
    $res = $stmt->get_result();
    $rows = [];
    while ($r = $res->fetch_assoc()) $rows[] = $r;
    $stmt->close();
    echo json_encode(['type'=>'success','data'=>$rows]);
}

function submitPayment() {
    global $connect;
    /** @var mysqli $connect */
    [$userId, $tenantId] = requireTenantSession();
    $isMultipart = stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
    $data = $isMultipart ? $_POST : json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) $data = [];
    $paymentId = (int)($data['payment_id'] ?? 0);
    $uploadedScreenshotPath = null;
    $gatewayCaptureId = trim((string)($data['paypal_capture_id'] ?? $data['capture_id'] ?? $data['paymongo_payment_id'] ?? ''));
    $gatewayOrderId = trim((string)($data['paypal_order_id'] ?? $data['order_id'] ?? ''));
    $method = trim((string)($data['method'] ?? 'PayPal'));
    if (!in_array($method, ['PayPal', 'GCash'], true)) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Unsupported payment method']);
        return;
    }

    if ($paymentId <= 0 || ($method === 'PayPal' && $gatewayCaptureId === '' && $gatewayOrderId === '')) {
        http_response_code(400);
        echo json_encode(['type'=>'error','message'=>'Payment details are incomplete']);
        return;
    }
    if (!paymentBelongsToTenant($paymentId, $tenantId)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Payment access denied']);
        return;
    }
    if (!ensure_full_payment_requests_table($connect)) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify full payment requests']);
        return;
    }
    $isCoveredByOpenRequest = fullPaymentRequestBlocksPayment($paymentId, $tenantId);
    if ($isCoveredByOpenRequest === null) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to verify full payment request status']);
        return;
    }
    if ($isCoveredByOpenRequest) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'This installment is part of your full payment request.']);
        return;
    }

    $lookup = $connect->prepare('SELECT amount, status, reference_number, paypal_order_id FROM payments WHERE payment_id = ? LIMIT 1');
    if (!$lookup) {
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to load payment record']);
        return;
    }
    $lookup->bind_param('i', $paymentId);
    $lookup->execute();
    $payment = $lookup->get_result()->fetch_assoc();
    $lookup->close();
    if (!$payment) {
        http_response_code(404);
        echo json_encode(['type'=>'error','message'=>'Payment not found']);
        return;
    }
    if ($method === 'GCash') {
        $reference = trim((string)($data['reference'] ?? ''));
        $hasScreenshot = isset($_FILES['screenshot']) && (int)($_FILES['screenshot']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
        if ((!$hasScreenshot && $reference === '') || strlen($reference) > 120) {
            http_response_code(400);
            echo json_encode(['type'=>'error','message'=>'Enter a GCash transaction reference or upload a payment screenshot']);
            return;
        }
        if ($reference !== '' && !ensure_gcash_transaction_references_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to validate the GCash transaction reference']);
            return;
        }
        if (!ensure_payment_proofs_table($connect)) {
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to initialize payment proof storage']);
            return;
        }
        if ($hasScreenshot) {
            [$uploadedScreenshotPath, $uploadError] = store_payment_screenshot($_FILES['screenshot']);
            if ($uploadError !== null) {
                http_response_code(400);
                echo json_encode(['type'=>'error','message'=>$uploadError]);
                return;
            }
        }
        try {
            $qrAvailable = gcash_qr_available((float)$payment['amount']);
        } catch (Throwable $error) {
            if ($uploadedScreenshotPath !== null) {
                @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            }
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>$error->getMessage()]);
            return;
        }
        if (!$qrAvailable) {
            if ($uploadedScreenshotPath !== null) {
                @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            }
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'No GCash QR is configured']);
            return;
        }
        if ($payment['status'] === 'Submitted'
            && (string)$payment['reference_number'] === $reference
            && $uploadedScreenshotPath === null) {
            echo json_encode(['type'=>'success','message'=>'GCash payment is already submitted for admin review']);
            return;
        }
        if (!in_array($payment['status'], ['Pending', 'Overdue'], true)) {
            if ($uploadedScreenshotPath !== null) {
                @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            }
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'This payment is not awaiting payment']);
            return;
        }

        $connect->begin_transaction();
        $paymentLock = $connect->prepare('SELECT status FROM payments WHERE payment_id = ? FOR UPDATE');
        if (!$paymentLock) {
            $connect->rollback();
            if ($uploadedScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to lock the rent installment']);
            return;
        }
        $paymentLock->bind_param('i', $paymentId);
        $paymentLock->execute();
        $lockedPayment = $paymentLock->get_result()->fetch_assoc();
        $paymentLock->close();
        $blockedByFullPayment = fullPaymentRequestBlocksPayment($paymentId, $tenantId);
        if (!$lockedPayment || $blockedByFullPayment !== false) {
            $connect->rollback();
            if ($uploadedScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            http_response_code($blockedByFullPayment === true ? 409 : 500);
            echo json_encode(['type'=>'error','message'=>$blockedByFullPayment === true
                ? 'This installment is part of your full payment request.'
                : 'Unable to verify the rent installment status']);
            return;
        }
        if ($reference !== '') {
            $reserved = reserve_gcash_transaction_reference($connect, $reference);
            if ($reserved !== true) {
                $connect->rollback();
                if ($uploadedScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
                http_response_code($reserved === false ? 409 : 500);
                echo json_encode(['type'=>'error','message'=>$reserved === false
                    ? 'This GCash reference has already been submitted'
                    : 'Unable to validate the GCash transaction reference']);
                return;
            }
        }
        $update = $connect->prepare("
            UPDATE payments
            SET tenant_id = ?, status = 'Submitted', method = 'GCash', reference_number = ?,
                submitted_at = COALESCE(submitted_at, NOW())
            WHERE payment_id = ? AND status IN ('Pending', 'Overdue')
        ");
        if (!$update) {
            $connect->rollback();
            if ($uploadedScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            http_response_code(500);
            echo json_encode(['type'=>'error','message'=>'Unable to submit GCash payment for review']);
            return;
        }
        $update->bind_param('isi', $tenantId, $reference, $paymentId);
        $ok = $update->execute() && $update->affected_rows === 1;
        $update->close();
        if ($ok && $uploadedScreenshotPath !== null) {
            $proof = $connect->prepare("
                INSERT INTO payment_proofs (payment_id, screenshot_path)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE screenshot_path = VALUES(screenshot_path), uploaded_at = NOW()
            ");
            if (!$proof) {
                $ok = false;
            } else {
                $proof->bind_param('is', $paymentId, $uploadedScreenshotPath);
                $ok = $proof->execute();
                $proof->close();
            }
        }
        if (!$ok) {
            $connect->rollback();
            if ($uploadedScreenshotPath !== null) @unlink(__DIR__ . '/../uploads/' . $uploadedScreenshotPath);
            http_response_code(409);
            echo json_encode(['type'=>'error','message'=>'Unable to save payment submission; refresh your payment history']);
            return;
        }
        $connect->commit();

        sms_notify_admins_rent_payment(
            $connect,
            $paymentId,
            $tenantId,
            'GCash',
            (float)$payment['amount'],
            $reference,
            true
        );
        system_notify_admins(
            $connect,
            'Rent Payment Needs Review',
            'Tenant #' . $tenantId . ' submitted a GCash rent payment of ₱' . number_format((float)$payment['amount'], 2) . ' for admin review.',
            'payment'
        );
        rt_publish('/Tenant/payments.php');
        rt_publish('/Admin/payments.php');
        echo json_encode(['type'=>'success','message'=>'GCash payment submitted for admin review']);
        return;
    }

    if ($gatewayOrderId === '' || !hash_equals((string)($payment['paypal_order_id'] ?? ''), $gatewayOrderId)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal order does not match this rent payment']);
        return;
    }
    $alreadyRecorded = in_array($payment['status'], ['Paid', 'Confirmed'], true);
    if (!$alreadyRecorded && !in_array($payment['status'], ['Pending', 'Overdue'], true)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'This payment is not awaiting payment']);
        return;
    }

    $verification = $gatewayCaptureId !== '' ? verifyPayPalCapture($gatewayCaptureId) : null;
    if ($verification === null) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal has not confirmed this payment']);
        return;
    }

    $status = strtoupper((string)($verification['status'] ?? ''));
    if ($status !== 'COMPLETED') {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal has not confirmed this payment']);
        return;
    }
    $captureOrderId = (string)($verification['supplementary_data']['related_ids']['order_id'] ?? '');
    if ($captureOrderId === '' || !hash_equals($gatewayOrderId, $captureOrderId)) {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal capture does not match this rent payment']);
        return;
    }

    $amountValue = (float)($verification['amount']['value'] ?? 0);
    $expectedAmount = (float)$payment['amount'];
    if (abs($amountValue - $expectedAmount) >= 0.01 || strtoupper((string)($verification['amount']['currency'] ?? '')) !== 'PHP') {
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'PayPal payment amount does not match this rent installment']);
        return;
    }

    $reference = trim((string)($verification['id'] ?? $gatewayCaptureId ?: $gatewayOrderId));
    if ($alreadyRecorded) {
        if ((string)$payment['reference_number'] === $reference) {
            echo json_encode(['type'=>'success','message'=>'Payment is already recorded']);
            return;
        }
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'This payment has already been recorded']);
        return;
    }

    $connect->begin_transaction();
    $paymentLock = $connect->prepare('SELECT status FROM payments WHERE payment_id = ? FOR UPDATE');
    if (!$paymentLock) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to lock the rent installment']);
        return;
    }
    $paymentLock->bind_param('i', $paymentId);
    $paymentLock->execute();
    $lockedPayment = $paymentLock->get_result()->fetch_assoc();
    $paymentLock->close();
    $blockedByFullPayment = fullPaymentRequestBlocksPayment($paymentId, $tenantId);
    if (!$lockedPayment || !in_array($lockedPayment['status'], ['Pending', 'Overdue'], true) || $blockedByFullPayment !== false) {
        $connect->rollback();
        http_response_code($blockedByFullPayment === true ? 409 : 409);
        echo json_encode(['type'=>'error','message'=>$blockedByFullPayment === true
            ? 'This installment is part of your full payment request.'
            : 'Payment status changed; refresh your payment history']);
        return;
    }

    $update = $connect->prepare("
        UPDATE payments
        SET tenant_id = ?, status = 'Paid', method = ?, reference_number = ?,
            submitted_at = COALESCE(submitted_at, NOW()),
            confirmation_date = NOW(), paid_at = NOW(),
            paypal_capture_id = ?, paypal_order_id = ?
        WHERE payment_id = ? AND status IN ('Pending', 'Overdue')
    ");
    if (!$update) {
        $connect->rollback();
        http_response_code(500);
        echo json_encode(['type'=>'error','message'=>'Unable to record confirmed payment']);
        return;
    }
    $update->bind_param('issssi', $tenantId, $method, $reference, $gatewayCaptureId, $gatewayOrderId, $paymentId);
    $ok = $update->execute() && $update->affected_rows === 1;
    $update->close();
    if (!$ok) {
        $connect->rollback();
        http_response_code(409);
        echo json_encode(['type'=>'error','message'=>'Payment status changed; refresh your payment history']);
        return;
    }
    $connect->commit();

    sms_notify_admins_rent_payment(
        $connect,
        $paymentId,
        $tenantId,
        $method,
        $expectedAmount,
        $reference
    );
    system_notify_user(
        $connect,
        $userId,
        'Rent Payment Confirmed',
        'Your rent payment of ₱' . number_format($expectedAmount, 2) . ' was successfully paid through PayPal.',
        'payment'
    );
    rt_publish('/Tenant/payments.php');
    rt_publish('/Admin/payments.php');
    echo json_encode(['type'=>'success','message'=>'Rent payment confirmed and recorded']);
}

function receipt() {
    global $connect;
    /** @var mysqli $connect */
    [, $tenantId] = requireTenantSession();
    $id = intval($_GET['payment_id'] ?? 0);
    if (!paymentBelongsToTenant($id, $tenantId)) {
        http_response_code(403);
        echo json_encode(['type'=>'error','message'=>'Payment access denied']);
        return;
    }
    $stmt = $connect->prepare("
        SELECT p.*, COALESCE(t.full_name, b.full_name) AS full_name, r.room_number
        FROM payments p
        LEFT JOIN tenants t ON t.tenant_id = p.tenant_id
        LEFT JOIN bookings b ON b.booking_id = p.booking_id
        LEFT JOIN rooms r ON r.room_id = COALESCE(t.room_id, b.room_id)
        WHERE p.payment_id = ?
    ");
    $stmt->bind_param("i", $id);
    $stmt->execute();
    echo json_encode(['type'=>'success','data'=>$stmt->get_result()->fetch_assoc()]);
    $stmt->close();
}
?>
