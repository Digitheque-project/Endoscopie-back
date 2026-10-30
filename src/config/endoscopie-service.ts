function requireEnv(name: string): string {
  const value = process.env[name]?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Vérifiez votre .env (voir .env.example).`,
    );
  }
  return value;
}

import * as jwt from 'jsonwebtoken';

/**
 * Services « Endoscopie » du registre central (un par CHU), lus au démarrage par leur
 * nom (voir resoudreIdentiteEndoscopie). Jamais d'identifiant en variable d'environnement
 * ni de compte utilisateur : le même code sert l'Endoscopie de n'importe quel CHU.
 */
let servicesEndoscopie: Array<{ serviceId: string; chuId: string }> = [];

/** Tous les services Endoscopie connus (un par CHU), pour les traitements de fond. */
export function getServicesEndoscopie(): Array<{
  serviceId: string;
  chuId: string;
}> {
  return servicesEndoscopie;
}

/** CHU d'un service Endoscopie du registre. */
export function chuDuService(serviceId: string): string | null {
  return (
    servicesEndoscopie.find((s) => s.serviceId === serviceId)?.chuId ?? null
  );
}

/** Service par défaut : l'unique Endoscopie du registre (déploiement d'un seul CHU). */
function serviceParDefaut(): { serviceId: string; chuId: string } {
  if (servicesEndoscopie.length === 1) return servicesEndoscopie[0];
  throw new Error(
    servicesEndoscopie.length === 0
      ? 'Aucun service « Endoscopie » trouvé dans le registre central (voir les logs de démarrage).'
      : 'Plusieurs services « Endoscopie » dans le registre : le service doit être précisé par la requête.',
  );
}

export function getEndoscopieServiceId(override?: string): string {
  return override?.trim() || serviceParDefaut().serviceId;
}

export function getEndoscopieChuId(override?: string): string {
  return override?.trim() || serviceParDefaut().chuId;
}

/** Conservés pour les appelants historiques : même source que ci-dessus. */
export function getEndoscopieAuthServiceId(): string | null {
  return servicesEndoscopie.length === 1
    ? servicesEndoscopie[0].serviceId
    : null;
}

export function getEndoscopieAuthChuId(): string | null {
  return servicesEndoscopie.length === 1 ? servicesEndoscopie[0].chuId : null;
}

/**
 * Jeton de SERVICE pour les appels serveur-à-serveur (sans utilisateur connecté) :
 * signé avec le secret commun de la plateforme, comme les autres services (clinique,
 * prescription). Aucun compte utilisateur, aucun mot de passe.
 */
export function jetonDeService(): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return jwt.sign(
    {
      userId: 'service-endoscopie',
      sub: 'service-endoscopie',
      name: 'Endoscopie',
      firstname: 'Service',
      role: 'SERVICE',
      services: [],
    },
    secret,
    { expiresIn: '10m' },
  );
}

/**
 * Lit dans le registre central les services nommés « Endoscopie » et leur CHU.
 * Réessaie tant que la passerelle ne répond pas (réveil des services Render), puis
 * abandonne sans bloquer le démarrage.
 */
export async function resoudreIdentiteEndoscopie(
  tentatives = 12,
): Promise<void> {
  const gateway = getOptionalGatewayApiUrl();
  const jeton = jetonDeService();
  if (!gateway || !jeton) {
    console.error(
      '[Endoscopie] GATEWAY_API_URL ou JWT_SECRET manquant : services non résolus.',
    );
    return;
  }
  for (let i = 1; i <= tentatives; i++) {
    try {
      const res = await fetch(`${gateway}/services`, {
        headers: { Authorization: `Bearer ${jetonDeService() ?? jeton}` },
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        const liste = (
          Array.isArray(data)
            ? data
            : ((data as { data?: unknown[] }).data ?? [])
        ) as Array<{
          id?: string;
          name?: string;
          chuId?: string;
        }>;
        servicesEndoscopie = liste
          .filter((s) => /endoscop/i.test(s.name ?? '') && s.id && s.chuId)
          .map((s) => ({
            serviceId: s.id as string,
            chuId: s.chuId as string,
          }));
        console.log(
          `[Endoscopie] ${servicesEndoscopie.length} service(s) Endoscopie dans le registre : ` +
            servicesEndoscopie
              .map((s) => `${s.serviceId} (CHU ${s.chuId})`)
              .join(', '),
        );
        return;
      }
      console.warn(
        `[Endoscopie] Registre des services : ${res.status}, essai ${i}/${tentatives}`,
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
