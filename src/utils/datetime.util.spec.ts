import { naifVersInstant, parseDateTimeAsUtc } from './datetime.util';
import { accueilDuChuDe, origineDemande, resoudreIdentiteEndoscopie } from '../config/endoscopie-service';

describe('naifVersInstant', () => {
  it('9 h planifié à Madagascar = 06:00 UTC (l’Accueil affiche alors 9 h, pas 12 h)', () => {
    const naif = parseDateTimeAsUtc('2026-11-07T09:00:00');
    expect(naifVersInstant(naif, 'Indian/Antananarivo').toISOString()).toBe('2026-11-07T06:00:00.000Z');
  });

  it('passage de minuit', () => {
    const naif = parseDateTimeAsUtc('2026-11-07T01:30:00');
    expect(naifVersInstant(naif, 'Indian/Antananarivo').toISOString()).toBe('2026-11-06T22:30:00.000Z');
  });
});

describe('origineDemande', () => {
  beforeAll(async () => {
    process.env.GATEWAY_API_URL = 'http://passerelle';
    process.env.JWT_SECRET = 'secret';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'endo-A', name: 'Endoscopie', chuId: 'A' },
        { id: 'acc-A', name: 'Accueil', chuId: 'A' },
        { id: 'cext-A', name: 'Consultation externe', chuId: 'A' },
        { id: 'chir-A', name: 'Chirurgie', chuId: 'A' },
        { id: 'acc-B', name: 'Accueil', chuId: 'B' },
      ],
    }) as unknown as typeof fetch;
    await resoudreIdentiteEndoscopie(1);
  });

  it('reconnaît l’origine d’après le nom du service dans le registre', () => {
    expect(origineDemande('acc-A')).toBe('ACCUEIL');
    expect(origineDemande('cext-A')).toBe('CONSULTATION_EXTERNE');
    expect(origineDemande('chir-A')).toBe('AUTRE');
    expect(origineDemande('inconnu')).toBeNull();
  });

  it('Accueil du même CHU que la consultation externe', () => {
    expect(accueilDuChuDe('cext-A')).toBe('acc-A');
  });
});
