import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExtracaoModule } from './extracao/extracao.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ExtracaoModule,
  ],
})
export class AppModule {}
