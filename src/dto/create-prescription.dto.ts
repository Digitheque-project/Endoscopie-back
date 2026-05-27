import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePrescriptionDto {
  @ApiPropertyOptional({
    example: '38f39d38-152e-495b-8c48-28937750d9eb',
    description: 'Service Endoscopie (CHU Railway)',
  })
  serviceId?: string;

  @ApiProperty({
    description: 'UUID réel issu de GET /api/patients (pas "uuid-patient")',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  patientId: string;

  @ApiProperty({
    description: 'UUID réel issu de GET /api/medecins',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
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
