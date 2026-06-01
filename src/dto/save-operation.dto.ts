import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveOperationDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

  @ApiProperty({ example: 'uuid-prescription' })
  prescriptionId: string;

  @ApiProperty({ example: 'uuid-patient' })
  patientId: string;

  @ApiPropertyOptional({ example: 'Texte des notes médicales' })
  medicalNotes?: string;

  @ApiPropertyOptional({ example: [{ id: '1', content: 'hello', timestamp: '...' }] })
  voiceTranscripts?: any;
}
