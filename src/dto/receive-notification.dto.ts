import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Corps attendu lorsque le service notification appelle notre webhook.
 * Aligné sur CreateNotificationDto du service Render.
 */
export class ReceiveNotificationDto {
  @ApiProperty({
    description: 'Identifiant de la notification côté service notification',
    example: 'c884136c-8fed-4fce-899e-46a0d3d92758',
  })
  id?: string;

  @ApiProperty({
    description: 'Code du type (ex. DEMANDE_EXAMEN, ORDONNANCE)',
    example: 'DEMANDE_EXAMEN',
  })
  type: string;

  @ApiProperty({
    description: 'Message principal affiché à l’utilisateur',
    example: 'Nouvelle prescription endoscopie — Coloscopie',
  })
  motif: string;

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 5 })
  urgence?: number;

  @ApiPropertyOptional({
    description: 'Statut côté service notification',
    example: 'ENVOYE',
  })
  statut?: string;

  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  emitter?: string;

  @ApiPropertyOptional({ name: 'emetteur_name', example: 'Unité Endoscopie' })
  emetteur_name?: string;

  @ApiPropertyOptional({ example: 'Unité Endoscopie' })
  emitterName?: string;

  @ApiPropertyOptional({ example: 'planification' })
  recipient?: string;

  @ApiPropertyOptional({ example: 'Planification examens' })
  recipientName?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  patientId?: string;

  @ApiPropertyOptional({ example: 'Prescription' })
  entiteRefType?: string;

  @ApiPropertyOptional({ example: 'pres-uuid' })
  entiteRefId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '2026-05-29T11:24:09.892Z' })
  created_at?: string;

  @ApiPropertyOptional({ example: '2026-05-29T11:24:09.892Z' })
  createdAt?: string;
}
