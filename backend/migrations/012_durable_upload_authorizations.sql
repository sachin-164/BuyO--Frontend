-- 012_durable_upload_authorizations.sql
-- Durable replacement for the process-local upload-authorization ledger.
-- Each row is ONE single-use authorization minted by POST /api/uploads/authorize;
-- the product write deletes it transactionally after consuming it.
--
-- Additive + guarded: CREATE TABLE IF NOT EXISTS is safe to re-run. No existing
-- table or row is touched.
--
-- Rollback (reviewed + manual): DROP TABLE `UploadAuthorizations`;
-- Pending authorizations expire after UPLOAD_AUTH_TTL_MS (10 minutes default).

CREATE TABLE IF NOT EXISTS `UploadAuthorizations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `objectPath` VARCHAR(255) NOT NULL,
  `adminId` INT NOT NULL,
  `mimetype` VARCHAR(100) NOT NULL,
  `size` INT NOT NULL,
  `expiresAt` DATETIME NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_upload_authorizations_object_path` (`objectPath`),
  KEY `idx_upload_authorizations_expires` (`expiresAt`),
  CONSTRAINT `UploadAuthorizations_adminId_fkey` FOREIGN KEY (`adminId`)
    REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
