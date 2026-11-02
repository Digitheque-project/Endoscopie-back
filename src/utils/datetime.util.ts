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

/**
 * Instant réel d'une date « naïve » (heure saisie stockée comme de l'UTC, voir
 * parseDateTimeAsUtc), dans le fuseau du CHU : 9 h saisi à Madagascar = 06:00Z. À
 * utiliser pour tout service extérieur qui affiche l'heure dans son fuseau (Accueil) —
 * sinon 9 h y apparaît 12 h.
 */
export function naifVersInstant(
  naif: Date,
  fuseau = process.env.CHU_FUSEAU_HORAIRE || 'Indian/Antananarivo',
): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(naif)
      .map((p) => [p.type, p.value]),
  );
  // Décalage du fuseau à cet instant (ex. +3 h), retiré de l'heure murale saisie.
  const vu = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(naif.getTime() - (vu - naif.getTime()));
}
