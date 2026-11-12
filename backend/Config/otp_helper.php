<?php
/**
 * OTP helpers for account registration verification.
 * OTPs expire after 10 minutes and are only accepted while still fresh.
 */

function generate_otp_code(int $length = 6): string {
    $code = '';
    for ($i = 0; $i < $length; $i++) {
        $code .= random_int(0, 9);
    }
    return $code;
}

function is_otp_expired(?string $expiresAt): bool {
    if ($expiresAt === null || $expiresAt === '') {
        return true;
    }

    $expires = strtotime($expiresAt);
    if ($expires === false) {
        return true;
    }

    return time() > $expires;
}

function build_otp_message(string $code): string {
    return "Your Myle's Boarding House verification code is {$code}. It expires in 10 minutes.";
}
