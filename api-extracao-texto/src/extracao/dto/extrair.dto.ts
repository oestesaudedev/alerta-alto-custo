import { IsNotEmpty, IsString } from 'class-validator';

export class ExtrairDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsNotEmpty()
  conteudoBase64!: string;
}

export class ExtrairSftpDto {
  @IsString()
  @IsNotEmpty()
  arquivo!: string;
}

export type MetodoExtracao = 'pdf-parse' | 'ocr-pdf' | 'ocr-imagem';
export type ExtrairOk = { ok: true; texto: string; metodo: MetodoExtracao };
export type ExtrairErro = { ok: false; erro: string };
export type ExtrairResult = ExtrairOk | ExtrairErro;
