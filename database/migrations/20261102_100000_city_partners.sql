-- City Partners (invite-only portal at /city): people who open cities to the ADU program.
-- Agreement, W-9, assigned cities, city pipeline + activity log, city intelligence, Opened City fees.
CREATE TABLE IF NOT EXISTS `city_partners` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL DEFAULT '',
  `phone` VARCHAR(40) DEFAULT NULL,
  `company` VARCHAR(200) DEFAULT NULL COMMENT 'LLC legal name used in the agreement',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT 'Only staff create rows (invite-only)',
  `preferred_language` ENUM('en','es') NOT NULL DEFAULT 'en',
  `avatar_url` VARCHAR(500) DEFAULT NULL,
  `fee_cents_per_sqft` INT UNSIGNED NOT NULL DEFAULT 200 COMMENT 'Opened City fee, frozen into each agreement',
  `notes` TEXT DEFAULT NULL,
  `invited_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `invited_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_city_partners_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_otp_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('login','email_verify','signup') NOT NULL DEFAULT 'login',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cp_otp_partner` (`city_partner_id`),
  CONSTRAINT `fk_cp_otp_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cp_sessions_token` (`token_hash`),
  KEY `idx_cp_sessions_partner` (`city_partner_id`),
  CONSTRAINT `fk_cp_sessions_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_cities` (
  `city_partner_id` INT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`city_partner_id`, `city_id`),
  KEY `idx_cp_cities_city` (`city_id`),
  CONSTRAINT `fk_cp_cities_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cp_cities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_agreement_templates` (
  `version` INT UNSIGNED NOT NULL,
  `body` MEDIUMTEXT NOT NULL COMMENT 'Placeholders: {{partner_legal_name}}, {{fee_per_sqft}}',
  `approved_at` DATETIME DEFAULT NULL COMMENT 'NULL = draft, never sent',
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `city_partner_agreement_templates` (`version`, `body`, `approved_at`, `notes`) VALUES
(1, 'Independent Contractor Agreement for California

This INDEPENDENT CONTRACTOR AGREEMENT (hereinafter referred to as the "Agreement") is effective as of October 21, 2026 by and between Ground Work Capital LLC (hereinafter "Client") and {{partner_legal_name}} (hereinafter "Contractor") (collectively the "Parties" and each a "Party").

WHEREAS, Client and Contractor desire to enter into a business relationship upon the terms and subject to the conditions set forth in this Agreement; and

WHEREAS, each Party is duly authorized and capable of entering into this Agreement.

NOW, THEREFORE, in consideration of the mutual covenants, representations, warranties, and obligations set forth herein, and other good and valuable consideration, the receipt and sufficiency of which is hereby acknowledged, the Parties agree as follows:

1. Term. The term of performance under this Agreement shall begin as of October 21, 2026 and shall continue indefinitely until this Agreement is terminated according to the terms in the paragraph below entitled Termination (the "Term").

2. Compensation

a. Pay Structure. Client hereby agrees to pay Contractor as follows: Compensation. The Company will pay {{partner_legal_name}} a fee of {{fee_per_sqft}} per square foot of each ADU the Company builds in any Opened City, regardless of who sourced the homeowner, the financing, or the project. This fee is separate from, and in addition to, any fee paid to any other affiliate. An "Opened City" is a city where the Company''s ADU plans were pre-approved through the Affiliate''s introduction and efforts. Opened Cities as of signing: Fontana. Rancho Cucamonga becomes an Opened City once the Company''s plans are pre-approved there. Square footage is the ADU''s square footage on the approved plans for that project. The fee is due within five (5) days after the project''s funds are received in the Company''s bank account, whether from the funding of the homeowner''s cash-out, cash-out refinance, or other project financing. If a project is cancelled after funding and the Company returns the project funds, the Affiliate will refund the fee for that project within 30 days. Payment will be made as compensation for Services rendered to Client. Contractor is to be paid only for Services actually rendered while Contractor is actually performing Services under this Agreement. The pay structure may be adjusted from time to time by Client, in its sole discretion.

b. Pay Period. Contractor will be paid upon completion of the Services. The pay period may be adjusted from time to time by Client, in its sole discretion.

c. Business Expenses. Client shall reimburse Contractor for all reasonable and properly documented business expenses that are necessarily incurred in connection with carrying out Contractor''s duties and responsibilities and approved in advance by Client in accordance with Client''s expense reimbursement policies.

3. Benefits. Contractor shall only be entitled to such fringe benefits as may be provided from time to time by Client to other contractors occupying similar positions with Client. This Agreement is for the sole benefit of Contractor and Client, and is not intended to create a benefit plan or to modify the terms of existing plans. Any benefit plan contemplated by this Agreement shall be governed solely by the terms of the underlying plan documents and by applicable law. Nothing in this Agreement shall impair Client''s right to amend, modify, replace, or terminate any and all such plans in its sole discretion, as provided by law, or to terminate this Agreement in accordance with its terms.

4. Contractor Services. Contractor is being hired by Client as a(n) City Access Affiliate . Services (the "Services") to be performed under this Agreement shall include: The Contractor serves as an affiliate of the Company for the purpose of introducing the Company to cities and municipalities and opening those cities to the Company''s ADU program. The Affiliate will introduce the Company to city leadership, planning and building departments, and community stakeholders, and will support the Company''s efforts to obtain pre-approval of its ADU plans in each city. The Contractor is not a construction contractor and will not perform construction, hire or manage contractors, handle project funds, originate loans, or sign or commit to anything on the Company''s behalf. The Company is the sole owner of all ADU plans submitted to any city and alone manages all funds, construction, subcontracting, and financing partners. In addition to any Services specified in this Agreement, Contractor shall have such job duties, change orders, and additional Services as may from time to time be reasonably assigned to Contractor by Client within the scope of the Services or reasonably contemplated by this Agreement. Client and Contractor shall negotiate the terms of compensation for any additional Services required by Client if such additional Services require substantially more time, effort, or expense by Contractor. Contractor is responsible for determining the method and means of performing the Services, subject to the parameters, specifications, objectives, and timeline given by Client. Contractor acknowledges that by virtue of Contractor''s position and responsibilities, Contractor will have fiduciary duties to Client and a duty of loyalty to Client and will, at all times, act in a manner consistent with these duties and abide by Client''s reasonable rules, regulations, instructions, and directions.

5. Extent of Services. During this Agreement, Contractor shall devote his or her time, energy, and attention to the benefit and business of Client as may be reasonably necessary in performing the Services pursuant to this Agreement. With the exception of passive investments and ownership interests that require little to no time and attention, Contractor is prohibited from engaging directly or indirectly in any other business activity outside of Contractor''s duties to Client regardless of whether or not an activity is pursued for gain or profit. Nothing in this Agreement shall be construed as limiting Contractor''s right to invest his or her money in real estate, stocks, or other such investments requiring limited maintenance and that do not take any significant amount of Contractor''s time, energy, and attention away from Contractor''s duties to Client.

6. Relationship of the Parties. Contractor is an independent contractor, not Client''s employee, and nothing in this Agreement shall create an employment, agency, joint venture, or partnership relationship between the Parties. In addition, nothing in this Agreement shall require the Parties to provide one another with Confidential Information or Trade Secrets in their respective possession.

7. No Authority. Unless Client otherwise gives its prior written authorization, Contractor shall have no authority to act as agent for Client, to represent Client, or bind Client in any manner.

8. Subcontractors. Without prior written consent from Client, Contractor may not use subcontractors to perform the Services, such consent not to be unreasonably withheld by Client.

9. Termination

a. At-Will Contractor. Contractor is an at-will contractor and, as such, either Party may terminate this Agreement at any time, with or without cause, by providing the required notice. This Agreement shall also terminate as follows: (i) upon the death of Contractor; (ii) upon Client dissolving, becoming insolvent, filing bankruptcy, or ceasing all business operations; or (iii) sale of the business of either Party.

b. Notice Required. Where this Agreement is terminated due to Contractor breaching a provision of this Agreement or other just cause, Client may terminate this Agreement at any time, with or without notice, as permitted by applicable law. If any minimum notice required by law under the circumstances is greater than the notice required under this paragraph, notice will be provided in accordance with such applicable law.

c. Exit Interview. If Client so chooses, Contractor will be required to conduct an exit interview and/or write an exit memorandum upon termination of this Agreement.

10. Work Product. To the extent not contrary to applicable state law, Contractor acknowledges and agrees that any and all inventions; discoveries; improvements; trademarks; copyrightable work, including any social media contacts obtained for or on behalf of Client, or other intellectual property created, produced, designed, or developed, in whole or in part, individually or jointly with others, during this Agreement, which are directly or indirectly within the scope of Client''s past, current, or planned future operations, are Client''s exclusive property, and shall be immediately disclosed and assigned to Client. Contractor further agrees to any and all such applicable items of "work made for hire" for Client within the definition of Section 101 of Title 17 of the United States Code, or any successor provision, and any corresponding state law provisions. To the extent the above-described intellectual property is not considered a work made for hire under the applicable law, Contractor agrees to, without further consideration, assign to Client all right, title, and interest in such intellectual property and assist Client in every way, including waiving any moral rights that Contractor may obtain, at Client''s expense, to secure, maintain, and defend for Client''s benefit, copyrights and any extensions and renewals thereof on any and all such work including translations thereof in any and all countries, such work to be and remain the property of Client whether copyrighted or not. Contractor''s above obligations to Client shall be continuous and ongoing and shall survive the termination of this Agreement. The provisions of this paragraph shall apply in all cases except where Contractor receives Client''s express prior written consent otherwise or if prevented by applicable law.

11. Return of Client Property. Upon termination of this Agreement, for any reason, or at any other time that Client may so request, Contractor shall immediately deliver to Client all client property and/or information, including, but not limited to, all equipment, telephones, credit cards, keys, software, manuals, passwords, financial and tax documents, memoranda, letters, files, records, papers, notes, lists, computer programs, reports, books, and all other documents (and all copies thereof) in Contractor''s possession, custody, and/or control.

12. No Conflict. Contractor represents and warrants that the execution of this Agreement by Contractor and the performance of Contractor''s obligations hereunder will not conflict with, result in the breach of any provision of or the termination of, or constitute a default under any agreement to which Contractor is a party or by which Contractor is or may be bound. If, at any time, Contractor discovers he or she has or may have any outside business relationships or activities that conflict with Client''s best interests, then Contractor shall immediately disclose the conflict or potential conflict to Client.

13. Indemnification. Contractor must indemnify and hold harmless Client, along with its officers, directors, employees, and agents, against all claims, liabilities, losses, costs, and all other legal and non-legal expenses, including without limitation reasonable attorney''s fees and costs and insurance deductibles arising directly or indirectly from (a) Contractor''s breach of any provision of this Agreement or (b) the negligent, grossly negligent, or intentional act or omission of Contractor or any of Contractor''s directors, officers, employees, or agents that causes any type of damage to Client.

14. Equitable Relief and Remedies. Contractor acknowledges that any breach of this Agreement will cause substantial and irreparable harm to Client for which money damages would be an inadequate remedy. Accordingly, Client shall in any such event be entitled to seek injunctive and other forms of equitable relief to prevent such breach and the prevailing Party shall be entitled to recover from the other, the prevailing Party''s losses, damages, and costs, including, without limitation, reasonable attorney''s fees and costs, incurred in connection with enforcing this Agreement, in addition to any other rights or remedies available at law, in equity, or by statute.

15. Non-Exclusivity of Remedies. The enumeration herein of specific remedies shall not be exclusive of any other remedies. Any delay or failure by Client to exercise any right, power, remedy, or privilege herein contained, or now or hereafter existing under any applicable statute or law, shall not be construed to be a waiver of such right, power, remedy, or privilege. Client''s waiver of a breach of any provision of this Agreement by Contractor shall not be considered as a waiver of rights with respect to any subsequent breach by Contractor.

16. Severability. The Parties have attempted to limit the non-disclosure, non-competition, and non-solicitation provisions so that they apply only to the extent reasonably necessary to protect legitimate business and property interests. If any provision of this Agreement shall be held to be invalid or unenforceable for any reason, that provision shall be considered removed from this Agreement, and the remaining provisions shall continue to be valid and enforceable according to the intentions of the Parties. However, if a court or arbitration panel finds that any provision of this Agreement is invalid or unenforceable as currently written, but that by rewriting or limiting such provision it would become valid and enforceable, then such provision shall be deemed to be written, construed, and enforced as is necessary to further the intent of the Parties to the maximum extent permitted by law.

17. Binding Effect; Assignment. The rights and obligations of Client under this Agreement shall inure to the benefit of and shall be binding upon the successors and assigns of Client. This Agreement is a personal services contract and the rights, obligations, and interests of Contractor hereunder may not be sold, assigned, transferred, pledged, or hypothecated.

18. Entire Agreement. This Agreement contains the entire agreement and supersedes all prior agreements and understandings, oral or written, with respect to the subject matter hereof. This Agreement may be changed only by an agreement in writing signed by the Party against whom any waiver, change, amendment, modification, or discharge is sought.

19. Time of Essence. Time is of the essence in this Agreement.

20. Headings. Headings for the paragraphs herein are for convenience only and shall not be construed in interpreting this Agreement.

21. Construction. Words and terms in this Agreement shall be construed in both the feminine and masculine, where applicable, and both single and plural, where applicable.

22. Governing Law and Venue. To the extent not inconsistent with applicable law, Contractor acknowledges and agrees that this Agreement shall be governed by and construed in accordance with the laws of California.

23. Counterparts; Electronic Signature. This Agreement may be executed in counterparts, including by fax, email, or other facsimile, each an original but all considered part of one Agreement. Electronic signatures placed upon counterparts of this Agreement by a Party or their approved agent shall be considered valid representations of that Party''s signature.

24. Notice. Any notice required or permitted to be given under this Agreement shall be sufficient if in writing and if sent by certified or registered mail, first class, return receipt requested, to the Parties at the following addresses or any other address so specified in writing by a Party:

CONTRACTOR ADDRESS

_____________

_____________

_____________, California _____________

CLIENT ADDRESS

Ground Work Capital LLC

2717 W Coast HWY STE C

Newport Beach, California 92663

25. Acknowledgments. Contractor acknowledges, understands, and accepts:

a. Contractor''s obligations under this Agreement;

b. that Contractor freely enters into this Agreement;

c. that Contractor has the right to seek independent advice at Contractor''s expense or to propose modifications prior to signing the Agreement and has negotiated proposed modifications to the extent Contractor deems necessary;

d. that the covenants made by and obligations imposed upon Contractor hereby, including any and all covenants regarding confidentiality, non-competition, non-solicitation, and ownership of intellectual property, are fair, reasonable, and minimally necessary to protect the legitimate business interests of Client, and such covenants and obligations will not place an undue burden upon Contractor in the event of termination of Contractor''s contract with Client and the strict enforcement of the covenants contained herein;

e. that the above restrictions are not intended to deprive him or her of an opportunity to earn a living in the same profession as that of Client. Rather, Contractor agrees to abide by the above restrictions in recognition of Client''s legitimate and reasonable objective to protect its business interests and customer relationships;

f. that Contractor shall be a contractor at-will and that either Contractor or Client may end the business relationship at any time and for any reason;

g. that Contractor has been provided with good and valuable consideration in return for the execution of this Agreement; and

h. THAT CONTRACTOR HAS READ ALL OF THE TERMS AND CONDITIONS OF THIS AGREEMENT.

IN WITNESS WHEREOF, INTENDING TO BE LEGALLY BOUND HEREBY, CONTRACTOR AND CLIENT EXECUTED THIS AGREEMENT AS OF THE DATE SET FORTH BELOW.

CONTRACTOR

Signed: ___________________________   Date: ______________________

Name: ___________________________

Title: ___________________________

CLIENT

Signed: ___________________________   Date: ______________________

Name: ___________________________

Title: ___________________________', NOW(), 'City Access Affiliate agreement (sq ft, Peter + Adam). Approved as is by the owner on 2026-11-02.');

CREATE TABLE IF NOT EXISTS `city_partner_agreements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `template_version` INT UNSIGNED NOT NULL,
  `fee_cents_per_sqft` INT UNSIGNED NOT NULL,
  `body_rendered` MEDIUMTEXT NOT NULL,
  `body_sha256` CHAR(64) NOT NULL,
  `signer_name` VARCHAR(200) NOT NULL,
  `signer_title` VARCHAR(120) DEFAULT NULL,
  `signed_at` DATETIME NOT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `signed_user_agent` VARCHAR(500) DEFAULT NULL,
  `countersigned_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `countersigner_name` VARCHAR(200) DEFAULT NULL,
  `countersigned_at` DATETIME DEFAULT NULL,
  `voided_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cp_agreements_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_agreements_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_partner_w9s` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `status` ENUM('submitted','accepted','rejected') NOT NULL DEFAULT 'submitted',
  `legal_name` VARCHAR(200) NOT NULL,
  `business_name` VARCHAR(200) DEFAULT NULL,
  `tax_classification` VARCHAR(20) NOT NULL,
  `tin_type` ENUM('ssn','ein') NOT NULL,
  `tin_last4` CHAR(4) NOT NULL,
  `pdf_blob_pathname` VARCHAR(500) NOT NULL,
  `signed_at` DATETIME NOT NULL,
  `signed_ip` VARCHAR(45) DEFAULT NULL,
  `reviewed_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `review_note` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cp_w9_partner` (`city_partner_id`, `id`),
  CONSTRAINT `fk_cp_w9_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- City pipeline (Peter's tracker) lives on the city itself.
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `county` VARCHAR(100) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `priority` ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `pipeline_stage` ENUM('target','official_contacted','meeting_scheduled','official_support','referred_to_staff','staff_meeting','plans_submitted','in_review','comments_received','resubmitted','preapproved','on_hold') DEFAULT NULL COMMENT 'NULL = not in the pipeline';
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `interest` ENUM('high','medium','low','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `next_action` VARCHAR(300) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `next_action_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `plan_set` VARCHAR(200) DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `submitted_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `review_round` TINYINT UNSIGNED DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `comments_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `resubmitted_on` DATE DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `opened_on` DATE DEFAULT NULL COMMENT 'Opened City: plans pre-approved; City Partner fees start';
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `pipeline_notes` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `council_summary` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `adu_program_status` ENUM('none','in_development','active','paused','unknown') NOT NULL DEFAULT 'unknown';
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `adu_program_notes` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `intel_sources` TEXT DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `intel_verified_at` DATETIME DEFAULT NULL;
ALTER TABLE `service_cities` ADD COLUMN IF NOT EXISTS `intel_verified_by_admin_id` INT UNSIGNED DEFAULT NULL;
UPDATE `service_cities` SET `opened_on` = '2026-10-21', `pipeline_stage` = 'preapproved', `county` = 'San Bernardino', `priority` = 'high' WHERE `name` = 'Fontana' AND `opened_on` IS NULL;

CREATE TABLE IF NOT EXISTS `city_contacts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_id` INT UNSIGNED NOT NULL,
  `kind` ENUM('elected','city_staff','planning','building','consultant') NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `title` VARCHAR(160) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(40) DEFAULT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `verified_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_contacts_city` (`city_id`),
  CONSTRAINT `fk_city_contacts_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `city_activities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_id` INT UNSIGNED NOT NULL,
  `city_partner_id` INT UNSIGNED DEFAULT NULL,
  `admin_id` INT UNSIGNED DEFAULT NULL,
  `occurred_on` DATE NOT NULL,
  `activity_type` ENUM('call','email','meeting','presentation','follow_up','plan_submission','other') NOT NULL,
  `contact_name` VARCHAR(160) DEFAULT NULL,
  `summary` VARCHAR(1000) NOT NULL,
  `next_step` VARCHAR(300) DEFAULT NULL,
  `follow_up_on` DATE DEFAULT NULL,
  `link_url` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_city_activities_city` (`city_id`, `occurred_on`),
  CONSTRAINT `fk_city_activities_city` FOREIGN KEY (`city_id`) REFERENCES `service_cities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_city_activities_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Opened City fees: finance marks the project's funds received; fee due 5 days later.
ALTER TABLE `projects` ADD COLUMN IF NOT EXISTS `funds_received_on` DATE DEFAULT NULL COMMENT 'Starts City Partner fees (due +5 days)';
CREATE TABLE IF NOT EXISTS `city_partner_fees` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city_partner_id` INT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `city_id` INT UNSIGNED NOT NULL,
  `sq_ft` INT UNSIGNED NOT NULL,
  `rate_cents_per_sqft` INT UNSIGNED NOT NULL,
  `amount_cents` INT UNSIGNED NOT NULL,
  `status` ENUM('pending','approved','paid','void','refund_due','refunded') NOT NULL DEFAULT 'pending',
  `due_on` DATE NOT NULL,
  `paid_at` DATETIME DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `updated_by_admin_id` INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cp_fee_project` (`project_id`, `city_partner_id`),
  KEY `idx_cp_fee_partner` (`city_partner_id`, `status`),
  CONSTRAINT `fk_cp_fee_partner` FOREIGN KEY (`city_partner_id`) REFERENCES `city_partners` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cp_fee_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
