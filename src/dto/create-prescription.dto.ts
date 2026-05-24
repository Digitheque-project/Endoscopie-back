import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePrescriptionDto {
  @ApiProperty({ example: 'uuid-patient' })
  patientId: string;

  @ApiProperty({ example: 'uuid-medecin' })
  medecinId: string;

  @ApiProperty({ example: 'Coloscopie' })
  typeExamen: string;

  @ApiPropertyOptional({ example: 'Suivi post-polypectomie' })
  motif?: string;

  @ApiPropertyOptional({ example: 'Standard', default: 'Standard' })
  priorite?: string;

  @ApiPropertyOptional({ example: 'A planifier', default: 'A planifier' })
  statut?: string;

  @ApiPropertyOptional({ example: '2026-05-23T08:00:00.000Z' })
  dateDemande?: string;
}
