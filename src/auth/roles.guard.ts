import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { AppRole, MEDECIN_ID_HEADER, ROLE_HEADER } from './roles.types';

/**
 * Simule la gestion de rôle en attendant le futur service dédié (multi-service).
 * Le rôle voyage via l'en-tête `x-user-role`, envoyé par le frontend depuis son
 * contexte d'auth simulé (voir endoscopie-front/contexts/AuthContext.tsx).
 *
 * Quand le vrai service de rôle sera prêt, seule la logique ci-dessous change
 * (vérification JWT / appel au service) — les `@Roles(...)` posés sur les
 * contrôleurs n'ont pas besoin d'être modifiés.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<AppRole[] | undefined>(
      ROLES_KEY,
      context.getHandler(),
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.headers[ROLE_HEADER] as AppRole | undefined;
    const medecinId = request.headers[MEDECIN_ID_HEADER] as string | undefined;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Action réservée au rôle ${requiredRoles.join(' ou ')}.`,
      );
    }

    (request as Request & { currentRole?: { role: AppRole; medecinId?: string } }).currentRole = {
      role,
      medecinId,
    };

    return true;
  }
}
