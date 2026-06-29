import 'dotenv/config';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './prisma/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalExceptionFilter());
  const frontendOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  app.enableCors({
    origin: frontendOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-webhook-secret',
      'Cache-Control',
    ],
    exposedHeaders: ['Content-Type'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Endoscopie')
    .setDescription('Documentation des endpoints du backend NestJS')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('endoscopie/api/docs', app, document, {
    customSiteTitle: 'API Endoscopie',
    swaggerOptions: {
      docExpansion: 'list',
      filter: true,
      displayOperationId: true,
      persistAuthorization: true,
    },
    customJs: join(__dirname, 'swagger', 'force-en-methods.js'),
  });

  const port = parseInt(process.env.PORT ?? '3333', 10) || 3333;
  await app.listen(port);
  const publicUrl =
    process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '') ??
    `http://localhost:${port}`;
  console.log(`Application is running on: ${publicUrl}`);
  console.log(`Swagger UI: ${publicUrl}/endoscopie/api/docs`);
}
bootstrap();
