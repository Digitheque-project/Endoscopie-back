import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateServiceSourceDto,
  UpdateServiceSourceDto,
  ServiceSourceResponseDto,
  WebhookNotificationDto,
} from '../dto/service-source.dto';

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ||
  'https://service-notification-nlqp.onrender.com';

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
      // Utiliser le service de notification pour envoyer le webhook
      const response = await fetch(
        `${NOTIFICATION_SERVICE_URL}/api/notifications/webhook`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: service.urlWebhook,
            payload: payload,
            metadata: {
              serviceSourceId: serviceId,
              serviceName: service.nom,
              prescriptionId,
              patientId,
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );

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
          `Webhook notification failed for service ${service.nom}: ${httpStatus}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send webhook notification for ${service.nom}:`,
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
