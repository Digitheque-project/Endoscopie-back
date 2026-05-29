import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  getChuApiUrl,
  getEndoscopieServiceId,
} from './config/endoscopie-service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { CreateMedecinDto } from './dto/create-medecin.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { NotificationService } from './notification/notification.service';
import {
  getNotificationApiUrl,
  getNotificationWebhookUrl,
} from './config/notification-service';
import { CreateNotificationPayload } from './notification/notification.types';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  getEndoscopieServiceId(override?: string): string {
    return getEndoscopieServiceId(override);
  }

  private scope(override?: string) {
    return { serviceId: this.getEndoscopieServiceId(override) };
  }

  async getEndoscopieConfig() {
    const serviceId = this.getEndoscopieServiceId();
    const chuApiUrl = getChuApiUrl();
    let service: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${chuApiUrl}/service/${serviceId}`);
      if (res.ok) {
        service = (await res.json()) as Record<string, unknown>;
      }
    } catch {
      service = null;
    }
    return { serviceId, chuApiUrl, service };
  }

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const columns = await this.prisma.$queryRaw<
        { column_name: string }[]
      >`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Prescription'
          AND column_name = 'serviceId'
      `;
      const [patients, medecins, prescriptions] = await Promise.all([
        this.prisma.patient.count(),
        this.prisma.medecin.count(),
        this.prisma.prescription.count(),
      ]);
      return {
        ok: true,
        database: 'connected',
        hasServiceIdColumn: columns.length > 0,
        endoscopieServiceId: this.getEndoscopieServiceId(),
        counts: { patients, medecins, prescriptions },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, database: 'error', message };
    }
  }

  async testDb(serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const count = await this.prisma.salle.count({ where: { serviceId } });
    if (count === 0) {
      await this.prisma.salle.create({
        data: {
          serviceId,
          nom: 'Salle de Test',
          numero: 'S01',
          capacite: 1,
        },
      });
    }

    const salles = await this.prisma.salle.findMany({ where: { serviceId } });
    return {
      message: 'Connexion Prisma réussie !',
      serviceId,
      salles,
    };
  }

  async getPrescriptions(serviceIdOverride?: string) {
    return this.prisma.prescription.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        patient: true,
        medecinPrescripteur: true,
      },
      orderBy: {
        dateDemande: 'desc',
      },
    });
  }

  async getPrescriptionById(id: string, serviceIdOverride?: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id, ...this.scope(serviceIdOverride) },
      include: {
        patient: true,
        medecinPrescripteur: true,
        dossierCPA: true,
        checklistAvant: true,
      },
    });
    if (!prescription) {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
    return prescription;
  }

  async createPrescription(data: CreatePrescriptionDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    if (!data.patientId?.trim() || !data.medecinId?.trim()) {
      throw new BadRequestException('patientId et medecinId sont obligatoires');
    }
    if (!data.typeExamen?.trim()) {
      throw new BadRequestException('typeExamen est obligatoire');
    }

    // Si le patient n'existe pas dans la base, on le crée automatiquement
    // (cas: l'appelant fournit un patientId externe).
    const [patient, medecin] = await Promise.all([
      this.prisma.patient.upsert({
        where: { id: data.patientId },
        update: {},
        create: {
          id: data.patientId,
          nom: 'INCONNU',
          prenom: 'PATIENT',
          dateNaissance: null,
          sexe: null,
          groupeSanguin: null,
          poids: null,
          antecedentsMedicaux: null,
        },
      }),
      this.prisma.medecin.upsert({
        where: { id: data.medecinId },
        update: {},
        create: {
          id: data.medecinId,
          nom: 'INCONNU',
          prenom: 'MEDECIN',
          specialite: null,
          role: null,
        },
      }),
    ]);

    try {
      const prescription = await this.prisma.prescription.create({
        data: {
          serviceId,
          patientId: data.patientId,
          medecinId: data.medecinId,
          typeExamen: data.typeExamen,
          motif: data.motif || '',
          priorite: data.priorite || 'Standard',
          statut: data.statut || 'A planifier',
          dateDemande: data.dateDemande
            ? new Date(data.dateDemande)
            : new Date(),
        },
        include: {
          patient: true,
          medecinPrescripteur: true,
        },
      });

      await this.notificationService.notifyPrescriptionCreated(prescription);

      return prescription;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('serviceId')) {
        throw new BadRequestException(
          'Colonne serviceId absente. Exécutez le script SQL de migration puis npx prisma db push.',
        );
      }
      throw error;
    }
  }

  async updatePrescription(
    id: string,
    data: UpdatePrescriptionDto,
    serviceIdOverride?: string,
  ) {
    await this.getPrescriptionById(id, serviceIdOverride);
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

  async getPatientById(id: string, serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      include: {
        prescriptions: {
          where: { serviceId },
          include: { medecinPrescripteur: true },
          orderBy: { dateDemande: 'desc' },
        },
        rendezVous: { where: { serviceId } },
        dossiersCPA: { where: { serviceId } },
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

  async getDossiersCpa(serviceIdOverride?: string) {
    return this.prisma.dossierCPA.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  async getDossierCpaById(id: string, serviceIdOverride?: string) {
    const dossier = await this.prisma.dossierCPA.findFirst({
      where: { id, ...this.scope(serviceIdOverride) },
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

  async getDossierCpaByPrescriptionId(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    return this.prisma.dossierCPA.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: {
        patient: true,
        prescription: true,
        anesthesiste: true,
      },
    });
  }

  async createDossierCpa(data: CreateDossierCpaDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    return this.prisma.dossierCPA.create({
      data: {
        serviceId,
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

  async updateDossierCpa(
    id: string,
    data: UpdateDossierCpaDto,
    serviceIdOverride?: string,
  ) {
    await this.getDossierCpaById(id, serviceIdOverride);
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

  async getRendezVous(serviceIdOverride?: string) {
    return this.prisma.rendezVous.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        patient: true,
        medecin: true,
        salle: true,
        prescription: {
          include: {
            dossierCPA: true,
          },
        },
      },
      orderBy: {
        dateHeureDebut: 'asc',
      },
    });
  }

  async getSalles(serviceIdOverride?: string) {
    return this.prisma.salle.findMany({
      where: this.scope(serviceIdOverride),
    });
  }

  async createRendezVous(data: any) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    const rendezVousPayload = {
      serviceId,
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
        await this.prisma.prescription.updateMany({
          where: { id: data.prescriptionId, serviceId },
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
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    return this.prisma.salle.create({
      data: {
        serviceId,
        nom: data.nom,
        numero: data.numero,
        capacite: parseInt(data.capacite) || 1,
        equipement: data.equipement || '',
      },
    });
  }

  async getChecklistAvant(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    return this.prisma.checklistAvant.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: { patient: true },
    });
  }

  async saveChecklistAvant(data: any) {
    if (!data.prescriptionId) {
      throw new Error(
        'prescriptionId est obligatoire pour enregistrer la checklist',
      );
    }

    const serviceId = this.getEndoscopieServiceId(data.serviceId);

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

    return this.prisma.checklistAvant.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: checklistData,
      create: {
        ...checklistData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });
  }

  listNotifications(status = 'ENVOYE') {
    return this.notificationService.listNotifications(status);
  }

  createNotification(payload: CreateNotificationPayload) {
    return this.notificationService.createNotification(payload);
  }

  getNotificationHealth() {
    return this.notificationService.checkHealth().then((health) => ({
      notificationApiUrl: getNotificationApiUrl(),
      webhookReceiveUrl: getNotificationWebhookUrl(),
      ...health,
    }));
  }
}
