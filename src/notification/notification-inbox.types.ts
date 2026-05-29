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
  readAt?: string | null;
};
