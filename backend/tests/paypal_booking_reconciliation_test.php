<?php

require_once __DIR__ . '/../Config/paypal_booking_reconciliation.php';

function assertPayPalBooking(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, $message . PHP_EOL);
        exit(1);
    }
}

$order = [
    'id'=>'ORDER-123',
    'status'=>'COMPLETED',
    'purchase_units'=>[[
        'custom_id'=>'42',
        'amount'=>['currency_code'=>'PHP','value'=>'3500.00'],
        'payments'=>['captures'=>[['id'=>'CAPTURE-123']]],
    ]],
];
$capture = [
    'id'=>'CAPTURE-123',
    'status'=>'COMPLETED',
    'amount'=>['currency_code'=>'PHP','value'=>'3500.00'],
    'supplementary_data'=>['related_ids'=>['order_id'=>'ORDER-123']],
];
$evidence = paypal_booking_capture_evidence($order, $capture, 'ORDER-123', 42, 3500.00);
assertPayPalBooking($evidence['associated'] && $evidence['valid'], 'Valid capture evidence was rejected');

$wrongAmount = $capture;
$wrongAmount['amount']['value'] = '3501.00';
$evidence = paypal_booking_capture_evidence($order, $wrongAmount, 'ORDER-123', 42, 3500.00);
assertPayPalBooking($evidence['associated'] && !$evidence['valid'], 'Mismatched amount must be associated but rejected for refund');

$wrongOwner = paypal_booking_capture_evidence($order, $capture, 'ORDER-123', 43, 3500.00);
assertPayPalBooking($wrongOwner['associated'] && !$wrongOwner['valid'], 'Capture tied to a mismatched booking reference must be rejected for refund');

$wrongOrder = $capture;
$wrongOrder['supplementary_data']['related_ids']['order_id'] = 'ORDER-OTHER';
$evidence = paypal_booking_capture_evidence($order, $wrongOrder, 'ORDER-123', 42, 3500.00);
assertPayPalBooking(!$evidence['associated'], 'Capture tied to another PayPal order must not be treated as ours');

$called = false;
$GLOBALS['paypal_booking_api_mock'] = static function (string $method, string $path, $body, array $headers) use (&$called): array {
    $called = true;
    return ['code'=>200,'data'=>['mock'=>true],'raw'=>''];
};
$mockResponse = paypal_booking_api_request('GET', '/v2/checkout/orders/ORDER-123');
assertPayPalBooking($called && $mockResponse['code'] === 200, 'PayPal mock transport did not intercept the request');

echo "PayPal booking reconciliation tests passed" . PHP_EOL;
