-- Fontana Oct 6: correct start to 7:00 PM Pacific (PDT = UTC-7).
-- Prior seed `2026-10-06 18:00:00` UTC displayed as 11:00 AM PDT.
-- Clear ends_at (no public end time). Align registration close with start.
UPDATE `marketing_events`
SET
  `starts_at` = '2026-10-07 02:00:00',
  `ends_at` = NULL,
  `registration_closes_at` = '2026-10-07 02:00:00'
WHERE `slug` = 'fontana-oct-6'
  AND `id` = 1;
