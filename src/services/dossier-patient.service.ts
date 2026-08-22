import { Injectable, Logger } from '@nestjs/common';
import {
  getDossierPatientApiUrl,
  getEndoscopieAuthChuId,
  getEndoscopieChuId,
  getEndoscopieAuthServiceId,
  getEndoscopieServiceId,
} from '../config/endoscopie-service';
import { getCurrentUserToken } from '../auth/request-context';
import { MedecinsService } from './medecins.service';
import { PrismaService } from '../prisma/prisma.service';

interface DossierPatientContext {
  baseUrl: string;
  chuId: string;
  serviceId: string;
  token: string | null;
}

/**
 * Proxy en lecture seule vers le microservice Dossier Patient CHU (DOSSIER_PATIENT_API_URL)
 * — observations, diagnostics, suivis, paramètres, historique, résultats paracliniques.
 * Volontairement lecture seule : ce dossier est propriété partagée de l'écosystème CHU
 * (rempli par les services qui prennent réellement en charge le patient) — Endoscopie ne
 * fait que le consulter, jamais le modifier ni le compléter depuis cette interface.
 * Même mécanisme d'authentification que fetchExternalPrescriptionsFor/getPatientTraceability
 * dans AppService : jeton de l'utilisateur courant si présent, sinon le jeton du compte de
 * service partagé de l'écosystème CHU (vérifié fonctionnel contre ce service).
 */
@Injectable()
export class DossierPatientService {
  private readonly logger = new Logger(DossierPatientService.name);

  constructor(
    private readonly medecinsService: MedecinsService,
    private readonly prisma: PrismaService,
  ) {}

  private async context(): Promise<DossierPatientContext | null> {
    const baseUrl = getDossierPatientApiUrl();
    if (!baseUrl) return null;
    const chuId = getEndoscopieAuthChuId() ?? getEndoscopieChuId();
    const serviceId = getEndoscopieAuthServiceId() ?? getEndoscopieServiceId();
    const token = getCurrentUserToken() ?? (await this.medecinsService.getServiceAccountToken());
    return { baseUrl, chuId, serviceId, token };
  }

  private headers(token: string | null): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * Certains endpoints de ce service (historique, résultats) sont encore des stubs même
   * côté application de référence (front-clinique) — une erreur/404 doit se traduire par
   * une liste vide plutôt que casser l'affichage de l'onglet correspondant.
   */
  private async getList(path: string, extraParams?: Record<string, string>): Promise<unknown[]> {
    const ctx = await this.context();
    if (!ctx) return [];
    const params = new URLSearchParams({ chuId: ctx.chuId, serviceId: ctx.serviceId, ...extraParams });
    try {
      const res = await fetch(`${ctx.baseUrl}${path}?${params}`, {
        headers: this.headers(ctx.token),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      this.logger.warn(`Dossier Patient CHU — échec ${path}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  // Observations
  getObservations(patientId: string) {
    return this.getList(`/observations/patient/${encodeURIComponent(patientId)}`);
  }

  // Diagnostics
  getDiagnostics(patientId: string) {
    return this.getList('/diagnostics', { patientId });
  }

  // Suivis quotidiens
  getSuivis(patientId: string) {
    return this.getList(`/patients/${encodeURIComponent(patientId)}/suivis`);
  }

  // Paramètres (relevés)
  getParametres(patientId: string) {
    return this.getList(`/patients/${encodeURIComponent(patientId)}/parametres`);
  }

  // Historique d'actions — pas encore implémenté côté service au moment de l'écriture,
  // toléré vide (voir getList).
  getHistorique(patientId: string) {
    return this.getList(`/patients/${encodeURIComponent(patientId)}/historique`);
  }

  // Résultats paracliniques — fusionne les résultats des autres services du CHU (externe,
  // peut renvoyer une liste vide si pas encore implémenté côté service) avec les comptes
  // rendus déjà rédigés dans Endoscopie (locaux) : sans ça, un médecin consultant le
  // dossier patient ne voyait jamais ses propres comptes rendus ici, alors qu'ils
  // existent bel et bien (visibles séparément dans Archives). Lecture seule des deux
  // côtés — jamais écrit vers le service externe (voir commentaire de la classe).
  async getResultats(patientId: string) {
    const [externes, locaux] = await Promise.all([
      this.getList(`/patients/${encodeURIComponent(patientId)}/resultats`),
      this.getEndoscopieResultats(patientId),
    ]);
    return [...locaux, ...externes].sort((a: any, b: any) => {
      const dateA = a?.date ? new Date(a.date).getTime() : 0;
      const dateB = b?.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });
  }

  private async getEndoscopieResultats(patientId: string) {
    try {
      const serviceId = getEndoscopieServiceId();
      const resultats = await this.prisma.resultatEndoscopie.findMany({
        where: { patientId, serviceId },
        include: { prescription: true },
        orderBy: { dateCreation: 'desc' },
      });
      return resultats.map((r) => ({
        id: `endoscopie-${r.id}`,
        titre: r.prescription?.typeExamen
          ? `Endoscopie — ${r.prescription.typeExamen}`
          : "Compte rendu d'endoscopie",
        type: 'endoscopie',
        statut: 'disponible',
        date: r.dateCreation,
        description: r.conclusion || r.observations || undefined,
      }));
    } catch (e) {
      this.logger.warn(
        `Résultats Endoscopie locaux — échec pour patient ${patientId}: ${e instanceof Error ? e.message : e}`,
      );
      return [];
    }
  }
}
