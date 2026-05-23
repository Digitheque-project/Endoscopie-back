import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalleDto {
  @ApiProperty({ example: 'Salle Endoscopie A' })
  nom: string;

  @ApiProperty({ example: 'S01' })
  numero: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  capacite?: number;

  @ApiPropertyOptional({ example: 'Coloscope, gastroscope' })
  equipement?: string;
}
