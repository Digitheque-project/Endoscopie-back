import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRendezVousDto {
  @ApiPropertyOptional({ example: 'Locale' })
  typeAnesthesie?: string;

  @ApiPropertyOptional({ example: 'Décision rendue' })
  statut?: string;

  @ApiPropertyOptional()
  notesCliniques?: string;

  @ApiPropertyOptional({ example: '2026-07-30T08:30:00.000' })
  dateHeureDebut?: string;

  @ApiPropertyOptional({ example: '2026-07-30T09:15:00.000' })
  dateHeureFin?: string;

  @ApiPropertyOptional({ description: "Second examen réalisé dans la même séance (cas d'une double opération)", example: 'Coloscopie' })
  typeExamenSecondaire?: string;
}
