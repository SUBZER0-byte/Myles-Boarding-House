INSERT INTO system_settings (setting_key, setting_value)
VALUES ('ollama_api_key', '')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
