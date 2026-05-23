import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRendezVousDto {
  @ApiPropertyOptional({ example: 'uuid-patient' })
  patientId?: string;

  @ApiPropertyOptional({ example: 'uuid-prescription' })
  prescriptionId?: string;

  @ApiPropertyOptional({ example: 'uuid-medecin' })
  medecinId?: string;

  @ApiPropertyOptional({ example: 'uuid-salle' })
  salleId?: string;

  @ApiProperty({ example: '2026-05-23T09:00:00.000Z' })
  dateHeureDebut: string;

  @ApiPropertyOptional({ example: '2026-05-23T10:00:00.000Z' })
  dateHeureFin?: string;

  @ApiPropertyOptional({ example: 'Locale' })
  typeAnesthesie?: string;

  @ApiPropertyOptional({ example: 'Prevu', default: 'Prevu' })
  statut?: string;

  @ApiPropertyOptional()
  notesCliniques?: string;
}
