-- Replace the retired SMS API PH settings with TextBee.
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('textbee_api_base', 'https://api.textbee.dev/api/v1'),
  ('textbee_api_key', ''),
  ('textbee_device_id', ''),
  ('textbee_enabled', '1'),
  ('registration_sms_otp_enabled', '0')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

DELETE FROM system_settings
WHERE setting_key IN ('sms_api_key', 'sms_api_base', 'sms_enabled');
