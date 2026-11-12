<?php
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only\n");
}

date_default_timezone_set('Asia/Manila');
require_once __DIR__ . '/../Config/db.php';
require_once __DIR__ . '/booking_sms.php';

if (!($connect instanceof mysqli)) {
    fwrite(STDERR, "Database connection unavailable.\n");
    exit(1);
}

$dryRun = in_array('--dry-run', $argv, true);
$config = include __DIR__ . '/../Config/sms.php';
if (!$dryRun && empty($config['enabled'])) {
    fwrite(STDERR, "TextBee SMS is disabled. No reminders were sent.\n");
    exit(1);
}

$reminderCutoff = (new DateTimeImmutable('today', new DateTimeZone('Asia/Manila')))
    ->modify('+3 days')
    ->format('Y-m-d');
$query = $connect->prepare("
    SELECT p.payment_id, p.amount, p.due_date, p.description, p.payment_type,
           t.full_name, COALESCE(NULLIF(TRIM(u.phone), ''), t.phone) AS phone, r.room_number
    FROM payments p
    INNER JOIN tenants t ON t.tenant_id = p.tenant_id AND t.is_active = 1
    LEFT JOIN users u ON u.user_id = t.user_id AND u.is_active = 1
    LEFT JOIN rooms r ON r.room_id = t.room_id
    WHERE p.due_date IS NOT NULL
      AND p.due_date <= ?
      AND p.status NOT IN ('Paid', 'Confirmed', 'Cancelled', 'Rejected')
      AND COALESCE(p.payment_type, '') <> 'Security Deposit'
      AND COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(t.phone), '')) IS NOT NULL
    ORDER BY p.due_date ASC, p.payment_id ASC
");
if (!$query) {
    fwrite(STDERR, "Unable to find rent payments: {$connect->error}\n");
    exit(1);
}
if (!$query->bind_param('s', $reminderCutoff) || !$query->execute()) {
    fwrite(STDERR, "Unable to find rent payments: {$query->error}\n");
    $query->close();
    exit(1);
}
$payments = $query->get_result();

$today = date('Y-m-d');
$sent = 0;
$skipped = 0;
$failed = 0;
while ($payment = $payments->fetch_assoc()) {
    $eventKey = 'rent-reminder:' . (int)$payment['payment_id'] . ':' . $today;
    $dueDate = new DateTimeImmutable((string)$payment['due_date'], new DateTimeZone('Asia/Manila'));
    $todayDate = new DateTimeImmutable($today, new DateTimeZone('Asia/Manila'));
    $overdue = $dueDate < $todayDate;
    $paymentLabel = trim((string)($payment['description'] ?? ''));
    if ($paymentLabel === '') $paymentLabel = 'rent payment';
    $room = trim((string)($payment['room_number'] ?? ''));
    $message = "Hi {$payment['full_name']}, this is a reminder that your {$paymentLabel}"
        . ($room !== '' ? " for Room {$room}" : '')
        . " of PHP " . number_format((float)$payment['amount'], 2)
        . ($overdue ? " was due on " : " is due on ")
        . $dueDate->format('M j, Y')
        . ". Please pay as soon as possible. If already paid, please disregard. — Myle's Boarding House";

    if ($dryRun) {
        echo "Would remind payment #{$payment['payment_id']} due {$payment['due_date']}.\n";
        continue;
    }

    $result = sms_send_once($connect, $eventKey, (string)$payment['phone'], $message);
    if (!empty($result['duplicate'])) {
        $skipped++;
    } elseif (!empty($result['ok'])) {
        $sent++;
    } else {
        $failed++;
        error_log("Rent reminder failed for payment #{$payment['payment_id']}: " . ($result['error'] ?? 'SMS delivery failed'));
    }
}
$payments->free();
$query->close();

echo $dryRun
    ? "Dry run complete. No SMS sent.\n"
    : "Rent reminder run complete: {$sent} sent, {$skipped} already sent today, {$failed} failed.\n";
if ($failed > 0) exit(1);
