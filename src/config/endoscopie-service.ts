function requireEnv(name: string): string {
  const value = process.env[name]?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Vérifiez votre .env (voir .env.example).`,
    );
  }
  return value;
}

/**
 * Identité du service : le service « Endoscopie » et son CHU, tels qu'ils figurent dans
 * le jeton du compte de service (voir resoudreIdentiteEndoscopie, appelée au démarrage).
 * Jamais figée en variable d'environnement : le même code sert l'Endoscopie de
 * n'importe quel CHU.
 */
let identite: { serviceId: string; chuId: string } | null = null;

function identiteResolue(): { serviceId: string; chuId: string } {
  if (!identite) {
    throw new Error(
      'Identité du service Endoscopie non résolue : vérifiez CHU_SERVICE_ACCOUNT_EMAIL / ' +
        'CHU_SERVICE_ACCOUNT_PASSWORD (compte rattaché au service « Endoscopie » de son CHU).',
    );
  }
  return identite;
}

export function getEndoscopieServiceId(override?: string): string {
  return override?.trim() || identiteResolue().serviceId;
}

export function getEndoscopieChuId(override?: string): string {
  return override?.trim() || identiteResolue().chuId;
}

/**
 * Même identifiant que getEndoscopieServiceId : le registre central est désormais la seule
 * source. Conservé pour les appelants qui interrogeaient deux identifiants distincts.
 */
export function getEndoscopieAuthServiceId(): string | null {
  return identite?.serviceId ?? null;
}

/** Voir getEndoscopieAuthServiceId — équivalent pour le CHU. */
export function getEndoscopieAuthChuId(): string | null {
  return identite?.chuId ?? null;
}

/**
 * Lit l'identité du service dans le jeton du compte de service (entrée services[] nommée
 * Endoscopie). Réessaie tant que la passerelle ou l'authentification ne répondent pas
 * (réveil des services Render), puis abandonne sans bloquer le démarrage.
 */
export async function resoudreIdentiteEndoscopie(
  tentatives = 12,
): Promise<void> {
  const gateway = getOptionalGatewayApiUrl();
  const credentials = getServiceAccountCredentials();
  if (!gateway || !credentials) {
    console.error(
      '[Endoscopie] GATEWAY_API_URL ou compte de service manquant : identité non résolue.',
    );
    return;
  }
  for (let i = 1; i <= tentatives; i++) {
    try {
      const res = await fetch(`${gateway}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (res.ok) {
        const { accessToken } = (await res.json()) as { accessToken?: string };
        const payload = accessToken
          ? (JSON.parse(
              Buffer.from(accessToken.split('.')[1], 'base64url').toString(
                'utf8',
              ),
            ) as {
              services?: Array<{
                serviceId?: string;
                serviceName?: string;
                chu?: { id?: string };
              }>;
            })
          : null;
        const entree = payload?.services?.find((s) =>
          /endoscop/i.test(s.serviceName ?? ''),
        );
        if (entree?.serviceId && entree.chu?.id) {
          identite = { serviceId: entree.serviceId, chuId: entree.chu.id };
          console.log(
            `[Endoscopie] Identité résolue : service ${entree.serviceId}, CHU ${entree.chu.id}`,
          );
          return;
        }
        console.error(
          "[Endoscopie] Le compte de service n'est rattaché à aucun service « Endoscopie ».",
        );
        return;
      }
      console.warn(
        `[Endoscopie] Connexion du compte de service refusée (${res.status}), essai ${i}/${tentatives}`,
      );
    } catch (e) {
      console.warn(
        `[Endoscopie] Passerelle injoignable (${e instanceof Error ? e.message : e}), essai ${i}/${tentatives}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/**
 * Adresse publique de ce backend (liens de résultats partagés, webhook) : fournie par
 * Render (RENDER_EXTERNAL_URL), ou PUBLIC_API_URL ailleurs (réseau local du CHU).
 */
export function getPublicBaseUrl(): string {
  return (
    process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '') ||
    process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, '') ||
    `http://localhost:${process.env.PORT ?? '3333'}`
  );
}

/**
 * Point d'entrée unique de l'écosystème CHU (gateway-h36x) — proxifie tous les
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
export function getServiceAccountCredentials(): {
  email: string;
  password: string;
} | null {
  const email = process.env.CHU_SERVICE_ACCOUNT_EMAIL?.trim();
  const password = process.env.CHU_SERVICE_ACCOUNT_PASSWORD?.trim();
  return email && password ? { email, password } : null;
}
