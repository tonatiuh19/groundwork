-- Each event picks its own automation after RSVP (NULL = none). Replaces the built-in A/B/C welcome.
ALTER TABLE `marketing_events`
  ADD COLUMN `rsvp_flow_id` INT UNSIGNED DEFAULT NULL COMMENT 'Automation (trigger event_rsvp) started on RSVP; NULL = no automatic messages' AFTER `cta_es`;

ALTER TABLE `marketing_events`
  ADD CONSTRAINT `fk_marketing_events_rsvp_flow` FOREIGN KEY (`rsvp_flow_id`) REFERENCES `reminder_flows`(`id`) ON DELETE SET NULL;
