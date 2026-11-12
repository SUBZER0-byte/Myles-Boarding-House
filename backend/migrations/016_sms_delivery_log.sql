CREATE TABLE IF NOT EXISTS sms_delivery_log (
  event_key VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_phone VARCHAR(40) NOT NULL,
  status ENUM('sending', 'sent', 'failed') NOT NULL DEFAULT 'sending',
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT NULL,
  last_error VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (event_key, recipient_phone),
  KEY idx_sms_delivery_log_status (status, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
