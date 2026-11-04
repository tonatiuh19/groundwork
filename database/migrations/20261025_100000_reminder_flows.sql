-- Reminder flows: visual automations (trigger → waits → email / text / staff alert → conditions → close),
-- with goals that auto-stop, quiet hours, text consent, STOP opt-outs, per-person runs and funnel stats.

CREATE TABLE IF NOT EXISTS `reminder_flows` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `trigger_event` VARCHAR(60) NOT NULL COMMENT 'affiliate_signup, contractor_signup, homeowner_lead, event_rsvp, lead_answer_*, milestone_*, contract_sent, appointment_*, card_expiring, payment_failed',
  `goal_key` VARCHAR(60) DEFAULT NULL COMMENT 'Auto-stop when met (affiliate_onboarded, contractor_documents, homeowner_next_step, contract_signed, …)',
  `stop_on_reply` TINYINT(1) NOT NULL DEFAULT 1,
  `quiet_start_hour` TINYINT UNSIGNED NOT NULL DEFAULT 9 COMMENT 'Texts only between these hours (America/Los_Angeles)',
  `quiet_end_hour` TINYINT UNSIGNED NOT NULL DEFAULT 19,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `system_key` VARCHAR(60) DEFAULT NULL COMMENT 'Seeded flows (affiliate_onboarding, contractor_onboarding, homeowner_followup)',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_flows_system` (`system_key`),
  KEY `idx_reminder_flows_trigger` (`trigger_event`, `is_active`),
  CONSTRAINT `fk_reminder_flows_creator` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reminder_flows_updater` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_steps` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) NOT NULL,
  `step_type` ENUM('trigger','wait','send_email','send_sms','notify_staff','condition','wait_for_reply','close','end') NOT NULL,
  `label` VARCHAR(160) NOT NULL,
  `config_json` JSON DEFAULT NULL COMMENT 'wait: {amount, unit}; send_*: {subject_en, subject_es, body_en, body_es}; condition: {check}; wait_for_reply: {amount, unit}',
  `position_x` FLOAT NOT NULL DEFAULT 0,
  `position_y` FLOAT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_flow_step_key` (`flow_id`, `step_key`),
  CONSTRAINT `fk_flow_steps_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_edges` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `source_key` VARCHAR(60) NOT NULL,
  `target_key` VARCHAR(60) NOT NULL,
  `edge_type` ENUM('next','yes','no','replied','no_reply') NOT NULL DEFAULT 'next',
  PRIMARY KEY (`id`),
  KEY `idx_flow_edges_source` (`flow_id`, `source_key`),
  CONSTRAINT `fk_flow_edges_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_runs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flow_id` INT UNSIGNED NOT NULL,
  `subject_kind` ENUM('lead','client','affiliate','contractor','project','appointment') NOT NULL,
  `subject_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('active','paused','goal_met','completed','stopped','closed','failed') NOT NULL DEFAULT 'active',
  `active_key` VARCHAR(80) DEFAULT NULL COMMENT 'flow:kind:id while active/paused (one live run per person per flow)',
  `current_step_key` VARCHAR(60) DEFAULT NULL,
  `next_run_at` DATETIME DEFAULT NULL,
  `waiting_since` DATETIME DEFAULT NULL COMMENT 'wait_for_reply started',
  `end_reason` VARCHAR(160) DEFAULT NULL,
  `added_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `entered_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_flow_runs_active` (`active_key`),
  KEY `idx_flow_runs_due` (`status`, `next_run_at`),
  KEY `idx_flow_runs_subject` (`subject_kind`, `subject_id`),
  KEY `idx_flow_runs_flow` (`flow_id`, `status`),
  CONSTRAINT `fk_flow_runs_flow` FOREIGN KEY (`flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_flow_runs_admin` FOREIGN KEY (`added_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reminder_flow_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` INT UNSIGNED NOT NULL,
  `flow_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) DEFAULT NULL,
  `event` ENUM('entered','sent','skipped','failed','clicked','replied','goal_met','opted_out','paused','resumed','skipped_step','removed','closed','completed') NOT NULL,
  `channel` ENUM('email','sms','staff','none') NOT NULL DEFAULT 'none',
  `detail_json` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_flow_events_run` (`run_id`, `created_at`),
  KEY `idx_flow_events_stats` (`flow_id`, `step_key`, `event`),
  CONSTRAINT `fk_flow_events_run` FOREIGN KEY (`run_id`) REFERENCES `reminder_flow_runs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracked links in flow messages (click stats; also counts as engagement).
CREATE TABLE IF NOT EXISTS `reminder_flow_links` (
  `token` CHAR(24) NOT NULL,
  `run_id` INT UNSIGNED NOT NULL,
  `step_key` VARCHAR(60) NOT NULL,
  `url` VARCHAR(1000) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_flow_links_run` (`run_id`),
  CONSTRAINT `fk_flow_links_run` FOREIGN KEY (`run_id`) REFERENCES `reminder_flow_runs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STOP / ALTO replies: no automatic texts to this number again (until they text START).
CREATE TABLE IF NOT EXISTS `sms_opt_outs` (
  `phone_last10` CHAR(10) NOT NULL,
  `opted_out_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `keyword` VARCHAR(20) DEFAULT NULL,
  PRIMARY KEY (`phone_last10`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
