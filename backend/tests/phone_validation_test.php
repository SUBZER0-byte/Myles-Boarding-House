<?php
require_once __DIR__ . '/../Config/phone_validation.php';

function assert_true(bool $condition, string $message): void {
    if (!$condition) {
        throw new Exception($message);
    }
}

assert_true(normalize_phone('09171234567') === '+639171234567', 'Local mobile number should normalize to E.164');
assert_true(is_probably_real_mobile_number('09171234567') === true, 'A normal mobile number should be accepted');
assert_true(is_probably_real_mobile_number('09111111111') === false, 'Repeated-digit numbers should be rejected');
assert_true(is_probably_real_mobile_number('09999999999') === false, 'Common fake-number patterns should be rejected');

echo "phone validation tests passed\n";
