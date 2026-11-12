ALTER TABLE chatbot_faqs
  ADD COLUMN is_suggested TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
