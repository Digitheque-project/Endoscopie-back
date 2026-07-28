import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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
  private readonly logger = new Logger(AppService.name);
  private accueilCache: { patients: AccueilPatientRaw[]; expiresAt: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private notificationInboxService: NotificationInboxService,
    private serviceSourceService: ServiceSourceService,
    private medecinsService: MedecinsService,
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

  async getPrescriptions(serviceIdOverride?: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: this.scope(serviceIdOverride),
      include: {
        rendezVous: true,
        checklistApres: true,
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
   * Vérifie manuellement le statut d'une demande CPA auprès du Bloc Opératoire
   * (GET /demandes-cpa-externes/:id/statut, public — pas de JWT requis). Sert de
   * filet de sécurité si le webhook de callback (CPA_RESULTAT/VPA_REALISEE) n'est
   * jamais arrivé (Bloc endormi au moment de la décision, callback perdu, etc.) :
   * applique localement la décision si le Bloc en a une, comme le ferait le webhook.
   */
  async verifierStatutCpaBloc(id: string, serviceIdOverride?: string) {
    const dossier = await this.getDossierCpaById(id, serviceIdOverride);
    if (!dossier.blocDemandeId) {
      return { ...dossier, blocSync: 'non_transmis' as const };
    }

    const blocUrl = getBlocApiUrl();
    if (!blocUrl) {
      return { ...dossier, blocSync: 'bloc_non_configure' as const };
    }

    let remote: Record<string, unknown>;
    try {
      const res = await fetch(
        `${blocUrl}/demandes-cpa-externes/${dossier.blocDemandeId}/statut`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) {
        return { ...dossier, blocSync: 'erreur_bloc' as const };
      }
      remote = (await res.json()) as Record<string, unknown>;
    } catch (e) {
      this.logger.warn(
        `Vérification statut CPA Bloc échouée pour ${dossier.blocDemandeId}: ${e instanceof Error ? e.message : e}`,
      );
      return { ...dossier, blocSync: 'erreur_reseau' as const };
    }

    // Forme de la réponse non documentée côté Bloc : on tente les emplacements les
    // plus probables plutôt que de supposer un schéma strict.
    const cpa = (remote['cpa'] as Record<string, unknown>) ?? remote;
    const decision =
      (cpa['decision'] as string | undefined) ??
      (cpa['decisionCpa'] as string | undefined);
    const dateCpaRaw = cpa['dateCpa'] as string | undefined;
    const dateVpaRaw =
      (remote['dateVpa'] as string | undefined) ??
      (cpa['dateVpa'] as string | undefined);
    const observations = cpa['observations'] as string | undefined;

    if (!decision && !dateVpaRaw) {
      // Rien de nouveau côté Bloc : toujours en attente.
      return { ...dossier, blocSync: 'en_attente' as const };
    }

    const statutMap: Record<string, string> = {
      APTE: 'CPA Favorable',
      INAPTE: 'CPA Défavorable',
      REPORT: 'CPA Reportée',
    };
    const cascadeStatutMap: Record<string, string> = {
      APTE: 'Confirmé',
      INAPTE: 'CPA Défavorable',
      REPORT: 'CPA Reportée',
    };

    const updated = await this.prisma.dossierCPA.update({
      where: { id: dossier.id },
      data: {
        ...(decision && {
          decisionCpa: decision,
          statut: statutMap[decision] ?? dossier.statut,
        }),
        ...(dateCpaRaw && { dateCpa: parseDateTimeAsUtc(dateCpaRaw) }),
        ...(dateVpaRaw && {
          dateVpa: parseDateTimeAsUtc(dateVpaRaw),
          dateValidation: parseDateTimeAsUtc(dateVpaRaw),
        }),
        ...(observations && { observations }),
      },
      include: { prescription: true },
    });

    if (decision && cascadeStatutMap[decision] && dossier.prescriptionId) {
      const cascadeStatut = cascadeStatutMap[decision];
      await this.prisma.prescription.update({
        where: { id: dossier.prescriptionId },
        data: { statut: cascadeStatut },
      });
      await this.prisma.rendezVous.updateMany({
        where: { prescriptionId: dossier.prescriptionId },
        data: { statut: cascadeStatut },
      });
    }

    const withMedecin = await this.medecinsService.attachMedecin(
      updated,
      'anesthesisteId',
      'anesthesiste',
    );
    return { ...(await this.attachPatient(withMedecin)), blocSync: 'synchronise' as const };
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

    const resolvedPrescriptionId = data.prescriptionId ?? null;

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

    const withMedecin = await this.medecinsService.attachMedecin(
      updated,
      'medecinId',
      'medecin',
    );
    return this.attachPatient(withMedecin);
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
