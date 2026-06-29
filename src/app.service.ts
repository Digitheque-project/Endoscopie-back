import { randomUUID } from 'crypto';
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
        dossierCPA: { include: { anesthesiste: true } },
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
        rendezVous: true,
      },
    });
    if (!prescription) {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
    return prescription;
  }

  async getArchives(
    filters: { nom?: string; dateFrom?: string; dateTo?: string },
    serviceIdOverride?: string,
  ) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = new Date(`${filters.dateTo}T23:59:59.999`);

    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        serviceId,
        ...(Object.keys(dateFilter).length ? { dateDemande: dateFilter } : {}),
        ...(filters.nom
          ? {
              patient: {
                OR: [
                  { nom: { contains: filters.nom, mode: 'insensitive' } },
                  { prenom: { contains: filters.nom, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        patient: true,
        medecinPrescripteur: true,
        dossierCPA: true,
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
      },
      orderBy: { dateDemande: 'desc' },
    });

    return prescriptions.map((p) => {
      const checklistAvantValide = !!p.checklistAvant?.estValide;
      const checklistApresValide = !!p.checklistApres?.estValide;
      const resultatDisponible = !!p.resultatEndoscopie;
      return {
        prescriptionId: p.id,
        patientId: p.patientId,
        patientNom: p.patient.nom,
        patientPrenom: p.patient.prenom,
        typeExamen: p.typeExamen,
        dateDemande: p.dateDemande,
        prescripteur: p.medecinPrescripteur
          ? `Dr. ${p.medecinPrescripteur.prenom} ${p.medecinPrescripteur.nom}`
          : null,
        statutPrescription: p.statut,
        cpaStatut: p.dossierCPA?.statut ?? null,
        checklistAvantValide,
        checklistApresValide,
        resultatDisponible,
        statutGlobal:
          checklistAvantValide && checklistApresValide && resultatDisponible
            ? 'Complet'
            : 'En cours',
      };
    });
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

  async getRendezVousJour(date: string, serviceIdOverride?: string) {
    // Parse date format YYYY-MM-DD and get start/end of day
    const dateObj = new Date(`${date}T00:00:00Z`);
    const startOfDay = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0));
    const endOfDay = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 23, 59, 59));

    return this.prisma.rendezVous.findMany({
      where: {
        ...this.scope(serviceIdOverride),
        dateHeureDebut: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
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

  async getProcedureCountsToday(serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const rows = await this.prisma.rendezVous.findMany({
      where: {
        serviceId,
        dateHeureDebut: {
          gte: startOfDay,
          lte: endOfDay,
        },
        prescription: {
          isNot: null,
        },
      },
      select: {
        prescription: {
          select: {
            typeExamen: true,
          },
        },
      },
    });

    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      const type = row.prescription?.typeExamen || 'Non spécifié';
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts)
      .map(([procedure, count]) => ({ procedure, count }))
      .sort((a, b) => b.count - a.count || a.procedure.localeCompare(b.procedure));
  }

  async getChecklistsProgressToday(serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const rows = await this.prisma.rendezVous.findMany({
      where: {
        serviceId,
        dateHeureDebut: {
          gte: startOfDay,
          lte: endOfDay,
        },
        prescription: {
          isNot: null,
        },
      },
      select: {
        prescription: {
          select: {
            checklistAvant: { select: { estValide: true } },
            checklistApres: { select: { estValide: true } },
          },
        },
      },
    });

    const avantTotal = rows.length;
    const avantValide = rows.filter((row) => row.prescription?.checklistAvant?.estValide).length;
    const apresTotal = rows.length;
    const apresValide = rows.filter((row) => row.prescription?.checklistApres?.estValide).length;

    return { avantTotal, avantValide, apresTotal, apresValide };
  }

  async getRendezVousCountsByMonth(year: number, month: number, serviceIdOverride?: string) {
    // Get start and end of month in UTC
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    // Get all rendez-vous for the month
    const rendezVous = await this.prisma.rendezVous.findMany({
      where: {
        ...this.scope(serviceIdOverride),
        dateHeureDebut: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      select: {
        dateHeureDebut: true,
      },
    });

    // Group by date (YYYY-MM-DD) and count
    const countsByDate: Record<string, number> = {};
    rendezVous.forEach((rv) => {
      const dateStr = rv.dateHeureDebut.toISOString().split('T')[0];
      countsByDate[dateStr] = (countsByDate[dateStr] || 0) + 1;
    });

    // Convert to array of {date, count}
    return Object.entries(countsByDate).map(([date, count]) => ({ date, count }));
  }

  async getSalles(serviceIdOverride?: string) {
    return this.prisma.salle.findMany({
      where: this.scope(serviceIdOverride),
    });
  }

  async createRendezVous(data: any) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    const dateHeureDebut = new Date(data.dateHeureDebut);
    const dateHeureFin = data.dateHeureFin ? new Date(data.dateHeureFin) : null;

    const rendezVousPayload = {
      serviceId,
      patientId: data.patientId || null,
      prescriptionId: data.prescriptionId || null,
      medecinId: data.medecinId || null,
      salleId: data.salleId || null,
      dateHeureDebut,
      dateHeureFin,
      typeAnesthesie: data.typeAnesthesie || null,
      statut: data.statut || 'Prevu',
      notesCliniques: data.notesCliniques || null,
    };

    try {
      if (data.prescriptionId) {
        // Cas 1: Mise à jour via prescriptionId (UPSERT)
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

      // Cas 2: Création sans prescriptionId - vérifier les doublons
      // Éviter les doublons basés sur: salle + horaire
      if (data.salleId) {
        const existingConflict = await this.prisma.rendezVous.findFirst({
          where: {
            serviceId,
            salleId: data.salleId,
            dateHeureDebut: {
              lte: dateHeureFin || new Date(dateHeureDebut.getTime() + 45 * 60000),
            },
            dateHeureFin: {
              gte: dateHeureDebut,
            },
            // Exclure les rendez-vous annulés/terminés
            NOT: {
              statut: { in: ['Annulé', 'Terminé'] },
            },
          },
        });

        if (existingConflict) {
          throw new BadRequestException(
            `Conflit d'horaire: Une autre réservation existe pour cette salle à cette heure.`,
          );
        }
      }

      // Éviter les doublons pour le même patient avec prescriptionId (doublon accidentel)
      if (data.patientId && data.prescriptionId === undefined) {
        const existingForPatient = await this.prisma.rendezVous.findFirst({
          where: {
            serviceId,
            patientId: data.patientId,
            dateHeureDebut: {
              lte: new Date(dateHeureDebut.getTime() + 60 * 60000), // même heure
              gte: new Date(dateHeureDebut.getTime() - 60 * 60000),
            },
            NOT: {
              statut: { in: ['Annulé', 'Terminé'] },
            },
          },
        });

        if (existingForPatient) {
          throw new BadRequestException(
            `Un rendez-vous existe déjà pour ce patient à cette heure.`,
          );
        }
      }

      return await this.prisma.rendezVous.create({
        data: rendezVousPayload,
        include: {
          patient: true,
          medecin: true,
          salle: true,
          prescription: true,
        },
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

  async getOperation(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    return this.prisma.operationEndoscopie.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: { patient: true },
    });
  }

  async saveOperation(data: any) {
    if (!data.prescriptionId) {
      throw new Error(
        'prescriptionId est obligatoire pour enregistrer les notes d\'opération',
      );
    }

    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    const operationData = {
      medicalNotes: data.medicalNotes || '',
      voiceTranscripts: data.voiceTranscripts || [],
    };

    return this.prisma.operationEndoscopie.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: operationData,
      create: {
        ...operationData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });
  }

  async getChecklistApres(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    return this.prisma.checklistApres.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: { patient: true },
    });
  }

  async saveChecklistApres(data: any) {
    if (!data.prescriptionId) {
      throw new Error('prescriptionId est obligatoire pour la checklist après endoscopie');
    }

    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    const checklistData = {
      confirmationEtiquetage: data.confirmationEtiquetage,
      prescriptionsPostActe: data.prescriptionsPostActe,
      remarques: data.remarques,
      estValide: data.estValide || false,
    };

    return this.prisma.checklistApres.upsert({
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

  async getResultat(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    return this.prisma.resultatEndoscopie.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: { patient: true },
    });
  }

  async saveResultat(data: any) {
    if (!data.prescriptionId) {
      throw new Error('prescriptionId est obligatoire pour enregistrer les résultats');
    }

    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    const resultatData = {
      reportText: data.reportText,
      mainDiagnosis: data.mainDiagnosis,
      observations: data.observations,
      conclusion: data.conclusion,
      complication: data.complication,
      biopsy: data.biopsy,
      followUp: data.followUp,
      doctorName: data.doctorName,
    };

    return this.prisma.resultatEndoscopie.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: resultatData,
      create: {
        ...resultatData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });
  }

  async listResultats(serviceIdOverride?: string) {
    return this.prisma.resultatEndoscopie.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        patient: true,
        prescription: true,
      },
      orderBy: { dateCreation: 'desc' },
    });
  }

  listNotifications(status = 'ENVOYE', serviceId?: string) {
    return this.notificationService.listNotifications(status, serviceId);
  }

  createNotification(payload: CreateNotificationPayload) {
    return this.notificationService.createNotification(payload);
  }

  getNotificationHealth() {
    return this.notificationService.checkHealth().then((health) => ({
      notificationApiUrl: getNotificationApiUrl(),
      webhookReceiveUrl: getNotificationWebhookUrl(),
      endoscopieServiceId: getEndoscopieServiceId(),
      ...health,
    }));
  }

  async saveConfirmationPlanification(data: any) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    // Upsert le patient avec les infos du front
    const detailsPrescription = data.detailsPrescription;
    const patientId = detailsPrescription.patient.id || randomUUID();
    const patient = await this.prisma.patient.upsert({
      where: { id: patientId },
      create: {
        id: patientId,
        nom: detailsPrescription.patient.nom,
        prenom: detailsPrescription.patient.prenoms || '',
        dateNaissance: detailsPrescription.patient.dateNaissance
          ? new Date(detailsPrescription.patient.dateNaissance)
          : null,
        sexe: detailsPrescription.patient.genre === 'Masculin' ? 'M' : 'F',
      },
      update: {
        nom: detailsPrescription.patient.nom,
        prenom: detailsPrescription.patient.prenoms || '',
        dateNaissance: detailsPrescription.patient.dateNaissance
          ? new Date(detailsPrescription.patient.dateNaissance)
          : null,
        sexe: detailsPrescription.patient.genre === 'Masculin' ? 'M' : 'F',
      },
    });

    const prescriptionId = detailsPrescription.numeroPrescription || randomUUID();
    const prescription = await this.prisma.prescription.upsert({
      where: {
        id: prescriptionId,
      },
      create: {
        id: prescriptionId,
        patientId: patient.id,
        medecinId: 'system',
        typeExamen: detailsPrescription.typeExamen,
        motif: detailsPrescription.indicationClinique,
        priorite: detailsPrescription.degreeUrgence,
        statut: detailsPrescription.statut,
        dateDemande: new Date(detailsPrescription.datePrescription),
        serviceId,
      },
      update: {
        typeExamen: detailsPrescription.typeExamen,
        motif: detailsPrescription.indicationClinique,
        priorite: detailsPrescription.degreeUrgence,
        statut: detailsPrescription.statut,
      },
    });

    // Créer/Mettre à jour le rendez-vous
    const rendezVous = data.rendezVous;
    const dateHeureDebut = new Date(`${rendezVous.date}T${rendezVous.heure}`);

    const rdv = await this.prisma.rendezVous.upsert({
      where: {
        prescriptionId: prescription.id,
      },
      create: {
        id: randomUUID(),
        prescriptionId: prescription.id,
        patientId: patient.id,
        dateHeureDebut,
        typeAnesthesie: data.typeAnesthesie?.type || null,
        notesCliniques: rendezVous.instructionsPatient,
        statut: rendezVous.confirmeParAdmin ? 'Confirme' : 'Prevu',
        serviceId,
      },
      update: {
        dateHeureDebut,
        typeAnesthesie: data.typeAnesthesie?.type || null,
        notesCliniques: rendezVous.instructionsPatient,
        statut: rendezVous.confirmeParAdmin ? 'Confirme' : 'Prevu',
      },
    });

    // Mettre à jour le dossier CPA si type anesthésie général
    if (data.typeAnesthesie?.type === 'anesthesie_generale') {
      await this.prisma.dossierCPA.upsert({
        where: {
          prescriptionId: prescription.id,
        },
        create: {
          id: randomUUID(),
          prescriptionId: prescription.id,
          patientId: patient.id,
          typeAnesthesie: 'anesthesie_generale',
          observations: `Sédation IV - Médecin anesthésiste requis. ${data.typeAnesthesie?.remarque || ''}`,
          statut: 'Brouillon',
          serviceId,
        },
        update: {
          typeAnesthesie: 'anesthesie_generale',
          observations: `Sédation IV - Médecin anesthésiste requis. ${data.typeAnesthesie?.remarque || ''}`,
        },
      });
    }

    return {
      success: true,
      prescription,
      patient,
      rendezVous: rdv,
      confirmationMessage: 'Confirmation de planification enregistrée avec succès',
    };
  }

  async listConfirmationsPlanification(serviceIdOverride?: string) {
    return this.prisma.prescription.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        patient: true,
        medecinPrescripteur: true,
        rendezVous: true,
        dossierCPA: true,
      },
      orderBy: { dateDemande: 'desc' },
    });
  }

  async getConfirmationPlanification(prescriptionId: string, serviceIdOverride?: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, ...this.scope(serviceIdOverride) },
      include: {
        patient: true,
        medecinPrescripteur: true,
        rendezVous: true,
        dossierCPA: true,
      },
    });

    if (!prescription) {
      throw new NotFoundException(`Confirmation pour prescription ${prescriptionId} introuvable`);
    }

    // Transformer en format frontend
    return {
      detailsPrescription: {
        numeroPrescription: prescription.id,
        datePrescription: prescription.dateDemande?.toISOString().split('T')[0],
        prescripteur: prescription.medecinPrescripteur
          ? `Dr. ${prescription.medecinPrescripteur.prenom} ${prescription.medecinPrescripteur.nom}`
          : 'Médecin Inconnu',
        patient: {
          nom: prescription.patient.nom,
          prenoms: prescription.patient.prenom,
          dateNaissance: prescription.patient.dateNaissance?.toISOString().split('T')[0],
          age: prescription.patient.dateNaissance
            ? Math.floor((Date.now() - prescription.patient.dateNaissance.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 0,
          genre: prescription.patient.sexe === 'M' ? 'Masculin' : 'Féminin',
        },
        typeExamen: prescription.typeExamen,
        degreeUrgence: prescription.priorite as any,
        indicationClinique: prescription.motif || '',
        serviceDemandeur: 'Endoscopie',
        observations: prescription.rendezVous?.notesCliniques,
        statut: prescription.statut as any,
      },
      rendezVous: prescription.rendezVous
        ? {
            date: prescription.rendezVous.dateHeureDebut.toISOString().split('T')[0],
            heure: prescription.rendezVous.dateHeureDebut.toISOString().split('T')[1].substring(0, 5),
            salle: 'Salle réservée',
            hopital: 'CHU',
            operateurAssigne: prescription.medecinPrescripteur
              ? `Dr. ${prescription.medecinPrescripteur.prenom} ${prescription.medecinPrescripteur.nom}`
              : 'A assigner',
            dureeEstimee: '30 minutes',
            instructionsPatient: prescription.rendezVous.notesCliniques || '',
            confirmeParAdmin: prescription.rendezVous.statut === 'Confirme',
            confirmeParAdminLe: prescription.rendezVous.dateHeureDebut?.toISOString(),
          }
        : null,
      typeAnesthesie: prescription.dossierCPA?.typeAnesthesie
        ? {
            type: prescription.dossierCPA.typeAnesthesie,
            description:
              prescription.dossierCPA.typeAnesthesie === 'anesthesie_generale'
                ? 'Sédation IV — médecin anesthésiste requis'
                : 'Spray lidocaïne / gel',
            medecinAnesthesisteRequis: prescription.dossierCPA.typeAnesthesie === 'anesthesie_generale',
            remarque: prescription.dossierCPA.observations,
          }
        : null,
    };
  }
}
