import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalleDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

  @ApiProperty({ example: 'Salle Endoscopie A' })
  nom: string;

  @ApiProperty({ example: 'S01' })
  numero: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  capacite?: number;

  @ApiPropertyOptional({ example: 'Coloscope, gastroscope' })
  equipement?: string;
}
