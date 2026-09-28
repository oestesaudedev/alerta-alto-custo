import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Anexos em Base64 passam facilmente do limite padrão de 100kb do Express.
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '25mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          ok: false,
          erro: errors
            .flatMap((e) => Object.values(e.constraints ?? {}))
            .join('; '),
        }),
    }),
  );
  const port = Number(process.env.PORT ?? 3010);
  await app.listen(port);
  console.log(`api-extracao-texto ouvindo em http://localhost:${port}`);
}

bootstrap();
