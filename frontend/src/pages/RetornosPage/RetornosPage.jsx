import { useNavigationRecord } from '../../utils/useNavigationRecord';
import { useNavigationState } from '../../utils/useNavigationState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import { DEFAULT_OPERATORS as OPERATORS, STAGES } from '../../config/constants';
import { listarEtapasFunil } from '../../services/config.service';
import { atualizarStatusVenda, listarVendas } from '../../services/venda.service';
import { parseUtcDateTime } from '../../utils/datetime';
import {
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam
} from '../../services/notificacao-abertura.service';
import { formatarNomeServico } from '../../utils/servicos';
import './RetornosPage.css';

/**
 * Formata brl para exibicao.
 */
const formatBRL = (value) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const RETURN_REASON_GROUPS = [
  { id: 'endereco', label: 'Endereço inválido', desc: 'Devolvido pelos Correios', match: (r) => /endere|correios/i.test(r) },
  { id: 'recusa', label: 'Cliente recusou', desc: 'Cliente não aceitou o recebimento', match: (r) => /recus/i.test(r) },
  { id: 'danificado', label: 'Chip danificado', desc: 'Avaria no transporte ou produto', match: (r) => /danific|avaria/i.test(r) },
  { id: 'cpf', label: 'Reprovado na operadora', desc: 'CPF/CNPJ não passou na análise', match: (r) => /cpf|cnpj|reprovad/i.test(r) },
  { id: 'cancelamento', label: 'Cancelamento do cliente', desc: 'Cliente desistiu da compra', match: (r) => /cancel|desist/i.test(r) },
  { id: 'outros', label: 'Outros motivos', desc: 'Casos sem categoria definida', match: () => true },
];

const FALLBACK_STAGE_LABELS = Object.fromEntries(STAGES.map(stage => [stage.id, stage.name]));

/**
 * Processa classify reason conforme as regras do dominio.
 */
function classifyReason(reason) {
  return RETURN_REASON_GROUPS.find(group => group.match(reason || '')) || RETURN_REASON_GROUPS.at(-1);
}

/**
 * Processa rel time conforme as regras do dominio.
 */
function relTime(value) {
  if (!value) return 'recentemente';

  const date = parseUtcDateTime(value);
  if (!date) return 'recentemente';

  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}

/**
 * Retorna operator a partir dos dados informados.
 */
function getOperator(venda) {
  return venda.operadora?.nome || venda.operadora || 'Sem operadora';
}

/**
 * Retorna plan a partir dos dados informados.
 */
function getPlan(venda) {
  return venda.produto_fechado || formatarNomeServico(venda.servico?.nome) || venda.tipoVenda?.nome || 'Plano não informado';
}

/**
 * Retorna seller a partir dos dados informados.
 */
function getSeller(venda) {
  return venda.vendedora?.nome || venda.nome_fechou_venda || 'Sem vendedor';
}

/**
 * Retorna client a partir dos dados informados.
 */
function getClient(venda) {
  return venda.nome || venda.razao_social || `Venda #${venda.id}`;
}

/**
 * Retorna value a partir dos dados informados.
 */
function getValue(venda) {
  return Number(venda.valor_total || 0);
}

/**
 * Retorna return date a partir dos dados informados.
 */
function getReturnDate(venda) {
  return venda.retornou_em || venda.updated_at || venda.ultima_atividade_em;
}

/**
 * Retorna destination a partir dos dados informados.
 */
function getDestination(venda) {
  return venda.status_anterior_retorno || 'aprovacao';
}

/**
 * Converte historico dados para o formato interno esperado.
 */
function parseHistoricoDados(dados) {
  if (!dados) return {};
  if (typeof dados === 'string') {
    try {
      return JSON.parse(dados);
    } catch {
      return {};
    }
  }
  return dados;
}

/**
 * Retorna return observation a partir dos dados informados.
 */
function getReturnObservation(venda) {
  const historico = Array.isArray(venda.historico) ? venda.historico : [];
  const registro = historico.find(item => (
    item.acao === 'venda.retorno_observacao_atualizada'
    || item.acao === 'venda.retorno_registrado'
  ));

  if (!registro) return '';

  const dados = parseHistoricoDados(registro.dados);
  return dados.observacao || registro.observacao || '';
}

/**
 * Renderiza resolve return modal.
 */
function ResolveReturnModal({ venda, stageLabels, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const destination = getDestination(venda);
  const returnObservation = getReturnObservation(venda);

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();

    if (!note.trim()) {
      setError('Informe o que foi corrigido.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await onConfirm(venda, note.trim());
    } catch (err) {
      setError(err.message || 'Erro ao atualizar status.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <form className="modal return-status-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Atualizar status</div>
              <div className="modal-sub">{getClient(venda)} · #{venda.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="RetornosPage-1">
          <div className="return-status-summary">
            <div>
              <span>Motivo do retorno</span>
              <strong>{venda.motivo_retorno || 'Sem motivo informado'}</strong>
            </div>
            <div>
              <span>Destino após correção</span>
              <strong>{stageLabels[destination] || destination}</strong>
            </div>
          </div>

          <div className="form-field">
            <label>Observação do retorno</label>
            <textarea
              className="obs-textarea return-observation-textarea"
              value={returnObservation}
              readOnly
              placeholder="Nenhuma observação foi registrada neste retorno."
              rows={5}
            />
            <div className="return-observation-actions">
              <span>{returnObservation ? 'Observação registrada no retorno.' : 'Sem observação registrada.'}</span>
            </div>
          </div>

          <div className="form-field">
            <label>O que foi corrigido?</label>
            <textarea
              className="obs-textarea"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Ex: endereço corrigido e confirmado com o cliente."
              rows={7}
            />
          </div>

          {error && <div className="alert-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !note.trim()}>
            {saving ? 'Atualizando...' : 'Confirmar correção'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Renderiza retornos page.
 */
function RetornosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [operatorFilter, setOperatorFilter] = useNavigationState('RetornosPage:operatorFilter', 'todas');
  const [reasonFilter, setReasonFilter] = useNavigationState('RetornosPage:reasonFilter', 'todos');
  const [allSales, setAllSales] = useState([]);
  const [allReturns, setAllReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReturn, setSelectedReturn] = useNavigationRecord('RetornosPage:detalhe', {
    load: id => allReturns.find(item => String(item.id) === String(id)),
    ready: !loading && !searchParams.has('venda_id'),
    onError: error => setError(error.message)
  });
  const [stageLabels, setStageLabels] = useState(FALLBACK_STAGE_LABELS);
  const aberturaNotificacaoProcessadaRef = useRef('');

  useEffect(() => {
    let ativo = true;
    Promise.all([
      listarVendas({ status_funil: 'retorno' }),
      listarVendas({}),
      listarEtapasFunil()
    ])
      .then(([returnsData, salesData, etapasData]) => {
        if (!ativo) return;
        setAllReturns(returnsData);
        setAllSales(salesData);
        setStageLabels({
          ...FALLBACK_STAGE_LABELS,
          ...Object.fromEntries((etapasData || []).map(etapa => [etapa.codigo || etapa.id, etapa.nome || etapa.name]))
        });
      })
      .catch(err => {
        if (ativo) setError(err.message || 'Erro ao carregar retornos.');
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => { ativo = false; };
  }, []);

  const vendaIdParam = searchParams.get('venda_id');
  const notificacaoId = getNotificacaoIdParam(searchParams);

  useEffect(() => {
    if (loading || !vendaIdParam) return;
    const chaveAbertura = `${vendaIdParam}:${notificacaoId || ''}`;
    if (aberturaNotificacaoProcessadaRef.current === chaveAbertura) return;
    aberturaNotificacaoProcessadaRef.current = chaveAbertura;
    const retorno = allReturns.find(item => String(item.id) === String(vendaIdParam));
    if (retorno) {
      queueMicrotask(() => {
        setSelectedReturn(retorno);
        if (notificacaoId) {
          void confirmarAberturaNotificacao(notificacaoId).catch(error => {
            console.error('Erro ao confirmar abertura da notificacao:', error);
          });
        }
      });
      return;
    }
    if (notificacaoId) falharAberturaNotificacao(notificacaoId);
    queueMicrotask(() => setError('O retorno desta notificação não está mais disponível.'));
  }, [allReturns, loading, notificacaoId, setSelectedReturn, vendaIdParam]);

  useEffect(() => {
    if (loading) return;
    if (!vendaIdParam) return;

    const proximosParams = new URLSearchParams(searchParams);
    proximosParams.delete('venda_id');
    setSearchParams(proximosParams, { replace: true });
  }, [loading, vendaIdParam, searchParams, setSearchParams]);

  const groupCounts = useMemo(() => (
    RETURN_REASON_GROUPS.map(group => {
      const items = allReturns.filter(item => classifyReason(item.motivo_retorno).id === group.id);
      return {
        ...group,
        count: items.length,
        value: items.reduce((sum, item) => sum + getValue(item), 0),
      };
    })
  ), [allReturns]);

  const returns = allReturns.filter(item => {
    const matchesOperator = operatorFilter === 'todas' || getOperator(item) === operatorFilter;
    const matchesReason = reasonFilter === 'todos' || classifyReason(item.motivo_retorno).id === reasonFilter;
    return matchesOperator && matchesReason;
  });

  const operators = Array.from(new Set([...OPERATORS, ...allReturns.map(getOperator)])).filter(Boolean);
  const totalPerdaFiltrada = returns.reduce((sum, item) => sum + getValue(item), 0);
  const totalPerda = allReturns.reduce((sum, item) => sum + getValue(item), 0);
  const topReason = groupCounts.filter(group => group.count > 0).sort((a, b) => b.count - a.count)[0];
  const topOperator = operators
    .map(operator => ({ operator, count: allReturns.filter(item => getOperator(item) === operator).length }))
    .sort((a, b) => b.count - a.count)[0];
  const taxaRetorno = ((allReturns.length / Math.max(allSales.length, 1)) * 100).toFixed(1);

  /**
   * Trata o evento de resolve return.
   */
  async function handleResolveReturn(venda, note) {
    const destination = getDestination(venda);
    await atualizarStatusVenda(venda.id, {
      status_funil: destination,
      nota_correcao_retorno: note
    });

    setAllReturns(prev => prev.filter(item => item.id !== venda.id));
    setAllSales(prev => prev.map(item => (
      item.id === venda.id
        ? { ...item, status_funil: destination, nota_correcao_retorno: note, corrigido_em: new Date().toISOString() }
        : item
    )));
    setSelectedReturn(null);
  }

  return (
    <LayoutPrivado>
      {selectedReturn && (
        <ResolveReturnModal
          venda={selectedReturn}
          stageLabels={stageLabels}
          onClose={() => setSelectedReturn(null)}
          onConfirm={handleResolveReturn}
        />
      )}

      <div className="returns-page">
        <div className="returns-kpis">
          <div className="returns-kpi big-loss">
            <div className="label">Perda total acumulada</div>
            <div className="value">{formatBRL(totalPerda)}</div>
            <div className="sub">{allReturns.length} {allReturns.length === 1 ? 'chip retornado' : 'chips retornados'}</div>
          </div>
          <div className="returns-kpi">
            <div className="label">Maior motivo</div>
            <div className="value-md">{topReason?.label || '-'}</div>
            <div className="sub">{topReason?.count || 0} ocorrências</div>
          </div>
          <div className="returns-kpi">
            <div className="label">Taxa de retorno</div>
            <div className="value-md">{taxaRetorno}%</div>
            <div className="sub">do total de vendas</div>
          </div>
          <div className="returns-kpi">
            <div className="label">Operadora mais afetada</div>
            <div className="value-md">{topOperator?.operator || '-'}</div>
            <div className="sub">com mais devoluções</div>
          </div>
        </div>

        {error && <div className="alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="returns-grid single">
          <div className="panel">
            <div className="returns-panel-header">
              <div className="returns-title-row">
                <h3>
                  Chips retornados
                  {reasonFilter !== 'todos' && (
                    <span className="muted"> · {RETURN_REASON_GROUPS.find(g => g.id === reasonFilter)?.label}</span>
                  )}
                </h3>
                <span className="muted">
                  {returns.length} {returns.length === 1 ? 'item' : 'itens'} ·{' '}
                  <strong>{formatBRL(totalPerdaFiltrada)}</strong>
                </span>
              </div>

              <div className="returns-filter-row">
                <span>Motivo:</span>
                <button className={`filter-chip ${reasonFilter === 'todos' ? 'active' : ''}`} onClick={() => setReasonFilter('todos')}>
                  Todos ({allReturns.length})
                </button>
                {groupCounts.filter(group => group.count > 0).map(group => (
                  <button
                    key={group.id}
                    className={`filter-chip ${reasonFilter === group.id ? 'active' : ''}`}
                    onClick={() => setReasonFilter(group.id)}
                  >
                    {group.label} ({group.count})
                  </button>
                ))}
              </div>

              <div className="returns-filter-row">
                <span>Operadora:</span>
                {['todas', ...operators].map(operator => (
                  <button
                    key={operator}
                    className={`filter-chip ${operatorFilter === operator ? 'active' : ''}`}
                    onClick={() => setOperatorFilter(operator)}
                  >
                    {operator === 'todas' ? 'Todas' : operator}
                  </button>
                ))}
              </div>
            </div>

            <div className="returns-list">
              {loading ? (
                <div className="empty">Carregando retornos...</div>
              ) : returns.length === 0 ? (
                <div className="empty">Nenhuma devolução com esses filtros.</div>
              ) : (
                returns.map(item => {
                  const reason = classifyReason(item.motivo_retorno);
                  return (
                    <div
                      key={item.id}
                      className="return-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedReturn(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedReturn(item);
                        }
                      }}
                    >
                      <div className="return-item-left">
                        <div className="return-reason-tag">
                          <I.AlertTriangle size={12} />
                          {reason.label}
                        </div>
                        <div className="return-client">{getClient(item)}</div>
                        <div className="return-meta">
                          <span>#{item.id}</span>
                          <span>·</span>
                          <span>{getOperator(item)}</span>
                          <span>·</span>
                          <span>{getPlan(item)}</span>
                          <span>·</span>
                          <span>Vendedor: {getSeller(item)}</span>
                        </div>
                        <div className="return-reason-detail">
                          <span>Descrição</span>
                          <div>{item.motivo_retorno || 'Sem descrição informada'}</div>
                        </div>
                        {getReturnObservation(item) && (
                          <div className="return-reason-detail return-observation-preview">
                            <span>Observação</span>
                            <div>{getReturnObservation(item)}</div>
                          </div>
                        )}
                      </div>
                      <div className="return-item-right">
                        <div className="return-value">{formatBRL(getValue(item))}</div>
                        <div className="muted">Retornou {relTime(getReturnDate(item))}</div>
                        <div className="return-open-hint">Abrir correção <I.ArrowRight size={12} /></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default RetornosPage;
