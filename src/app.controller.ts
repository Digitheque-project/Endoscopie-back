import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';
import { CreateRendezVousDto } from './dto/create-rendezvous.dto';
import { CreateSalleDto } from './dto/create-salle.dto';
import { SaveChecklistAvantDto } from './dto/save-checklist-avant.dto';

@ApiTags('Santé')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Vérifier que l’API répond' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/test-db')
  @ApiTags('Diagnostic')
  @ApiOperation({ summary: 'Tester la connexion Prisma / base de données' })
  async testDb() {
    return this.appService.testDb();
  }

  @Get('api/prescriptions')
  @ApiTags('Prescriptions')
  @ApiOperation({ summary: 'Lister toutes les prescriptions' })
  async getPrescriptions() {
    return this.appService.getPrescriptions();
  }

  @Get('api/prescriptions/:id')
  @ApiTags('Prescriptions')
  @ApiOperation({ summary: 'Récupérer une prescription par ID' })
  @ApiParam({ name: 'id', description: 'UUID de la prescription' })
  async getPrescriptionById(@Param('id') id: string) {
    return this.appService.getPrescriptionById(id);
  }

  @Get('api/medecins')
  @ApiTags('Médecins')
  @ApiOperation({ summary: 'Lister les médecins' })
  async getMedecins() {
    return this.appService.getMedecins();
  }

  @Get('api/rendezvous')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Lister les rendez-vous' })
  async getRendezVous() {
    return this.appService.getRendezVous();
  }

  @Get('api/salles')
  @ApiTags('Salles')
  @ApiOperation({ summary: 'Lister les salles' })
  async getSalles() {
    return this.appService.getSalles();
  }

  @Post('api/rendezvous')
  @ApiTags('Rendez-vous')
  @ApiOperation({ summary: 'Créer ou mettre à jour un rendez-vous' })
  @ApiOkResponse({ description: 'Rendez-vous créé ou mis à jour' })
  async createRendezVous(@Body() data: CreateRendezVousDto) {
    return this.appService.createRendezVous(data);
  }

  @Post('api/salles')
  @ApiTags('Salles')
  @ApiOperation({ summary: 'Créer une salle' })
  async createSalle(@Body() data: CreateSalleDto) {
    return this.appService.createSalle(data);
  }

  @Get('api/checklists/avant/:prescriptionId')
  @ApiTags('Checklists')
  @ApiOperation({ summary: 'Récupérer la checklist avant endoscopie' })
  @ApiParam({ name: 'prescriptionId', description: 'UUID de la prescription' })
  async getChecklistAvant(@Param('prescriptionId') prescriptionId: string) {
    return this.appService.getChecklistAvant(prescriptionId);
  }

  @Post('api/checklists/avant')
  @ApiTags('Checklists')
  @ApiOperation({ summary: 'Enregistrer la checklist avant endoscopie' })
  async saveChecklistAvant(@Body() data: SaveChecklistAvantDto) {
    return this.appService.saveChecklistAvant(data);
  }
}
