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

/**
 * ID service Endoscopie tel qu'enregistré dans le service d'authentification central
 * (voir AUTH_ENDOSCOPIE_SERVICE_ID côté front). Distinct de ENDOSCOPIE_SERVICE_ID :
 * certaines prescriptions externes multi-services sont taguées avec l'un ou l'autre
 * selon la source (saisie directe sur le service prescription vs. via l'écosystème
 * d'authentification), donc on interroge les deux pour ne rien manquer.
 */
export function getEndoscopieAuthServiceId(): string | null {
  return process.env.ENDOSCOPIE_AUTH_SERVICE_ID?.trim() || null;
}

/** Voir getEndoscopieAuthServiceId — équivalent pour le CHU. */
export function getEndoscopieAuthChuId(): string | null {
  return process.env.ENDOSCOPIE_AUTH_CHU_ID?.trim() || null;
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

/**
 * URL du microservice Dossier Patient CHU (suivis, diagnostics, antécédents, sorties
 * médicales...) — parcours du patient au-delà de l'Endoscopie. Optionnel : ce service
 * exige son propre token (distinct du JWT de l'écosystème d'authentification partagé),
 * que nous n'avons pas encore ; les appels échoueront donc en 401 tant qu'il ne nous
 * aura pas été fourni. Le code appelant doit rester silencieux dans ce cas.
 */
export function getDossierPatientApiUrl(): string | null {
  return process.env.DOSSIER_PATIENT_API_URL?.trim().replace(/\/$/, '') || null;
}
