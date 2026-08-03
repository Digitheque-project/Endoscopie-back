import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(
        typeof body === 'object' && body !== null
          ? body
          : { statusCode: status, message: body },
      );
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      let status = HttpStatus.BAD_REQUEST;
      let message = exception.message;

      switch (exception.code) {
        case 'P2003':
          message =
            'patientId ou medecinId invalide. Utilisez GET /api/patients et GET /api/medecins.';
          break;
        case 'P2021':
        case 'P2022':
          message =
            'Base non à jour : appliquez le SQL de migration serviceId puis lancez npx prisma db push.';
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          break;
        default:
          message = `Erreur Prisma (${exception.code}): ${exception.message}`;
      }

      response.status(status).json({ statusCode: status, message, error: exception.code });
      return;
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      const message = exception.message;
      const hint = message.includes('serviceId')
        ? ' Appliquez la migration SQL serviceId puis relancez npx prisma db push.'
        : '';
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Données invalides Prisma:${hint} ${message}`,
      });
      return;
    }

    console.error('Erreur non gérée:', exception);

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
    });
  }
}
