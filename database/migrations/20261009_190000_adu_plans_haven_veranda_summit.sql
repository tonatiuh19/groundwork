-- ADU plan catalog: official model names + correct specs.
-- Rows are updated in place so projects already linked to a plan keep their link.
UPDATE `adu_plans` SET `name` = 'The Haven', `sq_ft` = 445, `bedrooms` = 1, `bathrooms` = 1.0, `stories` = 1,
  `description` = 'Compact Living, Thoughtfully Designed',
  `exterior_image_url` = '/adu/design-viz-3.jpg', `layout_image_url` = '/adu/plan-3d-3.jpg' WHERE `id` = 1;
UPDATE `adu_plans` SET `name` = 'The Veranda', `sq_ft` = 474, `bedrooms` = 2, `bathrooms` = 1.0, `stories` = 1,
  `description` = 'More Room. More Possibilities.',
  `exterior_image_url` = '/adu/design-viz-1.jpg', `layout_image_url` = '/adu/plan-3d-1.jpg' WHERE `id` = 2;
UPDATE `adu_plans` SET `name` = 'The Summit', `sq_ft` = 830, `bedrooms` = 2, `bathrooms` = 2.0, `stories` = 2,
  `description` = 'Elevated Two-Story Living',
  `exterior_image_url` = '/adu/design-viz-2.jpg', `layout_image_url` = '/adu/plan-3d-2.jpg' WHERE `id` = 3;
