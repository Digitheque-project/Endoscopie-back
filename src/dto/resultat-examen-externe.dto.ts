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

  @ApiProperty({ type: ResultatsDto })
  resultats: ResultatsDto;

  @ApiProperty({ example: 'Gastrite érythémateuse modérée' })
  conclusion?: string;

  @ApiProperty({ example: 'Traitement IPP 6 semaines' })
  recommandation?: string;

  @ApiProperty({ example: 'Dr. Razafindrabe' })
  medecin?: string;

  @ApiProperty({ example: '2024-06-24T10:30:00Z' })
  dateResultat: string;
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
