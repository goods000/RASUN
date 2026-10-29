import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() { const app = await NestFactory.create(AppModule); app.setGlobalPrefix('api'); app.enableCors({ origin: ['http://localhost:5174','http://localhost:5173'] }); await app.listen(Number(process.env.PORT || 3000)); }
bootstrap();
