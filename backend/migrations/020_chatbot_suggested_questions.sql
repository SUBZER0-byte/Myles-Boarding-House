CREATE TABLE IF NOT EXISTS chatbot_suggested_questions (
  suggested_question_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  question VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suggested_question_id)
);

INSERT INTO chatbot_suggested_questions (question, is_active, sort_order)
SELECT question, is_active, sort_order
FROM chatbot_faqs
WHERE is_suggested = 1
  AND NOT EXISTS (
    SELECT 1
    FROM chatbot_suggested_questions
    WHERE chatbot_suggested_questions.question COLLATE utf8mb4_unicode_ci
      = chatbot_faqs.question COLLATE utf8mb4_unicode_ci
  );
