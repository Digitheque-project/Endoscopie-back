import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDossierCpaDto {
  @ApiPropertyOptional({ example: 'uuid-anesthesiste' })
  anesthesisteId?: string;

  @ApiPropertyOptional({ example: 'Générale' })
  typeAnesthesie?: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiPropertyOptional({ example: 'Validé' })
  statut?: string;

  @ApiPropertyOptional({ example: '2026-05-23T14:00:00.000Z' })
  dateValidation?: string;
}
