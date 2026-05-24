import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedecinDto {
  @ApiProperty({ example: 'Martin' })
  nom: string;

  @ApiProperty({ example: 'Jean' })
  prenom: string;

  @ApiPropertyOptional({ example: 'Gastro-entérologie' })
  specialite?: string;

  @ApiPropertyOptional({ example: 'Médecin' })
  role?: string;
}
