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

  @ApiPropertyOptional({ description: "Type d'examen sélectionné dans le formulaire" })
  typeExamen?: string;

  @ApiPropertyOptional({ description: 'Identité du responsable / indication clinique (varie selon le formulaire)' })
  responsable?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Équipe endoscopiste (opérateur, infirmières, anesthésiste)' })
  endoscopistes?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Informations infirmières complémentaires' })
  infirmieres?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Informations matériel / rendez-vous (endoscope, désinfection, kit ligature...)' })
  rendezVous?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Constatations anatomiques, spécifiques au type d'examen" })
  constatations?: Record<string, unknown>;
}
