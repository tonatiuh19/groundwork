-- Groundwork Capital — MCP OAuth (super_admin Cursor / Claude connectors)
-- TiDB Cloud Serverless (MySQL 8.0 compatible)
-- Pattern: Gomez Framework / Optimum Credit remote Streamable HTTP MCP

CREATE TABLE IF NOT EXISTS `mcp_oauth_clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(128) NOT NULL,
  `client_secret_hash` VARCHAR(255) DEFAULT NULL COMMENT 'NULL = public client (PKCE)',
  `client_name` VARCHAR(255) DEFAULT NULL,
  `redirect_uris_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(255) NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `code_challenge` VARCHAR(255) NOT NULL,
  `code_challenge_method` VARCHAR(16) NOT NULL DEFAULT 'S256',
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'groundwork.admin.read',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_code_hash` (`code_hash`),
  KEY `idx_mcp_codes_admin` (`admin_id`),
  KEY `idx_mcp_codes_expires` (`expires_at`),
  CONSTRAINT `fk_mcp_codes_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_oauth_tokens` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` VARCHAR(255) NOT NULL,
  `refresh_token_hash` VARCHAR(255) DEFAULT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `client_name` VARCHAR(255) DEFAULT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'groundwork.admin.read',
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mcp_token_hash` (`token_hash`),
  UNIQUE KEY `uq_mcp_refresh_hash` (`refresh_token_hash`),
  KEY `idx_mcp_tokens_admin` (`admin_id`),
  KEY `idx_mcp_tokens_revoked` (`revoked_at`),
  CONSTRAINT `fk_mcp_tokens_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mcp_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `tool_name` VARCHAR(120) NOT NULL,
  `confirm` TINYINT(1) NOT NULL DEFAULT 0,
  `request_json` JSON DEFAULT NULL,
  `result_json` JSON DEFAULT NULL,
  `error_message` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mcp_audit_admin` (`admin_id`, `id`),
  CONSTRAINT `fk_mcp_audit_admin`
    FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
