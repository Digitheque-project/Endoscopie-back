import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval, map, merge } from 'rxjs';
import { getEndoscopieServiceId } from '../config/endoscopie-service';
import { ReceiveNotificationDto } from '../dto/receive-notification.dto';
import { notificationMatchesServiceId } from './notification-filter.util';
import { InboxNotification } from './notification-inbox.types';
import { PrismaService } from '../prisma/prisma.service';

/** Types envoyés par le Bloc Opératoire — pas filtrés par serviceId */
const BLOC_NOTIFICATION_TYPES = new Set(['CPA_RESULTAT', 'VPA_REALISEE']);

const MAX_INBOX = 200;

@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);
  private readonly items: InboxNotification[] = [];
  private readonly events$ = new Subject<InboxNotification>();

  constructor(private readonly prisma: PrismaService) {}

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

    if (!isBlocNotif && !notificationMatchesServiceId(raw, getEndoscopieServiceId())) {
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

    return item;
  }

  private async handleBlocNotification(dto: ReceiveNotificationDto) {
    const dossierId = dto.entiteRefId;
    if (!dossierId) return;

    const dossier = await this.prisma.dossierCPA.findUnique({
      where: { id: dossierId },
    });
    if (!dossier) {
      this.logger.warn(`Dossier CPA introuvable pour entiteRefId=${dossierId}`);
      return;
    }

    const payload = dto.payload ?? {};

    if (dto.type === 'CPA_RESULTAT') {
      const decision = payload['decision'] as string | undefined;
      const dateCpaRaw = payload['dateCpa'] as string | undefined;
      const observations = payload['observations'] as string | undefined;

      const statutMap: Record<string, string> = {
        APTE: 'CPA Favorable',
        INAPTE: 'CPA Défavorable',
        REPORT: 'CPA Reportée',
      };

      await this.prisma.dossierCPA.update({
        where: { id: dossierId },
        data: {
          ...(decision && { decisionCpa: decision, statut: statutMap[decision] ?? dossier.statut }),
          ...(dateCpaRaw && { dateCpa: new Date(dateCpaRaw) }),
          ...(observations && { observations }),
        },
      });
      this.logger.log(`CPA_RESULTAT appliqué au dossier ${dossierId}: ${decision}`);
    }

    if (dto.type === 'VPA_REALISEE') {
      const dateVpaRaw = payload['dateVpa'] as string | undefined;
      await this.prisma.dossierCPA.update({
        where: { id: dossierId },
        data: {
          statut: 'VPA Réalisée',
          ...(dateVpaRaw && { dateVpa: new Date(dateVpaRaw) }),
          dateValidation: dateVpaRaw ? new Date(dateVpaRaw) : new Date(),
        },
      });
      this.logger.log(`VPA_REALISEE appliqué au dossier ${dossierId}`);
    }
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
