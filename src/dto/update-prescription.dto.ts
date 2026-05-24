import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePrescriptionDto {
  @ApiPropertyOptional({ example: 'Planifié' })
  statut?: string;

  @ApiPropertyOptional({ example: 'Urgent' })
  priorite?: string;

  @ApiPropertyOptional({ example: 'Fibroscopie haute' })
  typeExamen?: string;

  @ApiPropertyOptional()
  motif?: string;
}
