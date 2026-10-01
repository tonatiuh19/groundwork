-- Marketing events (homepage + /events/:slug) + lead attribution
-- TiDB Cloud / MySQL 8 compatible

CREATE TABLE IF NOT EXISTS `marketing_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(80) NOT NULL,
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME DEFAULT NULL,
  `registration_opens_at` DATETIME DEFAULT NULL,
  `registration_closes_at` DATETIME DEFAULT NULL,
  `capacity` INT UNSIGNED DEFAULT NULL,
  `waitlist_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `city` VARCHAR(100) NOT NULL,
  `venue_name` VARCHAR(200) DEFAULT NULL,
  `venue_address` VARCHAR(500) DEFAULT NULL,
  `zoom_url` VARCHAR(500) DEFAULT NULL,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `title_en` VARCHAR(200) NOT NULL,
  `title_es` VARCHAR(200) NOT NULL,
  `summary_en` VARCHAR(500) DEFAULT NULL,
  `summary_es` VARCHAR(500) DEFAULT NULL,
  `body_en` TEXT DEFAULT NULL,
  `body_es` TEXT DEFAULT NULL,
  `location_label_en` VARCHAR(200) DEFAULT NULL,
  `location_label_es` VARCHAR(200) DEFAULT NULL,
  `cta_en` VARCHAR(120) DEFAULT NULL,
  `cta_es` VARCHAR(120) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_marketing_events_slug` (`slug`),
  KEY `idx_marketing_events_status_featured` (`status`, `is_featured`),
  KEY `idx_marketing_events_starts` (`starts_at`),
  CONSTRAINT `fk_marketing_events_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TiDB cannot add a column and reference it in an index/FK in one ALTER, so split.
ALTER TABLE `leads`
  ADD COLUMN `event_id` INT UNSIGNED DEFAULT NULL AFTER `event_city`;
ALTER TABLE `leads`
  ADD COLUMN `event_registration_status` ENUM('confirmed','waitlisted') DEFAULT NULL AFTER `event_id`;
ALTER TABLE `leads` ADD KEY `idx_leads_event` (`event_id`);
ALTER TABLE `leads` ADD KEY `idx_leads_mode` (`mode`);
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_event`
    FOREIGN KEY (`event_id`) REFERENCES `marketing_events`(`id`) ON DELETE SET NULL;

-- Seed the current Fontana homepage promo so launch stays event-mode until it closes.
INSERT INTO `marketing_events` (
  `slug`, `status`, `is_featured`, `starts_at`, `ends_at`,
  `registration_opens_at`, `registration_closes_at`,
  `capacity`, `waitlist_enabled`, `city`,
  `venue_name`, `venue_address`,
  `title_en`, `title_es`,
  `summary_en`, `summary_es`,
  `body_en`, `body_es`,
  `location_label_en`, `location_label_es`,
  `cta_en`, `cta_es`
) VALUES (
  'fontana-oct-6',
  'published',
  1,
  '2026-10-06 18:00:00',
  '2026-10-06 20:00:00',
  '2026-09-01 00:00:00',
  '2026-10-06 18:00:00',
  80,
  1,
  'Fontana',
  NULL,
  'Fontana, California',
  'Homeowner ADU event in Fontana',
  'Evento ADU para propietarios en Fontana',
  'Join us for a free homeowner session on ADU financing and next steps.',
  'Únete a una sesión gratuita para propietarios sobre financiamiento ADU y próximos pasos.',
  'Learn how homeowners are unlocking ADU value with a clear financing path. Meet the Groundwork team, ask questions, and reserve guidance for your property.',
  'Descubre cómo los propietarios están liberando el valor de un ADU con un camino de financiamiento claro. Conoce al equipo de Groundwork, haz preguntas y reserva orientación para tu propiedad.',
  'Fontana, California',
  'Fontana, California',
  'Register for the event',
  'Regístrate al evento'
);
