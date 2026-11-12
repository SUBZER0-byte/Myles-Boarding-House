-- Add profile pictures without removing legacy ID columns or uploaded files.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `profile_picture` VARCHAR(255) NULL AFTER `password`;
