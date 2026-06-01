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
  @ApiTags('Dossiers CPA')
  @ApiOperation({ summary: '[POST] Créer un dossier CPA', operationId: 'createDossierCpa' })
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
  @Get('api/rendezvous')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Lister les rendez-vous' })
  @ApiQuery({ name: 'serviceId', required: false })
  async getRendezVous(@Query('serviceId') serviceId?: string) {
    return this.appService.getRendezVous(serviceId);
  }

  @Post('api/rendezvous')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: '[POST] Créer ou mettre à jour un rendez-vous', operationId: 'createRendezVous' })
  @ApiBody({ type: CreateRendezVousDto })
  @ApiOkResponse({ description: 'Rendez-vous créé ou mis à jour' })
  async createRendezVous(@Body() data: CreateRendezVousDto) {
    return this.appService.createRendezVous(data);
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
}
