<?php
/** TextBee SMS gateway configuration. */

if (!isset($connect)) {
    include __DIR__ . '/db.php';
}

function sms_config_value(string $key, string $default): string {
    global $connect;
    if (!isset($connect) || !$connect) {
        return $default;
    }
    $stmt = $connect->prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1");
    $stmt->bind_param("s", $key);
    $stmt->execute();
    $stmt->bind_result($value);
    $result = $stmt->fetch() ? $value : $default;
    $stmt->close();
    return $result;
}

return [
    // TextBee settings are managed by the Admin Panel and stored in system_settings.
    'api_key'  => sms_config_value('textbee_api_key', ''),
    'api_base' => sms_config_value('textbee_api_base', ''),
    'device_id' => sms_config_value('textbee_device_id', ''),
    // Default country code prefix applied to local numbers like "09xxxxxxxxx"
    'default_country_code' => sms_config_value('sms_default_country_code', '+63'),
    // Master kill-switch for SMS sending (set to false to silence all notifications)
    'enabled'  => filter_var(sms_config_value('textbee_enabled', '0'), FILTER_VALIDATE_BOOLEAN),
];
