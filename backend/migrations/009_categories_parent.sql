-- 009_categories_parent.sql
-- Phase G (checklist item 29): optional category hierarchy.
--
-- One nullable self-reference on Categories. NULL means "root". The API —
-- not the database — enforces the maximum depth (3) and rejects cycles,
-- because a plain FK cannot express either rule. No existing row changes:
-- every current category stays a root, so the flat response is byte-compatible.
--
-- Additive + guarded: each step checks information_schema first and is safe to
-- re-run after a partial failure. No semicolons inside string literals.
--
-- Rollback (reviewed + manual; discards hierarchy links only, never rows):
--   ALTER TABLE `Categories` DROP FOREIGN KEY `Categories_parentId_fkey`;
--   ALTER TABLE `Categories` DROP COLUMN `parentId`;

SET @has_categories := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Categories');
SET @has_parent := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Categories' AND COLUMN_NAME = 'parentId');

-- 1) nullable self-reference
SET @sql := IF(@has_categories = 1 AND @has_parent = 0, 'ALTER TABLE `Categories` ADD COLUMN `parentId` INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) FK to the same table; deleting a parent promotes children to roots
SET @has_parent_fk := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Categories' AND COLUMN_NAME = 'parentId' AND REFERENCED_TABLE_NAME = 'Categories');
SET @sql := IF(@has_categories = 1 AND @has_parent = 1 AND @has_parent_fk = 0, 'ALTER TABLE `Categories` ADD CONSTRAINT `Categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
