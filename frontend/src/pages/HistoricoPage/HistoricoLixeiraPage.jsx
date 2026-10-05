import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import { listarHistoricoVendasAgrupado } from '../../services/audit-log.service';
import { formatUtcDateTime, getUtcDateTimeTimestamp } from '../../utils/datetime';
import AlteracoesHistorico from './AlteracoesHistorico';

const ACAO_LABELS = {
  'venda.criada': 'Venda criada',
  'venda.atualizada': 'Venda atualizada',
  'venda.status_atualizado': 'Status da venda atualizado',
  'venda.enviada_pos_venda': 'Venda enviada para pós-venda',
  'venda.enviada_lixeira': 'Venda enviada para lixeira',
  'venda.restaurada': 'Venda restaurada',
  'venda.excluida_definitivamente': 'Venda excluída definitivamente',
};

const FUNIL_STAGES = [
  { id: 'aprovacao', name: 'Aprovação' },
  { id: 'ativacao', name: 'Ativação' },
  { id: 'envio', name: 'Envio' },
  { id: 'entrega', name: 'Entrega' },
  { id: 'confirmacao', name: 'Confirmação' },
  { id: 'concluido', name: 'Concluído' },
];

const FUNIL_STAGE_IDS = FUNIL_STAGES.map(s => s.id);

const STAGE_NAMES_MAP = Object.fromEntries(FUNIL_STAGES.map(s => [s.id, s.name]));
STAGE_NAMES_MAP.retorno = 'Retorno';

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
    minute: '2-digit',
  });
}

/**
 * Formata acao para exibicao ou envio.
 */
function formatarAcao(acao) {
  return ACAO_LABELS[acao] || acao.replaceAll('.', ' ');
}

/**
 * Retorna tipo a partir dos dados informados.
 */
function getTipo(log) {
  if (log.acao?.includes('falha')) return 'danger';
  if (log.acao === 'venda.excluida_definitivamente') return 'deleted';
  if (log.acao === 'venda.enviada_lixeira') return 'trash';
  if (log.acao === 'venda.restaurada') return 'restore';
  if (log.acao?.includes('login')) return 'neutral';
  return 'success';
}

/**
 * Renderiza marker icon.
 */
function MarkerIcon({ log, size = 11 }) {
  switch (log.acao) {
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
function buildStageProgression(logs) {
  const sorted = [...logs].sort((a, b) => getUtcDateTimeTimestamp(a.created_at) - getUtcDateTimeTimestamp(b.created_at));
  const reached = new Map();
  let currentStage = null;
  let hasRetorno = false;

  for (const log of sorted) {
    const dados = parseDados(log.dados);
    const usuario = log.usuario?.nome || (log.usuario_id ? `Usuário #${log.usuario_id}` : 'Sistema');

    if (log.acao === 'venda.criada') {
      if (!reached.has('aprovacao')) {
        reached.set('aprovacao', { data: log.created_at, usuario, log });
      }
      currentStage = 'aprovacao';
    } else if (log.acao === 'venda.status_atualizado') {
      const stage = dados.alteracoes?.status_funil;
      if (stage === 'retorno') {
        hasRetorno = true;
      } else if (stage && FUNIL_STAGE_IDS.includes(stage)) {
        if (!reached.has(stage)) {
          reached.set(stage, { data: log.created_at, usuario, log });
        }
        currentStage = stage;
      }
    }
  }

  if (!currentStage) currentStage = 'aprovacao';

  const stages = FUNIL_STAGES.map((stage, idx) => {
    const stageData = reached.get(stage.id);
    const isCurrent = stage.id === currentStage;
    const isReached = reached.has(stage.id);

    let status;
    if (isCurrent) {
      status = 'current';
    } else if (isReached) {
      status = 'done';
    } else {
      const hasBefore = FUNIL_STAGE_IDS.slice(0, idx).some(id => reached.has(id));
      const hasAfter = FUNIL_STAGE_IDS.slice(idx + 1).some(id => reached.has(id));
      status = (hasBefore && hasAfter) ? 'skipped' : 'pending';
    }

    return { ...stage, status, data: stageData?.data, usuario: stageData?.usuario, log: stageData?.log };
  });

  return { stages, hasRetorno, currentStage };
}

/**
 * Retorna connector type a partir dos dados informados.
 */
function getConnectorType(stageA, stageB) {
  if (stageA.status === 'skipped' || stageB.status === 'skipped') return 'skip';
  if (
    (stageA.status === 'done' || stageA.status === 'current') &&
    (stageB.status === 'done' || stageB.status === 'current')
  ) return 'done';
  return 'pending';
}

/**
 * Agrupa logs venda para consumo posterior.
 */
function agruparLogsVenda(logs = []) {
  const grupos = new Map();

  logs.forEach(log => {
    const dadosRaw = parseDados(log.dados);
    const vendaId = log.entidade_id
      ? String(log.entidade_id)
      : String(dadosRaw?.venda?.id || dadosRaw?.venda_id || log.id);

    const grupoAtual = grupos.get(vendaId) || { vendaId, logs: [] };
    grupoAtual.logs.push(log);
    grupos.set(vendaId, grupoAtual);
  });

  return Array.from(grupos.values()).map(grupo => ({
    ...grupo,
    logs: grupo.logs.sort((a, b) => getUtcDateTimeTimestamp(a.created_at) - getUtcDateTimeTimestamp(b.created_at)),
    maisRecente: grupo.logs.reduce((recente, log) => (
      !recente || getUtcDateTimeTimestamp(log.created_at) > getUtcDateTimeTimestamp(recente.created_at) ? log : recente
    ), null),
  })).sort((a, b) => getUtcDateTimeTimestamp(b.maisRecente?.created_at) - getUtcDateTimeTimestamp(a.maisRecente?.created_at));
}

/**
 * Retorna deletion status a partir dos dados informados.
 */
function getDeletionStatus(logs) {
  const sorted = [...logs].sort((a, b) => getUtcDateTimeTimestamp(a.created_at) - getUtcDateTimeTimestamp(b.created_at));
  let status = null;
  for (const log of sorted) {
    if (log.acao === 'venda.enviada_lixeira') status = 'lixeira';
    else if (log.acao === 'venda.restaurada') status = 'restaurada';
    else if (log.acao === 'venda.excluida_definitivamente') status = 'permanente';
  }
  return status;
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
              title={stage.status === 'skipped' ? `Etapa pulada: ${stage.name}` : stage.name}
            >
              <div className="funil-stage__dot">
                {stage.status === 'done' && <I.Check size={10} />}
                {stage.status === 'current' && <span className="funil-stage__inner" />}
                {stage.status === 'skipped' && <I.AlertTriangle size={10} />}
              </div>
              <span className="funil-stage__name">{stage.name}</span>
              {stage.data && (
                <span className="funil-stage__date">{formatarData(stage.data)}</span>
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
 * Renderiza venda excluida card.
 */
function VendaExcluidaCard({ grupo, logSelecionado, onClick }) {
  const [expandido, setExpandido] = useState(false);
  const progression = buildStageProgression(grupo.logs);
  const currentStageName = STAGE_NAMES_MAP[progression.currentStage] || progression.currentStage;
  const nomeCliente = extrairNomeVenda(grupo.logs, grupo.vendaId);
  const deletionStatus = getDeletionStatus(grupo.logs);
  const skippedCount = progression.stages.filter(s => s.status === 'skipped').length;

  return (
    <div className={`history-sale-row${deletionStatus === 'permanente' ? ' history-sale-row--permanente' : ''}`}>
      <div className="history-sale-row__head">
        <strong className="history-sale-row__client" title={nomeCliente}>{nomeCliente}</strong>
        <span className="history-sale-row__id">#{grupo.vendaId}</span>
        <span className="history-sale-row__stage-badge">{currentStageName}</span>

        {deletionStatus === 'lixeira' && (
          <span className="history-sale-row__tag tag-lixeira">
            <I.Trash size={9} /> Na lixeira
          </span>
        )}
        {deletionStatus === 'restaurada' && (
          <span className="history-sale-row__tag tag-restaurada">
            <I.Check size={9} /> Restaurada
          </span>
        )}
        {deletionStatus === 'permanente' && (
          <span className="history-sale-row__tag tag-permanente">
            <I.Trash size={9} /> Excluída
          </span>
        )}

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
              const usuario = log.usuario?.nome || (log.usuario_id ? `Usuário #${log.usuario_id}` : 'Sistema');
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
function DetalheCard({ log, onClose }) {
  const dados = parseDados(log.dados);
  const stageDe = dados.alteracoes?.status_funil
    ? STAGE_NAMES_MAP[dados.alteracoes?.status_funil]
    : null;

  return (
    <div className="history-detail-card">
      <div className="history-detail-header">
        <h3>Detalhes do Registro</h3>
        <button className="history-detail-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
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
            {log.usuario?.nome || (log.usuario_id ? `Usuário #${log.usuario_id}` : 'Sistema')}
          </span>
        </div>

        <div className="history-detail-row">
          <span className="history-detail-label">Data/Hora:</span>
          <span className="history-detail-value">{formatarData(log.created_at)}</span>
        </div>

        <div className="history-detail-row">
          <span className="history-detail-label">Entidade:</span>
          <span className="history-detail-value">{log.entidade || 'vendas'} #{log.entidade_id}</span>
        </div>

        {dados && Object.keys(dados).length > 0 && (
          <div className="history-detail-section">
            <h4>Dados da Operação</h4>
            <AlteracoesHistorico dados={dados} stageNamesMap={STAGE_NAMES_MAP} />
            <details className="history-raw-data">
              <summary>Ver dados técnicos em JSON</summary>
            <pre className="history-detail-data">
              {JSON.stringify(dados, null, 2)}
            </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renderiza historico lixeira page.
 */
function HistoricoLixeiraPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [busca, setBusca] = useState('');
  const buscaDeferred = useDeferredValue(busca);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [logSelecionado, setLogSelecionado] = useState(null);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState(20);
  const [total, setTotal] = useState(0);

  /**
   * Carrega  e atualiza o estado relacionado.
   */
  async function carregar(pagina = paginaAtual, porPagina = itensPorPagina) {
    setCarregando(true);
    setErro('');
    try {
      const resposta = await listarHistoricoVendasAgrupado({
        status: 'lixeira',
        busca: buscaDeferred,
        page: pagina,
        per_page: porPagina
      });
      setLogs(resposta.data || []);
      setTotal(resposta.total || 0);
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
  }, [buscaDeferred]);

  const grupos = useMemo(() => agruparLogsVenda(logs), [logs]);

  return (
    <LayoutPrivado>
      <div className="history-page">
        <div className="history-toolbar">
          <button className="history-back-btn" onClick={() => navigate('/historico')}>
            <I.ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} />
            Histórico
          </button>

          <div className="history-search">
            <I.Search size={14} />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por cliente ou ID da venda..."
            />
          </div>
        </div>

        <div className="history-shell">
          <div className="history-summary">
            {carregando
              ? 'Carregando...'
              : `${total} venda${total !== 1 ? 's' : ''} com exclusão registrada`}
          </div>

          <div className="history-panel">
            <div className="history-panel__scroll">
              {carregando ? (
                <div className="history-empty">Carregando histórico...</div>
              ) : erro ? (
                <div className="history-empty error">{erro}</div>
              ) : grupos.length === 0 ? (
                <div className="history-empty">Nenhuma venda excluída encontrada.</div>
              ) : (
                <div className="history-sale-groups">
                  {grupos.map(grupo => (
                    <VendaExcluidaCard
                      key={grupo.vendaId}
                      grupo={grupo}
                      logSelecionado={logSelecionado}
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
              <DetalheCard log={logSelecionado} onClose={() => setLogSelecionado(null)} />
            )}
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default HistoricoLixeiraPage;
