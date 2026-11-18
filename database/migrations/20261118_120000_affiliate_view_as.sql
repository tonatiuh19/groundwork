-- "View as affiliate": read-only portal session a super admin opens (who opened it, for the record).
ALTER TABLE `affiliate_sessions` ADD COLUMN `viewer_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Set = read-only View as affiliate session opened by this super admin' AFTER `user_agent`;
ALTER TABLE `affiliate_sessions` ADD CONSTRAINT `fk_aff_sessions_viewer` FOREIGN KEY (`viewer_admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE;
