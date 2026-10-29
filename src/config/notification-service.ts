import { getPublicBaseUrl } from './endoscopie-service';

/** Gateway CHU (voir config/endoscopie-service.ts) — chemin /notifications inchangé. */
export function getNotificationApiUrl(): string {
  return process.env.GATEWAY_API_URL?.trim().replace(/\/$/, '') ?? '';
}

/** URL du webhook que le service notification doit appeler. */
export function getNotificationWebhookUrl(): string {
  return `${getPublicBaseUrl()}/api/notifications/receive`;
}
