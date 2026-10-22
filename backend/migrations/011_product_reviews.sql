-- 011_product_reviews.sql
-- Checklist items 23-25 (owner-approved 2026-10-22): moderated reviews.
--
-- ADDITIVE ONLY. New reviews are forced to status = pending by the API; only
-- approved rows are ever exposed publicly or aggregated. (userId, productId)
-- is unique so a customer cannot submit twice, even under a race.
--
-- Rollback (reviewed + manual): DROP TABLE `ProductReviews`;
-- No existing table or row is touched by this migration.
--
-- Guarded for re-runs; no semicolons inside string literals.

SET @has_reviews := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ProductReviews');
SET @sql := IF(@has_reviews = 0, 'CREATE TABLE `ProductReviews` (`id` INT NOT NULL AUTO_INCREMENT, `productId` INT NOT NULL, `userId` INT NOT NULL, `rating` SMALLINT NOT NULL, `title` VARCHAR(120) NULL, `body` TEXT NOT NULL, `status` ENUM(''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''pending'', `moderatedBy` INT NULL, `moderatedAt` DATETIME NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_product_reviews_user_product` (`userId`, `productId`), KEY `idx_product_reviews_product_status` (`productId`, `status`, `createdAt`), CONSTRAINT `ProductReviews_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT `ProductReviews_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT `ProductReviews_moderatedBy_fkey` FOREIGN KEY (`moderatedBy`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
