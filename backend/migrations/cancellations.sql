-- ============================================================
-- Migration: Cancellation & Refund System
-- Run in phpMyAdmin against `Boarding-House-Database`
-- ============================================================

USE `Boarding-House-Database`;

-- ---------- CANCELLATION REQUESTS ----------
DROP TABLE IF EXISTS `cancellation_requests`;
CREATE TABLE `cancellation_requests` (
  `cancellation_id`         INT AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`               INT NOT NULL,
  `room_id`                 INT NOT NULL,
  `monthly_rent`            DECIMAL(10,2) NOT NULL,
  `move_in_date`            DATE NOT NULL,
  `cancellation_date`       DATE NOT NULL,
  `daily_rate`              DECIMAL(10,2) NOT NULL,
  `days_consumed`           INT NOT NULL,
  `amount_used`             DECIMAL(10,2) NOT NULL,
  `refund_amount`           DECIMAL(10,2) NOT NULL,
  `status`                  ENUM('Pending','Approved','Rejected','Withdrawn','Expired') NOT NULL DEFAULT 'Pending',
  `cancellation_expires_at` DATETIME NOT NULL,
  `rejection_reason`        TEXT NULL,
  `requested_by`            INT NULL,
  `acted_by`                INT NULL,
  `acted_at`                DATETIME NULL,
  `created_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`tenant_id`) ON DELETE CASCADE,
  FOREIGN KEY (`room_id`)   REFERENCES `rooms`(`room_id`)   ON DELETE CASCADE,
  INDEX (`tenant_id`),
  INDEX (`status`),
  INDEX (`cancellation_expires_at`)
) ENGINE=InnoDB;
