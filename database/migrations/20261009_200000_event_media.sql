-- Past-event highlights: photos, uploaded videos and embedded reels (Instagram /
-- YouTube / TikTok) per marketing event. One optional cover + one highlight reel.
CREATE TABLE IF NOT EXISTS `event_media` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('photo','video','embed') NOT NULL,
  `url` VARCHAR(1000) NOT NULL COMMENT 'Public Blob URL (photo/video) or normalized embed URL',
  `source_url` VARCHAR(1000) DEFAULT NULL COMMENT 'Original pasted link for embeds',
  `embed_provider` ENUM('instagram','youtube','tiktok') DEFAULT NULL,
  `blob_pathname` VARCHAR(500) DEFAULT NULL,
  `mime_type` VARCHAR(100) DEFAULT NULL,
  `size_bytes` BIGINT UNSIGNED DEFAULT NULL,
  `caption_en` VARCHAR(300) DEFAULT NULL,
  `caption_es` VARCHAR(300) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_cover` TINYINT(1) NOT NULL DEFAULT 0,
  `is_highlight` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_media_event` (`event_id`, `sort_order`),
  CONSTRAINT `fk_event_media_event`
    FOREIGN KEY (`event_id`) REFERENCES `marketing_events`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_media_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
