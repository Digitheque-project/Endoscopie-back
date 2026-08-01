import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { ReceiveNotificationDto } from '../dto/receive-notification.dto';
import { NotificationInboxService } from './notification-inbox.service';
import { ROLE_HEADER } from '../auth/roles.types';
import type { AppRole } from '../auth/roles.types';

@ApiTags('Notifications')
@Controller()
export class NotificationInboxController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Post('api/notifications/receive')
  @ApiOperation({
    summary:
      'Webhook — recevoir une notification du service notification Render',
    description:
      'À configurer comme URL de callback dans le service notification. ' +
      'Exemple : https://votre-api.onrender.com/api/notifications/receive. ' +
      'Diffuse immédiatement la notification aux clients connectés (SSE).',
  })
  @ApiHeader({
    name: 'x-webhook-secret',
    required: false,
    description:
      'Secret partagé (variable NOTIFICATION_WEBHOOK_SECRET) si configuré',
  })
  @ApiBody({ type: ReceiveNotificationDto })
  @ApiOkResponse({
    description: 'Notification enregistrée et diffusée en temps réel',
  })
  receiveNotification(
    @Body() body: ReceiveNotificationDto,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    this.inbox.assertWebhookSecret(webhookSecret);
    const item = this.inbox.receive(body, { source: 'service-notification' });
    if (!item) {
      return {
        ok: true,
        ignored: true,
        reason: 'Notification sans ENDOSCOPIE_SERVICE_ID',
        webhookUrl: this.inbox.getPublicWebhookUrl(),
      };
    }
    return {
      ok: true,
      received: item,
      webhookUrl: this.inbox.getPublicWebhookUrl(),
    };
  }

  @Get('api/notifications/inbox')
  @ApiOperation({
    summary: 'Boîte de réception locale (notifications reçues via webhook)',
    description:
      "readAt est propre au rôle appelant (x-user-role) : le major et le médecin ont chacun " +
      "leur propre statut lu/non-lu pour la même notification.",
  })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiHeader({ name: ROLE_HEADER, required: false, description: 'MAJOR ou MEDECIN' })
  @ApiOkResponse({ description: 'Liste des notifications reçues' })
  getInbox(
    @Query('limit') limit?: string,
    @Headers(ROLE_HEADER) role?: AppRole,
  ) {
    const n = limit ? parseInt(limit, 10) : 50;
    return {
      items: this.inbox.listInbox(Number.isFinite(n) ? n : 50, role),
      webhookUrl: this.inbox.getPublicWebhookUrl(),
    };
  }

  @Post('api/notifications/inbox/:id/read')
  @ApiOperation({
    summary: 'Marquer une notification locale comme lue',
    description: "Ne marque comme lue que pour le rôle appelant (x-user-role), pas pour l'autre.",
  })
  @ApiParam({ name: 'id', description: 'ID interne (reçu dans inbox)' })
  @ApiHeader({ name: ROLE_HEADER, required: false, description: 'MAJOR ou MEDECIN' })
  markRead(@Param('id') id: string, @Headers(ROLE_HEADER) role?: AppRole) {
    const item = this.inbox.markRead(id, role);
    return { ok: Boolean(item), item };
  }

  @Sse('api/notifications/stream')
  @ApiOperation({
    summary: 'Flux temps réel (SSE) pour l’interface utilisateur',
    description:
      'Connexion Server-Sent Events : chaque notification reçue via POST /api/notifications/receive est poussée instantanément.',
  })
  streamNotifications(): Observable<MessageEvent> {
    return this.inbox.stream();
  }
}
