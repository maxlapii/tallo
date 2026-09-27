-- Product images are referenced by URL (admin-provided or seeded); no binary storage in the MVP.
ALTER TABLE products ADD COLUMN image_url TEXT;
