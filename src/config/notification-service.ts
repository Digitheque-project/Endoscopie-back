/** Gateway CHU (voir config/endoscopie-service.ts) — chemin /notifications inchangé. */
export function getNotificationApiUrl(): string {
  return (
    process.env.GATEWAY_API_URL?.trim().replace(/\/$/, '') ||
    'https://gateway-bwm4.onrender.com'
  );
}

/** URL du webhook que le service notification doit appeler. */
export function getNotificationWebhookUrl(): string {
  const base =
    process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, '') ||
    process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '') ||
    `http://localhost:${process.env.PORT ?? '3333'}`;
  return `${base}/api/notifications/receive`;
}