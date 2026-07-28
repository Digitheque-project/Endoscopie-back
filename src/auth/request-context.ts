import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RequestContextStore {
  userToken?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Jeton JWT de l'utilisateur actuellement connecté (SSO), s'il y en a un pour cette
 * requête — voir RequestContextMiddleware ci-dessous. Absent pour les appels non
 * authentifiés par un utilisateur (lien de partage public, API externe par clé API). */
export function getCurrentUserToken(): string | undefined {
  return storage.getStore()?.userToken;
}

/** Extrait le Bearer token de chaque requête entrante et le rend disponible partout
 * dans l'arbre d'appel (services, sans avoir à le faire transiter en paramètre) via
 * AsyncLocalStorage — évite le coût d'un provider request-scoped sur tout AppService. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const userToken = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;

    storage.run({ userToken }, next);
  }
}
