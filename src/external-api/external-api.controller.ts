import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  Query,
  HttpCode,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiHeader,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalApiService } from '../services/external-api.service';
import { MedecinsService } from '../services/medecins.service';
import {
  ResultatExamenExterneDto,
  CreateServiceExterneDto,
  ServiceExterneResponseDto,
  UpdateServiceExterneDto,
} from '../dto/resultat-examen-externe.dto';
import { Roles } from '../auth/roles.decorator';

@Controller()
export class ExternalApiController {
  constructor(
    private prisma: PrismaService,
    private externalApiService: ExternalApiService,
    private medecinsService: MedecinsService,
  ) {}

  /**
   * ========== ENDPOINT PUBLIC ==========
   * Accès par services externes avec clé API
   */
  @Get('api/examens/resultats/:prescriptionId')
  @ApiTags('Accès externe — Services cliniques')
  @ApiOperation({
    summary: 'Obtenir le résultat d\'examen — accès service externe',
    description: 'Endpoint sécurisé pour accéder aux résultats d\'examens d\'endoscopie avec une clé API valide',
  })
  @ApiParam({ name: 'prescriptionId', description: 'N° de la prescription' })
  @ApiHeader({
    name: 'x-api-key',
    description: 'Clé API du service externe',
    required: true,
  })
  @ApiResponse({ status: 200, type: ResultatExamenExterneDto })
  @ApiResponse({ status: 401, description: 'Clé API invalide ou absente' })
  @ApiResponse({ status: 403, description: 'Résultat non disponible' })
  @ApiResponse({ status: 404, description: 'Prescription introuvable' })
  async getResultatExterne(
    @Param('prescriptionId') prescriptionId: string,
    @Headers('x-api-key') apiKey?: string,
  ): Promise<ResultatExamenExterneDto> {
    if (!apiKey) {
      throw new BadRequestException('Clé API manquante dans le header x-api-key');
    }

    // Valider la clé API
    const service = await this.externalApiService.validateApiKey(apiKey);

    // Récupérer la prescription
    const prescription = await this.prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        resultatEndoscopie: true,
      },
    });

    if (!prescription) {
      await this.externalApiService.logAccess(service.id, prescriptionId, 'UNKNOWN', 404);
      throw new NotFoundException(`Prescription ${prescriptionId} introuvable`);
    }

    // Le prescripteur appartient au service source de la demande, pas à Endoscopie —
    // recherche cross-service (voir getUserById), pas le répertoire Endoscopie seul
    // (qui ne le trouverait quasiment jamais et renverrait "N/A").
    const medecinPrescripteur = prescription.medecinId
      ? await this.medecinsService.getUserById(prescription.medecinId)
      : null;

    // Vérifier que le résultat est disponible
    if (!prescription.resultatEndoscopie) {
      await this.externalApiService.logAccess(service.id, prescriptionId, prescription.patientId, 403);
      throw new ForbiddenException('Résultat d\'examen non encore disponible');
    }

    // Récupérer les données patient depuis Accueil
    const patientData = await this.getPatientInfo(prescription.patientId);

    // Logger l'accès
    await this.externalApiService.logAccess(service.id, prescriptionId, prescription.patientId, 200);

    // Formater la réponse
    return {
      prescriptionId,
      patient: {
        nom: patientData.nom || 'N/A',
        prenoms: patientData.prenom || 'N/A',
        dateNaissance: patientData.dateNaissance || 'N/A',
      },
      typeExamen: prescription.typeExamen,
      dateExamen: prescription.dateDemande.toISOString().split('T')[0],
      statut: 'TERMINE',
      resultats: this.parseResultats(prescription.resultatEndoscopie.details || '{}'),
      conclusion: prescription.resultatEndoscopie.conclusion || undefined,
      recommandation: prescription.resultatEndoscopie.followUp || undefined,
      medecin: medecinPrescripteur
        ? `${medecinPrescripteur.nom} ${medecinPrescripteur.prenom}`
        : 'N/A',
      dateResultat: prescription.resultatEndoscopie.dateCreation.toISOString(),
    };
  }

  private parseResultats(detailsJson: string): any {
    try {
      return JSON.parse(detailsJson);
    } catch {
      return {};
    }
  }

  private async getPatientInfo(patientId: string) {
    try {
      const accueilUrl = process.env.ACCUEIL_API_URL || 'http://localhost:3001';
      const res = await fetch(`${accueilUrl}/patients/${patientId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return (await res.json()) as { nom: string; prenom: string; dateNaissance: string };
      }
    } catch {
      // Silencieusement ignorer les erreurs d'accès patient
    }
    return { nom: '', prenom: '', dateNaissance: '' };
  }

  /**
   * ========== ENDPOINTS DE GESTION (Admin uniquement) ==========
   */

  @Post('api/services-externes')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({
    summary: 'Créer un nouveau service externe',
    description: 'Générer une nouvelle clé API pour un service clinique externe',
  })
  @ApiBody({ type: CreateServiceExterneDto })
  @ApiResponse({ status: 201, type: ServiceExterneResponseDto })
  @HttpCode(201)
  async createService(@Body() data: CreateServiceExterneDto) {
    return this.externalApiService.createService(data);
  }

  @Get('api/services-externes')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({ summary: 'Lister tous les services externes enregistrés' })
  async listServices() {
    return this.externalApiService.listServices();
  }

  @Get('api/services-externes/:id')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({ summary: 'Récupérer les détails d\'un service externe' })
  @ApiParam({ name: 'id', description: 'ID du service' })
  async getService(@Param('id') id: string) {
    const service = await this.externalApiService.getServiceById(id);
    return {
      ...service,
      apiKey: undefined, // Ne pas retourner la clé
    };
  }

  @Patch('api/services-externes/:id')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({ summary: 'Mettre à jour un service externe (activation, infos)' })
  @ApiParam({ name: 'id', description: 'ID du service' })
  @ApiBody({ type: UpdateServiceExterneDto })
  async updateService(
    @Param('id') id: string,
    @Body() data: UpdateServiceExterneDto,
  ) {
    const updated = await this.externalApiService.updateService(id, data);
    return {
      ...updated,
      apiKey: undefined,
    };
  }

  @Delete('api/services-externes/:id')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({ summary: 'Supprimer un service externe' })
  @ApiParam({ name: 'id', description: 'ID du service' })
  @HttpCode(204)
  async deleteService(@Param('id') id: string) {
    await this.externalApiService.deleteService(id);
  }

  @Get('api/logs-acces-externes')
  @Roles('MAJOR')
  @ApiTags('Administration — Services externes')
  @ApiOperation({ summary: 'Voir les logs d\'accès des services externes' })
  @ApiQuery({ name: 'serviceId', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 100 })
  async getAccessLogs(
    @Query('serviceId') serviceId?: string,
    @Query('limit') limit: string = '100',
  ) {
    return this.externalApiService.getAccessLogs(serviceId, parseInt(limit, 10));
  }
}
