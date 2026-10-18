-- 003_products_catalog_fields.sql
-- Phase 3 (schema v1): catalog + shopping fields on Products.
--   slug       — URL-safe unique identifier (legacy rows get "<name-slug>-p<id>",
--                which is collision-free by construction: the trailing -p<id>
--                suffix can only be produced by that same row)
--   stock      — product-level inventory count (moves to variants in a later phase)
--   imageMeta  — JSON metadata for the primary image, e.g. {"alt","width","height"}
--   categoryId — FK to Categories.id (ON DELETE SET NULL ON UPDATE CASCADE);
--                the legacy free-text `category` string is kept untouched
-- Backfills: slugs for existing rows; categoryId from trimmed legacy `category`
-- strings matched (case-insensitively) against Categories.name.
-- Additive + guarded: every step checks information_schema first, so this file is
-- safe to re-run after a partial failure. No semicolons inside string literals.
--
-- Rollback (manual, review first):
--   ALTER TABLE `Products` DROP FOREIGN KEY `fk_products_category`;
--   ALTER TABLE `Products` DROP INDEX `uq_products_slug`;
--   ALTER TABLE `Products` DROP COLUMN `categoryId`, DROP COLUMN `imageMeta`,
--     DROP COLUMN `stock`, DROP COLUMN `slug`;
-- Recovery alternative: pre-migration backup + npm run db:restore (docs/schema-v1.md).

SET @has_products := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products');
SET @has_categories := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Categories');

-- 1) slug column (nullable first — backfilled in step 2, tightened in step 4)
SET @has_slug := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'slug');
SET @sql := IF(@has_products = 1 AND @has_slug = 0, 'ALTER TABLE `Products` ADD COLUMN `slug` VARCHAR(160) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) backfill slugs for legacy rows (only rows with a missing slug)
SET @sql := IF(@has_products = 1, 'UPDATE `Products` SET `slug` = CONCAT(LEFT(COALESCE(NULLIF(TRIM(BOTH ''-'' FROM REGEXP_REPLACE(LOWER(TRIM(`name`)), ''[^a-z0-9]+'', ''-'')), ''''), ''product''), 140), ''-p'', `id`) WHERE `slug` IS NULL OR `slug` = ''''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) unique index on slug (guard: skip if a single-column unique index already covers it)
SET @has_slug_unique := (SELECT COUNT(*) FROM information_schema.STATISTICS s WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = 'Products' AND s.NON_UNIQUE = 0 AND s.COLUMN_NAME = 'slug' AND (SELECT COUNT(*) FROM information_schema.STATISTICS s2 WHERE s2.TABLE_SCHEMA = s.TABLE_SCHEMA AND s2.TABLE_NAME = s.TABLE_NAME AND s2.INDEX_NAME = s.INDEX_NAME) = 1);
SET @sql := IF(@has_products = 1 AND @has_slug_unique = 0, 'CREATE UNIQUE INDEX `uq_products_slug` ON `Products` (`slug`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) slug NOT NULL (guard: only when currently nullable)
SET @slug_nullable := (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'slug' LIMIT 1);
SET @sql := IF(@has_products = 1 AND @slug_nullable = 'YES', 'ALTER TABLE `Products` MODIFY COLUMN `slug` VARCHAR(160) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) stock
SET @has_stock := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'stock');
SET @sql := IF(@has_products = 1 AND @has_stock = 0, 'ALTER TABLE `Products` ADD COLUMN `stock` INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6) imageMeta (JSON metadata for the primary image)
SET @has_imagemeta := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'imageMeta');
SET @sql := IF(@has_products = 1 AND @has_imagemeta = 0, 'ALTER TABLE `Products` ADD COLUMN `imageMeta` JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7) categoryId
SET @has_categoryid := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'categoryId');
SET @sql := IF(@has_products = 1 AND @has_categoryid = 0, 'ALTER TABLE `Products` ADD COLUMN `categoryId` INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 8) create Categories rows for the legacy free-text category strings
--    (distinct, trimmed; slug = "<slug>-c<min-product-id>" which is unique
--     because each min id belongs to exactly one category group; taxRate is the
--     configurable default 0.00 until an admin sets the real per-category rate)
SET @sql := IF(@has_products = 1 AND @has_categories = 1, 'INSERT INTO `Categories` (`name`, `slug`, `description`, `taxRate`, `createdAt`, `updatedAt`) SELECT t.`name`, CONCAT(LEFT(COALESCE(NULLIF(TRIM(BOTH ''-'' FROM REGEXP_REPLACE(LOWER(t.`name`), ''[^a-z0-9]+'', ''-'')), ''''), ''category''), 140), ''-c'', t.`min_id`), NULL, 0.00, NOW(), NOW() FROM (SELECT TRIM(`category`) AS `name`, MIN(`id`) AS `min_id` FROM `Products` WHERE `category` IS NOT NULL AND TRIM(`category`) <> '''' GROUP BY TRIM(`category`)) t WHERE t.`name` NOT IN (SELECT `name` FROM `Categories`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9) backfill categoryId from legacy free-text category strings (trimmed match)
SET @sql := IF(@has_products = 1 AND @has_categories = 1, 'UPDATE `Products` p JOIN `Categories` c ON c.`name` = TRIM(p.`category`) SET p.`categoryId` = c.`id` WHERE p.`categoryId` IS NULL AND p.`category` IS NOT NULL AND TRIM(p.`category`) <> ''''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 10) FK categoryId -> Categories.id (guard: any FK on categoryId already referencing Categories)
SET @has_category_fk := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Products' AND COLUMN_NAME = 'categoryId' AND REFERENCED_TABLE_NAME = 'Categories');
SET @sql := IF(@has_products = 1 AND @has_categories = 1 AND @has_category_fk = 0, 'ALTER TABLE `Products` ADD CONSTRAINT `fk_products_category` FOREIGN KEY (`categoryId`) REFERENCES `Categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
