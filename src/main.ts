import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule, ObserveInstrument } from './app.module.js';
import { OFFERS_UPLOAD_DIR, OFFERS_URL_PREFIX } from './uploads/uploads.controller.js';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  app.use(helmet());
  // CORS : liste blanche via CORS_ORIGIN (séparée par des virgules). Sans valeur,
  // aucune origine tierce n'est acceptée en production (reflet libre en dev).
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : process.env.NODE_ENV !== 'production',
    credentials: true,
  });
  // Fichiers statiques hors global prefix : /uploads/offers/<uuid>.jpg
  app.useStaticAssets(OFFERS_UPLOAD_DIR, { prefix: OFFERS_URL_PREFIX });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tsinjo API')
      .setDescription('Anti-gaspillage alimentaire — API REST')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
