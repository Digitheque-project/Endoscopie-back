import { AppRole } from '../auth/roles.types';

export type InboxNotification = {
  id: string;
  externalId?: string;
  type: string;
  motif: string;
  urgence?: number;
  status?: string;
  patientId?: string;
  emitterName?: string;
  recipientName?: string;
  entiteRefType?: string;
  entiteRefId?: string;
  payload?: Record<string, unknown>;
  receivedAt: string;
  // Le major et le médecin voient chacun leurs propres notifications non lues,
  // indépendamment l'un de l'autre — sans ça, le premier des deux à ouvrir/cliquer
  // une notification la fait disparaître pour l'autre alors qu'il ne l'a jamais vue,
  // avec le risque réel de rater l'arrivée d'un nouveau patient.
  readByRole: Partial<Record<AppRole, string>>;
};

/** Vue exposée à un rôle donné — readAt reflète UNIQUEMENT ce que ce rôle a lu. */
export type InboxNotificationView = Omit<InboxNotification, 'readByRole'> & {
  readAt: string | null;
};
