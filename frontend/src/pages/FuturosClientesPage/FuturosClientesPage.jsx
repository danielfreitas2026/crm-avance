import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as I from '../../components/Icons';
import DocProgresso from '../../components/DocProgresso';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam
} from '../../services/notificacao-abertura.service';
import {
  adminDesvincularVendaLead,
  adminMarcarFuturoClienteLead,
  adminMarcarVendaRecusadaLead,
  adminVincularVendaLead,
  avaliarPrimeiraLigacaoLead,
  atualizarCampoLeadRecebido,
  enviarFuturoClienteParaDistribuicao,
  excluirFuturoCliente,
  excluirFuturoClienteDefinitivo,
  exportarMetricasFuturosClientesExcel,
  listarEstatisticasFuturosClientes,
  listarEstatisticasLinhasMailing,
  listarEstatisticasMailingsUsuario,
  listarFuturosClientesLeads,
  listarFuturosClientesRecebidos,
  listarFuturosClientesLixeira,
  listarVendasCandidatasLead,
  listarQuadroFuturosClientes,
  listarMetricasFuturosClientes,
  listarMeusMailings,
  listarMinhasLeadLinhas,
  marcarClienteRecusouLead,
  marcarChamadaNaoAtendidaLead,
  marcarFuturoClienteLead,
  marcarRetornoLead,
  marcarVendaRecusadaLead,
  reverterClienteRecusouLead,
  reverterChamadaNaoAtendidaLead,
  restaurarFuturoCliente
} from '../../services/lead-planilha.service';
import { formatDateValue, formatUtcDateTime, localDateTimeInputToUtc, parseUtcDateTime, toLocalDateTimeInputFromUtc } from '../../utils/datetime';
import { calcularProgresso } from '../../utils/progresso';
import { listarOperadoras } from '../../services/config.service';
import { buscarGooglePlacesFuturosClientes, consultarCnpj } from '../../services/cnpj.service';
import FuturoClienteAceiteModal from './FuturoClienteAceiteModal';
import {
  getClasseLinhaLead,
  isFuturoClienteAtivo,
  isFuturoClienteVendido,
  isVendaAntigaRegistrada,
  isVendaRecusada,
  resolverAbaFuturosClientes,
  formatarDuracaoMinutos
} from './lead-status';
import { montarFiltrosLinhasMailingRecebido } from './mailing-recebido-search';
import { ordenarMailingsMaisRecentes } from './mailing-order';
import './FuturosClientesPage.css';

function useDialogAcessivel(onClose, bloqueado = false) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const focoAnterior = document.activeElement;
    dialogRef.current?.focus();
    const aoPressionarTecla = event => {
      if (event.key === 'Escape' && !bloqueado) onClose();
    };
    document.addEventListener('keydown', aoPressionarTecla);
    return () => {
      document.removeEventListener('keydown', aoPressionarTecla);
      focoAnterior?.focus?.();
    };
  }, [onClose, bloqueado]);
  return dialogRef;
}

// ─── Helpers de colunas de lead ──────────────────────────────────────────────

/**
 * Normaliza texto lead para uso interno consistente.
 */
function normalizarTextoLead(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Aplica a máscara padrão de CNPJ durante a digitação e para valores já salvos.
 */
function formatarCnpj(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 14);

  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  if (digitos.length <= 8) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  if (digitos.length <= 12) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

const COLUMN_STOP_WORDS_LEAD = new Set(['a', 'as', 'o', 'os', 'de', 'da', 'das', 'do', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para']);

const COLUMN_ALIAS_GROUPS_LEAD = [
  { key: 'cnpj', label: 'CNPJ', aliases: ['cnpj', 'cpf cnpj', 'cpf/cnpj', 'documento', 'doc', 'cpf'] },
  { key: 'razao_social', label: 'Razao social', aliases: ['razao social', 'razão social', 'razao', 'nome empresarial', 'empresa'] },
  { key: 'telefone', label: 'Telefone', aliases: ['telefone', 'tel', 'fone', 'celular', 'whatsapp', 'numero telefone', 'numero celular'] },
  { key: 'telefone_fixo', label: 'Telefone fixo', aliases: ['telefone fixo', 'fone fixo', 'fixo'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail', 'correio eletronico', 'correio eletrônico'] },
  { key: 'responsavel', label: 'Responsavel', aliases: ['responsavel', 'responsável', 'contato', 'nome responsavel', 'nome do responsavel'] },
  { key: 'operadora', label: 'Operadora', aliases: ['operadora', 'operadora atual', 'operadora origem'] },
  { key: 'terminal', label: 'Terminal', aliases: ['terminal', 'linha', 'numero linha', 'numero da linha'] },
  { key: 'data_ativacao', label: 'Data de ativacao', aliases: ['data ativacao', 'data de ativacao', 'ativacao'] },
  { key: 'quantidade_chips', label: 'Quantidade de chips', aliases: ['quantidade chips', 'quantidade de chips', 'qtd chips', 'qtd', 'chips', 'ctns'] },
  { key: 'valor_mensal', label: 'Valor mensal', aliases: ['valor mensal', 'valor pago', 'mensalidade', 'preco', 'preço'] }
].map(grupo => ({
  ...grupo,
  aliases: grupo.aliases.map(normalizarNomeColunaLead)
}));

/**
 * Normaliza nome de coluna lead para comparacao entre planilhas.
 */
function normalizarNomeColunaLead(valor) {
  return normalizarTextoLead(valor)
    .replace(/[_./\\|()[\]{}:+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retorna chave de mapeamento para colunas equivalentes.
 */
function getChaveMapeamentoColunaLead(valor) {
  const nome = normalizarNomeColunaLead(valor);
  if (!nome) return '';

  const grupo = COLUMN_ALIAS_GROUPS_LEAD.find(item => item.aliases.includes(nome));
  if (grupo) return `alias::${grupo.key}`;

  const tokens = nome
    .split(' ')
    .filter(token => token && !COLUMN_STOP_WORDS_LEAD.has(token));

  return `nome::${tokens.join(' ') || nome}`;
}

/**
 * Retorna label padrao para uma chave mapeada quando ela tem alias conhecido.
 */
function getLabelMapeamentoColunaLead(chave, fallback) {
  const alias = String(chave || '').startsWith('alias::') ? String(chave).slice(7) : '';
  const grupo = alias ? COLUMN_ALIAS_GROUPS_LEAD.find(item => item.key === alias) : null;
  return grupo?.label || fallback;
}

/**
 * Encontra a fonte correta de uma coluna mapeada para a linha informada.
 */
function encontrarSourceColunaLeadRecebido(linha, coluna) {
  if (!Array.isArray(coluna?.sources) || coluna.sources.length === 0) return null;
  const planilhaId = Number(linha?.planilha_id || 0);
  const envioId = Number(linha?.envio_id || 0);

  return coluna.sources.find(source => Number(source.planilhaId || 0) > 0 && Number(source.planilhaId) === planilhaId)
    || coluna.sources.find(source => Number(source.envioId || 0) > 0 && Number(source.envioId) === envioId)
    || coluna.sources.find(source => Object.prototype.hasOwnProperty.call(linha?.dados_json || {}, source.nome))
    || null;
}

/**
 * Retorna valor lead recebido a partir dos dados informados.
 */
function getValorLeadRecebido(linha, coluna) {
  if (!coluna) return '';
  if (coluna.atualizada) {
    const colunaBase = getNomeColunaLeadRecebido(linha, coluna.base);
    return colunaBase ? linha.dados_json?.[`${colunaBase} (atualizado)`] ?? '' : '';
  }
  if (typeof coluna === 'string') return linha.dados_json?.[coluna] ?? '';
  if (Array.isArray(coluna.sources) && coluna.sources.length > 0) {
    const source = encontrarSourceColunaLeadRecebido(linha, coluna);
    return source ? linha.dados_json?.[source.nome] ?? '' : '';
  }
  if (coluna.planilhaId && Number(linha.planilha_id) !== Number(coluna.planilhaId)) return '';
  return linha.dados_json?.[coluna.nome] ?? '';
}

/**
 * Retorna nome coluna lead recebido a partir dos dados informados.
 */
function getNomeColunaLeadRecebido(linha, coluna) {
  if (!coluna) return '';
  if (typeof coluna === 'string') return coluna;
  if (Array.isArray(coluna.sources) && coluna.sources.length > 0) {
    return encontrarSourceColunaLeadRecebido(linha, coluna)?.nome || '';
  }
  if (coluna.planilhaId && Number(linha.planilha_id) !== Number(coluna.planilhaId)) return '';
  return coluna.nome || coluna.label || '';
}

/**
 * Retorna label coluna lead recebido a partir dos dados informados.
 */
function getLabelColunaLeadRecebido(coluna) {
  if (typeof coluna === 'string') return coluna;
  return coluna?.label || coluna?.nome || '';
}

/**
 * Retorna coluna key lead recebido a partir dos dados informados.
 */
function getColunaKeyLeadRecebido(coluna) {
  if (typeof coluna === 'string') return coluna;
  return coluna?.id || coluna?.nome || coluna?.label || '';
}

/**
 * Cria coluna atualizada lead recebido com os dados informados.
 */
function criarColunaAtualizadaLeadRecebido(coluna) {
  const key = getColunaKeyLeadRecebido(coluna);
  const nome = typeof coluna === 'string' ? coluna : coluna?.nome || coluna?.label || '';
  const sources = Array.isArray(coluna?.sources)
    ? coluna.sources.map(source => ({ ...source, nome: `${source.nome} (atualizado)` }))
    : coluna?.sources;

  return {
    ...(typeof coluna === 'string' ? {} : coluna),
    id: `${key}::updated`,
    nome: `${nome} (atualizado)`,
    label: `${getLabelColunaLeadRecebido(coluna)} (atualizado)`,
    sources,
    atualizada: true,
    base: coluna
  };
}

/**
 * Verifica se linha tem coluna atualizada atende a condicao esperada.
 */
function linhaTemColunaAtualizada(linhas, coluna) {
  return linhas.some(linha => {
    const nome = getNomeColunaLeadRecebido(linha, coluna);
    return nome && Object.prototype.hasOwnProperty.call(linha.dados_json || {}, `${nome} (atualizado)`);
  });
}

/**
 * Cria fontes derivadas das linhas carregadas para colunas sem metadados de origem.
 */
function getSourcesDerivadasColunaLead(linhas, envio, nomeColuna) {
  const envioId = Number(envio?.id || 0);
  const mapa = new Map();

  linhas.forEach(linha => {
    if (envioId > 0 && Number(linha.envio_id || 0) !== envioId) return;
    if (!Object.prototype.hasOwnProperty.call(linha.dados_json || {}, nomeColuna)) return;

    const planilhaId = Number(linha.planilha_id || 0);
    const chave = `${planilhaId || 'sem-planilha'}::${envioId || 'sem-envio'}::${nomeColuna}`;
    if (mapa.has(chave)) return;
    mapa.set(chave, {
      planilhaId: planilhaId || null,
      planilhaNome: linha.planilha?.nome || '',
      envioId: envioId || Number(linha.envio_id || 0) || null,
      envioNome: envio?.nome || linha.envio?.nome || '',
      nome: nomeColuna
    });
  });

  if (mapa.size === 0) {
    mapa.set(`envio::${envioId || 'sem-envio'}::${nomeColuna}`, {
      planilhaId: null,
      planilhaNome: '',
      envioId: envioId || null,
      envioNome: envio?.nome || '',
      nome: nomeColuna
    });
  }

  return Array.from(mapa.values());
}

/**
 * Acrescenta uma coluna ao mapa de colunas equivalentes.
 */
function adicionarColunaMapeadaLead(mapa, coluna, contexto = {}) {
  const nome = typeof coluna === 'string' ? coluna : (coluna?.nome || coluna?.label || '');
  const label = getLabelColunaLeadRecebido(coluna) || nome;
  const chave = getChaveMapeamentoColunaLead(nome || label);
  if (!chave) return;

  if (!mapa.has(chave)) {
    mapa.set(chave, {
      id: `map::${chave}`,
      nome,
      label: getLabelMapeamentoColunaLead(chave, label || nome),
      planilhaId: null,
      sources: [],
      _sourceKeys: new Set()
    });
  }

  const grupo = mapa.get(chave);
  const sourcesOriginais = Array.isArray(coluna?.sources) && coluna.sources.length > 0
    ? coluna.sources
    : getSourcesDerivadasColunaLead(contexto.linhas || [], contexto.envio, nome);

  sourcesOriginais.forEach(source => {
    const sourceNome = source?.nome || nome;
    if (!sourceNome) return;
    const planilhaId = Number(source?.planilhaId || coluna?.planilhaId || 0) || null;
    const envioId = Number(source?.envioId || contexto.envio?.id || 0) || null;
    const sourceKey = `${planilhaId || 'sem-planilha'}::${envioId || 'sem-envio'}::${sourceNome}`;
    if (grupo._sourceKeys.has(sourceKey)) return;
    grupo._sourceKeys.add(sourceKey);
    grupo.sources.push({
      ...source,
      planilhaId,
      planilhaNome: source?.planilhaNome || '',
      envioId,
      envioNome: source?.envioNome || contexto.envio?.nome || '',
      nome: sourceNome
    });
  });
}

/**
 * Retorna chave de origem para detectar colunas parecidas mas distintas na mesma planilha/envio.
 */
function getOrigemSourceColunaLead(source) {
  if (Number(source?.planilhaId || 0) > 0) return `planilha::${Number(source.planilhaId)}`;
  if (Number(source?.envioId || 0) > 0) return `envio::${Number(source.envioId)}`;
  return 'origem::desconhecida';
}

/**
 * Verifica se um grupo mapeado tem mais de uma coluna parecida na mesma origem.
 */
function grupoTemConflitoOrigemColunaLead(coluna) {
  const nomesPorOrigem = new Map();

  coluna.sources.forEach(source => {
    const origem = getOrigemSourceColunaLead(source);
    const nome = normalizarNomeColunaLead(source.nome);
    if (!nomesPorOrigem.has(origem)) nomesPorOrigem.set(origem, new Set());
    nomesPorOrigem.get(origem).add(nome);
  });

  return Array.from(nomesPorOrigem.values()).some(nomes => nomes.size > 1);
}

/**
 * Finaliza colunas mapeadas removendo metadados internos.
 */
function finalizarColunasMapeadasLead(mapa) {
  return Array.from(mapa.values()).flatMap(coluna => {
    const limpa = { ...coluna };
    delete limpa._sourceKeys;

    if (grupoTemConflitoOrigemColunaLead(limpa)) {
      const subgrupos = new Map();
      limpa.sources.forEach(source => {
        const chave = normalizarNomeColunaLead(source.nome);
        if (!subgrupos.has(chave)) subgrupos.set(chave, []);
        subgrupos.get(chave).push(source);
      });

      return Array.from(subgrupos.entries()).map(([chave, sources]) => ({
        ...limpa,
        id: `${limpa.id}::${chave}`,
        label: sources[0]?.nome || limpa.label,
        nome: sources[0]?.nome || limpa.nome,
        planilhaId: sources.length === 1 ? sources[0].planilhaId : null,
        sources
      }));
    }

    return [{
      ...limpa,
      planilhaId: limpa.sources.length === 1 ? limpa.sources[0].planilhaId : null,
      nome: limpa.sources[0]?.nome || limpa.nome
    }];
  });
}

/**
 * Retorna valor lead por nome a partir dos dados informados.
 */
function getValorLeadPorNome(linha, nomeColuna) {
  if (!nomeColuna) return '';
  const dados = linha.dados_json || {};
  const nomeAtualizado = `${nomeColuna} (atualizado)`;
  return dados[nomeAtualizado] ?? dados[nomeColuna] ?? '';
}

/**
 * Retorna colunas mapeaveis lead a partir dos dados informados.
 */
function getColunasMapeaveisLead(linha, colunas) {
  const opcoes = new Map();

  colunas.forEach(coluna => {
    if (coluna.atualizada) return;
    const nome = getNomeColunaLeadRecebido(linha, coluna);
    if (!nome || opcoes.has(nome)) return;
    opcoes.set(nome, {
      nome,
      label: getLabelColunaLeadRecebido(coluna),
      valor: getValorLeadPorNome(linha, nome)
    });
  });

  if (opcoes.size === 0) {
    Object.keys(linha.dados_json || {})
      .filter(chave => !chave.endsWith(' (atualizado)'))
      .forEach(chave => opcoes.set(chave, {
        nome: chave,
        label: chave,
        valor: getValorLeadPorNome(linha, chave)
      }));
  }

  return Array.from(opcoes.values());
}

/**
 * Processa sugerir coluna venda conforme as regras do dominio.
 */
function sugerirColunaVenda(campo, opcoes) {
  const aliases = [campo.label, campo.name, ...(campo.aliases || [])].map(normalizarTextoLead);
  const encontrada = opcoes.find(opcao => {
    const label = normalizarTextoLead(opcao.label);
    const nome = normalizarTextoLead(opcao.nome);
    return aliases.some(alias => alias && (label.includes(alias) || nome.includes(alias) || alias.includes(label)));
  });
  return encontrada?.nome || '';
}

const NOTAS_MAX_LENGTH = 500;

const CAMPOS_EMPRESA_FUTURO_CLIENTE = {
  razao_social: ['razao social', 'razão social', 'empresa', 'cliente', 'nome empresarial'],
  cnpj: ['cnpj', 'cpf/cnpj', 'documento'],
  telefone_fixo: ['fixo', 'telefone fixo', 'fone fixo'],
  terminal: ['terminal'],
  data_ativacao: ['data de ativacao', 'data ativacao', 'ativacao']
};

function encontrarValorLeadPorAliases(linha, aliases) {
  const dados = linha?.dados_json || {};
  const aliasesNormalizados = aliases.map(normalizarTextoLead);
  const chave = Object.keys(dados)
    .filter(nome => !nome.endsWith(' (atualizado)'))
    .find(nome => {
      const nomeNormalizado = normalizarTextoLead(nome);
      return aliasesNormalizados.some(alias => alias && (nomeNormalizado === alias || nomeNormalizado.includes(alias) || alias.includes(nomeNormalizado)));
    });

  return chave ? String(dados[`${chave} (atualizado)`] ?? dados[chave] ?? '').trim() : '';
}

function getDadosEmpresaFuturoCliente(linha, sondagem = null) {
  return {
    razao_social: String(sondagem?.razao_social || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.razao_social) || '').trim(),
    cnpj: String(sondagem?.cnpj || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.cnpj) || '').trim(),
    telefone_fixo: String(sondagem?.telefone_fixo || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.telefone_fixo) || '').trim(),
    terminal: String(sondagem?.terminal || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.terminal) || '').trim(),
    data_ativacao: String(sondagem?.data_ativacao || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.data_ativacao) || '').trim()
  };
}

const CAMPOS_VENDA_LEAD = [
  { name: 'nome', label: 'Nome', aliases: ['nome', 'name', 'cliente', 'empresa'] },
  { name: 'razao_social', label: 'Razão Social', aliases: ['razao', 'razao social', 'razão social', 'empresa'] },
  { name: 'cnpj', label: 'CNPJ', aliases: ['cnpj', 'cpf', 'documento'] },
  { name: 'telefone', label: 'Celular / Telefone', aliases: ['telefone', 'celular', 'whatsapp', 'fone', 'tel'] },
  { name: 'email', label: 'E-mail', aliases: ['email', 'e-mail', 'correio'] },
  { name: 'responsavel_nome', label: 'Responsável', aliases: ['responsavel', 'responsável', 'contato', 'rep'] }
];

/**
 * Monta cliente preenchido a partir dos dados informados.
 */
function montarClientePreenchido(vendaPreenchida) {
  if (!vendaPreenchida) return null;
  const nome = vendaPreenchida.nome || vendaPreenchida.razao_social || '';
  const cnpj = vendaPreenchida.cnpj || '';
  if (!nome && !cnpj) return null;
  return {
    nome,
    cnpj,
    razao_social: vendaPreenchida.razao_social || '',
    whatsapp: vendaPreenchida.telefone || '',
    email: vendaPreenchida.email || '',
    responsavel_nome: vendaPreenchida.responsavel_nome || '',
    responsavel_tipo: vendaPreenchida.responsavel_tipo || 'rl',
    operadora_atual_id: vendaPreenchida.operadora_atual_id || '',
    quantidade_chips: vendaPreenchida.quantidade_linhas || '',
    valor_pago: vendaPreenchida.valor_mensal_estimado || '',
  };
}

/**
 * Monta venda preenchida do lead a partir dos dados informados.
 */
function montarVendaPreenchidaDoLead(linha, mapeamento, usuario) {
  const sondagem = linha?.sondagem || {};
  const vendedoraId = Number(linha?.atribuido_para_id || usuario?.id || 0);
  const payload = {
    ...(vendedoraId > 0 ? {
      vendedora_id: String(vendedoraId),
      vendedoras: [String(vendedoraId)]
    } : {}),
    ...(sondagem.razao_social ? { razao_social: sondagem.razao_social } : {}),
    ...(sondagem.cnpj ? { cnpj: sondagem.cnpj } : {}),
    ...(sondagem.contato_nome ? { responsavel_nome: sondagem.contato_nome } : {}),
    ...(sondagem.contato_tipo ? { responsavel_tipo: sondagem.contato_tipo } : {}),
    ...(sondagem.operadora_atual_id ? { operadora_atual_id: String(sondagem.operadora_atual_id) } : {}),
    ...(sondagem.quantidade_chips ? { quantidade_linhas: Number(sondagem.quantidade_chips) } : {}),
    ...(sondagem.valor_mensal_estimado ? { valor_mensal_estimado: Number(sondagem.valor_mensal_estimado) } : {}),
    ...(sondagem.whatsapp_ddd ? { telefone: `${sondagem.whatsapp_ddd}${sondagem.whatsapp_numero || ''}` } : {})
  };

  CAMPOS_VENDA_LEAD.forEach(campo => {
    const coluna = mapeamento?.[campo.name];
    const valor = getValorLeadPorNome(linha, coluna);
    if (String(valor || '').trim()) {
      payload[campo.name] = valor;
    }
  });

  return payload;
}

/**
 * Formata data hora para exibicao ou envio.
 */
function formatarDataHora(valor) {
  return formatUtcDateTime(valor, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }, '-');
}

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(valor) {
  return formatDateValue(valor, undefined, '-');
}

/**
 * Formata valores de data vindos das colunas dinamicas do lead.
 */
function formatarValorCampoLead(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(valor.trim())) {
    return valor;
  }

  return formatarData(valor);
}

/**
 * Verifica se futuro cliente na lixeira atende a condicao esperada.
 */
function isFuturoClienteNaLixeira(linha) {
  return Boolean(linha?.futuro_cliente && linha?.futuro_cliente_excluido_em);
}

function normalizarDataAtivacaoInput(valor) {
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const partes = texto.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!partes) return '';
  const ano = partes[3].length === 2 ? `20${partes[3]}` : partes[3];
  const data = new Date(`${ano}-${partes[2]}-${partes[1]}T12:00:00`);
  return Number.isNaN(data.getTime()) ? '' : `${ano}-${partes[2]}-${partes[1]}`;
}

function formatarWhatsappInput(valor) {
  let digitos = String(valor || '').replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length > 11) digitos = digitos.slice(2);
  digitos = digitos.slice(0, 11);
  if (!digitos) return '';
  if (digitos.length <= 2) return `(${digitos}`;
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  if (numero.length <= 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}


function isFuturoClienteRecusado(linha) {
  return Boolean(isFuturoClienteAtivo(linha) && isVendaRecusada(linha));
}

function isRetornoFuturoClienteVencido(valor, agora = Date.now()) {
  const retorno = parseUtcDateTime(valor);
  return Boolean(retorno && retorno.getTime() < agora);
}

function renderFuturoClienteSituacao(linha) {
  const statusDistribuicao = linha?.distribuicao?.status;
  if (linha?.distribuicao?.status === 'aguardando_aceite') {
    return <span className="pill warn lead-status-pill"><span className="pill-dot"></span>Aguardando seu aceite</span>;
  }

  if (linha?.distribuicao?.status === 'aceito' && !linha?.distribuicao?.acao_registrada_em) {
    return (
      <span className="pill warn lead-status-pill" title={`Prazo: ${formatarDataHora(linha.distribuicao.prazo_acao_em)}`}>
        <span className="pill-dot"></span>Contato pendente
      </span>
    );
  }

  if (isFuturoClienteVendido(linha)) {
    return <span className="pill lead-status-pill sold"><span className="pill-dot"></span>Venda registrada por futuro cliente</span>;
  }

  if (statusDistribuicao === 'recusado') return <span className="pill danger lead-status-pill"><span className="pill-dot"></span>Encaminhamento recusado</span>;
  if (statusDistribuicao === 'expirado_sem_acao') return <span className="pill warn lead-status-pill"><span className="pill-dot"></span>Prazo expirado</span>;
  if (statusDistribuicao === 'cancelado') return <span className="pill muted lead-status-pill"><span className="pill-dot"></span>Encaminhamento cancelado</span>;
  if (statusDistribuicao === 'aceito' && linha?.distribuicao?.acao_registrada_em) return <span className="pill success lead-status-pill"><span className="pill-dot"></span>Encaminhamento encerrado</span>;

  if (isVendaAntigaRegistrada(linha)) {
    return <span className="pill lead-status-pill old-sale"><span className="pill-dot"></span>Venda antiga registrada</span>;
  }

  if (isFuturoClienteRecusado(linha)) {
    return <span className="pill lead-status-pill refused" title={linha.venda_recusada_motivo || ''}><span className="pill-dot"></span>Venda recusada</span>;
  }

  return <span className="pill success lead-status-pill"><span className="pill-dot"></span>Em negociação</span>;
}

/**
 * Renderiza lead status no fluxo da tela.
 */
function renderLeadStatus(linha, agora = Date.now()) {
  if (linha?.detalhes_bloqueados) {
    return (
      <span className="lead-status-cell">
        <span className="pill warn lead-status-pill">
          <span className="pill-dot"></span>
          Aguardando aceite
        </span>
      </span>
    );
  }

  const avaliacaoPrimeiraLigacao = ({
    bom: { label: 'Bom', classe: 'quality-good' },
    mais_ou_menos: { label: 'Mais ou menos', classe: 'quality-medium' },
    ruim: { label: 'Ruim', classe: 'quality-bad' }
  })[linha?.primeira_ligacao_avaliacao];

  if (isFuturoClienteNaLixeira(linha)) {
    return (
      <span className="lead-status-cell">
        <span className="pill lead-status-pill muted">Na lixeira</span>
      </span>
    );
  }

  if (linha.cliente_recusou) {
    return (
      <span className="lead-status-cell">
        <span className="pill lead-status-pill refused" title={linha.cliente_recusou_motivo || ''}>
          <span className="pill-dot"></span>
          Cliente recusou
        </span>
        {linha.cliente_recusou_em && (
          <span className="lead-status-return">Em {formatarDataHora(linha.cliente_recusou_em)}</span>
        )}
      </span>
    );
  }

  if (isVendaRecusada(linha) && !isFuturoClienteAtivo(linha)) {
    return (
      <span className="lead-status-cell">
        <span className="pill lead-status-pill refused" title={linha.venda_recusada_motivo || ''}>
          <span className="pill-dot"></span>
          Venda recusada
        </span>
        {linha.venda_recusada_em && (
          <span className="lead-status-return">Em {formatarDataHora(linha.venda_recusada_em)}</span>
        )}
      </span>
    );
  }

  if (linha.chamada_nao_atendida && !isFuturoClienteVendido(linha) && !isFuturoClienteRecusado(linha)) {
    return (
      <span className="lead-status-cell">
        <span className="pill warn lead-status-pill" title={linha.chamada_nao_atendida_motivo || ''}>
          <span className="pill-dot"></span>
          Chamada não atendida
        </span>
        {linha.chamada_nao_atendida_em && (
          <span className="lead-status-return">Em {formatarDataHora(linha.chamada_nao_atendida_em)}</span>
        )}
      </span>
    );
  }

  if (linha.retorno_agendado_em && !isFuturoClienteAtivo(linha)) {
    return (
      <span className="lead-status-cell">
        <span className="pill warn lead-status-pill">
          <span className="pill-dot"></span>
          Retorno marcado
        </span>
        <span className={`lead-status-return ${isRetornoFuturoClienteVencido(linha.retorno_agendado_em, agora) ? 'is-overdue' : ''}`}>
          {formatarDataHora(linha.retorno_agendado_em)}
        </span>
      </span>
    );
  }

  if (isVendaAntigaRegistrada(linha) && !isFuturoClienteAtivo(linha)) {
    return <span className="lead-status-cell"><span className="pill lead-status-pill old-sale" title="Venda concluída antes do recebimento deste mailing"><span className="pill-dot"></span>Venda antiga registrada</span></span>;
  }

  if (isFuturoClienteAtivo(linha)) {
    return (
      <span className="lead-status-cell">
        {isFuturoClienteVendido(linha) && !linha.venda_registrada_oculta && (
          <span className="pill lead-status-pill sold">
            <span className="pill-dot"></span>
            Venda registrada por futuro cliente
          </span>
        )}
        {isVendaAntigaRegistrada(linha) && (
          <span className="pill lead-status-pill old-sale" title="Venda concluída antes do recebimento deste mailing">
            <span className="pill-dot"></span>
            Venda antiga registrada
          </span>
        )}
        {isFuturoClienteRecusado(linha) && (
          <span className="pill lead-status-pill refused" title={linha.venda_recusada_motivo || ''}>
            <span className="pill-dot"></span>
            Venda recusada
          </span>
        )}
        <span className="pill success lead-status-pill">
          <span className="pill-dot"></span>
          Futuro cliente
        </span>
        {avaliacaoPrimeiraLigacao && (
          <span
            className={`pill lead-status-pill ${avaliacaoPrimeiraLigacao.classe}`}
            title={`Qualidade da primeira liga\u00e7\u00e3o: ${avaliacaoPrimeiraLigacao.label}`}
          >
            <span className="pill-dot"></span>
            1&ordf; liga&ccedil;&atilde;o: {avaliacaoPrimeiraLigacao.label}
          </span>
        )}
        {linha.futuro_cliente_retorno && (
          <span className={`lead-status-return ${isRetornoFuturoClienteVencido(linha.futuro_cliente_retorno, agora) ? 'is-overdue' : ''}`}>
            Retorno: {formatarDataHora(linha.futuro_cliente_retorno)}
          </span>
        )}
      </span>
    );
  }

  return <span className="muted">-</span>;
}

export function LeadStatusMailing({ linha, agora }) {
  return renderLeadStatus(linha, agora);
}

/**
 * Formata para datetime local para exibicao ou envio.
 */
function formatarParaDatetimeLocal(valor) {
  return toLocalDateTimeInputFromUtc(valor);
}

/**
 * Retorna datetime retorno para iso no formato esperado pelo fluxo.
 */
function datetimeRetornoParaIso(valor) {
  return valor ? localDateTimeInputToUtc(valor) : null;
}

/**
 * Formata a digitacao do usuario como moeda BR (digitos da direita para a esquerda).
 */
function formatarInputMoedaBR(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';

  return (Number(digitos) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formata um numero vindo da API para o formato exibido no input de moeda.
 */
function formatarNumeroParaInputMoeda(valor) {
  if (valor === undefined || valor === null || valor === '') return '';

  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';

  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Converte o texto do input de moeda BR ("1.234,56") em numero.
 */
function moedaBRParaNumero(valor) {
  const numero = Number(String(valor ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Monta os itens de chips no formato aceito pela API.
 */
function chipsItensParaEnvio(itens) {
  return (itens || [])
    .map(item => ({
      quantidade: Number(item.quantidade) || 0,
      preco_por_chip: moedaBRParaNumero(item.preco_por_chip)
    }))
    .filter(item => item.quantidade > 0 && item.preco_por_chip > 0);
}

function criarChipsItensSondagem(sondagem = null) {
  const itens = Array.isArray(sondagem?.chips_itens) ? sondagem.chips_itens : [];
  if (itens.length) return itens.map(item => ({ quantidade: String(item.quantidade || ''), preco_por_chip: formatarNumeroParaInputMoeda(item.preco_por_chip) }));
  if (sondagem?.quantidade_chips || sondagem?.preco_por_chip) {
    return [{ quantidade: String(sondagem.quantidade_chips || ''), preco_por_chip: formatarNumeroParaInputMoeda(sondagem.preco_por_chip) }];
  }
  return [{ quantidade: '', preco_por_chip: '' }];
}

function formatarMoedaSondagem(valor) {
  const numero = Number(valor || 0);
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarChipsSondagem(sondagem) {
  const itens = criarChipsItensSondagem(sondagem)
    .filter(item => Number(item.quantidade) > 0 && moedaBRParaNumero(item.preco_por_chip) > 0);

  if (!itens.length) return '-';

  return itens
    .map(item => `${item.quantidade} × ${formatarMoedaSondagem(moedaBRParaNumero(item.preco_por_chip))}`)
    .join(' + ');
}

function formatarWhatsappSondagem(sondagem) {
  return sondagem?.whatsapp_ddd ? `(${sondagem.whatsapp_ddd}) ${sondagem.whatsapp_numero || ''}` : '-';
}

function ChipsItensSondagem({ itens, onChange, disabled, complementoRodape = null }) {
  function atualizar(index, campo, valor) {
    onChange(itens.map((item, itemIndex) => itemIndex === index ? { ...item, [campo]: valor } : item));
  }
  function remover(index) {
    if (itens.length <= 1) return;
    onChange(itens.filter((_, itemIndex) => itemIndex !== index));
  }
  const botaoAdicionar = (
    <button type="button" className="btn btn-sm chips-sondagem-add" onClick={() => onChange([...itens, { quantidade: '', preco_por_chip: '' }])} disabled={disabled}>
      <I.Plus size={14} /> Adicionar outro valor de chip
    </button>
  );
  return (
    <div className="chips-sondagem-editor">
      {itens.map((item, index) => (
        <div className="chips-sondagem-row" key={index}>
          <div className="form-field">
            <label>Quantidade de chips</label>
            <input type="number" min="1" step="1" value={item.quantidade} onChange={event => atualizar(index, 'quantidade', event.target.value)} required disabled={disabled} />
          </div>
          <div className="form-field">
            <label>Preco por chip</label>
            <input type="text" inputMode="decimal" placeholder="0,00" value={item.preco_por_chip} onChange={event => atualizar(index, 'preco_por_chip', formatarInputMoedaBR(event.target.value))} required disabled={disabled} />
          </div>
          {itens.length > 1 && (
            <button type="button" className="btn btn-icon btn-ghost chips-sondagem-remove" title="Remover faixa" onClick={() => remover(index)} disabled={disabled}><I.Trash size={14} /></button>
          )}
        </div>
      ))}
      {complementoRodape ? (
        <div className="chips-sondagem-footer">
          {botaoAdicionar}
          {complementoRodape}
        </div>
      ) : botaoAdicionar}
    </div>
  );
}

// ─── Modal: registrar venda ───────────────────────────────────────────────────

/**
 * Renderiza registrar venda lead modal.
 */
function RegistrarVendaLeadModal({ linha, colunas, usuario, onClose, onConfirm }) {
  const dialogRef = useDialogAcessivel(onClose);
  const opcoesColunas = useMemo(() => getColunasMapeaveisLead(linha, colunas), [linha, colunas]);
  const [mapeamento, setMapeamento] = useState(() => (
    CAMPOS_VENDA_LEAD.reduce((acc, campo) => ({
      ...acc,
      [campo.name]: sugerirColunaVenda(campo, opcoesColunas)
    }), {})
  ));

  /**
   * Atualiza mapeamento com os dados informados.
   */
  function atualizarMapeamento(campo, valor) {
    setMapeamento(prev => ({ ...prev, [campo]: valor }));
  }

  /**
   * Envia o formulario para processamento.
   */
  function submit(event) {
    event.preventDefault();
    onConfirm(montarVendaPreenchidaDoLead(linha, mapeamento, usuario));
  }

  return (
    <div className="modal-overlay">
      <form ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Registrar venda" className="modal lead-sale-modal" onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Registrar venda</div>
              <div className="modal-sub">Escolha quais colunas vão preencher a nova venda.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="lead-sale-map-head">
            <span>Campo da venda</span>
            <span>Coluna da planilha</span>
            <span>Valor que será levado</span>
          </div>

          <div className="lead-sale-map-list">
            {CAMPOS_VENDA_LEAD.map(campo => {
              const coluna = mapeamento[campo.name] || '';
              const valor = getValorLeadPorNome(linha, coluna);

              return (
                <div key={campo.name} className="lead-sale-map-row">
                  <label>{campo.label}</label>
                  <select value={coluna} onChange={event => atualizarMapeamento(campo.name, event.target.value)}>
                    <option value="">Não preencher</option>
                    {opcoesColunas.map(opcao => (
                      <option key={opcao.nome} value={opcao.nome}>{opcao.label}</option>
                    ))}
                  </select>
                  <span title={valor || ''}>{valor || '-'}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Continuar na nova venda</button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal: atualizar campo ───────────────────────────────────────────────────

/**
 * Renderiza lead atualizacao modal.
 */
function LeadAtualizacaoModal({ dados, salvando, erro, onClose, onSave }) {
  const dialogRef = useDialogAcessivel(onClose, salvando);
  const [valor, setValor] = useState(dados?.valorAtualizado || '');

  if (!dados) return null;

  /**
   * Envia o formulario para processamento.
   */
  function submit(event) {
    event.preventDefault();
    onSave(valor);
  }

  return (
    <div className="modal-overlay">
      <form ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Atualizar informação" className="modal lead-update-modal" onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Atualizar informação</div>
              <div className="modal-sub">{dados.label}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={salvando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="lead-update-summary">
            <span>Informação original</span>
            <strong>{dados.valorOriginal || '-'}</strong>
          </div>

          <div className="form-field">
            <label>Informação atualizada</label>
            <input
              autoFocus
              value={valor}
              onChange={event => setValor(event.target.value)}
              required
            />
          </div>

          {erro && <div className="alert-error" style={{ marginTop: 16 }}>{erro}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={salvando}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando || !valor.trim()}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal: adicionar lead (popup intermediário) ──────────────────────────────

/**
 * Renderiza adicionar lead modal.
 */
/** Permite pesquisar no Google Places usando os dados do lead selecionado. */
function BuscarTelefoneGoogleModal({ linha, onClose }) {
  const dialogRef = useDialogAcessivel(onClose);
  const dadosEmpresa = useMemo(() => getDadosEmpresaFuturoCliente(linha, linha.sondagem), [linha]);
  const [modo, setModo] = useState(dadosEmpresa.cnpj ? 'cnpj' : 'texto');
  const [texto, setTexto] = useState(dadosEmpresa.cnpj || dadosEmpresa.razao_social);
  const [resultado, setResultado] = useState(null);
  const [resultadoReceita, setResultadoReceita] = useState(null);
  const [erroReceita, setErroReceita] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');

  function mudarModo(proximoModo) {
    setModo(proximoModo);
    setTexto(proximoModo === 'cnpj' ? dadosEmpresa.cnpj : dadosEmpresa.razao_social);
    setResultado(null);
    setResultadoReceita(null);
    setErroReceita('');
    setErro('');
  }

  async function buscar(event) {
    event.preventDefault();
    if (!texto.trim()) return;
    setBuscando(true);
    setErro('');
    setErroReceita('');
    setResultado(null);
    setResultadoReceita(null);
    try {
      let dadosReceita = null;
      if (modo === 'cnpj') {
        try {
          dadosReceita = await consultarCnpj(texto.trim());
          setResultadoReceita(dadosReceita);
        } catch (error) {
          setErroReceita(error.message || 'Nao foi possivel consultar o CNPJ nas fontes da Receita.');
        }
      }
      const buscaGoogle = dadosReceita?.razaoSocial || dadosReceita?.nomeFantasia || texto.trim();
      setResultado(await buscarGooglePlacesFuturosClientes(buscaGoogle, {
        razaoSocial: dadosReceita?.razaoSocial || dadosEmpresa.razao_social,
        nomeFantasia: dadosReceita?.nomeFantasia || ''
      }));
    } catch (error) {
      setErro(error.message || 'Erro ao buscar no Google.');
    } finally {
      setBuscando(false);
    }
  }

  const candidatos = resultado?.candidatos || (resultado?.place ? [resultado.place] : []);
  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <form ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Buscar telefone no Google" className="modal lead-update-modal" onSubmit={buscar}>
        <div className="modal-header"><div className="modal-header-row"><div><div className="modal-client">Buscar telefone no Google</div><div className="modal-sub">Consulta do cliente selecionado</div></div><button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={buscando}><I.Close size={14} /></button></div></div>
        <div className="modal-body">
          <div className="form-field"><label>Buscar por</label><select value={modo} onChange={event => mudarModo(event.target.value)} disabled={buscando}><option value="cnpj" disabled={!dadosEmpresa.cnpj}>CNPJ do cliente</option><option value="texto">Texto / razo social</option></select></div>
          <div className="form-field" style={{ marginTop: 12 }}><label>{modo === 'cnpj' ? 'CNPJ' : 'Texto para busca'}</label><input value={texto} onChange={event => setTexto(event.target.value)} placeholder={modo === 'cnpj' ? 'CNPJ do cliente' : 'Razo social ou termo de busca'} maxLength="240" disabled={buscando} required /></div>
          {resultadoReceita && <div className="adicionar-lead-dados" style={{ marginTop: 12 }}>
            <div className="adicionar-lead-campo"><span className="adicionar-lead-campo__label">Razao social (Receita)</span><span className="adicionar-lead-campo__valor">{resultadoReceita.razaoSocial || '-'}</span></div>
            <div className="adicionar-lead-campo"><span className="adicionar-lead-campo__label">Telefone (Receita)</span><span className="adicionar-lead-campo__valor">{formatarWhatsappInput(resultadoReceita.telefone) || 'Nao informado'}</span></div>
          </div>}
          {erroReceita && <div className="alert-error" style={{ marginTop: 12 }}>{erroReceita}</div>}          {resultado?.query && <div className="muted" style={{ marginTop: 12 }}>Busca enviada: {resultado.query}</div>}
          {resultado?.telefone && <div className="alert-success" style={{ marginTop: 12 }}>Telefone encontrado: <strong>{formatarWhatsappInput(resultado.telefone)}</strong></div>}
          {resultado && !resultado.telefone && <div className="alert-error" style={{ marginTop: 12 }}>{resultado.message || 'Nenhum telefone foi encontrado para esta busca.'}</div>}
          {candidatos.length > 0 && <div className="google-candidatos">{candidatos.map((candidato, index) => {
            const temPct = typeof candidato.confianca_pct === 'number';
            const nivel = candidato.confianca_nivel || 'baixa';
            const nivelTexto = nivel === 'alta' ? 'Alta' : nivel === 'media' ? 'Média' : 'Baixa';
            return (
              <div className="google-candidato" key={candidato.id || `${candidato.nome}-${index}`}>
                <div className="google-candidato__topo">
                  <span className="google-candidato__nome">{candidato.nome || 'Resultado do Google'}</span>
                  {temPct && <span className={`confianca-badge confianca-badge--${nivel}`} title="Confiabilidade calculada pela semelhança do nome (fuzzy)">
                    <span className="confianca-badge__pct">{candidato.confianca_pct}%</span>
                    <span>{nivelTexto}</span>
                  </span>}
                </div>
                <div className="google-candidato__meta">
                  <span className="google-candidato__telefone">{candidato.telefone ? formatarWhatsappInput(candidato.telefone) : 'Sem telefone no Google'}</span>
                  {candidato.endereco && <span>{candidato.endereco}</span>}
                </div>
                {candidato.recomenda_apify && candidato.apify_motivo && <div className="google-candidato__apify"><span><strong>Sugestão:</strong> {candidato.apify_motivo}</span></div>}
              </div>
            );
          })}</div>}
          {erro && <div className="alert-error" style={{ marginTop: 12 }}>{erro}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn" onClick={onClose} disabled={buscando}>Fechar</button><button type="submit" className="btn btn-primary" disabled={buscando || !texto.trim()}>{buscando ? 'Buscando...' : modo === 'cnpj' ? 'Buscar Receita e Google' : 'Buscar no Google'}</button></div>
      </form>
    </div>
  );
}

/**
 * Painel com o resultado do enriquecimento automatico de contatos (Google),
 * disparado quando o mailing foi dividido para sondagem. Mostra o telefone
 * encontrado, a % de confiabilidade e, quando aplicavel, a recomendacao de
 * uma busca extra (Apify).
 */
function EnriquecimentoAutomatico({ enriquecimento }) {
  if (!enriquecimento) return null;
  const e = enriquecimento;
  const emAndamento = e.status === 'pendente' || e.status === 'processando';
  const nivel = e.confianca_nivel || 'baixa';
  const nivelTexto = nivel === 'alta' ? 'Alta' : nivel === 'media' ? 'Média' : 'Baixa';
  const temPct = typeof e.confianca_pct === 'number';

  return (
    <div className="enriquecimento-auto">
      <div className="enriquecimento-auto__titulo">Contatos encontrados automaticamente (Google)</div>
      {emAndamento && <div className="muted enriquecimento-auto__status">Buscando contatos… atualize a lista em instantes.</div>}
      {e.status === 'concluido' && <div className="google-candidato">
        <div className="google-candidato__topo">
          <span className="google-candidato__nome">{e.nome_encontrado || 'Empresa localizada'}</span>
          {temPct && <span className={`confianca-badge confianca-badge--${nivel}`} title="Confiabilidade calculada pela semelhança do nome (fuzzy)">
            <span className="confianca-badge__pct">{e.confianca_pct}%</span>
            <span>{nivelTexto}</span>
          </span>}
        </div>
        <div className="google-candidato__meta">
          <span className="google-candidato__telefone">{e.telefone ? formatarWhatsappInput(e.telefone) : 'Sem telefone no Google'}</span>
          {e.site && <span>{e.site}</span>}
          {e.endereco && <span>{e.endereco}</span>}
        </div>
        {e.recomenda_apify && e.apify_motivo && <div className="google-candidato__apify"><span><strong>Sugestão:</strong> {e.apify_motivo}</span></div>}
      </div>}
      {e.status === 'sem_resultado' && <div className="google-candidato__apify"><span><strong>Sugestão:</strong> {e.apify_motivo || 'O Google não retornou um telefone confiável para esta empresa.'}</span></div>}
      {e.status === 'erro' && <div className="muted enriquecimento-auto__status">Não foi possível enriquecer os contatos automaticamente.</div>}
    </div>
  );
}

export function EscolherDestinoFuturoClienteModal({ processando, onClose, onChoose }) {
  const dialogRef = useDialogAcessivel(onClose, processando);
  return (
    <div className="modal-overlay futuro-cliente-destino-overlay">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="futuro-cliente-destino-titulo" className="modal futuro-cliente-destino-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="futuro-cliente-destino-titulo" className="modal-client">O que deseja fazer com este futuro cliente?</div>
              <div className="modal-sub">Escolha onde ele ficará após o cadastro.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" aria-label="Fechar escolha de destino" onClick={onClose} disabled={processando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body futuro-cliente-destino-modal__opcoes">
          <button type="button" className="futuro-cliente-destino-opcao" onClick={() => onChoose('carteira')} disabled={processando}>
            <I.User size={22} />
            <span><strong>Ficar comigo</strong><small>Mantenha o futuro cliente na sua carteira para acompanhar depois.</small></span>
          </button>
          <button type="button" className="futuro-cliente-destino-opcao is-primary" onClick={() => onChoose('distribuicao')} disabled={processando}>
            <I.Send size={22} />
            <span><strong>Enviar para distribuição</strong><small>Publique no Telegram para que outra consultora possa assumir.</small></span>
          </button>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={processando}>Voltar ao formulário</button>
          {processando && <span className="muted">Salvando futuro cliente...</span>}
        </div>
      </div>
    </div>
  );
}

export function AdicionarLeadModal({ linha, colunas, usuario, onClose, onRegistrarVenda, onFuturoClienteSalvo, onLinhaAtualizada }) {
  const [confirmacaoDestinoAberta, setConfirmacaoDestinoAberta] = useState(false);
  const dialogRef = useDialogAcessivel(onClose, confirmacaoDestinoAberta);
  const vendaRegistrada = isFuturoClienteVendido(linha);
  const vendaRecusada = isVendaRecusada(linha);
  const clienteRecusou = Boolean(linha.cliente_recusou);
  const [etapa, setEtapa] = useState('opcoes'); // 'opcoes' | 'venda' | 'futuro'
  const [notas, setNotas] = useState('');
  const [motivoRecusa, setMotivoRecusa] = useState(linha.venda_recusada_motivo || '');
  const [retorno, setRetorno] = useState('');
  const [formRecusaAberto, setFormRecusaAberto] = useState(false);
  const [motivoClienteRecusou, setMotivoClienteRecusou] = useState('');
  const [formChamadaAberto, setFormChamadaAberto] = useState(false);
  const [motivoChamada, setMotivoChamada] = useState('');
  const [retornoAgendado, setRetornoAgendado] = useState(() => formatarParaDatetimeLocal(linha.retorno_agendado_em) || '');
  const [observacaoRetorno, setObservacaoRetorno] = useState(() => linha.retorno_agendado_observacao || '');
  const [salvandoRetorno, setSalvandoRetorno] = useState(false);
  const [sucessoRetorno, setSucessoRetorno] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [avaliacaoPrimeiraLigacao, setAvaliacaoPrimeiraLigacao] = useState(linha.primeira_ligacao_avaliacao || '');
  const [salvandoAvaliacao, setSalvandoAvaliacao] = useState(false);
  const [sucessoAvaliacao, setSucessoAvaliacao] = useState('');
  const [erro, setErro] = useState('');
  const [buscaGoogleAberta, setBuscaGoogleAberta] = useState(false);
  const [operadoras, setOperadoras] = useState([]);
  const podeRegistrarVenda = temPermissao(usuario, 'vendas_criar');
  const podeRegistrarFuturo = temPermissao(usuario, 'futuros_clientes_registrar');
  const podeBuscarGoogle = temPermissao(usuario, 'futuros_clientes_buscar_telefone_google');
  const podeAvaliarPrimeiraLigacao = linha.etapa_atual === 'venda'
    && Number(linha.atribuido_para_id) === Number(usuario?.id)
    && Number(linha.futuro_cliente_marcado_por_id) !== Number(usuario?.id);
  const dadosEmpresaInicial = useMemo(() => getDadosEmpresaFuturoCliente(linha), [linha]);
  const [razaoSocial, setRazaoSocial] = useState(() => dadosEmpresaInicial.razao_social);
  const [cnpj, setCnpj] = useState(() => formatarCnpj(dadosEmpresaInicial.cnpj));
  const [contatoNome, setContatoNome] = useState('');
  const [contatoTipo, setContatoTipo] = useState('');
  const [operadoraAtualId, setOperadoraAtualId] = useState('');
  const [operadoraInteresseId, setOperadoraInteresseId] = useState('');
  const [chipsItens, setChipsItens] = useState(() => criarChipsItensSondagem());
  const [melhorNumeroContato, setMelhorNumeroContato] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [telefoneFixo, setTelefoneFixo] = useState(() => formatarWhatsappInput(dadosEmpresaInicial.telefone_fixo));
  const [terminal, setTerminal] = useState(() => formatarWhatsappInput(dadosEmpresaInicial.terminal));
  const [dataAtivacao, setDataAtivacao] = useState(() => normalizarDataAtivacaoInput(dadosEmpresaInicial.data_ativacao));
  const valorMensalEstimado = chipsItens.reduce((total, item) => total
    + ((Number(item.quantidade) || 0) * moedaBRParaNumero(item.preco_por_chip)), 0);

  useEffect(() => {
    listarOperadoras().then(resultado => setOperadoras(Array.isArray(resultado) ? resultado : resultado?.data || [])).catch(() => setOperadoras([]));
  }, []);

  const camposLead = useMemo(() => {
    const dados = linha.dados_json || {};
    return Object.entries(dados)
      .filter(([chave]) => !chave.endsWith(' (atualizado)'))
      .map(([chave, valor]) => ({
        label: chave,
        valor: dados[`${chave} (atualizado)`] ?? valor
      }));
  }, [linha]);
  async function salvarVendaRecusada() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await marcarVendaRecusadaLead(linha.id, motivoRecusa);
      onFuturoClienteSalvo(resultado.linha, 'Venda recusada registrada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao marcar venda recusada.');
      setSalvando(false);
    }
  }

  /**
   * Salva a avaliacao exclusiva da primeira ligacao sem fechar o cliente.
   */
  async function salvarAvaliacaoPrimeiraLigacao() {
    if (!avaliacaoPrimeiraLigacao) {
      setErro('Selecione Bom, Mais ou menos ou Ruim.');
      return;
    }

    setSalvandoAvaliacao(true);
    setErro('');
    setSucessoAvaliacao('');
    try {
      const resultado = await avaliarPrimeiraLigacaoLead(linha.id, avaliacaoPrimeiraLigacao);
      onLinhaAtualizada(resultado.linha);
      setSucessoAvaliacao('Avaliação da primeira ligação salva.');
    } catch (error) {
      setErro(error.message || 'Erro ao avaliar a primeira ligação.');
    } finally {
      setSalvandoAvaliacao(false);
    }
  }

  /**
   * Registra que o cliente recusou o contato (motivo opcional).
   */
  async function salvarClienteRecusou() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await marcarClienteRecusouLead(linha.id, motivoClienteRecusou.trim());
      onFuturoClienteSalvo(resultado.linha, 'Recusa do cliente registrada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao registrar a recusa do cliente.');
      setSalvando(false);
    }
  }

  /**
   * Desfaz a recusa e devolve o lead para a fila de trabalho.
   */
  async function reverterRecusa() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await reverterClienteRecusouLead(linha.id);
      // Mantem o card aberto no mesmo lead, ja de volta nas opcoes de registro.
      onLinhaAtualizada(resultado.linha);
      setEtapa('opcoes');
      setFormRecusaAberto(false);
      setMotivoClienteRecusou('');
      setRetornoAgendado(formatarParaDatetimeLocal(resultado.linha.retorno_agendado_em) || '');
      setObservacaoRetorno(resultado.linha.retorno_agendado_observacao || '');
    } catch (error) {
      setErro(error.message || 'Erro ao reverter a recusa do cliente.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Registra que a ligacao nao foi atendida (motivo opcional). Nao tira o lead da fila.
   */
  async function salvarChamadaNaoAtendida() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await marcarChamadaNaoAtendidaLead(linha.id, { motivo: motivoChamada.trim() });
      onLinhaAtualizada(resultado.linha);
      setFormChamadaAberto(false);
      setMotivoChamada('');
    } catch (error) {
      setErro(error.message || 'Erro ao registrar a chamada nao atendida.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Desfaz a marcacao de chamada nao atendida.
   */
  async function reverterChamada() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await reverterChamadaNaoAtendidaLead(linha.id);
      onLinhaAtualizada(resultado.linha);
    } catch (error) {
      setErro(error.message || 'Erro ao reverter a chamada nao atendida.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Agenda ou limpa a data e hora de retorno do lead sem fechar o card.
   */
  async function salvarRetornoAgendado() {
    setSalvandoRetorno(true);
    setErro('');
    setSucessoRetorno('');
    try {
      const retornoIso = datetimeRetornoParaIso(retornoAgendado);
      if (retornoAgendado && !retornoIso) {
        setErro('Informe uma data e hora de retorno validas.');
        return;
      }

      const resultado = await marcarRetornoLead(linha.id, retornoIso, observacaoRetorno);
      onLinhaAtualizada(resultado.linha);
      setRetornoAgendado(formatarParaDatetimeLocal(resultado.linha.retorno_agendado_em) || '');
      setObservacaoRetorno(resultado.linha.retorno_agendado_observacao || '');
      setSucessoRetorno(retornoIso ? 'Retorno marcado. Ele aparece em Ligações marcadas.' : 'Retorno removido.');
    } catch (error) {
      setErro(error.message || 'Erro ao marcar o retorno.');
    } finally {
      setSalvandoRetorno(false);
    }
  }


  /**
   * Salva futuro cliente com os dados informados.
   */
  function salvarFuturoCliente(event) {
    event.preventDefault();
    setErro('');
    const retornoIso = datetimeRetornoParaIso(retorno);
    if (retorno && !retornoIso) {
      setErro('Informe uma data e hora de retorno validas.');
      return;
    }
    setConfirmacaoDestinoAberta(true);
  }

  async function confirmarDestinoFuturoCliente(destino) {
    setSalvando(true);
    setErro('');
    try {
      const retornoIso = datetimeRetornoParaIso(retorno);
      const resultado = await marcarFuturoClienteLead(linha.id, {
        destino,
        notas,
        retorno: retornoIso,
        razao_social: razaoSocial,
        cnpj,
        contato_nome: contatoNome,
        contato_tipo: contatoTipo,
        operadora_atual_id: Number(operadoraAtualId),
        operadora_interesse_id: operadoraInteresseId ? Number(operadoraInteresseId) : null,
        chips_itens: chipsItensParaEnvio(chipsItens),
        melhor_numero_contato: melhorNumeroContato,
        whatsapp,
        telefone_fixo: telefoneFixo,
        terminal,
        data_ativacao: dataAtivacao
      });
      onFuturoClienteSalvo(resultado.linha);
    } catch (error) {
      setErro(error.message || 'Erro ao registrar futuro cliente.');
      setSalvando(false);
      setConfirmacaoDestinoAberta(false);
    }
  }

  if (etapa === 'venda') {
    return (
      <RegistrarVendaLeadModal
        linha={linha}
        colunas={colunas}
        usuario={usuario}
        onClose={onClose}
        onConfirm={onRegistrarVenda}
      />
    );
  }

  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal adicionar-lead-modal" role="dialog" aria-modal="true" aria-label="Adicionar lead">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Adicionar lead</div>
              <div className="modal-sub">{linha.envio?.nome || 'Lead recebido'}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={salvando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className={`modal-body${etapa === 'opcoes' ? ' adicionar-lead-modal__body--opcoes' : ' adicionar-lead-modal__body--futuro'}`}>
          <section className="adicionar-lead-informacoes" aria-label="Informações da planilha">
            <div className={`adicionar-lead-dados${linha.enriquecimento ? ' adicionar-lead-dados--with-enriquecimento' : ''}`}>
              {camposLead.map(({ label, valor }) => (
                <div key={label} className="adicionar-lead-campo">
                  <span className="adicionar-lead-campo__label">{label}</span>
                  <span className="adicionar-lead-campo__valor">{formatarValorCampoLead(valor) || '-'}</span>
                </div>
              ))}
              {camposLead.length === 0 ? (
                <div className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>Sem dados disponíveis.</div>
              ) : null}
            </div>

            <EnriquecimentoAutomatico enriquecimento={linha.enriquecimento} />
          </section>

          {etapa === 'opcoes' && clienteRecusou && (
            <div className="adicionar-lead-acoes">
              <div className="futuro-cliente-recusa is-saved">
                <strong>Cliente recusou em {formatarDataHora(linha.cliente_recusou_em)}</strong>
                <span>{linha.cliente_recusou_motivo || 'Motivo nao informado.'}</span>
              </div>
              <button type="button" className="btn" onClick={reverterRecusa} disabled={salvando}>
                <I.Refresh size={14} /> {salvando ? 'Revertendo...' : 'Reverter recusa'}
              </button>
              {erro && <div className="alert-error" style={{ marginTop: 8 }}>{erro}</div>}
            </div>
          )}

          {etapa === 'opcoes' && !clienteRecusou && (
            <div className="adicionar-lead-acoes">
              {vendaRegistrada ? (
                <div className="lead-already-qualified-notice">
                  Este futuro cliente ja possui uma venda registrada. Acesse a pagina de Vendas para visualizar a venda.
                </div>
              ) : Boolean(linha.futuro_cliente) && (
                <>
                  <div className="lead-already-qualified-notice">
                    Este contato ja foi qualificado na primeira ligacao. Nesta etapa ele esta disponivel somente para registro de venda.
                  </div>
                  {linha.sondagem && (
                    <div className="futuro-cliente-resumo">
                      <div className="futuro-cliente-resumo__title">Dados preenchidos no futuro cliente</div>
                      <div className="futuro-cliente-resumo__grid">
                        <div><span>Razão social</span><strong>{linha.sondagem.razao_social || '-'}</strong></div>
                        <div><span>CNPJ</span><strong>{linha.sondagem.cnpj || '-'}</strong></div>
                        <div><span>Primeira ligacao</span><strong>{linha.sondagem.usuario?.nome || '-'}</strong></div>
                        <div><span>Data do contato</span><strong>{formatarDataHora(linha.sondagem.respondido_em || linha.futuro_cliente_marcado_em)}</strong></div>
                        <div><span>Pessoa contatada</span><strong>{linha.sondagem.contato_nome || '-'}</strong></div>
                        <div><span>Perfil do contato</span><strong>{String(linha.sondagem.contato_tipo || '-').toUpperCase()}</strong></div>
                        <div><span>Melhor numero para contato</span><strong>{formatarWhatsappInput(linha.sondagem.melhor_numero_contato) || '-'}</strong></div>
                        <div><span>WhatsApp</span><strong>{formatarWhatsappSondagem(linha.sondagem)}</strong></div>
                        <div><span>Operadora atual</span><strong>{linha.sondagem.operadoraAtual?.nome || '-'}</strong></div>
                        <div><span>Operadora de interesse</span><strong>{linha.sondagem.operadoraInteresse?.nome || '-'}</strong></div>
                        <div><span>Telefone fixo</span><strong>{formatarWhatsappInput(linha.sondagem.telefone_fixo) || '-'}</strong></div>
                        <div><span>Terminal</span><strong>{formatarWhatsappInput(linha.sondagem.terminal) || '-'}</strong></div>
                        <div><span>Data da ativacao</span><strong>{formatarData(linha.sondagem.data_ativacao)}</strong></div>
                        <div><span>Chips / preço</span><strong>{formatarChipsSondagem(linha.sondagem)}</strong></div>
                        <div><span>Média mensal</span><strong>{formatarMoedaSondagem(linha.sondagem.valor_mensal_estimado)}</strong></div>
                        <div className="futuro-cliente-resumo__full"><span>Retorno</span><strong>{formatarDataHora(linha.sondagem.retorno_em || linha.futuro_cliente_retorno)}</strong></div>
                        <div className="futuro-cliente-resumo__full"><span>Observações</span><strong>{linha.sondagem.observacoes || linha.futuro_cliente_notas || '-'}</strong></div>
                      </div>
                    </div>
                  )}
                  {podeAvaliarPrimeiraLigacao && <div className="primeira-ligacao-avaliacao">
                    <div>
                      <strong>A primeira ligação foi assertiva?</strong>
                      <span>Avalie o atendimento que originou este futuro cliente.</span>
                    </div>
                    <div className="primeira-ligacao-avaliacao__opcoes" role="group" aria-label="Avaliação da primeira ligação">
                      <label className="primeira-ligacao-avaliacao__opcao is-bom">
                        <input type="checkbox" checked={avaliacaoPrimeiraLigacao === 'bom'} onChange={() => setAvaliacaoPrimeiraLigacao(atual => atual === 'bom' ? '' : 'bom')} disabled={salvandoAvaliacao} />
                        <span>Bom</span>
                      </label>
                      <label className="primeira-ligacao-avaliacao__opcao is-mais_ou_menos">
                        <input type="checkbox" checked={avaliacaoPrimeiraLigacao === 'mais_ou_menos'} onChange={() => setAvaliacaoPrimeiraLigacao(atual => atual === 'mais_ou_menos' ? '' : 'mais_ou_menos')} disabled={salvandoAvaliacao} />
                        <span>Mais ou menos</span>
                      </label>
                      <label className="primeira-ligacao-avaliacao__opcao is-ruim">
                        <input type="checkbox" checked={avaliacaoPrimeiraLigacao === 'ruim'} onChange={() => setAvaliacaoPrimeiraLigacao(atual => atual === 'ruim' ? '' : 'ruim')} disabled={salvandoAvaliacao} />
                        <span>Ruim</span>
                      </label>
                    </div>
                    <button type="button" className="btn" onClick={salvarAvaliacaoPrimeiraLigacao} disabled={salvandoAvaliacao || !avaliacaoPrimeiraLigacao}>
                      {salvandoAvaliacao ? 'Salvando...' : linha.primeira_ligacao_avaliacao ? 'Atualizar avaliacao' : 'Salvar avaliacao'}
                    </button>
                    {sucessoAvaliacao && <div className="alert-success">{sucessoAvaliacao}</div>}
                  </div>}
                  {podeRegistrarFuturo && (vendaRecusada ? (
                    <div className="futuro-cliente-recusa is-saved">
                      <strong>Venda recusada</strong>
                      <span>{linha.venda_recusada_motivo || 'Motivo nao informado.'}</span>
                    </div>
                  ) : (
                    <div className="futuro-cliente-recusa">
                      <label>Venda recusada</label>
                      <textarea rows={3} value={motivoRecusa} onChange={event => setMotivoRecusa(event.target.value)} placeholder="Informe o motivo da recusa" disabled={salvando} />
                      <button type="button" className="btn btn-danger" onClick={salvarVendaRecusada} disabled={salvando || !motivoRecusa.trim()}>
                        Marcar venda recusada
                      </button>
                    </div>
                  ))}
                </>
              )}
              {podeRegistrarVenda && !vendaRegistrada && !vendaRecusada && (
                <button type="button" className="btn btn-primary" onClick={() => setEtapa('venda')}>
                  <I.Chart size={14} /> Registrar venda
                </button>
              )}
              {podeRegistrarFuturo && !linha.futuro_cliente && (
                <button type="button" className="btn" onClick={() => setEtapa('futuro')}>
                  <I.Calendar size={14} /> Registrar futuro cliente
                </button>
              )}

              {podeRegistrarFuturo && !linha.futuro_cliente && !vendaRegistrada && (
                linha.chamada_nao_atendida ? (
                  <div className="futuro-cliente-recusa is-saved">
                    <strong>Chamada não atendida em {formatarDataHora(linha.chamada_nao_atendida_em)}</strong>
                    <span>{linha.chamada_nao_atendida_motivo || 'Sem observação.'}</span>
                    <div className="futuro-cliente-recusa__acoes">
                      {podeBuscarGoogle && (
                        <button type="button" className="btn" onClick={() => setBuscaGoogleAberta(true)} disabled={salvando}>
                          Buscar telefone no Google
                        </button>
                      )}
                      <button type="button" className="btn" onClick={reverterChamada} disabled={salvando}>
                        <I.Refresh size={14} /> {salvando ? 'Desfazendo...' : 'Desfazer'}
                      </button>
                    </div>
                  </div>
                ) : formChamadaAberto ? (
                  <div className="futuro-cliente-recusa">
                    <label>Observação (opcional)</label>
                    <textarea
                      rows={3}
                      value={motivoChamada}
                      onChange={event => setMotivoChamada(event.target.value)}
                      placeholder="Ex.: caixa postal, número não existe, ligou e caiu..."
                      disabled={salvando}
                    />
                    <div className="futuro-cliente-recusa__acoes">
                      <button type="button" className="btn" onClick={() => { setFormChamadaAberto(false); setErro(''); }} disabled={salvando}>
                        Cancelar
                      </button>
                      <button type="button" className="btn btn-primary" onClick={salvarChamadaNaoAtendida} disabled={salvando}>
                        {salvando ? 'Salvando...' : 'Confirmar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn" onClick={() => { setFormChamadaAberto(true); setSucessoRetorno(''); }} disabled={salvando}>
                    <I.Bell size={14} /> Chamada não atendida
                  </button>
                )
              )}

              {podeRegistrarFuturo && !linha.futuro_cliente && !vendaRegistrada && (
                formRecusaAberto ? (
                  <div className="futuro-cliente-recusa">
                    <label>Motivo da recusa (opcional)</label>
                    <textarea
                      rows={3}
                      value={motivoClienteRecusou}
                      onChange={event => setMotivoClienteRecusou(event.target.value)}
                      placeholder="Ex.: já tem contrato, não tem interesse..."
                      disabled={salvando}
                    />
                    <div className="futuro-cliente-recusa__acoes">
                      <button type="button" className="btn" onClick={() => { setFormRecusaAberto(false); setErro(''); }} disabled={salvando}>
                        Cancelar
                      </button>
                      <button type="button" className="btn btn-danger" onClick={salvarClienteRecusou} disabled={salvando}>
                        {salvando ? 'Salvando...' : 'Confirmar recusa'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => { setFormRecusaAberto(true); setSucessoRetorno(''); }} disabled={salvando}>
                    <I.Close size={14} /> Cliente recusou
                  </button>
                )
              )}

              {podeRegistrarFuturo && !vendaRegistrada && !vendaRecusada && (
                <div className="lead-retorno">
                  <div className="lead-retorno__head">
                    <span className="lead-retorno__icone"><I.Bell size={15} /></span>
                    <div className="lead-retorno__titulo">
                      <strong>Marcar retorno</strong>
                      <span>Agende quando falar com este lead novamente</span>
                    </div>
                  </div>

                  <label className="lead-retorno__observacao" htmlFor={`observacao-retorno-lead-${linha.id}`}>
                    <span>Observação para o retorno</span>
                    <textarea
                      id={`observacao-retorno-lead-${linha.id}`}
                      value={observacaoRetorno}
                      onChange={event => { setObservacaoRetorno(event.target.value); setSucessoRetorno(''); }}
                      placeholder="Ex.: ligar após as 14h e falar com o responsável financeiro"
                      maxLength={2000}
                      rows={3}
                      disabled={salvando || salvandoRetorno}
                    />
                  </label>

                  <div className="lead-retorno__linha">
                    <label className="lead-retorno__campo" htmlFor={`retorno-lead-${linha.id}`}>
                      <I.Calendar size={14} />
                      <input
                        id={`retorno-lead-${linha.id}`}
                        type="datetime-local"
                        value={retornoAgendado}
                        onChange={event => { setRetornoAgendado(event.target.value); setSucessoRetorno(''); }}
                        disabled={salvando || salvandoRetorno}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary lead-retorno__salvar"
                      onClick={salvarRetornoAgendado}
                      disabled={salvando || salvandoRetorno || !retornoAgendado}
                    >
                      {salvandoRetorno ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>

                  {sucessoRetorno ? (
                    <span className="lead-retorno__sucesso"><I.Check size={13} /> {sucessoRetorno}</span>
                  ) : linha.retorno_agendado_em && (
                    <span className="lead-retorno__atual">
                      <I.Check size={13} /> Retorno marcado para <strong>{formatarDataHora(linha.retorno_agendado_em)}</strong>
                    </span>
                  )}
                </div>
              )}

              {erro && <div className="alert-error" style={{ marginTop: 8 }}>{erro}</div>}
            </div>
          )}

          {etapa === 'futuro' && (
            <form className="futuro-cliente-form" aria-label="Registrar futuro cliente" onSubmit={salvarFuturoCliente}>
              <div className="futuro-cliente-form__grid">
                <div className="form-field">
                  <label>CNPJ</label>
                  <input value={cnpj} onChange={event => setCnpj(formatarCnpj(event.target.value))} maxLength="18" disabled={salvando} />
                </div>
                <div className="form-field">
                  <label>Razão social</label>
                  <input value={razaoSocial} onChange={event => setRazaoSocial(event.target.value)} maxLength="240" disabled={salvando} />
                </div>
              </div>
              <div className="form-field">
                <label>Nome de quem falou</label>
                <input value={contatoNome} onChange={event => setContatoNome(event.target.value)} required disabled={salvando} />
              </div>
              <div className="form-field">
                <label>Perfil do contato</label>
                <select value={contatoTipo} onChange={event => setContatoTipo(event.target.value)} required disabled={salvando}>
                  <option value="">Selecione</option>
                  <option value="adm">ADM</option>
                  <option value="rl">RL</option>
                </select>
              </div>
              <div className="form-field">
                <label>Operadora atual</label>
                <select value={operadoraAtualId} onChange={event => setOperadoraAtualId(event.target.value)} required disabled={salvando}>
                  <option value="">Selecione</option>
                  {operadoras.map(operadora => <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label>Operadora de interesse</label>
                <select value={operadoraInteresseId} onChange={event => setOperadoraInteresseId(event.target.value)} disabled={salvando}>
                  <option value="">Selecione</option>
                  {operadoras.map(operadora => <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>)}
                </select>
              </div>
              <ChipsItensSondagem itens={chipsItens} onChange={setChipsItens} disabled={salvando} />
              <div className="futuro-cliente-estimativa">
                <span>Media mensal estimada</span>
                <strong>{valorMensalEstimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
              </div>
              <div className="form-field">
                <label>Melhor número para contato (pode ser o mesmo do whatsapp)</label>
                <input type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={melhorNumeroContato} onChange={event => setMelhorNumeroContato(formatarWhatsappInput(event.target.value))} required disabled={salvando} />
              </div>
              <div className="form-field">
                <label>WhatsApp com DDD</label>
                <input type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={whatsapp} onChange={event => setWhatsapp(formatarWhatsappInput(event.target.value))} required disabled={salvando} />
              </div>
              <div className="form-field">
                <label>Fixo com DDD</label>
                <input type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 3333-4444" value={telefoneFixo} onChange={event => setTelefoneFixo(formatarWhatsappInput(event.target.value))} disabled={salvando} />
              </div>
              <div className="form-field">
                <label>Terminal</label>
                <input type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={terminal} onChange={event => setTerminal(formatarWhatsappInput(event.target.value))} disabled={salvando} />
              </div>
            <div className="form-field">
              <label>Data da ativacao</label>
              <input type="date" value={dataAtivacao} onChange={event => setDataAtivacao(event.target.value)} disabled={salvando} />
            </div>
              <div className="form-field futuro-cliente-notas">
                <div className="futuro-cliente-notas__head">
                  <label htmlFor="futuro-cliente-notas">Notas sobre este cliente</label>
                  <span className="futuro-cliente-notas__opcional">Opcional</span>
                </div>
                <div className="futuro-cliente-notas__box">
                  <textarea
                    id="futuro-cliente-notas"
                    className="futuro-cliente-notas__input"
                    rows={4}
                    maxLength={NOTAS_MAX_LENGTH}
                    value={notas}
                    onChange={event => setNotas(event.target.value)}
                    placeholder="Observações, interesses, histórico..."
                    disabled={salvando}
                  />
                  <span className="futuro-cliente-notas__contador">{notas.length}/{NOTAS_MAX_LENGTH}</span>
                </div>
              </div>
              <div className="form-field">
                <label>Data de retorno</label>
                <input
                  type="datetime-local"
                  value={retorno}
                  onChange={event => setRetorno(event.target.value)}
                  disabled={salvando}
                />
              </div>

              {erro && <div className="alert-error" style={{ marginTop: 8 }}>{erro}</div>}

              <div className="futuro-cliente-form__actions">
                <button type="button" className="btn" onClick={() => { setEtapa('opcoes'); setErro(''); }} disabled={salvando}>
                  Voltar
                </button>
                <button type="submit" className="btn btn-primary" disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar futuro cliente'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      {confirmacaoDestinoAberta && (
        <EscolherDestinoFuturoClienteModal
          processando={salvando}
          onClose={() => setConfirmacaoDestinoAberta(false)}
          onChoose={confirmarDestinoFuturoCliente}
        />
      )}
      {buscaGoogleAberta && <BuscarTelefoneGoogleModal linha={linha} onClose={() => setBuscaGoogleAberta(false)} />}
    </div>
  );
}

// ─── Aba: leads recebidos ─────────────────────────────────────────────────────

/**
 * Renderiza leads recebidos view com os dados informados.
 */
function LeadsRecebidosView({ agora }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [envios, setEnvios] = useState([]);
  const [buscaMailing, setBuscaMailing] = useState('');
  const [buscaMailingDebounced, setBuscaMailingDebounced] = useState('');
  const [paginaMailing, setPaginaMailing] = useState(1);
  const [totalMailings, setTotalMailings] = useState(0);
  const [selecionados, setSelecionados] = useState([]);
  const [selecionadosDados, setSelecionadosDados] = useState({});
  const [linhas, setLinhas] = useState([]);
  const [totalLinhas, setTotalLinhas] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const buscaDeferred = useDeferredValue(busca);
  const [carregandoEnvios, setCarregandoEnvios] = useState(true);
  const [consultaLinhasConcluida, setConsultaLinhasConcluida] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [modalAtualizacao, setModalAtualizacao] = useState(null);
  const [salvandoAtualizacao, setSalvandoAtualizacao] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState('');
  const [modalAdicionar, setModalAdicionar] = useState(null);
  const [modalAceite, setModalAceite] = useState(null);
  const notificacaoAbertaRef = useRef(null);
  const usuario = useMemo(() => getUsuarioLocal(), []);
  const podeRegistrarVenda = temPermissao(usuario, 'vendas_criar');
  const podeRegistrarFuturo = temPermissao(usuario, 'futuros_clientes_registrar');
  const linhaNotificacaoId = useMemo(() => {
    const id = Number(searchParams.get('linha_id'));
    return Number.isInteger(id) && id > 0 ? id : null;
  }, [searchParams]);
  const notificacaoId = getNotificacaoIdParam(searchParams);
  const buscaMailingAtiva = Boolean(buscaMailingDebounced.trim());
  const consultaLinhasAtiva = buscaMailingAtiva || selecionados.length > 0 || Boolean(linhaNotificacaoId);
  const chaveConsultaLinhas = useMemo(() => JSON.stringify({
    selecionados,
    pagina,
    busca: buscaDeferred,
    buscaGlobal: buscaMailingDebounced,
    status: filtroStatus,
    linhaId: linhaNotificacaoId
  }), [selecionados, pagina, buscaDeferred, buscaMailingDebounced, filtroStatus, linhaNotificacaoId]);
  const carregando = carregandoEnvios
    || (consultaLinhasAtiva && consultaLinhasConcluida !== chaveConsultaLinhas);

  function aplicarEnviosAtualizados(data) {
    const enviosAtualizados = data || [];
    setEnvios(enviosAtualizados);
  }

  function alterarBuscaMailing(valor) {
    setBuscaMailing(valor);
    if (!String(valor || '').trim() && selecionados.length === 0 && !linhaNotificacaoId) {
      setLinhas([]);
      setTotalLinhas(0);
      setConsultaLinhasConcluida('');
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBuscaMailingDebounced(buscaMailing);
      setPaginaMailing(1);
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [buscaMailing]);

  useEffect(() => {
    let cancelado = false;
    async function carregarEnvios(exibirCarregando = false) {
      if (exibirCarregando) setCarregandoEnvios(true);
      try {
        const resultado = await listarMeusMailings({ busca: buscaMailingDebounced, page: paginaMailing, page_size: 24 });
        if (!cancelado) {
          aplicarEnviosAtualizados(resultado.data || []);
          setTotalMailings(Number(resultado.total || 0));
        }
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar leads recebidos.');
      } finally {
        if (!cancelado && exibirCarregando) setCarregandoEnvios(false);
      }
    }

    carregarEnvios(true);
    const atualizarMailing = () => carregarEnvios();
    window.addEventListener('pos-venda:mailing-atualizar', atualizarMailing);
    return () => {
      cancelado = true;
      window.removeEventListener('pos-venda:mailing-atualizar', atualizarMailing);
    };
  }, [buscaMailingDebounced, paginaMailing]);

  useEffect(() => {
    if (!consultaLinhasAtiva) return;

    let cancelado = false;
    listarMinhasLeadLinhas(montarFiltrosLinhasMailingRecebido({
      selecionados,
      pagina,
      busca: buscaDeferred,
      buscaGlobal: buscaMailingDebounced,
      status: filtroStatus,
      linhaId: linhaNotificacaoId
    }))
      .then(data => {
        if (!cancelado) {
          const linhasRecebidas = data.data || [];
          const totalRecebido = data.total || 0;
          setLinhas(linhasRecebidas);
          setTotalLinhas(totalRecebido);
          if (linhaNotificacaoId && notificacaoAbertaRef.current !== linhaNotificacaoId) {
            notificacaoAbertaRef.current = linhaNotificacaoId;
            const linha = linhasRecebidas.find(item => Number(item.id) === linhaNotificacaoId);
            if (linha) {
              setErro('');
              setModalAdicionar(linha);
              if (notificacaoId) {
                void confirmarAberturaNotificacao(notificacaoId).catch(error => {
                  console.error('Erro ao confirmar abertura da notificacao:', error);
                });
              }
            } else if (totalRecebido === 0) {
              if (notificacaoId) falharAberturaNotificacao(notificacaoId);
              setErro('O lead desta notificacao nao esta mais disponivel.');
            }
          }
        }
      })
      .catch(error => {
        if (notificacaoId) falharAberturaNotificacao(notificacaoId);
        setErro(error.message || 'Erro ao carregar leads recebidos.');
      })
      .finally(() => {
        if (!cancelado) setConsultaLinhasConcluida(chaveConsultaLinhas);
      });
    return () => { cancelado = true; };
  }, [selecionados, pagina, buscaDeferred, buscaMailingDebounced, buscaMailingAtiva, consultaLinhasAtiva, filtroStatus, linhaNotificacaoId, chaveConsultaLinhas, notificacaoId]);
  useEffect(() => {
    if (!erro) return undefined;
    const timer = setTimeout(() => setErro(''), 6000);
    return () => clearTimeout(timer);
  }, [erro]);

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  const enviosSelecionados = useMemo(() => selecionados.map(id => selecionadosDados[id]).filter(Boolean), [selecionados, selecionadosDados]);

  const colunas = useMemo(() => {
    const mapa = new Map();

    if (!buscaMailingAtiva) {
      enviosSelecionados.forEach(envio => {
        (envio.colunas_visiveis || []).forEach(coluna => {
          if (getLabelColunaLeadRecebido(coluna).endsWith(' (atualizado)')) return;
          adicionarColunaMapeadaLead(mapa, coluna, { envio, linhas });
        });
      });
    }

    if (mapa.size === 0) {
      linhas.forEach(linha => {
        Object.keys(linha.dados_json || {})
          .filter(coluna => !coluna.endsWith(' (atualizado)'))
          .forEach(coluna => adicionarColunaMapeadaLead(mapa, coluna, { linhas: [linha], envio: linha.envio }));
      });
    }

    return finalizarColunasMapeadasLead(mapa).flatMap(coluna => (
      linhaTemColunaAtualizada(linhas, coluna)
        ? [coluna, criarColunaAtualizadaLeadRecebido(coluna)]
        : [coluna]
    ));
  }, [enviosSelecionados, linhas, buscaMailingAtiva]);

  const totalPaginas = Math.max(1, Math.ceil(totalLinhas / 200));
  const possuiIndicacaoPendente = linhas.some(linha => linha.detalhes_bloqueados);
  const exibirColunaAcoes = podeRegistrarVenda || podeRegistrarFuturo || possuiIndicacaoPendente;
  const totalColunasTabela = colunas.length + 2 + (exibirColunaAcoes ? 1 : 0);
  const totalFuturosClientesAtivos = linhas.filter(isFuturoClienteAtivo).length;
  const totalFuturosClientesVendidos = linhas.filter(isFuturoClienteVendido).length;

  /**
   * Alterna envio no estado atual.
   */
  function toggleEnvio(id) {
    const envio = envios.find(item => Number(item.id) === Number(id));
    const proximos = selecionados.includes(id)
      ? selecionados.filter(item => item !== id)
      : [...selecionados, id];
    setSelecionados(proximos);
    if (envio) setSelecionadosDados(prev => ({ ...prev, [id]: envio }));
    if (proximos.length === 0) {
      setLinhas([]);
      setTotalLinhas(0);
    }
    setPagina(1);
  }

  /**
   * Abre atualizacao e prepara o estado necessario.
   */
  function abrirAtualizacao(linha, coluna) {
    const nomeColuna = getNomeColunaLeadRecebido(linha, coluna);
    if (!nomeColuna) return;

    setErroAtualizacao('');
    setModalAtualizacao({
      linhaId: linha.id,
      coluna: nomeColuna,
      label: getLabelColunaLeadRecebido(coluna),
      valorOriginal: getValorLeadRecebido(linha, coluna),
      valorAtualizado: linha.dados_json?.[`${nomeColuna} (atualizado)`] || ''
    });
  }

  /**
   * Salva atualizacao com os dados informados.
   */
  async function salvarAtualizacao(valor) {
    if (!modalAtualizacao || !valor.trim()) {
      setErroAtualizacao('Informe a informação atualizada.');
      return;
    }

    setSalvandoAtualizacao(true);
    setErroAtualizacao('');
    setErro('');
    setSucesso('');

    try {
      const resultado = await atualizarCampoLeadRecebido(modalAtualizacao.linhaId, {
        coluna: modalAtualizacao.coluna,
        valor
      });

      setLinhas(prev => prev.map(linha => (
        linha.id === resultado.linha?.id ? resultado.linha : linha
      )));
      setModalAtualizacao(null);
      setSucesso('Informação atualizada salva.');
    } catch (error) {
      setErroAtualizacao(error.message || 'Erro ao atualizar lead recebido.');
    } finally {
      setSalvandoAtualizacao(false);
    }
  }

  /**
   * Executa a acao de continuar registro venda mantendo o estado da tela consistente.
   */
  function continuarRegistroVenda(vendaPreenchida) {
    navigate('/vendas?nova=1', {
      state: {
        vendaPreenchida,
        clientePreenchido: montarClientePreenchido(vendaPreenchida),
        origemLead: {
          linha_id: modalAdicionar?.id,
          envio: modalAdicionar?.envio?.nome || ''
        }
      }
    });
  }

  /**
   * Recarrega apenas as metricas dos envios (barra de progresso do card),
   * sem acionar o spinner geral, para refletir recusas/futuros clientes.
   */
  async function recarregarEnvios() {
    try {
      const resultado = await listarMeusMailings({ busca: buscaMailingDebounced, page: paginaMailing, page_size: 24 });
      aplicarEnviosAtualizados(resultado.data || []);
      setTotalMailings(Number(resultado.total || 0));
    } catch (error) {
      setErro(error.message || 'Erro ao carregar leads recebidos.');
    }
  }

  /**
   * Trata o evento de futuro cliente salvo.
   */
  function fecharModalAdicionar() {
    notificacaoAbertaRef.current = linhaNotificacaoId;
    setModalAdicionar(null);
    if (linhaNotificacaoId) setSearchParams({ aba: 'leads' }, { replace: true });
  }

  function handleFuturoClienteSalvo(linhaAtualizada, mensagem = 'Lead marcado como futuro cliente com sucesso.') {
    setLinhas(prev => prev.map(l => l.id === linhaAtualizada.id ? linhaAtualizada : l));
    fecharModalAdicionar();
    setSucesso(mensagem);
    recarregarEnvios();
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
  }

  function handleIndicacaoAceita(linhaAtualizada) {
    setLinhas(prev => prev.map(linha => (
      Number(linha.id) === Number(linhaAtualizada.id) ? linhaAtualizada : linha
    )));
    setModalAceite(null);
    setSucesso('Indicacao aceita. Os dados foram liberados e o prazo de 30 minutos foi iniciado.');
    recarregarEnvios();
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
  }

  function handleIndicacaoRecusada() {
    const linhaId = Number(modalAceite?.id);
    setLinhas(prev => prev.filter(linha => Number(linha.id) !== linhaId));
    setTotalLinhas(prev => Math.max(0, prev - 1));
    setModalAceite(null);
    setSucesso('Indicacao recusada e devolvida para novo encaminhamento.');
    recarregarEnvios();
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
  }

  /**
   * Atualiza a linha na tabela e no card aberto, sem fechar o modal.
   */
  function handleLinhaAtualizada(linhaAtualizada) {
    setLinhas(prev => prev.map(l => l.id === linhaAtualizada.id ? linhaAtualizada : l));
    setModalAdicionar(atual => (atual && atual.id === linhaAtualizada.id ? linhaAtualizada : atual));
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
  }

  return (
    <div className="clientes-leads-view">
      {modalAceite && (
        <FuturoClienteAceiteModal
          linha={modalAceite}
          onClose={() => setModalAceite(null)}
          onAceito={handleIndicacaoAceita}
          onRecusado={handleIndicacaoRecusada}
        />
      )}

      {modalAtualizacao && (
        <LeadAtualizacaoModal
          key={`${modalAtualizacao.linhaId}:${modalAtualizacao.coluna}`}
          dados={modalAtualizacao}
          salvando={salvandoAtualizacao}
          erro={erroAtualizacao}
          onClose={() => {
            if (salvandoAtualizacao) return;
            setModalAtualizacao(null);
            setErroAtualizacao('');
          }}
          onSave={salvarAtualizacao}
        />
      )}

      {modalAdicionar && (
        <AdicionarLeadModal
          linha={modalAdicionar}
          colunas={colunas}
          usuario={usuario}
          onClose={fecharModalAdicionar}
          onRegistrarVenda={continuarRegistroVenda}
          onFuturoClienteSalvo={handleFuturoClienteSalvo}
          onLinhaAtualizada={handleLinhaAtualizada}
        />
      )}

      <div className="clientes-leads-strip">
        <div className="clientes-leads-strip__header">
          <div className="clientes-leads-strip__title">Mailings recebidos</div>
          <label className="clientes-search clientes-mailing-search">
            <I.Search size={14} />
            <input
              value={buscaMailing}
              onChange={event => alterarBuscaMailing(event.target.value)}
              placeholder="Procurar por mailing, razão social ou CNPJ"
            />
          </label>
        </div>
        <div className="clientes-leads-docs">
          {envios.map(envio => {
            const progresso = calcularProgresso(envio.total_linhas, envio.total_trabalhados);
            const recusados = Number(envio.total_recusados || 0);
            const naoAtendidos = Number(envio.total_nao_atendidos || 0);
            const futuros = Number(envio.total_futuros || 0);
            const percentualCategoria = quantidade => progresso.total
              ? Math.round((quantidade / progresso.total) * 100)
              : 0;
            return (
              <button
                key={envio.id}
                type="button"
                className={`clientes-leads-doc ${selecionados.includes(envio.id) ? 'active' : ''}`}
                onClick={() => toggleEnvio(envio.id)}
              >
                <div className="clientes-leads-preview">
                  <span></span><span></span><span></span><span></span>
                </div>
                <strong title={envio.nome}>{envio.nome}</strong>
                <small>{formatDateValue(envio.created_at, undefined, '-')} - {envio.total_linhas} {envio.total_linhas === 1 ? 'cliente' : 'clientes'}</small>
                <DocProgresso
                  {...progresso}
                  recusados={recusados}
                  futuros={futuros}
                  rotulo="trabalhados"
                  rotuloCompleto="Tudo trabalhado"
                />
                <span className="clientes-leads-doc__tooltip" role="status">
                  <span>N&atilde;o atendidos: <b>{naoAtendidos} - {percentualCategoria(naoAtendidos)}%</b></span>
                  <span>Qualificados: <b>{futuros} - {percentualCategoria(futuros)}%</b></span>
                  <span>Recusados: <b>{recusados} - {percentualCategoria(recusados)}%</b></span>
                </span>
              </button>
            );
          })}
          {!carregando && envios.length === 0 && (
            <div className="lead-doc-empty">Nenhum envio recebido.</div>
          )}
        </div>
        {totalMailings > 24 && <div className="lead-pagination clientes-mailing-pagination">
          <button className="btn btn-sm" type="button" disabled={paginaMailing <= 1} onClick={() => setPaginaMailing(value => value - 1)}>Anteriores</button>
          <span>Página {paginaMailing} de {Math.max(1, Math.ceil(totalMailings / 24))}</span>
          <button className="btn btn-sm" type="button" disabled={paginaMailing * 24 >= totalMailings} onClick={() => setPaginaMailing(value => value + 1)}>Próximos</button>
        </div>}
        {enviosSelecionados.length > 0 && <div className="clientes-mailing-chips" aria-label="Mailings selecionados">
          {enviosSelecionados.map(envio => <button key={envio.id} type="button" onClick={() => toggleEnvio(envio.id)} title="Remover da busca">{envio.nome}<I.Close size={12} /></button>)}
        </div>}
      </div>

      <div className="clientes-leads-toolbar">
        <div className="clientes-toolbar__meta">
          <span>{totalLinhas} registro(s) recebidos</span>
          <span className="clientes-toolbar__meta-secondary">
            {totalFuturosClientesAtivos} futuro(s) cliente(s)
          </span>
          {totalFuturosClientesVendidos > 0 && (
            <span className="clientes-toolbar__meta-sold">
              {totalFuturosClientesVendidos} com venda
            </span>
          )}
        </div>
        <div className="clientes-leads-actions">
          <form className="clientes-search" onSubmit={event => event.preventDefault()}>
            <I.Search size={14} />
            <input value={busca} onChange={event => { setBusca(event.target.value); setPagina(1); }} placeholder="Buscar no mailing recebido" />
          </form>
          <select
            className="clientes-status-filter"
            value={filtroStatus}
            onChange={event => { setFiltroStatus(event.target.value); setPagina(1); }}
            aria-label="Filtrar status do mailing selecionado"
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendentes</option>
            <option value="futuro_cliente">Futuros clientes</option>
            <option value="cliente_recusou">Cancelados</option>
            <option value="retorno_agendado">Agendados</option>
            <option value="chamada_nao_atendida">Não atendidos</option>
            <option value="venda_futuro_cliente">Venda registrada por futuro cliente</option>
            <option value="venda_antiga_registrada">Venda antiga registrada</option>
            <option value="venda_recusada">Vendas recusadas</option>
            <option value="lixeira">Na lixeira</option>
          </select>
        </div>
      </div>

      {sucesso && <div className="alert-success alert-timed alert-timed--success">{sucesso}</div>}
      {erro && <div className="alert-error alert-timed alert-timed--error">{erro}</div>}

      <div className={`list-table clientes-leads-table ${exibirColunaAcoes ? 'clientes-leads-table--acoes' : ''}`} style={{ margin: 0 }}>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Envio</th>
                <th>Status</th>
                {exibirColunaAcoes && <th>Adicionar</th>}
                {colunas.map(coluna => <th key={getColunaKeyLeadRecebido(coluna)}>{getLabelColunaLeadRecebido(coluna)}</th>)}
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={totalColunasTabela} className="muted" style={{ textAlign: 'center', padding: 40 }}>Carregando mailing...</td></tr>
              ) : linhas.length === 0 ? (
                <tr><td colSpan={totalColunasTabela} className="muted" style={{ textAlign: 'center', padding: 40 }}>{buscaMailingAtiva ? 'Nenhum cliente encontrado para esta busca.' : selecionados.length ? 'Nenhum cliente disponivel neste mailing.' : 'Selecione uma planilha recebida.'}</td></tr>
              ) : (
                linhas.map(linha => (
                  <tr key={linha.id} className={getClasseLinhaLead(linha)}>
                    <td data-label="Envio" className="m-primary">
                      <span className="tag" title={linha.envio?.nome || ''}>{linha.envio?.nome || '-'}</span>
                      <details className="mobile-row-drawer">
                        <summary>Ver dados do lead</summary>
                        <dl>
                          {colunas.map(coluna => {
                            const valor = getValorLeadRecebido(linha, coluna);
                            return (
                              <Fragment key={getColunaKeyLeadRecebido(coluna)}>
                                <dt>{getLabelColunaLeadRecebido(coluna)}</dt>
                                <dd>{valor || '-'}</dd>
                              </Fragment>
                            );
                          })}
                        </dl>
                      </details>
                    </td>
                    <td data-label="Status" className="m-meta"><LeadStatusMailing linha={linha} agora={agora} /></td>
                    {exibirColunaAcoes && (
                      <td data-label="Adicionar" className="m-actions">
                        <button
                          type="button"
                          className={`lead-register-sale-btn ${isFuturoClienteNaLixeira(linha) ? 'is-disabled' : ''}`}
                          disabled={isFuturoClienteNaLixeira(linha)}
                          onClick={() => (linha.detalhes_bloqueados ? setModalAceite(linha) : setModalAdicionar(linha))}
                        >
                          {linha.detalhes_bloqueados
                            ? 'Aceitar indicacao'
                            : isFuturoClienteNaLixeira(linha)
                              ? 'Na lixeira'
                              : isFuturoClienteAtivo(linha)
                                ? 'Ver futuro cliente'
                                : 'Adicionar'}
                        </button>
                      </td>
                    )}
                    {colunas.map(coluna => {
                      const valor = getValorLeadRecebido(linha, coluna);
                      const key = getColunaKeyLeadRecebido(coluna);
                      const podeAtualizar = !coluna.atualizada && Boolean(getNomeColunaLeadRecebido(linha, coluna));

                      return (
                        <td key={key} data-label={getLabelColunaLeadRecebido(coluna)} data-mobile-hidden="true" className={coluna.atualizada ? 'lead-updated-cell' : ''}>
                          {coluna.atualizada || !podeAtualizar ? (
                            valor || '-'
                          ) : (
                            <button
                              type="button"
                              className="lead-cell-button"
                              onClick={() => abrirAtualizacao(linha, coluna)}
                              title="Atualizar informação"
                            >
                              {valor || '-'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lead-pagination">
        <button className="btn" type="button" disabled={pagina <= 1} onClick={() => setPagina(prev => Math.max(1, prev - 1))}>Anterior</button>
        <span>Página {pagina} de {totalPaginas}</span>
        <button className="btn" type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina(prev => Math.min(totalPaginas, prev + 1))}>Próxima</button>
      </div>
    </div>
  );
}

// ─── Modal: detalhe do futuro cliente ────────────────────────────────────────

/**
 * Exibe o resultado da avaliação da primeira ligação.
 */
export function AvaliacaoPrimeiraLigacao({ linha }) {
  return (
    <div className="primeira-ligacao-avaliacao primeira-ligacao-avaliacao--somente-leitura">
      <div>
        <strong>Avaliação da primeira ligação</strong>
        <span>Resultado informado pela consultora que recebeu o futuro cliente.</span>
      </div>
      <strong>{({
        bom: 'Bom',
        mais_ou_menos: 'Mais ou menos',
        ruim: 'Ruim'
      })[linha.primeira_ligacao_avaliacao] || 'Ainda não avaliada'}</strong>
      {linha.primeira_ligacao_avaliada_em && (
        <small>Registrada em {formatarDataHora(linha.primeira_ligacao_avaliada_em)}</small>
      )}
    </div>
  );
}

/** Permite ao gerente escolher e confirmar uma venda existente do mesmo CNPJ. */
export function VincularVendaFuturoClienteModal({ linha, onClose, onAtualizado }) {
  const dialogRef = useDialogAcessivel(onClose);
  const buscaSequenciaRef = useRef(0);
  const [dados, setDados] = useState(null);
  const [cnpjInput, setCnpjInput] = useState('');
  const [cnpjPesquisado, setCnpjPesquisado] = useState('');
  const [buscaPendente, setBuscaPendente] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [confirmacao, setConfirmacao] = useState(null);

  useEffect(() => {
    let ativo = true;
    listarVendasCandidatasLead(linha.id)
      .then(resultado => {
        if (ativo) {
          setDados(resultado);
          setCnpjInput(formatarCnpj(resultado.cnpj));
          setCnpjPesquisado(resultado.cnpj);
          setBuscaPendente(false);
        }
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao localizar vendas do CNPJ.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
      buscaSequenciaRef.current += 1;
    };
  }, [linha.id]);

  function alterarCnpj(event) {
    const valor = formatarCnpj(event.target.value);
    const digitos = valor.replace(/\D/g, '');
    setCnpjInput(valor);
    setBuscaPendente(digitos !== cnpjPesquisado);
    setConfirmacao(null);
    setErro('');
  }

  async function buscarOutroCnpj(event) {
    event.preventDefault();
    const cnpj = cnpjInput.replace(/\D/g, '');
    if (cnpj.length !== 14) {
      setErro('Informe um CNPJ com 14 dígitos.');
      return;
    }

    const sequencia = buscaSequenciaRef.current + 1;
    buscaSequenciaRef.current = sequencia;
    setCarregando(true);
    setErro('');
    setConfirmacao(null);
    try {
      const resultado = await listarVendasCandidatasLead(linha.id, cnpj);
      if (buscaSequenciaRef.current !== sequencia) return;
      setDados(resultado);
      setCnpjInput(formatarCnpj(resultado.cnpj));
      setCnpjPesquisado(resultado.cnpj);
      setBuscaPendente(false);
    } catch (error) {
      if (buscaSequenciaRef.current !== sequencia) return;
      setErro(error.message || 'Erro ao localizar vendas do CNPJ.');
    } finally {
      if (buscaSequenciaRef.current === sequencia) setCarregando(false);
    }
  }

  async function confirmarAcao() {
    setProcessando(true);
    setErro('');
    try {
      const resultado = confirmacao.tipo === 'desvincular'
        ? await adminDesvincularVendaLead(linha.id)
        : await adminVincularVendaLead(linha.id, confirmacao.venda.id, confirmacao.cnpj);
      onAtualizado(resultado.linha);
    } catch (error) {
      setErro(error.message || 'Nao foi possivel atualizar o vinculo.');
      setConfirmacao(null);
      setProcessando(false);
    }
  }

  const vendaConfirmada = confirmacao?.venda || dados?.vinculo_atual?.venda;
  const cnpjOriginal = dados?.cnpj_original || (dados?.cnpj_origem !== 'informado' ? dados?.cnpj : null);
  const origemOriginal = dados?.cnpj_original_origem || (dados?.cnpj_origem !== 'informado' ? dados?.cnpj_origem : null);
  const cnpjDiferente = Boolean(cnpjOriginal && cnpjPesquisado && cnpjOriginal !== cnpjPesquisado);
  const confirmacaoCnpjDiferente = Boolean(cnpjOriginal && confirmacao?.cnpj && cnpjOriginal !== confirmacao.cnpj);
  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal vincular-venda-modal" role="dialog" aria-modal="true" aria-label="Vincular venda">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Gerenciar vínculo de venda</div>
              <div className="modal-sub">Futuro cliente #{linha.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={processando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <form className="vincular-venda-resumo" onSubmit={buscarOutroCnpj}>
            <label htmlFor="vincular-venda-cnpj">CNPJ para buscar vendas</label>
            <div className="vincular-venda-resumo__busca">
              <input
                id="vincular-venda-cnpj"
                inputMode="numeric"
                maxLength="18"
                placeholder="00.000.000/0000-00"
                value={cnpjInput}
                onChange={alterarCnpj}
                disabled={carregando || processando}
              />
              <button type="submit" className="btn btn-primary" disabled={carregando || processando || cnpjInput.replace(/\D/g, '').length !== 14 || !buscaPendente}>
                {carregando ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
            {cnpjOriginal && (
              <small>
                CNPJ original: {formatarCnpj(cnpjOriginal)} · Origem: {origemOriginal === 'sondagem' ? 'sondagem' : 'mailing'}
              </small>
            )}
          </form>

          {carregando && <div className="vincular-venda-estado">Buscando vendas do mesmo CNPJ...</div>}
          {erro && <div className="alert-error">{erro}</div>}
          {!carregando && buscaPendente && !erro && (
            <div className="vincular-venda-estado">Clique em Buscar para atualizar as vendas deste CNPJ.</div>
          )}

          {!carregando && dados && !buscaPendente && (
            <>
              {cnpjDiferente && (
                <div className="vincular-venda-aviso" role="status">
                  <I.AlertTriangle size={16} />
                  Este CNPJ será usado somente para localizar e vincular a venda. O CNPJ original do futuro cliente não será alterado.
                </div>
              )}

              {dados.vinculo_atual && (
                <div className="vincular-venda-atual">
                  <div>
                    <strong>Venda vinculada: #{dados.vinculo_atual.venda.id}</strong>
                    <span>{dados.vinculo_atual.venda.razao_social || 'Razão social não informada'}</span>
                  </div>
                  {dados.vinculo_atual.pode_desvincular ? (
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmacao({ tipo: 'desvincular' })}>
                      Desvincular venda
                    </button>
                  ) : (
                    <small>Este vínculo veio do cadastro direto da venda e não pode ser desfeito por este fluxo.</small>
                  )}
                </div>
              )}

              {!dados.vendas.length ? (
                <div className="vincular-venda-estado">Nenhuma venda não excluída foi encontrada para este CNPJ.</div>
              ) : (
                <div className="vincular-venda-lista">
                  {dados.vendas.map(venda => (
                    <article className={`vincular-venda-item${venda.disponivel ? '' : ' is-blocked'}`} key={venda.id}>
                      <div className="vincular-venda-item__topo">
                        <div>
                          <strong>Venda #{venda.id}</strong>
                          <span>{venda.razao_social || 'Razão social não informada'}</span>
                        </div>
                        <strong>{Number(venda.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                      </div>
                      <div className="vincular-venda-item__dados">
                        <span>Data: {formatarData(venda.data_venda)}</span>
                        <span>Etapa: {venda.status_funil_nome}</span>
                        <span>Vendedor(es): {venda.vendedores.map(item => item.nome).join(', ') || '-'}</span>
                        <span>Criador: {venda.criador?.nome || '-'}</span>
                      </div>
                      {venda.motivo_bloqueio ? (
                        <div className="vincular-venda-bloqueio"><I.AlertTriangle size={14} /> {venda.motivo_bloqueio}</div>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={() => setConfirmacao({ tipo: 'vincular', venda, cnpj: cnpjPesquisado })}>
                          Selecionar venda
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {confirmacao && (
            <div className="vincular-venda-confirmacao" role="alertdialog" aria-label="Confirmar vínculo">
              <strong>{confirmacao.tipo === 'desvincular' ? 'Confirmar desvínculo?' : `Vincular a venda #${vendaConfirmada?.id}?`}</strong>
              <span>{confirmacao.tipo === 'desvincular'
                ? 'O futuro cliente e a atribuição comercial voltarão exatamente ao estado anterior salvo.'
                : confirmacaoCnpjDiferente
                  ? `A venda corresponde ao CNPJ ${formatarCnpj(confirmacao.cnpj)}, diferente do cadastro. O CNPJ original não será alterado.`
                  : 'Esta ação marcará o futuro cliente como venda concluída. Os vendedores e a autoria da venda não serão alterados.'}</span>
              <div>
                <button type="button" className="btn" onClick={() => setConfirmacao(null)} disabled={processando}>Cancelar</button>
                <button type="button" className={confirmacao.tipo === 'desvincular' ? 'btn btn-danger' : 'btn btn-primary'} onClick={confirmarAcao} disabled={processando}>
                  {processando ? 'Processando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={processando}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza futuro cliente detalhe modal.
 */
export function FuturoClienteDetalheModal({
  linha,
  onClose,
  onAtualizado,
  onDistribuido,
  onRegistrarVenda,
  somenteLeitura = false,
  permitirReenvioTelegram = false
}) {
  const dialogRef = useDialogAcessivel(onClose);
  const vendaRegistrada = isFuturoClienteVendido(linha);
  const vendaRecusada = isVendaRecusada(linha);
  const [etapa, setEtapa] = useState('ver'); // 'ver' | 'venda'
  const [vinculoAberto, setVinculoAberto] = useState(false);
  const [notas, setNotas] = useState(linha.futuro_cliente_notas || '');
  const [motivoRecusa, setMotivoRecusa] = useState(linha.venda_recusada_motivo || '');
  const [retorno, setRetorno] = useState(formatarParaDatetimeLocal(linha.futuro_cliente_retorno));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [operadoras, setOperadoras] = useState([]);
  const dadosEmpresaInicial = useMemo(() => getDadosEmpresaFuturoCliente(linha, linha.sondagem), [linha]);
  const [razaoSocial, setRazaoSocial] = useState(() => dadosEmpresaInicial.razao_social);
  const [cnpj, setCnpj] = useState(() => formatarCnpj(dadosEmpresaInicial.cnpj));
  const [contatoNome, setContatoNome] = useState(linha.sondagem?.contato_nome || '');
  const [contatoTipo, setContatoTipo] = useState(linha.sondagem?.contato_tipo || '');
  const [operadoraAtualId, setOperadoraAtualId] = useState(String(linha.sondagem?.operadora_atual_id || ''));
  const [operadoraInteresseId, setOperadoraInteresseId] = useState(String(linha.sondagem?.operadora_interesse_id || ''));
  const [chipsItens, setChipsItens] = useState(() => criarChipsItensSondagem(linha.sondagem));
  const [melhorNumeroContato, setMelhorNumeroContato] = useState(() => formatarWhatsappInput(linha.sondagem?.melhor_numero_contato || ''));
  const [whatsapp, setWhatsapp] = useState(() => (
    linha.sondagem?.whatsapp_ddd
      ? formatarWhatsappInput(`${linha.sondagem.whatsapp_ddd}${linha.sondagem.whatsapp_numero || ''}`)
      : ''
  ));
  const [telefoneFixo, setTelefoneFixo] = useState(() => formatarWhatsappInput(linha.sondagem?.telefone_fixo || ''));
  const [terminal, setTerminal] = useState(() => formatarWhatsappInput(linha.sondagem?.terminal || ''));
  const [dataAtivacao, setDataAtivacao] = useState(() => String(linha.sondagem?.data_ativacao || '').slice(0, 10));
  const [distribuindo, setDistribuindo] = useState(false);
  const valorMensalEstimado = chipsItens.reduce((total, item) => total
    + ((Number(item.quantidade) || 0) * moedaBRParaNumero(item.preco_por_chip)), 0);

  useEffect(() => {
    listarOperadoras().then(resultado => setOperadoras(Array.isArray(resultado) ? resultado : resultado?.data || [])).catch(() => setOperadoras([]));
  }, []);

  const usuario = useMemo(() => getUsuarioLocal(), []);
  const comoAdmin = useMemo(() => temPermissao(usuario, 'gerenciar_leads'), [usuario]);
  const ehResponsavel = Number(linha.atribuido_para_id) === Number(usuario?.id);
  const ehDono = Number(linha.futuro_cliente_marcado_por_id) === Number(usuario?.id);
  const jaEnviadoTelegram = linha.futuro_cliente_destino === 'distribuicao';
  const destinoDistribuivel = ['carteira', 'distribuicao'].includes(linha.futuro_cliente_destino);
  const distribuicaoAtiva = ['aguardando_aceite', 'aceito'].includes(linha.distribuicao?.status);
  const temPermissoesReenvio = permitirReenvioTelegram
    && temPermissao(usuario, 'futuros_clientes_registrar')
    && temPermissao(usuario, 'futuros_clientes_ver_todos');
  const estadoDistribuivel = (!linha.status_operacional || linha.status_operacional === 'qualificado')
    && linha.etapa_atual !== 'venda'
    && !linha.venda_id
    && !linha.cliente_id
    && !linha.venda_recusada_em
    && !linha.cliente_recusou
    && !distribuicaoAtiva;
  const podeEditar = !somenteLeitura && (comoAdmin || (ehResponsavel && temPermissao(usuario, 'futuros_clientes_registrar')));
  const podeRegistrarVenda = !somenteLeitura && (comoAdmin || (ehResponsavel && temPermissao(usuario, 'vendas_criar')));
  const podeEnviarDistribuicao = destinoDistribuivel
    && estadoDistribuivel
    && !vendaRegistrada
    && !vendaRecusada
    && (
      (!somenteLeitura && ehDono && !jaEnviadoTelegram)
      || temPermissoesReenvio
    );

  const camposLead = useMemo(() => {
    const dados = linha.dados_json || {};
    return Object.entries(dados)
      .filter(([chave]) => !chave.endsWith(' (atualizado)'))
      .map(([chave, valor]) => ({
        label: chave,
        valor: dados[`${chave} (atualizado)`] ?? valor
      }));
  }, [linha]);
  const camposPrimeiraLigacao = useMemo(() => {
    const sondagem = linha.sondagem;
    if (!sondagem) return [];

    return [
      { label: 'Razão social', valor: sondagem.razao_social || '-' },
      { label: 'CNPJ', valor: sondagem.cnpj || '-' },
      { label: 'Primeira ligação', valor: sondagem.usuario?.nome || '-' },
      { label: 'Data do contato', valor: formatarDataHora(sondagem.respondido_em || linha.futuro_cliente_marcado_em) },
      { label: 'Pessoa contatada', valor: sondagem.contato_nome || '-' },
      { label: 'Perfil do contato', valor: String(sondagem.contato_tipo || '-').toUpperCase() },
      { label: 'Melhor número para contato', valor: formatarWhatsappInput(sondagem.melhor_numero_contato) || '-' },
      { label: 'WhatsApp', valor: formatarWhatsappSondagem(sondagem) },
      { label: 'Operadora atual', valor: sondagem.operadoraAtual?.nome || '-' },
      { label: 'Operadora de interesse', valor: sondagem.operadoraInteresse?.nome || '-' },
      { label: 'Telefone fixo', valor: formatarWhatsappInput(sondagem.telefone_fixo) || '-' },
      { label: 'Terminal', valor: formatarWhatsappInput(sondagem.terminal) || '-' },
      { label: 'Data da ativação', valor: formatarData(sondagem.data_ativacao) },
      { label: 'Chips / preço', valor: formatarChipsSondagem(sondagem) },
      { label: 'Média mensal', valor: formatarMoedaSondagem(sondagem.valor_mensal_estimado) },
      { label: 'Retorno', valor: formatarDataHora(sondagem.retorno_em || linha.futuro_cliente_retorno) },
      { label: 'Observações', valor: sondagem.observacoes || linha.futuro_cliente_notas || '-', largo: true }
    ];
  }, [linha]);
  async function salvarVendaRecusada() {
    setSalvando(true);
    setErro('');
    try {
      const resultado = await (comoAdmin ? adminMarcarVendaRecusadaLead : marcarVendaRecusadaLead)(linha.id, motivoRecusa);
      onAtualizado(resultado.linha);
    } catch (error) {
      setErro(error.message || 'Erro ao marcar venda recusada.');
      setSalvando(false);
    }
  }

  async function enviarParaDistribuicao() {
    if (jaEnviadoTelegram && !window.confirm('Este futuro cliente já foi encaminhado. Deseja publicar uma nova mensagem no Telegram?')) {
      return;
    }
    setDistribuindo(true);
    setErro('');
    try {
      const resultado = await enviarFuturoClienteParaDistribuicao(linha.id);
      onDistribuido?.(resultado.linha, jaEnviadoTelegram);
    } catch (error) {
      setErro(error.message || 'Erro ao enviar futuro cliente para distribuicao.');
      setDistribuindo(false);
    }
  }


  /**
   * Salva  com os dados informados.
   */
  async function salvar(event) {
    event.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      const retornoIso = datetimeRetornoParaIso(retorno);
      if (retorno && !retornoIso) {
        setErro('Informe uma data e hora de retorno validas.');
        setSalvando(false);
        return;
      }

      const resultado = await (comoAdmin ? adminMarcarFuturoClienteLead : marcarFuturoClienteLead)(linha.id, {
        notas,
        retorno: retornoIso,
        razao_social: razaoSocial,
        cnpj,
        contato_nome: contatoNome,
        contato_tipo: contatoTipo,
        operadora_atual_id: Number(operadoraAtualId),
        operadora_interesse_id: operadoraInteresseId ? Number(operadoraInteresseId) : null,
        chips_itens: chipsItensParaEnvio(chipsItens),
        melhor_numero_contato: melhorNumeroContato,
        whatsapp,
        telefone_fixo: telefoneFixo,
        terminal,
        data_ativacao: dataAtivacao
      });
      onAtualizado(resultado.linha);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar.');
      setSalvando(false);
    }
  }

  if (etapa === 'venda') {
    return (
      <RegistrarVendaLeadModal
        linha={linha}
        colunas={[]}
        usuario={usuario}
        onClose={onClose}
        onConfirm={onRegistrarVenda}
      />
    );
  }

  if (vinculoAberto) {
    return (
      <VincularVendaFuturoClienteModal
        linha={linha}
        onClose={() => setVinculoAberto(false)}
        onAtualizado={onAtualizado}
      />
    );
  }

  return (
    <div className="modal-overlay">
      <form ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Detalhes do futuro cliente" className="modal futuro-cliente-detalhe-modal" onSubmit={podeEditar ? salvar : event => event.preventDefault()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Futuro cliente</div>
              <div className="modal-sub">{linha.envio?.nome || 'Lead'}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={salvando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body futuro-cliente-detalhe__body">
          <div className="futuro-cliente-detalhe__resumos">
            <section className="futuro-cliente-detalhe__painel" aria-labelledby="futuro-cliente-dados-planilha">
              <header className="futuro-cliente-detalhe__painel-header">
                <h3 id="futuro-cliente-dados-planilha">Dados da planilha</h3>
                <p>Informações recebidas no mailing de origem.</p>
              </header>
              {camposLead.length > 0 ? (
                <div className="adicionar-lead-dados futuro-cliente-detalhe__dados">
                  {camposLead.map(({ label, valor }) => (
                    <div key={label} className={`adicionar-lead-campo${normalizarTextoLead(label).includes('observacao') ? ' futuro-cliente-detalhe__dado-largo' : ''}`}>
                      <span className="adicionar-lead-campo__label">{label}</span>
                      <span className="adicionar-lead-campo__valor">{formatarValorCampoLead(valor) || '-'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="futuro-cliente-detalhe__vazio">Nenhum dado disponível na planilha.</div>
              )}
            </section>

            <section className="futuro-cliente-detalhe__painel" aria-labelledby="futuro-cliente-dados-primeira-ligacao">
              <header className="futuro-cliente-detalhe__painel-header">
                <h3 id="futuro-cliente-dados-primeira-ligacao">Dados obtidos na 1ª ligação</h3>
                <p>Informações registradas durante o primeiro contato.</p>
              </header>
              {camposPrimeiraLigacao.length > 0 ? (
                <div className="adicionar-lead-dados futuro-cliente-detalhe__dados">
                  {camposPrimeiraLigacao.map(({ label, valor, largo }) => (
                    <div key={label} className={`adicionar-lead-campo${largo ? ' futuro-cliente-detalhe__dado-largo' : ''}`}>
                      <span className="adicionar-lead-campo__label">{label}</span>
                      <span className="adicionar-lead-campo__valor">{valor || '-'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="futuro-cliente-detalhe__vazio">A primeira ligação ainda não possui dados registrados.</div>
              )}
              <AvaliacaoPrimeiraLigacao linha={linha} />
            </section>
          </div>

          <section className="futuro-cliente-detalhe__form-card" aria-labelledby="futuro-cliente-atualizar-dados">
            <header className="futuro-cliente-detalhe__form-header">
              <h3 id="futuro-cliente-atualizar-dados">Atualizar dados do futuro cliente</h3>
              <p>Revise as informações comerciais e mantenha o próximo contato atualizado.</p>
            </header>
            <fieldset className="futuro-cliente-form future-client-readonly" disabled={!podeEditar}>
              <section className="futuro-cliente-form__secao" aria-labelledby="futuro-cliente-form-empresa">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-empresa">Empresa</h4>
                  <p>Identificação principal do futuro cliente.</p>
                </div>
                <div className="futuro-cliente-form__secao-grid">
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-cnpj">CNPJ</label>
                    <input id="futuro-cliente-cnpj" value={cnpj} onChange={event => setCnpj(formatarCnpj(event.target.value))} maxLength="18" disabled={salvando} />
                  </div>
                  <div className="form-field futuro-cliente-form__campo-largo">
                    <label htmlFor="futuro-cliente-razao-social">Razão social</label>
                    <input id="futuro-cliente-razao-social" value={razaoSocial} onChange={event => setRazaoSocial(event.target.value)} maxLength="240" disabled={salvando} />
                  </div>
                </div>
              </section>

              <section className="futuro-cliente-form__secao" aria-labelledby="futuro-cliente-form-contato">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-contato">Contato</h4>
                  <p>Responsável abordado e canais para a próxima conversa.</p>
                </div>
                <div className="futuro-cliente-form__secao-grid">
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-contato-nome">Nome de quem falou</label>
                    <input id="futuro-cliente-contato-nome" value={contatoNome} onChange={event => setContatoNome(event.target.value)} required disabled={salvando} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-contato-tipo">ADM ou RL</label>
                    <select id="futuro-cliente-contato-tipo" value={contatoTipo} onChange={event => setContatoTipo(event.target.value)} required disabled={salvando}>
                      <option value="">Selecione</option>
                      <option value="adm">ADM</option>
                      <option value="rl">RL</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-melhor-numero">Melhor número para contato</label>
                    <input id="futuro-cliente-melhor-numero" type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={melhorNumeroContato} onChange={event => setMelhorNumeroContato(formatarWhatsappInput(event.target.value))} required disabled={salvando} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-whatsapp">WhatsApp com DDD</label>
                    <input id="futuro-cliente-whatsapp" type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={whatsapp} onChange={event => setWhatsapp(formatarWhatsappInput(event.target.value))} required disabled={salvando} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-telefone-fixo">Fixo com DDD</label>
                    <input id="futuro-cliente-telefone-fixo" type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 3333-4444" value={telefoneFixo} onChange={event => setTelefoneFixo(formatarWhatsappInput(event.target.value))} disabled={salvando} />
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-terminal">Terminal</label>
                    <input id="futuro-cliente-terminal" type="tel" inputMode="numeric" maxLength="15" autoComplete="tel" placeholder="(11) 99999-9999" value={terminal} onChange={event => setTerminal(formatarWhatsappInput(event.target.value))} disabled={salvando} />
                  </div>
                </div>
              </section>

              <section className="futuro-cliente-form__secao" aria-labelledby="futuro-cliente-form-cenario">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-cenario">Cenário comercial</h4>
                  <p>Operadoras envolvidas e situação atual do contrato.</p>
                </div>
                <div className="futuro-cliente-form__secao-grid">
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-operadora-atual">Operadora atual</label>
                    <select id="futuro-cliente-operadora-atual" value={operadoraAtualId} onChange={event => setOperadoraAtualId(event.target.value)} required disabled={salvando}>
                      <option value="">Selecione</option>
                      {operadoras.map(operadora => <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-operadora-interesse">Operadora de interesse</label>
                    <select id="futuro-cliente-operadora-interesse" value={operadoraInteresseId} onChange={event => setOperadoraInteresseId(event.target.value)} disabled={salvando}>
                      <option value="">Selecione</option>
                      {operadoras.map(operadora => <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>)}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-data-ativacao">Data da ativação</label>
                    <input id="futuro-cliente-data-ativacao" type="date" value={dataAtivacao} onChange={event => setDataAtivacao(event.target.value)} disabled={salvando} />
                  </div>
                </div>
              </section>

              <section className="futuro-cliente-form__secao" aria-labelledby="futuro-cliente-form-proposta">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-proposta">Proposta</h4>
                  <p>Quantidade, preço dos chips e estimativa mensal.</p>
                </div>
                <div className="futuro-cliente-form__proposta">
                  <ChipsItensSondagem
                    itens={chipsItens}
                    onChange={setChipsItens}
                    disabled={salvando}
                    complementoRodape={(
                      <div className="futuro-cliente-estimativa">
                        <span>Média mensal estimada</span>
                        <strong>{valorMensalEstimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                      </div>
                    )}
                  />
                </div>
              </section>

              <section className="futuro-cliente-form__secao futuro-cliente-form__secao--observacoes" aria-labelledby="futuro-cliente-form-observacoes">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-observacoes">Observações</h4>
                  <p>Registre informações importantes, interesses e o histórico da negociação.</p>
                </div>
                <div className="form-field">
                  <label htmlFor="futuro-cliente-observacoes">Anotações comerciais</label>
                  <textarea
                    id="futuro-cliente-observacoes"
                    rows={4}
                    value={notas}
                    onChange={event => setNotas(event.target.value)}
                    placeholder="Observações, interesses, histórico..."
                    disabled={salvando}
                  />
                </div>
              </section>

              <section className="futuro-cliente-form__secao" aria-labelledby="futuro-cliente-form-acompanhamento">
                <div className="futuro-cliente-form__secao-header">
                  <h4 id="futuro-cliente-form-acompanhamento">Acompanhamento</h4>
                  <p>Defina o próximo retorno e registre o desfecho da negociação.</p>
                </div>
                <div className="futuro-cliente-form__secao-grid">
                  <div className="form-field">
                    <label htmlFor="futuro-cliente-data-retorno">Data de retorno</label>
                    <input
                      id="futuro-cliente-data-retorno"
                      type="datetime-local"
                      value={retorno}
                      onChange={event => setRetorno(event.target.value)}
                      disabled={salvando}
                    />
                  </div>
                </div>
                {vendaRecusada ? (
                  <div className="futuro-cliente-recusa is-saved">
                    <strong>Venda recusada</strong>
                    <span>{linha.venda_recusada_motivo || 'Motivo nao informado.'}</span>
                    {linha.venda_recusada_em && <small>Marcada em {formatarDataHora(linha.venda_recusada_em)}</small>}
                  </div>
                ) : !vendaRegistrada && podeEditar && (
                  <div className="futuro-cliente-recusa">
                    <label>Venda recusada</label>
                    <textarea rows={3} value={motivoRecusa} onChange={event => setMotivoRecusa(event.target.value)} placeholder="Informe o motivo da recusa" disabled={salvando} />
                    <button type="button" className="btn btn-danger" onClick={salvarVendaRecusada} disabled={salvando || !motivoRecusa.trim()}>
                      Marcar venda recusada
                    </button>
                  </div>
                )}
              </section>
            </fieldset>
          </section>

          {erro && <div className="alert-error" style={{ marginTop: 8 }}>{erro}</div>}
        </div>

        <div className="modal-footer futuro-cliente-detalhe__footer">
          <div className="futuro-cliente-detalhe__acoes futuro-cliente-detalhe__acoes--principais">
            {podeEnviarDistribuicao && (
              <button type="button" className="btn" onClick={enviarParaDistribuicao} disabled={salvando || distribuindo}>
                <I.Send size={14} /> {distribuindo ? 'Enviando...' : jaEnviadoTelegram ? 'Reencaminhar ao Telegram' : 'Enviar para distribuição'}
              </button>
            )}
            {vendaRegistrada ? (
              <>
                <div className="lead-already-qualified-notice">Este futuro cliente ja possui uma venda registrada. Acesse a pagina de Vendas para visualizar a venda.</div>
                {comoAdmin && !somenteLeitura && <button type="button" className="btn" onClick={() => setVinculoAberto(true)}>Gerenciar vínculo</button>}
              </>
            ) : vendaRecusada ? (
              <div className="futuro-cliente-recusa is-saved">Venda recusada para este futuro cliente.</div>
            ) : (
              <>
                {podeRegistrarVenda && <button type="button" className="btn" onClick={() => setEtapa('venda')} disabled={salvando}>
                  <I.Chart size={14} /> Registrar venda
                </button>}
                {comoAdmin && !somenteLeitura && <button type="button" className="btn btn-primary" onClick={() => setVinculoAberto(true)} disabled={salvando}>Vincular venda</button>}
              </>
            )}
          </div>
          <div className="futuro-cliente-detalhe__acoes futuro-cliente-detalhe__acoes--confirmacao">
            <button type="button" className="btn" onClick={onClose} disabled={salvando || distribuindo}>Cancelar</button>
            {podeEditar && <button type="submit" className="btn btn-primary" disabled={salvando || distribuindo}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>}
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── Aba: futuros clientes ────────────────────────────────────────────────────

/**
 * Renderiza confirmar futuro cliente lixeira modal.
 */
function ConfirmarFuturoClienteLixeiraModal({ linha, tipo, processando, onClose, onConfirm }) {
  const dialogRef = useDialogAcessivel(onClose, processando);
  if (!linha || !tipo) return null;

  const definitivo = tipo === 'definitivo';
  const titulo = definitivo ? 'Excluir definitivamente?' : 'Enviar futuro cliente para lixeira?';
  const texto = definitivo
    ? 'Este futuro cliente sera removido da lista permanentemente. A linha original do lead sera preservada.'
    : 'Este futuro cliente ficara na lixeira por 30 dias antes da exclusao definitiva.';

  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={titulo} className="modal trash-confirm-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">{titulo}</div>
              <div className="modal-sub">{linha.envio?.nome || 'Lead'} - #{linha.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={processando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="trash-warning">
            <I.AlertTriangle size={20} />
            <div>
              <strong>{definitivo ? 'Esta acao nao pode ser desfeita.' : 'O item podera ser restaurado pela lixeira.'}</strong>
              <span>{texto}</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={processando}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={processando}>
            {processando ? 'Processando...' : definitivo ? 'Excluir definitivamente' : 'Enviar para lixeira'}
          </button>
        </div>
      </div>
    </div>
  );
}


function dataLocalIso(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function formatarDataIso(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return '-';
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Permite escolher o período e baixar a produtividade de todos os consultores. */
function ExportarProdutividadeModal({ onClose }) {
  const dialogRef = useDialogAcessivel(onClose);
  const hoje = useMemo(() => dataLocalIso(), []);
  const [dataInicio, setDataInicio] = useState(`${hoje.slice(0, 7)}-01`);
  const [dataFim, setDataFim] = useState(hoje);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');
  const periodoInvalido = Boolean(dataInicio && dataFim && dataInicio > dataFim);

  function selecionarPeriodo(inicio, fim) {
    setDataInicio(inicio);
    setDataFim(fim);
    setErro('');
  }

  async function baixar() {
    if (periodoInvalido) return;
    setBaixando(true);
    setErro('');
    try {
      await exportarMetricasFuturosClientesExcel({
        data_inicio: dataInicio,
        data_fim: dataFim
      });
      onClose();
    } catch (error) {
      setErro(error.message || 'Erro ao baixar a planilha.');
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal exportar-produtividade-modal" role="dialog" aria-modal="true" aria-labelledby="exportar-produtividade-titulo">
        <div className="modal-header">
          <div className="modal-header-row">
            <div className="consultor-modal-title">
              <span className="consultor-modal-eyebrow"><I.Download size={13} /> Relatório Excel</span>
              <div className="modal-client" id="exportar-produtividade-titulo">Exportar produtividade</div>
              <div className="modal-sub">Baixe os resultados de todos os consultores de primeira ligação.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={baixando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body exportar-produtividade-body">
          <div className="exportar-produtividade-info">
            <I.Calendar size={20} />
            <div>
              <strong>Escolha o período do relatório</strong>
              <span>O arquivo inclui um resumo por consultor e o detalhamento de cada dia.</span>
            </div>
          </div>

          <div className="consultor-periodo-filtros exportar-produtividade-filtros">
            <label className="form-field">
              <span>Data inicial</span>
              <input type="date" value={dataInicio} max={dataFim || undefined} onChange={event => selecionarPeriodo(event.target.value, dataFim)} />
            </label>
            <label className="form-field">
              <span>Data final</span>
              <input type="date" value={dataFim} min={dataInicio || undefined} onChange={event => selecionarPeriodo(dataInicio, event.target.value)} />
            </label>
          </div>

          <div className="consultor-periodo-atalhos exportar-produtividade-atalhos">
            <button type="button" className="btn" onClick={() => selecionarPeriodo(hoje, hoje)}>Hoje</button>
            <button type="button" className="btn" onClick={() => selecionarPeriodo(`${hoje.slice(0, 7)}-01`, hoje)}>Este mês</button>
            <button type="button" className="btn" onClick={() => selecionarPeriodo('', '')}>Todo o período</button>
          </div>

          {(periodoInvalido || erro) && (
            <div className="alert-error">
              {periodoInvalido ? 'A data inicial deve ser anterior ou igual a data final.' : erro}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={baixando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={baixar} disabled={baixando || periodoInvalido}>
            <I.Download size={15} /> {baixando ? 'Gerando planilha...' : 'Baixar Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Exibe a produtividade de primeira ligacao de um consultor por periodo. */
function ConsultorPrimeiraLigacaoModal({ consultor, onClose }) {
  const dialogRef = useDialogAcessivel(onClose);
  const hoje = useMemo(() => dataLocalIso(), []);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [dias, setDias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const periodoInvalido = Boolean(dataInicio && dataFim && dataInicio > dataFim);

  useEffect(() => {
    if (periodoInvalido) {
      return undefined;
    }

    let cancelado = false;
    listarMetricasFuturosClientes({
      usuario_id: consultor.usuario_id,
      data_inicio: dataInicio,
      data_fim: dataFim,
      agrupar_por: 'dia'
    })
      .then(data => !cancelado && setDias(Array.isArray(data) ? data : []))
      .catch(error => !cancelado && setErro(error.message || 'Erro ao carregar a produtividade.'))
      .finally(() => !cancelado && setCarregando(false));
    return () => { cancelado = true; };
  }, [consultor.usuario_id, dataInicio, dataFim, periodoInvalido]);

  const resumo = useMemo(() => (periodoInvalido ? [] : dias).reduce((acc, item) => ({
    ligacoes: acc.ligacoes + Number(item.ligacoes_realizadas || 0),
    retornos: acc.retornos + Number(item.retornos_agendados || 0),
    clientesRecusaram: acc.clientesRecusaram + Number(item.clientes_recusaram || 0),
    chamadasNaoAtendidas: acc.chamadasNaoAtendidas + Number(item.chamadas_nao_atendidas || 0),
    vendidos: acc.vendidos + Number(item.vendidos || 0),
    recusados: acc.recusados + Number(item.recusados || 0),
    potencial: acc.potencial + Number(item.potencial_mensal || 0)
  }), { ligacoes: 0, retornos: 0, clientesRecusaram: 0, chamadasNaoAtendidas: 0, vendidos: 0, recusados: 0, potencial: 0 }), [dias, periodoInvalido]);
  const diasExibidos = periodoInvalido ? [] : dias;

  function selecionarPeriodo(inicio, fim) {
    if (inicio === dataInicio && fim === dataFim) return;
    setCarregando(!(inicio && fim && inicio > fim));
    setErro('');
    setDataInicio(inicio);
    setDataFim(fim);
  }

  function selecionarHoje() {
    selecionarPeriodo(hoje, hoje);
  }

  function selecionarMes() {
    selecionarPeriodo(`${hoje.slice(0, 7)}-01`, hoje);
  }

  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal consultor-produtividade-modal" role="dialog" aria-modal="true" aria-labelledby="consultor-produtividade-titulo">
        <div className="modal-header">
          <div className="modal-header-row">
            <div className="consultor-modal-title">
              <span className="consultor-modal-eyebrow">Consultor de primeira ligação</span>
              <div className="modal-client" id="consultor-produtividade-titulo">{consultor.usuario_nome || 'Usuário removido'}</div>
              <div className="modal-sub">Acompanhe a qualificação e a conversão no período selecionado.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body consultor-produtividade-body">
          <div className="consultor-periodo-label"><I.Calendar size={15} /><span>Período analisado</span></div>
          <div className="consultor-periodo-filtros">
            <label className="form-field">
              <span>Data inicial</span>
              <input type="date" value={dataInicio} max={dataFim || undefined} onChange={event => selecionarPeriodo(event.target.value, dataFim)} />
            </label>
            <label className="form-field">
              <span>Data final</span>
              <input type="date" value={dataFim} min={dataInicio || undefined} onChange={event => selecionarPeriodo(dataInicio, event.target.value)} />
            </label>
            <div className="consultor-periodo-atalhos">
              <button type="button" className="btn" onClick={selecionarHoje}>Hoje</button>
              <button type="button" className="btn" onClick={selecionarMes}>Este mês</button>
              <button type="button" className="btn" onClick={() => selecionarPeriodo('', '')}>Todo o período</button>
            </div>
          </div>

          {(periodoInvalido || erro) && <div className="alert-error">{periodoInvalido ? 'A data inicial deve ser anterior ou igual a data final.' : erro}</div>}

          <div className="consultor-produtividade-metricas">
            <div className="is-primary"><span>Ligações totais</span><strong>{carregando ? '...' : resumo.ligacoes}</strong></div>
            <div><span>Retornos agendados</span><strong>{carregando ? '...' : resumo.retornos}</strong></div>
            <div><span>Clientes recusaram</span><strong>{carregando ? '...' : resumo.clientesRecusaram}</strong></div>
            <div><span>Chamadas não atendidas</span><strong>{carregando ? '...' : resumo.chamadasNaoAtendidas}</strong></div>
            <div><span>Vendas concluídas</span><strong>{carregando ? '...' : resumo.vendidos}</strong></div>
            <div><span>Vendas recusadas</span><strong>{carregando ? '...' : resumo.recusados}</strong></div>
            <div><span>Conversão</span><strong>{carregando ? '...' : resumo.ligacoes ? `${((resumo.vendidos / resumo.ligacoes) * 100).toFixed(1)}%` : '0%'}</strong></div>
            <div><span>Potencial mensal</span><strong>{carregando ? '...' : resumo.potencial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
          </div>

          <p className="consultor-produtividade-nota">Uma ligação é contabilizada quando o futuro cliente é qualificado.</p>

          <div className="list-table consultor-produtividade-table">
            <div className="scroll">
              <table>
                <thead><tr><th>Data</th><th>Ligações totais</th><th>Qualificados para venda</th><th>Retornos</th><th>Clientes recusaram</th><th>Chamadas não atendidas</th><th>Concluidas</th><th>Recusadas</th><th>Potencial mensal</th></tr></thead>
                <tbody>
                  {carregando ? (
                    <tr><td colSpan="9" className="muted">Carregando produtividade...</td></tr>
                  ) : diasExibidos.length === 0 ? (
                    <tr><td colSpan="9" className="muted">Nenhuma ligação registrada neste período.</td></tr>
                  ) : diasExibidos.map(item => (
                    <tr key={item.data}>
                      <td>{formatarDataIso(String(item.data).slice(0, 10))}</td>
                      <td>{Number(item.ligacoes_realizadas || 0)}</td>
                      <td>{Number(item.qualificados || 0)}</td>
                      <td>{Number(item.retornos_agendados || 0)}</td>
                      <td>{Number(item.clientes_recusaram || 0)}</td>
                      <td>{Number(item.chamadas_nao_atendidas || 0)}</td>
                      <td>{Number(item.vendidos || 0)}</td>
                      <td>{Number(item.recusados || 0)}</td>
                      <td>{Number(item.potencial_mensal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza futuros clientes main view com os dados informados.
 */
function FuturosClientesMainView({ agora, tipo = 'meus', escopoTodos = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hojeMetricas = useMemo(() => dataLocalIso(new Date(agora)), [agora]);
  const [linhas, setLinhas] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busca, setBusca] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [filtroRetorno, setFiltroRetorno] = useState('');
  const [filtroRecebidos, setFiltroRecebidos] = useState('acao');
  const buscaDeferred = useDeferredValue(busca);
  const [consultaConcluida, setConsultaConcluida] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [linhaAtiva, setLinhaAtiva] = useState(null);
  const [modoLixeira, setModoLixeira] = useState(false);
  const [processandoId, setProcessandoId] = useState(null);
  const [confirmacaoLixeira, setConfirmacaoLixeira] = useState(null);
  const [metricas, setMetricas] = useState([]);
  const [consultorAtivo, setConsultorAtivo] = useState(null);
  const [exportacaoAberta, setExportacaoAberta] = useState(false);
  const [tipoPeriodoMetricas, setTipoPeriodoMetricas] = useState('hoje');
  const [mesMetricas, setMesMetricas] = useState(() => dataLocalIso().slice(0, 7));
  const [dataInicioMetricas, setDataInicioMetricas] = useState(() => dataLocalIso());
  const [dataFimMetricas, setDataFimMetricas] = useState(() => dataLocalIso());
  const notificacaoAbertaRef = useRef(null);

  const usuario = useMemo(() => getUsuarioLocal(), []);
  const podeGerenciar = temPermissao(usuario, 'futuros_clientes_registrar');
  const modoRecebidos = tipo === 'recebidos';
  const exibirMetricas = false;
  const linhaNotificacaoId = useMemo(() => {
    const id = Number(searchParams.get('linha_id'));
    return Number.isInteger(id) && id > 0 ? id : null;
  }, [searchParams]);
  const notificacaoId = getNotificacaoIdParam(searchParams);
  const chaveConsulta = useMemo(() => JSON.stringify({
    pagina,
    busca: buscaDeferred,
    filtroSituacao,
    filtroRetorno,
    modoLixeira,
    modoRecebidos,
    filtroRecebidos,
    linhaNotificacaoId,
    escopoTodos
  }), [pagina, buscaDeferred, filtroSituacao, filtroRetorno, modoLixeira, modoRecebidos, filtroRecebidos, linhaNotificacaoId, escopoTodos]);
  const carregando = consultaConcluida !== chaveConsulta;
  const periodoMetricasInvalido = tipoPeriodoMetricas === 'periodo'
    && Boolean(dataInicioMetricas && dataFimMetricas && dataInicioMetricas > dataFimMetricas);
  const filtrosMetricas = useMemo(() => {
    if (tipoPeriodoMetricas === 'hoje') {
      return { data_inicio: hojeMetricas, data_fim: hojeMetricas };
    }
    if (tipoPeriodoMetricas === 'mes' && /^\d{4}-\d{2}$/.test(mesMetricas)) {
      const [ano, mes] = mesMetricas.split('-').map(Number);
      const ultimoDia = new Date(ano, mes, 0).getDate();
      return { data_inicio: `${mesMetricas}-01`, data_fim: `${mesMetricas}-${String(ultimoDia).padStart(2, '0')}` };
    }
    return { data_inicio: dataInicioMetricas, data_fim: dataFimMetricas };
  }, [tipoPeriodoMetricas, hojeMetricas, mesMetricas, dataInicioMetricas, dataFimMetricas]);

  useEffect(() => {
    let cancelado = false;
    const listar = modoLixeira
      ? listarFuturosClientesLixeira
      : modoRecebidos
        ? listarFuturosClientesRecebidos
        : escopoTodos ? listarQuadroFuturosClientes : listarFuturosClientesLeads;
    listar({
      page: pagina,
      page_size: 50,
      busca: buscaDeferred,
      situacao: filtroSituacao || undefined,
      retorno: filtroRetorno || undefined,
      status: modoRecebidos ? filtroRecebidos : undefined,
      linha_id: linhaNotificacaoId || undefined
    })
      .then(data => {
        if (!cancelado) {
          const linhasRecebidas = data.data || [];
          const totalRecebido = data.total || 0;
          setLinhas(linhasRecebidas);
          setTotal(totalRecebido);
          if (linhaNotificacaoId) {
            const deveProcessarNotificacao = notificacaoId && notificacaoAbertaRef.current !== notificacaoId;
            const linha = linhasRecebidas.find(item => Number(item.id) === linhaNotificacaoId);
            if (linha) {
              setErro('');
              setLinhaAtiva(linha);
              if (deveProcessarNotificacao) {
                notificacaoAbertaRef.current = notificacaoId;
                void confirmarAberturaNotificacao(notificacaoId).catch(error => {
                  console.error('Erro ao confirmar abertura da notificacao:', error);
                });
              }
            } else if (totalRecebido === 0) {
              if (deveProcessarNotificacao) {
                notificacaoAbertaRef.current = notificacaoId;
                falharAberturaNotificacao(notificacaoId);
              }
              setErro('O futuro cliente desta notificacao nao esta mais disponivel.');
            }
          }
        }
      })
      .catch(error => {
        if (notificacaoId) falharAberturaNotificacao(notificacaoId);
        setErro(error.message || 'Erro ao carregar futuros clientes.');
      })
      .finally(() => {
        if (!cancelado) setConsultaConcluida(chaveConsulta);
      });
    return () => { cancelado = true; };
  }, [pagina, buscaDeferred, filtroSituacao, filtroRetorno, filtroRecebidos, modoLixeira, modoRecebidos, escopoTodos, linhaNotificacaoId, chaveConsulta, notificacaoId]);

  useEffect(() => {
    if (!exibirMetricas || modoLixeira || periodoMetricasInvalido) return;
    listarMetricasFuturosClientes(filtrosMetricas)
      .then(data => setMetricas(Array.isArray(data) ? data : []))
      .catch(() => setMetricas([]));
  }, [exibirMetricas, modoLixeira, linhas, filtrosMetricas, periodoMetricasInvalido]);

  const resumoMetricas = useMemo(() => metricas.reduce((acc, item) => ({
    ligacoes: acc.ligacoes + Number(item.ligacoes_realizadas || 0),
    qualificados: acc.qualificados + Number(item.qualificados || 0),
    retornos: acc.retornos + Number(item.retornos_agendados || 0),
    clientesRecusaram: acc.clientesRecusaram + Number(item.clientes_recusaram || 0),
    chamadasNaoAtendidas: acc.chamadasNaoAtendidas + Number(item.chamadas_nao_atendidas || 0),
    vendidos: acc.vendidos + Number(item.vendidos || 0),
    recusados: acc.recusados + Number(item.recusados || 0),
    potencial: acc.potencial + Number(item.potencial_mensal || 0)
  }), { ligacoes: 0, qualificados: 0, retornos: 0, clientesRecusaram: 0, chamadasNaoAtendidas: 0, vendidos: 0, recusados: 0, potencial: 0 }), [metricas]);

  useEffect(() => {
    if (!erro) return undefined;
    const timer = setTimeout(() => setErro(''), 6000);
    return () => clearTimeout(timer);
  }, [erro]);

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  const colunasDados = useMemo(() => {
    const mapa = new Map();
    linhas.forEach(linha => {
      Object.keys(linha.dados_json || {})
        .filter(chave => !chave.endsWith(' (atualizado)'))
        .forEach(chave => mapa.set(chave, chave));
    });
    return Array.from(mapa.keys());
  }, [linhas]);

  const totalPaginas = Math.max(1, Math.ceil(total / 50));
  const podeExcluir = podeGerenciar && !modoRecebidos && !escopoTodos;
  const totalColunasTabela = colunasDados.length + 5 + (modoLixeira ? 2 : 0) + (podeExcluir ? 1 : 0);

  /**
   * Trata o evento de atualizado.
   */
  function handleAtualizado(linhaAtualizada) {
    setLinhas(prev => prev.map(l => l.id === linhaAtualizada.id ? linhaAtualizada : l));
    fecharDetalhe();
  }

  function handleDistribuido(linhaDistribuida, reencaminhado = false) {
    if (escopoTodos) {
      setLinhas(prev => prev.map(item => item.id === linhaDistribuida.id ? { ...item, ...linhaDistribuida } : item));
    } else {
      setLinhas(prev => prev.filter(item => item.id !== linhaDistribuida.id));
      setTotal(prev => Math.max(0, prev - 1));
    }
    fecharDetalhe();
    setSucesso(reencaminhado
      ? 'Futuro cliente reencaminhado ao Telegram.'
      : 'Futuro cliente enviado para a distribuição do Telegram.');
  }

  function handleAceito(linhaAtualizada) {
    const atualizada = { ...linhaAtualizada, atribuicao_id: linhaAtiva?.atribuicao_id || linhaAtualizada.atribuicao_id };
    setLinhas(prev => prev.map(item => (item.atribuicao_id || item.id) === (atualizada.atribuicao_id || atualizada.id) ? atualizada : item));
    setLinhaAtiva(atualizada);
    setSucesso('Indicacao aceita. O prazo de 30 minutos foi iniciado.');
  }

  function handleRecusado() {
    if (modoRecebidos && filtroRecebidos === 'todos') {
      setLinhas(prev => prev.map(item => item.atribuicao_id === linhaAtiva?.atribuicao_id
        ? { ...item, distribuicao: { ...item.distribuicao, status: 'recusado' } }
        : item));
    } else {
      setLinhas(prev => prev.filter(item => (item.atribuicao_id || item.id) !== (linhaAtiva?.atribuicao_id || linhaAtiva?.id)));
      setTotal(prev => Math.max(0, prev - 1));
    }
    fecharDetalhe();
    setSucesso('Indicacao recusada e devolvida para novo encaminhamento.');
  }

  /** Fecha o detalhe aberto pela notificacao e retorna a lista completa. */
  function fecharDetalhe() {
    setLinhaAtiva(null);
    if (linhaNotificacaoId) setSearchParams({}, { replace: true });
  }

  /**
   * Alterna modo lixeira no estado atual.
   */
  function alternarModoLixeira(proximoModo) {
    setModoLixeira(proximoModo);
    setPagina(1);
    setLinhaAtiva(null);
    setErro('');
    setSucesso('');
  }
  function limparFiltros() {
    setBusca('');
    setFiltroSituacao('');
    setFiltroRetorno('');
    setFiltroRecebidos('acao');
    setPagina(1);
  }

  /**
   * Executa a acao de confirmar mover para lixeira mantendo o estado da tela consistente.
   */
  async function confirmarMoverParaLixeira() {
    const linha = confirmacaoLixeira?.linha;
    if (!linha) return;

    setProcessandoId(linha.id);
    setErro('');
    setSucesso('');

    try {
      await excluirFuturoCliente(linha.id);
      setLinhas(prev => prev.filter(item => item.id !== linha.id));
      setTotal(prev => Math.max(0, prev - 1));
      setConfirmacaoLixeira(null);
      setSucesso('Futuro cliente enviado para a lixeira.');
    } catch (error) {
      setErro(error.message || 'Erro ao enviar futuro cliente para a lixeira.');
    } finally {
      setProcessandoId(null);
    }
  }

  /**
   * Trata o evento de restaurar.
   */
  async function handleRestaurar(linha) {
    setProcessandoId(linha.id);
    setErro('');
    setSucesso('');

    try {
      await restaurarFuturoCliente(linha.id);
      setLinhas(prev => prev.filter(item => item.id !== linha.id));
      setTotal(prev => Math.max(0, prev - 1));
      setSucesso('Futuro cliente restaurado.');
    } catch (error) {
      setErro(error.message || 'Erro ao restaurar futuro cliente.');
    } finally {
      setProcessandoId(null);
    }
  }

  /**
   * Executa a acao de confirmar exclusao definitiva mantendo o estado da tela consistente.
   */
  async function confirmarExclusaoDefinitiva() {
    const linha = confirmacaoLixeira?.linha;
    if (!linha) return;

    setProcessandoId(linha.id);
    setErro('');
    setSucesso('');

    try {
      await excluirFuturoClienteDefinitivo(linha.id);
      setLinhas(prev => prev.filter(item => item.id !== linha.id));
      setTotal(prev => Math.max(0, prev - 1));
      setConfirmacaoLixeira(null);
      setSucesso('Futuro cliente excluído definitivamente.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir futuro cliente definitivamente.');
    } finally {
      setProcessandoId(null);
    }
  }

  /**
   * Trata o evento de registrar venda.
   */
  function handleRegistrarVenda(vendaPreenchida) {
    navigate('/vendas?nova=1', {
      state: {
        vendaPreenchida,
        clientePreenchido: montarClientePreenchido(vendaPreenchida),
        origemLead: {
          linha_id: linhaAtiva?.id,
          envio: linhaAtiva?.envio?.nome || ''
        }
      }
    });
  }

  return (
    <div className="futuros-clientes-view">
      <ConfirmarFuturoClienteLixeiraModal
        linha={confirmacaoLixeira?.linha}
        tipo={confirmacaoLixeira?.tipo}
        processando={processandoId === confirmacaoLixeira?.linha?.id}
        onClose={() => setConfirmacaoLixeira(null)}
        onConfirm={confirmacaoLixeira?.tipo === 'definitivo' ? confirmarExclusaoDefinitiva : confirmarMoverParaLixeira}
      />

      {linhaAtiva?.detalhes_bloqueados ? (
        <FuturoClienteAceiteModal
          linha={linhaAtiva}
          onClose={fecharDetalhe}
          onAceito={handleAceito}
          onRecusado={handleRecusado}
        />
      ) : linhaAtiva && (
        <FuturoClienteDetalheModal
          linha={linhaAtiva}
          onClose={fecharDetalhe}
          onAtualizado={handleAtualizado}
          onDistribuido={handleDistribuido}
          onRegistrarVenda={handleRegistrarVenda}
          somenteLeitura={escopoTodos || (modoRecebidos && (linhaAtiva?.distribuicao?.status !== 'aceito' || Boolean(linhaAtiva?.distribuicao?.acao_registrada_em)))}
          permitirReenvioTelegram={escopoTodos
            && podeGerenciar
            && temPermissao(usuario, 'futuros_clientes_ver_todos')}
        />
      )}

      {consultorAtivo && (
        <ConsultorPrimeiraLigacaoModal consultor={consultorAtivo} onClose={() => setConsultorAtivo(null)} />
      )}

      {exportacaoAberta && <ExportarProdutividadeModal onClose={() => setExportacaoAberta(false)} />}

      {exibirMetricas && !modoLixeira && (
        <section className="conversao-sondagem-module">
          <div className="conversao-sondagem-header">
            <div>
              <h2>Conversão da primeira ligação</h2>
              <p>A venda é atribuída ao consultor que qualificou o futuro cliente, mesmo quando outro consultor fecha.</p>
            </div>
            <button type="button" className="btn conversao-exportar-btn" onClick={() => setExportacaoAberta(true)}>
              <I.Download size={15} /> Baixar Excel
            </button>
          </div>
          <div className="conversao-periodo-filtros">
            <label className="form-field">
              <span>Exibir métricas de</span>
              <select value={tipoPeriodoMetricas} onChange={event => setTipoPeriodoMetricas(event.target.value)}>
                <option value="hoje">Hoje</option>
                <option value="mes">Mês</option>
                <option value="periodo">Período específico</option>
              </select>
            </label>
            {tipoPeriodoMetricas === 'mes' && (
              <label className="form-field">
                <span>Mes</span>
                <input type="month" value={mesMetricas} max={hojeMetricas.slice(0, 7)} onChange={event => setMesMetricas(event.target.value)} />
              </label>
            )}
            {tipoPeriodoMetricas === 'periodo' && (
              <>
                <label className="form-field">
                  <span>Data inicial</span>
                  <input type="date" value={dataInicioMetricas} max={dataFimMetricas || hojeMetricas} onChange={event => setDataInicioMetricas(event.target.value)} />
                </label>
                <label className="form-field">
                  <span>Data final</span>
                  <input type="date" value={dataFimMetricas} min={dataInicioMetricas || undefined} max={hojeMetricas} onChange={event => setDataFimMetricas(event.target.value)} />
                </label>
              </>
            )}
          </div>
          {periodoMetricasInvalido && <div className="alert-error">A data inicial deve ser anterior ou igual a data final.</div>}
          <div className="futuros-clientes-metricas">
            <div><span>Ligações totais</span><strong>{resumoMetricas.ligacoes}</strong></div>
            <div><span>Qualificados para venda</span><strong>{resumoMetricas.qualificados}</strong></div>
            <div><span>Retornos agendados</span><strong>{resumoMetricas.retornos}</strong></div>
            <div><span>Clientes recusaram</span><strong>{resumoMetricas.clientesRecusaram}</strong></div>
            <div><span>Chamadas não atendidas</span><strong>{resumoMetricas.chamadasNaoAtendidas}</strong></div>
            <div><span>Vendas concluídas</span><strong>{resumoMetricas.vendidos}</strong></div>
            <div><span>Vendas recusadas</span><strong>{resumoMetricas.recusados}</strong></div>
            <div><span>Conversão dos qualificados</span><strong>{resumoMetricas.qualificados ? `${((resumoMetricas.vendidos / resumoMetricas.qualificados) * 100).toFixed(1)}%` : '0%'}</strong></div>
            <div><span>Potencial mensal</span><strong>{resumoMetricas.potencial.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
          </div>
          <div className="list-table conversao-sondagem-table">
            <div className="scroll">
              <table>
                <thead><tr><th>Consultor da primeira ligação</th><th>Ligações totais</th><th>Qualificados para venda</th><th>Retornos agendados</th><th>Clientes recusaram</th><th>Chamadas não atendidas</th><th>Vendas concluidas</th><th>Vendas recusadas</th><th>Conversao</th><th>Potencial mensal</th></tr></thead>
                <tbody>
                  {metricas.length === 0 ? (
                    <tr><td colSpan="10" className="muted">Ainda não existem qualificações para calcular a conversão.</td></tr>
                  ) : metricas.map(item => {
                    const qualificados = Number(item.qualificados || 0);
                    const vendidos = Number(item.vendidos || 0);
                    const recusados = Number(item.recusados || 0);
                    return (
                      <tr
                        key={item.usuario_id || item.usuario_nome}
                        className="consultor-metricas-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => setConsultorAtivo(item)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setConsultorAtivo(item);
                          }
                        }}
                      >
                        <td><strong>{item.usuario_nome || 'Usuario removido'}</strong></td>
                        <td>{Number(item.ligacoes_realizadas || 0)}</td>
                        <td>{qualificados}</td>
                        <td>{Number(item.retornos_agendados || 0)}</td>
                        <td>{Number(item.clientes_recusaram || 0)}</td>
                        <td>{Number(item.chamadas_nao_atendidas || 0)}</td>
                        <td>{vendidos}</td>
                        <td>{recusados}</td>
                        <td><span className="pill success">{qualificados ? `${((vendidos / qualificados) * 100).toFixed(1)}%` : '0%'}</span></td>
                        <td>{Number(item.potencial_mensal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      <div className="clientes-leads-toolbar">
        <form className="clientes-search" onSubmit={event => event.preventDefault()}>
          <I.Search size={14} />
          <input
            value={busca}
            onChange={event => { setBusca(event.target.value); setPagina(1); }}
            placeholder={modoLixeira ? 'Buscar na lixeira...' : 'Buscar futuros clientes...'}
          />
        </form>
        {modoRecebidos ? (
          <select
            className="clientes-status-filter"
            value={filtroRecebidos}
            onChange={event => { setFiltroRecebidos(event.target.value); setPagina(1); }}
            aria-label="Filtrar encaminhamentos recebidos"
          >
            <option value="acao">Exigem ação</option>
            <option value="todos">Histórico completo</option>
            <option value="aguardando_aceite">Aguardando aceite</option>
            <option value="aceito">Aceitos</option>
            <option value="recusado">Recusados</option>
            <option value="expirado_sem_acao">Expirados</option>
            <option value="cancelado">Cancelados</option>
            <option value="encerrado">Com ação registrada</option>
          </select>
        ) : <select
          className="clientes-status-filter"
          value={filtroSituacao}
          onChange={event => { setFiltroSituacao(event.target.value); setPagina(1); }}
          aria-label="Filtrar situacao dos futuros clientes"
        >
          <option value="">Todas as situacoes</option>
          <option value="em_negociacao">Em negociacao</option>
          <option value="venda_concluida">Vendas concluidas</option>
          <option value="venda_recusada">Vendas recusadas</option>
        </select>}
        {!modoRecebidos && <select
          className="clientes-status-filter"
          value={filtroRetorno}
          onChange={event => { setFiltroRetorno(event.target.value); setPagina(1); }}
          aria-label="Filtrar retorno dos futuros clientes"
        >
          <option value="">Todos os retornos</option>
          <option value="com_retorno">Com retorno</option>
          <option value="vencido">Retornos vencidos</option>
          <option value="sem_retorno">Sem retorno</option>
        </select>}
        {(busca || filtroSituacao || filtroRetorno || (modoRecebidos && filtroRecebidos !== 'acao')) && (
          <button type="button" className="btn btn-sm" onClick={limparFiltros}>Limpar filtros</button>
        )}
        <div className="clientes-leads-actions">
          <div className="clientes-toolbar__meta">
            {total} {modoLixeira ? 'na lixeira' : modoRecebidos ? 'encaminhamento(s)' : 'futuro(s) cliente(s)'}
          </div>
          {modoLixeira ? (
            <button type="button" className="btn" onClick={() => alternarModoLixeira(false)}>
              <I.Return size={14} /> Futuros clientes
            </button>
          ) : podeExcluir ? (
            <button type="button" className="btn btn-danger" onClick={() => alternarModoLixeira(true)}>
              <I.Trash size={14} /> Lixeira
            </button>
          ) : null}
        </div>
      </div>

      {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 4 }}>{sucesso}</div>}
      {erro && <div className="alert-error alert-timed alert-timed--error">{erro}</div>}

      <div className="list-table futuros-clientes-table" style={{ margin: 0 }}>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Envio</th>
                <th>Notas</th>
                <th>Situação</th>
                <th>Retorno</th>
                <th>{modoLixeira ? 'Enviado para lixeira' : 'Marcado em'}</th>
                {modoLixeira && (
                  <>
                    <th>Exclusao definitiva</th>
                    <th>Enviado por</th>
                  </>
                )}
                {colunasDados.map(chave => <th key={chave}><span className="th-label" title={chave}>{chave}</span></th>)}
                {podeExcluir && <th>{modoLixeira ? 'Acoes' : 'Excluir'}</th>}
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={totalColunasTabela} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    {modoLixeira ? 'Carregando lixeira...' : 'Carregando futuros clientes...'}
                  </td>
                </tr>
              ) : linhas.length === 0 ? (
                <tr>
                  <td colSpan={totalColunasTabela} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                    {modoLixeira ? 'Nenhum futuro cliente na lixeira.' : 'Nenhum futuro cliente cadastrado.'}
                  </td>
                </tr>
              ) : (
                linhas.map(linha => {
                  const dados = linha.dados_json || {};
                  return (
                    <tr
                      key={linha.atribuicao_id || linha.id}
                      style={{ cursor: modoLixeira ? 'default' : 'pointer' }}
                      onClick={() => !modoLixeira && setLinhaAtiva(linha)}
                    >
                      <td data-label="Envio" className="m-primary">
                        <span className="tag">{linha.envio?.nome || '-'}</span>
                        <details className="mobile-row-drawer">
                          <summary>Ver dados do futuro cliente</summary>
                          <dl>
                            <dt>Notas</dt>
                            <dd>{linha.futuro_cliente_notas || '-'}</dd>
                            <dt>Situação</dt>
                            <dd>{renderFuturoClienteSituacao(linha)}</dd>
                            <dt>Retorno</dt>
                            <dd className={isRetornoFuturoClienteVencido(linha.futuro_cliente_retorno, agora) ? 'future-return-overdue' : ''}>
                              {linha.futuro_cliente_retorno ? formatarDataHora(linha.futuro_cliente_retorno) : '-'}
                            </dd>
                            <dt>{modoLixeira ? 'Enviado para lixeira' : 'Marcado em'}</dt>
                            <dd>{formatarDataHora(modoLixeira ? linha.futuro_cliente_excluido_em : linha.futuro_cliente_marcado_em)}</dd>
                            {modoLixeira && (
                              <>
                                <dt>Exclusao definitiva</dt>
                                <dd>{formatarData(linha.futuro_cliente_excluir_definitivo_em)}</dd>
                                <dt>Enviado por</dt>
                                <dd>{linha.futuroClienteExcluidoPor?.nome || '-'}</dd>
                              </>
                            )}
                            {colunasDados.map(chave => {
                              const valor = dados[`${chave} (atualizado)`] ?? dados[chave] ?? '';
                              return (
                                <Fragment key={chave}>
                                  <dt>{chave}</dt>
                                  <dd>{valor || '-'}</dd>
                                </Fragment>
                              );
                            })}
                          </dl>
                        </details>
                      </td>
                      <td data-label="Notas" className="m-secondary">
                        <span
                          className={`futuro-cliente-notas-cell ${linha.futuro_cliente_notas ? '' : 'muted'}`}
                          title={linha.futuro_cliente_notas || ''}
                        >
                          {linha.futuro_cliente_notas || '-'}
                        </span>
                      </td>
                      <td data-label="Situação" className="m-meta">
                        {renderFuturoClienteSituacao(linha)}
                      </td>
                      <td data-label="Retorno" className="m-meta">
                        {linha.futuro_cliente_retorno ? (
                          <span className={`pill ${isRetornoFuturoClienteVencido(linha.futuro_cliente_retorno, agora) ? 'danger future-return-overdue' : 'success'}`}>
                            <span className="pill-dot"></span>
                            {formatarDataHora(linha.futuro_cliente_retorno)}
                          </span>
                        ) : '-'}
                      </td>
                      <td data-label={modoLixeira ? 'Enviado para lixeira' : 'Marcado em'} data-mobile-hidden="true">{formatarDataHora(modoLixeira ? linha.futuro_cliente_excluido_em : linha.futuro_cliente_marcado_em)}</td>
                      {modoLixeira && (
                        <>
                          <td data-label="Exclusao definitiva" data-mobile-hidden="true">{formatarData(linha.futuro_cliente_excluir_definitivo_em)}</td>
                          <td data-label="Enviado por" data-mobile-hidden="true"><span className="tag">{linha.futuroClienteExcluidoPor?.nome || '-'}</span></td>
                        </>
                      )}
                      {colunasDados.map(chave => {
                        const valor = dados[`${chave} (atualizado)`] ?? dados[chave] ?? '';
                        return <td key={chave} data-label={chave} data-mobile-hidden="true">{valor || '-'}</td>;
                      })}
                      {podeExcluir && (
                        <td data-label={modoLixeira ? 'Acoes' : 'Excluir'} className="futuros-clientes-delete-col m-actions">
                          <div className="futuros-clientes-actions">
                            {modoLixeira ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={processandoId === linha.id}
                                  onClick={event => {
                                    event.stopPropagation();
                                    handleRestaurar(linha);
                                  }}
                                >
                                  <I.Return size={13} /> Restaurar
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-icon btn-ghost btn-danger-icon"
                                  title="Excluir definitivamente"
                                  disabled={processandoId === linha.id}
                                  onClick={event => {
                                    event.stopPropagation();
                                    setConfirmacaoLixeira({ linha, tipo: 'definitivo' });
                                  }}
                                >
                                  <I.Trash size={13} />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-icon btn-ghost btn-danger-icon"
                                title="Enviar para lixeira"
                                aria-label="Enviar para lixeira"
                                disabled={processandoId === linha.id}
                                onClick={event => {
                                  event.stopPropagation();
                                  setConfirmacaoLixeira({ linha, tipo: 'lixeira' });
                                }}
                              >
                                <I.Trash size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lead-pagination">
        <button className="btn" type="button" disabled={pagina <= 1} onClick={() => setPagina(prev => Math.max(1, prev - 1))}>Anterior</button>
        <span>Página {pagina} de {totalPaginas}</span>
        <button className="btn" type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina(prev => Math.min(totalPaginas, prev + 1))}>Próxima</button>
      </div>
    </div>
  );
}

function inicioDoMesAtual() {
  const data = new Date();
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-01`;
}

function hojeLocal() {
  const data = new Date();
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function obterPeriodoEstatisticas(preset, inicio, fim) {
  if (preset === 'hoje') return { data_inicio: hojeLocal(), data_fim: hojeLocal() };
  if (preset === 'mes') return { data_inicio: inicioDoMesAtual(), data_fim: hojeLocal() };
  if (preset === 'personalizado') return { data_inicio: inicio || undefined, data_fim: fim || undefined };
  return {};
}

const ATIVIDADE_ESTATISTICAS = [
  ['tentativas_registradas', 'Tentativas registradas'],
  ['retornos_agendados', 'Retornos'],
  ['clientes_recusaram', 'Clientes que recusaram'],
  ['chamadas_nao_atendidas', 'Não atendidas']
];

const FUNIL_ESTATISTICAS = [
  ['enviados_telegram', 'Encaminhados pelo Telegram'],
  ['aceitos_telegram', 'Aceites no Telegram'],
  ['recusados_expirados_telegram', 'Recusas/expirações'],
  ['vendas_futuro_cliente', 'Vendas por futuro cliente'],
  ['vendas_antigas', 'Vendas antigas']
];

/** Painel administrativo progressivo: usuarios, mailings e linhas. */
function EstatisticasFuturosClientesView() {
  const [preset, setPreset] = useState('mes');
  const [dataInicio, setDataInicio] = useState(inicioDoMesAtual);
  const [dataFim, setDataFim] = useState(hojeLocal);
  const [resumo, setResumo] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [mailing, setMailing] = useState(null);
  const [mailings, setMailings] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [busca, setBusca] = useState('');
  const buscaDeferred = useDeferredValue(busca);
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const periodo = useMemo(
    () => obterPeriodoEstatisticas(preset, dataInicio, dataFim),
    [preset, dataInicio, dataFim]
  );

  useEffect(() => {
    let ativo = true;
    const requisicao = mailing
      ? listarEstatisticasLinhasMailing(usuario.usuario_id, mailing.envio_id, { ...periodo, busca: buscaDeferred, page: pagina, page_size: 50 })
      : usuario
        ? listarEstatisticasMailingsUsuario(usuario.usuario_id, periodo)
        : listarEstatisticasFuturosClientes(periodo);
    requisicao
      .then(resultado => {
        if (!ativo) return;
        if (mailing) {
          setLinhas(resultado.data || []);
          setTotal(Number(resultado.total || 0));
        } else if (usuario) {
          const mailingsRecebidos = Array.isArray(resultado) ? resultado : (resultado.data || []);
          setMailings(ordenarMailingsMaisRecentes(mailingsRecebidos));
        } else {
          setResumo(resultado);
        }
      })
      .catch(error => ativo && setErro(error.message || 'Não foi possível carregar as estatísticas.'))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [periodo, usuario, mailing, buscaDeferred, pagina]);

  function abrirUsuario(item) {
    setCarregando(true);
    setErro('');
    setUsuario(item);
    setMailing(null);
    setPagina(1);
    setBusca('');
  }

  function abrirMailing(item) {
    setCarregando(true);
    setErro('');
    setMailing(item);
    setPagina(1);
    setBusca('');
  }

  async function exportar() {
    await exportarMetricasFuturosClientesExcel(periodo);
  }

  function prepararNovaConsulta() {
    setCarregando(true);
    setErro('');
  }

  function voltarNivelEstatisticas() {
    prepararNovaConsulta();
    setPagina(1);
    setBusca('');
    if (mailing) {
      setMailing(null);
      return;
    }
    setUsuario(null);
  }

  function abrirTodosUsuarios() {
    prepararNovaConsulta();
    setUsuario(null);
    setMailing(null);
    setPagina(1);
    setBusca('');
  }

  function voltarAoUsuario() {
    prepararNovaConsulta();
    setMailing(null);
    setPagina(1);
    setBusca('');
  }

  const titulo = mailing ? mailing.envio_nome : usuario ? usuario.usuario_nome : 'Todos os usuários';
  const indicadores = usuario || resumo?.total || {};
  const percentualPendente = Number(indicadores.recebidos || 0)
    ? Math.round((Number(indicadores.pendentes || 0) / Number(indicadores.recebidos)) * 100)
    : 0;
  return (
    <section className="future-stats" aria-busy={carregando}>
      <header className="future-stats__header">
        <div className="future-stats__heading">
          <p className="future-stats__eyebrow">Estatísticas de qualificação</p>
          <h2>{titulo}</h2>
          <p className="muted">Os indicadores consideram os leads recebidos no período e as ações realizadas até o encerramento dele.</p>
        </div>
        <button type="button" className="btn future-stats__export" onClick={exportar}><I.Download size={16} /> Exportar Excel</button>
      </header>

      <div className="future-stats__filters">
        <div className="future-stats__filter-title"><I.Calendar size={17} /><span>Período da análise</span></div>
        <label><span className="sr-only">Período</span>
          <select value={preset} onChange={event => { prepararNovaConsulta(); setPreset(event.target.value); }}>
            <option value="hoje">Hoje</option>
            <option value="mes">Este mês</option>
            <option value="personalizado">Período específico</option>
            <option value="todos">Todo o período</option>
          </select>
        </label>
        {preset === 'personalizado' && <>
          <label><span>De</span><input type="date" value={dataInicio} onChange={event => { prepararNovaConsulta(); setDataInicio(event.target.value); }} /></label>
          <label><span>Até</span><input type="date" value={dataFim} onChange={event => { prepararNovaConsulta(); setDataFim(event.target.value); }} /></label>
        </>}
        <span className="future-stats__period-hint">Os indicadores são atualizados conforme o período selecionado.</span>
      </div>

      {(usuario || mailing) && (
        <nav className="future-stats__breadcrumb" aria-label="Navegação das estatísticas">
          <button type="button" className="future-stats__back" onClick={voltarNivelEstatisticas}><I.Return size={16} /> Voltar</button>
          <span className="future-stats__breadcrumb-path">
            <button type="button" onClick={abrirTodosUsuarios}><I.Users size={14} /> Todos os usuários</button>
            <span className="future-stats__breadcrumb-separator" aria-hidden="true">›</span>
            {mailing ? (
              <>
                <button type="button" onClick={voltarAoUsuario}>{usuario.usuario_nome}</button>
                <span className="future-stats__breadcrumb-separator" aria-hidden="true">›</span>
                <span className="future-stats__breadcrumb-current" aria-current="page">{mailing.envio_nome}</span>
              </>
            ) : <span className="future-stats__breadcrumb-current" aria-current="page">{usuario.usuario_nome}</span>}
          </span>
        </nav>
      )}

      {erro && <div className="alert alert-danger">{erro}</div>}
      {carregando && <div className="future-stats__loading">Carregando indicadores...</div>}

      {!carregando && !erro && !mailing && (
        <>
          <div className="future-stats__overview">
            <article className="future-stats__kpi future-stats__kpi--received">
              <div className="future-stats__kpi-icon"><I.Bell size={19} /></div>
              <div><span>Recebidos</span><strong>{Number(indicadores.recebidos || 0).toLocaleString('pt-BR')}</strong><small>no período selecionado</small></div>
            </article>
            <article className="future-stats__kpi future-stats__kpi--worked">
              <div className="future-stats__kpi-icon"><I.Check size={19} /></div>
              <div><span>Trabalhados</span><strong>{Number(indicadores.trabalhados || 0).toLocaleString('pt-BR')}</strong><small>{Number(indicadores.produtividade_pct || 0).toLocaleString('pt-BR')}% de produtividade</small></div>
              <i className="future-stats__kpi-progress"><b style={{ width: `${indicadores.produtividade_pct || 0}%` }} /></i>
            </article>
            <article className="future-stats__kpi future-stats__kpi--pending">
              <div className="future-stats__kpi-icon"><I.History size={19} /></div>
              <div><span>Pendentes</span><strong>{Number(indicadores.pendentes || 0).toLocaleString('pt-BR')}</strong><small>{percentualPendente}% ainda aguardam ação</small></div>
            </article>
            <article className="future-stats__kpi future-stats__kpi--qualified">
              <div className="future-stats__kpi-icon"><I.Chart size={19} /></div>
              <div><span>Qualificados</span><strong>{Number(indicadores.qualificados || 0).toLocaleString('pt-BR')}</strong><small>{Number(indicadores.qualificacao_pct || 0).toLocaleString('pt-BR')}% dos trabalhados</small></div>
            </article>
          </div>

          <div className="future-stats__panels">
            <section className="future-stats__panel">
              <header><div><span className="future-stats__section-kicker">Operação</span><h3>Atividade registrada</h3></div><I.Bell size={18} /></header>
              <div className="future-stats__metric-list">
                {ATIVIDADE_ESTATISTICAS.map(([chave, rotulo]) => <div key={chave}><span>{rotulo}</span><strong>{Number(indicadores[chave] || 0).toLocaleString('pt-BR')}</strong></div>)}
              </div>
            </section>
            <section className="future-stats__panel">
              <header><div><span className="future-stats__section-kicker">Conversão</span><h3>Telegram e vendas</h3></div><I.Chart size={18} /></header>
              <div className="future-stats__metric-list future-stats__metric-list--funnel">
                {FUNIL_ESTATISTICAS.map(([chave, rotulo]) => <div key={chave}><span>{rotulo}</span><strong>{Number(indicadores[chave] || 0).toLocaleString('pt-BR')}</strong></div>)}
              </div>
            </section>
          </div>

          <div className="future-stats__business">
            <article><span>Produtividade</span><strong>{Number(indicadores.produtividade_pct || 0).toLocaleString('pt-BR')}%</strong><small>trabalhados ÷ recebidos</small></article>
            <article><span>Conversão</span><strong>{Number(indicadores.conversao_pct || 0).toLocaleString('pt-BR')}%</strong><small>vendas ÷ qualificados</small></article>
            <article><span>Tempo médio da primeira ação</span><strong>{formatarDuracaoMinutos(indicadores.tempo_medio_primeira_acao_min)}</strong><small>desde o recebimento</small></article>
            <article><span>Potencial mensal</span><strong>{formatarMoedaSondagem(indicadores.potencial_mensal)}</strong><small>estimado nos qualificados</small></article>
            <article className="future-stats__business-sold"><span>Valor vendido</span><strong>{formatarMoedaSondagem(indicadores.valor_vendido)}</strong><small>vendas por futuro cliente</small></article>
          </div>
          <p className="muted future-stats__note">Históricos antigos de tentativas podem estar incompletos. Quando há primeira ação sem auditoria, é contabilizada ao menos uma tentativa.</p>
        </>
      )}

      {!carregando && !erro && !usuario && (
        <section className="future-stats__table-panel future-stats__team-panel">
          <header>
            <div>
              <span className="future-stats__section-kicker">Equipe</span>
              <h3>Desempenho por usuário</h3>
              <p>Compare a operação e abra uma pessoa para analisar seus mailings e leads.</p>
            </div>
            <span className="future-stats__team-count"><I.Users size={14} /> {resumo?.usuarios?.length || 0} usuário(s)</span>
          </header>
          {(resumo?.usuarios || []).length > 0 ? (
            <div className="future-stats__user-grid">
              {resumo.usuarios.map(item => (
                <button
                  type="button"
                  className="future-stats__user-card"
                  key={item.usuario_id}
                  onClick={() => abrirUsuario(item)}
                  aria-label={`Analisar desempenho de ${item.usuario_nome}`}
                >
                  <span className="future-stats__user-card-head">
                    <span className="future-stats__user-avatar">{String(item.usuario_nome || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className="future-stats__user-identity">
                      <strong>{item.usuario_nome}</strong>
                      <small>Ver mailings e leads</small>
                    </span>
                    <span className="future-stats__user-arrow"><I.ArrowRight size={17} /></span>
                  </span>

                  <span className="future-stats__user-numbers">
                    <span><small>Recebidos</small><strong>{Number(item.recebidos || 0).toLocaleString('pt-BR')}</strong></span>
                    <span><small>Trabalhados</small><strong>{Number(item.trabalhados || 0).toLocaleString('pt-BR')}</strong></span>
                    <span className={item.pendentes ? 'is-pending' : ''}><small>Pendentes</small><strong>{Number(item.pendentes || 0).toLocaleString('pt-BR')}</strong></span>
                  </span>

                  <span className="future-stats__user-performance">
                    <span>
                      <span><small>Produtividade</small><strong>{Number(item.produtividade_pct || 0).toLocaleString('pt-BR')}%</strong></span>
                      <i className="future-stats__user-progress"><b style={{ width: `${item.produtividade_pct || 0}%` }} /></i>
                    </span>
                    <span>
                      <span><small>Conversão</small><strong>{Number(item.conversao_pct || 0).toLocaleString('pt-BR')}%</strong></span>
                      <i className="future-stats__user-progress future-stats__user-progress--success"><b style={{ width: `${Math.min(100, item.conversao_pct || 0)}%` }} /></i>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : <div className="empty-state">Nenhum usuário encontrado no período.</div>}
        </section>
      )}

      {!carregando && !erro && usuario && !mailing && (
        <section className="future-stats__table-panel future-stats__mailings-panel">
          <header>
            <div>
              <span className="future-stats__section-kicker">Origem dos dados</span>
              <h3>Mailings recebidos</h3>
              <p>Compare os resultados e abra um mailing para analisar cada lead.</p>
            </div>
            <span className="future-stats__team-count"><I.TableSheet size={14} /> {mailings.length} mailing(s)</span>
          </header>
          {mailings.length > 0 ? (
            <div className="table-wrap future-stats__mailing-list">
              <table>
                <thead>
                  <tr>
                    <th>Mailing</th>
                    <th>Recebidos</th>
                    <th>Trabalhados</th>
                    <th>Qualificados</th>
                    <th>Vendas</th>
                    <th>Produtividade</th>
                    <th>Conversão</th>
                    <th><span className="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {mailings.map(item => (
                    <tr key={item.envio_id}>
                      <td>
                        <button
                          type="button"
                          className="future-stats__mailing-list-link"
                          onClick={() => abrirMailing(item)}
                          aria-label={`Analisar leads do mailing ${item.envio_nome}`}
                        >
                          <span className="future-stats__mailing-icon"><I.TableSheet size={17} /></span>
                          <span className="future-stats__mailing-identity">
                            <strong>{item.envio_nome}</strong>
                            <small>Mailing #{item.envio_id}</small>
                          </span>
                        </button>
                      </td>
                      <td><strong className="future-stats__mailing-value">{Number(item.recebidos || 0).toLocaleString('pt-BR')}</strong></td>
                      <td><strong className="future-stats__mailing-value">{Number(item.trabalhados || 0).toLocaleString('pt-BR')}</strong></td>
                      <td><strong className="future-stats__mailing-value">{Number(item.qualificados || 0).toLocaleString('pt-BR')}</strong></td>
                      <td><strong className={`future-stats__mailing-value ${item.vendas_futuro_cliente ? 'has-sales' : ''}`}>{Number(item.vendas_futuro_cliente || 0).toLocaleString('pt-BR')}</strong></td>
                      <td>
                        <span className="future-stats__mailing-rate">
                          <i className="future-stats__user-progress"><b style={{ width: `${item.produtividade_pct || 0}%` }} /></i>
                          <strong>{Number(item.produtividade_pct || 0).toLocaleString('pt-BR')}%</strong>
                        </span>
                      </td>
                      <td>
                        <span className="future-stats__mailing-rate">
                          <i className="future-stats__user-progress future-stats__user-progress--success"><b style={{ width: `${Math.min(100, item.conversao_pct || 0)}%` }} /></i>
                          <strong>{Number(item.conversao_pct || 0).toLocaleString('pt-BR')}%</strong>
                        </span>
                      </td>
                      <td><button type="button" className="future-stats__mailing-open" onClick={() => abrirMailing(item)} aria-label={`Abrir mailing ${item.envio_nome}`}><I.ArrowRight size={17} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">Nenhum mailing encontrado no período.</div>}
        </section>
      )}

      {!carregando && !erro && mailing && (
        <>
          <div className="future-stats__search"><I.Search size={16} /><input value={busca} onChange={event => { setBusca(event.target.value); setPagina(1); }} placeholder="Buscar lead neste mailing" /></div>
          <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Recebido</th><th>Primeira ação</th><th>Tentativas</th><th>Resultado</th></tr></thead>
            <tbody>{linhas.map(linha => <tr key={linha.id}><td>{encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.razao_social) || encontrarValorLeadPorAliases(linha, CAMPOS_EMPRESA_FUTURO_CLIENTE.cnpj) || `Lead #${linha.id}`}</td><td>{formatarDataHora(linha.recebido_em)}</td><td>{formatarDataHora(primeiraAcaoVisual(linha))}</td><td>{linha.tentativas_conhecidas || 0}</td><td>{renderFuturoClienteSituacao(linha)}</td></tr>)}</tbody>
          </table>{!linhas.length && <div className="empty-state">Nenhum lead encontrado.</div>}</div>
          <div className="lead-pagination"><button className="btn" type="button" disabled={pagina <= 1} onClick={() => setPagina(value => value - 1)}>Anterior</button><span>Página {pagina} de {Math.max(1, Math.ceil(total / 50))}</span><button className="btn" type="button" disabled={pagina * 50 >= total} onClick={() => setPagina(value => value + 1)}>Próxima</button></div>
        </>
      )}
    </section>
  );
}

function primeiraAcaoVisual(linha) {
  return linha.estatistica_primeira_acao_considerada_em || null;
}

// ─── Página principal ─────────────────────────────────────────────────────────

/** Alterna entre a carteira do usuário e a visão geral permitida. */
export function SeletorEscopoFuturosClientes({ escopoTodos, onChange }) {
  return (
    <div className="future-scope-switch" role="group" aria-label="Escopo dos futuros clientes">
      <button type="button" className={!escopoTodos ? 'active' : ''} aria-pressed={!escopoTodos} onClick={() => onChange(false)}>Meus</button>
      <button type="button" className={escopoTodos ? 'active' : ''} aria-pressed={escopoTodos} onClick={() => onChange(true)}>Todos</button>
    </div>
  );
}

/**
 * Renderiza futuros clientes page.
 */
function FuturosClientesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const usuario = getUsuarioLocal();
  const podeVerTodos = temPermissao(usuario, 'futuros_clientes_ver_todos');
  const podeVerEstatisticas = temPermissao(usuario, 'gerenciar_leads');
  const abaDaNotificacao = resolverAbaFuturosClientes(searchParams.get('aba'), podeVerEstatisticas);
  const [abaSelecionada, setAbaSelecionada] = useState('meus');
  const [escopoTodos, setEscopoTodos] = useState(false);
  const abaAtiva = searchParams.has('aba') ? abaDaNotificacao : abaSelecionada;
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setAgora(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  function selecionarAba(aba) {
    setAbaSelecionada(aba);
    if (searchParams.has('aba') || searchParams.has('linha_id')) {
      setSearchParams({}, { replace: true });
    }
  }

  return (
    <LayoutPrivado>
      <div className="futuros-clientes-page">
        <div className="clientes-tabs">
          <button
            type="button"
            className={`clientes-tab ${abaAtiva === 'meus' ? 'active' : ''}`}
            onClick={() => selecionarAba('meus')}
          >
            Meus Futuros Clientes
          </button>
          <button
            type="button"
            className={`clientes-tab ${abaAtiva === 'recebidos' ? 'active' : ''}`}
            onClick={() => selecionarAba('recebidos')}
          >
            Futuros Clientes Recebidos
          </button>
          <button type="button" className={`clientes-tab ${abaAtiva === 'mailings' ? 'active' : ''}`} onClick={() => selecionarAba('mailings')}>Mailings Recebidos</button>
          {podeVerEstatisticas && <button type="button" className={`clientes-tab ${abaAtiva === 'estatisticas' ? 'active' : ''}`} onClick={() => selecionarAba('estatisticas')}>Estatísticas</button>}
        </div>

        {abaAtiva === 'meus' && <>
          {podeVerTodos && <SeletorEscopoFuturosClientes escopoTodos={escopoTodos} onChange={setEscopoTodos} />}
          <FuturosClientesMainView agora={agora} tipo="meus" escopoTodos={escopoTodos} />
        </>}
        {abaAtiva === 'recebidos' && <FuturosClientesMainView agora={agora} tipo="recebidos" />}
        {abaAtiva === 'mailings' && <LeadsRecebidosView agora={agora} />}
        {abaAtiva === 'estatisticas' && podeVerEstatisticas && <EstatisticasFuturosClientesView />}
      </div>
    </LayoutPrivado>
  );
}

export default FuturosClientesPage;
