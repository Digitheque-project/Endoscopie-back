import { Injectable, Logger } from '@nestjs/common';
import { DossierCPA } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getBlocApiUrl } from '../config/endoscopie-service';
import { parseDateTimeAsUtc } from '../utils/datetime.util';
import { getCurrentUserToken } from '../auth/request-context';
import { MedecinsService } from './medecins.service';

export type CpaBlocSyncStatus =
  | 'synchronise'
  | 'en_attente'
  | 'non_transmis'
  | 'bloc_non_configure'
  | 'erreur_bloc'
  | 'erreur_reseau'
  | 'dossier_introuvable';

export interface CpaBlocSyncResult {
  status: CpaBlocSyncStatus;
  dossier: DossierCPA | null;
}

const STATUT_MAP: Record<string, string> = {
  APTE: 'CPA Favorable',
  INAPTE: 'CPA Défavorable',
  REPORT: 'CPA Reportée',
};

// Statut cascadé sur Prescription/RendezVous pour que le patient ne reste pas bloqué
// indéfiniment sur "CPA demandée" côté Major/Médecin.
const CASCADE_STATUT_MAP: Record<string, string> = {
  APTE: 'Confirmé',
  INAPTE: 'CPA Défavorable',
  REPORT: 'CPA Reportée',
};

/**
 * Synchronisation du résultat de CPA/VPA depuis le Bloc Opératoire — logique partagée
 * entre le bouton manuel "Vérifier statut CPA" (AppService) et le traitement automatique
 * des notifications CPA_RESULTAT/VPA_REALISEE (NotificationInboxService).
 *
 * Confirmé avec le développeur du Bloc : la notification sert uniquement de signal
 * ("c'est terminé"), pas de source de vérité — le contenu exact de son payload n'est
 * pas documenté/garanti. Dès qu'une notification arrive (ou sur demande manuelle), on
 * fait un GET explicite vers le Bloc pour récupérer le résultat authoritative, plutôt
 * que de faire confiance aux champs bruts de la notification elle-même.
 */
@Injectable()
export class CpaBlocService {
  private readonly logger = new Logger(CpaBlocService.name);

  constructor(
    private prisma: PrismaService,
    private medecinsService: MedecinsService,
  ) {}

  async synchroniserDepuisBloc(dossierId: string): Promise<CpaBlocSyncResult> {
    const dossier = await this.prisma.dossierCPA.findUnique({
      where: { id: dossierId },
    });
    if (!dossier) {
      return { status: 'dossier_introuvable', dossier: null };
    }
    if (!dossier.blocDemandeId) {
      return { status: 'non_transmis', dossier };
    }

    const blocUrl = getBlocApiUrl();
    if (!blocUrl) {
      return { status: 'bloc_non_configure', dossier };
    }

    let remote: Record<string, unknown>;
    try {
      // Passé par le gateway CHU : jeton Bearer obligatoire.
      const token = getCurrentUserToken() ?? (await this.medecinsService.getServiceAccountToken());
      const res = await fetch(
        `${blocUrl}/demandes-cpa-externes/${dossier.blocDemandeId}/statut`,
        {
          signal: AbortSignal.timeout(8000),
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!res.ok) {
        this.logger.warn(
          `Vérification statut CPA Bloc : réponse ${res.status} pour ${dossier.blocDemandeId}`,
        );
        return { status: 'erreur_bloc', dossier };
      }
      remote = (await res.json()) as Record<string, unknown>;
    } catch (e) {
      this.logger.warn(
        `Vérification statut CPA Bloc échouée pour ${dossier.blocDemandeId}: ${e instanceof Error ? e.message : e}`,
      );
      return { status: 'erreur_reseau', dossier };
    }

    // Forme de la réponse non documentée côté Bloc : on tente les emplacements les
    // plus probables plutôt que de supposer un schéma strict.
    const cpa = (remote['cpa'] as Record<string, unknown>) ?? remote;
    const decision =
      (cpa['decision'] as string | undefined) ??
      (cpa['decisionCpa'] as string | undefined);
    const dateCpaRaw = cpa['dateCpa'] as string | undefined;
    const dateVpaRaw =
      (remote['dateVpa'] as string | undefined) ?? (cpa['dateVpa'] as string | undefined);
    const observations = cpa['observations'] as string | undefined;

    if (!decision && !dateVpaRaw) {
      // Rien de nouveau côté Bloc : toujours en attente.
      return { status: 'en_attente', dossier };
    }

    const updated = await this.prisma.dossierCPA.update({
      where: { id: dossier.id },
      data: {
        ...(decision && {
          decisionCpa: decision,
          statut: STATUT_MAP[decision] ?? dossier.statut,
        }),
        ...(dateCpaRaw && { dateCpa: parseDateTimeAsUtc(dateCpaRaw) }),
        ...(dateVpaRaw && {
          dateVpa: parseDateTimeAsUtc(dateVpaRaw),
          dateValidation: parseDateTimeAsUtc(dateVpaRaw),
        }),
        ...(observations && { observations }),
      },
    });

    if (decision && CASCADE_STATUT_MAP[decision] && dossier.prescriptionId) {
      const cascadeStatut = CASCADE_STATUT_MAP[decision];
      await this.prisma.prescription.update({
        where: { id: dossier.prescriptionId },
        data: { statut: cascadeStatut },
      });
      await this.prisma.rendezVous.updateMany({
        where: { prescriptionId: dossier.prescriptionId },
        data: { statut: cascadeStatut },
      });
    }

    this.logger.log(
      `CPA synchronisée depuis le Bloc pour le dossier ${dossier.id}: ${decision ?? 'VPA_REALISEE'}`,
    );
    return { status: 'synchronise', dossier: updated };
  }
}
