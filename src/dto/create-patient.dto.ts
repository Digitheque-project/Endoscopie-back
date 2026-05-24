import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePatientDto {
  @ApiProperty({ example: 'Dupont' })
  nom: string;

  @ApiProperty({ example: 'Marie' })
  prenom: string;

  @ApiPropertyOptional({ example: '1975-06-15T00:00:00.000Z' })
  dateNaissance?: string;

  @ApiPropertyOptional({ example: 'F' })
  sexe?: string;

  @ApiPropertyOptional({ example: 'A+' })
  groupeSanguin?: string;

  @ApiPropertyOptional({ example: 68.5 })
  poids?: number;

  @ApiPropertyOptional({ example: 'Hypertension artérielle' })
  antecedentsMedicaux?: string;
}
