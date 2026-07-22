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
  getAuthEcosystemLoginUrl,
  getBlocApiUrl,
  getChuApiUrl,
  getDossierPatientApiUrl,
  getEndoscopieAuthChuId,
  getEndoscopieAuthServiceId,
  getEndoscopieChuId,
  getEndoscopieServiceId,
  getPrescriptionExtApiUrl,
  getServiceAccountCredentials,
} from './config/endoscopie-service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { CreateMedecinDto } from './dto/create-medecin.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { UpdateRendezVousDto } from './dto/update-rendezvous.dto';
import { CreateNoteDossierDto } from './dto/create-note-dossier.dto';
import { parseDateTimeAsUtc } from './utils/datetime.util';
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

/**
 * Une prescription externe d'endoscopie peut regrouper PLUSIEURS demandes
 * d'examen (ex: Coloscopie + Fibroscopie sur une même prescription venant
 * d'un autre service). Chaque demande a son propre statut, mis à jour
 * individuellement côté service externe via
 * PATCH /prescriptions/endoscopie/{prescriptionId}/demandes/{demandeId}/statut.
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
  urgence?: 'NORMALE' | 'URGENTE' | 'STAT' | null;
  alertes?: string | null;
  remarques?: string | null;
  chuId?: string | null;
  serviceIdSource?: string | null;
  serviceIdDest?: string | null;
  createdAt?: string | null;
  demandes?: ExternalEndoscopieDemande[];
  // Rétrocompatibilité : certaines réponses (ou versions plus anciennes de
  // l'API externe) peuvent encore renvoyer un examen unique à plat, sans
  // tableau `demandes`.
  typeExamen?: string | null;
  statut?: string | null;
}

/**
 * Une "demande" aplatie, prête à être traitée comme une prescription locale
 * unique (un examen = une prescription = un rendez-vous = un compte-rendu).
 * Chaque demande d'une prescription à examens multiples devient un élément
 * distinct de cette liste, avec demande.id comme identifiant externe.
 */
type FlatExternalDemande = {
  id: string;
  patientId: string;
  prescripteurId: string;
  typeExamen: string;
  renseignements?: string | null;
  urgence?: 'NORMALE' | 'URGENTE' | 'STAT' | null;
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

  /** IDs de demandes externes déjà vus — permet de détecter l'arrivée d'une nouvelle
   *  prescription (venant d'un autre service) sans dépendre du polling du frontend.
   *  Le service prescription externe n'expose aucun webhook/callback pour nous notifier
   *  lui-même à l'arrivée d'une nouvelle demande (vérifié sur son Swagger) — le polling
   *  reste donc le seul moyen de détecter une nouvelle prescription, avec un intervalle
   *  court pour rester au plus près de l'instantané. */
  private seenExternalPrescriptionIds: Set<string> | null = null;
  private prescriptionWatcherInterval: ReturnType<typeof setInterval> | null = null;
  private readonly PRESCRIPTION_WATCH_INTERVAL_MS = 3000;

  /** JWT du compte de service, mis en cache — certains services externes (ex. prescription)
   *  exigent le même token que celui utilisé par nos utilisateurs pour se connecter. */
  private serviceAccountToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async onModuleInit() {
    // Résout dynamiquement notre identité (serviceId/chuId) depuis le registre central,
    // pour ne jamais dépendre d'un ID figé en dur qu'il faudrait reconfigurer à chaque
    // nouveau déploiement (ex. sur le serveur définitif de l'hôpital) — voir
    // resolveAndRefreshAuthIdentity(). Les variables d'env restent utilisées si le
    // registre est injoignable (secours).
    await this.resolveAndRefreshAuthIdentity();
    this.identityRefreshInterval = setInterval(
      () => this.resolveAndRefreshAuthIdentity(),
      this.IDENTITY_REFRESH_INTERVAL_MS,
    );

    // Amorce la liste des demandes déjà connues au démarrage, pour ne notifier
    // que les VRAIES nouvelles arrivées et éviter une salve de notifications
    // pour tout ce qui existait déjà avant le lancement du serveur.
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
    if (this.identityRefreshInterval) clearInterval(this.identityRefreshInterval);
  }

  private identityRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly IDENTITY_REFRESH_INTERVAL_MS = 60 * 60_000;

  /**
   * Interroge le registre central des services (SERVICE_REGISTRY_API_URL) pour trouver
   * l'entrée nommée "Endoscopie" et écrase ENDOSCOPIE_SERVICE_ID/ENDOSCOPIE_AUTH_SERVICE_ID
   * (même valeur depuis la migration du 21/07/2026 unifiant les anciens ID legacy — voir
   * schema.prisma) et ENDOSCOPIE_AUTH_CHU_ID en mémoire avec les vraies valeurs actuelles.
   * Ces variables d'env deviennent de simples valeurs de secours (utilisées si le registre
   * est injoignable), plus une source de vérité à reconfigurer manuellement à chaque
   * déploiement. ENDOSCOPIE_CHU_ID n'est volontairement pas touché ici : il sert aux appels
   * vers l'écosystème CHU_API_URL/ACCUEIL_API_URL (registre Railway distinct, non vérifié
   * compatible avec ce registre-ci).
   */
  private async resolveAndRefreshAuthIdentity(): Promise<void> {
    const registryUrl = process.env.SERVICE_REGISTRY_API_URL?.trim().replace(/\/$/, '');
    if (!registryUrl) return;

    try {
      const token = await this.getServiceAccountToken();
      if (!token) return;

      const res = await fetch(`${registryUrl}/services`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`Résolution de l'identité Endoscopie échouée (${res.status}) — valeurs de secours conservées.`);
        return;
      }

      const services = (await res.json()) as Array<{ id?: string; name?: string; chuId?: string }>;
      const match = services.find((s) => s.name?.trim().toLowerCase() === 'endoscopie');
      if (!match?.id) {
        this.logger.warn('Aucun service "Endoscopie" trouvé dans le registre central — valeurs de secours conservées.');
        return;
      }

      const changed =
        process.env.ENDOSCOPIE_SERVICE_ID !== match.id ||
        process.env.ENDOSCOPIE_AUTH_SERVICE_ID !== match.id ||
        (match.chuId && process.env.ENDOSCOPIE_AUTH_CHU_ID !== match.chuId);

      process.env.ENDOSCOPIE_SERVICE_ID = match.id;
      process.env.ENDOSCOPIE_AUTH_SERVICE_ID = match.id;
      if (match.chuId) process.env.ENDOSCOPIE_AUTH_CHU_ID = match.chuId;

      if (changed) {
        this.logger.log(`Identité Endoscopie résolue depuis le registre central : serviceId=${match.id} chuId=${match.chuId ?? '?'}`);
      }
    } catch (e) {
      this.logger.warn(`Résolution de l'identité Endoscopie échouée : ${e instanceof Error ? e.message : e} — valeurs de secours conservées.`);
    }
  }

  /**
   * Détecte les nouvelles prescriptions arrivées depuis le service externe (ex:
   * saisies depuis un autre département) et déclenche une notification + le son
   * associé côté front — sans ça, seules les prescriptions créées via notre propre
   * POST /api/prescriptions déclenchaient une notification.
   */
  private isPollingPrescriptions = false;

  private async pollForNewPrescriptions() {
    if (!this.seenExternalPrescriptionIds) return;
    // Empêche deux cycles de se chevaucher si un appel externe traîne plus longtemps
    // que l'intervalle (désormais court, voir PRESCRIPTION_WATCH_INTERVAL_MS).
    if (this.isPollingPrescriptions) return;
    this.isPollingPrescriptions = true;
    try {
      const current = await this.fetchExternalPrescriptions();
      const nouvelles = current.filter((p) => p.id && !this.seenExternalPrescriptionIds!.has(p.id));
      if (nouvelles.length === 0) return;

      // Regroupe les demandes issues d'une même prescription externe multi-examens (ex.
      // Coloscopie + Fibroscopie pour le même patient) pour n'envoyer qu'UNE notification
      // par prescription, pas une par examen — voir notifyPrescriptionCreated.
      const groups = new Map<string, typeof nouvelles>();
      for (const demande of nouvelles) {
        const key = demande.prescriptionExternalId || demande.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(demande);
      }

      for (const demandes of groups.values()) {
        // Marquées comme vues immédiatement pour éviter une double notification si un
        // cycle suivant démarre avant la résolution complète de celui-ci.
        for (const demande of demandes) {
          this.seenExternalPrescriptionIds.add(demande.id);
        }
        try {
          const resolvedList = await Promise.all(demandes.map((d) => this.getPrescriptionById(d.id)));
          await this.notificationService.notifyPrescriptionCreated(resolvedList);
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

  private serviceAccountLoginFailedUntil = 0;
  private serviceAccountLoginInFlight: Promise<string | null> | null = null;

  /**
   * JWT du compte de service auprès de l'écosystème d'authentification CHU — certains
   * services externes (ex. prescription) exigent le même token que celui utilisé par nos
   * utilisateurs pour se connecter à l'app, y compris pour nos appels serveur-à-serveur.
   * Mis en cache jusqu'à ~1 minute avant expiration, puis renouvelé automatiquement. Les
   * appels concurrents partagent la même tentative de connexion, et un échec (ex. service
   * d'auth temporairement indisponible) est mis en pause 30s avant de réessayer, pour ne
   * pas marteler l'écosystème d'auth à chaque appel externe pendant une panne.
   */
  private async getServiceAccountToken(): Promise<string | null> {
    const loginUrl = getAuthEcosystemLoginUrl();
    const credentials = getServiceAccountCredentials();
    if (!loginUrl || !credentials) return null;

    if (this.serviceAccountToken && this.serviceAccountToken.expiresAt > Date.now() + 60_000) {
      return this.serviceAccountToken.token;
    }
    if (Date.now() < this.serviceAccountLoginFailedUntil) return null;
    if (this.serviceAccountLoginInFlight) return this.serviceAccountLoginInFlight;

    this.serviceAccountLoginInFlight = (async () => {
      try {
        const res = await fetch(`${loginUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          this.logger.warn(`Connexion du compte de service échouée (${res.status}) auprès de ${loginUrl}`);
          this.serviceAccountLoginFailedUntil = Date.now() + 30_000;
          return null;
        }
        const data = (await res.json()) as { accessToken?: string };
        if (!data.accessToken) return null;

        const payload = data.accessToken.split('.')[1];
        const decoded = payload ? JSON.parse(Buffer.from(payload, 'base64').toString()) : null;
        const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 15 * 60_000;

        this.serviceAccountToken = { token: data.accessToken, expiresAt };
        return data.accessToken;
      } catch (e) {
        this.logger.warn(`Erreur lors de la connexion du compte de service: ${e instanceof Error ? e.message : e}`);
        this.serviceAccountLoginFailedUntil = Date.now() + 30_000;
        return null;
      } finally {
        this.serviceAccountLoginInFlight = null;
      }
    })();

    return this.serviceAccountLoginInFlight;
  }

  /** Interroge le service prescription externe pour une paire serviceId/chuId donnée. */
  private async fetchExternalPrescriptionsFor(serviceId: string, chuId: string): Promise<ExternalEndoscopiePrescription[]> {
    try {
      const url = `${getPrescriptionExtApiUrl()}/endoscopie?serviceIdDest=${serviceId}&chuId=${chuId}`;
      const token = await this.getServiceAccountToken();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return [];
      const data = await res.json() as unknown;
      return Array.isArray(data) ? (data as ExternalEndoscopiePrescription[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Récupère les prescriptions brutes d'endoscopie depuis le service externe (avant
   * aplatissement des demandes multiples). Interroge TOUTES les combinaisons de nos ID
   * service/CHU locaux et ceux de l'écosystème d'authentification — en pratique, le
   * service prescription tague ses prescriptions avec des paires "mixtes" (ex. notre
   * serviceId local avec le chuId de l'écosystème d'auth), pas seulement les deux paires
   * "propres" — confirmé le 19/07/2026 : plusieurs prescriptions récentes utilisaient
   * serviceIdDest=ENDOSCOPIE_SERVICE_ID avec chuId=ENDOSCOPIE_AUTH_CHU_ID et étaient donc
   * invisibles avec l'ancienne logique à 2 paires fixes.
   */
  private async fetchExternalPrescriptionsRaw(serviceIdOverride?: string): Promise<ExternalEndoscopiePrescription[]> {
    const primaryServiceId = this.getEndoscopieServiceId(serviceIdOverride);
    const primaryChuId = getEndoscopieChuId();
    // Le frontend rajoute systématiquement ?serviceId=<ENDOSCOPIE_SERVICE_ID> sur tous
    // ses appels (voir appendServiceId côté front) : serviceIdOverride vaut donc quasiment
    // toujours notre propre ID par défaut, pas un vrai appelant externe. On interroge
    // systématiquement les ID auth-service/auth-chu en plus, indépendamment de cet override.
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
   * Éclate chaque prescription externe en une liste plate de demandes — une
   * prescription à examens multiples (ex: Coloscopie + Fibroscopie) devient
   * autant d'éléments distincts, chacun traité comme une prescription locale
   * à part entière (même principe qu'une "double opération" mais porté par
   * le service externe plutôt que planifié localement).
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
        // Rétrocompatibilité : réponse à plat, sans tableau `demandes`.
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

  /** Récupère les demandes d'endoscopie externes, aplaties (une demande = une prescription locale). */
  private async fetchExternalPrescriptions(serviceIdOverride?: string): Promise<FlatExternalDemande[]> {
    const raw = await this.fetchExternalPrescriptionsRaw(serviceIdOverride);
    return this.flattenExternalPrescriptions(raw);
  }

  /**
   * Mappe l'urgence externe vers la priorité locale. Le service prescription a changé
   * son enum d'urgence (NORMAL/URGENT/TRES_URGENT, confirmé sur le endpoint de création
   * — voir mapPrioriteToUrgence) sans que cette lecture ne soit mise à jour en miroir :
   * les prescriptions récentes tombaient donc toutes silencieusement en "Standard",
   * quelle que soit l'urgence réelle fixée par le prescripteur source. Les anciennes
   * valeurs (STAT/URGENTE) restent vérifiées pour ne pas casser l'historique déjà migré.
   */
  private mapUrgenceToPriorite(urgence?: string | null): string {
    const u = urgence?.trim().toUpperCase();
    if (u === 'STAT' || u === 'TRES_URGENT') return 'STAT';
    if (u === 'URGENTE' || u === 'URGENT') return 'Urgent';
    return 'Standard';
  }

  /** Mappe la priorité locale vers l'urgence externe. */
  private mapPrioriteToUrgence(priorite?: string | null): 'NORMAL' | 'URGENT' | 'TRES_URGENT' {
    if (priorite === 'STAT') return 'TRES_URGENT';
    if (priorite === 'Urgent') return 'URGENT';
    return 'NORMAL';
  }

  /** Mappe le statut externe (ex: "CREEE") vers le statut local ("A planifier"). */
  private mapExternalStatut(statut?: string | null): string {
    const s = (statut || '').toUpperCase();
    if (s === 'CREEE' || s === 'CREATED') return 'A planifier';
    if (s === 'EN_COURS' || s === 'IN_PROGRESS') return 'Planifié';
    if (s === 'COMPLETEE' || s === 'COMPLETED' || s === 'TERMINEE') return 'Confirmé';
    if (s === 'ANNULEE' || s === 'CANCELLED') return 'Annulé';
    // Statuts locaux déjà corrects — passés tels quels
    if (['A planifier', 'Planifié', 'Décision rendue', 'Confirmé', 'CPA demandée'].includes(statut || '')) return statut!;
    return 'A planifier';
  }

  /**
   * Synchronise toutes les prescriptions de l'API externe vers le miroir local.
   * Les upserts sont exécutés en parallèle pour éviter les timeouts sur grandes listes.
   */
  private async syncExternalPrescriptions(serviceIdOverride?: string): Promise<void> {
    const external = await this.fetchExternalPrescriptions(serviceIdOverride);
    if (!external.length) return;

    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const valid = external.filter((e) => e.id && e.prescripteurId && e.patientId);

    // Garantir que tous les prescripteurs existent (déduplication)
    const prescripteurIds = [...new Set(valid.map((e) => e.prescripteurId))];
    await Promise.all(
      prescripteurIds.map((pid) =>
        this.prisma.medecin
          .upsert({
            where: { id: pid },
            update: {},
            create: { id: pid, nom: 'EXTERN', prenom: 'MEDECIN', specialite: null, role: null },
          })
          .catch(() => undefined),
      ),
    );

    // Upserts de prescriptions en parallèle
    await Promise.all(
      valid.map((ext) => {
        const createData = {
          serviceId,
          patientId: ext.patientId,
          medecinId: ext.prescripteurId,
          typeExamen: ext.typeExamen || 'Endoscopie',
          motif: ext.renseignements || ext.remarques || '',
          priorite: this.mapUrgenceToPriorite(ext.urgence),
          // Statut initial depuis l'externe — ensuite géré par le workflow local
          statut: this.mapExternalStatut(ext.statut),
          dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
        };
        // Sur un update, on ne touche pas au statut (workflow local) ni aux dates
        const { statut: _s, dateDemande: _d, ...updateData } = createData;
        return this.prisma.prescription
          .upsert({
            where: { externalId: ext.id },
            update: updateData,
            create: { externalId: ext.id, ...createData },
          })
          .catch(() => undefined);
      }),
    );
  }

  /**
   * Pull direct depuis l'API prescription externe — aucune copie en DB locale.
   * Seul l'état du workflow (rendezVous, checklistApres) est lu depuis le miroir local
   * si une entrée existe déjà (créée au moment où le workflow a débuté).
   */
  async getPrescriptions(serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);

    // Source de vérité : API externe
    const external = await this.fetchExternalPrescriptions(serviceIdOverride);

    // Repli local : si le service externe est en panne/indisponible (ex. 401 côté
    // fournisseur), on ne doit pas faire disparaître tout le fil de prescription — on
    // charge TOUTES nos prescriptions locales, et celles non retrouvées côté externe
    // cette fois-ci restent affichées à partir de nos propres données (voir plus bas).
    const allLocalRecords = await this.prisma.prescription.findMany({
      where: { serviceId },
      include: { rendezVous: true, checklistApres: true, dossierCPA: true, resultatEndoscopie: true },
    });
    const localByExtId = new Map(
      allLocalRecords.filter((r) => r.externalId).map((r) => [r.externalId as string, r]),
    );

    // Médecins prescripteurs — garantit un stub local pour chaque prescripteur externe inconnu,
    // puis résout le nom réel (ou le stub) pour l'affichage dans le fil de prescription.
    const prescripteurIds = [
      ...new Set([
        ...external.map((e) => e.prescripteurId).filter(Boolean),
        ...allLocalRecords.map((r) => r.medecinId).filter(Boolean),
      ]),
    ];
    if (prescripteurIds.length) {
      const existingMedecins = await this.prisma.medecin.findMany({
        where: { id: { in: prescripteurIds } },
        select: { id: true },
      });
      const existingIds = new Set(existingMedecins.map((m) => m.id));
      const missingIds = prescripteurIds.filter((id) => !existingIds.has(id));
      if (missingIds.length) {
        await Promise.all(
          missingIds.map((id) =>
            this.prisma.medecin
              .upsert({
                where: { id },
                update: {},
                create: { id, nom: 'EXTERN', prenom: 'MEDECIN', specialite: null, role: null },
              })
              .catch(() => undefined),
          ),
        );
      }
    }
    const medecins = prescripteurIds.length
      ? await this.prisma.medecin.findMany({ where: { id: { in: prescripteurIds } } })
      : [];
    const medecinMap = new Map(medecins.map((m) => [m.id, m]));

    // Données patients depuis Accueil
    const allPatients = await this.getAccueilPatients();
    const patientMap = new Map(allPatients.map((p) => [p.id, this.toPatientView(p)]));

    // Le flux externe ne renvoie qu'un sous-ensemble récent/actif des demandes : un examen
    // qui en sort (terminé, ou simplement plus dans la fenêtre retournée) doit conserver son
    // rattachement au groupe multi-examens. On met donc en cache le prescriptionExternalId en
    // local dès qu'on le voit passer en direct, pour pouvoir le réutiliser plus tard (voir
    // localOnlyRows ci-dessous) — sans quoi l'examen réapparaîtrait comme une ligne séparée.
    const prescriptionExternalIdUpdates: { id: string; prescriptionExternalId: string | null }[] = [];

    const externalRows = external.map((ext) => {
      const local = localByExtId.get(ext.id);
      const livePrescriptionExternalId = ext.prescriptionExternalId ?? null;
      if (local && livePrescriptionExternalId && local.prescriptionExternalId !== livePrescriptionExternalId) {
        prescriptionExternalIdUpdates.push({ id: local.id, prescriptionExternalId: livePrescriptionExternalId });
      }
      return {
        id: local?.id ?? ext.id,
        externalId: ext.id,
        // Regroupe les demandes issues d'une même prescription multi-examens externe.
        prescriptionExternalId: livePrescriptionExternalId,
        patientId: ext.patientId,
        medecinId: ext.prescripteurId ?? null,
        typeExamen: ext.typeExamen || 'Endoscopie',
        motif: ext.renseignements || ext.remarques || '',
        priorite: this.mapUrgenceToPriorite(ext.urgence),
        statut: local?.statut ?? this.mapExternalStatut(ext.statut),
        dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
        serviceId,
        medecinPrescripteur: ext.prescripteurId ? (medecinMap.get(ext.prescripteurId) ?? null) : null,
        rendezVous: local?.rendezVous ?? null,
        checklistApres: local?.checklistApres ?? null,
        dossierCPA: local?.dossierCPA ?? null,
        resultatEndoscopie: local?.resultatEndoscopie ?? null,
        patient: ext.patientId ? (patientMap.get(ext.patientId) ?? null) : null,
      };
    });

    if (prescriptionExternalIdUpdates.length) {
      // Best-effort, ne bloque jamais la réponse — une écriture manquée sera retentée
      // au prochain passage où l'examen est encore visible côté externe.
      Promise.all(
        prescriptionExternalIdUpdates.map((u) =>
          this.prisma.prescription
            .update({ where: { id: u.id }, data: { prescriptionExternalId: u.prescriptionExternalId } })
            .catch(() => undefined),
        ),
      ).catch(() => undefined);
    }

    // Prescriptions locales absentes de la réponse externe cette fois-ci (service
    // externe en panne, ou prescription retirée côté externe) : affichées à partir de
    // nos propres données plutôt que de disparaître silencieusement du fil. On réutilise
    // le prescriptionExternalId mis en cache localement (voir plus haut) pour ne pas
    // perdre son rattachement au groupe multi-examens.
    const coveredExtIds = new Set(external.map((e) => e.id));
    const localOnlyRows = allLocalRecords
      .filter((r) => !r.externalId || !coveredExtIds.has(r.externalId))
      .map((local) => ({
        id: local.id,
        externalId: local.externalId,
        prescriptionExternalId: local.prescriptionExternalId ?? null,
        patientId: local.patientId,
        medecinId: local.medecinId || null,
        typeExamen: local.typeExamen,
        motif: local.motif || '',
        priorite: local.priorite,
        statut: local.statut,
        dateDemande: local.dateDemande,
        serviceId,
        medecinPrescripteur: local.medecinId ? (medecinMap.get(local.medecinId) ?? null) : null,
        rendezVous: local.rendezVous ?? null,
        checklistApres: local.checklistApres ?? null,
        dossierCPA: local.dossierCPA ?? null,
        resultatEndoscopie: local.resultatEndoscopie ?? null,
        patient: local.patientId ? (patientMap.get(local.patientId) ?? null) : null,
      }));

    return [...externalRows, ...localOnlyRows];
  }

  /**
   * Prescriptions issues d'une même prescription externe multi-examens (tableau
   * `demandes`) : chaque examen apparaît comme sa propre prescription locale mais
   * partage le même prescriptionExternalId — on renvoie ici uniquement celles dont
   * le groupe compte plus d'un examen.
   */
  async getPrescriptionsMultiExamens(serviceIdOverride?: string) {
    const prescriptions = await this.getPrescriptions(serviceIdOverride);
    const groupSizes = new Map<string, number>();
    for (const p of prescriptions) {
      if (!p.prescriptionExternalId) continue;
      groupSizes.set(p.prescriptionExternalId, (groupSizes.get(p.prescriptionExternalId) ?? 0) + 1);
    }
    return prescriptions.filter(
      (p) => !!p.prescriptionExternalId && (groupSizes.get(p.prescriptionExternalId) ?? 0) > 1,
    );
  }

  /**
   * Prescriptions sans compte-rendu enregistré, dès lors que :
   *  - la checklist après est validée (examen terminé normalement), OU
   *  - une opération a été commencée (panne électrique / interruption en cours).
   */
  async getPendingReports(serviceIdOverride?: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: {
        ...this.scope(serviceIdOverride),
        resultatEndoscopie: null,
        OR: [
          { checklistApres: { estValide: true } },
          { operationEndoscopie: { isNot: null } },
        ],
      },
      include: {
        medecinPrescripteur: true,
        rendezVous: true,
        checklistApres: true,
        operationEndoscopie: { select: { id: true, dateCreation: true } },
      },
      orderBy: {
        dateDemande: 'desc',
      },
    });
    return this.attachPatients(prescriptions);
  }

  /**
   * Retourne une prescription par son ID local ou externe.
   * Si elle n'existe pas encore en local, la crée à la demande depuis l'API externe
   * (nécessaire pour démarrer le workflow : planification, checklist, opération…).
   */
  async getPrescriptionById(id: string, serviceIdOverride?: string) {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const include = {
      medecinPrescripteur: true,
      dossierCPA: { include: { anesthesiste: true } },
      checklistAvant: true,
      checklistApres: true,
      operationEndoscopie: true,
      resultatEndoscopie: true,
      rendezVous: { include: { salle: true } },
    } as const;

    // Cherche par ID local OU par externalId
    let prescription = await this.prisma.prescription.findFirst({
      where: { serviceId, OR: [{ id }, { externalId: id }] },
      include,
    });

    // prescriptionExternalId (regroupement multi-examens) est mis en cache en local dès
    // qu'on le voit en direct côté externe — celui-ci ne renvoyant qu'un sous-ensemble
    // récent/actif des demandes, on retombe sur la valeur mise en cache si l'examen n'y
    // est plus, pour ne pas perdre son rattachement au groupe (voir PatientDossierContent).
    let prescriptionExternalId: string | null = prescription?.prescriptionExternalId ?? null;

    if (!prescription) {
      // Pas encore en local — récupère depuis l'API externe et crée à la demande
      const external = await this.fetchExternalPrescriptions(serviceIdOverride);
      const ext = external.find((e) => e.id === id);
      if (!ext) throw new NotFoundException(`Prescription ${id} introuvable`);
      prescriptionExternalId = ext.prescriptionExternalId ?? null;

      if (ext.prescripteurId) {
        await this.prisma.medecin.upsert({
          where: { id: ext.prescripteurId },
          update: {},
          create: { id: ext.prescripteurId, nom: 'EXTERN', prenom: 'MEDECIN', specialite: null, role: null },
        });
      }

      prescription = await this.prisma.prescription.create({
        data: {
          externalId: ext.id,
          prescriptionExternalId,
          serviceId,
          patientId: ext.patientId,
          medecinId: ext.prescripteurId ?? '',
          typeExamen: ext.typeExamen || 'Endoscopie',
          motif: ext.renseignements || ext.remarques || '',
          priorite: this.mapUrgenceToPriorite(ext.urgence),
          statut: this.mapExternalStatut(ext.statut),
          dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
        },
        include,
      });
    } else if (prescription.externalId) {
      const external = await this.fetchExternalPrescriptions(serviceIdOverride);
      const ext = external.find((e) => e.id === prescription!.externalId);

      // La priorité et le prescriptionExternalId ne sont écrits qu'à la création — si le
      // mapping d'urgence a changé depuis (ex. ancien enum externe) ou si l'urgence source
      // a été corrigée, ce dossier resterait figé sur une valeur périmée alors que le Fil
      // de prescription, lui, recalcule toujours depuis l'externe en direct. On aligne les
      // deux tant que l'examen est encore visible côté externe.
      if (ext) {
        prescriptionExternalId = ext.prescriptionExternalId ?? null;
        const livePriorite = this.mapUrgenceToPriorite(ext.urgence);
        const data: { priorite?: string; prescriptionExternalId?: string | null } = {};
        if (livePriorite !== prescription.priorite) data.priorite = livePriorite;
        if (prescriptionExternalId && prescriptionExternalId !== prescription.prescriptionExternalId) {
          data.prescriptionExternalId = prescriptionExternalId;
        }
        if (Object.keys(data).length) {
          prescription = await this.prisma.prescription.update({
            where: { id: prescription.id },
            data,
            include,
          });
        }
      }
    }

    return { ...(await this.attachPatient(prescription)), prescriptionExternalId };
  }

  /**
   * Résout un prescriptionId (local ou externe) vers l'ID local, en créant la
   * prescription à la demande depuis l'API externe si elle n'existe pas encore
   * (même logique que getPrescriptionById). Utilisé avant toute écriture qui
   * référence prescriptionId comme clé étrangère (ex: création de rendez-vous),
   * pour éviter une violation de contrainte si l'ID fourni est encore l'ID
   * externe et n'a jamais été mirroité localement.
   */
  private async ensureLocalPrescriptionId(id: string, serviceId: string): Promise<string> {
    const existing = await this.prisma.prescription.findFirst({
      where: { serviceId, OR: [{ id }, { externalId: id }] },
      select: { id: true },
    });
    if (existing) return existing.id;

    const external = await this.fetchExternalPrescriptions(serviceId);
    const ext = external.find((e) => e.id === id);
    if (!ext) {
      throw new BadRequestException(`Prescription ${id} introuvable`);
    }

    if (ext.prescripteurId) {
      await this.prisma.medecin.upsert({
        where: { id: ext.prescripteurId },
        update: {},
        create: { id: ext.prescripteurId, nom: 'EXTERN', prenom: 'MEDECIN', specialite: null, role: null },
      });
    }

    const created = await this.prisma.prescription.create({
      data: {
        externalId: ext.id,
        serviceId,
        patientId: ext.patientId,
        medecinId: ext.prescripteurId ?? '',
        typeExamen: ext.typeExamen || 'Endoscopie',
        motif: ext.renseignements || ext.remarques || '',
        priorite: this.mapUrgenceToPriorite(ext.urgence),
        statut: this.mapExternalStatut(ext.statut),
        dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Valeurs distinctes de typeExamen réellement présentes en base (voir getArchives — filtre en égalité stricte). */
  async getArchiveTypesExamen(serviceIdOverride?: string): Promise<string[]> {
    const serviceId = this.getEndoscopieServiceId(serviceIdOverride);
    const rows = await this.prisma.prescription.findMany({
      where: { serviceId },
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
        ...(Object.keys(dateFilter).length ? { dateDemande: dateFilter } : {}),
      },
      include: {
        medecinPrescripteur: true,
        dossierCPA: true,
        checklistAvant: true,
        checklistApres: true,
        resultatEndoscopie: true,
        rendezVous: true,
      },
      orderBy: { dateDemande: 'desc' },
    });

    const withPatient = await this.attachPatients(prescriptions);

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

  async createPrescription(data: CreatePrescriptionDto) {
    const serviceId = this.getEndoscopieServiceId(data.serviceId);

    if (!data.patientId?.trim() || !data.medecinId?.trim()) {
      throw new BadRequestException('patientId et medecinId sont obligatoires');
    }
    if (!data.typeExamen?.trim()) {
      throw new BadRequestException('typeExamen est obligatoire');
    }

    // Vérification patient dans Accueil
    const accueilPatient = await this.getAccueilPatient(data.patientId);
    if (!accueilPatient) {
      throw new BadRequestException(
        `Patient ${data.patientId} introuvable dans le registre Accueil`,
      );
    }

    // Création dans le service prescription externe (obligatoire — source de vérité).
    // L'API externe regroupe les examens sous un tableau `demandes` (une prescription
    // peut porter plusieurs examens, ex. venant d'un autre service) — typeExamen est
    // toujours la première demande, typeExamensSupplementaires ajoute les suivantes.
    const demandesAEnvoyer = [
      { typeExamen: data.typeExamen },
      ...(data.typeExamensSupplementaires || [])
        .filter((t) => t?.trim())
        .map((typeExamen) => ({ typeExamen })),
    ];

    let extResult: ExternalEndoscopiePrescription;
    try {
      const extBody = {
        patientId: data.patientId,
        prescripteurId: data.medecinId,
        renseignements: data.motif || data.typeExamen,
        urgence: this.mapPrioriteToUrgence(data.priorite),
        remarques: '',
        chuId: getEndoscopieChuId(),
        serviceIdSource: serviceId,
        serviceIdDest: serviceId,
        demandes: demandesAEnvoyer,
      };
      const token = await this.getServiceAccountToken();
      const extRes = await fetch(`${getPrescriptionExtApiUrl()}/endoscopie`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(extBody),
        signal: AbortSignal.timeout(20000),
      });
      if (!extRes.ok) {
        const errText = await extRes.text().catch(() => '');
        throw new BadRequestException(
          `Service prescription externe: ${extRes.status}${errText ? ' — ' + errText : ''}`,
        );
      }
      extResult = (await extRes.json()) as ExternalEndoscopiePrescription;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        `Service prescription externe inaccessible: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Médecin prescripteur — upsert stub si inconnu localement
    await this.prisma.medecin.upsert({
      where: { id: data.medecinId },
      update: {},
      create: { id: data.medecinId, nom: 'INCONNU', prenom: 'MEDECIN', specialite: null, role: null },
    });

    // Miroir local depuis la réponse externe — externalId doit pointer sur la
    // demande (pas la prescription parente), pour rester cohérent avec
    // flattenExternalPrescriptions() lors des prochaines synchronisations.
    // Une prescription multi-examens crée une demande externe par examen : chacune
    // est mirée ici comme sa propre prescription locale (même convention que la
    // lecture, voir flattenExternalPrescriptions()), pour apparaître comme une
    // ligne distincte et planifiable indépendamment dans la fil de prescription.
    const demandesRecues = extResult.demandes?.length ? extResult.demandes : [undefined];
    const prescriptionsCreees: unknown[] = [];
    for (const demande of demandesRecues) {
      const prescription = await this.prisma.prescription.create({
        data: {
          externalId: demande?.id ?? extResult.id,
          serviceId,
          patientId: extResult.patientId,
          medecinId: data.medecinId,
          typeExamen: demande?.typeExamen || extResult.typeExamen || data.typeExamen,
          motif: extResult.renseignements || data.motif || '',
          priorite: this.mapUrgenceToPriorite(extResult.urgence) || data.priorite || 'Standard',
          statut: this.mapExternalStatut(demande?.statut ?? extResult.statut),
          dateDemande: extResult.createdAt ? new Date(extResult.createdAt) : new Date(),
        },
        include: { medecinPrescripteur: true },
      });
      const enriched = { ...prescription, patient: this.toPatientView(accueilPatient) };
      prescriptionsCreees.push(enriched);
      // Marquer comme déjà vue pour que pollForNewPrescriptions() ne renotifie pas
      // ces mêmes demandes au prochain cycle (on notifie nous-mêmes juste après).
      this.seenExternalPrescriptionIds?.add(demande?.id ?? extResult.id);
    }
    // Une seule notification pour tout le groupe (multi-examens compris),
    // voir NotificationService.notifyPrescriptionCreated.
    await this.notificationService.notifyPrescriptionCreated(
      prescriptionsCreees as Parameters<
        typeof this.notificationService.notifyPrescriptionCreated
      >[0],
    );

    // Rétrocompatible : un seul examen renvoie l'objet directement (comme avant),
    // plusieurs renvoient le tableau complet des prescriptions créées.
    return prescriptionsCreees.length === 1 ? prescriptionsCreees[0] : prescriptionsCreees;
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
          ...(data.examensComplementaires !== undefined && {
            examensComplementaires: data.examensComplementaires,
          }),
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

    return this.attachPatient(dossier);
  }

  private async notifyBlocCpa(dossier: any, data: CreateDossierCpaDto) {
    const blocUrl = getBlocApiUrl();
    if (!blocUrl) {
      this.logger.warn(
        `BLOC_API_URL non configuré : le dossier CPA ${dossier.id} n'a pas été transmis au Bloc Opératoire.`,
      );
      return;
    }

    // N'envoyer que pour les patients Accueil (format CHU-YYYY-NNNNN)
    const patientId = dossier.patientId ?? '';
    if (!/^CHU-\d{4}-\d+$/.test(patientId)) return;

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

    if (res.ok) {
      const json = await res.json() as { id?: string };
      if (json.id) {
        await this.prisma.dossierCPA.update({
          where: { id: dossier.id },
          data: { blocDemandeId: json.id },
        });
      }
    }
  }

  /**
   * Parcours médical complet du patient (suivis, diagnostics) depuis le microservice
   * Dossier Patient CHU — au-delà de ce qu'on connaît nous-mêmes en Endoscopie. Ce
   * service exige son propre token que nous n'avons pas encore reçu : tant que ce
   * n'est pas le cas, chaque appel échoue en 401 et on renvoie simplement des listes
   * vides plutôt que de casser l'affichage du dossier patient. Dès qu'un token nous
   * sera fourni (voir DOSSIER_PATIENT_API_URL), ceci fonctionnera sans autre changement.
   */
  async getPatientTraceability(patientId: string): Promise<{
    available: boolean;
    suivis: unknown[];
    diagnostics: unknown[];
  }> {
    const baseUrl = getDossierPatientApiUrl();
    const empty = { available: false, suivis: [], diagnostics: [] };
    if (!baseUrl) return empty;

    const chuId = getEndoscopieAuthChuId() ?? getEndoscopieChuId();
    const serviceId = getEndoscopieAuthServiceId() ?? getEndoscopieServiceId();
    const qs = `chuId=${encodeURIComponent(chuId)}&serviceId=${encodeURIComponent(serviceId)}`;

    // `available` ne doit être vrai que si le service a réellement répondu (200) — sinon
    // un 401 (token propre pas encore fourni) afficherait à tort "aucun suivi" au lieu de
    // "pas encore accessible".
    const fetchList = async (path: string): Promise<{ ok: boolean; items: unknown[] }> => {
      try {
        const res = await fetch(`${baseUrl}${path}?${qs}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return { ok: false, items: [] };
        const data = await res.json();
        return { ok: true, items: Array.isArray(data) ? data : [] };
      } catch {
        return { ok: false, items: [] };
      }
    };

    const [suivis, diagnostics] = await Promise.all([
      fetchList(`/patients/${encodeURIComponent(patientId)}/suivis`),
      fetchList(`/observations/diagnostics/patient/${encodeURIComponent(patientId)}`),
    ]);

    return {
      available: suivis.ok && diagnostics.ok,
      suivis: suivis.items,
      diagnostics: diagnostics.items,
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

    // Garantit que les clés étrangères référencées existent réellement en local
    // avant l'écriture — évite les violations de contrainte (P2003) lorsque le
    // médecin ou la prescription proviennent de l'API externe et n'ont pas encore
    // été mirroités localement (ex: sélection depuis le fil de prescription sans
    // être jamais passé par getPrescriptionById).
    if (data.medecinId) {
      await this.prisma.medecin.upsert({
        where: { id: data.medecinId },
        update: {},
        create: { id: data.medecinId, nom: 'EXTERN', prenom: 'MEDECIN', specialite: null, role: null },
      });
    }
    const resolvedPrescriptionId = data.prescriptionId
      ? await this.ensureLocalPrescriptionId(data.prescriptionId, serviceId)
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
    // en excluant le RDV qu'on est en train de replanifier (même prescriptionId) et les
    // rendez-vous annulés/terminés.
    const overlapWhere = (extra: Record<string, unknown>) => ({
      serviceId,
      ...extra,
      ...(resolvedPrescriptionId ? { prescriptionId: { not: resolvedPrescriptionId } } : {}),
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

    await this.markTermineIfComplete(data.prescriptionId);

    return checklist;
  }

  /**
   * Marque la prescription (et son rendez-vous) "Terminé" dès que la checklist
   * après-examen est validée ET que le compte rendu existe — signal fiable réutilisé
   * par l'archive et le rapport, au lieu de le redéduire à chaque affichage.
   */
  private async markTermineIfComplete(prescriptionId: string) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: { checklistApres: true, resultatEndoscopie: true, rendezVous: true },
    });
    if (!prescription) return;
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
