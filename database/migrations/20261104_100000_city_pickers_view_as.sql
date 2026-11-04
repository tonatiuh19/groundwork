-- Cities are picked, never typed: events and contacts carry a city like leads / clients / projects.
ALTER TABLE `marketing_events` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities; RSVP leads inherit it' AFTER `city`;
ALTER TABLE `marketing_events` ADD KEY `idx_marketing_events_city` (`city_id`);
ALTER TABLE `contacts` ADD COLUMN `city_id` INT UNSIGNED DEFAULT NULL COMMENT 'service_cities' AFTER `city`;
ALTER TABLE `contacts` ADD KEY `idx_contacts_city` (`city_id`);

-- Read-only "View as partner": a city partner session opened by a super admin.
ALTER TABLE `city_partner_sessions` ADD COLUMN `viewer_admin_id` INT UNSIGNED DEFAULT NULL COMMENT 'Set = read-only View as partner session opened by this super admin';
