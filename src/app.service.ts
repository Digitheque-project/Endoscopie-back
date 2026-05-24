import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { CreateMedecinDto } from './dto/create-medecin.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';

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

  async createPrescription(data: CreatePrescriptionDto) {
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
      include: {
        patient: true,
        medecinPrescripteur: true,
      },
    });
  }

  async updatePrescription(id: string, data: UpdatePrescriptionDto) {
    try {
      return await this.prisma.prescription.update({
        where: { id },
        data: {
          ...(data.statut !== undefined && { statut: data.statut }),
          ...(data.priorite !== undefined && { priorite: data.priorite }),
          ...(data.typeExamen !== undefined && { typeExamen: data.typeExamen }),
          ...(data.motif !== undefined && { motif: data.motif }),
        },
        include: {
          patient: true,
          medecinPrescripteur: true,
        },
      });
    } catch {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
  }

  async getPatients() {
    return this.prisma.patient.findMany({
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
  }

  async getPatientById(id: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      include: {
        prescriptions: {
          include: { medecinPrescripteur: true },
          orderBy: { dateDemande: 'desc' },
        },
        rendezVous: true,
        dossiersCPA: true,
      },
    });
    if (!patient) {
      throw new NotFoundException(`Patient ${id} introuvable`);
    }
    return patient;
  }

  async createPatient(data: CreatePatientDto) {
    return this.prisma.patient.create({
      data: {
        nom: data.nom,
        prenom: data.prenom,
        dateNaissance: data.dateNaissance ? new Date(data.dateNaissance) : null,
        sexe: data.sexe ?? null,
        groupeSanguin: data.groupeSanguin ?? null,
        poids: data.poids ?? null,
        antecedentsMedicaux: data.antecedentsMedicaux ?? null,
      },
    });
  }

  async getMedecins() {
    return this.prisma.medecin.findMany({
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
  }

  async getMedecinById(id: string) {
    const medecin = await this.prisma.medecin.findUnique({ where: { id } });
    if (!medecin) {
      throw new NotFoundException(`Médecin ${id} introuvable`);
    }
    return medecin;
  }

  async createMedecin(data: CreateMedecinDto) {
    return this.prisma.medecin.create({
      data: {
        nom: data.nom,
        prenom: data.prenom,
        specialite: data.specialite ?? null,
        role: data.role ?? null,
      },
    });
  }

  async getDossiersCpa() {
    return this.prisma.dossierCPA.findMany({
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  async getDossierCpaById(id: string) {
    const dossier = await this.prisma.dossierCPA.findUnique({
      where: { id },
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
    return dossier;
  }

  async getDossierCpaByPrescriptionId(prescriptionId: string) {
    return this.prisma.dossierCPA.findUnique({
      where: { prescriptionId },
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
    });
  }

  async createDossierCpa(data: CreateDossierCpaDto) {
    return this.prisma.dossierCPA.create({
      data: {
        patientId: data.patientId,
        prescriptionId: data.prescriptionId ?? null,
        anesthesisteId: data.anesthesisteId ?? null,
        typeAnesthesie: data.typeAnesthesie ?? null,
        observations: data.observations ?? null,
        statut: data.statut || 'Brouillon',
      },
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
    });
  }

  async updateDossierCpa(id: string, data: UpdateDossierCpaDto) {
    try {
      return await this.prisma.dossierCPA.update({
        where: { id },
        data: {
          ...(data.anesthesisteId !== undefined && {
            anesthesisteId: data.anesthesisteId,
          }),
          ...(data.typeAnesthesie !== undefined && {
            typeAnesthesie: data.typeAnesthesie,
          }),
          ...(data.observations !== undefined && {
            observations: data.observations,
          }),
          ...(data.statut !== undefined && { statut: data.statut }),
          ...(data.dateValidation !== undefined && {
            dateValidation: new Date(data.dateValidation),
          }),
        },
        include: {
          patient: true,
          prescription: true,
          anesthesiste: true,
        },
      });
    } catch {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
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
