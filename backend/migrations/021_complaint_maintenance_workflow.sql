ALTER TABLE complaints
  ADD COLUMN is_urgent TINYINT(1) NOT NULL DEFAULT 0 AFTER category,
  ADD COLUMN photo_path VARCHAR(255) DEFAULT NULL AFTER is_urgent,
  MODIFY COLUMN status ENUM('Open','Submitted','Acknowledged','In Progress','Resolved','Cancelled') NOT NULL DEFAULT 'Submitted';

UPDATE complaints SET status = 'Submitted' WHERE status = 'Open';

ALTER TABLE complaints
  MODIFY COLUMN status ENUM('Submitted','Acknowledged','In Progress','Resolved','Cancelled') NOT NULL DEFAULT 'Submitted';

ALTER TABLE maintenance_requests
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'General' AFTER title,
  ADD COLUMN photo_path VARCHAR(255) DEFAULT NULL AFTER category,
  MODIFY COLUMN status ENUM('Pending','Submitted','Acknowledged','Ongoing','In Progress','Completed','Resolved','Cancelled') NOT NULL DEFAULT 'Submitted';

UPDATE maintenance_requests
SET status = CASE status
  WHEN 'Pending' THEN 'Submitted'
  WHEN 'Ongoing' THEN 'In Progress'
  WHEN 'Completed' THEN 'Resolved'
  ELSE status
END;

ALTER TABLE maintenance_requests
  MODIFY COLUMN status ENUM('Submitted','Acknowledged','In Progress','Resolved','Cancelled') NOT NULL DEFAULT 'Submitted';

CREATE TABLE complaint_status_history (
  history_id INT NOT NULL AUTO_INCREMENT,
  complaint_id INT NOT NULL,
  status ENUM('Submitted','Acknowledged','In Progress','Resolved','Cancelled') NOT NULL,
  changed_by INT DEFAULT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (history_id),
  KEY idx_complaint_status_history_request (complaint_id, changed_at),
  CONSTRAINT complaint_status_history_request_fk FOREIGN KEY (complaint_id) REFERENCES complaints (complaint_id) ON DELETE CASCADE,
  CONSTRAINT complaint_status_history_user_fk FOREIGN KEY (changed_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE maintenance_status_history (
  history_id INT NOT NULL AUTO_INCREMENT,
  request_id INT NOT NULL,
  status ENUM('Submitted','Acknowledged','In Progress','Resolved','Cancelled') NOT NULL,
  changed_by INT DEFAULT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (history_id),
  KEY idx_maintenance_status_history_request (request_id, changed_at),
  CONSTRAINT maintenance_status_history_request_fk FOREIGN KEY (request_id) REFERENCES maintenance_requests (request_id) ON DELETE CASCADE,
  CONSTRAINT maintenance_status_history_user_fk FOREIGN KEY (changed_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO complaint_status_history (complaint_id, status, changed_by, changed_at)
SELECT complaint_id, status, NULL, COALESCE(updated_at, created_at) FROM complaints;

INSERT INTO maintenance_status_history (request_id, status, changed_by, changed_at)
SELECT request_id, status, NULL, COALESCE(updated_at, created_at) FROM maintenance_requests;