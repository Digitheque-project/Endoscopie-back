import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNoteDossierDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

  @ApiProperty({ example: 'uuid-prescription' })
  prescriptionId: string;

  @ApiProperty({ example: 'Dr. Jean-Pierre Rakotomalala (Médecin)' })
  auteur: string;

  @ApiProperty({ example: 'Patient anxieux, prévoir plus de temps pour la préparation.' })
  contenu: string;
}
