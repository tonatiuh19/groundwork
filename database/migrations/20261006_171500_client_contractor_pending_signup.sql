-- Allow self-signup applications awaiting staff approval.
-- clients: pending → (approve) prospect + portal invite
-- contractors: pending → (approve) active (invite path stays invited → active)

ALTER TABLE `clients`
  MODIFY COLUMN `status` ENUM(
    'pending',
    'prospect',
    'active',
    'inactive',
    'suspended'
  ) NOT NULL DEFAULT 'prospect';

ALTER TABLE `contractors`
  MODIFY COLUMN `status` ENUM(
    'pending',
    'invited',
    'active',
    'inactive',
    'suspended'
  ) NOT NULL DEFAULT 'invited';
