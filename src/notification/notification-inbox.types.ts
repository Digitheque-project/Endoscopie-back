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
  // Statut lu/non-lu partagé entre le major et le médecin — les deux voient les mêmes
  // notifications avec le même compteur ("continuité"). Le seul garde-fou spécifique au
  // rôle est côté frontend : le clic du médecin sur une notification de nouvelle
  // prescription ne déclenche pas ce marquage (voir NotificationBell.tsx), pour qu'il ne
  // puisse pas faire disparaître par erreur une prescription que le major n'a pas encore
  // traitée — mais dès que le major la lit, elle disparaît bien pour les deux.
  readAt: string | null;
};
