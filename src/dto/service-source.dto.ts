export class CreateServiceSourceDto {
  nom: string;
  urlWebhook: string;
  contact?: string;
  hopital?: string;
}

export class UpdateServiceSourceDto {
  nom?: string;
  urlWebhook?: string;
  actif?: boolean;
  contact?: string;
  hopital?: string;
}

export class ServiceSourceResponseDto {
  id: string;
  nom: string;
  urlWebhook: string;
  actif: boolean;
  contact?: string;
  hopital?: string;
  createdAt: Date;
  lastNotifiedAt?: Date;
}

export class WebhookNotificationDto {
  event: string;
  timestamp: string;
  prescription: {
    id: string;
    serviceDemandeur: string;
    prescripteur: string;
  };
  patient: {
    nom: string;
    prenoms: string;
  };
  message: string;
  lienResultat: string;
}

export class LogWebhookDto {
  id: string;
  serviceSourceId: string;
  prescriptionId: string;
  patientId: string;
  eventType: string;
  httpStatus?: number;
  tentatives: number;
  timestamp: Date;
  prochainEssai?: Date;
}
