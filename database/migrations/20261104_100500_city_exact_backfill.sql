-- One-time: tag records whose typed city exactly matches a city (case-insensitive). Fuzzy guesses stay for staff.
UPDATE `clients` t JOIN `service_cities` s ON LOWER(TRIM(s.name)) = LOWER(TRIM(t.city)) AND s.archived_at IS NULL SET t.city_id = s.id WHERE t.city_id IS NULL;
UPDATE `projects` t JOIN `service_cities` s ON LOWER(TRIM(s.name)) = LOWER(TRIM(t.property_city)) AND s.archived_at IS NULL SET t.city_id = s.id WHERE t.city_id IS NULL;
UPDATE `contacts` t JOIN `service_cities` s ON LOWER(TRIM(s.name)) = LOWER(TRIM(t.city)) AND s.archived_at IS NULL SET t.city_id = s.id WHERE t.city_id IS NULL;
UPDATE `marketing_events` t JOIN `service_cities` s ON LOWER(TRIM(s.name)) = LOWER(TRIM(t.city)) AND s.archived_at IS NULL SET t.city_id = s.id WHERE t.city_id IS NULL;
