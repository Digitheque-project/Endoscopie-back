import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async testDb() {
    // Créer une salle de test si la base est vide
    const count = await this.prisma.salle.count();
    if (count === 0) {
      await this.prisma.salle.create({
        data: {
          nom: 'Salle de Test',
          numero: 'S01',
          capacite: 1,
        },
      });
    }

    const salles = await this.prisma.salle.findMany();
    return {
      message: 'Connexion Prisma réussie !',
      salles,
    };
  }

  async getPrescriptions() {
    return this.prisma.prescription.findMany({
      include: {
        patient: true,
        medecinPrescripteur: true,
      },
      orderBy: {
        dateDemande: 'desc',
      },
    });
  }

  async getPrescriptionById(id: string) {
    return this.prisma.prescription.findUnique({
      where: { id },
      include: {
        patient: true,
        medecinPrescripteur: true,
        dossierCPA: true,
        checklistAvant: true,
      },
    });
  }

  async createPrescription(data: any) {
    return this.prisma.prescription.create({
      data: {
        patientId: data.patientId,
        medecinId: data.medecinId,
        typeExamen: data.typeExamen,
        motif: data.motif || '',
        priorite: data.priorite || 'Standard',
        statut: data.statut || 'A planifier',
        dateDemande: data.dateDemande ? new Date(data.dateDemande) : new Date(),
      },
    });
  }

  async getMedecins() {
    return this.prisma.medecin.findMany({
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
  }

  async getRendezVous() {
    return this.prisma.rendezVous.findMany({
      include: {
        patient: true,
        medecin: true,
        salle: true,
        prescription: {
          include: {
            dossierCPA: true,
          }
        },
      },
      orderBy: {
        dateHeureDebut: 'asc',
      },
    });
  }

  async getSalles() {
    return this.prisma.salle.findMany();
  }

  async createRendezVous(data: any) {
    const rendezVousPayload = {
      patientId: data.patientId || null,
      prescriptionId: data.prescriptionId || null,
      medecinId: data.medecinId || null,
      salleId: data.salleId || null,
      dateHeureDebut: new Date(data.dateHeureDebut),
      dateHeureFin: data.dateHeureFin ? new Date(data.dateHeureFin) : null,
      typeAnesthesie: data.typeAnesthesie || null,
      statut: data.statut || 'Prevu',
      notesCliniques: data.notesCliniques || null,
    };

    try {
      if (data.prescriptionId) {
        // Update prescription status to "Planifié"
        await this.prisma.prescription.update({
          where: { id: data.prescriptionId },
          data: { statut: 'Planifié' },
        });

        return await this.prisma.rendezVous.upsert({
          where: { prescriptionId: data.prescriptionId },
          update: rendezVousPayload,
          create: rendezVousPayload,
        });
      }

      return await this.prisma.rendezVous.create({
        data: rendezVousPayload,
      });
    } catch (error) {
      console.error('Erreur lors de la création du rendez-vous:', error);
      throw error;
    }
  }

  async createSalle(data: any) {
    return this.prisma.salle.create({
      data: {
        nom: data.nom,
        numero: data.numero,
        capacite: parseInt(data.capacite) || 1,
        equipement: data.equipement || "",
      }
    });
  }

  async getChecklistAvant(prescriptionId: string) {
    return this.prisma.checklistAvant.findUnique({
      where: { prescriptionId },
      include: { patient: true }
    });
  }

  async saveChecklistAvant(data: any) {
    console.log("Saving checklist avant for patient:", data.patientId, "Prescription:", data.prescriptionId, "RendezVous:", data.rendezVousId);
    
    if (!data.prescriptionId) {
      throw new Error("prescriptionId est obligatoire pour enregistrer la checklist");
    }

    const checklistData = {
      identiteVerifiee: !!data.identiteVerifiee,
      procedureConfirmee: !!data.procedureConfirmee,
      materielDisponible: !!data.materielDisponible,
      risquesVerifies: !!data.risquesVerifies,
      jeuneRespecte: !!data.jeuneRespecte,
      preparationAdequate: !!data.preparationAdequate,
      validationCollegiale: !!data.validationCollegiale,
      anticoagulantsArretes: !!data.anticoagulantsArretes,
      antibioprophylaxie: !!data.antibioprophylaxie,
      tenueAppropriee: !!data.tenueAppropriee,
      constantes_tension: data.constantes_tension,
      constantes_pouls: data.constantes_pouls,
      constantes_saturation: data.constantes_saturation,
      observations: data.observations,
      estValide: !!data.estValide,
      rendezVousId: data.rendezVousId || null,
    };

    const result = await this.prisma.checklistAvant.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: checklistData,
      create: {
        ...checklistData,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      }
    });
    
    console.log("Checklist processed successfully for prescription:", data.prescriptionId);
    return result;
  }
}
