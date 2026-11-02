import { NotificationService } from './notification.service';
import type { NotificationInboxService } from './notification-inbox.service';
import type { MedecinsService } from '../services/medecins.service';

jest.mock('../config/endoscopie-service', () => ({
  getEndoscopieServiceId: () => 'svc-endoscopie',
  getEndoscopieAuthServiceId: () => 'svc-endoscopie',
}));

describe('NotificationService — nouvelle prescription', () => {
  const fetchMock = jest.fn();
  let recues: Array<Record<string, any>>;
  let service: NotificationService;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    recues = [];
    const inbox = { receive: (dto: Record<string, any>) => recues.push(dto) } as unknown as NotificationInboxService;
    const medecins = { getServiceAccountToken: async () => 'jeton-service' } as unknown as MedecinsService;
    service = new NotificationService(medecins, inbox);
  });

  // prescription_back notifie déjà le service Endoscopie : une seconde copie dans le
  // service notification apparaissait en double dans la cloche.
  it('alerte en direct seulement, aucune copie dans le service notification', async () => {
    await service.notifyPrescriptionCreated([
      { id: 'd-1', patientId: 'p-1', typeExamen: 'Coloscopie', prescriptionExternalId: 'presc-9' },
      { id: 'd-2', patientId: 'p-1', typeExamen: 'Fibroscopie', prescriptionExternalId: 'presc-9' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recues).toHaveLength(1);
    expect(recues[0].motif).toBe('Nouvelle prescription endoscopie — Coloscopie + Fibroscopie');
    expect(recues[0].payload.prescriptionId).toBe('presc-9');
  });

  it('les autres notifications passent toujours par le service notification', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'n-1' }) });
    jest.spyOn(service as any, 'baseUrl', 'get').mockReturnValue('http://passerelle');
    await service.createNotification({ type: 'RDV_PLANIFIE', motif: 'Rendez-vous planifié' });
    expect(fetchMock).toHaveBeenCalledWith('http://passerelle/notifications/service', expect.anything());
    expect(recues).toHaveLength(1);
  });
});
