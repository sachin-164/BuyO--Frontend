-- 010_product_variants.sql
-- Checklist items 20-22 (owner-approved 2026-10-22): size/colour variants.
--
-- ADDITIVE ONLY:
--   1. ProductVariants (parent product FK, unique SKU, independent stock,
--      optional price delta, active flag).
--   2. CartItems.variantId + FK (NULL = legacy/base line).
--   3. OrderItems variant snapshots (id + SKU + options + delta). The actual
--      purchased unit price stays in OrderItems.unitPrice.
--
-- Existing products keep working unchanged: no row is backfilled and a product
-- with no variant rows continues to use Products.stock. Once variants exist,
-- the API maintains Products.stock as SUM(active variant stock) so existing
-- stock filters/analytics remain meaningful.
--
-- Guards make every step safe to re-run after a partial MySQL DDL failure.
-- No semicolons inside string literals (runner policy).
--
-- Rollback (reviewed + manual; additive columns are dropped after the table):
--   ALTER TABLE `OrderItems` DROP FOREIGN KEY `OrderItems_variantId_fkey`;
--   ALTER TABLE `OrderItems` DROP COLUMN `variantColor`;
--   ALTER TABLE `OrderItems` DROP COLUMN `variantSize`;
--   ALTER TABLE `OrderItems` DROP COLUMN `variantSku`;
--   ALTER TABLE `OrderItems` DROP COLUMN `variantPriceAdjustment`;
--   ALTER TABLE `OrderItems` DROP COLUMN `variantId`;
--   ALTER TABLE `CartItems` DROP FOREIGN KEY `CartItems_variantId_fkey`;
--   ALTER TABLE `CartItems` DROP COLUMN `variantId`;
--   DROP TABLE `ProductVariants`;
-- Historical Orders/OrderItems rows are never modified by this migration.

SET @has_variants := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ProductVariants');

SET @sql := IF(@has_variants = 0, 'CREATE TABLE `ProductVariants` (`id` INT NOT NULL AUTO_INCREMENT, `productId` INT NOT NULL, `sku` VARCHAR(64) NOT NULL, `size` VARCHAR(40) NULL, `color` VARCHAR(40) NULL, `priceAdjustment` DECIMAL(10,2) NOT NULL DEFAULT 0, `stock` INT NOT NULL DEFAULT 0, `isActive` TINYINT(1) NOT NULL DEFAULT 1, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_product_variants_sku` (`sku`), KEY `idx_product_variants_product` (`productId`, `isActive`), CONSTRAINT `ProductVariants_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_cart_column := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CartItems' AND COLUMN_NAME = 'variantId');
SET @sql := IF(@has_cart_column = 0, 'ALTER TABLE `CartItems` ADD COLUMN `variantId` INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Name the FK support index explicitly so a sync-built table (Sequelize names
-- the index `variantId`) and a migration-built table have identical index
-- metadata. The FK is added afterwards so MySQL reuses this index.
SET @has_cart_variant_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CartItems' AND INDEX_NAME = 'variantId');
SET @sql := IF(@has_cart_variant_index = 0, 'ALTER TABLE `CartItems` ADD KEY `variantId` (`variantId`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_cart_fk := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CartItems' AND COLUMN_NAME = 'variantId' AND REFERENCED_TABLE_NAME = 'ProductVariants');
SET @sql := IF(@has_cart_fk = 0, 'ALTER TABLE `CartItems` ADD CONSTRAINT `CartItems_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_order_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OrderItems' AND COLUMN_NAME = 'variantId');
SET @sql := IF(@has_order_col = 0, 'ALTER TABLE `OrderItems` ADD COLUMN `variantId` INT NULL, ADD COLUMN `variantSku` VARCHAR(64) NULL, ADD COLUMN `variantSize` VARCHAR(40) NULL, ADD COLUMN `variantColor` VARCHAR(40) NULL, ADD COLUMN `variantPriceAdjustment` DECIMAL(10,2) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_order_variant_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OrderItems' AND INDEX_NAME = 'variantId');
SET @sql := IF(@has_order_variant_index = 0, 'ALTER TABLE `OrderItems` ADD KEY `variantId` (`variantId`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_order_fk := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'OrderItems' AND COLUMN_NAME = 'variantId' AND REFERENCED_TABLE_NAME = 'ProductVariants');
SET @sql := IF(@has_order_fk = 0, 'ALTER TABLE `OrderItems` ADD CONSTRAINT `OrderItems_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
