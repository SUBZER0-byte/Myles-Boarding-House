-- Remove legacy valid-ID/account-verification fields and stored ID paths.
-- Run in phpMyAdmin after backing up the database.

USE `Boarding-House-Database`;

UPDATE `users`
   SET `profile_picture` = NULL
 WHERE `profile_picture` LIKE 'valid_ids/%';

ALTER TABLE `users`
  DROP COLUMN IF EXISTS `valid_id`,
  DROP COLUMN IF EXISTS `id_upload`,
  DROP COLUMN IF EXISTS `id_type`,
  DROP COLUMN IF EXISTS `id_verification_status`,
  DROP COLUMN IF EXISTS `verification_status`,
  DROP COLUMN IF EXISTS `verified_at`,
  DROP COLUMN IF EXISTS `rejection_reason`;
