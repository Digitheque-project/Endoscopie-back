-- DropForeignKey
ALTER TABLE `rendezvous` DROP FOREIGN KEY `RendezVous_patientId_fkey`;

-- DropForeignKey
ALTER TABLE `rendezvous` DROP FOREIGN KEY `RendezVous_salleId_fkey`;

-- AlterTable
ALTER TABLE `rendezvous` ADD COLUMN `patientName` VARCHAR(191) NULL,
    MODIFY `patientId` VARCHAR(191) NULL,
    MODIFY `salleId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_salleId_fkey` FOREIGN KEY (`salleId`) REFERENCES `Salle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
