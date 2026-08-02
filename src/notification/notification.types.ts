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
  /**
   * Date réelle de l'événement métier (ex. dateDemande de la prescription), pas
   * l'instant où on la notifie — sans ça, une prescription d'hier redétectée après un
   * redémarrage du serveur (voir seenExternalPrescriptionIds) s'affichait avec la date
   * du jour, laissant croire à tort à une toute nouvelle arrivée.
   */
  createdAt?: string;
};
