import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ExtrairErro, MedicamentoDto, MetodoExtracao } from './extrair.dto';

class VerificarBaseDto {
  // Medicamentos de alto custo (BR8/BA8) que a IA procura no texto; `termos` já vêm normalizados pelo job
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MedicamentoDto)
  medicamentos!: MedicamentoDto[];

  // Nomes (beneficiário, solicitante) e matrícula da guia, trocados por marcadores antes do envio ao Claude
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  mascarar?: string[];
}

export type OpcoesVerificacao = Pick<VerificarBaseDto, 'medicamentos' | 'mascarar'> & { retornarTexto?: boolean };

export class VerificarDto extends VerificarBaseDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsNotEmpty()
  conteudoBase64!: string;

  // O texto tem dados de saúde: só no endpoint de teste, para diagnóstico
  @IsOptional()
  @IsBoolean()
  retornarTexto?: boolean;
}

export class VerificarSftpDto extends VerificarBaseDto {
  @IsString()
  @IsNotEmpty()
  arquivo!: string;

  @IsString()
  @IsNotEmpty()
  ambiente!: string;
}

export type OrigemAchado = 'ia';
export type AchadoVerificacao = { codigo: string; termo: string; origem: OrigemAchado; observacao: string };

// O que o job só registra no log: IA com confiança baixa e texto maior que o limite da IA
export type TipoAviso = 'confianca-baixa' | 'texto-cortado';
export type AvisoVerificacao = { tipo: TipoAviso; codigo: string; observacao: string };

export type VerificarOk = {
  ok: true;
  metodo: MetodoExtracao;
  modelo: string;
  achados: AchadoVerificacao[];
  avisos: AvisoVerificacao[];
  texto?: string;
};
export type VerificarResult = VerificarOk | ExtrairErro;
