<?php

function createConfirmedBookingPayments(
    mysqli $connect,
    array $booking,
    string $method,
    string $reference,
    ?int $confirmedBy = null,
    ?string $paypalCaptureId = null,
    ?string $paypalOrderId = null
): void {
    $bookingId = (int)($booking['booking_id'] ?? 0);
    $monthlyRent = round((float)($booking['monthly_rent'] ?? 0), 2);
    $totalRent = round((float)($booking['total_rent'] ?? 0), 2);
    $months = max(1, (int)round((float)($booking['length_of_stay_months'] ?? 1)));
    $paymentPlan = (string)($booking['payment_plan'] ?? '');
    $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', (string)($booking['move_in_date'] ?? ''));
    $checkOut = DateTimeImmutable::createFromFormat('!Y-m-d', (string)($booking['check_out_date'] ?? ''));

    if ($bookingId <= 0 || $monthlyRent <= 0 || $totalRent <= 0
        || !in_array($paymentPlan, ['Pay in Full', 'Pay Monthly', 'Pay One Month Rent'], true)
        || !$checkIn || !$checkOut || $checkOut <= $checkIn
        || !in_array($method, ['GCash', 'PayPal'], true)
        || ($method === 'PayPal' && $reference === '')) {
        throw new RuntimeException('Booking payment details are invalid');
    }

    $cancelLegacySchedule = $connect->prepare("
        UPDATE payments
        SET status = 'Cancelled'
        WHERE booking_id = ? AND status IN ('Pending','Overdue')
    ");
    if (!$cancelLegacySchedule) {
        throw new RuntimeException('Unable to replace the unconfirmed booking payment schedule');
    }
    $cancelLegacySchedule->bind_param('i', $bookingId);
    if (!$cancelLegacySchedule->execute()) {
        $cancelLegacySchedule->close();
        throw new RuntimeException('Unable to replace the unconfirmed booking payment schedule');
    }
    $cancelLegacySchedule->close();

    $insertPaid = $connect->prepare("
        INSERT INTO payments
            (booking_id, tenant_id, amount, due_date, status, description, payment_type,
             method, reference_number, paypal_capture_id, paypal_order_id, submitted_at,
             confirmation_date, confirmed_by, paid_at, created_at)
        VALUES (?, NULL, ?, ?, 'Paid', ?, ?, ?, ?, ?, ?, NOW(), NOW(), NULLIF(?, 0), NOW(), NOW())
    ");
    if (!$insertPaid) {
        throw new RuntimeException('Unable to prepare confirmed booking payment records');
    }

    $insertPending = $connect->prepare("
        INSERT INTO payments
            (booking_id, tenant_id, amount, due_date, status, description, payment_type, created_at)
        VALUES (?, NULL, ?, ?, 'Pending', ?, ?, NOW())
    ");
    if (!$insertPending) {
        $insertPaid->close();
        throw new RuntimeException('Unable to prepare the booking rent schedule');
    }

    $insertPaidRecord = static function (float $amount, string $dueDate, string $description, string $paymentType) use (
        $insertPaid,
        $bookingId,
        $method,
        $reference,
        $paypalCaptureId,
        $paypalOrderId,
        $confirmedBy
    ): void {
        $confirmedById = $confirmedBy ?? 0;
        $insertPaid->bind_param(
            'idsssssssi',
            $bookingId,
            $amount,
            $dueDate,
            $description,
            $paymentType,
            $method,
            $reference,
            $paypalCaptureId,
            $paypalOrderId,
            $confirmedById
        );
        if (!$insertPaid->execute()) {
            throw new RuntimeException('Unable to save a confirmed booking payment');
        }
    };

    try {
        $rentAmount = $paymentPlan === 'Pay in Full'
            ? max(0, round($totalRent - $monthlyRent, 2))
            : $monthlyRent;
        if ($rentAmount > 0) {
            $description = $paymentPlan === 'Pay in Full'
                ? 'Full stay rent after security deposit credit'
                : ($paymentPlan === 'Pay One Month Rent' ? 'One-month rent paid before move-in' : 'Monthly rent installment 1');
            $paymentType = $paymentPlan === 'Pay One Month Rent' ? 'Pay One Month Rent' : $paymentPlan;
            $insertPaidRecord($rentAmount, $checkIn->format('Y-m-d'), $description, $paymentType);
        }

        if ($paymentPlan === 'Pay One Month Rent') {
            $depositDueDate = $checkIn->format('Y-m-d');
            $depositDescription = 'One-month security deposit due at move-in';
            $depositType = 'Security Deposit';
            $insertPending->bind_param(
                'idsss',
                $bookingId,
                $monthlyRent,
                $depositDueDate,
                $depositDescription,
                $depositType
            );
            if (!$insertPending->execute()) {
                throw new RuntimeException('Unable to save the move-in security deposit');
            }
        } else {
            $insertPaidRecord($monthlyRent, $checkIn->format('Y-m-d'), 'One-month security deposit', 'Security Deposit');
        }

        if ($paymentPlan !== 'Pay in Full') {
            $lastInstallmentIndex = $paymentPlan === 'Pay One Month Rent' ? $months : $months - 1;
            for ($index = 1; $index < $lastInstallmentIndex; $index++) {
                $due = $checkIn->modify('first day of this month')->modify("+{$index} month");
                $due = $due->setDate(
                    (int)$due->format('Y'),
                    (int)$due->format('n'),
                    min((int)$checkIn->format('j'), (int)$due->format('t'))
                );
                if ($due >= $checkOut) {
                    break;
                }

                $dueDate = $due->format('Y-m-d');
                $description = 'Monthly rent installment ' . ($index + 1);
                $insertPending->bind_param('idsss', $bookingId, $monthlyRent, $dueDate, $description, $paymentPlan);
                if (!$insertPending->execute()) {
                    throw new RuntimeException('Unable to save the booking rent schedule');
                }
            }
        }
    } finally {
        $insertPaid->close();
        $insertPending->close();
    }
}
