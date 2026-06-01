import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveResultatDto {
  @ApiPropertyOptional()
  serviceId?: string;

  @ApiProperty()
  prescriptionId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  reportText?: string;

  @ApiPropertyOptional()
  mainDiagnosis?: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiPropertyOptional()
  conclusion?: string;

  @ApiPropertyOptional()
  complication?: string;

  @ApiPropertyOptional()
  biopsy?: string;

  @ApiPropertyOptional()
  followUp?: string;

  @ApiPropertyOptional()
  doctorName?: string;
}
