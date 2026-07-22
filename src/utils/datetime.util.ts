/**
 * Analyse une chaîne date-heure en `Date`, en la traitant comme UTC si elle ne porte
 * aucune information de fuseau horaire (pas de "Z" ni de décalage +HH:MM/-HHMM en fin
 * de chaîne). Sans ça, `new Date(chaîneNaïve)` est interprétée dans le fuseau du
 * système hôte du process Node — ce qui produit un résultat différent selon que le
 * backend tourne en local (souvent une autre TZ que la production) ou déployé (UTC sur
 * Render), et peut créer de faux conflits de créneau entre deux rendez-vous créés par
 * des instances tournant dans des fuseaux différents pour la même heure murale voulue.
 */
export function parseDateTimeAsUtc(value: string): Date {
  const trimmed = value.trim();
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  return new Date(hasTimezone ? trimmed : `${trimmed}Z`);
}
