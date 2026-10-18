-- 001_add_users_role.sql
-- Phase 3 (schema v1): database-backed authorization role on Users.
--   role ENUM('customer','admin') NOT NULL DEFAULT 'customer'
-- Public signup always writes 'customer'; admins are granted ONLY via the
-- audited provisioning script (scripts/admin-role.js — see docs/admin-provisioning.md).
-- Additive + guarded: safe to re-run; existing rows keep access via the
-- transitional ADMIN_EMAILS fallback in utils/roles.js.
--
-- Rollback (manual, review first): ALTER TABLE `Users` DROP COLUMN `role`;
-- Recovery alternative: restore a pre-migration backup (see docs/schema-v1.md).

SET @has_table := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users');
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'role');

SET @sql := IF(@has_table = 1 AND @has_col = 0, 'ALTER TABLE `Users` ADD COLUMN `role` ENUM(''customer'',''admin'') NOT NULL DEFAULT ''customer'' AFTER `isVerified`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
