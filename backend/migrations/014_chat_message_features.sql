-- Add image attachments, unsend state, and per-user message hiding to chat.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS image_path VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_unsent TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS chat_message_hidden (
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  hidden_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  INDEX idx_chat_message_hidden_user (user_id),
  CONSTRAINT fk_chat_message_hidden_message
    FOREIGN KEY (message_id) REFERENCES chat_messages (message_id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_message_hidden_user
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
