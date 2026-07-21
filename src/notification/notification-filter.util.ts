import { getEndoscopieAuthServiceId, getEndoscopieServiceId } from '../config/endoscopie-service';

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

/**
 * Vérifie si une notification du service Render concerne l'unité Endoscopie.
 * Le serviceId "officiel" (enregistré dans le service-registry central) est celui
 * d'ENDOSCOPIE_AUTH_SERVICE_ID — ENDOSCOPIE_SERVICE_ID (registre CHU/Railway distinct)
 * n'y est pas connu. On vérifie les deux pour ne rien manquer.
 */
export function notificationMatchesServiceId(
  raw: Record<string, unknown>,
  serviceIds: string[] = [getEndoscopieAuthServiceId(), getEndoscopieServiceId()].filter(
    (v): v is string => Boolean(v),
  ),
): boolean {
  const targets = [...new Set(serviceIds.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!targets.length) return false;

  const candidates = collectServiceIdCandidates(raw);
  if (candidates.some((v) => targets.includes(v))) {
    return true;
  }

  try {
    const rawStr = JSON.stringify(raw).toLowerCase();
    return targets.some((t) => rawStr.includes(t));
  } catch {
    return false;
  }
}
