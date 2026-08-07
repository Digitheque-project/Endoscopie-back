import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { DossierPatientService } from '../services/dossier-patient.service';

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

  @Post(':patientId/observations')
  @ApiOperation({ summary: 'Créer une observation médicale' })
  createObservation(@Param('patientId') patientId: string, @Body() body: Record<string, unknown>) {
    return this.dossierPatientService.createObservation(patientId, body);
  }

  @Get(':patientId/diagnostics')
  @ApiOperation({ summary: 'Diagnostics du patient (Dossier Patient CHU)' })
  getDiagnostics(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getDiagnostics(patientId);
  }

  @Post(':patientId/diagnostics')
  @ApiOperation({ summary: 'Créer un diagnostic' })
  createDiagnostic(@Param('patientId') patientId: string, @Body() body: Record<string, unknown>) {
    return this.dossierPatientService.createDiagnostic(patientId, body);
  }

  @Get(':patientId/suivis')
  @ApiOperation({ summary: 'Suivis quotidiens du patient (Dossier Patient CHU)' })
  getSuivis(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getSuivis(patientId);
  }

  @Post(':patientId/suivis')
  @ApiOperation({ summary: 'Ajouter un suivi quotidien' })
  createSuivi(@Param('patientId') patientId: string, @Body() body: Record<string, unknown>) {
    return this.dossierPatientService.createSuivi(patientId, body);
  }

  @Get(':patientId/parametres')
  @ApiOperation({ summary: 'Relevés de paramètres du patient (Dossier Patient CHU)' })
  getParametres(@Param('patientId') patientId: string) {
    return this.dossierPatientService.getParametres(patientId);
  }

  @Post(':patientId/parametres')
  @ApiOperation({ summary: 'Ajouter un relevé manuel de paramètres' })
  createParametre(@Param('patientId') patientId: string, @Body() body: Record<string, unknown>) {
    return this.dossierPatientService.createParametre(patientId, body);
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

  @Patch(':patientId/resultats/:resultatId/lu')
  @ApiOperation({ summary: 'Marquer un résultat paraclinique comme lu' })
  markResultatLu(@Param('patientId') patientId: string, @Param('resultatId') resultatId: string) {
    return this.dossierPatientService.markResultatLu(patientId, resultatId);
  }
}
