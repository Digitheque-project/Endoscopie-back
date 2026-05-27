/** ID du service « Endoscopie » dans l'API CHU (Railway). */
export const DEFAULT_ENDOSCOPIE_SERVICE_ID =
  '38f39d38-152e-495b-8c48-28937750d9eb';

export function getEndoscopieServiceId(override?: string): string {
  return (
    override?.trim() ||
    process.env.ENDOSCOPIE_SERVICE_ID?.trim() ||
    DEFAULT_ENDOSCOPIE_SERVICE_ID
  );
}

export function getChuApiUrl(): string {
  return (
    process.env.CHU_API_URL?.replace(/\/$/, '') ||
    'https://service-chu-back-production-77d5.up.railway.app'
  );
}
