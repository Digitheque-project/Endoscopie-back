import { ApiProperty } from '@nestjs/swagger';

export class PatientInfoDto {
  @ApiProperty({ example: 'Rakoto' })
  nom: string;

  @ApiProperty({ example: 'Jean' })
  prenoms: string;

  @ApiProperty({ example: '1975-03-12' })
  dateNaissance: string;
}

export class ResultatsDto {
  @ApiProperty({ example: 'Normal' })
  oesophage?: string;

  @ApiProperty({ example: 'Normale' })
  cardia?: string;

  @ApiProperty({ example: 'Gastrite érythémateuse' })
  estomac?: string;

  @ApiProperty({ example: 'Franchissable' })
  pylore?: string;

  @ApiProperty({ example: 'Normal' })
  duodenum?: string;

  [key: string]: string | undefined;
}

export class ResultatExamenExterneDto {
  @ApiProperty({ example: 'a1b2c3d4-...', description: "Identifiant du résultat lui-même (à utiliser comme référence stable, plutôt que prescriptionId, pour marquer un résultat comme lu ou le dédupliquer)" })
  resultatId?: string;

  @ApiProperty({ example: 'PRES-2024-0187' })
  prescriptionId: string;

  @ApiProperty({ type: PatientInfoDto })
  patient: PatientInfoDto;

  @ApiProperty({ example: 'Fibroscopie digestive haute' })
  typeExamen: string;

  @ApiProperty({ example: '2024-06-24' })
  dateExamen: string;

  @ApiProperty({ example: 'TERMINE', enum: ['PREVU', 'EN_COURS', 'TERMINE', 'ANNULE'] })
  statut: string;

  @ApiProperty({ type: ResultatsDto, description: 'Constatations détaillées (par organe, matériel, équipe...) — reflet brut du compte rendu' })
  resultats: ResultatsDto;

  @ApiProperty({ example: 'Gastrite érythémateuse modérée' })
  conclusion?: string;

  @ApiProperty({ example: 'Traitement IPP 6 semaines' })
  recommandation?: string;

  @ApiProperty({ example: 'Compte rendu complet rédigé par le médecin', description: 'Texte libre du compte rendu' })
  reportText?: string;

  @ApiProperty({ example: 'Gastrite chronique', description: 'Diagnostic principal' })
  mainDiagnosis?: string;

  @ApiProperty({ example: 'Muqueuse érythémateuse diffuse', description: 'Observations détaillées de l\'examen' })
  observations?: string;

  @ApiProperty({ example: 'Aucune', description: 'Complications éventuelles survenues pendant l\'examen' })
  complication?: string;

  @ApiProperty({ example: 'Biopsie antrale x2', description: 'Prélèvements biopsiques réalisés' })
  biopsy?: string;

  @ApiProperty({ example: 'Dr. Razafindrabe', description: "Nom du médecin ayant rédigé le compte rendu (distinct du prescripteur)" })
  doctorName?: string;

  @ApiProperty({ example: 'Dr. Razafindrabe' })
  medecin?: string;

  @ApiProperty({ example: '2024-06-24T10:30:00Z' })
  dateResultat: string;
}

export class RendezVousExterneDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-...', nullable: true })
  patientId: string | null;

  @ApiProperty({ example: '2026-08-20T08:30:00.000Z' })
  dateHeureDebut: string;

  @ApiProperty({ example: '2026-08-20T09:00:00.000Z', nullable: true })
  dateHeureFin: string | null;

  @ApiProperty({ example: 'Salle 2', nullable: true })
  salle: string | null;

  @ApiProperty({ example: 'Confirmé' })
  statut: string;

  @ApiProperty({ example: 'Fibroscopie digestive haute', nullable: true })
  typeExamen: string | null;
}

export class CreateServiceExterneDto {
  @ApiProperty({ example: 'Radiologie Générale' })
  nom: string;

  @ApiProperty({ example: 'Hôpital Général de Tananarive' })
  hopital?: string;

  @ApiProperty({ example: 'contact@radiologie.mg' })
  contact?: string;
}

export class ServiceExterneResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nom: string;

  @ApiProperty()
  apiKey: string;

  @ApiProperty()
  actif: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  lastUsedAt?: Date;

  @ApiProperty()
  hopital?: string;

  @ApiProperty()
  contact?: string;
}

export class UpdateServiceExterneDto {
  @ApiProperty({ required: false })
  nom?: string;

  @ApiProperty({ required: false })
  actif?: boolean;

  @ApiProperty({ required: false })
  hopital?: string;

  @ApiProperty({ required: false })
  contact?: string;
}
