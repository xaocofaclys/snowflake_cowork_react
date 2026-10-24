import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '10mb' });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(
    `API on http://localhost:${env.PORT} (auth=${env.AUTH_MODE}, store=${env.APP_STORE}, cortex=${env.CORTEX_MOCK ? 'mock' : 'live'}, redis=${env.REDIS_URL ? 'on' : 'off'})`,
    'Bootstrap',
  );
}
bootstrap();
