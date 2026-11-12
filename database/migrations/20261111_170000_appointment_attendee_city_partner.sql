-- Staff can tag City Partners on appointments (City meetings / Presentations), like lenders.
ALTER TABLE `appointment_attendees` MODIFY `kind` ENUM('admin','contractor','lender','homeowner','guest','city_partner') NOT NULL;
ALTER TABLE `appointment_attendees` ADD COLUMN `city_partner_id` INT UNSIGNED DEFAULT NULL AFTER `lender_id`;
ALTER TABLE `appointment_attendees` ADD KEY `idx_appt_attendees_city_partner` (`city_partner_id`);
ALTER TABLE `appointment_attendees` ADD CONSTRAINT `fk_appt_attendees_city_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners`(`id`) ON DELETE CASCADE;
