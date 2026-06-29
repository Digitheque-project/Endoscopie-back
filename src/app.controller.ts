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
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { CreateMedecinDto } from './dto/create-medecin.dto';
import { CreateDossierCpaDto } from './dto/create-dossier-cpa.dto';
import { UpdateDossierCpaDto } from './dto/update-dossier-cpa.dto';
import { SaveConfirmationPlanificationDto } from './dto/save-confirmation-planification.dto';
import { UpdateRendezVousDto } from './dto/update-rendezvous.dto';

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

  @Get('api/notifications/health')
  @ApiTags('Notifications')
  @ApiOperation({ summary: 'Vérifier la connexion au service notification Render' })
  getNotificationHealth() {
    return this.appService.getNotificationHealth();
  }

  @Get('api/notifications')
  @ApiTags('Notifications')
  @ApiOperation({
    summary:
      'Lister les notifications du service Render filtrées par service Endoscopie',
    description:
      'Proxy GET /notifications du service notification, puis filtre celles ' +
      'dont payload.sourceServiceId, emitter ou tout champ contient ENDOSCOPIE_SERVICE_ID.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Statut côté service notification (ex. ENVOYE, PENDING, LU)',
    example: 'ENVOYE',
  })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    description: 'UUID service Endoscopie CHU (défaut: ENDOSCOPIE_SERVICE_ID)',
    example: '38f39d38-152e-495b-8c48-28937750d9eb',
  })
  listNotifications(
    @Query('status') status = 'ENVOYE',
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.listNotifications(status, serviceId);
  }

  @Post('api/notifications')
  @ApiTags('Notifications')
  @ApiOperation({ summary: 'Envoyer une notification au service Render' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'motif'],
      properties: {
        type: { type: 'string', example: 'MEDICAL_ALERT' },
        motif: { type: 'string', example: 'Nouvelle prescription endoscopie' },
        urgence: { type: 'number', example: 2 },
        patientId: { type: 'string' },
        entiteRefType: { type: 'string', example: 'Prescription' },
        entiteRefId: { type: 'string' },
        channels: { type: 'array', items: { type: 'string' }, example: ['WEB', 'SOUND'] },
      },
    },
  })
  createNotification(@Body() body: Record<string, unknown>) {
    return this.appService.createNotification(body as never);
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
  @ApiParam({ name: 'id', description: 'UUID du patient' })
  async getPatientById(@Param('id') id: string) {
    return this.appService.getPatientById(id);
  }

  @Post('api/patients')
  @ApiTags('Patients')
  @ApiOperation({ summary: '[POST] Créer un patient', operationId: 'createPatient' })
  @ApiBody({ type: CreatePatientDto })
  async createPatient(@Body() data: CreatePatientDto) {
    return this.appService.createPatient(data);
  }

  // ——— Médecins ———
  @Get('api/medecins')
  @ApiTags('Médecins')
  @ApiOperation({ summary: 'Lister les médecins' })
  async getMedecins() {
    return this.appService.getMedecins();
  }

  @Get('api/medecins/:id')
  @ApiTags('Médecins')
  @ApiOperation({ summary: 'Récupérer un médecin par ID' })
  @ApiParam({ name: 'id', description: 'UUID du médecin' })
  async getMedecinById(@Param('id') id: string) {
    return this.appService.getMedecinById(id);
  }

  @Post('api/medecins')
  @ApiTags('Médecins')
  @ApiOperation({ summary: '[POST] Créer un médecin', operationId: 'createMedecin' })
  @ApiBody({ type: CreateMedecinDto })
  async createMedecin(@Body() data: CreateMedecinDto) {
    return this.appService.createMedecin(data);
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

  @Post('api/prescriptions')
  @ApiTags('Prescriptions')
  @ApiOperation({
    summary: '[POST] Créer une prescription',
    operationId: 'createPrescription',
  })
  @ApiBody({ type: CreatePrescriptionDto })
  @ApiOkResponse({ description: 'Prescription créée' })
  async createPrescription(@Body() data: CreatePrescriptionDto) {
    return this.appService.createPrescription(data);
  }

  @Patch('api/prescriptions/:id')
  @ApiTags('Prescriptions')
  @ApiOperation({
    summary: '[PATCH] Mettre à jour une prescription',
    operationId: 'updatePrescription',
  })
  @ApiBody({ type: UpdatePrescriptionDto })
  @ApiParam({ name: 'id', description: 'UUID de la prescription' })
  async updatePrescription(
    @Param('id') id: string,
    @Body() data: UpdatePrescriptionDto,
  ) {
    return this.appService.updatePrescription(id, data);
  }

  @Get('api/archives')
  @ApiTags('Archives')
  @ApiOperation({ summary: 'Rechercher les dossiers patients archivés (prescription + CPA + checklists + résultat)' })
  @ApiQuery({ name: 'nom', required: false, description: 'Recherche par nom ou prénom du patient' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Date de début (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Date de fin (YYYY-MM-DD)' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getArchives(
    @Query('nom') nom?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.appService.getArchives({ nom, dateFrom, dateTo }, serviceId);
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
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: '[POST] Créer ou mettre à jour un rendez-vous', operationId: 'createRendezVous' })
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
  @ApiTags('Checklists')
  @ApiOperation({ summary: '[POST] Enregistrer la checklist avant endoscopie', operationId: 'saveChecklistAvant' })
  @ApiBody({ type: SaveChecklistAvantDto })
  async saveChecklistAvant(@Body() data: SaveChecklistAvantDto) {
    return this.appService.saveChecklistAvant(data);
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
  @ApiTags('Operations')
  @ApiOperation({ summary: '[POST] Enregistrer les notes de l\'opération endoscopie', operationId: 'saveOperation' })
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
  @ApiTags('Checklists')
  @ApiOperation({ summary: '[POST] Enregistrer la checklist après endoscopie', operationId: 'saveChecklistApres' })
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
  @ApiTags('Resultats')
  @ApiOperation({ summary: '[POST] Enregistrer les résultats de l\'endoscopie', operationId: 'saveResultat' })
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
