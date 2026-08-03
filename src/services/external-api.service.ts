import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { CreateServiceExterneDto, UpdateServiceExterneDto } from '../dto/resultat-examen-externe.dto';

@Injectable()
export class ExternalApiService {
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
