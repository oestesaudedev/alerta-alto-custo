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

// Limite da lista do POST /medicamentos (enviada uma vez por execução); a IA só recebe os candidatos da pré-busca
export const MEDICAMENTOS_MAX = 100000;

export class RegistrarListaDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MEDICAMENTOS_MAX)
  @ValidateNested({ each: true })
  @Type(() => MedicamentoDto)
  medicamentos!: MedicamentoDto[];
}

class VerificarBaseDto {
  // Lista registrada antes pelo POST /medicamentos (o job usa este)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  listaId?: string;

  // Ou a lista no próprio pedido (testes e job antigo); `termos` já vêm normalizados pelo job
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
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

export type OpcoesVerificacao = Pick<VerificarBaseDto, 'listaId' | 'medicamentos' | 'mascarar'> & {
  retornarTexto?: boolean;
};

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

// O que o job só registra no log: IA com confiança baixa, texto maior que o limite da IA e
// pré-busca com mais candidatos que PRE_BUSCA_MAX_CANDIDATOS
export type TipoAviso = 'confianca-baixa' | 'texto-cortado' | 'pre-busca-limite';
export type AvisoVerificacao = { tipo: TipoAviso; codigo: string; observacao: string };

export type VerificarOk = {
  ok: true;
  metodo: MetodoExtracao;
  modelo: string;
  // Medicamentos da lista achados no texto pela pré-busca e enviados à IA
  candidatos: number;
  achados: AchadoVerificacao[];
  avisos: AvisoVerificacao[];
  texto?: string;
};
export type VerificarResult = VerificarOk | ExtrairErro;
