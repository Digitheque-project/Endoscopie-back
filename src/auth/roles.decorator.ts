import { SetMetadata } from '@nestjs/common';
import { AppRole } from './roles.types';

export const ROLES_KEY = 'roles';

/** Marque une route comme réservée à un ou plusieurs rôles (voir RolesGuard). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
