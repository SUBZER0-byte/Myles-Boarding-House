ALTER TABLE ratings
  ADD COLUMN category ENUM('Facilities','Services','Overall Satisfaction') NOT NULL DEFAULT 'Overall Satisfaction' AFTER tenant_id,
  ADD COLUMN moderation_status ENUM('Pending','Approved','Hidden') NOT NULL DEFAULT 'Pending' AFTER comment,
  ADD COLUMN admin_reply TEXT DEFAULT NULL AFTER moderation_status,
  ADD COLUMN replied_at DATETIME DEFAULT NULL AFTER admin_reply;

UPDATE ratings SET moderation_status = 'Approved';

ALTER TABLE ratings
  ADD KEY idx_ratings_public_category_status (moderation_status, category, created_at);