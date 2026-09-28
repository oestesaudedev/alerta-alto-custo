import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExtracaoModule } from './extracao/extracao.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ExtracaoModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
