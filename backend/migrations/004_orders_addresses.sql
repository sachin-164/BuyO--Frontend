-- 004_orders_addresses.sql
-- Phase 6: Addresses + Orders (COD), OrderItems (purchase snapshots) and
-- OrderStatusEvents (status history).
--   * Orders stores authoritative purchase snapshots: totals, per-category tax
--     breakdown (JSON), a full shipping-address snapshot (JSON) and per-item
--     price/name/tax snapshots, so later catalog or address changes never
--     alter historical orders.
--   * Idempotency: UNIQUE (userId, idempotencyKey) — a retried checkout
--     returns the existing order instead of creating a second one or
--     decrementing stock again.
--   * Status history intentionally has NO uniqueness on (orderId, toStatus):
--     duplicate-cancellation protection comes from the locked order row plus
--     validated status transitions inside one transaction (see
--     controllers/adminOrderController.js). The table must stay able to
--     represent future legitimate repeated statuses (e.g. returns flows).
-- Additive only: CREATE TABLE IF NOT EXISTS is safe to re-run; no existing
-- table is touched and no backfills are required.
--
-- Rollback (manual, review first — destroys order history):
--   DROP TABLE `OrderStatusEvents`;
--   DROP TABLE `OrderItems`;
--   DROP TABLE `Orders`;
--   DROP TABLE `Addresses`;
-- Recovery alternative: pre-migration backup + npm run db:restore
-- (docs/backup-restore.md; tooling rehearsed in Phase 3).

CREATE TABLE IF NOT EXISTS `Addresses` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `label` VARCHAR(50) DEFAULT NULL,
  `fullName` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(15) NOT NULL,
  `line1` VARCHAR(255) NOT NULL,
  `line2` VARCHAR(255) DEFAULT NULL,
  `city` VARCHAR(100) NOT NULL,
  `state` VARCHAR(100) NOT NULL,
  `pincode` VARCHAR(10) NOT NULL,
  `isDefault` TINYINT(1) NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_addresses_user` (`userId`),
  CONSTRAINT `fk_addresses_user` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `Orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `orderNumber` VARCHAR(20) NOT NULL,
  `idempotencyKey` VARCHAR(64) NOT NULL,
  `status` ENUM('placed','confirmed','shipped','delivered','cancelled') NOT NULL DEFAULT 'placed',
  `paymentMethod` ENUM('cod') NOT NULL DEFAULT 'cod',
  `subtotal` DECIMAL(12,2) NOT NULL,
  `taxTotal` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `grandTotal` DECIMAL(12,2) NOT NULL,
  `taxBreakdown` JSON DEFAULT NULL,
  `shippingAddress` JSON NOT NULL,
  `addressId` INT DEFAULT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_number` (`orderNumber`),
  UNIQUE KEY `uq_orders_user_idem` (`userId`,`idempotencyKey`),
  KEY `idx_orders_user` (`userId`,`createdAt`),
  KEY `idx_orders_status` (`status`),
  KEY `idx_orders_address` (`addressId`),
  CONSTRAINT `fk_orders_user` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_address` FOREIGN KEY (`addressId`) REFERENCES `Addresses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `OrderItems` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `orderId` INT NOT NULL,
  `productId` INT DEFAULT NULL,
  `name` VARCHAR(200) NOT NULL,
  `image` VARCHAR(500) DEFAULT NULL,
  `unitPrice` DECIMAL(10,2) NOT NULL,
  `qty` INT NOT NULL,
  `lineTotal` DECIMAL(12,2) NOT NULL,
  `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `taxAmount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `categoryName` VARCHAR(100) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`orderId`),
  KEY `idx_order_items_product` (`productId`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`orderId`) REFERENCES `Orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`productId`) REFERENCES `Products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `OrderStatusEvents` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `orderId` INT NOT NULL,
  `fromStatus` ENUM('placed','confirmed','shipped','delivered','cancelled') DEFAULT NULL,
  `toStatus` ENUM('placed','confirmed','shipped','delivered','cancelled') NOT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status_events_order` (`orderId`,`createdAt`),
  CONSTRAINT `fk_status_events_order` FOREIGN KEY (`orderId`) REFERENCES `Orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
