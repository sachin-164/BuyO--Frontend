-- 008_create_product_images.sql
-- Phase D (checklist item 32): ordered product gallery.
--
-- Products.image remains the PRIMARY image and is kept equal to the gallery row
-- at position 0 (the API enforces this). Galleries are optional: a product with
-- no rows keeps rendering from Products.image, so every existing record is valid
-- without a backfill.
--
-- Additive + guarded: CREATE TABLE IF NOT EXISTS is safe to re-run. No existing
-- column or row is touched.
--
-- Rollback (reviewed + manual): DROP TABLE `ProductImages`;
-- Safe at any time: no other table references it, and Products.image is
-- untouched by this migration (and remains authoritative for the primary image).

CREATE TABLE IF NOT EXISTS `ProductImages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productId` INT NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `alt` VARCHAR(255) NULL,
  `position` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_product_images_product_position` (`productId`, `position`),
  CONSTRAINT `fk_product_images_product` FOREIGN KEY (`productId`)
    REFERENCES `Products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
