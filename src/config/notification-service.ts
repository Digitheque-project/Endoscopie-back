/** API notifications Render — https://service-notification.onrender.com/api */
export function getNotificationApiUrl(): string {
  return (
    process.env.NOTIFICATION_API_URL?.trim().replace(/\/$/, '') ||
    'https://service-notification.onrender.com'
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