-- Events hosted by an affiliate: RSVPs without another affiliate's link are credited to the host,
-- who sees them under My events and gets an email per RSVP.
ALTER TABLE marketing_events
  ADD COLUMN host_affiliate_id INT UNSIGNED DEFAULT NULL COMMENT 'Affiliate hosting the event; RSVPs without another referral link are credited to them' AFTER city_id;
ALTER TABLE marketing_events ADD KEY idx_marketing_events_host (host_affiliate_id);
ALTER TABLE marketing_events
  ADD CONSTRAINT fk_marketing_events_host_affiliate FOREIGN KEY (host_affiliate_id) REFERENCES affiliates(id) ON DELETE SET NULL;

-- New appointment type: Presentation (staff appointments only; the public scheduler is unchanged).
ALTER TABLE appointments
  MODIFY COLUMN kind ENUM('property_inspection','site_visit','lender_meeting','consultation','call','city_meeting','presentation','other') NOT NULL DEFAULT 'consultation';
