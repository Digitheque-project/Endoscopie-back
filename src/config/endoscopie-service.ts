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

/**
 * Point d'entrée unique de l'écosystème CHU (gateway-bwm4) — proxifie tous les
 * microservices (auth, users, services, chu, accueil, notification, prescriptions,
 * bloc, dossier-patient...) chacun sous son propre préfixe de chemin, exactement les
 * mêmes chemins qu'en appelant chaque service directement (vérifié le 22/08/2026).
 * Remplace les anciennes variables séparées par service (CHU_API_URL, ACCUEIL_API_URL,
 * etc.) — une seule URL à tenir à jour désormais. Contrairement aux services appelés en
 * direct, le gateway exige un jeton Bearer sur TOUS ses chemins, même ceux qui n'en
 * avaient pas besoin en direct (voir les appels ci-dessous, tous mis à jour en
 * conséquence).
 */
function getGatewayApiUrl(): string {
  return requireEnv('GATEWAY_API_URL');
}

/** Optionnel : contrairement à getGatewayApiUrl, ne lève pas si absent — pour les
 * intégrations dont l'appelant sait déjà rester silencieux en son absence. */
function getOptionalGatewayApiUrl(): string | null {
  return process.env.GATEWAY_API_URL?.trim().replace(/\/$/, '') || null;
}

export function getChuApiUrl(): string {
  return getGatewayApiUrl();
}

/**
 * Registre central des services CHU — GET /services/:id (authentifié) y résout un
 * serviceId en son nom lisible (ex. "Chirurgie", "Endoscopie"). Optionnel : si absent,
 * le code appelant doit rester silencieux (voir resolveServiceName dans app.service.ts).
 */
export function getServiceRegistryApiUrl(): string | null {
  return getOptionalGatewayApiUrl();
}

export function getAccueilApiUrl(): string {
  return getGatewayApiUrl();
}

/**
 * URL de l'API du service Bloc Opératoire (intégration CPA/VPA) — le chemin de l'API
 * (/bloc/api) est ajouté ici, pas dans le .env.
 */
export function getBlocApiUrl(): string | null {
  const base = getOptionalGatewayApiUrl();
  return base ? `${base}/bloc/api` : null;
}

/**
 * URL de l'API prescription mutualisée du CHU — le chemin de l'API (/prescriptions)
 * est ajouté ici, pas dans le .env.
 */
export function getPrescriptionExtApiUrl(): string {
  return `${getGatewayApiUrl()}/prescriptions`;
}

/**
 * URL du microservice Dossier Patient CHU (suivis, diagnostics, antécédents, sorties
 * médicales...) — parcours du patient au-delà de l'Endoscopie. Optionnel : le code
 * appelant doit rester silencieux en son absence (voir dossier-patient.service.ts).
 * Le chemin de l'API (/dossier-patient) est ajouté ici, pas dans le .env.
 */
export function getDossierPatientApiUrl(): string | null {
  const base = getOptionalGatewayApiUrl();
  return base ? `${base}/dossier-patient` : null;
}

/**
 * URL de connexion de l'écosystème d'authentification partagé du CHU — le service
 * prescription (et d'autres) accepte le même JWT que celui utilisé par nos utilisateurs
 * pour se connecter à l'app. Notre backend s'y connecte lui-même (compte de service)
 * pour obtenir un token à joindre à ses appels serveur-à-serveur.
 */
export function getAuthEcosystemLoginUrl(): string | null {
  return getOptionalGatewayApiUrl();
}

/** Identifiants du compte de service utilisé par le backend pour s'authentifier auprès de l'écosystème CHU. */
export function getServiceAccountCredentials(): { email: string; password: string } | null {
  const email = process.env.CHU_SERVICE_ACCOUNT_EMAIL?.trim();
  const password = process.env.CHU_SERVICE_ACCOUNT_PASSWORD?.trim();
  return email && password ? { email, password } : null;
}
