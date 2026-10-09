-- Seed default SMS conversation templates (bilingual body_en / body_es).
INSERT INTO `conversation_templates` (`title`, `body_en`, `body_es`, `is_active`, `sort_order`)
SELECT * FROM (
  SELECT
    'Hello check-in' AS title,
    'Hi {{first_name}}, this is Groundwork Capital. How can we help with your ADU project today?' AS body_en,
    'Hola {{first_name}}, habla Groundwork Capital. ¿En qué podemos ayudarte con tu proyecto de ADU hoy?' AS body_es,
    1 AS is_active,
    10 AS sort_order
  UNION ALL
  SELECT
    'Docs reminder',
    'Hi {{first_name}}, friendly reminder — we are waiting on a few documents to keep your project moving. Reply here if you have questions.',
    'Hola {{first_name}}, recordatorio amable: estamos esperando algunos documentos para avanzar con tu proyecto. Responde aquí si tienes preguntas.',
    1,
    20
  UNION ALL
  SELECT
    'Appointment follow-up',
    'Hi {{first_name}}, thanks for speaking with us. Next step: we will follow up shortly. Call us anytime at {{phone}} if needed.',
    'Hola {{first_name}}, gracias por hablar con nosotros. Siguiente paso: te contactaremos pronto. Llámamos cuando quieras al {{phone}} si lo necesitas.',
    1,
    30
  UNION ALL
  SELECT
    'Thank you',
    'Thanks {{first_name}}! We appreciate you. Reply anytime if you need anything else.',
    '¡Gracias {{first_name}}! Te lo agradecemos. Responde cuando quieras si necesitas algo más.',
    1,
    40
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM `conversation_templates` WHERE `title` = 'Hello check-in' LIMIT 1
);
