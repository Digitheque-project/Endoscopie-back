function requireEnv(name: string): string {
  const value = process.env[name]?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Vérifiez votre .env (voir .env.example).`,
    );
  }
  return value;
}

export function getEndoscopieServiceId(override?: string): string {
  return override?.trim() || requireEnv('ENDOSCOPIE_SERVICE_ID');
}

export function getEndoscopieChuId(override?: string): string {
  return override?.trim() || requireEnv('ENDOSCOPIE_CHU_ID');
}

export function getChuApiUrl(): string {
  return requireEnv('CHU_API_URL');
}

export function getAccueilApiUrl(): string {
  return requireEnv('ACCUEIL_API_URL');
}

/** URL de l'API du service Bloc Opératoire (intégration CPA/VPA). */
export function getBlocApiUrl(): string | null {
  return process.env.BLOC_API_URL?.replace(/\/$/, '') || null;
}

/** URL de l'API prescription mutualisée du CHU. */
export function getPrescriptionExtApiUrl(): string {
  return requireEnv('PRESCRIPTION_EXT_API_URL');
}
