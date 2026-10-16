-- Affiliate agreement v3: fees are paid within 5 business days after the project funds (was 15).
-- New signers get v3; existing affiliates see "updated agreement" in the portal and staff can ask them
-- to re-sign (their signed v2 still applies until they do). FAQ updated to match.

INSERT INTO `affiliate_agreement_templates` (`version`, `body_en`, `body_es`, `notes`, `published_at`)
SELECT t.version + 1,
       REPLACE(t.body_en, 'Groundwork pays within 15 business days after that', 'Groundwork pays within 5 business days after that'),
       REPLACE(t.body_es, 'Groundwork paga dentro de 15 días hábiles después de eso', 'Groundwork paga dentro de 5 días hábiles después de eso'),
       'v3: fees paid within 5 business days after the project funds',
       NOW()
FROM `affiliate_agreement_templates` t
WHERE t.version = 2
  AND NOT EXISTS (SELECT 1 FROM `affiliate_agreement_templates` x WHERE x.version = 3);

UPDATE `affiliate_faqs`
SET `answer_en` = 'A fee becomes payable when the homeowner has signed the construction agreement and the project is funded. We pay within 5 business days after the loan funds, by bank transfer, Zelle or check, to the name on your W-9.',
    `answer_es` = 'La comisión procede cuando el propietario firmó el contrato de construcción y el proyecto está financiado. Pagamos dentro de los 5 días hábiles después de que se fondea el préstamo, por transferencia, Zelle o cheque, al nombre de tu W-9.'
WHERE `question_en` = 'When do I get paid?';

UPDATE `affiliate_faqs`
SET `answer_en` = 'The subscription price is shown on your agreement (currently $19.99 per month). You add your card during setup and nothing is charged then: your 90 free days start the day Groundwork approves you. After that it renews monthly until you cancel. You can cancel any time from the portal or by email.',
    `answer_es` = 'El precio aparece en tu acuerdo (actualmente $19.99 al mes). Agregas tu tarjeta durante el registro y no se cobra nada en ese momento: tus 90 días gratis empiezan el día que Groundwork te aprueba. Después se renueva cada mes hasta que canceles. Puedes cancelar cuando quieras desde el portal o por correo.'
WHERE `question_en` = 'How much is the platform subscription and when is it charged?';
