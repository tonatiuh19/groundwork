-- Atomic draw budget counter (prevents concurrent over-draws on TiDB optimistic OC).
ALTER TABLE `projects`
  ADD COLUMN `draw_committed_cents` BIGINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Sum of draft+submitted+approved+paid draw amounts'
    AFTER `contractor_cost_cents`;

UPDATE `projects` p
LEFT JOIN (
  SELECT project_id, COALESCE(SUM(amount_cents), 0) AS total
  FROM `draw_requests`
  WHERE status IN ('draft', 'submitted', 'approved', 'paid')
  GROUP BY project_id
) d ON d.project_id = p.id
SET p.`draw_committed_cents` = COALESCE(d.total, 0);
