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

  @ApiPropertyOptional({
    description: "Examens complémentaires à prévoir avant l'endoscopie (texte libre, saisi depuis le dossier patient)",
  })
  examensComplementaires?: string;
}
