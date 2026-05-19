import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/test-db')
  async testDb() {
    return this.appService.testDb();
  }

  @Get('api/prescriptions')
  async getPrescriptions() {
    return this.appService.getPrescriptions();
  }

  @Get('api/medecins')
  async getMedecins() {
    return this.appService.getMedecins();
  }

  @Get('api/rendezvous')
  async getRendezVous() {
    return this.appService.getRendezVous();
  }

  @Get('api/salles')
  async getSalles() {
    return this.appService.getSalles();
  }

  @Post('api/rendezvous')
  async createRendezVous(@Body() data: any) {
    return this.appService.createRendezVous(data);
  }

  @Post('api/salles')
  async createSalle(@Body() data: any) {
    return this.appService.createSalle(data);
  }

  @Get('api/checklists/avant/:prescriptionId')
  async getChecklistAvant(@Param('prescriptionId') prescriptionId: string) {
    return this.appService.getChecklistAvant(prescriptionId);
  }

  @Post('api/checklists/avant')
  async saveChecklistAvant(@Body() data: any) {
    return this.appService.saveChecklistAvant(data);
  }
}
