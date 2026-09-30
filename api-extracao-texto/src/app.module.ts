import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarEnv } from './config/validar-env';
import { ExtracaoModule } from './extracao/extracao.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarEnv }),
    ExtracaoModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
