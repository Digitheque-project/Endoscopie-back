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
  RendezVousExterneDto,
  CreateServiceExterneDto,
  ServiceExterneResponseDto,
  UpdateServiceExterneDto,
} from '../dto/resultat-examen-externe.dto';
import { Roles } from '../auth/roles.decorator';
import {
  getEndoscopieServiceId,
  getAccueilApiUrl,
  getEndoscopieChuId,
  getEndoscopieAuthChuId,
} from '../config/endoscopie-service';

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
      // Résultats détaillés au-delà de la seule conclusion finale — le service externe
      // ne doit pas se limiter au compte rendu synthétique, il doit pouvoir consulter
      // le détail complet rédigé par le médecin Endoscopie.
      reportText: prescription.resultatEndoscopie.reportText || undefined,
      mainDiagnosis: prescription.resultatEndoscopie.mainDiagnosis || undefined,
      observations: prescription.resultatEndoscopie.observations || undefined,
      complication: prescription.resultatEndoscopie.complication || undefined,
      biopsy: prescription.resultatEndoscopie.biopsy || undefined,
      doctorName: prescription.resultatEndoscopie.doctorName || undefined,
      medecin: medecinPrescripteur
        ? `${medecinPrescripteur.nom} ${medecinPrescripteur.prenom}`
        : 'N/A',
      dateResultat: prescription.resultatEndoscopie.dateCreation.toISOString(),
    };
  }

  /**
   * ========== ENDPOINT PUBLIC ==========
   * Accès par services externes avec clé API — rendez-vous d'Endoscopie, pour que
   * d'autres services du CHU (Accueil, Hospitalisation...) puissent suivre la
   * disponibilité du service ou tracer le passage d'un patient, sans exposer le détail
   * médical (voir getResultatExterne pour le compte-rendu, séparé et non concerné ici).
   */
  @Get('api/rendezvous/externe')
  @ApiTags('Accès externe — Services cliniques')
  @ApiOperation({
    summary: 'Lister les rendez-vous d\'endoscopie — accès service externe',
    description:
      'Endpoint sécurisé pour que d\'autres services du CHU (Accueil, Hospitalisation...) ' +
      'suivent la disponibilité d\'Endoscopie ou tracent le passage d\'un patient, avec une clé API valide.',
  })
  @ApiHeader({ name: 'x-api-key', description: 'Clé API du service externe', required: true })
  @ApiQuery({ name: 'patientId', required: false, description: 'Filtre sur un patient précis (traçage)' })
  @ApiQuery({ name: 'from', required: false, description: 'Date/heure de début minimale (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Date/heure de début maximale (ISO 8601)' })
  @ApiResponse({ status: 200, type: [RendezVousExterneDto] })
  @ApiResponse({ status: 401, description: 'Clé API invalide ou absente' })
  async getRendezVousExterne(
    @Headers('x-api-key') apiKey?: string,
    @Query('patientId') patientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<RendezVousExterneDto[]> {
    if (!apiKey) {
      throw new BadRequestException('Clé API manquante dans le header x-api-key');
    }
    const service = await this.externalApiService.validateApiKey(apiKey);

    const where: Record<string, unknown> = { serviceId: getEndoscopieServiceId() };
    if (patientId) where.patientId = patientId;
    const dateHeureDebut: Record<string, Date> = {};
    if (from) dateHeureDebut.gte = new Date(from);
    if (to) dateHeureDebut.lte = new Date(to);
    if (Object.keys(dateHeureDebut).length) where.dateHeureDebut = dateHeureDebut;

    // Repli sur les 90 prochains jours quand aucun filtre n'est fourni — pas de dump
    // intégral de l'historique par défaut.
    if (!patientId && !from && !to) {
      where.dateHeureDebut = { gte: new Date() };
    }

    const rendezVous = await this.prisma.rendezVous.findMany({
      where,
      include: { salle: true, prescription: true },
      orderBy: { dateHeureDebut: 'asc' },
      take: 200,
    });

    await this.externalApiService.logAccess(service.id, 'LIST', patientId || 'ALL', 200);

    return rendezVous.map((rdv) => ({
      id: rdv.id,
      patientId: rdv.patientId,
      dateHeureDebut: rdv.dateHeureDebut.toISOString(),
      dateHeureFin: rdv.dateHeureFin ? rdv.dateHeureFin.toISOString() : null,
      salle: rdv.salle?.nom ?? null,
      statut: rdv.statut,
      typeExamen: rdv.prescription?.typeExamen ?? null,
    }));
  }

  private parseResultats(detailsJson: string): any {
    try {
      return JSON.parse(detailsJson);
    } catch {
      return {};
    }
  }

  /**
   * Chemin correct : /accueil/patients/:id?chuId=... (voir AppService.fetchAccueilPatientFor,
   * même API) — l'ancien chemin /patients/:id n'existe pas côté Accueil et renvoyait
   * systématiquement 404, laissant le patient toujours à "N/A" ci-dessus.
   */
  private async fetchAccueilPatientFor(patientId: string, chuId: string) {
    try {
      const url = `${getAccueilApiUrl()}/accueil/patients/${encodeURIComponent(patientId)}?chuId=${chuId}`;
      // Passé par le gateway CHU : jeton Bearer obligatoire.
      const token = await this.medecinsService.getServiceAccountToken();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text) as { nom: string; prenom: string; dateNaissance?: string };
    } catch {
      return null;
    }
  }

  private async getPatientInfo(patientId: string) {
    const primaryChuId = getEndoscopieChuId();
    let found = await this.fetchAccueilPatientFor(patientId, primaryChuId);
    if (!found) {
      const authChuId = getEndoscopieAuthChuId();
      if (authChuId && authChuId !== primaryChuId) {
        found = await this.fetchAccueilPatientFor(patientId, authChuId);
      }
    }
    return found ?? { nom: '', prenom: '', dateNaissance: '' };
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
