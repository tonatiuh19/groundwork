-- Fontana Oct 6: correct start to 7:00 PM Pacific (store UTC), clear end time,
-- keep registration open until the event starts.
UPDATE `marketing_events`
SET
  `starts_at` = '2026-10-07 02:00:00',
  `ends_at` = NULL,
  `registration_closes_at` = '2026-10-07 02:00:00'
WHERE `slug` = 'fontana-oct-6'
  AND `id` = 1;
