-- 002_create_categories.sql
-- Phase 3 (schema v1): Categories — canonical product taxonomy with a
-- CONFIGURABLE per-category tax rate (e.g. GST), default 0.00 (never hardcoded).
-- Legacy free-text Products.category strings are migrated into this table by
-- migration 003; the legacy column itself is kept for backward compatibility.
-- Additive + guarded: CREATE TABLE IF NOT EXISTS is safe to re-run.
--
-- Rollback (manual, review first): DROP TABLE `Categories`;
-- (only safe before migration 003 has linked/backfilled categoryId values).

CREATE TABLE IF NOT EXISTS `Categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(160) NOT NULL,
  `description` TEXT,
  `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_name` (`name`),
  UNIQUE KEY `uq_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
