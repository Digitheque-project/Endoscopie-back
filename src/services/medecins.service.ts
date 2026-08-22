import { Injectable, Logger } from '@nestjs/common';
import {
  getAuthEcosystemLoginUrl,
  getServiceAccountCredentials,
  getEndoscopieAuthServiceId,
} from '../config/endoscopie-service';
import { getCurrentUserToken } from '../auth/request-context';

export interface MedecinView {
  id: string;
  nom: string;
  prenom: string;
  specialite: string | null;
}

interface UserServiceUser {
  id: string;
  name: string;
  firstname: string;
  job?: string | null;
}

function getUserServiceUrl(): string | null {
  return process.env.GATEWAY_API_URL?.trim().replace(/\/$/, '') || null;
}

@Injectable()
export class MedecinsService {
  private readonly logger = new Logger(MedecinsService.name);

  private serviceAccountToken: { token: string; expiresAt: number } | null =
    null;
  private serviceAccountLoginFailedUntil = 0;
  private serviceAccountLoginInFlight: Promise<string | null> | null = null;

  /**
   * JWT du compte de service auprès de l'écosystème d'authentification CHU — nécessaire
   * pour interroger GET /users (service utilisateurs), qui exige un token valide. Mis en
   * cache jusqu'à ~1 minute avant expiration, puis renouvelé automatiquement. Les appels
   * concurrents partagent la même tentative de connexion, et un échec est mis en pause 30s
   * avant de réessayer, pour ne pas marteler l'écosystème d'auth pendant une panne.
   *
   * Ne met en cache QUE ce jeton de connexion (identité du compte de service) — jamais les
   * données médecins elles-mêmes, qui restent interrogées en direct à chaque appel (voir
   * getEndoscopieMedecins ci-dessous).
   */
  async getServiceAccountToken(): Promise<string | null> {
    const loginUrl = getAuthEcosystemLoginUrl();
    const credentials = getServiceAccountCredentials();
    if (!loginUrl || !credentials) return null;

    if (
      this.serviceAccountToken &&
      this.serviceAccountToken.expiresAt > Date.now() + 60_000
    ) {
      return this.serviceAccountToken.token;
    }
    if (Date.now() < this.serviceAccountLoginFailedUntil) return null;
    if (this.serviceAccountLoginInFlight) return this.serviceAccountLoginInFlight;

    this.serviceAccountLoginInFlight = (async () => {
      try {
        const res = await fetch(`${loginUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          this.logger.warn(
            `Connexion du compte de service échouée (${res.status}) auprès de ${loginUrl}`,
          );
          this.serviceAccountLoginFailedUntil = Date.now() + 30_000;
          return null;
        }
        const data = (await res.json()) as { accessToken?: string };
        if (!data.accessToken) return null;

        const payload = data.accessToken.split('.')[1];
        const decoded = payload
          ? JSON.parse(Buffer.from(payload, 'base64').toString())
          : null;
        const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now() + 15 * 60_000;

        this.serviceAccountToken = { token: data.accessToken, expiresAt };
        return data.accessToken;
      } catch (e) {
        this.logger.warn(
          `Erreur lors de la connexion du compte de service: ${e instanceof Error ? e.message : e}`,
        );
        this.serviceAccountLoginFailedUntil = Date.now() + 30_000;
        return null;
      } finally {
        this.serviceAccountLoginInFlight = null;
      }
    })();

    return this.serviceAccountLoginInFlight;
  }

  /**
   * Liste des médecins d'Endoscopie, en direct depuis le service auth/utilisateurs
   * centralisé — jamais stockée localement ni mise en cache. Chaque appel refait la
   * requête. Ne lève jamais d'exception : renvoie [] en cas d'échec (réseau, auth, etc.)
   * pour ne jamais faire échouer une page qui affiche par ailleurs d'autres données.
   *
   * Authentification : utilise en priorité le jeton de l'utilisateur SSO actuellement
   * connecté (transmis par le frontend, disponible via getCurrentUserToken() — confirmé
   * fonctionner aussi bien pour un compte MEDECIN que MAJOR). Le compte de service ne sert
   * que de repli pour les appels sans utilisateur connecté (lien de partage public, API
   * externe par clé API).
   */
  async getEndoscopieMedecins(): Promise<MedecinView[]> {
    const userServiceUrl = getUserServiceUrl();
    if (!userServiceUrl) {
      this.logger.warn(
        'AUTH_USER_SERVICE_URL non configuré : liste des médecins indisponible.',
      );
      return [];
    }

    const token = getCurrentUserToken() ?? (await this.getServiceAccountToken());
    if (!token) return [];

    const serviceId = getEndoscopieAuthServiceId();
    if (!serviceId) {
      this.logger.warn(
        'ENDOSCOPIE_AUTH_SERVICE_ID non configuré : liste des médecins indisponible.',
      );
      return [];
    }

    try {
      // isActive doit être explicitement "true" : une valeur vide filtre sur les
      // comptes inactifs côté service utilisateurs et renvoie une liste vide.
      const url =
        `${userServiceUrl}/users?search=&roleId=&serviceId=${encodeURIComponent(serviceId)}` +
        `&isActive=true&page=1&limit=200`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(
          `Récupération des médecins échouée (${res.status}) auprès de ${userServiceUrl}`,
        );
        return [];
      }
      const data = (await res.json()) as unknown;
      // Forme réelle confirmée : { "users": [...] } — jamais un tableau brut ni
      // { "data": [...] } (les deux repérés en gardaient en repli, au cas où).
      const items: UserServiceUser[] = Array.isArray(data)
        ? (data as UserServiceUser[])
        : Array.isArray((data as { users?: unknown })?.users)
          ? ((data as { users: UserServiceUser[] }).users)
          : Array.isArray((data as { data?: unknown })?.data)
            ? ((data as { data: UserServiceUser[] }).data)
            : [];

      return items.map((u) => ({
        id: u.id,
        nom: u.name,
        prenom: u.firstname,
        specialite: u.job ?? null,
      }));
    } catch (e) {
      this.logger.warn(
        `Erreur lors de la récupération des médecins: ${e instanceof Error ? e.message : e}`,
      );
      return [];
    }
  }

  /** Attache le médecin correspondant à une seule ligne via son id, sous le champ donné. */
  async attachMedecin<T extends Record<string, unknown>>(
    row: T,
    idField: keyof T & string,
    outField: string,
  ): Promise<T & Record<string, MedecinView | null>> {
    const id = row[idField] as unknown as string | null | undefined;
    const medecins = id ? await this.getEndoscopieMedecins() : [];
    const found = id ? medecins.find((m) => m.id === id) ?? null : null;
    return { ...row, [outField]: found } as T & Record<string, MedecinView | null>;
  }

  /** Attache le médecin correspondant à chaque ligne d'une liste, en un seul appel groupé. */
  async attachMedecins<T extends Record<string, unknown>>(
    rows: T[],
    idField: keyof T & string,
    outField: string,
  ): Promise<(T & Record<string, MedecinView | null>)[]> {
    if (rows.length === 0) return [];
    const medecins = await this.getEndoscopieMedecins();
    const map = new Map(medecins.map((m) => [m.id, m]));
    return rows.map((r) => {
      const id = r[idField] as unknown as string | null | undefined;
      return { ...r, [outField]: id ? map.get(id) ?? null : null } as T &
        Record<string, MedecinView | null>;
    });
  }

  /**
   * Résout un utilisateur par son id directement auprès du service utilisateurs
   * centralisé, sans filtrer par service — contrairement à getEndoscopieMedecins() qui
   * ne connaît que les médecins d'Endoscopie. Nécessaire pour le médecin PRESCRIPTEUR
   * d'une demande d'examen : il appartient au service source (un autre service du CHU),
   * jamais à Endoscopie, donc invisible de getEndoscopieMedecins().
   */
  async getUserById(id: string): Promise<MedecinView | null> {
    const userServiceUrl = getUserServiceUrl();
    if (!userServiceUrl) return null;
    const token = getCurrentUserToken() ?? (await this.getServiceAccountToken());
    if (!token) return null;

    try {
      const res = await fetch(`${userServiceUrl}/users/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const u = (await res.json()) as UserServiceUser;
      return { id: u.id, nom: u.name, prenom: u.firstname, specialite: u.job ?? null };
    } catch (e) {
      this.logger.warn(
        `Résolution utilisateur ${id} échouée: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }

  /** Attache le médecin prescripteur (service source, hors Endoscopie) à une seule ligne. */
  async attachPrescripteur<T extends Record<string, unknown>>(
    row: T,
    idField: keyof T & string,
    outField: string,
  ): Promise<T & Record<string, MedecinView | null>> {
    const id = row[idField] as unknown as string | null | undefined;
    const found = id ? await this.getUserById(id) : null;
    return { ...row, [outField]: found } as T & Record<string, MedecinView | null>;
  }

  /**
   * Attache le médecin prescripteur à chaque ligne d'une liste — une requête par
   * prescripteur DISTINCT (pas de route "par lot" côté service utilisateurs), pour
   * éviter de refaire le même appel pour chaque examen d'un même prescripteur.
   */
  async attachPrescripteurs<T extends Record<string, unknown>>(
    rows: T[],
    idField: keyof T & string,
    outField: string,
  ): Promise<(T & Record<string, MedecinView | null>)[]> {
    if (rows.length === 0) return [];
    const ids = [
      ...new Set(
        rows
          .map((r) => r[idField] as unknown as string | null | undefined)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const entries = await Promise.all(
      ids.map(async (id) => [id, await this.getUserById(id)] as const),
    );
    const map = new Map(entries);
    return rows.map((r) => {
      const id = r[idField] as unknown as string | null | undefined;
      return { ...r, [outField]: id ? map.get(id) ?? null : null } as T &
        Record<string, MedecinView | null>;
    });
  }
}
