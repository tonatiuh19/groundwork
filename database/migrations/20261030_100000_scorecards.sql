-- Scorecards (Admin -> Scorecards, gated by SCORECARD_ENABLED): weekly A-F scores for
-- affiliates and contractors. Contractors are scored as Lead rep and/or Project coordinator
-- on their own leads and projects; affiliates on their own leads and events.

-- Each step is its own idempotent statement (TiDB can't add a column and index it in one ALTER).
ALTER TABLE `contractors`
  ADD COLUMN IF NOT EXISTS `scorecard_roles` SET('lead_rep','coordinator') DEFAULT NULL
    COMMENT 'Which scorecards apply; NULL = not scored';

-- A lead handed to a contractor (Lead rep). The clocks (15 min, 48 h) start at assignment.
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `assigned_contractor_id` INT UNSIGNED DEFAULT NULL;
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `contractor_assigned_at` DATETIME DEFAULT NULL;
ALTER TABLE `leads` ADD INDEX IF NOT EXISTS `idx_leads_assigned_contractor` (`assigned_contractor_id`, `contractor_assigned_at`);
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_assigned_contractor`
    FOREIGN KEY (`assigned_contractor_id`) REFERENCES `contractors`(`id`) ON DELETE SET NULL;

-- Logged work: calls, contact made, next step + note, weekly status review, homeowner update,
-- events an affiliate ran. Staff log it; it is the documentation behind every score.
CREATE TABLE IF NOT EXISTS `scorecard_activities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('call_attempt','contacted','next_step','status_review','homeowner_update','event_held') NOT NULL,
  `outcome` ENUM('answered','no_answer','voicemail') DEFAULT NULL COMMENT 'call_attempt only',
  `lead_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_id` BIGINT UNSIGNED DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `occurred_at` DATETIME NOT NULL COMMENT 'UTC',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_act_subject` (`subject_type`, `subject_id`, `occurred_at`),
  KEY `idx_sc_act_lead` (`lead_id`),
  KEY `idx_sc_act_project` (`project_id`),
  CONSTRAINT `fk_sc_act_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sc_act_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sc_act_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plans the contractor owes on a project (due date vs delivered).
CREATE TABLE IF NOT EXISTS `project_plan_deliverables` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `due_on` DATE NOT NULL,
  `delivered_at` DATETIME DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plan_deliv_project` (`project_id`),
  KEY `idx_plan_deliv_due` (`due_on`),
  CONSTRAINT `fk_plan_deliv_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_deliv_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- City plan-check corrections: received -> resolved (goal: 5 working days).
CREATE TABLE IF NOT EXISTS `project_city_corrections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `received_on` DATE NOT NULL,
  `resolved_on` DATE DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_corr_project` (`project_id`),
  CONSTRAINT `fk_city_corr_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_city_corr_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Target date per project stage; reached = first project_milestone_events row into that stage.
CREATE TABLE IF NOT EXISTS `project_milestone_targets` (
  `project_id` BIGINT UNSIGNED NOT NULL,
  `milestone` ENUM('financing','contracted','in_build','closed') NOT NULL,
  `due_on` DATE NOT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`project_id`, `milestone`),
  KEY `idx_ms_target_due` (`due_on`),
  CONSTRAINT `fk_ms_target_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Days off (inclusive, Pacific dates): skipped by every clock and never counted.
CREATE TABLE IF NOT EXISTS `scorecard_time_off` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `starts_on` DATE NOT NULL,
  `ends_on` DATE NOT NULL,
  `label` VARCHAR(160) DEFAULT NULL,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_off_subject` (`subject_type`, `subject_id`, `starts_on`),
  CONSTRAINT `fk_sc_off_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per person, scorecard and week (Mon-Sun Pacific). Frozen (final = 1) 3 days after
-- the week ends; until then it is recalculated live.
CREATE TABLE IF NOT EXISTS `scorecard_weeks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `scorecard` ENUM('lead_rep','coordinator','affiliate') NOT NULL,
  `week_start` DATE NOT NULL,
  `score` DECIMAL(5,1) DEFAULT NULL COMMENT 'NULL = nothing to grade this week',
  `grade` CHAR(1) DEFAULT NULL,
  `color` ENUM('green','yellow','orange','red','none') NOT NULL DEFAULT 'none',
  `termination_review` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Red two weeks in a row',
  `metrics_json` JSON NOT NULL,
  `final` TINYINT(1) NOT NULL DEFAULT 0,
  `computed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sc_week` (`subject_type`, `subject_id`, `scorecard`, `week_start`),
  KEY `idx_sc_week_start` (`week_start`, `final`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Follow-up record per frozen week: automatic coaching note (yellow), meeting with Cesar/Daniel
-- + written plan (orange), written warning (red), termination review (red twice). Staff add notes
-- and close each one; the whole log is the documentation.
CREATE TABLE IF NOT EXISTS `scorecard_actions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` ENUM('affiliate','contractor') NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `scorecard` ENUM('lead_rep','coordinator','affiliate') NOT NULL,
  `week_start` DATE NOT NULL,
  `kind` ENUM('coaching_note','meeting','written_warning','termination_review','note') NOT NULL,
  `auto` TINYINT(1) NOT NULL DEFAULT 0,
  `auto_key` VARCHAR(120) DEFAULT NULL COMMENT 'Set on automatic rows so a week never escalates twice',
  `body` TEXT DEFAULT NULL,
  `resolution` TEXT DEFAULT NULL COMMENT 'Written plan / meeting notes / signed warning',
  `status` ENUM('open','done') NOT NULL DEFAULT 'open',
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `completed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_action_subject` (`subject_type`, `subject_id`, `created_at`),
  KEY `idx_sc_action_open` (`status`, `created_at`),
  UNIQUE KEY `uq_sc_action_auto` (`auto_key`),
  CONSTRAINT `fk_sc_action_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sc_action_done_admin` FOREIGN KEY (`completed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
