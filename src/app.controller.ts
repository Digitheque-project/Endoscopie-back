import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { Roles } from './auth/roles.decorator';
import { CreateRendezVousDto } from './dto/create-rendezvous.dto';
import { CreateSalleDto } from './dto/create-salle.dto';
import { SaveChecklistAvantDto } from './dto/save-checklist-avant.dto';
import { SaveOperationDto } from './dto/save-operation.dto';
import { SaveChecklistApresDto } from './dto/save-checklist-apres.dto';
import { SaveResultatDto } from './dto/save-resultat.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { SaveConfirmationPlanificationDto } from './dto/save-confirmation-planification.dto';
import { UpdateRendezVousDto } from './dto/update-rendezvous.dto';
import { CreateNoteDossierDto } from './dto/create-note-dossier.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiTags('Santé')
  @ApiOperation({ summary: '[GET] Vérifier que l’API répond' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/test-db')
  @ApiTags('Diagnostic')
  @ApiOperation({ summary: 'Tester la connexion Prisma / base de données' })
  @ApiQuery({ name: 'serviceId', required: false })
  async testDb(@Query('serviceId') serviceId?: string) {
    return this.appService.testDb(serviceId);
  }

  @Get('api/health')
  @ApiTags('Diagnostic')
  @ApiOperation({ summary: 'État de la base (migration serviceId, compteurs)' })
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('api/config/endoscopie')
  @ApiTags('Configuration')
  @ApiOperation({
    summary: 'Configuration du service Endoscopie (ID CHU Railway)',
  })
  getEndoscopieConfig() {
    return this.appService.getEndoscopieConfig();
  }


  // ——— Patients ———
  @Get('api/patients')
  @ApiTags('Patients')
  @ApiOperation({ summary: 'Lister tous les patients' })
  async getPatients() {
    return this.appService.getPatients();
  }

  @Get('api/patients/:id')
  @ApiTags('Patients')
  @ApiOperation({ summary: 'Récupérer un patient par ID' })
  @ApiParam({ name: 'id', description: 'Identifiant Accueil du patient' })
  async getPatientById(@Param('id') id: string) {
    return this.appService.getPatientById(id);
  }

  @Get('api/patients/:id/parcours-medical')
  @ApiTags('Patients')
  @ApiOperation({
    summary: "Parcours médical complet du patient (dossier patient CHU)",
    description:
      "Suivis et diagnostics du patient au-delà de l'Endoscopie, depuis le microservice Dossier Patient CHU. " +
      "Ce service n'est pas encore relié (token propre non fourni) : renvoie `available: false` et des listes vides " +
      "jusqu'à ce qu'il le soit, sans jamais échouer.",
  })
  @ApiParam({ name: 'id', description: 'Identifiant Accueil du patient' })
  async getPatientTraceability(@Param('id') id: string) {
    return this.appService.getPatientTraceability(id);
  }

  // ——— Prescriptions ———
  @Get('api/prescriptions')
  @ApiTags('Prescriptions')
  @ApiOperation({ summary: 'Lister toutes les prescriptions' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getPrescriptions(@Query('serviceId') serviceId?: string) {
    return this.appService.getPrescriptions(serviceId);
  }

  @Get('api/prescriptions/:id')
  @ApiTags('Prescriptions')
  @ApiOperation({ summary: 'Récupérer une prescription par ID' })
  @ApiParam({ name: 'id', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getPrescriptionById(
    @Param('id') id: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getPrescriptionById(id, serviceId);
  }

  // ——— Médecins ———
  @Get('api/medecins')
  @ApiTags('Médecins')
  @ApiOperation({ summary: 'Lister tous les médecins d\'Endoscopie (en direct depuis le service auth/utilisateurs centralisé)' })
  async getMedecins() {
    return this.appService.getMedecins();
  }

  // ——— Types d'examen ———
  @Get('api/exam-types')
  @ApiTags('Configuration')
  @ApiOperation({ summary: "Lister les types d'examen d'endoscopie" })
  async getExamTypes() {
    return this.appService.getExamTypes();
  }


  @Get('api/archives/types-examen')
  @ApiTags('Archives')
  @ApiOperation({
    summary: "Types d'examen distincts réellement présents dans les archives",
    description:
      "À utiliser pour peupler le filtre \"Type d'examen\" de l'archive — contrairement à /api/exam-types (catalogue figé), " +
      "reflète les valeurs exactes stockées sur les prescriptions (évite les variantes orthographiques non reconnues par un filtre exact).",
  })
  @ApiQuery({ name: 'serviceId', required: false })
  async getArchiveTypesExamen(@Query('serviceId') serviceId?: string) {
    return this.appService.getArchiveTypesExamen(serviceId);
  }

  @Get('api/archives')
  @ApiTags('Archives')
  @ApiOperation({ summary: 'Rechercher les dossiers patients archivés (prescription + CPA + checklists + résultat)' })
  @ApiQuery({ name: 'nom', required: false, description: 'Recherche par nom ou prénom du patient' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Date de début (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Date de fin (YYYY-MM-DD)' })
  @ApiQuery({ name: 'typeExamen', required: false, description: "Filtrer par type d'examen (ex. Coloscopie)" })
  @ApiQuery({ name: 'typeAnesthesie', required: false, description: 'Filtrer par type d\'anesthésie (Locale ou Générale)' })
  @ApiQuery({ name: 'motCle', required: false, description: 'Recherche libre dans le texte du compte rendu (observations, conclusion, diagnostic...)' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getArchives(
    @Query('nom') nom?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('typeExamen') typeExamen?: string,
    @Query('typeAnesthesie') typeAnesthesie?: string,
    @Query('motCle') motCle?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getArchives(
      { nom, dateFrom, dateTo, typeExamen, typeAnesthesie, motCle },
      serviceId,
    );
  }

  // ——— Dossiers CPA ———
  @Get('api/dossiers-cpa')
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: 'Lister tous les dossiers CPA' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getDossiersCpa(@Query('serviceId') serviceId?: string) {
    return this.appService.getDossiersCpa(serviceId);
  }

  @Get('api/dossiers-cpa/prescription/:prescriptionId')
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: 'Récupérer le dossier CPA d’une prescription' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  async getDossierCpaByPrescriptionId(
    @Param('prescriptionId') prescriptionId: string,
  ) {
    return this.appService.getDossierCpaByPrescriptionId(prescriptionId);
  }

  @Get('api/dossiers-cpa/:id')
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: 'Récupérer un dossier CPA par ID' })
  @ApiParam({ name: 'id', description: 'UUID du dossier CPA' })
  async getDossierCpaById(@Param('id') id: string) {
    return this.appService.getDossierCpaById(id);
  }

  @Get('api/dossiers-cpa/:id/verifier-statut')
  @ApiTags('Dossiers CPA')
  @ApiOperation({
    summary: 'Vérifier manuellement le statut de la demande CPA auprès du Bloc Opératoire',
    description:
      'Filet de sécurité si le webhook de callback (CPA_RESULTAT/VPA_REALISEE) n\'est jamais arrivé : ' +
      'interroge GET /demandes-cpa-externes/:id/statut sur le Bloc et applique localement la décision si disponible.',
  })
  @ApiParam({ name: 'id', description: 'UUID du dossier CPA' })
  async verifierStatutCpaBloc(@Param('id') id: string) {
    return this.appService.verifierStatutCpaBloc(id);
  }

  @Post('api/dossiers-cpa')
  @Roles('MAJOR')
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: '[POST] Créer un dossier CPA (réservé au rôle Major)', operationId: 'createDossierCpa' })
  @ApiBody({ type: CreateDossierCpaDto })
  async createDossierCpa(@Body() data: CreateDossierCpaDto) {
    return this.appService.createDossierCpa(data);
  }

  @Patch('api/dossiers-cpa/:id')
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: '[PATCH] Mettre à jour un dossier CPA', operationId: 'updateDossierCpa' })
  @ApiBody({ type: UpdateDossierCpaDto })
  @ApiParam({ name: 'id', description: 'UUID du dossier CPA' })
  async updateDossierCpa(
    @Param('id') id: string,
    @Body() data: UpdateDossierCpaDto,
  ) {
    return this.appService.updateDossierCpa(id, data);
  }

  // ——— Rendez-vous ———
  @Get('api/rendezvous/jour/:date')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Lister les rendez-vous du jour' })
  @ApiParam({ name: 'date', description: 'Date au format YYYY-MM-DD' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getRendezVousJour(
    @Param('date') date: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getRendezVousJour(date, serviceId);
  }

  @Get('api/rendezvous/counts-month')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Compter les rendez-vous par jour du mois' })
  @ApiQuery({ name: 'year', required: true, example: 2026 })
  @ApiQuery({ name: 'month', required: true, example: 6 })
  @ApiQuery({ name: 'serviceId', required: false })
  async getRendezVousCountsByMonth(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getRendezVousCountsByMonth(
      parseInt(year, 10),
      parseInt(month, 10),
      serviceId,
    );
  }

  @Get('api/rendezvous')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Lister les rendez-vous' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getRendezVous(@Query('serviceId') serviceId?: string) {
    return this.appService.getRendezVous(serviceId);
  }

  @Get('api/rendezvous/procedure-counts-today')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Compter les procédures du jour par type' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getProcedureCountsToday(@Query('serviceId') serviceId?: string) {
    return this.appService.getProcedureCountsToday(serviceId);
  }

  @Post('api/rendezvous')
  @Roles('MAJOR')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: '[POST] Créer ou mettre à jour un rendez-vous (réservé au rôle Major)', operationId: 'createRendezVous' })
  @ApiBody({ type: CreateRendezVousDto })
  @ApiOkResponse({ description: 'Rendez-vous créé ou mis à jour' })
  async createRendezVous(@Body() data: CreateRendezVousDto) {
    return this.appService.createRendezVous(data);
  }

  @Patch('api/rendezvous/:id')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: '[PATCH] Mettre à jour partiellement un rendez-vous (décision anesthésie, statut)', operationId: 'updateRendezVous' })
  @ApiParam({ name: 'id', description: 'UUID du rendez-vous' })
  @ApiBody({ type: UpdateRendezVousDto })
  @ApiQuery({ name: 'serviceId', required: false })
  async updateRendezVous(
    @Param('id') id: string,
    @Body() data: UpdateRendezVousDto,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.updateRendezVous(id, data, serviceId);
  }

  // ——— Salles ———
  @Get('api/salles')
  @ApiTags('Salles')
  @ApiOperation({ summary: 'Lister les salles' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getSalles(@Query('serviceId') serviceId?: string) {
    return this.appService.getSalles(serviceId);
  }

  @Post('api/salles')
  @ApiTags('Salles')
  @ApiOperation({ summary: '[POST] Créer une salle', operationId: 'createSalle' })
  @ApiBody({ type: CreateSalleDto })
  async createSalle(@Body() data: CreateSalleDto) {
    return this.appService.createSalle(data);
  }

  // ——— Checklists ———
  @Get('api/checklists/avant/:prescriptionId')
  @ApiTags('Checklists')
  @ApiOperation({ summary: 'Récupérer la checklist avant endoscopie' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getChecklistAvant(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getChecklistAvant(prescriptionId, serviceId);
  }

  @Post('api/checklists/avant')
  @Roles('MEDECIN')
  @ApiTags('Checklists')
  @ApiOperation({ summary: '[POST] Enregistrer la checklist avant endoscopie (réservé au rôle Médecin)', operationId: 'saveChecklistAvant' })
  @ApiBody({ type: SaveChecklistAvantDto })
  async saveChecklistAvant(@Body() data: SaveChecklistAvantDto) {
    return this.appService.saveChecklistAvant(data);
  }

  // ——— Notes du dossier patient ———
  @Get('api/notes-dossier/:prescriptionId')
  @ApiTags('Notes')
  @ApiOperation({ summary: 'Récupérer les notes libres du dossier patient' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getNotesDossier(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getNotesDossier(prescriptionId, serviceId);
  }

  @Post('api/notes-dossier')
  @ApiTags('Notes')
  @ApiOperation({ summary: 'Ajouter une note libre au dossier patient', operationId: 'createNoteDossier' })
  @ApiBody({ type: CreateNoteDossierDto })
  async createNoteDossier(@Body() data: CreateNoteDossierDto) {
    return this.appService.createNoteDossier(data);
  }

  // ——— Operations ———
  @Get('api/operations/:prescriptionId')
  @ApiTags('Operations')
  @ApiOperation({ summary: 'Récupérer les notes de l\'opération endoscopie' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getOperation(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getOperation(prescriptionId, serviceId);
  }

  @Post('api/operations')
  @Roles('MEDECIN')
  @ApiTags('Operations')
  @ApiOperation({ summary: '[POST] Enregistrer les notes de l\'opération endoscopie (réservé au rôle Médecin)', operationId: 'saveOperation' })
  @ApiBody({ type: SaveOperationDto })
  async saveOperation(@Body() data: SaveOperationDto) {
    return this.appService.saveOperation(data);
  }

  // ——— Checklist Après ———
  @Get('api/checklists/apres/:prescriptionId')
  @ApiTags('Checklists')
  @ApiOperation({ summary: 'Récupérer la checklist après endoscopie' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getChecklistApres(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getChecklistApres(prescriptionId, serviceId);
  }

  @Post('api/checklists/apres')
  @Roles('MEDECIN')
  @ApiTags('Checklists')
  @ApiOperation({ summary: '[POST] Enregistrer la checklist après endoscopie (réservé au rôle Médecin)', operationId: 'saveChecklistApres' })
  @ApiBody({ type: SaveChecklistApresDto })
  async saveChecklistApres(@Body() data: SaveChecklistApresDto) {
    return this.appService.saveChecklistApres(data);
  }

  @Get('api/checklists/progress-today')
  @ApiTags('Checklists')
  @ApiOperation({ summary: 'Progression des checklists avant/après pour les rendez-vous du jour' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getChecklistsProgressToday(@Query('serviceId') serviceId?: string) {
    return this.appService.getChecklistsProgressToday(serviceId);
  }

  // ——— Rapport ———
  @Get('api/rapport/stats')
  @ApiTags('Rapport')
  @ApiOperation({ summary: 'Statistiques agrégées (patients reçus, genre, types d\'examen) sur une période' })
  @ApiQuery({ name: 'period', required: false, enum: ['week', 'month'] })
  @ApiQuery({ name: 'date', required: false, description: 'Date de référence ISO (défaut: aujourd\'hui)' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getRapportStats(
    @Query('period') period?: 'week' | 'month',
    @Query('date') date?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getRapportStats(period, date, serviceId);
  }

  // ——— Résultats ———
  @Get('api/resultats')
  @ApiTags('Resultats')
  @ApiOperation({ summary: 'Lister tous les résultats d\'endoscopie' })
  @ApiQuery({ name: 'serviceId', required: false })
  async listResultats(@Query('serviceId') serviceId?: string) {
    return this.appService.listResultats(serviceId);
  }

  @Get('api/resultats/:prescriptionId')
  @ApiTags('Resultats')
  @ApiOperation({ summary: 'Récupérer les résultats de l\'endoscopie' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getResultat(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getResultat(prescriptionId, serviceId);
  }

  @Post('api/resultats')
  @Roles('MEDECIN')
  @ApiTags('Resultats')
  @ApiOperation({ summary: '[POST] Enregistrer les résultats de l\'endoscopie (réservé au rôle Médecin)', operationId: 'saveResultat' })
  @ApiBody({ type: SaveResultatDto })
  async saveResultat(@Body() data: SaveResultatDto) {
    return this.appService.saveResultat(data);
  }

  // ——— Confirmation & Planification ———
  @Post('api/confirmations-planification')
  @ApiTags('Confirmations & Planification')
  @ApiOperation({
    summary: '[POST] Sauvegarder une confirmation de planification complète',
    operationId: 'saveConfirmationPlanification',
  })
  @ApiBody({ type: SaveConfirmationPlanificationDto })
  async saveConfirmationPlanification(@Body() data: SaveConfirmationPlanificationDto) {
    return this.appService.saveConfirmationPlanification(data);
  }

  // ——— Partage Public de Résultats ———
  @Post('api/resultats/:prescriptionId/share')
  @ApiTags('Resultats')
  @ApiOperation({
    summary: '[POST] Générer un lien public de partage pour les résultats',
    description: 'Crée un token unique et un lien de partage public pour accéder au résultat sans authentification',
    operationId: 'generatePublicShareLink',
  })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiOkResponse({
    description: 'Lien de partage généré',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: '5f8c9e2a7b3d1f6a4c9e' },
        shareUrl: { type: 'string', example: 'https://api.endoscopie.com/api/resultats/public/5f8c9e2a7b3d1f6a4c9e' },
      },
    },
  })
  async generatePublicShareLink(@Param('prescriptionId') prescriptionId: string) {
    return this.appService.generatePublicShareLink(prescriptionId);
  }

  @Get('api/resultats/public/:token')
  @ApiTags('Resultats')
  @ApiOperation({
    summary: '[GET] Accéder aux résultats avec un lien public',
    description: 'Endpoint public - pas d\'authentification requise. Utilise le token généré par /api/resultats/:prescriptionId/share',
    operationId: 'getResultatPublic',
  })
  @ApiParam({ name: 'token', description: 'Token de partage public unique' })
  async getResultatPublic(@Param('token') token: string) {
    return this.appService.getResultatByPublicToken(token);
  }

  @Post('api/resultats/:prescriptionId/unshare')
  @ApiTags('Resultats')
  @ApiOperation({
    summary: '[POST] Révoquer le lien public de partage',
    operationId: 'revokePublicShareLink',
  })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  async revokePublicShareLink(@Param('prescriptionId') prescriptionId: string) {
    return this.appService.revokePublicShareLink(prescriptionId);
  }

  @Get('api/confirmations-planification')
  @ApiTags('Confirmations & Planification')
  @ApiOperation({ summary: 'Lister toutes les confirmations de planification' })
  @ApiQuery({ name: 'serviceId', required: false })
  async listConfirmationsPlanification(@Query('serviceId') serviceId?: string) {
    return this.appService.listConfirmationsPlanification(serviceId);
  }

  @Get('api/confirmations-planification/:prescriptionId')
  @ApiTags('Confirmations & Planification')
  @ApiOperation({ summary: 'Récupérer la confirmation de planification d\'une prescription' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getConfirmationPlanification(
    @Param('prescriptionId') prescriptionId: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getConfirmationPlanification(prescriptionId, serviceId);
  }
}
