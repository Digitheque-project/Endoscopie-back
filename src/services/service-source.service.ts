import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  CreateServiceSourceDto,
  UpdateServiceSourceDto,
  ServiceSourceResponseDto,
  WebhookNotificationDto,
} from '../dto/service-source.dto';

@Injectable()
export class ServiceSourceService {
  private readonly logger = new Logger(ServiceSourceService.name);

  constructor(private prisma: PrismaService) {}

  async createService(
    dto: CreateServiceSourceDto,
  ): Promise<ServiceSourceResponseDto> {
    const service = await this.prisma.serviceSource.create({
      data: {
        nom: dto.nom,
        urlWebhook: dto.urlWebhook,
        contact: dto.contact,
        hopital: dto.hopital,
      },
    });
    return this.mapToDto(service);
  }

  async listServices(): Promise<ServiceSourceResponseDto[]> {
    const services = await this.prisma.serviceSource.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return services.map((s) => this.mapToDto(s));
  }

  async getServiceById(id: string): Promise<ServiceSourceResponseDto> {
    const service = await this.prisma.serviceSource.findUnique({
      where: { id },
    });
    if (!service) throw new Error('Service not found');
    return this.mapToDto(service);
  }

  async updateService(
    id: string,
    dto: UpdateServiceSourceDto,
  ): Promise<ServiceSourceResponseDto> {
    const service = await this.prisma.serviceSource.update({
      where: { id },
      data: {
        nom: dto.nom,
        urlWebhook: dto.urlWebhook,
        actif: dto.actif,
        contact: dto.contact,
        hopital: dto.hopital,
      },
    });
    return this.mapToDto(service);
  }

  async deleteService(id: string): Promise<void> {
    await this.prisma.serviceSource.delete({
      where: { id },
    });
  }

  async notifyServiceOfExam(
    prescriptionId: string,
    patientNom: string,
    patientPrenoms: string,
    serviceDemandeur: string,
    prescripteur: string,
    patientId: string,
  ): Promise<void> {
    const services = await this.prisma.serviceSource.findMany({
      where: { actif: true },
    });

    const apiUrl =
      process.env.API_URL || 'https://endoscopie-api.onrender.com';
    const lienResultat = `${apiUrl}/api/examens/resultats/${prescriptionId}`;

    const notification: WebhookNotificationDto = {
      event: 'EXAMEN_TERMINE',
      timestamp: new Date().toISOString(),
      prescription: {
        id: prescriptionId,
        serviceDemandeur,
        prescripteur,
      },
      patient: {
        nom: patientNom,
        prenoms: patientPrenoms,
      },
      message: 'Le résultat de l\'examen endoscopique est disponible.',
      lienResultat,
    };

    for (const service of services) {
      await this.sendWebhook(service.id, notification, prescriptionId, patientId);
    }
  }

  private async sendWebhook(
    serviceId: string,
    payload: WebhookNotificationDto,
    prescriptionId: string,
    patientId: string,
  ): Promise<void> {
    const service = await this.prisma.serviceSource.findUnique({
      where: { id: serviceId },
    });

    if (!service) return;

    try {
      const response = await fetch(service.urlWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Endoscopie-API/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000), // 10 secondes timeout
      });

      const httpStatus = response.status;

      await this.prisma.logWebhook.create({
        data: {
          serviceSourceId: serviceId,
          prescriptionId,
          patientId,
          eventType: 'EXAMEN_TERMINE',
          httpStatus,
        },
      });

      await this.prisma.serviceSource.update({
        where: { id: serviceId },
        data: { lastNotifiedAt: new Date() },
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook failed for service ${service.nom}: ${httpStatus}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send webhook to ${service.urlWebhook}:`,
        error,
      );

      // Enregistrer l'erreur
      await this.prisma.logWebhook.create({
        data: {
          serviceSourceId: serviceId,
          prescriptionId,
          patientId,
          eventType: 'EXAMEN_TERMINE',
          httpStatus: 0,
        },
      });
    }
  }

  async getWebhookLogs(
    serviceSourceId?: string,
    limit: number = 50,
  ): Promise<any[]> {
    return this.prisma.logWebhook.findMany({
      where: serviceSourceId ? { serviceSourceId } : {},
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        serviceSource: {
          select: { nom: true },
        },
      },
    });
  }

  private mapToDto(service: any): ServiceSourceResponseDto {
    return {
      id: service.id,
      nom: service.nom,
      urlWebhook: service.urlWebhook,
      actif: service.actif,
      contact: service.contact,
      hopital: service.hopital,
      createdAt: service.createdAt,
      lastNotifiedAt: service.lastNotifiedAt,
    };
  }
}
