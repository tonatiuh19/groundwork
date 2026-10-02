-- MCP OAuth: refresh tokens expire (30d default at issue/rotate time)
-- TiDB Cloud Serverless (MySQL 8.0 compatible)

ALTER TABLE `mcp_oauth_tokens`
  ADD COLUMN `refresh_expires_at` DATETIME DEFAULT NULL
    COMMENT 'Refresh token expiry; NULL = legacy row treated as expired on refresh'
    AFTER `expires_at`;

ALTER TABLE `mcp_oauth_tokens`
  ADD KEY `idx_mcp_tokens_refresh_expires` (`refresh_expires_at`);

-- Existing live tokens: grant 30 days from creation so Claude/Cursor sessions keep working
UPDATE `mcp_oauth_tokens`
   SET `refresh_expires_at` = DATE_ADD(`created_at`, INTERVAL 30 DAY)
 WHERE `refresh_expires_at` IS NULL AND `revoked_at` IS NULL;
