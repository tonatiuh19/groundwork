-- A shield token that was asked for a text code can only be used with that code (waiting doesn't skip it).
ALTER TABLE `public_phone_codes` ADD COLUMN `shield_nonce` CHAR(24) DEFAULT NULL AFTER `purpose`;
ALTER TABLE `public_phone_codes` ADD KEY `idx_public_phone_codes_nonce` (`shield_nonce`);
