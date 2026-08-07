import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { DossierPatientService } from '../services/dossier-patient.service';

/**
 * Lecture seule — voir le commentaire de DossierPatientService. Aucune route de création/
 * modification n'est exposée ici volontairement.
 */
@ApiTags('Dossier Patient CHU')
@Controller('api/dossier-patient')
export class DossierPatientController {
  constructor(private readonly dossierPatientService: DossierPatientService) {}

  @Get(':patientId/observations')
  @ApiOperation({ summary: 'Observations médicales du patient (Dossier Patient CHU)' })
  @ApiParam({ name: 'patientId', description: 'Identifiant Accueil du patient' })
  getObservations(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getObservations(patientId);
  }

  @Get(':patientId/diagnostics')
  @ApiOperation({ summary: 'Diagnostics du patient (Dossier Patient CHU)' })
  getDiagnostics(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getDiagnostics(patientId);
  }

  @Get(':patientId/suivis')
  @ApiOperation({ summary: 'Suivis quotidiens du patient (Dossier Patient CHU)' })
  getSuivis(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getSuivis(patientId);
  }

  @Get(':patientId/parametres')
  @ApiOperation({ summary: 'Relevés de paramètres du patient (Dossier Patient CHU)' })
  getParametres(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getParametres(patientId);
  }

  @Get(':patientId/historique')
  @ApiOperation({
    summary: "Historique d'actions du dossier (Dossier Patient CHU)",
    description: "Peut renvoyer une liste vide si cet endpoint n'est pas encore implémenté côté service externe.",
  })
  getHistorique(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getHistorique(patientId);
  }

  @Get(':patientId/resultats')
  @ApiOperation({
    summary: 'Résultats paracliniques du patient (Dossier Patient CHU)',
    description: "Peut renvoyer une liste vide si cet endpoint n'est pas encore implémenté côté service externe.",
  })
  getResultats(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getResultats(patientId);
  }
}
