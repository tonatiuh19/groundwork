-- ADU plan exteriors: use the clean photos (no baked-in AI text/icons) everywhere the plan image shows
-- (client portal project, admin Plans). Only replaces the original defaults, never a custom upload.
UPDATE adu_plans SET exterior_image_url = '/adu/design-photo-1.jpg' WHERE exterior_image_url = '/adu/design-viz-1.jpg';
UPDATE adu_plans SET exterior_image_url = '/adu/design-photo-2.jpg' WHERE exterior_image_url = '/adu/design-viz-2.jpg';
UPDATE adu_plans SET exterior_image_url = '/adu/design-photo-3.jpg' WHERE exterior_image_url = '/adu/design-viz-3.jpg';
