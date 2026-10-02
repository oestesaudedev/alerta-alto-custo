import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MedicamentoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  codigo!: string;

  @IsString()
  @MaxLength(1000)
  descricao!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  termos?: string[];
}

export class ExtrairDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsNotEmpty()
  conteudoBase64!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MedicamentoDto)
  medicamentos?: MedicamentoDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  mascarar?: string[];
}

export class ExtrairSftpDto {
  @IsString()
  @IsNotEmpty()
  arquivo!: string;

  // GetEnvServer() do Protheus: SFTP_AMBIENTE_PROD usa o SFTP de produção, qualquer outro o de dev.
  // Obrigatório: sem ele o job cairia no SFTP de dev e descartaria os anexos como "não encontrado".
  @IsString()
  @IsNotEmpty()
  ambiente!: string;

  // Medicamentos de alto custo (BR8/BA8) para o Claude (fonte anterior do job). Sem a lista, a IA não roda.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MedicamentoDto)
  medicamentos?: MedicamentoDto[];

  // Nomes (beneficiário, solicitante) e matrícula da guia, trocados por marcadores antes do envio ao Claude
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  mascarar?: string[];
}

export type ConfiancaIa = 'alta' | 'media' | 'baixa';
// Só "solicitado" chega aos achados: o IaService descarta os demais
export type ContextoIa = 'solicitado' | 'informativo' | 'historico' | 'outro';
export type AchadoIa = { codigo: string; termo: string; contexto: ContextoIa; confianca: ConfiancaIa; motivo: string };
// `cortado`: o texto passou de IA_MAX_CHARS e a IA só leu o início
export type ResultadoIaOk = { ok: true; modelo: string; achados: AchadoIa[]; cortado?: boolean };
export type ResultadoIa = ResultadoIaOk | { ok: false; erro: string };

export type MetodoExtracao = 'pdf-parse' | 'ocr-pdf' | 'ocr-imagem';
export type ExtrairOk = { ok: true; texto: string; metodo: MetodoExtracao; ia?: ResultadoIa };
export type ExtrairErro = { ok: false; erro: string };
export type ExtrairResult = ExtrairOk | ExtrairErro;
