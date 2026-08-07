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

  constructor(private readonly medecinsService: MedecinsService) {}

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

  // Résultats paracliniques — idem, pas encore implémenté côté service.
  getResultats(patientId: string) {
    return this.getList(`/patients/${encodeURIComponent(patientId)}/resultats`);
  }
}
