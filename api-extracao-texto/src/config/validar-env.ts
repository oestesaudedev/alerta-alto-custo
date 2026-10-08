const TOKEN_MIN_CHARS = 32;
const TOKENS_PROIBIDOS = new Set(['dev-change-me']);
const HOSTKEY_RE = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

// Impressões digitais aceitas para o SFTP do perfil, no formato do `ssh-keygen -lf`
export function hostKeys(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((k) => k.trim().replace(/=+$/, ''))
    .filter(Boolean);
}

export function iaHabilitada(valor: unknown): boolean {
  return String(valor ?? 'false').trim().toLowerCase() === 'true';
}

export const PROVEDORES_IA = ['anthropic'];

export function provedorIa(valor: unknown): string {
  return String(valor ?? '').trim().toLowerCase() || 'anthropic';
}

// Critério do job para a lista de medicamentos: altcus = BR8_ALTCUS = '1'; valor = valor de tabela BD4 > MEDICAMENTO_VALOR_MIN
export const CRITERIOS_MEDICAMENTO = ['altcus', 'valor'] as const;
export type CriterioMedicamento = (typeof CRITERIOS_MEDICAMENTO)[number];

export function criterioMedicamento(valor: unknown): string {
  return String(valor ?? '').trim().toLowerCase() || 'altcus';
}

// Chamado pelo ConfigModule na subida: a API não sobe com configuração insegura.
export function validarEnv(config: Record<string, unknown>): Record<string, unknown> {
  const erros: string[] = [];
  const texto = (nome: string) => String(config[nome] ?? '').trim();

  const token = texto('API_TOKEN');
  if (!token) {
    erros.push('API_TOKEN não definido');
  } else if (TOKENS_PROIBIDOS.has(token) || token.length < TOKEN_MIN_CHARS) {
    erros.push(`API_TOKEN fraco: use um valor aleatório com pelo menos ${TOKEN_MIN_CHARS} caracteres`);
  }

  for (const perfil of ['PROD', 'DEV']) {
    if (!texto(`SFTP_${perfil}_HOST`)) continue;
    const chaves = hostKeys(texto(`SFTP_${perfil}_HOSTKEY`));
    if (!chaves.length) {
      erros.push(`SFTP_${perfil}_HOSTKEY não definido (impressão digital SHA256 do servidor SFTP)`);
    } else if (chaves.some((k) => !HOSTKEY_RE.test(k))) {
      erros.push(`SFTP_${perfil}_HOSTKEY inválido: esperado "SHA256:..." (saída do ssh-keygen -lf), separados por vírgula`);
    }
  }

  if (iaHabilitada(config.IA_HABILITADA)) {
    const provedor = provedorIa(config.IA_PROVEDOR);
    if (!PROVEDORES_IA.includes(provedor)) {
      erros.push(`IA_PROVEDOR inválido: ${provedor} (suportados: ${PROVEDORES_IA.join(', ')})`);
    } else if (provedor === 'anthropic' && !texto('ANTHROPIC_API_KEY')) {
      erros.push('ANTHROPIC_API_KEY não definido (obrigatório com IA_HABILITADA=true)');
    }
    for (const nome of ['IA_TIMEOUT_MS', 'IA_MAX_CHARS']) {
      const valor = texto(nome);
      if (valor && !(Number(valor) > 0)) {
        erros.push(`${nome} inválido: esperado número maior que zero`);
      }
    }
  }

  for (const nome of ['PRE_BUSCA_MAX_CANDIDATOS', 'PRE_BUSCA_DF_MAX']) {
    const valor = texto(nome);
    if (valor && !(Number.isInteger(Number(valor)) && Number(valor) > 0)) {
      erros.push(`${nome} inválido: esperado inteiro maior que zero`);
    }
  }

  const criterio = criterioMedicamento(config.MEDICAMENTO_CRITERIO);
  if (!(CRITERIOS_MEDICAMENTO as readonly string[]).includes(criterio)) {
    erros.push(`MEDICAMENTO_CRITERIO inválido: ${criterio} (suportados: ${CRITERIOS_MEDICAMENTO.join(', ')})`);
  } else if (criterio === 'valor' && !(Number(texto('MEDICAMENTO_VALOR_MIN')) > 0)) {
    erros.push('MEDICAMENTO_VALOR_MIN inválido: esperado número maior que zero (obrigatório com MEDICAMENTO_CRITERIO=valor)');
  }

  if (erros.length) {
    throw new Error(`Configuração inválida no .env:\n  - ${erros.join('\n  - ')}`);
  }
  return config;
}
