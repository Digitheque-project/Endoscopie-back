import { getEndoscopieServiceId } from '../config/endoscopie-service';

/** Champs connus du service notification contenant un serviceId. */
function collectServiceIdCandidates(raw: Record<string, unknown>): string[] {
  const payload = raw.payload as Record<string, unknown> | undefined;
  const values: unknown[] = [
    raw.emitter,
    raw.emetteurId,
    raw.recipient,
    raw.destinataireId,
    raw.departmentSource,
    raw.departmentTarget,
    raw.departementSourceId,
    raw.departementCibleId,
    payload?.sourceServiceId,
    payload?.serviceId,
    payload?.targetServiceId,
    payload?.emitter,
    payload?.recipient,
  ];
  return values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toLowerCase());
}

/** Vérifie si une notification du service Render concerne l'unité Endoscopie. */
export function notificationMatchesServiceId(
  raw: Record<string, unknown>,
  serviceId = getEndoscopieServiceId(),
): boolean {
  const target = serviceId.trim().toLowerCase();
  if (!target) return false;

  if (collectServiceIdCandidates(raw).some((v) => v === target)) {
    return true;
  }

  try {
    return JSON.stringify(raw).toLowerCase().includes(target);
  } catch {
    return false;
  }
}

export function filterNotificationsByServiceId<T extends Record<string, unknown>>(
  items: T[],
  serviceId?: string,
): T[] {
  const sid = getEndoscopieServiceId(serviceId);
  return items.filter((item) => notificationMatchesServiceId(item, sid));
}
