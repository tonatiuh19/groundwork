-- Booking page call types per host: the homeowner ADU consultation (always on) plus optional
-- "Become an affiliate" and "Contractor partnership" calls, each with its own length.
-- JSON: {"affiliate": {"enabled": true, "duration_minutes": 20}, "contractor": {...}}
ALTER TABLE `scheduler_settings` ADD COLUMN `booking_types_json` JSON DEFAULT NULL COMMENT 'Extra booking types (affiliate / contractor calls): enabled + length' AFTER `video_url`;
