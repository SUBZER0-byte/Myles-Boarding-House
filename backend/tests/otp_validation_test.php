<?php
require_once __DIR__ . '/../Config/otp_helper.php';

function assert_true(bool $condition, string $message): void {
    if (!$condition) {
        throw new Exception($message);
    }
}

$future = date('Y-m-d H:i:s', strtotime('+10 minutes'));
$past = date('Y-m-d H:i:s', strtotime('-1 minute'));

assert_true(is_otp_expired($past) === true, 'Expired OTP should be rejected');
assert_true(is_otp_expired($future) === false, 'Fresh OTP should still be valid');
assert_true(is_otp_expired(null) === true, 'Missing expiry should be treated as expired');

$code = generate_otp_code();
assert_true(preg_match('/^\d{6}$/', $code) === 1, 'Generated OTP should be a 6-digit string');

echo "otp validation tests passed\n";
