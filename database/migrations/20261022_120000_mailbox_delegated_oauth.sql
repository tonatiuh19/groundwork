-- "Connect with Microsoft": a staff member signs in and links their own mailbox
-- (any Microsoft work or personal account). Tokens are AES-256-GCM sealed (MAIL_TOKEN_KEY).
-- TiDB: one schema change per ALTER.
ALTER TABLE `mailboxes` ADD COLUMN `auth_mode` ENUM('app','delegated') NOT NULL DEFAULT 'app' AFTER `kind`;
ALTER TABLE `mailboxes` ADD COLUMN `oauth_user_id` VARCHAR(100) DEFAULT NULL AFTER `auth_mode`;
ALTER TABLE `mailboxes` ADD COLUMN `oauth_access_token` TEXT DEFAULT NULL AFTER `oauth_user_id`;
ALTER TABLE `mailboxes` ADD COLUMN `oauth_refresh_token` TEXT DEFAULT NULL AFTER `oauth_access_token`;
ALTER TABLE `mailboxes` ADD COLUMN `oauth_expires_at` DATETIME DEFAULT NULL AFTER `oauth_refresh_token`;
