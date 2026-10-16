-- Event QR codes: flyers encode /e/<slug> (tracked short link). Each scan bumps
-- the counter on the scanned event; RSVPs that came from a scan use leads.source = 'qr'.
ALTER TABLE `marketing_events`
  ADD COLUMN `qr_scan_count` INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Scans of the /e/<slug> QR short link',
  ADD COLUMN `qr_last_scanned_at` DATETIME DEFAULT NULL;
