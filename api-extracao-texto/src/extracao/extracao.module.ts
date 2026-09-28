import { Module } from '@nestjs/common';
import { ExtracaoController } from './extracao.controller';
import { ExtracaoService } from './extracao.service';
import { SftpService } from './sftp.service';
import { ApiTokenGuard } from '../auth/api-token.guard';

@Module({
  controllers: [ExtracaoController],
  providers: [ExtracaoService, SftpService, ApiTokenGuard],
})
export class ExtracaoModule {}
