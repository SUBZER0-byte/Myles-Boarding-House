<?php

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require_once __DIR__ . '/../Config/db.php';
require_once __DIR__ . '/../Config/paypal_booking_reconciliation.php';

if (!($connect instanceof mysqli)) {
    fwrite(STDERR, "Database connection unavailable.\n");
    exit(1);
}

$expiredBookingsUpdated = expire_pending_bookings($connect);
if (!$expiredBookingsUpdated) {
    fwrite(STDERR, "Expired pending bookings could not be processed.\n");
    exit(1);
}

$roomStatusesUpdated = sync_booking_room_status($connect, null);
if (!$roomStatusesUpdated) {
    fwrite(STDERR, "Room statuses could not be synchronized.\n");
    exit(1);
}

$summary = paypal_booking_run_reconciliation($connect, 50);
if ((int)($summary['errors'] ?? 0) > 0) {
    fwrite(STDERR, json_encode([
        'expired_pending_bookings_processed'=>$expiredBookingsUpdated,
        'room_statuses_synchronized'=>$roomStatusesUpdated,
        'paypal'=>$summary,
    ], JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

fwrite(STDOUT, json_encode([
    'expired_pending_bookings_processed'=>$expiredBookingsUpdated,
    'room_statuses_synchronized'=>$roomStatusesUpdated,
    'paypal'=>$summary,
], JSON_UNESCAPED_SLASHES) . PHP_EOL);
