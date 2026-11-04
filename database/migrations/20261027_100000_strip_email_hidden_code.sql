-- Automatic-email copies logged before the htmlToText fix ended with the hidden anti-threading
-- code from emailLayout (12 hex chars, e.g. "56d603910001"). Strip only that trailing token.
UPDATE conversation_messages
SET body = REGEXP_REPLACE(body, '[[:space:]]+[0-9a-f]{12}[[:space:]]*$', '')
WHERE channel = 'email'
  AND JSON_EXTRACT(metadata_json, '$.automatic') = true
  AND body REGEXP '[[:space:]][0-9a-f]{12}[[:space:]]*$';

UPDATE automatic_messages
SET body_preview = REGEXP_REPLACE(body_preview, '[[:space:]]+[0-9a-f]{12}[[:space:]]*$', '')
WHERE channel = 'email'
  AND body_preview REGEXP '[[:space:]][0-9a-f]{12}[[:space:]]*$';
