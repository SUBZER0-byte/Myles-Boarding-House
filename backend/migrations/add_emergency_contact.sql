ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `emergency_contact_name` VARCHAR(150) NULL AFTER `phone`,
  ADD COLUMN IF NOT EXISTS `emergency_contact_phone` VARCHAR(40) NULL AFTER `emergency_contact_name`;
