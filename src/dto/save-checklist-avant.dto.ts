import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveChecklistAvantDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

  @ApiProperty({ example: 'uuid-prescription' })
  prescriptionId: string;

  @ApiProperty({ example: 'uuid-patient' })
  patientId: string;

  @ApiPropertyOptional({ example: 'uuid-rendezvous' })
  rendezVousId?: string;

  @ApiPropertyOptional()
  identiteVerifiee?: boolean;

  @ApiPropertyOptional()
  procedureConfirmee?: boolean;

  @ApiPropertyOptional()
  materielDisponible?: boolean;

  @ApiPropertyOptional()
  risquesVerifies?: boolean;

  @ApiPropertyOptional()
  jeuneRespecte?: boolean;

  @ApiPropertyOptional()
  preparationAdequate?: boolean;

  @ApiPropertyOptional()
  validationCollegiale?: boolean;

  @ApiPropertyOptional()
  anticoagulantsArretes?: boolean;

  @ApiPropertyOptional()
  antibioprophylaxie?: boolean;

  @ApiPropertyOptional()
  tenueAppropriee?: boolean;

  @ApiPropertyOptional({ example: '120/80' })
  constantes_tension?: string;

  @ApiPropertyOptional({ example: '72' })
  constantes_pouls?: string;

  @ApiPropertyOptional({ example: '98' })
  constantes_saturation?: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiPropertyOptional()
  estValide?: boolean;
}
