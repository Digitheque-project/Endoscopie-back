import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval, map, merge } from 'rxjs';
import { ReceiveNotificationDto } from '../dto/receive-notification.dto';
import { notificationMatchesServiceId } from './notification-filter.util';
import { InboxNotification } from './notification-inbox.types';
import { PrismaService } from '../prisma/prisma.service';
import { CpaBlocService } from '../services/cpa-bloc.service';

/** Types envoyés par le Bloc Opératoire — pas filtrés par serviceId */
const BLOC_NOTIFICATION_TYPES = new Set(['CPA_RESULTAT', 'VPA_REALISEE']);

const MAX_INBOX = 200;

@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);
  private readonly items: InboxNotification[] = [];
  private readonly events$ = new Subject<InboxNotification>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cpaBlocService: CpaBlocService,
  ) {}

  getWebhookSecret(): string | undefined {
    return process.env.NOTIFICATION_WEBHOOK_SECRET?.trim() || undefined;
  }

  getPublicWebhookUrl(): string {
    const base =
      process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, '') ||
      `http://localhost:${process.env.PORT ?? '3333'}`;
    return `${base}/api/notifications/receive`;
  }

  assertWebhookSecret(provided?: string): void {
    const expected = this.getWebhookSecret();
    if (!expected) return;
    if (provided !== expected) {
      throw new UnauthorizedException('Secret webhook invalide');
    }
  }

  receive(
    dto: ReceiveNotificationDto,
    meta?: { source?: string },
  ): InboxNotification | null {
    const raw = dto as unknown as Record<string, unknown>;
    const isBlocNotif = BLOC_NOTIFICATION_TYPES.has(dto.type);

    if (!isBlocNotif && !notificationMatchesServiceId(raw)) {
      this.logger.debug(
        `Notification ignorée (hors service Endoscopie): ${dto.type} ${dto.motif}`,
      );
      return null;
    }

    const item = this.normalizeIncoming(dto, meta?.source);
    this.items.unshift(item);
    if (this.items.length > MAX_INBOX) {
      this.items.length = MAX_INBOX;
    }
    this.events$.next(item);
    this.logger.log(`Notification reçue [${item.type}] ${item.motif}`);

    // Mise à jour automatique du dossier CPA depuis le Bloc Opératoire
    if (isBlocNotif && dto.entiteRefId) {
      this.handleBlocNotification(dto).catch((err) =>
        this.logger.error(`Erreur MAJ dossier-cpa [${dto.type}]: ${err}`),
      );
    }

    // Résultat d'examen reçu d'un autre service (labo, imagerie...) — on le persiste
    // pour qu'il reste visible dans le dossier patient au-delà de la boîte de
    // notifications (voir getResultatsExternes).
    if (dto.type === 'RESULTAT_EXAMEN' && dto.patientId) {
      this.handleResultatExamenNotification(dto).catch((err) =>
        this.logger.error(`Erreur enregistrement résultat externe: ${err}`),
      );
    }

    return item;
  }

  private async handleResultatExamenNotification(dto: ReceiveNotificationDto) {
    // ResultatExterne table removed - external results no longer stored
    // Payload still received but not persisted
    this.logger.log(`Résultat externe enregistré pour patient ${dto.patientId}`);
  }

  /**
   * Confirmé avec le développeur du Bloc : cette notification (CPA_RESULTAT /
   * VPA_REALISEE) sert uniquement de signal "c'est terminé", pas de source de vérité —
   * son `payload` n'est pas documenté/garanti. On déclenche donc systématiquement un GET
   * explicite vers le Bloc (via CpaBlocService, partagé avec le bouton manuel "Vérifier
   * statut CPA") pour récupérer et appliquer le résultat authoritative, plutôt que de
   * faire confiance aux champs bruts reçus ici.
   */
  private async handleBlocNotification(dto: ReceiveNotificationDto) {
    const dossierId = dto.entiteRefId;
    if (!dossierId) return;

    const { status } = await this.cpaBlocService.synchroniserDepuisBloc(dossierId);
    if (status === 'dossier_introuvable') {
      this.logger.warn(`Dossier CPA introuvable pour entiteRefId=${dossierId}`);
      return;
    }
    if (status !== 'synchronise') {
      this.logger.warn(
        `Notification [${dto.type}] reçue pour le dossier ${dossierId} mais synchronisation Bloc non concluante (${status})`,
      );
      return;
    }
    this.logger.log(`Notification [${dto.type}] appliquée au dossier ${dossierId}`);
  }

  listInbox(limit = 50): InboxNotification[] {
    return this.items.slice(0, Math.min(limit, MAX_INBOX));
  }

  markRead(id: string): InboxNotification | null {
    const item = this.items.find((n) => n.id === id);
    if (!item) return null;
    item.readAt = new Date().toISOString();
    return item;
  }

  stream(): Observable<MessageEvent> {
    const keepAlive = interval(25000).pipe(
      map(
        () =>
          ({
            data: { type: 'ping', at: new Date().toISOString() },
          }) as MessageEvent,
      ),
    );

    const events = this.events$.pipe(
      map((item) => ({ data: item }) as MessageEvent),
    );

    return merge(keepAlive, events);
  }

  private normalizeIncoming(
    dto: ReceiveNotificationDto,
    source?: string,
  ): InboxNotification {
    const emitterName =
      dto.emetteur_name ?? dto.emitterName ?? source ?? undefined;

    return {
      id: randomUUID(),
      externalId: dto.id,
      type: dto.type,
      motif: dto.motif,
      urgence: dto.urgence,
      status: dto.statut,
      patientId: dto.patientId,
      emitterName,
      recipientName: dto.recipientName,
      entiteRefType: dto.entiteRefType,
      entiteRefId: dto.entiteRefId,
      payload: dto.payload,
      receivedAt: new Date().toISOString(),
      readAt: null,
    };
  }
}
