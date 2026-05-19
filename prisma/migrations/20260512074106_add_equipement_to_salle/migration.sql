-- CreateTable
CREATE TABLE `Patient` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `prenom` VARCHAR(191) NOT NULL,
    `dateNaissance` DATETIME(3) NULL,
    `sexe` VARCHAR(191) NULL,
    `groupeSanguin` VARCHAR(191) NULL,
    `poids` DOUBLE NULL,
    `antecedentsMedicaux` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Medecin` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `prenom` VARCHAR(191) NOT NULL,
    `specialite` VARCHAR(191) NULL,
    `role` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Salle` (
    `id` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `numero` VARCHAR(191) NOT NULL,
    `capacite` INTEGER NOT NULL DEFAULT 1,
    `equipement` VARCHAR(191) NULL DEFAULT '',
    `estActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Prescription` (
    `id` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `medecinId` VARCHAR(191) NOT NULL,
    `typeExamen` VARCHAR(191) NOT NULL,
    `motif` VARCHAR(191) NULL,
    `priorite` VARCHAR(191) NOT NULL DEFAULT 'Standard',
    `statut` VARCHAR(191) NOT NULL DEFAULT 'A planifier',
    `dateDemande` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Prescription_medecinId_idx`(`medecinId`),
    INDEX `Prescription_patientId_idx`(`patientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RendezVous` (
    `id` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `prescriptionId` VARCHAR(191) NULL,
    `salleId` VARCHAR(191) NOT NULL,
    `medecinId` VARCHAR(191) NULL,
    `dateHeureDebut` DATETIME(3) NOT NULL,
    `dateHeureFin` DATETIME(3) NULL,
    `typeAnesthesie` VARCHAR(191) NULL,
    `statut` VARCHAR(191) NOT NULL DEFAULT 'Prevu',
    `notesCliniques` VARCHAR(191) NULL,

    UNIQUE INDEX `RendezVous_prescriptionId_key`(`prescriptionId`),
    INDEX `RendezVous_patientId_idx`(`patientId`),
    INDEX `RendezVous_medecinId_idx`(`medecinId`),
    INDEX `RendezVous_prescriptionId_idx`(`prescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DossierCPA` (
    `id` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `prescriptionId` VARCHAR(191) NULL,
    `anesthesisteId` VARCHAR(191) NULL,
    `typeAnesthesie` VARCHAR(191) NULL,
    `observations` VARCHAR(191) NULL,
    `statut` VARCHAR(191) NOT NULL DEFAULT 'Brouillon',
    `dateValidation` DATETIME(3) NULL,

    UNIQUE INDEX `DossierCPA_prescriptionId_key`(`prescriptionId`),
    INDEX `DossierCPA_patientId_idx`(`patientId`),
    INDEX `DossierCPA_anesthesisteId_idx`(`anesthesisteId`),
    INDEX `DossierCPA_prescriptionId_idx`(`prescriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_medecinId_fkey` FOREIGN KEY (`medecinId`) REFERENCES `Medecin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_prescriptionId_fkey` FOREIGN KEY (`prescriptionId`) REFERENCES `Prescription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_salleId_fkey` FOREIGN KEY (`salleId`) REFERENCES `Salle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RendezVous` ADD CONSTRAINT `RendezVous_medecinId_fkey` FOREIGN KEY (`medecinId`) REFERENCES `Medecin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierCPA` ADD CONSTRAINT `DossierCPA_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierCPA` ADD CONSTRAINT `DossierCPA_prescriptionId_fkey` FOREIGN KEY (`prescriptionId`) REFERENCES `Prescription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DossierCPA` ADD CONSTRAINT `DossierCPA_anesthesisteId_fkey` FOREIGN KEY (`anesthesisteId`) REFERENCES `Medecin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
