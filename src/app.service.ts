import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  getAccueilApiUrl,
  getChuApiUrl,
  getEndoscopieChuId,
  getEndoscopieServiceId,
} from './config/endoscopie-service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { CreateMedecinDto } from './dto/create-medecin.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { UpdateRendezVousDto } from './dto/update-rendezvous.dto';
import { NotificationService } from './notification/notification.service';
import {
  getNotificationApiUrl,
  getNotificationWebhookUrl,
} from './config/notification-service';
import { CreateNotificationPayload } from './notification/notification.types';

interface AccueilPatientRaw {
  id: string;
  nom: string;
  prenom?: string | null;
  sexe?: 'MALE' | 'FEMALE' | string | null;
  dateNaissance?: string | null;
  cin?: string | null;
  profession?: string | null;
  adresse?: string | null;
  telephone?: string | null;
  contactUrgence?: string | null;
  priseEnChargeId?: string | null;
}

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
      const [medecins, prescriptions] = await Promise.all([
        this.prisma.medecin.count(),
        this.prisma.prescription.count(),
      ]);
      return {
        ok: true,
        database: 'connected',
        hasServiceIdColumn: columns.length > 0,
        endoscopieServiceId: this.getEndoscopieServiceId(),
        counts: { medecins, prescriptions },
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
    const prescriptions = await this.prisma.prescription.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        medecinPrescripteur: true,
        rendezVous: true,
        checklistApres: true,
      },
      orderBy: {
        dateDemande: 'desc',
      },
    });
    return this.attachPatients(prescriptions);
  }

  /** Prescriptions dont l'examen est terminé (checklist après validée) mais sans compte-rendu enregistré. */
  async getPendingReports(serviceIdOverride?: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        ...this.scope(serviceIdOverride),
        checklistApres: { estValide: true },
        resultatEndoscopie: null,
      },
      include: {
        medecinPrescripteur: true,
        rendezVous: true,
        checklistApres: true,
      },
      orderBy: {
        dateDemande: 'desc',
      },
    });
    return this.attachPatients(prescriptions);
  }

  async getPrescriptionById(id: string, serviceIdOverride?: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id, ...this.scope(serviceIdOverride) },
      include: {
        medecinPrescripteur: true,
        dossierCPA: { include: { anesthesiste: true } },
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
        rendezVous: { include: { salle: true } },
      },
    });
    if (!prescription) {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
    return this.attachPatient(prescription);
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
      },
      include: {
        medecinPrescripteur: true,
        dossierCPA: true,
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
      },
      orderBy: { dateDemande: 'desc' },
    });

    const withPatient = await this.attachPatients(prescriptions);
    const filtered = filters.nom
      ? withPatient.filter((p) => {
          const needle = filters.nom!.toLowerCase();
          return (
            p.patient?.nom.toLowerCase().includes(needle) ||
            p.patient?.prenom.toLowerCase().includes(needle)
          );
        })
      : withPatient;

    return filtered.map((p) => {
      const checklistAvantValide = !!p.checklistAvant?.estValide;
      const checklistApresValide = !!p.checklistApres?.estValide;
      const resultatDisponible = !!p.resultatEndoscopie;
      return {
        prescriptionId: p.id,
        patientId: p.patientId,
        patientNom: p.patient?.nom ?? 'INCONNU',
        patientPrenom: p.patient?.prenom ?? '',
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

  /** Liste complète des patients du CHU, en direct depuis l'API Accueil (jamais persistée localement). */
  private async getAccueilPatients(): Promise<AccueilPatientRaw[]> {
    try {
      const url = `${getAccueilApiUrl()}/accueil/patients?chuId=${getEndoscopieChuId()}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      return (await res.json()) as AccueilPatientRaw[];
    } catch {
      return [];
    }
  }

  /** Un seul patient, en direct depuis l'API Accueil par son id. */
  private async getAccueilPatient(
    patientId: string,
  ): Promise<AccueilPatientRaw | null> {
    try {
      const url = `${getAccueilApiUrl()}/accueil/patients/${encodeURIComponent(patientId)}?chuId=${getEndoscopieChuId()}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as AccueilPatientRaw;
    } catch {
      return null;
    }
  }

  private toPatientView(raw: AccueilPatientRaw) {
    return {
      id: raw.id,
      nom: raw.nom,
      prenom: raw.prenom || '',
      dateNaissance: raw.dateNaissance ? new Date(raw.dateNaissance) : null,
      sexe: raw.sexe === 'FEMALE' ? 'F' : raw.sexe === 'MALE' ? 'M' : null,
      cin: raw.cin || null,
      profession: raw.profession || null,
      adresse: raw.adresse || null,
      telephone: raw.telephone || null,
      contactUrgence: raw.contactUrgence || null,
      priseEnChargeId: raw.priseEnChargeId || null,
    };
  }

  /** Attache la fiche patient (Accueil, en direct) à une seule ligne via son patientId. */
  private async attachPatient<T extends { patientId?: string | null }>(
    row: T,
  ) {
    const raw = row.patientId
      ? await this.getAccueilPatient(row.patientId)
      : null;
    return { ...row, patient: raw ? this.toPatientView(raw) : null };
  }

  /** Attache la fiche patient (Accueil, en direct) à une liste de lignes en un seul appel groupé. */
  private async attachPatients<T extends { patientId?: string | null }>(
    rows: T[],
  ) {
    if (rows.length === 0) return rows.map((r) => ({ ...r, patient: null }));
    const all = await this.getAccueilPatients();
    const map = new Map(all.map((p) => [p.id, this.toPatientView(p)]));
    return rows.map((r) => ({
      ...r,
      patient: r.patientId ? map.get(r.patientId) ?? null : null,
    }));
  }

  async createPrescription(data: CreatePrescriptionDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    if (!data.patientId?.trim() || !data.medecinId?.trim()) {
      throw new BadRequestException('patientId et medecinId sont obligatoires');
    }
    if (!data.typeExamen?.trim()) {
      throw new BadRequestException('typeExamen est obligatoire');
    }

    // Le patient doit exister dans le registre Accueil — on ne fabrique plus
    // de placeholder local, on consomme Accueil en direct.
    const accueilPatient = await this.getAccueilPatient(data.patientId);
    if (!accueilPatient) {
      throw new BadRequestException(
        `Patient ${data.patientId} introuvable dans le registre Accueil`,
      );
    }

    await this.prisma.medecin.upsert({
      where: { id: data.medecinId },
      update: {},
      create: {
        id: data.medecinId,
        nom: 'INCONNU',
        prenom: 'MEDECIN',
        specialite: null,
        role: null,
      },
    });

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
          medecinPrescripteur: true,
        },
      });

      const enriched = {
        ...prescription,
        patient: this.toPatientView(accueilPatient),
      };

      await this.notificationService.notifyPrescriptionCreated(enriched);

      return enriched;
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
      const updated = await this.prisma.prescription.update({
        where: { id },
        data: {
          ...(data.statut !== undefined && { statut: data.statut }),
          ...(data.priorite !== undefined && { priorite: data.priorite }),
          ...(data.typeExamen !== undefined && { typeExamen: data.typeExamen }),
          ...(data.motif !== undefined && { motif: data.motif }),
        },
        include: {
          medecinPrescripteur: true,
        },
      });
      return this.attachPatient(updated);
    } catch {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
  }

  async getPatients() {
    const patients = await this.getAccueilPatients();
    return patients
      .map((p) => this.toPatientView(p))
      .sort(
        (a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom),
      );
  }

  async getPatientById(id: string, serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const accueilPatient = await this.getAccueilPatient(id);
    if (!accueilPatient) {
      throw new NotFoundException(`Patient ${id} introuvable`);
    }

    const [prescriptions, rendezVous, dossiersCPA] = await Promise.all([
      this.prisma.prescription.findMany({
        where: { patientId: id, serviceId },
        include: { medecinPrescripteur: true },
        orderBy: { dateDemande: 'desc' },
      }),
      this.prisma.rendezVous.findMany({ where: { patientId: id, serviceId } }),
      this.prisma.dossierCPA.findMany({ where: { patientId: id, serviceId } }),
    ]);

    let priseEnCharge: Record<string, unknown> | null = null;
    if (accueilPatient.priseEnChargeId) {
      try {
        const res = await fetch(
          `${getChuApiUrl()}/service-chu/prise-en-charge/${encodeURIComponent(accueilPatient.priseEnChargeId)}`,
        );
        if (res.ok) {
          priseEnCharge = (await res.json()) as Record<string, unknown>;
        }
      } catch {
        priseEnCharge = null;
      }
    }

    return {
      ...this.toPatientView(accueilPatient),
      prescriptions,
      rendezVous,
      dossiersCPA,
      priseEnCharge,
    };
  }

  async getExamTypes() {
    return this.prisma.endoscopyExamType.findMany({
      orderBy: { name: 'asc' },
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
    const dossiers = await this.prisma.dossierCPA.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        prescription: true,
        anesthesiste: true,
      },
      orderBy: { id: 'desc' },
    });
    return this.attachPatients(dossiers);
  }

  async getDossierCpaById(id: string, serviceIdOverride?: string) {
    const dossier = await this.prisma.dossierCPA.findFirst({
      where: { id, ...this.scope(serviceIdOverride) },
      include: {
        prescription: true,
        anesthesiste: true,
      },
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
    return this.attachPatient(dossier);
  }

  async getDossierCpaByPrescriptionId(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    const dossier = await this.prisma.dossierCPA.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: {
        prescription: true,
        anesthesiste: true,
      },
    });
    return dossier ? this.attachPatient(dossier) : null;
  }

  async createDossierCpa(data: CreateDossierCpaDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    const dossier = await this.prisma.dossierCPA.create({
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
        prescription: true,
        anesthesiste: true,
      },
    });

    if (data.prescriptionId) {
      await this.prisma.rendezVous.updateMany({
        where: { prescriptionId: data.prescriptionId, serviceId },
        data: { statut: 'CPA demandée' },
      });
      await this.prisma.prescription.updateMany({
        where: { id: data.prescriptionId, serviceId },
        data: { statut: 'CPA demandée' },
      });
    }

    return this.attachPatient(dossier);
  }

  async updateDossierCpa(
    id: string,
    data: UpdateDossierCpaDto,
    serviceIdOverride?: string,
  ) {
    await this.getDossierCpaById(id, serviceIdOverride);
    try {
      const updated = await this.prisma.dossierCPA.update({
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
          prescription: true,
          anesthesiste: true,
        },
      });
      return this.attachPatient(updated);
    } catch {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
  }

  async getRendezVous(serviceIdOverride?: string) {
    const rendezVous = await this.prisma.rendezVous.findMany({
      where: this.scope(serviceIdOverride),
      include: {
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
    return this.attachPatients(rendezVous);
  }

  async getRendezVousJour(date: string, serviceIdOverride?: string) {
    // Parse date format YYYY-MM-DD and get start/end of day
    const dateObj = new Date(`${date}T00:00:00Z`);
    const startOfDay = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 0, 0, 0));
    const endOfDay = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 23, 59, 59));

    const rendezVous = await this.prisma.rendezVous.findMany({
      where: {
        ...this.scope(serviceIdOverride),
        dateHeureDebut: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
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
    return this.attachPatients(rendezVous);
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

    if (!data.dateHeureDebut) {
      throw new BadRequestException('dateHeureDebut est obligatoire');
    }
    const dateHeureDebut = new Date(data.dateHeureDebut);
    if (Number.isNaN(dateHeureDebut.getTime())) {
      throw new BadRequestException('dateHeureDebut est invalide');
    }
    if (data.dateHeureFin) {
      const explicitEnd = new Date(data.dateHeureFin);
      if (Number.isNaN(explicitEnd.getTime())) {
        throw new BadRequestException('dateHeureFin est invalide');
      }
      if (explicitEnd <= dateHeureDebut) {
        throw new BadRequestException(
          "L'heure de fin doit être postérieure à l'heure de début.",
        );
      }
    }
    if (dateHeureDebut.getTime() < Date.now()) {
      throw new BadRequestException(
        'Impossible de planifier un rendez-vous dans le passé.',
      );
    }
    // Toujours stocker une heure de fin concrète (45 min par défaut) pour que
    // les futures vérifications de collision restent fiables.
    const dateHeureFin = data.dateHeureFin
      ? new Date(data.dateHeureFin)
      : new Date(dateHeureDebut.getTime() + 45 * 60000);

    if (data.salleId) {
      const salle = await this.prisma.salle.findUnique({ where: { id: data.salleId } });
      if (!salle) {
        throw new BadRequestException(`Salle ${data.salleId} introuvable`);
      }
      if (!salle.estActive) {
        throw new BadRequestException(`La salle "${salle.nom}" n'est plus active.`);
      }
    }

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

    // Chevauchement de créneau : [dateHeureDebut, dateHeureFin) contre les RDV existants,
    // en excluant le RDV qu'on est en train de replanifier (même prescriptionId) et les
    // rendez-vous annulés/terminés.
    const overlapWhere = (extra: Record<string, unknown>) => ({
      serviceId,
      ...extra,
      ...(data.prescriptionId ? { prescriptionId: { not: data.prescriptionId } } : {}),
      dateHeureDebut: { lt: dateHeureFin },
      dateHeureFin: { gt: dateHeureDebut },
      NOT: { statut: { in: ['Annulé', 'Terminé'] } },
    });

    try {
      if (data.salleId) {
        const existingConflict = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ salleId: data.salleId }),
        });
        if (existingConflict) {
          throw new BadRequestException(
            `Conflit d'horaire : cette salle est déjà réservée sur ce créneau.`,
          );
        }
      }

      if (data.medecinId) {
        const existingForMedecin = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ medecinId: data.medecinId }),
        });
        if (existingForMedecin) {
          throw new BadRequestException(
            `Ce médecin a déjà un rendez-vous sur ce créneau.`,
          );
        }
      }

      if (data.patientId) {
        const existingForPatient = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ patientId: data.patientId }),
        });
        if (existingForPatient) {
          throw new BadRequestException(
            `Ce patient a déjà un rendez-vous sur ce créneau.`,
          );
        }
      }

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

      const created = await this.prisma.rendezVous.create({
        data: rendezVousPayload,
        include: {
          medecin: true,
          salle: true,
          prescription: true,
        },
      });
      return this.attachPatient(created);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erreur lors de la création du rendez-vous:', error);
      throw error;
    }
  }

  async updateRendezVous(
    id: string,
    data: UpdateRendezVousDto,
    serviceIdOverride?: string,
  ) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const existing = await this.prisma.rendezVous.findFirst({
      where: { id, serviceId },
    });
    if (!existing) {
      throw new NotFoundException(`Rendez-vous ${id} introuvable`);
    }

    const reschedule = data.dateHeureDebut !== undefined || data.dateHeureFin !== undefined;
    let newDebut = existing.dateHeureDebut;
    let newFin = existing.dateHeureFin;

    if (reschedule) {
      if (data.dateHeureDebut !== undefined) {
        newDebut = new Date(data.dateHeureDebut);
        if (Number.isNaN(newDebut.getTime())) {
          throw new BadRequestException('dateHeureDebut est invalide');
        }
      }
      if (data.dateHeureFin !== undefined) {
        newFin = data.dateHeureFin ? new Date(data.dateHeureFin) : null;
        if (newFin && Number.isNaN(newFin.getTime())) {
          throw new BadRequestException('dateHeureFin est invalide');
        }
      }
      if (!newFin) {
        newFin = new Date(newDebut.getTime() + 45 * 60000);
      }
      if (newFin <= newDebut) {
        throw new BadRequestException(
          "L'heure de fin doit être postérieure à l'heure de début.",
        );
      }
      if (newDebut.getTime() < Date.now()) {
        throw new BadRequestException(
          'Impossible de planifier un rendez-vous dans le passé.',
        );
      }

      const overlapWhere = (extra: Record<string, unknown>) => ({
        serviceId,
        ...extra,
        id: { not: id },
        dateHeureDebut: { lt: newFin as Date },
        dateHeureFin: { gt: newDebut },
        NOT: { statut: { in: ['Annulé', 'Terminé'] } },
      });

      if (existing.salleId) {
        const conflict = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ salleId: existing.salleId }),
        });
        if (conflict) {
          throw new BadRequestException(
            `Conflit d'horaire : cette salle est déjà réservée sur ce créneau.`,
          );
        }
      }
      if (existing.medecinId) {
        const conflict = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ medecinId: existing.medecinId }),
        });
        if (conflict) {
          throw new BadRequestException(
            `Ce médecin a déjà un rendez-vous sur ce créneau.`,
          );
        }
      }
      if (existing.patientId) {
        const conflict = await this.prisma.rendezVous.findFirst({
          where: overlapWhere({ patientId: existing.patientId }),
        });
        if (conflict) {
          throw new BadRequestException(
            `Ce patient a déjà un rendez-vous sur ce créneau.`,
          );
        }
      }
    }

    const updated = await this.prisma.rendezVous.update({
      where: { id },
      data: {
        ...(data.typeAnesthesie !== undefined && {
          typeAnesthesie: data.typeAnesthesie,
        }),
        ...(data.statut !== undefined && { statut: data.statut }),
        ...(data.notesCliniques !== undefined && {
          notesCliniques: data.notesCliniques,
        }),
        ...(data.dateHeureDebut !== undefined && { dateHeureDebut: newDebut }),
        ...(data.dateHeureFin !== undefined && { dateHeureFin: newFin }),
      },
      include: {
        medecin: true,
        salle: true,
        prescription: true,
      },
    });

    // Reflète l'étape de la décision d'anesthésie sur la prescription elle-même,
    // pour qu'elle réapparaisse au bon statut dans le Fil de prescription du Major.
    const CASCADE_STATUTS = ['Décision rendue', 'Confirmé'];
    if (
      existing.prescriptionId &&
      data.statut !== undefined &&
      CASCADE_STATUTS.includes(data.statut)
    ) {
      await this.prisma.prescription.updateMany({
        where: { id: existing.prescriptionId, serviceId },
        data: { statut: data.statut },
      });
    }

    return this.attachPatient(updated);
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
    const checklist = await this.prisma.checklistAvant.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
    });
    return checklist ? this.attachPatient(checklist) : null;
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
    const operation = await this.prisma.operationEndoscopie.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
    });
    return operation ? this.attachPatient(operation) : null;
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
    const checklist = await this.prisma.checklistApres.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
    });
    return checklist ? this.attachPatient(checklist) : null;
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
    const resultat = await this.prisma.resultatEndoscopie.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
    });
    if (!resultat) return null;
    return this.attachPatient(resultat);
  }

  async saveResultat(data: any) {
    if (!data.prescriptionId) {
      throw new Error('prescriptionId est obligatoire pour enregistrer les résultats');
    }

    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    const {
      prescriptionId,
      patientId,
      serviceId: _serviceId,
      reportText,
      mainDiagnosis,
      observations,
      conclusion,
      complication,
      biopsy,
      followUp,
      doctorName,
      ...details
    } = data;

    const resultatData = {
      reportText,
      mainDiagnosis,
      observations,
      conclusion,
      complication,
      biopsy,
      followUp,
      doctorName,
      details: Object.keys(details).length ? details : undefined,
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
    const resultats = await this.prisma.resultatEndoscopie.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        prescription: true,
      },
      orderBy: { dateCreation: 'desc' },
    });
    return this.attachPatients(resultats);
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

    const detailsPrescription = data.detailsPrescription;
    const patientId = detailsPrescription.patient?.id;
    if (!patientId) {
      throw new BadRequestException(
        'detailsPrescription.patient.id est obligatoire',
      );
    }

    const prescriptionId = detailsPrescription.numeroPrescription || randomUUID();
    const prescription = await this.prisma.prescription.upsert({
      where: {
        id: prescriptionId,
      },
      create: {
        id: prescriptionId,
        patientId,
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
        patientId,
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
          patientId,
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
      patientId,
      rendezVous: rdv,
      confirmationMessage: 'Confirmation de planification enregistrée avec succès',
    };
  }

  async listConfirmationsPlanification(serviceIdOverride?: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        medecinPrescripteur: true,
        rendezVous: true,
        dossierCPA: true,
      },
      orderBy: { dateDemande: 'desc' },
    });
    return this.attachPatients(prescriptions);
  }

  async getConfirmationPlanification(prescriptionId: string, serviceIdOverride?: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, ...this.scope(serviceIdOverride) },
      include: {
        medecinPrescripteur: true,
        rendezVous: true,
        dossierCPA: true,
      },
    });

    if (!prescription) {
      throw new NotFoundException(`Confirmation pour prescription ${prescriptionId} introuvable`);
    }

    const accueilPatient = await this.getAccueilPatient(prescription.patientId);
    const patient = accueilPatient ? this.toPatientView(accueilPatient) : null;

    // Transformer en format frontend
    return {
      detailsPrescription: {
        numeroPrescription: prescription.id,
        datePrescription: prescription.dateDemande?.toISOString().split('T')[0],
        prescripteur: prescription.medecinPrescripteur
          ? `Dr. ${prescription.medecinPrescripteur.prenom} ${prescription.medecinPrescripteur.nom}`
          : 'Médecin Inconnu',
        patient: {
          nom: patient?.nom ?? 'INCONNU',
          prenoms: patient?.prenom ?? '',
          dateNaissance: patient?.dateNaissance?.toISOString().split('T')[0],
          age: patient?.dateNaissance
            ? Math.floor((Date.now() - patient.dateNaissance.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 0,
          genre: patient?.sexe === 'M' ? 'Masculin' : 'Féminin',
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
