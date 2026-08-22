import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { CreateServiceExterneDto, UpdateServiceExterneDto } from '../dto/resultat-examen-externe.dto';

/** Nom de l'entrée ServiceExterne partagée sous laquelle sont journalisés les accès
 * authentifiés par jeton Bearer de l'écosystème CHU (voir validateEcosystemToken) —
 * distincte des services enregistrés individuellement avec leur propre clé API. */
const ECOSYSTEM_JWT_SERVICE_NAME = 'Écosystème CHU (JWT partagé)';

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  constructor(private prisma: PrismaService) {}

  async generateApiKey(): Promise<string> {
    return randomUUID();
  }

  async createService(data: CreateServiceExterneDto) {
    const apiKey = await this.generateApiKey();

    return this.prisma.serviceExterne.create({
      data: {
        nom: data.nom,
        apiKey,
        hopital: data.hopital,
        contact: data.contact,
        actif: true,
      },
    });
  }

  async listServices() {
    return this.prisma.serviceExterne.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nom: true,
        actif: true,
        createdAt: true,
        lastUsedAt: true,
        hopital: true,
        contact: true,
      },
    });
  }

  async getServiceById(id: string) {
    const service = await this.prisma.serviceExterne.findUnique({
      where: { id },
    });

    if (!service) {
      throw new NotFoundException(`Service externe ${id} non trouvé`);
    }

    return service;
  }

  async updateService(id: string, data: UpdateServiceExterneDto) {
    await this.getServiceById(id);

    return this.prisma.serviceExterne.update({
      where: { id },
      data: {
        ...(data.nom && { nom: data.nom }),
        ...(data.actif !== undefined && { actif: data.actif }),
        ...(data.hopital && { hopital: data.hopital }),
        ...(data.contact && { contact: data.contact }),
      },
    });
  }

  async deleteService(id: string) {
    await this.getServiceById(id);
    return this.prisma.serviceExterne.delete({ where: { id } });
  }

  async validateApiKey(apiKey: string) {
    const service = await this.prisma.serviceExterne.findUnique({
      where: { apiKey },
    });

    if (!service) {
      throw new UnauthorizedException('Clé API invalide');
    }

    if (!service.actif) {
      throw new UnauthorizedException('Service externe désactivé');
    }

    return service;
  }

  /**
   * Alternative au x-api-key : accepte tout jeton Bearer valide de l'écosystème
   * d'authentification CHU partagé (utilisateur réel ou compte de service — même
   * jeton que celui obtenu via {gateway}/auth/login, voir MedecinsService.
   * getServiceAccountToken). Évite à chaque nouveau service consommateur de devoir
   * se faire enregistrer manuellement ici avec une clé dédiée. Retourne `null`
   * (jamais d'exception) si JWT_SECRET n'est pas configuré ou si le jeton est
   * invalide/expiré — l'appelant retombe alors sur le comportement x-api-key existant.
   */
  async validateEcosystemToken(token: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;

    try {
      jwt.verify(token, secret);
    } catch (e) {
      this.logger.warn(`Jeton Bearer écosystème CHU invalide/expiré : ${e instanceof Error ? e.message : e}`);
      return null;
    }

    // Pas de ServiceExterne dédié pour cette voie — journalise les accès sous une
    // entrée partagée plutôt que d'exiger un enregistrement par service appelant.
    return this.prisma.serviceExterne.upsert({
      where: { nom: ECOSYSTEM_JWT_SERVICE_NAME },
      update: {},
      create: {
        nom: ECOSYSTEM_JWT_SERVICE_NAME,
        apiKey: randomUUID(),
        actif: true,
      },
    });
  }

  async logAccess(serviceExterneId: string, prescriptionId: string, patientId: string, statut: number) {
    await this.prisma.logAccesExterne.create({
      data: {
        serviceExterneId,
        prescriptionId,
        patientId,
        statut,
      },
    });

    // Mettre à jour lastUsedAt
    await this.prisma.serviceExterne.update({
      where: { id: serviceExterneId },
      data: { lastUsedAt: new Date() },
    });
  }

  async getAccessLogs(serviceId?: string, limit: number = 100) {
    return this.prisma.logAccesExterne.findMany({
      where: serviceId ? { serviceExterneId: serviceId } : undefined,
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        serviceExterne: {
          select: {
            nom: true,
            hopital: true,
          },
        },
      },
    });
  }
}
