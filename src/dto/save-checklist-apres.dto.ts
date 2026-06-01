import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveChecklistApresDto {
  @ApiPropertyOptional()
  serviceId?: string;

  @ApiProperty()
  prescriptionId: string;

  @ApiProperty()
  patientId: string;

  @ApiPropertyOptional()
  confirmationEtiquetage?: string;

  @ApiPropertyOptional()
  prescriptionsPostActe?: string;

  @ApiPropertyOptional()
  remarques?: string;

  @ApiPropertyOptional()
  estValide?: boolean;
}
