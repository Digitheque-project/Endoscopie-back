import { MedecinsService } from './medecins.service';

describe('MedecinsService — prescripteur hors plateforme', () => {
  const previousGateway = process.env.GATEWAY_API_URL;

  beforeEach(() => {
    // Sans passerelle configurée, le service utilisateurs n'est pas interrogé :
    // seul le nom transmis par le service source peut être utilisé.
    delete process.env.GATEWAY_API_URL;
  });

  afterAll(() => {
    if (previousGateway === undefined) delete process.env.GATEWAY_API_URL;
    else process.env.GATEWAY_API_URL = previousGateway;
  });

  it('affiche le nom saisi à l’Accueil quand le prescripteur n’a pas de compte', async () => {
    const service = new MedecinsService();
    service.rememberPrescripteurExterne('532', 'Dr. Rakoto Jean');

    const [row] = await service.attachPrescripteurs([{ medecinId: '532' }], 'medecinId', 'medecinPrescripteur');

    expect(row.medecinPrescripteur).toEqual({ id: '532', nom: 'Rakoto Jean', prenom: '', specialite: null });
  });

  it('retire aussi un « Dr » en fin de nom', async () => {
    const service = new MedecinsService();
    service.rememberPrescripteurExterne('532', 'test Dr');

    const row = await service.attachPrescripteur({ medecinId: '532' }, 'medecinId', 'medecinPrescripteur');

    expect(row.medecinPrescripteur?.nom).toBe('test');
  });

  it('laisse le prescripteur vide quand aucun nom n’est connu', async () => {
    const service = new MedecinsService();

    const row = await service.attachPrescripteur({ medecinId: 'inconnu' }, 'medecinId', 'medecinPrescripteur');

    expect(row.medecinPrescripteur).toBeNull();
  });
});
