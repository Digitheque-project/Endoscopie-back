import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import {
  getAccueilApiUrl,
  getBlocApiUrl,
  getChuApiUrl,
  getDossierPatientApiUrl,
  getEndoscopieChuId,
  getEndoscopieServiceId,
  getEndoscopieAuthChuId,
  getEndoscopieAuthServiceId,
  getPrescriptionExtApiUrl,
} from './config/endoscopie-service';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { UpdateRendezVousDto } from './dto/update-rendezvous.dto';
import { CreateNoteDossierDto } from './dto/create-note-dossier.dto';
import { parseDateTimeAsUtc } from './utils/datetime.util';
import { NotificationService } from './notification/notification.service';
import { NotificationInboxService } from './notification/notification-inbox.service';
import { ServiceSourceService } from './services/service-source.service';
import { MedecinsService } from './services/medecins.service';
import { CpaBlocService } from './services/cpa-bloc.service';
import { DossierPatientService } from './services/dossier-patient.service';
import { getCurrentUserToken } from './auth/request-context';

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

/**
 * Une prescription externe d'endoscopie peut regrouper PLUSIEURS demandes d'examen (ex:
 * Coloscopie + Fibroscopie sur une même prescription venant d'un autre service). Chaque
 * demande a son propre statut, mis à jour individuellement côté service externe.
 */
interface ExternalEndoscopieDemande {
  id: string;
  prescriptionId: string;
  typeExamen: string;
  autreExamen?: string | null;
  statut?: string | null;
  motifRefus?: string | null;
  createdAt?: string | null;
}

interface ExternalEndoscopiePrescription {
  id: string;
  patientId: string;
  prescripteurId: string;
  renseignements?: string | null;
  urgence?: 'NORMAL' | 'URGENT' | 'TRES_URGENT' | null;
  alertes?: string | null;
  remarques?: string | null;
  chuId?: string | null;
  serviceIdSource?: string | null;
  serviceIdDest?: string | null;
  createdAt?: string | null;
  demandes?: ExternalEndoscopieDemande[];
  // Rétrocompatibilité : certaines réponses peuvent renvoyer un examen unique à plat,
  // sans tableau `demandes`.
  typeExamen?: string | null;
  statut?: string | null;
}

/**
 * Une "demande" aplatie, prête à être traitée comme une prescription unique (un examen =
 * une prescription = un rendez-vous = un compte-rendu). Chaque demande d'une prescription
 * à examens multiples devient un élément distinct de cette liste, avec demande.id comme
 * identifiant externe.
 */
type FlatExternalDemande = {
  id: string;
  patientId: string;
  prescripteurId: string;
  typeExamen: string;
  renseignements?: string | null;
  urgence?: string | null;
  alertes?: string | null;
  remarques?: string | null;
  chuId?: string | null;
  serviceIdSource?: string | null;
  serviceIdDest?: string | null;
  createdAt?: string | null;
  statut?: string | null;
  /** ID de la prescription externe parente (regroupe les demandes multiples). */
  prescriptionExternalId: string;
};

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);
  private accueilCache: { patients: AccueilPatientRaw[]; expiresAt: number } | null = null;

  /** IDs de demandes externes déjà vus — en mémoire uniquement, jamais persisté — pour ne
   *  notifier que les VRAIES nouvelles arrivées. Le service prescription externe n'expose
   *  aucun webhook pour nous prévenir lui-même (vérifié sur son Swagger) : le polling reste
   *  le seul moyen de détecter une nouvelle prescription. */
  private seenExternalPrescriptionIds: Set<string> | null = null;
  private prescriptionWatcherInterval: ReturnType<typeof setInterval> | null = null;
  private readonly PRESCRIPTION_WATCH_INTERVAL_MS = 3000;
  private isPollingPrescriptions = false;

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private notificationInboxService: NotificationInboxService,
    private serviceSourceService: ServiceSourceService,
    private medecinsService: MedecinsService,
    private cpaBlocService: CpaBlocService,
    private dossierPatientService: DossierPatientService,
  ) {}

  async onModuleInit() {
    // Amorce la liste des demandes déjà connues au démarrage, pour ne notifier que les
    // VRAIES nouvelles arrivées et éviter une salve de notifications pour tout ce qui
    // existait déjà avant le lancement du serveur.
    try {
      const existing = await this.fetchExternalPrescriptions();
      this.seenExternalPrescriptionIds = new Set(existing.map((p) => p.id).filter(Boolean));
    } catch (e) {
      this.seenExternalPrescriptionIds = new Set();
      this.logger.warn(`Amorçage du watcher de prescriptions échoué: ${e instanceof Error ? e.message : e}`);
    }

    this.prescriptionWatcherInterval = setInterval(
      () => this.pollForNewPrescriptions(),
      this.PRESCRIPTION_WATCH_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    if (this.prescriptionWatcherInterval) clearInterval(this.prescriptionWatcherInterval);
  }

  /**
   * Détecte les nouvelles prescriptions arrivées depuis le service externe et déclenche
   * une notification. Construit le contenu directement à partir des champs externes (+
   * résolution patient/médecin en direct) — n'appelle jamais getPrescriptionById, pour ne
   * créer aucune ligne locale tant que personne n'a réellement ouvert le dossier.
   */
  private async pollForNewPrescriptions() {
    if (!this.seenExternalPrescriptionIds) return;
    if (this.isPollingPrescriptions) return;
    this.isPollingPrescriptions = true;
    try {
      const current = await this.fetchExternalPrescriptions();
      const nouvelles = current.filter((p) => p.id && !this.seenExternalPrescriptionIds!.has(p.id));
      if (nouvelles.length === 0) return;

      const groups = new Map<string, typeof nouvelles>();
      for (const demande of nouvelles) {
        const key = demande.prescriptionExternalId || demande.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(demande);
      }

      for (const demandes of groups.values()) {
        for (const demande of demandes) {
          this.seenExternalPrescriptionIds.add(demande.id);
        }
        try {
          const withMedecin = await this.medecinsService.attachMedecins(
            demandes,
            'prescripteurId',
            'medecinPrescripteur',
          );
          const resolvedList = await this.attachPatients(withMedecin);
          await this.notificationService.notifyPrescriptionCreated(
            resolvedList.map((d) => ({
              id: d.id,
              patientId: d.patientId,
              typeExamen: d.typeExamen,
              motif: d.renseignements || d.remarques || null,
              patient: d.patient,
              medecinPrescripteur: d.medecinPrescripteur,
              // Date réelle de la demande côté service externe — pas l'instant de cette
              // détection, qui peut survenir bien après (redémarrage du serveur, voir
              // seenExternalPrescriptionIds) et laisserait sinon croire à tort à une
              // arrivée du jour même.
              createdAt: d.createdAt,
            })),
          );
        } catch (e) {
          this.logger.warn(
            `Notification échouée pour la nouvelle prescription ${demandes[0]?.id}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`Vérification des nouvelles prescriptions échouée: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.isPollingPrescriptions = false;
    }
  }

  /** Interroge le service prescription externe pour une paire serviceId/chuId donnée. */
  private async fetchExternalPrescriptionsFor(
    serviceId: string,
    chuId: string,
  ): Promise<ExternalEndoscopiePrescription[]> {
    try {
      const url = `${getPrescriptionExtApiUrl()}/endoscopie?serviceIdDest=${serviceId}&chuId=${chuId}`;
      const token = getCurrentUserToken() ?? (await this.medecinsService.getServiceAccountToken());
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as ExternalEndoscopiePrescription[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Récupère les prescriptions brutes d'endoscopie depuis le service externe. Interroge
   * toutes les combinaisons de nos ID service/CHU locaux et ceux de l'écosystème
   * d'authentification — en pratique, le service prescription tague ses prescriptions
   * avec des paires "mixtes", pas seulement les deux paires "propres".
   */
  private async fetchExternalPrescriptionsRaw(
    serviceIdOverride?: string,
  ): Promise<ExternalEndoscopiePrescription[]> {
    const primaryServiceId = this.getEndoscopieServiceId(serviceIdOverride);
    const primaryChuId = getEndoscopieChuId();
    const authServiceId = getEndoscopieAuthServiceId();
    const authChuId = getEndoscopieAuthChuId();

    const serviceIds = [...new Set([primaryServiceId, authServiceId].filter((v): v is string => Boolean(v)))];
    const chuIds = [...new Set([primaryChuId, authChuId].filter((v): v is string => Boolean(v)))];
    const pairs = serviceIds.flatMap((s) => chuIds.map((c) => [s, c] as const));

    const results = await Promise.all(pairs.map(([s, c]) => this.fetchExternalPrescriptionsFor(s, c)));
    const byId = new Map<string, ExternalEndoscopiePrescription>();
    for (const list of results) {
      for (const p of list) byId.set(p.id, p);
    }
    return [...byId.values()];
  }

  /**
   * Éclate chaque prescription externe en une liste plate de demandes — une prescription
   * à examens multiples (ex: Coloscopie + Fibroscopie) devient autant d'éléments distincts,
   * chacun traité comme une prescription unique.
   */
  private flattenExternalPrescriptions(
    prescriptions: ExternalEndoscopiePrescription[],
  ): FlatExternalDemande[] {
    const flat: FlatExternalDemande[] = [];
    for (const p of prescriptions) {
      if (p.demandes && p.demandes.length > 0) {
        for (const d of p.demandes) {
          flat.push({
            id: d.id,
            patientId: p.patientId,
            prescripteurId: p.prescripteurId,
            typeExamen: d.typeExamen || d.autreExamen || 'Endoscopie',
            renseignements: p.renseignements,
            urgence: p.urgence,
            alertes: p.alertes,
            remarques: p.remarques,
            chuId: p.chuId,
            serviceIdSource: p.serviceIdSource,
            serviceIdDest: p.serviceIdDest,
            createdAt: d.createdAt || p.createdAt,
            statut: d.statut,
            prescriptionExternalId: p.id,
          });
        }
      } else if (p.typeExamen) {
        flat.push({
          id: p.id,
          patientId: p.patientId,
          prescripteurId: p.prescripteurId,
          typeExamen: p.typeExamen,
          renseignements: p.renseignements,
          urgence: p.urgence,
          alertes: p.alertes,
          remarques: p.remarques,
          chuId: p.chuId,
          serviceIdSource: p.serviceIdSource,
          serviceIdDest: p.serviceIdDest,
          createdAt: p.createdAt,
          statut: p.statut,
          prescriptionExternalId: p.id,
        });
      }
    }
    return flat;
  }

  /** Récupère les demandes d'endoscopie externes, aplaties (une demande = une prescription). */
  private async fetchExternalPrescriptions(serviceIdOverride?: string): Promise<FlatExternalDemande[]> {
    const raw = await this.fetchExternalPrescriptionsRaw(serviceIdOverride);
    return this.flattenExternalPrescriptions(raw);
  }

  /** Mappe l'urgence externe (NORMAL/URGENT/TRES_URGENT) vers la priorité locale. */
  private mapUrgenceToPriorite(urgence?: string | null): string {
    const u = urgence?.trim().toUpperCase();
    if (u === 'STAT' || u === 'TRES_URGENT') return 'STAT';
    if (u === 'URGENTE' || u === 'URGENT') return 'Urgent';
    return 'Standard';
  }

  /** Mappe le statut externe (ex: "CREEE") vers le statut local ("A planifier"). */
  private mapExternalStatut(statut?: string | null): string {
    const s = (statut || '').toUpperCase();
    if (s === 'CREEE' || s === 'CREATED') return 'A planifier';
    if (s === 'EN_COURS' || s === 'IN_PROGRESS') return 'Planifié';
    if (s === 'COMPLETEE' || s === 'COMPLETED' || s === 'TERMINEE') return 'Confirmé';
    if (s === 'ANNULEE' || s === 'CANCELLED') return 'Annulé';
    if (['A planifier', 'Planifié', 'Décision rendue', 'Confirmé', 'CPA demandée'].includes(statut || '')) return statut!;
    return 'A planifier';
  }




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
      const prescriptions = await this.prisma.prescription.count();
      return {
        ok: true,
        database: 'connected',
        hasServiceIdColumn: columns.length > 0,
        endoscopieServiceId: this.getEndoscopieServiceId(),
        counts: { prescriptions },
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









  /** Valeurs distinctes de typeExamen réellement présentes en base (voir getArchives — filtre en égalité stricte). */
  async getArchiveTypesExamen(serviceIdOverride?: string): Promise<string[]> {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const rows = await this.prisma.prescription.findMany({
      // Même filtre que getArchives (statut Terminé uniquement) pour ne pas proposer un
      // type d'examen qui ne renverrait ensuite aucun résultat dans l'archive.
      where: { serviceId, statut: 'Terminé' },
      select: { typeExamen: true },
      distinct: ['typeExamen'],
      orderBy: { typeExamen: 'asc' },
    });
    return rows.map((r) => r.typeExamen).filter(Boolean);
  }

  async getArchives(
    filters: {
      nom?: string;
      dateFrom?: string;
      dateTo?: string;
      typeExamen?: string;
      typeAnesthesie?: string;
      motCle?: string;
    },
    serviceIdOverride?: string,
  ) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
    if (filters.dateTo) dateFilter.lte = parseDateTimeAsUtc(`${filters.dateTo}T23:59:59.999`);

    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        serviceId,
        // Seuls les examens Terminé (compte rendu enregistré, voir markTermineIfComplete)
        // apparaissent dans l'archive — un patient encore en cours n'y a pas sa place.
        statut: 'Terminé',
        ...(Object.keys(dateFilter).length ? { dateDemande: dateFilter } : {}),
      },
      include: {
        dossierCPA: true,
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
        rendezVous: true,
      },
      orderBy: { dateDemande: 'desc' },
    });

    const withMedecin = await this.medecinsService.attachMedecins(
      prescriptions,
      'medecinId',
      'medecinPrescripteur',
    );
    const withPatient = await this.attachPatients(withMedecin);

    let filtered = withPatient;
    if (filters.nom) {
      const needle = filters.nom.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.patient?.nom.toLowerCase().includes(needle) ||
          p.patient?.prenom.toLowerCase().includes(needle),
      );
    }
    if (filters.typeExamen) {
      filtered = filtered.filter((p) => p.typeExamen === filters.typeExamen);
    }
    if (filters.typeAnesthesie) {
      filtered = filtered.filter((p) => p.rendezVous?.typeAnesthesie === filters.typeAnesthesie);
    }
    if (filters.motCle) {
      const needle = filters.motCle.toLowerCase();
      filtered = filtered.filter((p) => {
        const r = p.resultatEndoscopie;
        if (!r) return false;
        const haystack = [r.reportText, r.mainDiagnosis, r.observations, r.conclusion, r.complication, r.biopsy, r.followUp, r.doctorName, r.details]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });
    }

    return filtered.map((p) => {
      const checklistAvantValide = !!p.checklistAvant?.estValide;
      const checklistApresValide = !!p.checklistApres?.estValide;
      const resultatDisponible = !!p.resultatEndoscopie;
      return {
        prescriptionId: p.id,
        patientId: p.patientId,
        patientNom: p.patient?.nom ?? 'INCONNU',
        patientPrenom: p.patient?.prenom ?? '',
        priseEnChargeId: p.patient?.priseEnChargeId ?? null,
        typeExamen: p.typeExamen,
        typeAnesthesie: p.rendezVous?.typeAnesthesie ?? null,
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
          p.statut === 'Annulé'
            ? 'Annulé'
            : p.statut === 'Terminé' || (checklistAvantValide && checklistApresValide && resultatDisponible)
            ? 'Complet'
            : 'En cours',
      };
    });
  }

  /** Interroge le registre Accueil pour un chuId donné. */
  private async fetchAccueilPatientsFor(chuId: string): Promise<AccueilPatientRaw[]> {
    try {
      const url = `${getAccueilApiUrl()}/accueil/patients?chuId=${chuId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      return (await res.json()) as AccueilPatientRaw[];
    } catch {
      return [];
    }
  }

  /**
   * Liste complète des patients du CHU (cache 60 s pour éviter les cold-start lents).
   * Comme pour les prescriptions, le registre Accueil tague les patients avec
   * ENDOSCOPIE_CHU_ID ou ENDOSCOPIE_AUTH_CHU_ID selon la source d'enregistrement —
   * on interroge les deux pour ne pas afficher "Patient inconnu" pour de vrais patients.
   */
  private async getAccueilPatients(): Promise<AccueilPatientRaw[]> {
    const now = Date.now();
    if (this.accueilCache && now < this.accueilCache.expiresAt) {
      return this.accueilCache.patients;
    }
    const primaryChuId = getEndoscopieChuId();
    const authChuId = getEndoscopieAuthChuId();
    const chuIds = authChuId && authChuId !== primaryChuId ? [primaryChuId, authChuId] : [primaryChuId];

    const results = await Promise.all(chuIds.map((id) => this.fetchAccueilPatientsFor(id)));
    const byId = new Map<string, AccueilPatientRaw>();
    for (const list of results) {
      for (const p of list) byId.set(p.id, p);
    }
    const patients = [...byId.values()];
    if (patients.length) {
      this.accueilCache = { patients, expiresAt: now + 60_000 };
      return patients;
    }
    return this.accueilCache?.patients ?? [];
  }

  /** Un seul patient, en direct depuis l'API Accueil par son id. */
  /** Interroge le registre Accueil pour un patient précis, sous un chuId donné. */
  private async fetchAccueilPatientFor(patientId: string, chuId: string): Promise<AccueilPatientRaw | null> {
    try {
      const url = `${getAccueilApiUrl()}/accueil/patients/${encodeURIComponent(patientId)}?chuId=${chuId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text) as AccueilPatientRaw;
    } catch {
      return null;
    }
  }

  /** Cf. getAccueilPatients — interroge les deux chuId possibles avant de conclure "introuvable". */
  private async getAccueilPatient(
    patientId: string,
  ): Promise<AccueilPatientRaw | null> {
    // Essai depuis le cache en premier
    if (this.accueilCache) {
      const cached = this.accueilCache.patients.find((p) => p.id === patientId);
      if (cached) return cached;
    }
    const primaryChuId = getEndoscopieChuId();
    const found = await this.fetchAccueilPatientFor(patientId, primaryChuId);
    if (found) return found;

    const authChuId = getEndoscopieAuthChuId();
    if (authChuId && authChuId !== primaryChuId) {
      return this.fetchAccueilPatientFor(patientId, authChuId);
    }
    return null;
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

    const [prescriptionsRaw, rendezVous, dossiersCPA] = await Promise.all([
      this.prisma.prescription.findMany({
        where: { patientId: id, serviceId },
        orderBy: { dateDemande: 'desc' },
      }),
      this.prisma.rendezVous.findMany({ where: { patientId: id, serviceId } }),
      this.prisma.dossierCPA.findMany({ where: { patientId: id, serviceId } }),
    ]);
    const prescriptions = await this.medecinsService.attachMedecins(
      prescriptionsRaw,
      'medecinId',
      'medecinPrescripteur',
    );

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

  /**
   * Liste en direct depuis le service prescription externe (source de vérité — voir
   * Prescription.externalId dans schema.prisma) : aucune écriture ici, uniquement une
   * fusion en mémoire avec l'état de workflow local déjà existant (rendez-vous,
   * checklists, résultat...) pour les prescriptions déjà ouvertes au moins une fois. Les
   * champs propres à la prescription (patient, médecin, motif, type d'examen, urgence)
   * viennent toujours de la réponse externe, jamais d'une copie locale — le service
   * externe reste seul responsable de ses propres données.
   */
  async getPrescriptions(serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const external = await this.fetchExternalPrescriptions(serviceIdOverride);
    const externalIds = external.map((e) => e.id);

    const localRecords = externalIds.length
      ? await this.prisma.prescription.findMany({
          where: { externalId: { in: externalIds } },
          include: { rendezVous: true, checklistApres: true, dossierCPA: true },
        })
      : [];
    const localByExtId = new Map(
      localRecords.filter((r) => r.externalId).map((r) => [r.externalId as string, r]),
    );

    const rows = external.map((ext) => {
      const local = localByExtId.get(ext.id);
      return {
        id: local?.id ?? ext.id,
        externalId: ext.id,
        prescriptionExternalId: ext.prescriptionExternalId ?? null,
        patientId: ext.patientId,
        medecinId: ext.prescripteurId ?? null,
        typeExamen: ext.typeExamen || 'Endoscopie',
        motif: ext.renseignements || ext.remarques || '',
        priorite: this.mapUrgenceToPriorite(ext.urgence),
        // Le statut est un état de workflow qui nous appartient une fois la prescription
        // ouverte localement — sinon, valeur de départ dérivée du statut externe.
        statut: local?.statut ?? this.mapExternalStatut(ext.statut),
        dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
        serviceId,
        rendezVous: local?.rendezVous ?? null,
        checklistApres: local?.checklistApres ?? null,
        dossierCPA: local?.dossierCPA ?? null,
      };
    });

    const withMedecin = await this.medecinsService.attachMedecins(
      rows,
      'medecinId',
      'medecinPrescripteur',
    );
    return this.attachPatients(withMedecin);
  }

  /**
   * Prescriptions sans compte-rendu enregistré, dès lors que :
   *  - la checklist après est validée (examen terminé normalement), OU
   *  - une opération a été commencée (panne électrique / interruption en cours).
   * Reconstruit à partir de getPrescriptions() (live) plutôt qu'une lecture locale brute,
   * pour rester cohérent avec le reste de l'architecture — seules operationEndoscopie et
   * resultatEndoscopie (absents de getPrescriptions, inutiles ailleurs) sont requêtés
   * séparément ici.
   */
  async getPendingReports(serviceIdOverride?: string) {
    const prescriptions = await this.getPrescriptions(serviceIdOverride);
    if (prescriptions.length === 0) return [];

    const ids = prescriptions.map((p) => p.id);
    const [withOperation, withResultat] = await Promise.all([
      this.prisma.operationEndoscopie.findMany({
        where: { prescriptionId: { in: ids } },
        select: { prescriptionId: true },
      }),
      this.prisma.resultatEndoscopie.findMany({
        where: { prescriptionId: { in: ids } },
        select: { prescriptionId: true },
      }),
    ]);
    const hasOperation = new Set(withOperation.map((o) => o.prescriptionId));
    const hasResultat = new Set(withResultat.map((r) => r.prescriptionId));

    return prescriptions
      .filter(
        (p) => !hasResultat.has(p.id) && (p.checklistApres?.estValide || hasOperation.has(p.id)),
      )
      .sort((a, b) => new Date(b.dateDemande).getTime() - new Date(a.dateDemande).getTime());
  }

  /**
   * Garantit qu'une ligne locale (ancrage minimal) existe pour cette prescription — id
   * local, externalId, ou id brut externe jamais encore ouvert — en la créant à la volée
   * si besoin. Réutilisé par getPrescriptionById et par tout point d'écriture (rendez-vous
   * notamment) qui a besoin d'un id local valide pour respecter la contrainte de clé
   * étrangère, même si le dossier n'a jamais été ouvert au préalable — sans quoi Prisma
   * lève une erreur de clé étrangère (P2003) en essayant de créer un enregistrement lié
   * à un id qui n'existe pas encore localement.
   */
  private async ensurePrescriptionAnchor(
    id: string,
    serviceIdOverride?: string,
    // Permet à un appelant qui résout plusieurs prescriptions d'affilée (voir
    // createRendezVousGroupe) de partager un seul pull externe au lieu d'en refaire un
    // complet par prescription — chaque pull interroge le service prescription pour
    // toutes les combinaisons serviceId/chuId, ce qui devient vite coûteux en série.
    preloadedExternal?: FlatExternalDemande[],
  ): Promise<{
    prescription: { id: string; externalId: string | null; serviceId: string };
    ext: FlatExternalDemande | null;
  }> {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);

    // Cherche par ID local OU par externalId — un lien direct vers un dossier déjà
    // travaillé peut arriver avec l'un ou l'autre selon l'endroit d'où il vient.
    let prescription = await this.prisma.prescription.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    });
    if (prescription && prescription.serviceId !== serviceId) {
      prescription = await this.prisma.prescription.update({
        where: { id: prescription.id },
        data: { serviceId },
      });
    }

    const external = preloadedExternal ?? (await this.fetchExternalPrescriptions(serviceIdOverride));
    const ext = external.find((e) => e.id === (prescription?.externalId ?? id)) ?? null;

    // Auto-réparation : une ligne ancrée avant que typeExamen soit renseigné à la
    // création (voir plus bas) est restée sur le générique "Endoscopie" — on la
    // corrige dès qu'on repasse par ici et que la vraie valeur externe est connue.
    if (prescription && ext?.typeExamen && prescription.typeExamen === 'Endoscopie' && ext.typeExamen !== 'Endoscopie') {
      prescription = await this.prisma.prescription.update({
        where: { id: prescription.id },
        data: { typeExamen: ext.typeExamen },
      });
    }

    if (!prescription) {
      if (!ext) throw new NotFoundException(`Prescription ${id} introuvable`);
      // Pas encore de dossier local pour cette prescription externe : on crée une ligne
      // minimale, uniquement pour servir d'ancrage à NOS propres données (rendez-vous,
      // checklists, compte-rendu). Elle n'est jamais resynchronisée ensuite — l'affichage
      // continue de préférer les données externes tant qu'elles sont disponibles.
      prescription = await this.prisma.prescription.create({
        data: {
          externalId: ext.id,
          prescriptionExternalId: ext.prescriptionExternalId ?? null,
          serviceId,
          patientId: ext.patientId,
          medecinId: ext.prescripteurId ?? '',
          // Snapshot pris une seule fois, à la création — jamais resynchronisé ensuite. Les
          // endpoints qui relisent la prescription en direct (getPrescriptions,
          // getPrescriptionById) continuent de préférer les données externes ; mais
          // d'autres (getRendezVous, getDossiersCpa...) font un simple include Prisma sur
          // cette colonne locale, donc la laisser sur son défaut générique "Endoscopie"
          // (voir schema.prisma) y affichait un type d'examen faux pour toute prescription
          // ancrée via une planification plutôt qu'une ouverture de dossier.
          typeExamen: ext.typeExamen || 'Endoscopie',
          motif: ext.renseignements || ext.remarques || '',
          priorite: this.mapUrgenceToPriorite(ext.urgence),
          dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
        },
      });
    }

    return { prescription, ext };
  }

  async getPrescriptionById(id: string, serviceIdOverride?: string) {
    const include = {
      rendezVous: true,
      checklistAvant: true,
      checklistApres: true,
      dossierCPA: true,
      resultatEndoscopie: true,
      operationEndoscopie: true,
      notes: true,
    } as const;

    const { prescription: anchor, ext } = await this.ensurePrescriptionAnchor(id, serviceIdOverride);
    const prescription = await this.prisma.prescription.findUniqueOrThrow({
      where: { id: anchor.id },
      include,
    });

    const merged = ext
      ? {
          ...prescription,
          prescriptionExternalId: ext.prescriptionExternalId ?? prescription.prescriptionExternalId,
          patientId: ext.patientId,
          medecinId: ext.prescripteurId ?? prescription.medecinId,
          typeExamen: ext.typeExamen || 'Endoscopie',
          motif: ext.renseignements || ext.remarques || '',
          priorite: this.mapUrgenceToPriorite(ext.urgence),
          dateDemande: ext.createdAt ? new Date(ext.createdAt) : prescription.dateDemande,
        }
      : prescription;

    const withMedecin = await this.medecinsService.attachMedecin(
      merged,
      'medecinId',
      'medecinPrescripteur',
    );
    return this.attachPatient(withMedecin);
  }

  /**
   * Champ libre propre à Endoscopie (pas le dossier patient CHU, lecture seule) — le
   * médecin y note les examens complémentaires à prévoir/demander si nécessaire.
   */
  async updateExamensComplementaires(id: string, examensComplementaires: string) {
    try {
      return await this.prisma.prescription.update({
        where: { id },
        data: { examensComplementaires },
      });
    } catch {
      throw new NotFoundException(`Prescription ${id} introuvable`);
    }
  }

  async getMedecins() {
    return this.medecinsService.getEndoscopieMedecins();
  }

  async getDossiersCpa(serviceIdOverride?: string) {
    const dossiers = await this.prisma.dossierCPA.findMany({
      where: this.scope(serviceIdOverride),
      include: { prescription: true },
      orderBy: { id: 'desc' },
    });
    const withMedecin = await this.medecinsService.attachMedecins(
      dossiers,
      'anesthesisteId',
      'anesthesiste',
    );
    return this.attachPatients(withMedecin);
  }

  async getDossierCpaById(id: string, serviceIdOverride?: string) {
    const dossier = await this.prisma.dossierCPA.findFirst({
      where: { id, ...this.scope(serviceIdOverride) },
      include: { prescription: true },
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
    const withMedecin = await this.medecinsService.attachMedecin(
      dossier,
      'anesthesisteId',
      'anesthesiste',
    );
    return this.attachPatient(withMedecin);
  }

  async getDossierCpaByPrescriptionId(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    const dossier = await this.prisma.dossierCPA.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      include: { prescription: true },
    });
    if (!dossier) return null;
    const withMedecin = await this.medecinsService.attachMedecin(
      dossier,
      'anesthesisteId',
      'anesthesiste',
    );
    return this.attachPatient(withMedecin);
  }

  async createDossierCpa(data: CreateDossierCpaDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    // Un dossier CPA existe déjà pour cette prescription (ex. tentative précédente dont
    // l'envoi au Bloc a échoué/été bloqué) : prescriptionId est unique, une recréation
    // échouerait. On retente simplement l'envoi au Bloc pour ce dossier existant plutôt
    // que de renvoyer une erreur de contrainte peu explicite.
    if (data.prescriptionId) {
      const existing = await this.prisma.dossierCPA.findUnique({
        where: { prescriptionId: data.prescriptionId },
        include: { prescription: true },
      });
      if (existing) {
        if (!existing.blocDemandeId) {
          this.notifyBlocCpa(existing, data).catch((e) => {
            this.logger.warn(
              `Envoi demande CPA au Bloc échoué pour le dossier ${existing.id}: ${e instanceof Error ? e.message : e}`,
            );
          });
        }
        const withMedecin = await this.medecinsService.attachMedecin(
          existing,
          'anesthesisteId',
          'anesthesiste',
        );
        return this.attachPatient(withMedecin);
      }
    }

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
      include: { prescription: true },
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

    // Envoyer la demande CPA au service Bloc Opératoire (fire-and-forget) — ne doit
    // jamais faire échouer la création locale si le Bloc est indisponible, mais on
    // journalise quand même : ce webhook est le seul moyen pour les anesthésistes
    // (côté Bloc) de connaître la date d'examen souhaitée, un échec silencieux ici
    // les laisserait sans information sans que personne ne le remarque.
    this.notifyBlocCpa(dossier, data).catch((e) => {
      this.logger.warn(
        `Envoi demande CPA au Bloc échoué pour le dossier ${dossier.id}: ${e instanceof Error ? e.message : e}`,
      );
    });

    const withMedecin = await this.medecinsService.attachMedecin(
      dossier,
      'anesthesisteId',
      'anesthesiste',
    );
    return this.attachPatient(withMedecin);
  }

  private async notifyBlocCpa(dossier: any, data: CreateDossierCpaDto) {
    const blocUrl = getBlocApiUrl();
    if (!blocUrl) {
      this.logger.warn(
        `BLOC_API_URL non configuré : le dossier CPA ${dossier.id} n'a pas été transmis au Bloc Opératoire.`,
      );
      return;
    }

    // Le Bloc demande "le même identifiant que celui utilisé par le service Accueil"
    // (voir son Swagger, ReceiveDemandeCpaDto.patientId) — sans exiger le format
    // CHU-YYYY-NNNNN. Accueil attribue parfois un UUID brut plutôt qu'un code
    // CHU-YYYY-NNNNN à certains patients (confirmé le 31/07/2026) ; un ancien filtre
    // ici ne laissait passer que le format CHU-YYYY-NNNNN et bloquait donc en
    // silence des patients pourtant valides. On se contente de vérifier qu'un
    // patientId existe.
    const patientId = dossier.patientId ?? '';
    if (!patientId) return;

    let dateExamenSouhaitee: string | null = null;
    if (data.prescriptionId) {
      const rdv = await this.prisma.rendezVous.findFirst({
        where: { prescriptionId: data.prescriptionId },
        select: { dateHeureDebut: true },
      });
      if (rdv) dateExamenSouhaitee = rdv.dateHeureDebut.toISOString();
    }

    const payload = {
      patientId,
      sourceServiceId: getEndoscopieServiceId(),
      sourceServiceName: 'Endoscopie',
      sourceCallbackUrl: this.notificationInboxService.getPublicWebhookUrl(),
      sourceReferenceType: 'dossier-cpa',
      sourceReferenceId: dossier.id,
      typeAnesthesie: dossier.typeAnesthesie ?? 'Générale',
      motif: dossier.observations ?? '',
      urgence: 4,
      ...(dateExamenSouhaitee && { dateExamenSouhaitee }),
    };

    const res = await fetch(`${blocUrl}/demandes-cpa-externes/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Le Bloc a répondu ${res.status}${body ? ` : ${body}` : ''}`);
    }

    const json = await res.json() as { id?: string };
    if (json.id) {
      await this.prisma.dossierCPA.update({
        where: { id: dossier.id },
        data: { blocDemandeId: json.id },
      });
    }
  }

  /**
   * Renvoi manuel d'une demande CPA au Bloc Opératoire depuis l'interface — contrairement
   * à l'envoi fire-and-forget fait à la création du dossier, celui-ci est synchrone et
   * remonte une erreur explicite si ça échoue, pour que le major puisse le voir et
   * réessayer, plutôt qu'un échec silencieux dans les logs serveur.
   */
  async renvoyerDossierCpaAuBloc(id: string, serviceIdOverride?: string) {
    const dossier = await this.getDossierCpaById(id, serviceIdOverride);
    if (dossier.blocDemandeId) {
      return { success: true, dejaEnvoye: true, blocDemandeId: dossier.blocDemandeId };
    }

    await this.notifyBlocCpa(dossier, { prescriptionId: dossier.prescriptionId ?? undefined } as CreateDossierCpaDto);

    const updated = await this.prisma.dossierCPA.findUnique({ where: { id } });
    if (!updated?.blocDemandeId) {
      throw new BadRequestException(
        "Le Bloc Opératoire n'a pas confirmé la réception de la demande.",
      );
    }
    return { success: true, dejaEnvoye: false, blocDemandeId: updated.blocDemandeId };
  }

  /**
   * Vérifie manuellement le statut d'une demande CPA auprès du Bloc Opératoire. Sert de
   * filet de sécurité si la notification (CPA_RESULTAT/VPA_REALISEE) n'est jamais arrivée
   * (Bloc endormi au moment de la décision, notification perdue, etc.) — délègue le GET
   * + application de la décision à CpaBlocService, partagé avec le traitement automatique
   * des notifications (voir NotificationInboxService).
   */
  async verifierStatutCpaBloc(id: string, serviceIdOverride?: string) {
    const dossier = await this.getDossierCpaById(id, serviceIdOverride);
    const { status, dossier: synced } = await this.cpaBlocService.synchroniserDepuisBloc(id);

    if (status !== 'synchronise' || !synced) {
      return { ...dossier, blocSync: status };
    }

    const withMedecin = await this.medecinsService.attachMedecin(
      synced,
      'anesthesisteId',
      'anesthesiste',
    );
    return { ...(await this.attachPatient(withMedecin)), blocSync: status };
  }

  /**
   * Parcours médical complet du patient (suivis, diagnostics) depuis le microservice
   * Dossier Patient CHU — au-delà de ce qu'on connaît nous-mêmes en Endoscopie. Conservé
   * pour compatibilité (le dossier patient enrichi utilise désormais les routes dédiées de
   * DossierPatientService/DossierPatientController directement, onglet par onglet) ; délègue
   * à ce même service pour ne pas dupliquer la logique d'authentification/chuId/serviceId.
   */
  async getPatientTraceability(patientId: string): Promise<{
    available: boolean;
    suivis: unknown[];
    diagnostics: unknown[];
  }> {
    if (!getDossierPatientApiUrl()) return { available: false, suivis: [], diagnostics: [] };

    // `available` ne doit être vrai que si le service a réellement répondu — sinon un 401
    // (échec d'authentification) afficherait à tort "aucun suivi" au lieu de "pas encore
    // accessible". DossierPatientService renvoie toujours une liste vide en cas d'échec, donc
    // on ne peut pas distinguer "vide" de "en échec" après coup — on considère `available`
    // dès que le service est configuré, cohérent avec le comportement tolérant des nouveaux
    // onglets (voir plan de refonte du dossier patient).
    const [suivis, diagnostics] = await Promise.all([
      this.dossierPatientService.getSuivis(patientId),
      this.dossierPatientService.getDiagnostics(patientId),
    ]);

    return {
      available: true,
      suivis,
      diagnostics,
    };
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
            dateValidation: parseDateTimeAsUtc(data.dateValidation),
          }),
        },
        include: { prescription: true },
      });
      const withMedecin = await this.medecinsService.attachMedecin(
        updated,
        'anesthesisteId',
        'anesthesiste',
      );
      return this.attachPatient(withMedecin);
    } catch {
      throw new NotFoundException(`Dossier CPA ${id} introuvable`);
    }
  }

  async getRendezVous(serviceIdOverride?: string) {
    const rendezVous = await this.prisma.rendezVous.findMany({
      where: this.scope(serviceIdOverride),
      include: {
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
    const withMedecin = await this.medecinsService.attachMedecins(
      rendezVous,
      'medecinId',
      'medecin',
    );
    return this.attachPatients(withMedecin);
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
    const withMedecin = await this.medecinsService.attachMedecins(
      rendezVous,
      'medecinId',
      'medecin',
    );
    return this.attachPatients(withMedecin);
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

  /**
   * Statistiques agrégées pour le rapport : patients reçus, répartition homme/femme/enfant,
   * décompte par type d'examen, sur une semaine ou un mois. "Patient reçu" = checklist
   * après-examen validée dans la période (signal fiable que l'examen a eu lieu).
   */
  async getRapportStats(
    period: 'week' | 'month' = 'week',
    dateRef?: string,
    serviceIdOverride?: string,
  ) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const refDate = dateRef ? new Date(dateRef) : new Date();
    const { start, end, label } = this.computeRapportPeriod(period, refDate);

    const checklists = await this.prisma.checklistApres.findMany({
      where: {
        serviceId,
        estValide: true,
        dateCreation: { gte: start, lte: end },
      },
      select: {
        patientId: true,
        prescription: { select: { typeExamen: true } },
      },
    });

    const typeCounts = checklists.reduce<Record<string, number>>((acc, row) => {
      const type = row.prescription?.typeExamen || 'Non spécifié';
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});
    const parTypeExamen = Object.entries(typeCounts)
      .map(([typeExamen, count]) => ({ typeExamen, count }))
      .sort((a, b) => b.count - a.count || a.typeExamen.localeCompare(b.typeExamen));

    const patientIds = [...new Set(checklists.map((c) => c.patientId).filter(Boolean))];
    const allPatients = await this.getAccueilPatients();
    const patientMap = new Map(allPatients.map((p) => [p.id, this.toPatientView(p)]));

    const parGenre = { homme: 0, femme: 0, enfant: 0, nonRenseigne: 0 };
    for (const patientId of patientIds) {
      const patient = patientMap.get(patientId);
      const age = patient?.dateNaissance
        ? Math.floor((Date.now() - patient.dateNaissance.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;
      if (age !== null && age < 18) {
        parGenre.enfant += 1;
      } else if (patient?.sexe === 'M') {
        parGenre.homme += 1;
      } else if (patient?.sexe === 'F') {
        parGenre.femme += 1;
      } else {
        parGenre.nonRenseigne += 1;
      }
    }

    return {
      periode: { type: period, start, end, label },
      totalPatients: patientIds.length,
      parGenre,
      parTypeExamen,
    };
  }

  /** Semaine (lundi → dimanche) ou mois calendaire contenant `refDate`. */
  private computeRapportPeriod(period: 'week' | 'month', refDate: Date) {
    if (period === 'month') {
      const start = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
      const label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      return { start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
    }
    const day = refDate.getDay(); // 0 = dimanche
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + diffToMonday, 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    const label = `Semaine du ${fmt(start)} au ${fmt(end)} ${end.getFullYear()}`;
    return { start, end, label };
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
    const dateHeureDebut = parseDateTimeAsUtc(data.dateHeureDebut);
    if (Number.isNaN(dateHeureDebut.getTime())) {
      throw new BadRequestException('dateHeureDebut est invalide');
    }
    if (data.dateHeureFin) {
      const explicitEnd = parseDateTimeAsUtc(data.dateHeureFin);
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
        'Impossible de planifier un rendez-vous dans le passé. Veuillez sélectionner une date et une heure valides.',
      );
    }
    // Toujours stocker une heure de fin concrète (45 min par défaut) pour que
    // les futures vérifications de collision restent fiables.
    const dateHeureFin = data.dateHeureFin
      ? parseDateTimeAsUtc(data.dateHeureFin)
      : new Date(dateHeureDebut.getTime() + 45 * 60000);

    let salle: { id: string; nom: string; capacite: number; estActive: boolean } | null = null;
    if (data.salleId) {
      salle = await this.prisma.salle.findUnique({ where: { id: data.salleId } });
      if (!salle) {
        throw new BadRequestException(`Salle ${data.salleId} introuvable`);
      }
      if (!salle.estActive) {
        throw new BadRequestException(`La salle "${salle.nom}" n'est plus active.`);
      }
    }

    // Résout (et crée si besoin) l'ancrage local — le patient a pu cliquer "Planifier"
    // directement depuis le Fil de prescription sans jamais ouvrir le détail du dossier,
    // auquel cas prescriptionId reçu ici est encore l'id brut externe, pas un id local.
    // Si l'appel vient de createRendezVousGroupe, l'id est déjà résolu (et le refaire ici
    // redéclencherait un pull externe complet par examen du groupe, en plus de celui déjà
    // fait — largement suffisant pour transformer une planification de quelques centaines
    // de ms en plusieurs secondes, jusqu'à faire abandonner le navigateur avec "Failed to
    // fetch" alors que la création se termine correctement en arrière-plan).
    const resolvedPrescriptionId = data.prescriptionId
      ? data.groupePrescriptionIds?.length
        ? data.prescriptionId
        : (await this.ensurePrescriptionAnchor(data.prescriptionId, data.serviceId)).prescription.id
      : null;

    const rendezVousPayload = {
      serviceId,
      patientId: data.patientId || null,
      prescriptionId: resolvedPrescriptionId,
      medecinId: data.medecinId || null,
      salleId: data.salleId || null,
      dateHeureDebut,
      dateHeureFin,
      typeAnesthesie: data.typeAnesthesie || null,
      statut: data.statut || 'Prevu',
      notesCliniques: data.notesCliniques || null,
      typeExamenSecondaire: data.typeExamenSecondaire || null,
    };

    // Chevauchement de créneau : [dateHeureDebut, dateHeureFin) contre les RDV existants,
    // en excluant le(s) RDV qu'on est en train de (re)planifier et les rendez-vous
    // annulés/terminés. `groupePrescriptionIds` (passé par createRendezVousGroupe) exclut
    // aussi les prescriptions sœurs du même groupe : un patient qui fait plusieurs examens
    // au même créneau (même séance) n'est pas en conflit avec lui-même.
    const excludedIds = data.groupePrescriptionIds?.length
      ? data.groupePrescriptionIds
      : resolvedPrescriptionId
        ? [resolvedPrescriptionId]
        : [];
    const overlapWhere = (extra: Record<string, unknown>) => ({
      serviceId,
      ...extra,
      ...(excludedIds.length ? { prescriptionId: { notIn: excludedIds } } : {}),
      dateHeureDebut: { lt: dateHeureFin },
      dateHeureFin: { gt: dateHeureDebut },
      NOT: { statut: { in: ['Annulé', 'Terminé'] } },
    });

    try {
      if (data.salleId && salle) {
        // La salle peut accueillir plusieurs patients en simultané selon sa capacité
        // (ex: capacité 5 = jusqu'à 5 patients différents sur le même créneau) —
        // on ne bloque que lorsque le nombre de rendez-vous déjà présents sur ce
        // créneau atteint cette limite, pas dès le premier chevauchement.
        const capacite = salle.capacite > 0 ? salle.capacite : 1;
        const concurrentCount = await this.prisma.rendezVous.count({
          where: overlapWhere({ salleId: data.salleId }),
        });
        if (concurrentCount >= capacite) {
          throw new BadRequestException(
            `La salle "${salle.nom}" a atteint sa capacité maximale (${capacite} patient${capacite > 1 ? 's' : ''}) sur ce créneau. Veuillez choisir une autre date, un autre horaire, ou une autre salle.`,
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

      if (resolvedPrescriptionId) {
        // Cas 1: Mise à jour via prescriptionId (UPSERT)
        await this.prisma.prescription.updateMany({
          where: { id: resolvedPrescriptionId, serviceId },
          data: { statut: 'Planifié' },
        });

        return await this.prisma.rendezVous.upsert({
          where: { prescriptionId: resolvedPrescriptionId },
          update: rendezVousPayload,
          create: rendezVousPayload,
        });
      }

      const created = await this.prisma.rendezVous.create({
        data: rendezVousPayload,
        include: {
          salle: true,
          prescription: true,
        },
      });
      const withMedecin = await this.medecinsService.attachMedecin(
        created,
        'medecinId',
        'medecin',
      );
      return this.attachPatient(withMedecin);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Erreur lors de la création du rendez-vous:', error);
      throw error;
    }
  }

  /**
   * Planifie plusieurs examens d'un même patient sur EXACTEMENT le même créneau (même
   * séance) — alternative à la planification "un par un" déjà existante. Réutilise
   * intégralement createRendezVous (mêmes validations de capacité/chevauchement), en lui
   * signalant via groupePrescriptionIds que les prescriptions du groupe ne sont pas en
   * conflit entre elles.
   */
  async createRendezVousGroupe(
    prescriptionIds: string[],
    sharedFields: Record<string, unknown>,
  ) {
    // Résout d'abord tous les ancrages locaux (un id reçu ici peut encore être l'id brut
    // externe) pour que l'exclusion de chevauchement, ci-dessous, compare bien les mêmes
    // ids que ceux réellement stockés sur les RendezVous créés dans cette même boucle.
    // Un seul pull externe partagé pour tout le groupe — sinon chaque ensurePrescriptionAnchor
    // refait indépendamment un fetchExternalPrescriptions() complet (plusieurs allers-retours
    // HTTP chacun), ce qui pour un groupe de N examens multipliait la latence par N et pouvait
    // dépasser le délai d'attente du navigateur ("Failed to fetch" alors que tout se créait
    // correctement en arrière-plan).
    const serviceIdForGroup = sharedFields.serviceId as string | undefined;
    const external = await this.fetchExternalPrescriptions(serviceIdForGroup);
    const resolvedIds: string[] = [];
    for (const prescriptionId of prescriptionIds) {
      const anchor = await this.ensurePrescriptionAnchor(prescriptionId, serviceIdForGroup, external);
      resolvedIds.push(anchor.prescription.id);
    }

    const results: unknown[] = [];
    for (const prescriptionId of resolvedIds) {
      const result = await this.createRendezVous({
        ...sharedFields,
        prescriptionId,
        groupePrescriptionIds: resolvedIds,
      });
      results.push(result);
    }
    return results;
  }

  /**
   * Détecte si cette prescription fait partie d'une "session groupée" : plusieurs
   * prescriptions du même patient (même prescriptionExternalId) planifiées sur
   * EXACTEMENT le même créneau (même rendezVous.dateHeureDebut) — signal implicite
   * qu'elles se font en une seule séance, sans introduire de nouveau modèle/flag
   * persistant. Réutilisé pour mettre en miroir les checklists avant/après (une seule
   * saisie pour toute la séance) et pour enchaîner dictée vocale / compte-rendu
   * procédure par procédure côté frontend.
   */
  async getSameSlotSiblings(
    prescriptionId: string,
    serviceIdOverride?: string,
  ): Promise<{
    sameSlot: boolean;
    exams: Array<{ id: string; patientId: string; typeExamen: string; hasOperation: boolean; hasResultat: boolean }>;
  }> {
    const current = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { rendezVous: true },
    });
    if (!current?.prescriptionExternalId || !current.rendezVous?.dateHeureDebut) {
      return { sameSlot: false, exams: [] };
    }

    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const siblings = await this.prisma.prescription.findMany({
      where: { serviceId, prescriptionExternalId: current.prescriptionExternalId },
      include: { rendezVous: true, operationEndoscopie: true, resultatEndoscopie: true },
    });

    const currentSlot = current.rendezVous.dateHeureDebut.getTime();
    const sameSlot = siblings.filter(
      (s) => s.rendezVous?.dateHeureDebut?.getTime() === currentSlot,
    );

    if (sameSlot.length < 2) {
      return { sameSlot: false, exams: [] };
    }

    return {
      sameSlot: true,
      exams: sameSlot.map((s) => ({
        id: s.id,
        patientId: s.patientId,
        typeExamen: s.typeExamen,
        hasOperation: !!s.operationEndoscopie,
        hasResultat: !!s.resultatEndoscopie,
      })),
    };
  }

  /**
   * Recopie une checklist avant/après vers les prescriptions sœurs de même créneau (voir
   * getSameSlotSiblings) — une session groupée n'a qu'UNE checklist avant/après pour
   * toute la séance, mais chaque prescription garde sa propre ligne (schéma 1-à-1
   * inchangé) pour que tout le reste du workflow (statuts, garde-fous par prescription...)
   * continue de fonctionner sans modification.
   */
  private async mirrorChecklistToSiblings(
    model: 'checklistAvant' | 'checklistApres',
    prescriptionId: string,
    checklistData: Record<string, unknown>,
    serviceIdOverride?: string,
  ): Promise<void> {
    const { sameSlot, exams } = await this.getSameSlotSiblings(prescriptionId, serviceIdOverride);
    if (!sameSlot) return;
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    await Promise.all(
      exams
        .filter((e) => e.id !== prescriptionId)
        .map((e) =>
          (this.prisma[model] as any)
            .upsert({
              where: { prescriptionId: e.id },
              update: checklistData,
              create: { ...checklistData, serviceId, prescriptionId: e.id, patientId: e.patientId },
            })
            .catch(() => undefined),
        ),
    );
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
      // Durée d'origine du rendez-vous — utilisée pour recalculer l'heure de fin
      // quand seule la date de début change (ex. décalage vers un tout autre jour) :
      // sans ça, l'ancienne heure de fin absolue reste et tombe souvent avant la
      // nouvelle heure de début, faisant échouer la replanification.
      const originalDurationMs = existing.dateHeureFin
        ? existing.dateHeureFin.getTime() - existing.dateHeureDebut.getTime()
        : 45 * 60000;

      if (data.dateHeureDebut !== undefined) {
        newDebut = parseDateTimeAsUtc(data.dateHeureDebut);
        if (Number.isNaN(newDebut.getTime())) {
          throw new BadRequestException('dateHeureDebut est invalide');
        }
      }
      if (data.dateHeureFin !== undefined) {
        newFin = data.dateHeureFin ? parseDateTimeAsUtc(data.dateHeureFin) : null;
        if (newFin && Number.isNaN(newFin.getTime())) {
          throw new BadRequestException('dateHeureFin est invalide');
        }
      } else if (data.dateHeureDebut !== undefined) {
        newFin = new Date(newDebut.getTime() + originalDurationMs);
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
          'Impossible de planifier un rendez-vous dans le passé. Veuillez sélectionner une date et une heure valides.',
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
        const salle = await this.prisma.salle.findUnique({ where: { id: existing.salleId } });
        const capacite = salle && salle.capacite > 0 ? salle.capacite : 1;
        const concurrentCount = await this.prisma.rendezVous.count({
          where: overlapWhere({ salleId: existing.salleId }),
        });
        if (concurrentCount >= capacite) {
          throw new BadRequestException(
            `La salle "${salle?.nom ?? ''}" a atteint sa capacité maximale (${capacite} patient${capacite > 1 ? 's' : ''}) sur ce créneau. Veuillez choisir une autre date, un autre horaire, ou une autre salle.`,
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
        ...(data.typeExamenSecondaire !== undefined && {
          typeExamenSecondaire: data.typeExamenSecondaire,
        }),
        ...(data.dateHeureDebut !== undefined && { dateHeureDebut: newDebut }),
        // `newFin` est recalculée dès que `dateHeureDebut` change (même si le client
        // n'envoie pas explicitement dateHeureFin, voir plus haut) — il faut donc la
        // persister dans les deux cas, pas seulement quand le client l'a fournie.
        ...(reschedule && { dateHeureFin: newFin }),
      },
      include: {
        salle: true,
        prescription: true,
      },
    });

    // Reflète l'étape de la décision d'anesthésie sur la prescription elle-même,
    // pour qu'elle réapparaisse au bon statut dans le Fil de prescription du Major.
    // 'Annulé' couvre le refus d'un examen par le médecin (bouton "Refuser").
    const CASCADE_STATUTS = ['Décision rendue', 'Confirmé', 'Annulé'];
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

    if (existing.prescriptionId && data.statut === 'Annulé' && data.motifRefus) {
      await this.prisma.prescription.updateMany({
        where: { id: existing.prescriptionId, serviceId },
        data: { motifRefus: data.motifRefus },
      });
      // Fire-and-forget : un souci de communication avec le service externe ne doit
      // jamais empêcher le médecin d'enregistrer son refus localement.
      this.notifyExternalPrescriptionRefused(
        existing.prescriptionId,
        serviceId,
        data.motifRefus,
      ).catch((e) =>
        this.logger.warn(
          `Notification de refus échouée pour la prescription ${existing.prescriptionId}: ${e instanceof Error ? e.message : e}`,
        ),
      );
    }

    const withMedecin = await this.medecinsService.attachMedecin(
      updated,
      'medecinId',
      'medecin',
    );
    return this.attachPatient(withMedecin);
  }

  /**
   * Valeur de statut attendue par prescriptionback pour signifier un refus — non
   * documentée côté Swagger externe, confirmée manuellement contre une demande de test
   * (voir PATCH /prescriptions/endoscopie/:id/demandes/:id/statut).
   */
  private readonly EXTERNAL_REFUS_STATUT = 'REFUSEE';

  /**
   * Répercute le refus d'une demande d'examen vers le service prescription externe
   * (source de vérité) et notifie le service qui a émis la demande (celui qui a le
   * patient en charge) — cf. plan de la fonctionnalité "refus d'examen". Best-effort :
   * un échec ici ne doit jamais faire échouer le refus local (voir l'appelant).
   */
  private async notifyExternalPrescriptionRefused(
    prescriptionId: string,
    serviceId: string,
    motifRefus: string,
  ) {
    const { prescription, ext } = await this.ensurePrescriptionAnchor(
      prescriptionId,
      serviceId,
    );
    if (!ext) return;

    if (prescription.externalId && ext.prescriptionExternalId) {
      try {
        const token =
          getCurrentUserToken() ?? (await this.medecinsService.getServiceAccountToken());
        const url = `${getPrescriptionExtApiUrl()}/endoscopie/${ext.prescriptionExternalId}/demandes/${prescription.externalId}/statut`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ statut: this.EXTERNAL_REFUS_STATUT, motif: motifRefus }),
        });
        if (!res.ok) {
          this.logger.warn(
            `PATCH statut demande externe ${res.status}: ${await res.text().catch(() => '')}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `Échec MAJ statut externe pour la demande ${prescription.externalId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    if (ext.serviceIdSource) {
      const patientLabel = ext.patientId ? `patient ${ext.patientId}` : 'un patient';
      await this.notificationService.createNotification({
        type: 'DEMANDE_EXAMEN_REFUSEE',
        motif: `Demande d'examen (${ext.typeExamen}) refusée par Endoscopie pour ${patientLabel} : ${motifRefus}`,
        patientId: ext.patientId,
        entiteRefType: 'prescription',
        entiteRefId: ext.prescriptionExternalId,
        emitter: 'endoscopie-back',
        emitterName: 'Endoscopie',
        targetServiceId: ext.serviceIdSource,
      });
    }
  }

  /**
   * Suppression définitive d'un rendez-vous (pas une simple annulation de statut) — la
   * prescription liée repasse à « A planifier » pour rester replanifiable depuis le Fil
   * de prescription, plutôt que de rester bloquée sur « Planifié » sans rendez-vous réel.
   */
  async deleteRendezVous(id: string, serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const existing = await this.prisma.rendezVous.findFirst({
      where: { id, serviceId },
    });
    if (!existing) {
      throw new NotFoundException(`Rendez-vous ${id} introuvable`);
    }

    try {
      await this.prisma.rendezVous.delete({ where: { id } });
    } catch (e) {
      // Déjà supprimé entre-temps (double clic, requête concurrente) : l'état final
      // recherché (rendez-vous absent) est déjà atteint, pas une vraie erreur.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return { success: true, id };
      }
      throw e;
    }

    if (existing.prescriptionId) {
      await this.prisma.prescription.updateMany({
        where: { id: existing.prescriptionId, serviceId },
        data: { statut: 'A planifier' },
      });
    }

    return { success: true, id };
  }

  async createSalle(data: any) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    const parsedCapacite = parseInt(data.capacite, 10);
    const capacite = Number.isFinite(parsedCapacite) && parsedCapacite > 0 ? parsedCapacite : 1;
    return this.prisma.salle.create({
      data: {
        serviceId,
        nom: data.nom,
        numero: data.numero,
        capacite,
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

    const checklist = await this.prisma.checklistAvant.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: checklistData,
      create: {
        ...checklistData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });

    await this.mirrorChecklistToSiblings('checklistAvant', data.prescriptionId, checklistData, data.serviceId);

    return checklist;
  }

  /** Notes/observations libres horodatées ajoutées manuellement au dossier patient. */
  async getNotesDossier(prescriptionId: string, serviceIdOverride?: string) {
    return this.prisma.noteDossier.findMany({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
      orderBy: { dateCreation: 'desc' },
    });
  }

  async createNoteDossier(data: CreateNoteDossierDto) {
    if (!data.prescriptionId || !data.contenu?.trim()) {
      throw new Error('prescriptionId et contenu sont obligatoires pour ajouter une note');
    }
    const serviceId = this.getEndoscopieServiceId(data.serviceId);
    return this.prisma.noteDossier.create({
      data: {
        prescriptionId: data.prescriptionId,
        serviceId,
        auteur: data.auteur?.trim() || 'Inconnu',
        contenu: data.contenu.trim(),
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
    if (!operation) return null;
    return this.attachPatient({
      ...operation,
      voiceTranscripts: operation.voiceTranscripts ? JSON.parse(operation.voiceTranscripts) : [],
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
      observationNotes: data.observationNotes ?? null,
      medicalNotes: data.medicalNotes || '',
      voiceTranscripts: JSON.stringify(data.voiceTranscripts || []),
      prescriptionPostActe: data.prescriptionPostActe ?? null,
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

    const checklist = await this.prisma.checklistApres.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: checklistData,
      create: {
        ...checklistData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });

    await this.mirrorChecklistToSiblings('checklistApres', data.prescriptionId, checklistData, data.serviceId);
    await this.markTermineIfComplete(data.prescriptionId);

    return checklist;
  }

  /**
   * Marque la prescription (et son rendez-vous) "Terminé" dès que la checklist
   * après-examen est validée ET que le compte rendu existe — signal fiable réutilisé
   * par l'archive et le rapport, au lieu de le redéduire à chaque affichage.
   */
  private async markTermineIfComplete(prescriptionId: string) {
    const prescriptionRaw = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        checklistApres: true,
        resultatEndoscopie: true,
        rendezVous: true,
      },
    });
    if (!prescriptionRaw) return;
    const prescription = await this.medecinsService.attachMedecin(
      prescriptionRaw,
      'medecinId',
      'medecinPrescripteur',
    );
    if (!prescription.checklistApres?.estValide || !prescription.resultatEndoscopie) return;
    if (prescription.statut === 'Terminé') return;

    await this.prisma.prescription.update({
      where: { id: prescriptionId },
      data: { statut: 'Terminé' },
    });
    if (prescription.rendezVous) {
      await this.prisma.rendezVous.update({
        where: { id: prescription.rendezVous.id },
        data: { statut: 'Terminé' },
      });
    }

    // Notifier les services sources que le résultat est prêt
    try {
      const patientInfo = await this.getPatientById(prescription.patientId);
      const prescripteur = prescription.medecinPrescripteur?.nom
        ? `Dr. ${prescription.medecinPrescripteur.nom}`
        : 'Dr. Inconnu';

      await this.serviceSourceService.notifyServiceOfExam(
        prescription.id,
        patientInfo?.nom || 'Inconnu',
        patientInfo?.prenom || '',
        prescription.serviceId,
        prescripteur,
        prescription.patientId,
      );
    } catch (error) {
      this.logger.error('Failed to notify service sources:', error);
    }
  }

  async getResultat(
    prescriptionId: string,
    serviceIdOverride?: string,
  ) {
    const resultat = await this.prisma.resultatEndoscopie.findFirst({
      where: { prescriptionId, ...this.scope(serviceIdOverride) },
    });
    if (!resultat) return null;
    return this.attachPatient({
      ...resultat,
      details: resultat.details ? JSON.parse(resultat.details) : undefined,
    });
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
      details: Object.keys(details).length ? JSON.stringify(details) : undefined,
    };

    const resultat = await this.prisma.resultatEndoscopie.upsert({
      where: { prescriptionId: data.prescriptionId },
      update: resultatData,
      create: {
        ...resultatData,
        serviceId,
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
      },
    });

    await this.markTermineIfComplete(data.prescriptionId);

    return resultat;
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

  async generatePublicShareLink(prescriptionId: string): Promise<{ token: string; shareUrl: string }> {
    const token = randomUUID().replace(/-/g, '').substring(0, 24);
    await this.prisma.resultatEndoscopie.update({
      where: { prescriptionId },
      data: {
        publicToken: token,
        isPublicShared: true,
        sharedAt: new Date(),
      },
    });
    const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:3333';
    return {
      token,
      shareUrl: `${apiUrl}/api/resultats/public/${token}`,
    };
  }

  async getResultatByPublicToken(token: string) {
    const resultat = await this.prisma.resultatEndoscopie.findUnique({
      where: { publicToken: token },
      include: { prescription: true },
    });
    if (!resultat) throw new NotFoundException('Résultat non trouvé');
    if (!resultat.prescription) return resultat;

    const prescriptionAvecMedecin = await this.medecinsService.attachMedecin(
      resultat.prescription,
      'medecinId',
      'medecinPrescripteur',
    );
    return { ...resultat, prescription: prescriptionAvecMedecin };
  }

  async revokePublicShareLink(prescriptionId: string) {
    return this.prisma.resultatEndoscopie.update({
      where: { prescriptionId },
      data: {
        publicToken: null,
        isPublicShared: false,
      },
    });
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
        dateDemande: parseDateTimeAsUtc(detailsPrescription.datePrescription),
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
    const dateHeureDebut = parseDateTimeAsUtc(`${rendezVous.date}T${rendezVous.heure}`);

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
        statut: rendezVous.confirmeParAdmin ? 'Confirmé' : 'Prevu',
        serviceId,
      },
      update: {
        dateHeureDebut,
        typeAnesthesie: data.typeAnesthesie?.type || null,
        notesCliniques: rendezVous.instructionsPatient,
        statut: rendezVous.confirmeParAdmin ? 'Confirmé' : 'Prevu',
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
        rendezVous: true,
        dossierCPA: true,
      },
      orderBy: { dateDemande: 'desc' },
    });
    const withMedecin = await this.medecinsService.attachMedecins(
      prescriptions,
      'medecinId',
      'medecinPrescripteur',
    );
    return this.attachPatients(withMedecin);
  }

  async getConfirmationPlanification(prescriptionId: string, serviceIdOverride?: string) {
    const prescriptionRaw = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, ...this.scope(serviceIdOverride) },
      include: {
        rendezVous: true,
        dossierCPA: true,
      },
    });

    if (!prescriptionRaw) {
      throw new NotFoundException(`Confirmation pour prescription ${prescriptionId} introuvable`);
    }
    const prescription = await this.medecinsService.attachMedecin(
      prescriptionRaw,
      'medecinId',
      'medecinPrescripteur',
    );

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
            confirmeParAdmin: prescription.rendezVous.statut === 'Confirmé',
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
