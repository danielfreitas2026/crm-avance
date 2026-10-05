import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import Paginacao from '../../components/Paginacao/Paginacao';
import VendaModal from '../VendasPage/VendaModal';
import ClienteModal from '../Clientes/ClienteModal';
import { listarAuditLogs, listarHistoricoVendasAgrupado } from '../../services/audit-log.service';
import { listarEtapasFunil, listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { buscarClientePorId, listarClientesSelect } from '../../services/cliente.service';
import {
  atualizarVenda,
  buscarVendaPorId,
  enviarVendaParaPosVenda,
  listarVendedoras,
  obterReferenciasClientesVendas
} from '../../services/venda.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { STAGES as FALLBACK_STAGES } from '../../config/constants';
import { formatUtcDateTime, getUtcDateTimeTimestamp } from '../../utils/datetime';
import { getAutorHistorico } from '../../utils/origemHistorico';
import AlteracoesHistorico from './AlteracoesHistorico';
import '../VendasPage/VendasPage.css';
import '../Clientes/Clientes.css';

const ACAO_LABELS = {
  'auth.login': 'Login realizado',
  'auth.login_falha': 'Falha no login',
  'auth.perfil_atualizado': 'Perfil atualizado',
  'usuario.criado': 'Usuário criado',
  'usuario.atualizado': 'Usuário atualizado',
  'usuario.excluido': 'Usuário excluído',
  'venda.criada': 'Venda criada',
  'venda.atualizada': 'Venda atualizada',
  'venda.status_atualizado': 'Status da venda atualizado',
  'venda.retorno_registrado': 'Venda em retorno',
  'venda.retorno_corrigido': 'Retorno corrigido',
  'venda.cancelada': 'Venda cancelada',
  'venda.cancelamento_revertido': 'Cancelamento revertido',
  'venda.enviada_lixeira': 'Venda enviada para lixeira',
  'venda.restaurada': 'Venda restaurada',
  'venda.excluida_definitivamente': 'Venda excluída definitivamente',
  'venda.enviada_pos_venda': 'Venda enviada para pós-venda',
  'cliente.criado': 'Cliente criado',
  'cliente.atualizado': 'Cliente atualizado',
  'cliente.enviado_lixeira': 'Cliente enviado para lixeira',
  'cliente.restaurado': 'Cliente restaurado',
  'cliente.excluido_definitivamente': 'Cliente excluído definitivamente',
  'clientes.base_anterior_importada': 'Base anterior importada',
  'clientes.base_anterior_limpa': 'Base anterior limpa',
};

const FILTROS_HISTORICO = [
  { id: 'todos', label: 'Todos' },
  { id: 'vendas', label: 'Histórico de entrega da venda', entidade: 'vendas', temFiltroStatus: true },
  { id: 'clientes', label: 'Clientes', entidade: 'clientes' },
  { id: 'usuarios', label: 'Usuários', entidade: 'usuarios' },
  { id: 'acoes', label: 'Ações', tipo: 'acoes' },
  { id: 'acessos', label: 'Acessos', tipo: 'acessos' },
  { id: 'falhas', label: 'Falhas', tipo: 'falhas' },
  { id: 'cancelamentos', label: 'Cancelamentos', tipo: 'cancelamentos' }
];

const FILTROS_STATUS_VENDA = [
  { id: 'ativas', label: 'Ativas' },
  { id: 'canceladas', label: 'Canceladas' },
  { id: 'lixeira', label: 'Lixeira (Excluídas)' }
];

const FUNIL_STAGES = FALLBACK_STAGES.map((stage, index) => ({
  id: stage.id,
  nome: stage.name,
  ordem: Number(stage.ordem ?? index),
  etapaFinal: Boolean(stage.etapaFinal || stage.etapa_final)
}));

const DEFAULT_STAGE_NAMES_MAP = {
  ...Object.fromEntries(FUNIL_STAGES.map(stage => [stage.id, stage.nome])),
  retorno: 'Retorno'
};

/**
 * Converte dados para o formato interno esperado.
 */
function parseDados(dados) {
  if (!dados) return {};
  if (typeof dados === 'object') return dados;

  try {
    return JSON.parse(dados);
  } catch {
    return {};
  }
}

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(valor) {
  return formatUtcDateTime(valor, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Formata acao para exibicao ou envio.
 */
function formatarAcao(acao) {
  return ACAO_LABELS[acao] || acao.replaceAll('.', ' ');
}

/**
 * Verifica se plain object atende a condicao esperada.
 */
function isPlainObject(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor);
}

/**
 * Formata campo para exibicao ou envio.
 */
function formatarCampo(campo = '') {
  const labels = {
    id: 'ID',
    nome: 'Nome',
    email: 'E-mail',
    telefone: 'Telefone',
    documento: 'Documento',
    cnpj: 'CNPJ',
    cpf: 'CPF',
    razao_social: 'Razao social',
    nome_fantasia: 'Nome fantasia',
    status_funil: 'Etapa do funil',
    status_anterior: 'Etapa anterior',
    observacao: 'Observacao',
    motivo_cancelamento: 'Motivo do cancelamento',
    cancelada_em: 'Cancelada em',
    restaurada_em: 'Restaurada em',
    deleted_at: 'Excluido em',
    updated_at: 'Atualizado em',
    created_at: 'Criado em',
    usuario_id: 'Usuario',
    venda_id: 'Venda',
    cliente_id: 'Cliente'
  };

  if (labels[campo]) return labels[campo];

  return campo
    .replaceAll('_', ' ')
    .replaceAll('.', ' ')
    .replace(/\b\w/g, letra => letra.toUpperCase());
}

/**
 * Formata valor para exibicao ou envio.
 */
function formatarValor(valor, campo = '', stageNamesMap = DEFAULT_STAGE_NAMES_MAP) {
  if (valor === null || valor === undefined || valor === '') return 'Nao informado';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Nao';
  if (typeof valor === 'number') return String(valor);

  if (typeof valor === 'string') {
    if (campo.includes('status') && stageNamesMap[valor]) return stageNamesMap[valor];
    if (/^\d{4}-\d{2}-\d{2}T/.test(valor)) return formatarData(valor);
    return valor;
  }

  return JSON.stringify(valor);
}

/**
 * Processa extrair motivo cancelamento conforme as regras do dominio.
 */
function extrairMotivoCancelamento(log) {
  const dados = parseDados(log?.dados);
  const motivo = dados?.motivo_cancelamento
    || dados?.motivo
    || dados?.alteracoes?.motivo_cancelamento
    || dados?.payload?.motivo_cancelamento
    || dados?.payload?.motivo
    || dados?.venda?.motivo_cancelamento
    || log?.motivo_cancelamento
    || null;

  return motivo ? String(motivo).trim() : null;
}

/**
 * Retorna campos visiveis a partir dos dados informados.
 */
function getCamposVisiveis(objeto = {}, ocultar = []) {
  if (!isPlainObject(objeto)) return [];
  const ocultos = new Set(ocultar);

  return Object.entries(objeto)
    .filter(([campo, valor]) => !ocultos.has(campo) && valor !== null && valor !== undefined && valor !== '')
    .slice(0, 12);
}

/**
 * Monta mapa referencias a partir dos dados informados.
 */
function montarMapaReferencias(referencias = [], campo) {
  const mapa = new Map();
  referencias.forEach(item => {
    if (item?.chave) mapa.set(item.chave, Number(item[campo] || 0));
  });
  return mapa;
}

/**
 * Processa lista campos conforme as regras do dominio.
 */
function ListaCampos({ titulo, dados, ocultar = [], stageNamesMap }) {
  const campos = getCamposVisiveis(dados, ocultar);

  if (campos.length === 0) return null;

  return (
    <div className="history-data-block">
      <h5>{titulo}</h5>
      <div className="history-field-list">
        {campos.map(([campo, valor]) => (
          <div className="history-field-row" key={campo}>
            <span className="history-field-label">{formatarCampo(campo)}</span>
            <span className="history-field-value">{formatarValor(valor, campo, stageNamesMap)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Processa dados operacao conforme as regras do dominio.
 */
function DadosOperacao({ dados, stageNamesMap }) {
  if (!dados || Object.keys(dados).length === 0) return null;

  const gruposConhecidos = [
    ['Venda', dados.venda, ['historico']],
    ['Cliente', dados.cliente],
    ['Usuario afetado', dados.usuario],
    ['Movimentacao', dados.movimentacao],
    ['Dados enviados', dados.payload]
  ];

  const chavesOcultas = new Set(['alteracoes', 'alteracoes_detalhadas', 'venda', 'cliente', 'usuario', 'movimentacao', 'payload']);
  const demaisDados = Object.fromEntries(Object.entries(dados).filter(([campo]) => !chavesOcultas.has(campo)));

  return (
    <div className="history-detail-section">
      <h4>Dados da Operacao</h4>
      <AlteracoesHistorico dados={dados} stageNamesMap={stageNamesMap} />
      {gruposConhecidos.map(([titulo, grupo, ocultar]) => (
        <ListaCampos key={titulo} titulo={titulo} dados={grupo} ocultar={ocultar} stageNamesMap={stageNamesMap} />
      ))}
      <ListaCampos titulo="Outras informacoes" dados={demaisDados} stageNamesMap={stageNamesMap} />
      <details className="history-raw-data">
        <summary>Ver dados tecnicos em JSON</summary>
        <pre className="history-detail-data">
          {JSON.stringify(dados, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/**
 * Normaliza etapas para uso interno consistente.
 */
function normalizarEtapas(etapas = []) {
  return etapas
    .map((etapa, index) => ({
      id: etapa.codigo || etapa.id,
      nome: etapa.nome || etapa.name || etapa.codigo || etapa.id,
      ordem: Number(etapa.ordem ?? index),
      etapaFinal: Boolean(etapa.etapa_final || etapa.etapaFinal)
    }))
    .filter(etapa => etapa.id)
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * Monta mapa nomes etapas a partir dos dados informados.
 */
function montarMapaNomesEtapas(etapas = []) {
  return {
    ...DEFAULT_STAGE_NAMES_MAP,
    ...Object.fromEntries(etapas.map(etapa => [etapa.id, etapa.nome])),
    retorno: 'Retorno'
  };
}

/**
 * Retorna movimentacao historico a partir dos dados informados.
 */
function getMovimentacaoHistorico(log) {
  const dados = parseDados(log.dados);
  const movimentacao = dados?.movimentacao || {};

  return {
    statusAnterior: movimentacao.status_anterior
      || dados?.status_anterior
      || dados?.alteracoes?.status_anterior
      || null,
    statusNovo: movimentacao.status_novo
      || dados?.status_funil
      || dados?.alteracoes?.status_funil
      || dados?.payload?.status_funil
      || dados?.venda?.status_funil
      || null
  };
}

/**
 * Calcula etapas puladas com base nos valores informados.
 */
function calcularEtapasPuladas(statusAnterior, statusNovo, etapas = []) {
  if (!statusAnterior || !statusNovo || statusAnterior === statusNovo) return [];
  if (statusAnterior === 'retorno' || statusNovo === 'retorno') return [];

  const origem = etapas.findIndex(etapa => etapa.id === statusAnterior);
  const destino = etapas.findIndex(etapa => etapa.id === statusNovo);

  if (origem < 0 || destino < 0 || destino <= origem + 1) return [];

  return etapas.slice(origem + 1, destino);
}

/**
 * Processa enriquecer grupo com pulos conforme as regras do dominio.
 */
function enriquecerGrupoComPulos(grupo, etapas = []) {
  const primeiraEtapa = etapas[0]?.id || null;
  let statusAtual = null;

  const logs = grupo.logs.map(log => {
    const { statusAnterior, statusNovo } = getMovimentacaoHistorico(log);
    const origem = statusAnterior || statusAtual || (statusNovo ? primeiraEtapa : null);
    const etapasPuladas = calcularEtapasPuladas(origem, statusNovo, etapas);

    if (statusNovo) {
      statusAtual = statusNovo;
    }

    return {
      ...log,
      statusAnteriorInferido: origem,
      statusNovoInferido: statusNovo,
      etapasPuladas
    };
  });

  return { ...grupo, logs };
}

/**
 * Monta detalhe a partir dos dados informados.
 */
function montarDetalhe(log) {
  const dados = parseDados(log.dados);
  const partes = [];

  if (log.entidade_id) {
    partes.push(`#${log.entidade_id}`);
  }

  if (dados?.usuario?.nome) {
    partes.push(dados.usuario.nome);
  } else if (dados?.alteracoes?.email) {
    partes.push(dados.alteracoes.email);
  } else if (dados?.email) {
    partes.push(dados.email);
  }

  return partes.length ? ` · ${partes.join(' ')}` : '';
}

/**
 * Retorna tipo a partir dos dados informados.
 */
function getTipo(log) {
  if (log.acao?.includes('falha')) return 'danger';
  if (log.acao === 'venda.cancelada') return 'danger';
  if (log.acao === 'venda.excluida_definitivamente') return 'deleted';
  if (log.acao === 'venda.enviada_lixeira') return 'trash';
  if (log.acao === 'venda.restaurada') return 'restore';
  if (log.acao?.includes('login')) return 'neutral';
  return 'success';
}

/**
 * Renderiza marker icon.
 */
function MarkerIcon({ log, size = 12 }) {
  switch (log.acao) {
    case 'venda.cancelada':
      return <I.AlertTriangle size={size} />;
    case 'venda.enviada_lixeira':
      return <I.TrashSend size={size} />;
    case 'venda.restaurada':
      return <I.TrashRestore size={size} />;
    case 'venda.excluida_definitivamente':
      return <I.Trash size={size} />;
    default:
      if (log.acao?.includes('falha')) return <I.AlertTriangle size={size} />;
      return <I.Check size={size} />;
  }
}

/**
 * Processa historico item conforme as regras do dominio.
 */
function HistoricoItem({ log, selecionado, compacto, onClick }) {
  const tipo = getTipo(log);
  const usuario = getAutorHistorico(log);

  return (
    <div 
      className={`history-item ${compacto ? 'history-item--compact' : ''} ${tipo} ${selecionado ? 'selected' : ''}`}
      onClick={() => onClick(log)}
      style={{ cursor: 'pointer' }}
    >
      <div className="history-marker">
        <MarkerIcon log={log} size={12} />
      </div>
      <div className="history-content">
        {compacto ? (
          <div className="history-main-line">
            <div className="history-title">
              <strong>{formatarAcao(log.acao)}</strong>
              <span>{montarDetalhe(log)}</span>
            </div>
            <div className="history-meta">
              <span>{usuario}</span>
              <span>·</span>
              <span>{log.metodo || 'API'} {log.rota || ''}</span>
              <span>·</span>
              <span>{formatarData(log.created_at)}</span>
            </div>
          </div>
        ) : (
        <>
        <div className="history-title">
          <strong>{formatarAcao(log.acao)}</strong>
          <span>{montarDetalhe(log)}</span>
        </div>
        <div className="history-meta">
          <span>{usuario}</span>
          <span>·</span>
          <span>{log.metodo || 'API'} {log.rota || ''}</span>
          <span>·</span>
          <span>{formatarData(log.created_at)}</span>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

/**
 * Processa extrair nome venda conforme as regras do dominio.
 */
function extrairNomeVenda(logs, vendaId) {
  for (const log of logs) {
    const dados = parseDados(log.dados);

    if (log.acao === 'venda.criada') {
      const v = dados.venda;
      if (v) return v.razao_social || v.nome || null;
    }

    if (log.acao === 'venda.atualizada') {
      const alt = dados.alteracoes;
      if (alt) return alt.razao_social || alt.nome || null;
    }
  }

  return `Venda #${vendaId}`;
}

/**
 * Processa build stage progression conforme as regras do dominio.
 */
function buildStageProgression(logs, etapas = []) {
  const sorted = [...logs].sort((a, b) => getUtcDateTimeTimestamp(a.created_at) - getUtcDateTimeTimestamp(b.created_at));
  const stagesBase = etapas.length > 0 ? etapas : FUNIL_STAGES;
  const stageIds = stagesBase.map(stage => stage.id);
  const primeiraEtapa = stageIds[0] || 'aprovacao';

  const reached = new Map();
  let currentStage = null;
  let hasRetorno = false;
  let cancelamento = null;

  for (const log of sorted) {
    const dados = parseDados(log.dados);
    const usuario = getAutorHistorico(log);

    if (log.acao === 'venda.criada') {
      if (!reached.has(primeiraEtapa)) {
        reached.set(primeiraEtapa, { data: log.created_at, usuario, log });
      }
      currentStage = primeiraEtapa;
    } else if (log.acao === 'venda.status_atualizado') {
      const stage = getMovimentacaoHistorico({ ...log, dados }).statusNovo;
      if (stage === 'retorno') {
        hasRetorno = true;
      } else if (stage && stageIds.includes(stage)) {
        if (!reached.has(stage)) {
          reached.set(stage, { data: log.created_at, usuario, log });
        }
        currentStage = stage;
      }
    } else if (log.acao === 'venda.cancelada') {
      const stageId = log.status_novo || log.status_anterior || currentStage || 'aprovacao';
      cancelamento = {
        data: log.created_at,
        usuario,
        log,
        stageId,
        motivo: extrairMotivoCancelamento(log)
      };
      if (stageIds.includes(stageId)) currentStage = stageId;
    }
  }

  if (!currentStage) currentStage = primeiraEtapa;

  const stages = stagesBase.map((stage, idx) => {
    const stageData = reached.get(stage.id);
    const isCurrent = stage.id === currentStage;
    const isReached = reached.has(stage.id);
    const isCancelled = cancelamento?.stageId === stage.id;

    let status;
    if (isCancelled) {
      status = 'cancelled';
    } else if (isCurrent) {
      status = 'current';
    } else if (isReached) {
      status = 'done';
    } else {
      const hasBefore = stageIds.slice(0, idx).some(id => reached.has(id));
      const hasAfter = stageIds.slice(idx + 1).some(id => reached.has(id));
      status = (hasBefore && hasAfter) ? 'skipped' : 'pending';
    }

    return {
      ...stage,
      name: stage.nome || stage.name || stage.id,
      status,
      data: isCancelled ? cancelamento.data : stageData?.data,
      usuario: isCancelled ? cancelamento.usuario : stageData?.usuario,
      log: isCancelled ? cancelamento.log : stageData?.log,
      motivoCancelamento: isCancelled ? cancelamento.motivo : null
    };
  });

  return { stages, hasRetorno, currentStage, cancelamento };
}

/**
 * Retorna connector type a partir dos dados informados.
 */
function getConnectorType(stageA, stageB) {
  if (stageA.status === 'skipped' || stageB.status === 'skipped') return 'skip';
  if (
    (stageA.status === 'done' || stageA.status === 'current' || stageA.status === 'cancelled') &&
    (stageB.status === 'done' || stageB.status === 'current' || stageB.status === 'cancelled')
  ) return 'done';
  return 'pending';
}

/**
 * Renderiza funil tracker com os dados informados.
 */
function FunilTracker({ progression, logSelecionado, onClickLog }) {
  const { stages, hasRetorno } = progression;

  return (
    <div className="funil-tracker" role="list" aria-label="Progresso no funil">
      {stages.map((stage, idx) => {
        const isClickable = !!stage.log;
        const isSelected = stage.log && logSelecionado?.id === stage.log.id;
        const connectorType = idx < stages.length - 1
          ? getConnectorType(stage, stages[idx + 1])
          : null;

        return (
          <div
            key={stage.id}
            className={`funil-stage funil-stage--${stage.status}`}
            role="listitem"
            data-connector={connectorType}
          >
            <button
              type="button"
              className={`funil-stage__btn${isSelected ? ' selected' : ''}`}
              onClick={() => isClickable && onClickLog(stage.log)}
              disabled={!isClickable}
              title={
                stage.motivoCancelamento
                  ? `Motivo: ${stage.motivoCancelamento}`
                  : (stage.status === 'skipped' ? `Etapa pulada: ${stage.name}` : stage.name)
              }
            >
              <div className="funil-stage__dot">
                {stage.status === 'done' && <I.Check size={10} />}
                {stage.status === 'current' && <span className="funil-stage__inner" />}
                {stage.status === 'skipped' && <I.AlertTriangle size={10} />}
                {stage.status === 'cancelled' && <I.Close size={11} />}
              </div>
              <span className="funil-stage__name">{stage.name}</span>
              {stage.data && (
                <span className="funil-stage__date">{formatarData(stage.data)}</span>
              )}
              {stage.motivoCancelamento && (
                <span className="funil-stage__reason">
                  <strong>Motivo:</strong> {stage.motivoCancelamento}
                </span>
              )}
            </button>
          </div>
        );
      })}
      {hasRetorno && (
        <div className="funil-retorno-flag" title="Esta venda teve retorno registrado">
          <I.AlertTriangle size={10} />
          <span>Retorno</span>
        </div>
      )}
    </div>
  );
}

/**
 * Retorna grupo venda id a partir dos dados informados.
 */
function getGrupoVendaId(log) {
  if (log.entidade_id) return String(log.entidade_id);

  const dados = parseDados(log.dados);
  return String(dados?.venda?.id || dados?.venda_id || log.id);
}

/**
 * Agrupa logs venda para consumo posterior.
 */
function agruparLogsVenda(logs = []) {
  const grupos = new Map();

  logs.forEach(log => {
    const vendaId = getGrupoVendaId(log);
    const grupoAtual = grupos.get(vendaId) || {
      vendaId,
      logs: []
    };

    grupoAtual.logs.push(log);
    grupos.set(vendaId, grupoAtual);
  });

  return Array.from(grupos.values()).map(grupo => ({
    ...grupo,
    logs: grupo.logs.sort((a, b) => getUtcDateTimeTimestamp(a.created_at) - getUtcDateTimeTimestamp(b.created_at)),
    maisRecente: grupo.logs.reduce((recente, log) => (
      !recente || getUtcDateTimeTimestamp(log.created_at) > getUtcDateTimeTimestamp(recente.created_at) ? log : recente
    ), null)
  })).sort((a, b) => getUtcDateTimeTimestamp(b.maisRecente?.created_at) - getUtcDateTimeTimestamp(a.maisRecente?.created_at));
}

/**
 * Processa venda historico grupo conforme as regras do dominio.
 */
function VendaHistoricoGrupo({ grupo, etapasFunil, stageNamesMap, logSelecionado, onClick, onAbrirVenda, modalCarregando }) {
  const [expandido, setExpandido] = useState(false);
  const progression = buildStageProgression(grupo.logs, etapasFunil);
  const currentStageName = stageNamesMap[progression.currentStage] || progression.currentStage;
  const skippedCount = progression.stages.filter(s => s.status === 'skipped').length;
  const nomeCliente = extrairNomeVenda(grupo.logs, grupo.vendaId);
  const motivoCancelamento = progression.cancelamento?.motivo;

  return (
    <div className="history-sale-row">
      <div className="history-sale-row__head">
        <strong className="history-sale-row__client" title={nomeCliente}>{nomeCliente}</strong>
        <span className="history-sale-row__id">#{grupo.vendaId}</span>
        <span className="history-sale-row__stage-badge">{currentStageName}</span>
        {skippedCount > 0 && (
          <span className="history-sale-row__tag tag-skipped">
            <I.AlertTriangle size={9} /> {skippedCount} pulada{skippedCount > 1 ? 's' : ''}
          </span>
        )}
        {progression.hasRetorno && (
          <span className="history-sale-row__tag tag-retorno">
            <I.AlertTriangle size={9} /> Retorno
          </span>
        )}
        {progression.cancelamento && (
          <span className="history-sale-row__tag tag-cancelada" title={motivoCancelamento ? `Motivo: ${motivoCancelamento}` : undefined}>
            <I.AlertTriangle size={9} /> Cancelada
          </span>
        )}
        <button
          type="button"
          className="history-sale-row__open"
          onClick={() => onAbrirVenda(grupo.vendaId)}
          disabled={modalCarregando === `venda:${grupo.vendaId}`}
          title="Abrir venda completa"
        >
          <I.External size={11} />
          <span>{modalCarregando === `venda:${grupo.vendaId}` ? 'Abrindo...' : 'Abrir venda'}</span>
        </button>
        <button
          type="button"
          className={`history-sale-row__events-toggle${expandido ? ' open' : ''}`}
          onClick={() => setExpandido(v => !v)}
          title={expandido ? 'Ocultar eventos' : 'Ver eventos'}
        >
          <I.ChevronDown size={12} />
          <span>{grupo.logs.length} eventos</span>
        </button>
      </div>

      <div className="history-sale-row__body">
        <FunilTracker
          progression={progression}
          logSelecionado={logSelecionado}
          onClickLog={onClick}
        />

        {expandido && (
          <div className="history-sale-row__scroll" role="list" aria-label={`Eventos da venda ${grupo.vendaId}`}>
            {grupo.logs.map((log, index) => {
              const tipo = getTipo(log);
              const usuario = getAutorHistorico(log);
              const selecionado = logSelecionado?.id === log.id;

              return (
                <button
                  key={log.id}
                  type="button"
                  className={`history-sale-step ${tipo} ${selecionado ? 'selected' : ''}`}
                  onClick={() => onClick(log)}
                  role="listitem"
                >
                  <span className="history-sale-step__marker">
                    <MarkerIcon log={log} size={11} />
                  </span>
                  <span className="history-sale-step__body">
                    <strong>{formatarAcao(log.acao)}</strong>
                    <small>{usuario} · {formatarData(log.created_at)}</small>
                  </span>
                  {index < grupo.logs.length - 1 && <span className="history-sale-step__line" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renderiza detalhe card.
 */
function DetalheCard({ log, stageNamesMap = DEFAULT_STAGE_NAMES_MAP, onClose, onAbrirVenda, onAbrirCliente, podeAbrirCliente, modalCarregando }) {
  const dados = parseDados(log.dados);
  const motivoCancelamento = extrairMotivoCancelamento(log);
  const podeAbrirVenda = log.entidade === 'vendas' && log.entidade_id;
  const podeAbrirClienteLog = log.entidade === 'clientes' && log.entidade_id && podeAbrirCliente;
  const stageDe = dados.alteracoes?.status_funil
    ? stageNamesMap[dados.alteracoes.status_funil] || dados.alteracoes.status_funil
    : null;

  return (
    <div className="history-detail-card">
      <div className="history-detail-header">
        <h3>Detalhes do Registro</h3>
        <div className="history-detail-actions">
          {podeAbrirVenda && (
            <button
              type="button"
              className="history-detail-open"
              onClick={() => onAbrirVenda(log.entidade_id)}
              disabled={modalCarregando === `venda:${log.entidade_id}`}
            >
              <I.External size={12} /> {modalCarregando === `venda:${log.entidade_id}` ? 'Abrindo...' : 'Abrir venda'}
            </button>
          )}
          {podeAbrirClienteLog && (
            <button
              type="button"
              className="history-detail-open"
              onClick={() => onAbrirCliente(log.entidade_id)}
              disabled={modalCarregando === `cliente:${log.entidade_id}`}
            >
              <I.External size={12} /> {modalCarregando === `cliente:${log.entidade_id}` ? 'Abrindo...' : 'Abrir cliente'}
            </button>
          )}
          <button className="history-detail-close" onClick={onClose} aria-label="Fechar">
          ×
          </button>
        </div>
      </div>

      <div className="history-detail-body">
        <div className="history-detail-row">
          <span className="history-detail-label">Ação:</span>
          <span className="history-detail-value">{formatarAcao(log.acao)}</span>
        </div>

        {stageDe && (
          <div className="history-detail-row">
            <span className="history-detail-label">Etapa do funil:</span>
            <span className="history-detail-value">{stageDe}</span>
          </div>
        )}

        {dados.alteracoes?.observacao && (
          <div className="history-detail-row">
            <span className="history-detail-label">Observação:</span>
            <span className="history-detail-value">{dados.alteracoes.observacao}</span>
          </div>
        )}

        <div className="history-detail-row">
          <span className="history-detail-label">Usuário:</span>
          <span className="history-detail-value">
            {getAutorHistorico(log)}
          </span>
        </div>

        <div className="history-detail-row">
          <span className="history-detail-label">Data/Hora:</span>
          <span className="history-detail-value">{formatarData(log.created_at)}</span>
        </div>

        <div className="history-detail-row">
          <span className="history-detail-label">Método:</span>
          <span className="history-detail-value">{log.metodo || 'API'}</span>
        </div>

        <div className="history-detail-row">
          <span className="history-detail-label">Rota:</span>
          <span className="history-detail-value">{log.rota || 'N/A'}</span>
        </div>

        {log.entidade && (
          <div className="history-detail-row">
            <span className="history-detail-label">Entidade:</span>
            <span className="history-detail-value">{log.entidade}</span>
          </div>
        )}

        {log.entidade_id && (
          <div className="history-detail-row">
            <span className="history-detail-label">ID da Entidade:</span>
            <span className="history-detail-value">#{log.entidade_id}</span>
          </div>
        )}

        {log.etapasPuladas?.length > 0 && (
          <div className="history-detail-section history-detail-section--warning">
            <h4>Etapas puladas no funil</h4>
            <div className="history-skipped-detail">
              <I.AlertTriangle size={15} />
              <span>{log.etapasPuladas.map(etapa => etapa.nome).join(', ')}</span>
            </div>
          </div>
        )}

        {motivoCancelamento && (
          <div className="history-detail-row">
            <span className="history-detail-label">Motivo do cancelamento:</span>
            <span className="history-detail-value">{motivoCancelamento}</span>
          </div>
        )}
        
        <DadosOperacao dados={dados} stageNamesMap={stageNamesMap} />
      </div>
    </div>
  );
}

/**
 * Renderiza historico page.
 */
function HistoricoPage() {
  const navigate = useNavigate();
  const usuarioLogado = getUsuarioLocal();
  const podeEditarVenda = temPermissao(usuarioLogado, ['vendas_editar', 'pos_venda']);
  const podeCompartilharVenda = temPermissao(usuarioLogado, 'compartilhar_venda');
  const podeVerDocumentosVenda = temPermissao(usuarioLogado, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuarioLogado, 'adicionar_documentos');
  const podeListarClientes = temPermissao(usuarioLogado, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const podeEditarCliente = temPermissao(usuarioLogado, 'clientes_editar');
  const [logs, setLogs] = useState([]);
  const [busca, setBusca] = useState('');
  const buscaDeferred = useDeferredValue(busca);
  const [filtro, setFiltro] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('ativas');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [logSelecionado, setLogSelecionado] = useState(null);
  const [etapasFunil, setEtapasFunil] = useState([]);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState(20);
  const [total, setTotal] = useState(0);
  const [vendaModal, setVendaModal] = useState(null);
  const [vendaModalModoEdicao, setVendaModalModoEdicao] = useState(false);
  const [clienteModal, setClienteModal] = useState(null);
  const [clientesModal, setClientesModal] = useState([]);
  const [vendedorasModal, setVendedorasModal] = useState([]);
  const [operadorasModal, setOperadorasModal] = useState([]);
  const [tiposVendaModal, setTiposVendaModal] = useState([]);
  const [servicosModal, setServicosModal] = useState([]);
  const [referenciasClientesModal, setReferenciasClientesModal] = useState([]);
  const [dadosVendaModalCarregados, setDadosVendaModalCarregados] = useState(false);
  const [modalCarregando, setModalCarregando] = useState('');
  const filtroAtual = FILTROS_HISTORICO.find(item => item.id === filtro) || FILTROS_HISTORICO[0];
  const filtrosAtivos = filtro !== 'todos' ? 1 : 0;
  const vendasPorClienteModal = useMemo(
    () => montarMapaReferencias(referenciasClientesModal, 'total'),
    [referenciasClientesModal]
  );
  const vendasEmAndamentoPorClienteModal = useMemo(
    () => montarMapaReferencias(referenciasClientesModal, 'em_andamento_total'),
    [referenciasClientesModal]
  );
  const stageNamesMap = useMemo(() => montarMapaNomesEtapas(etapasFunil), [etapasFunil]);

  /**
   * Carrega  e atualiza o estado relacionado.
   */
  async function carregar(pagina = paginaAtual, porPagina = itensPorPagina) {
    setCarregando(true);
    setErro('');

    try {
      const ehVendas = filtroAtual.id === 'vendas';
      const requisicao = ehVendas
        ? listarHistoricoVendasAgrupado({
            status: filtroStatus,
            busca: buscaDeferred,
            page: pagina,
            per_page: porPagina
          })
        : listarAuditLogs({
            busca: buscaDeferred,
            entidade: filtroAtual.entidade || '',
            tipo: filtroAtual.tipo || '',
            page: pagina,
            per_page: porPagina
          });

      const [resposta, etapas] = await Promise.all([
        requisicao,
        listarEtapasFunil().catch(() => [])
      ]);

      setLogs(resposta.data || []);
      setTotal(resposta.total || 0);
      setEtapasFunil(normalizarEtapas(etapas));
    } catch (error) {
      setErro(error.message || 'Erro ao carregar histórico.');
    } finally {
      setCarregando(false);
    }
  }

  const carregarAoFiltrar = useEffectEvent(() => {
    setPaginaAtual(1);
    void carregar(1);
  });

  useEffect(() => {
    const timer = setTimeout(carregarAoFiltrar, 250);
    return () => clearTimeout(timer);
  }, [buscaDeferred, filtroAtual.id, filtroAtual.entidade, filtroAtual.tipo, filtroStatus]);

  const modoVendasCompacto = filtro === 'vendas';
  const gruposVenda = useMemo(() => {
    if (!modoVendasCompacto) return [];
    return agruparLogsVenda(logs)
      .map(grupo => enriquecerGrupoComPulos(grupo, etapasFunil));
  }, [modoVendasCompacto, logs, etapasFunil]);

  /**
   * Renderiza carregar dados venda modal.
   */
  async function carregarDadosVendaModal() {
    if (dadosVendaModalCarregados) return;

    const [
      referenciasData,
      clientesData,
      vendedorasData,
      operadorasData,
      tiposVendaData,
      servicosData
    ] = await Promise.all([
      obterReferenciasClientesVendas(),
      podeListarClientes ? listarClientesSelect() : Promise.resolve([]),
      listarVendedoras(),
      listarOperadoras(),
      listarTiposVenda(),
      listarServicos()
    ]);

    setReferenciasClientesModal(referenciasData || []);
    setClientesModal(clientesData || []);
    setVendedorasModal(vendedorasData || []);
    setOperadorasModal(operadorasData || []);
    setTiposVendaModal(tiposVendaData || []);
    setServicosModal(servicosData || []);
    setDadosVendaModalCarregados(true);
  }

  /**
   * Abre venda e prepara o estado necessario.
   */
  async function abrirVenda(vendaId) {
    if (!vendaId) return;
    setErro('');
    setModalCarregando(`venda:${vendaId}`);

    try {
      await carregarDadosVendaModal();
      const venda = await buscarVendaPorId(vendaId);
      setVendaModal(venda);
      setVendaModalModoEdicao(false);
    } catch (error) {
      setErro(error.message || 'Erro ao abrir venda.');
    } finally {
      setModalCarregando('');
    }
  }

  /**
   * Abre cliente e prepara o estado necessario.
   */
  async function abrirCliente(clienteId) {
    if (!clienteId || !podeEditarCliente) return;
    setErro('');
    setModalCarregando(`cliente:${clienteId}`);

    try {
      if (operadorasModal.length === 0) {
        setOperadorasModal(await listarOperadoras());
      }
      const cliente = await buscarClientePorId(clienteId);
      setClienteModal(cliente);
    } catch (error) {
      setErro(error.message || 'Erro ao abrir cliente.');
    } finally {
      setModalCarregando('');
    }
  }

  /**
   * Renderiza salvar venda modal.
   */
  async function salvarVendaModal(dados) {
    if (!vendaModal?.id) return;
    setErro('');

    try {
      await atualizarVenda(vendaModal.id, dados);
      const atualizada = await buscarVendaPorId(vendaModal.id);
      setVendaModal(atualizada);
      setVendaModalModoEdicao(false);
      obterReferenciasClientesVendas().then(data => setReferenciasClientesModal(data || [])).catch(() => {});
    } catch (error) {
      setErro(error.message || 'Erro ao salvar venda.');
      throw error;
    }
  }

  /**
   * Renderiza enviar pos venda modal.
   */
  async function enviarPosVendaModal(venda) {
    if (!venda?.id) return;
    setErro('');

    try {
      await enviarVendaParaPosVenda(venda.id);
      const atualizada = await buscarVendaPorId(venda.id);
      setVendaModal(atualizada);
      setVendaModalModoEdicao(false);
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    } catch (error) {
      setErro(error.message || 'Erro ao enviar venda para o pos-venda.');
      throw error;
    }
  }

  return (
    <LayoutPrivado>
      {vendaModal && (
        <VendaModal
          venda={vendaModal}
          clientes={clientesModal}
          vendas={[]}
          vendedoras={vendedorasModal}
          operadoras={operadorasModal}
          tiposVenda={tiposVendaModal}
          servicos={servicosModal}
          vendasPorCliente={vendasPorClienteModal}
          vendasEmAndamentoPorCliente={vendasEmAndamentoPorClienteModal}
          podeEditarVenda={podeEditarVenda}
          podeCompartilharVenda={podeCompartilharVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuarioLogado}
          initialTab="venda"
          modoEdicao={vendaModalModoEdicao}
          onStartEdit={() => setVendaModalModoEdicao(true)}
          onClose={() => {
            setVendaModal(null);
            setVendaModalModoEdicao(false);
          }}
          onSave={salvarVendaModal}
          onSendToPosVenda={enviarPosVendaModal}
        />
      )}

      {clienteModal && (
        <ClienteModal
          cliente={clienteModal}
          operadoras={operadorasModal}
          onClose={() => setClienteModal(null)}
          onSave={() => setClienteModal(null)}
          onOpenVenda={venda => {
            setClienteModal(null);
            abrirVenda(venda?.id);
          }}
        />
      )}

      {filtrosAbertos && (
        <div className="filtros-popup-overlay" onClick={() => setFiltrosAbertos(false)}>
          <div className="filtros-popup" onClick={event => event.stopPropagation()}>
            <div className="filtros-popup__header">
              <span>Filtros</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setFiltrosAbertos(false)}>
                <I.Close size={14} />
              </button>
            </div>
            <div className="filtros-popup__body">
              <div className="filter-field">
                <label>Tipo de histórico</label>
                <SelectFiltro
                  value={filtro === 'todos' ? '' : filtro}
                  onChange={valor => setFiltro(valor || 'todos')}
                  placeholder="Todos"
                  options={FILTROS_HISTORICO.filter(item => item.id !== 'todos').map(item => ({
                    value: item.id,
                    label: item.label
                  }))}
                />
              </div>
              
              {filtroAtual.temFiltroStatus && (
                <div className="filter-field">
                  <label>Status da venda</label>
                  <SelectFiltro
                    value={filtroStatus}
                    onChange={setFiltroStatus}
                    options={FILTROS_STATUS_VENDA.map(item => ({
                      value: item.id,
                      label: item.label
                    }))}
                  />
                </div>
              )}
            </div>
            <div className="filtros-popup__footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFiltro('todos')}
                disabled={filtrosAtivos === 0}
              >
                <I.Close size={13} /> Limpar filtros
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setFiltrosAbertos(false)}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="history-page">
        <div className="history-toolbar">
          <div className="history-search">
            <I.Search size={14} />
            <input
              value={busca}
              onChange={event => setBusca(event.target.value)}
              placeholder="Buscar por venda, cliente, usuário, ação, rota..."
            />
          </div>

          <button className="btn" type="button" onClick={() => setFiltrosAbertos(true)}>
            <I.Filter size={14} /> Filtros
            {filtrosAtivos > 0 && <span className="filtros-count">{filtrosAtivos}</span>}
          </button>
          <button
            className="history-lixeira-link"
            onClick={() => navigate('/historico/lixeira')}
            title="Ver histórico de vendas excluídas"
          >
            <I.Trash size={13} />
            Lixeira
          </button>
        </div>

        <div className="history-shell">
          <div className="history-summary">
            {modoVendasCompacto
              ? `Histórico de entrega da venda - ${FILTROS_STATUS_VENDA.find(s => s.id === filtroStatus)?.label || filtroStatus} (${total} venda${total !== 1 ? 's' : ''})`
              : `Linha do tempo de todas as movimentacoes (${total} evento${total !== 1 ? 's' : ''})`}
          </div>

          <div className="history-panel">
            <div className="history-panel__scroll">
              {carregando ? (
                <div className="history-empty">Carregando histórico...</div>
              ) : erro ? (
                <div className="history-empty error">{erro}</div>
              ) : logs.length === 0 ? (
                <div className="history-empty">Nenhuma movimentacao encontrada.</div>
              ) : modoVendasCompacto ? (
                <div className="history-sale-groups">
                  {gruposVenda.map(grupo => (
                    <VendaHistoricoGrupo
                      key={grupo.vendaId}
                      grupo={grupo}
                      etapasFunil={etapasFunil}
                      stageNamesMap={stageNamesMap}
                      logSelecionado={logSelecionado}
                      onClick={setLogSelecionado}
                      onAbrirVenda={abrirVenda}
                      modalCarregando={modalCarregando}
                    />
                  ))}
                </div>
              ) : (
                <div className={`history-list ${modoVendasCompacto ? 'history-list--compact' : ''}`}>
                  {logs.map(log => (
                    <HistoricoItem
                      key={log.id}
                      log={log}
                      compacto={modoVendasCompacto}
                      selecionado={logSelecionado?.id === log.id}
                      onClick={setLogSelecionado}
                    />
                  ))}
                </div>
              )}
            </div>

            {!carregando && !erro && (
              <Paginacao
                total={total}
                paginaAtual={paginaAtual}
                itensPorPagina={itensPorPagina}
                onPagina={pagina => { setPaginaAtual(pagina); carregar(pagina); }}
                onItensPorPagina={n => { setItensPorPagina(n); setPaginaAtual(1); carregar(1, n); }}
              />
            )}

            {logSelecionado && (
              <DetalheCard 
                log={logSelecionado} 
                stageNamesMap={stageNamesMap}
                onClose={() => setLogSelecionado(null)} 
                onAbrirVenda={abrirVenda}
                onAbrirCliente={abrirCliente}
                podeAbrirCliente={podeEditarCliente}
                modalCarregando={modalCarregando}
              />
            )}
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default HistoricoPage;

