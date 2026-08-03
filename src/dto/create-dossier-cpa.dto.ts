import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDossierCpaDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

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
