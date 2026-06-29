import { Injectable, Logger, Optional } from '@nestjs/common';
import { getEndoscopieServiceId } from '../config/endoscopie-service';
import { getNotificationApiUrl } from '../config/notification-service';
import { CreateNotificationPayload } from './notification.types';
import { NotificationInboxService } from './notification-inbox.service';
import { filterNotificationsByServiceId } from './notification-filter.util';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Optional() private readonly inbox?: NotificationInboxService,
  ) {}

  private get baseUrl(): string {
    return getNotificationApiUrl();
  }

  async createNotification(
    payload: CreateNotificationPayload,
  ): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.baseUrl}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(`POST /notifications ${res.status}: ${text}`);
        return null;
      }
      const created = (await res.json()) as Record<string, unknown>;
      this.pushToInbox(created, payload);
      return created;
    } catch (error) {
      this.logger.warn(
        `POST /notifications failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

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
    try {
      const res = await fetch(
        `${this.baseUrl}/notifications?status=${encodeURIComponent(status)}`,
      );

      // If remote service returns non-OK, log and return empty list instead of throwing
      if (!res.ok) {
        const text = await res.text().catch(() => '<no-body>');
        this.logger.warn(`GET /notifications ${res.status}: ${text}`);
        return { serviceId: sid, status, total: 0, items: [] };
      }

      // Parse body defensively: try json, fallback to text and handle parse errors
      let data: unknown;
      try {
        data = await res.json();
      } catch (parseErr) {
        const raw = await res.text().catch(() => '');
        this.logger.warn(
          `Failed to parse /notifications response JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}; rawLength=${raw.length}`,
        );
        return { serviceId: sid, status, total: 0, items: [] };
      }

      const list = (
        Array.isArray(data)
          ? data
          : ((data as { items?: unknown[] })?.items ?? [])
      ) as Record<string, unknown>[];

      const items = filterNotificationsByServiceId(list, sid);
      return {
        serviceId: sid,
        status,
        total: items.length,
        items,
      };
    } catch (err) {
      this.logger.warn(`listNotifications failed: ${err instanceof Error ? err.message : String(err)}`);
      return { serviceId: sid, status, total: 0, items: [] };
    }
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
        ...((remote.payload as Record<string, unknown>) ?? {}),
        sourceServiceId: getEndoscopieServiceId(),
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
          created_at: remote.created_at as string | undefined,
        },
        { source: 'endoscopie-back' },
      );
    } catch (e) {
      this.logger.warn(
        `Inbox push failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async notifyPrescriptionCreated(prescription: {
    id: string;
    patientId: string;
    typeExamen: string;
    motif?: string | null;
    patient?: { nom: string; prenom: string } | null;
    medecinPrescripteur?: { nom: string; prenom: string } | null;
  }): Promise<unknown | null> {
    const patientName = prescription.patient
      ? `${prescription.patient.prenom} ${prescription.patient.nom}`.trim()
      : 'Patient';
    const medecinName = prescription.medecinPrescripteur
      ? `Dr. ${prescription.medecinPrescripteur.prenom} ${prescription.medecinPrescripteur.nom}`.trim()
      : 'Médecin';

    return this.createNotification({
      type: 'DEMANDE_EXAMEN',
      motif: `Nouvelle prescription endoscopie — ${prescription.typeExamen}`,
      urgence: 3,
      emitter: getEndoscopieServiceId(),
      emitterName: 'Unité Endoscopie',
      recipient: 'endoscopie-planification',
      recipientName: 'Planification examens',
      departmentSource: 'Endoscopie',
      departmentTarget: 'Planification',
      patientId: prescription.patientId,
      entiteRefType: 'Prescription',
      entiteRefId: prescription.id,
      channels: ['INTERNAL', 'SOUND'],
      payload: {
        sourceServiceId: getEndoscopieServiceId(),
        sourceServiceName: 'Unité Endoscopie',
        patientName,
        medecinName,
        motif: prescription.motif ?? '',
        typeExamen: prescription.typeExamen,
      },
    });
  }
}
