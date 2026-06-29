import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PatientDto {
  @ApiProperty({ example: 'Doe' })
  nom: string;

  @ApiProperty({ example: 'Jean' })
  prenoms: string;

  @ApiProperty({ example: '1980-05-12' })
  dateNaissance: string;

  @ApiProperty({ example: 43 })
  age: number;

  @ApiProperty({ example: 'Masculin' })
  genre: 'Masculin' | 'Féminin';
}

class DetailsPrescriptionDto {
  @ApiProperty({ example: 'uuid-prescription' })
  numeroPrescription: string;

  @ApiProperty({ example: '2026-06-25' })
  datePrescription: string;

  @ApiProperty({ example: 'Dr. Dupont' })
  prescripteur: string;

  @ApiProperty({ type: PatientDto })
  patient: PatientDto;

  @ApiProperty({ example: 'Coloscopie' })
  typeExamen: string;

  @ApiProperty({ example: 'Urgent' })
  degreeUrgence: 'Électif' | 'Urgent' | 'Semi-urgent' | 'Très urgent';

  @ApiProperty({ example: 'Saignement digestif' })
  indicationClinique: string;

  @ApiProperty({ example: 'Gastro entérologie' })
  serviceDemandeur: string;

  @ApiPropertyOptional({ example: 'Patient allergique à la pénicilline' })
  observations?: string;

  @ApiProperty({ example: 'EN_ATTENTE' })
  statut: 'EN_ATTENTE' | 'CONFIRME' | 'EN_COURS' | 'TERMINE' | 'ANNULE';
}

class RendezVousConfirmeDto {
  @ApiProperty({ example: '2026-06-26' })
  date: string;

  @ApiProperty({ example: '09:30' })
  heure: string;

  @ApiProperty({ example: 'Salle A' })
  salle: string;

  @ApiProperty({ example: 'CHU Centre' })
  hopital: string;

  @ApiProperty({ example: 'Dr. Martin' })
  operateurAssigne: string;

  @ApiProperty({ example: '01:30' })
  dureeEstimee: string;

  @ApiProperty({ example: 'À jeun depuis minuit' })
  instructionsPatient: string;

  @ApiProperty({ example: true })
  confirmeParAdmin: boolean;

  @ApiPropertyOptional({ example: '2026-06-24T12:25:00.000Z' })
  confirmeParAdminLe?: string;
}

class TypeAnesthesieInfoDto {
  @ApiProperty({ example: 'anesthesie_locale' })
  type: 'anesthesie_locale' | 'anesthesie_generale';

  @ApiProperty({ example: 'Spray lidocaïne / gel' })
  description: string;

  @ApiProperty({ example: false })
  medecinAnesthesisteRequis: boolean;

  @ApiPropertyOptional({ example: 'Présence obligatoire du médecin anesthésiste.' })
  remarque?: string;
}

export class SaveConfirmationPlanificationDto {
  @ApiPropertyOptional({ example: '38f39d38-152e-495b-8c48-28937750d9eb' })
  serviceId?: string;

  @ApiProperty({ type: DetailsPrescriptionDto })
  detailsPrescription: DetailsPrescriptionDto;

  @ApiProperty({ type: RendezVousConfirmeDto })
  rendezVous: RendezVousConfirmeDto;

  @ApiPropertyOptional({ type: TypeAnesthesieInfoDto, nullable: true })
  typeAnesthesie?: TypeAnesthesieInfoDto | null;
}
