export type CreateNotificationPayload = {
  type: string;
  motif: string;
  urgence?: number;
  emitter?: string;
  emitterName?: string;
  recipient?: string;
  recipientName?: string;
  departmentSource?: string;
  departmentTarget?: string;
  patientId?: string;
  entiteRefType?: string;
  entiteRefId?: string;
  payload?: Record<string, unknown>;
  ringtone?: string;
  channels?: string[];
};
