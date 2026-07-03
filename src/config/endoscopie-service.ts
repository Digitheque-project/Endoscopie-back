/** ID du service « Endoscopie » dans l'API CHU (Railway). */
export const DEFAULT_ENDOSCOPIE_SERVICE_ID =
  '38f39d38-152e-495b-8c48-28937750d9eb';

/** chuId réel de « CHU Andrainjato Fianarantsoa » côté Service-CHU/Accueil. */
export const DEFAULT_ENDOSCOPIE_CHU_ID = '72d49761-2a65-446d-b025-15a74cac1ad4';

export function getEndoscopieServiceId(override?: string): string {
  return (
    override?.trim() ||
    process.env.ENDOSCOPIE_SERVICE_ID?.trim() ||
    DEFAULT_ENDOSCOPIE_SERVICE_ID
  );
}

export function getEndoscopieChuId(override?: string): string {
  return (
    override?.trim() ||
    process.env.ENDOSCOPIE_CHU_ID?.trim() ||
    DEFAULT_ENDOSCOPIE_CHU_ID
  );
}

export function getChuApiUrl(): string {
  return (
    process.env.CHU_API_URL?.replace(/\/$/, '') ||
    'https://service-chu-back-production-d6a8.up.railway.app'
  );
}

export function getAccueilApiUrl(): string {
  return (
    process.env.ACCUEIL_API_URL?.replace(/\/$/, '') ||
    'https://acceuil-back-production.up.railway.app'
  );
}

/** URL de l'API du service Bloc Opératoire (intégration CPA/VPA). */
export function getBlocApiUrl(): string | null {
  return process.env.BLOC_API_URL?.replace(/\/$/, '') || null;
}
