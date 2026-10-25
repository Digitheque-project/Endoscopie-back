import { NotificationInboxService } from './notification-inbox.service';
import type { ReceiveNotificationDto } from '../dto/receive-notification.dto';
import type { PrismaService } from '../prisma/prisma.service';
import type { CpaBlocService } from '../services/cpa-bloc.service';

// CPA_RESULTAT : type du Bloc Opératoire, accepté sans filtre de serviceId — permet de
// tester le dédoublonnage sans configurer l'identité Endoscopie. Sans entiteRefId, aucune
// mise à jour de dossier CPA n'est déclenchée.
function notif(overrides: Partial<ReceiveNotificationDto> = {}): ReceiveNotificationDto {
  return { type: 'CPA_RESULTAT', motif: 'CPA favorable — Rakoto', ...overrides } as ReceiveNotificationDto;
}

describe('NotificationInboxService — doublons', () => {
  let inbox: NotificationInboxService;

  beforeEach(() => {
    inbox = new NotificationInboxService({} as PrismaService, {} as CpaBlocService);
  });

  it('ne range qu’une fois une notification au même id externe', () => {
    expect(inbox.receive(notif({ id: 'n-1' }))).not.toBeNull();
    expect(inbox.receive(notif({ id: 'n-1', motif: 'autre texte' }))).toBeNull();
    expect(inbox.listInbox()).toHaveLength(1);
  });

  it('ne range qu’une fois une notification au même contenu, même sans id', () => {
    expect(inbox.receive(notif())).not.toBeNull();
    expect(inbox.receive(notif())).toBeNull();
    expect(inbox.listInbox()).toHaveLength(1);
  });

  it('garde deux notifications de contenus différents', () => {
    inbox.receive(notif({ motif: 'CPA favorable — Rakoto' }));
    inbox.receive(notif({ motif: 'CPA favorable — Rabe' }));
    expect(inbox.listInbox()).toHaveLength(2);
  });
});
