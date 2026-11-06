-- Homeowners can be added without an email (phone only): their portal invite goes by text.
ALTER TABLE `client_portal_invites` MODIFY COLUMN `email` VARCHAR(255) DEFAULT NULL;
