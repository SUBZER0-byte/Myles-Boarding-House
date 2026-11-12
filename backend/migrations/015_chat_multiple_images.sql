-- Store multiple image attachments against each chat message.

CREATE TABLE IF NOT EXISTS chat_message_images (
  image_id INT NOT NULL AUTO_INCREMENT,
  message_id INT NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (image_id),
  KEY idx_chat_message_images_message (message_id),
  CONSTRAINT fk_chat_message_images_message
    FOREIGN KEY (message_id) REFERENCES chat_messages (message_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
