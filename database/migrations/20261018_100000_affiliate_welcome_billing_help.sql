-- Affiliate welcome flow (Daniel): first email + text on signup with the
-- presentation and a secure no-login onboarding link (agreement → W-9 → card),
-- card on file with a 90-day free period then monthly billing, a bilingual FAQ
-- and an AI assistant grounded in the agreement + FAQ.

-- Billing state mirrored from the payment processor (webhooks keep it in sync).
ALTER TABLE `affiliates`
  ADD COLUMN `billing_customer_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor customer id',
  ADD COLUMN `billing_subscription_id` VARCHAR(64) DEFAULT NULL COMMENT 'Payment processor subscription id',
  ADD COLUMN `billing_status` ENUM('none','trialing','active','past_due','canceled','incomplete') NOT NULL DEFAULT 'none',
  ADD COLUMN `billing_trial_ends_at` DATETIME DEFAULT NULL,
  ADD COLUMN `billing_current_period_end` DATETIME DEFAULT NULL,
  ADD COLUMN `billing_card_brand` VARCHAR(20) DEFAULT NULL,
  ADD COLUMN `billing_card_last4` CHAR(4) DEFAULT NULL,
  ADD COLUMN `billing_card_exp` VARCHAR(7) DEFAULT NULL COMMENT 'MM/YYYY',
  ADD COLUMN `billing_updated_at` DATETIME DEFAULT NULL;

ALTER TABLE `affiliates` ADD KEY `idx_affiliates_billing_customer` (`billing_customer_id`);
ALTER TABLE `affiliates` ADD KEY `idx_affiliates_billing_subscription` (`billing_subscription_id`);

-- Secure onboarding link from the welcome email / text (works while pending).
CREATE TABLE IF NOT EXISTS `affiliate_onboarding_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `last_used_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aff_onboarding_token` (`token_hash`),
  KEY `idx_aff_onboarding_affiliate` (`affiliate_id`),
  CONSTRAINT `fk_aff_onboarding_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Processed webhook events (idempotency).
CREATE TABLE IF NOT EXISTS `billing_webhook_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(80) NOT NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `processed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_billing_webhook_event` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bilingual FAQ shown in the affiliate portal (admin-editable).
CREATE TABLE IF NOT EXISTS `affiliate_faqs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `question_en` VARCHAR(300) NOT NULL,
  `answer_en` TEXT NOT NULL,
  `question_es` VARCHAR(300) DEFAULT NULL,
  `answer_es` TEXT DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_affiliate_faqs_active` (`is_active`, `sort_order`),
  CONSTRAINT `fk_affiliate_faqs_admin`
    FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI assistant conversation log (staff can review what affiliates ask).
CREATE TABLE IF NOT EXISTS `affiliate_assistant_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `role` ENUM('user','assistant') NOT NULL,
  `content` TEXT NOT NULL,
  `handoff` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Assistant could not answer from the agreement/FAQ',
  `input_tokens` INT UNSIGNED DEFAULT NULL,
  `output_tokens` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aff_assistant_affiliate` (`affiliate_id`, `created_at`),
  CONSTRAINT `fk_aff_assistant_affiliate`
    FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`) VALUES
  ('affiliate_presentation_url', 'https://canva.link/gcgaffiliate', 'Affiliate program presentation sent in the welcome email / text'),
  ('affiliate_default_price_cents', '1999', 'Monthly platform subscription for new affiliates (cents)'),
  ('affiliate_trial_days', '90', 'Free days before the affiliate subscription starts charging')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;

-- Starter FAQ (taken from the Affiliate Agreement; admins can edit or hide).
INSERT INTO `affiliate_faqs` (`question_en`, `answer_en`, `question_es`, `answer_es`, `sort_order`)
SELECT * FROM (
  SELECT 'How much do I earn per ADU?' AS q_en,
    'Each qualifying project pays $10 per square foot in total. If you have no Sponsor you earn the full $10. If you have a Sponsor you earn $7 and your Sponsor (and Senior Sponsor, if any) share the rest. Example: an 830 sq ft model pays up to $8,300.' AS a_en,
    '¿Cuánto gano por cada ADU?' AS q_es,
    'Cada proyecto que califica paga $10 por pie cuadrado en total. Si no tienes Patrocinador ganas los $10 completos. Si tienes Patrocinador ganas $7 y tu Patrocinador (y Patrocinador Senior, si hay) comparten el resto. Ejemplo: un modelo de 830 pies cuadrados paga hasta $8,300.' AS a_es,
    10 AS s
  UNION ALL SELECT 'When do I get paid?',
    'A fee becomes payable when the homeowner has signed the construction agreement and the project is funded. We pay within 15 business days after that, by bank transfer, Zelle or check, to the name on your W-9.',
    '¿Cuándo me pagan?',
    'El pago procede cuando el propietario firmó el contrato de construcción y el proyecto está financiado. Pagamos dentro de los 15 días hábiles siguientes, por transferencia, Zelle o cheque, al nombre de tu W-9.',
    20
  UNION ALL SELECT 'What do I need before I can be paid?',
    'A signed Affiliate Agreement, a W-9 submitted in the portal, completed onboarding and an active platform subscription.',
    '¿Qué necesito antes de recibir pagos?',
    'Un Acuerdo de Afiliado firmado, un W-9 enviado en el portal, la incorporación completa y una suscripción activa a la plataforma.',
    30
  UNION ALL SELECT 'How much is the platform subscription and when is it charged?',
    'The subscription price is shown on your agreement (currently $19.99 per month). Your card is saved when you sign up and the first 90 days are free; after that it renews monthly until you cancel. You can cancel any time from the portal or by email.',
    '¿Cuánto cuesta la suscripción y cuándo se cobra?',
    'El precio aparece en tu acuerdo (actualmente $19.99 al mes). Tu tarjeta se guarda al registrarte y los primeros 90 días son gratis; después se renueva cada mes hasta que canceles. Puedes cancelar cuando quieras desde el portal o por correo.',
    40
  UNION ALL SELECT 'How do I register a homeowner?',
    'Register the homeowner in the portal (name, phone, property address) before our first meeting with them, and only after they give you permission to share their information and be contacted by us.',
    '¿Cómo registro a un propietario?',
    'Registra al propietario en el portal (nombre, teléfono, dirección) antes de nuestra primera reunión con él, y solo después de que te dé permiso para compartir sus datos y para que lo contactemos.',
    50
  UNION ALL SELECT 'How long is a homeowner credited to me?',
    'The first affiliate to register a homeowner is credited for 180 days. You earn the fee if they sign the construction agreement within those 180 days.',
    '¿Por cuánto tiempo se me acredita un propietario?',
    'El primer afiliado que registra a un propietario queda acreditado por 180 días. Ganas la comisión si firma el contrato de construcción dentro de esos 180 días.',
    60
  UNION ALL SELECT 'Can I recruit other affiliates?',
    'Yes. Each recruit signs their own agreement and names you as Sponsor. Nothing is paid for recruiting itself; fees are paid only on homeowner projects, and never more than two levels above the referring affiliate.',
    '¿Puedo reclutar a otros afiliados?',
    'Sí. Cada recluta firma su propio acuerdo y te nombra como Patrocinador. No se paga por reclutar; las comisiones se pagan solo por proyectos de propietarios y nunca más de dos niveles arriba del afiliado que refiere.',
    70
  UNION ALL SELECT 'What can''t I say to homeowners?',
    'Do not quote prices, negotiate or sign on our behalf, give loan, credit or financing advice, or promise rental income, approval, timelines or results. Use our name and logo only in materials we approve.',
    '¿Qué no puedo decirle a los propietarios?',
    'No cotices precios, no negocies ni firmes en nuestro nombre, no des consejos de préstamos, crédito o financiamiento, ni prometas ingresos por renta, aprobaciones, tiempos o resultados. Usa nuestro nombre y logo solo en materiales aprobados.',
    80
  UNION ALL SELECT 'Who handles my taxes?',
    'You are an independent contractor and responsible for taxes on your fees. We issue an IRS Form 1099 when required.',
    '¿Quién se encarga de mis impuestos?',
    'Eres contratista independiente y eres responsable de los impuestos sobre tus comisiones. Emitimos el formulario 1099 del IRS cuando corresponda.',
    90
) seed
WHERE NOT EXISTS (SELECT 1 FROM `affiliate_faqs`);
