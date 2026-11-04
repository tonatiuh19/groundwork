-- Affiliates say who they are: Realtor (company + DRE #), Lender (company + NMLS #) or neither.
-- Approved lender affiliates join the Lenders directory. Clients carry a lender (synced to projects).
-- TiDB: one schema change per ALTER.
ALTER TABLE `affiliates` ADD COLUMN `partner_type` ENUM('realtor','lender','other') DEFAULT NULL;
ALTER TABLE `affiliates` ADD COLUMN `license_number` VARCHAR(40) DEFAULT NULL COMMENT 'DRE # (realtor) or NMLS # (lender)';
ALTER TABLE `affiliates` ADD COLUMN `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Lenders directory entry (lender affiliates, on approval)';
ALTER TABLE `affiliates` ADD CONSTRAINT `fk_affiliates_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL;
ALTER TABLE `lenders` ADD COLUMN `nmls_number` VARCHAR(40) DEFAULT NULL;
ALTER TABLE `lenders` ADD COLUMN `affiliate_id` INT UNSIGNED DEFAULT NULL COMMENT 'Affiliate account of this lender (if any)';
ALTER TABLE `clients` ADD COLUMN `lender_id` INT UNSIGNED DEFAULT NULL COMMENT 'Homeowner lender (projects follow it unless they set their own)';
ALTER TABLE `clients` ADD CONSTRAINT `fk_clients_lender` FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON DELETE SET NULL;
