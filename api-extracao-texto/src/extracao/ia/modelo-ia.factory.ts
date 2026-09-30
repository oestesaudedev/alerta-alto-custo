import { ConfigService } from '@nestjs/config';
import { iaHabilitada, provedorIa } from '../../config/validar-env';
import { ClaudeAdapter } from './claude.adapter';
import { ModeloIa } from './modelo-ia';

// null com a IA desligada; o provedor já foi validado por validarEnv na subida
export function criarModeloIa(config: ConfigService): ModeloIa | null {
  if (!iaHabilitada(config.get('IA_HABILITADA'))) {
    return null;
  }
  const provedor = provedorIa(config.get('IA_PROVEDOR'));
  switch (provedor) {
    case 'anthropic':
      return new ClaudeAdapter(config);
    default:
      throw new Error(`IA_PROVEDOR não suportado: ${provedor}`);
  }
}
