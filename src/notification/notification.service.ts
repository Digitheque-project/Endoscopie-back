import { Injectable, Logger, Optional } from '@nestjs/common';
import { getEndoscopieAuthServiceId, getEndoscopieServiceId } from '../config/endoscopie-service';
import { getNotificationApiUrl } from '../config/notification-service';
import { CreateNotificationPayload } from './notification.types';
import { NotificationInboxService } from './notification-inbox.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Optional() private readonly inbox?: NotificationInboxService,
  ) {}

  private get baseUrl(): string {
    return getNotificationApiUrl();
  }

  /**
   * Envoie une notification temps réel à tout le service Endoscopie via
   * POST /notifications/service (voir service-notification-nlqp.onrender.com/api/docs) —
   * ce service notifie par serviceId + WebSocket, pas par le modèle
   * emitter/recipient/motif utilisé auparavant. On traduit notre payload interne
   * vers son schéma (NotifyServiceDto), et on garde tout le détail métier
   * (patientId, entiteRef*, urgence, channels...) dans `data` pour ne rien perdre.
   */
  async createNotification(
    payload: CreateNotificationPayload,
  ): Promise<unknown | null> {
    const body = {
      serviceId: getEndoscopieAuthServiceId() ?? getEndoscopieServiceId(),
      title: payload.recipientName || payload.emitterName || 'Notification Endoscopie',
      message: payload.motif,
      type: payload.type || 'info',
      source: payload.emitter || 'endoscopie-back',
      data: {
        ...(payload.payload ?? {}),
        motif: payload.motif,
        urgence: payload.urgence,
        patientId: payload.patientId,
        entiteRefType: payload.entiteRefType,
        entiteRefId: payload.entiteRefId,
        channels: payload.channels,
        departmentSource: payload.departmentSource,
        departmentTarget: payload.departmentTarget,
      },
    };
    try {
      const res = await fetch(`${this.baseUrl}/notifications/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(`POST /notifications/service ${res.status}: ${text}`);
        this.pushToInbox({}, payload);
        return null;
      }
      const created = (await res.json()) as Record<string, unknown>;
      this.pushToInbox(created, payload);
      return created;
    } catch (error) {
      this.logger.warn(
        `POST /notifications/service failed: ${error instanceof Error ? error.message : error}`,
      );
      // Le service externe est indisponible ou injoignable : on pousse quand même
      // dans la boîte locale pour que la cloche/le flux temps réel restent fiables.
      this.pushToInbox({}, payload);
      return null;
    }
  }

  /**
   * Liste les notifications pour l'affichage initial de la cloche (au chargement,
   * avant que le flux SSE local ne prenne le relais). Le nouveau service
   * notification n'expose plus de filtrage par service (GET /notifications
   * renvoie tout, tous services confondus) — on lit donc la boîte locale, déjà
   * filtrée pour Endoscopie au moment de la réception (voir NotificationInboxService.receive).
   */
  async listNotifications(
    status = 'ENVOYE',
    serviceId?: string,
  ): Promise<{
    serviceId: string;
    status: string;
    total: number;
    items: Record<string, unknown>[];
  }> {
    const sid = getEndoscopieServiceId(serviceId);
    const items = (this.inbox?.listInbox(100) ?? []).map((item) => ({
      ...item,
      createdAt: item.receivedAt,
    }));
    return { serviceId: sid, status, total: items.length, items };
  }

  async checkHealth(): Promise<{ ok: boolean; status?: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false };
    }
  }

  private pushToInbox(
    remote: Record<string, unknown>,
    fallback: CreateNotificationPayload,
  ): void {
    if (!this.inbox) return;
    try {
      const mergedPayload = {
        ...(fallback.payload ?? {}),
        ...((remote.data as Record<string, unknown>) ?? {}),
        sourceServiceId: getEndoscopieAuthServiceId() ?? getEndoscopieServiceId(),
        sourceServiceName: 'Unité Endoscopie',
      };
      this.inbox.receive(
        {
          id: remote.id as string | undefined,
          type: (remote.type as string) ?? fallback.type,
          motif: (remote.motif as string) ?? fallback.motif,
          urgence: (remote.urgence as number) ?? fallback.urgence,
          statut: (remote.statut as string) ?? 'ENVOYE',
          emitter: fallback.emitter,
          emetteur_name:
            (remote.emetteur_name as string) ?? fallback.emitterName,
          patientId: (remote.patientId as string) ?? fallback.patientId,
          entiteRefType: fallback.entiteRefType,
          entiteRefId: fallback.entiteRefId,
          payload: mergedPayload,
          // La date métier fournie par l'appelant (ex. dateDemande de la prescription)
          // prévaut toujours sur celle du service notification externe, qui ne reflète
          // que l'instant de cet appel, pas l'origine réelle de l'événement.
          created_at: fallback.createdAt ?? (remote.created_at as string | undefined),
        },
        { source: 'endoscopie-back' },
      );
    } catch (e) {
      this.logger.warn(
        `Inbox push failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Envoie UNE notification pour une prescription — ou pour un groupe de prescriptions
   * issues d'une même prescription externe multi-examens (ex. Coloscopie + Fibroscopie
   * pour le même patient) : dans ce cas, une seule notification/son couvrant tous les
   * examens, pas une par examen (voir pollForNewPrescriptions).
   */
  async notifyPrescriptionCreated(
    prescription:
      | {
          id: string;
          patientId: string;
          typeExamen: string;
          motif?: string | null;
          patient?: { nom: string; prenom: string } | null;
          medecinPrescripteur?: { nom: string; prenom: string } | null;
          createdAt?: string | Date | null;
        }
      | Array<{
          id: string;
          patientId: string;
          typeExamen: string;
          motif?: string | null;
          patient?: { nom: string; prenom: string } | null;
          medecinPrescripteur?: { nom: string; prenom: string } | null;
          createdAt?: string | Date | null;
        }>,
  ): Promise<unknown | null> {
    const list = Array.isArray(prescription) ? prescription : [prescription];
    const primary = list[0];
    if (!primary) return null;

    const patientName = primary.patient
      ? `${primary.patient.prenom} ${primary.patient.nom}`.trim()
      : 'Patient';
    const medecinName = primary.medecinPrescripteur
      ? `Dr. ${primary.medecinPrescripteur.prenom} ${primary.medecinPrescripteur.nom}`.trim()
      : 'Médecin';
    const typeExamenLabel = list.map((p) => p.typeExamen).join(' + ');

    return this.createNotification({
      type: 'DEMANDE_EXAMEN',
      motif: `Nouvelle prescription endoscopie — ${typeExamenLabel}`,
      urgence: 3,
      emitter: getEndoscopieAuthServiceId() ?? getEndoscopieServiceId(),
      emitterName: 'Unité Endoscopie',
      recipient: 'endoscopie-planification',
      recipientName: 'Planification examens',
      departmentSource: 'Endoscopie',
      departmentTarget: 'Planification',
      patientId: primary.patientId,
      entiteRefType: 'Prescription',
      entiteRefId: primary.id,
      channels: ['INTERNAL', 'SOUND'],
      createdAt: primary.createdAt
        ? new Date(primary.createdAt).toISOString()
        : undefined,
      payload: {
        sourceServiceId: getEndoscopieAuthServiceId() ?? getEndoscopieServiceId(),
        sourceServiceName: 'Unité Endoscopie',
        patientName,
        medecinName,
        motif: primary.motif ?? '',
        typeExamen: typeExamenLabel,
      },
    });
  }
}
