import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDossierCpaDto {
  @ApiProperty({ example: 'uuid-patient' })
  patientId: string;

  @ApiPropertyOptional({ example: 'uuid-prescription' })
  prescriptionId?: string;

  @ApiPropertyOptional({ example: 'uuid-anesthesiste' })
  anesthesisteId?: string;

  @ApiPropertyOptional({ example: 'Locale' })
  typeAnesthesie?: string;

  @ApiPropertyOptional({ example: 'Patient ASA II, pas de contre-indication majeure' })
  observations?: string;

  @ApiPropertyOptional({ example: 'Brouillon', default: 'Brouillon' })
  statut?: string;
}
