import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { iaHabilitada } from './config/validar-env';
import { extrairBase64Habilitado } from './extracao/extracao.controller';

// Inclui os erros de itens aninhados (medicamentos[n].campo)
function mensagens(erro: ValidationError, prefixo = ''): string[] {
  const caminho = prefixo ? `${prefixo}.${erro.property}` : erro.property;
  return [
    ...Object.values(erro.constraints ?? {}).map((m) => (prefixo ? `${caminho}: ${m}` : m)),
    ...(erro.children ?? []).flatMap((c) => mensagens(c, caminho)),
  ];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  // Anexos em Base64 passam facilmente do limite padrão de 100kb do Express;
  // sem o /extrair, o maior body é o POST /medicamentos (lista completa, dezenas de milhares de itens).
  const base64 = extrairBase64Habilitado(config);
  app.useBodyParser('json', {
    limit: base64 ? config.get<string>('BODY_LIMIT', '25mb') : config.get<string>('BODY_LIMIT_LISTA', '20mb'),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          ok: false,
          erro: errors.flatMap((e) => mensagens(e)).join('; '),
        }),
    }),
  );
  const port = Number(config.get('PORT', 3010));
  await app.listen(port);
  console.log(
    `api-extracao-texto ouvindo em http://localhost:${port}` +
      (base64 ? ' (POST /extrair e /verificar habilitados: só para testes)' : ''),
  );
  if (!iaHabilitada(config.get('IA_HABILITADA'))) {
    console.warn(
      'IA_HABILITADA não está ligada: o GET /config informa ia=false e o job alerta só pelos procedimentos da guia' +
        ' (o /verificar-sftp responde "IA indisponivel")',
    );
  }
}

bootstrap();
