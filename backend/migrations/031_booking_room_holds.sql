CREATE TABLE IF NOT EXISTS booking_room_holds (
  hold_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT(11) NOT NULL,
  email VARCHAR(255) NOT NULL,
  room_id INT(11) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL,
  PRIMARY KEY (hold_id),
  UNIQUE KEY uq_booking_room_holds_user (user_id),
  KEY idx_booking_room_holds_room_expiry (room_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
