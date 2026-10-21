import NavigationDetails from '../../components/NavigationDetails';
import { useNavigationRecord } from '../../utils/useNavigationRecord';
import { useNavigationState } from '../../utils/useNavigationState';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { listarClientes } from '../../services/cliente.service';
import { listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import {
  atualizarVenda,
  aprovarSolicitacaoVenda,
  buscarVendaPorId,
  enviarVendaParaPosVenda,
  listarAprovacoesVenda,
  listarVendedoras,
  recusarSolicitacaoVenda
} from '../../services/venda.service';
import VendaModal from './VendaModal';
import { formatUtcDateTime } from '../../utils/datetime';
import {
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam
} from '../../services/notificacao-abertura.service';
import './VendasPage.css';

const STATUS_LABEL = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  obsoleta: 'Obsoleta'
};

const STATUS_CLASS = {
  pendente: 'warn',
  aprovada: 'success',
  recusada: 'danger',
  obsoleta: ''
};

const MOTIVO_LABEL = {
  venda_compartilhada: 'Venda compartilhada',
  cliente_venda_em_andamento: 'Cliente com venda em andamento',
  cliente_venda_concluida_recente: 'Cliente com venda concluída há menos de 24 meses'
};

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
  }, '-');
}

/**
 * Retorna nome venda no formato esperado pelo fluxo.
 */
function nomeVenda(venda) {
  return venda?.cliente?.nome || venda?.nome || venda?.razao_social || `Venda #${venda?.id}`;
}

/**
 * Retorna nomes vendedoras no formato esperado pelo fluxo.
 */
function nomesVendedoras(venda) {
  const nomes = Array.isArray(venda?.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras.map(item => item.nome).filter(Boolean)
    : [venda?.vendedora?.nome].filter(Boolean);

  return nomes.length > 0 ? nomes.join(', ') : '-';
}

/**
 * Renderiza vendas aprovacoes page.
 */
function VendasAprovacoesPage() {
  const [searchParams] = useSearchParams();
  const usuario = getUsuarioLocal();
  const podeDecidir = temPermissao(usuario, 'vendas_aprovacoes_decidir');
  const podeEditarVenda = temPermissao(usuario, ['vendas_editar', 'pos_venda']);
  const podeCompartilharVenda = temPermissao(usuario, 'compartilhar_venda');
  const podeVerDocumentosVenda = temPermissao(usuario, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuario, 'adicionar_documentos');
  const [status, setStatus] = useNavigationState('VendasAprovacoesPage:status', searchParams.get('status') || (searchParams.has('solicitacao_id') ? '' : 'pendente'), { preferInitial: searchParams.has('status') || searchParams.has('solicitacao_id') });
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [vendedoras, setVendedoras] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [tiposVenda, setTiposVenda] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvandoId, setSalvandoId] = useState(null);
  const [recusando, setRecusando] = useState(null);
  const [vendaModal, setVendaModal] = useState(null);
  const [modalModoEdicao, setModalModoEdicao] = useState(false);
  const [, setCarregandoVendaId] = useState(null);
  const [solicitacaoModal, setSolicitacaoModal] = useNavigationRecord('VendasAprovacoesPage:solicitacao', {
    load: id => solicitacoes.find(item => String(item.id) === String(id)),
    ready: !carregando && !searchParams.has('solicitacao_id'),
    onRestore: solicitacao => { void abrirVenda(solicitacao); },
    onError: error => setErro(error.message)
  });
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const solicitacaoFoco = searchParams.get('solicitacao_id');
  const notificacaoId = getNotificacaoIdParam(searchParams);
  const aberturaNotificacaoProcessadaRef = useRef('');

  /**
   * Carrega  e atualiza o estado relacionado.
   */
  async function carregar(silencioso = false) {
    if (!silencioso) {
      setCarregando(true);
      setErro('');
    }

    try {
      const filtros = status ? { status } : {};
      const dados = await listarAprovacoesVenda(filtros);
      setSolicitacoes(Array.isArray(dados) ? dados : []);
    } catch (error) {
      if (!silencioso) setErro(error.message || 'Erro ao carregar aprovações.');
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    const atualizar = () => {
      listarAprovacoesVenda(status ? { status } : {})
        .then(dados => {
          if (ativo) setSolicitacoes(Array.isArray(dados) ? dados : []);
        })
        .catch(error => {
          if (ativo) setErro(error.message || 'Erro ao carregar aprovações.');
        })
        .finally(() => {
          if (ativo) setCarregando(false);
        });
    };
    atualizar();
    // Decisões feitas pelo Telegram não passam pelo navegador. Atualizamos a
    // lista em segundo plano para refletir a decisão quase imediatamente.
    const intervalo = setInterval(atualizar, 3000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [status]);

  useEffect(() => {
    let ativo = true;
    Promise.all([listarClientes(), listarVendedoras(), listarOperadoras(), listarTiposVenda(), listarServicos()])
      .then(([clientesData, vendedorasData, operadorasData, tiposVendaData, servicosData]) => {
        if (!ativo) return;
        setClientes(clientesData);
        setVendedoras(vendedorasData);
        setOperadoras(operadorasData);
        setTiposVenda(tiposVendaData);
        setServicos(servicosData);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar dados do modal de venda.');
      });
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  const solicitacoesOrdenadas = useMemo(() => {
    if (!solicitacaoFoco) return solicitacoes;

    return [...solicitacoes].sort((a, b) => {
      if (String(a.id) === String(solicitacaoFoco)) return -1;
      if (String(b.id) === String(solicitacaoFoco)) return 1;
      return 0;
    });
  }, [solicitacoes, solicitacaoFoco]);

  /** Abre a venda vinculada com os dados atuais da solicitação. */
  const abrirVenda = useCallback(async (solicitacao, notificacaoIdAbertura = null) => {
    setErro('');
    setCarregandoVendaId(solicitacao.venda_id);

    try {
      const venda = await buscarVendaPorId(solicitacao.venda_id);
      setVendaModal(venda || solicitacao.venda);
      setSolicitacaoModal(solicitacao);
      setModalModoEdicao(false);
      if (notificacaoIdAbertura) {
        void confirmarAberturaNotificacao(notificacaoIdAbertura).catch(error => {
          console.error('Erro ao confirmar abertura da notificacao:', error);
        });
      }
    } catch (error) {
      if (notificacaoIdAbertura) falharAberturaNotificacao(notificacaoIdAbertura);
      setSolicitacaoModal(null);
      setErro(error.message || 'Erro ao abrir venda.');
    } finally {
      setCarregandoVendaId(null);
    }
  }, [setSolicitacaoModal]);


  useEffect(() => {
    if (carregando || !solicitacaoFoco || !notificacaoId) return;
    const chaveAbertura = `${solicitacaoFoco}:${notificacaoId}`;
    if (aberturaNotificacaoProcessadaRef.current === chaveAbertura) return;
    aberturaNotificacaoProcessadaRef.current = chaveAbertura;
    const encontrada = solicitacoes.find(item => String(item.id) === String(solicitacaoFoco));
    if (encontrada) {
      const timer = setTimeout(() => { void abrirVenda(encontrada, notificacaoId); }, 0);
      return () => {
        clearTimeout(timer);
        if (aberturaNotificacaoProcessadaRef.current === chaveAbertura) aberturaNotificacaoProcessadaRef.current = '';
      };
    }
    falharAberturaNotificacao(notificacaoId);
    queueMicrotask(() => setErro('A solicitação desta notificação não está mais disponível.'));
  }, [abrirVenda, carregando, notificacaoId, solicitacaoFoco, solicitacoes]);

  /**
   * Processa aprovar conforme as regras do dominio.
   */
  async function aprovar(solicitacao) {
    setSalvandoId(solicitacao.id);
    setErro('');

    try {
      await aprovarSolicitacaoVenda(solicitacao.id);
      setSucesso('Solicitação aprovada. A venda já pode ser enviada ao pós-venda.');
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
      await carregar();
    } catch (error) {
      setErro(error.message || 'Erro ao aprovar solicitação.');
    } finally {
      setSalvandoId(null);
    }
  }

  /**
   * Processa recusar conforme as regras do dominio.
   */
  async function recusar(solicitacao) {
    setSalvandoId(solicitacao.id);
    setErro('');

    try {
      await recusarSolicitacaoVenda(solicitacao.id, { observacao });
      setSucesso('Solicitação recusada.');
      setRecusando(null);
      setObservacao('');
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
      await carregar();
    } catch (error) {
      setErro(error.message || 'Erro ao recusar solicitação.');
    } finally {
      setSalvandoId(null);
    }
  }

  /**
   * Renderiza salvar venda modal.
   */
  async function salvarVendaModal(dados) {
    if (!vendaModal?.id) return;

    await atualizarVenda(vendaModal.id, dados);
    const atualizada = await buscarVendaPorId(vendaModal.id);
    setVendaModal(atualizada);
    setModalModoEdicao(false);
    setSucesso('Venda atualizada com sucesso.');
    await carregar();
  }

  /**
   * Renderiza enviar pos venda modal.
   */
  async function enviarPosVendaModal(venda) {
    const resultado = await enviarVendaParaPosVenda(venda.id);
    const atualizada = await buscarVendaPorId(venda.id);
    setVendaModal(atualizada);
    setModalModoEdicao(false);
    setSucesso(resultado?.status === 'pendente'
      ? (resultado.message || 'Solicitação enviada para aprovação do ADM.')
      : 'Venda enviada para o pós-venda.');
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    await carregar();
  }

  /**
   * Renderiza aprovar eenviar pos venda modal.
   */
  async function aprovarEEnviarPosVendaModal(venda) {
    if (solicitacaoModal?.id) {
      await aprovarSolicitacaoVenda(solicitacaoModal.id);
    }
    await enviarVendaParaPosVenda(venda.id);
    const atualizada = await buscarVendaPorId(venda.id);
    setVendaModal(atualizada);
    setModalModoEdicao(false);
    setSucesso('Venda aprovada e enviada para o pós-venda.');
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    await carregar();
  }

  return (
    <LayoutPrivado>
      <div className="vendas-page">
        <div className="vendas-toolbar vendas-toolbar--approval-status">
          <div className="filter-field vendas-toolbar-status">
            <label>Status</label>
            <select value={status} onChange={event => { setCarregando(true); setStatus(event.target.value); }}>
              <option value="">Todos</option>
              <option value="pendente">Pendentes</option>
              <option value="aprovada">Aprovadas</option>
              <option value="recusada">Recusadas</option>
              <option value="obsoleta">Obsoletas</option>
            </select>
          </div>

          <button type="button" className="btn vendas-toolbar-refresh" onClick={carregar} title="Atualizar solicitações">
            <I.Refresh size={14} /> <span>Atualizar</span>
          </button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          {solicitacoes.length} solicitações encontradas
        </div>

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erro}</div>}

        <div className="list-table" style={{ margin: 0 }}>
          <div className="scroll" data-navigation-scroll="VendasAprovacoesPage-1">
            <table>
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Motivos</th>
                  <th>Vendedoras</th>
                  <th>Solicitante</th>
                  <th>Status</th>
                  <th>Solicitada em</th>
                  <th>Decisão</th>
                  <th className="aprovacoes-actions-col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Carregando solicitações...
                    </td>
                  </tr>
                ) : solicitacoesOrdenadas.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Nenhuma solicitação encontrada.
                    </td>
                  </tr>
                ) : solicitacoesOrdenadas.map(solicitacao => (
                  <tr key={solicitacao.id} className={`clickable-row is-tappable ${String(solicitacao.id) === String(solicitacaoFoco) ? 'row-highlight' : ''}`} role="button" tabIndex={0} onClick={() => abrirVenda(solicitacao)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); abrirVenda(solicitacao); } }}>
                    <td data-label="Venda" className="m-primary">
                      <div className="vendas-table-name">
                        <div className="vendas-table-name__title">
                          <strong>{nomeVenda(solicitacao.venda)}</strong>
                        </div>
                        <span>{solicitacao.venda?.cliente?.razao_social || solicitacao.venda?.razao_social || `Venda #${solicitacao.venda_id}`}</span>
                        <NavigationDetails navigationScope={`aprovacoes:${solicitacao.id}`} className="mobile-row-drawer">
                          <summary>Ver detalhes da solicitacao</summary>
                          <dl>
                            <dt>Motivos</dt>
                            <dd>{(solicitacao.motivos || []).map(motivo => MOTIVO_LABEL[motivo] || motivo).join(', ') || '-'}</dd>
                            <dt>Descrição</dt>
                            <dd>{solicitacao.motivo_descricao || '-'}</dd>
                            <dt>Vendedoras</dt>
                            <dd>{nomesVendedoras(solicitacao.venda)}</dd>
                            <dt>Solicitante</dt>
                            <dd>{solicitacao.solicitante?.nome || '-'}</dd>
                            <dt>Solicitada em</dt>
                            <dd>{formatarData(solicitacao.solicitado_em)}</dd>
                            <dt>Decisao</dt>
                            <dd>
                              {solicitacao.decisor?.nome
                                ? `${solicitacao.decisor.nome} - ${formatarData(solicitacao.decidido_em)}`
                                : '-'}
                            </dd>
                          </dl>
                        </NavigationDetails>
                      </div>
                    </td>
                    <td data-label="Motivos" data-mobile-hidden="true">
                      {(solicitacao.motivos || []).map(motivo => (
                        <span key={motivo} className="tag" style={{ marginRight: 6 }}>
                          {MOTIVO_LABEL[motivo] || motivo}
                        </span>
                      ))}
                    </td>
                    <td data-label="Vendedoras" data-mobile-hidden="true">{nomesVendedoras(solicitacao.venda)}</td>
                    <td data-label="Solicitante" className="m-secondary">{solicitacao.solicitante?.nome || '-'} · {formatarData(solicitacao.solicitado_em)}</td>
                    <td data-label="Status" className="m-meta">
                      <span className={`pill ${STATUS_CLASS[solicitacao.status] || ''}`}>
                        <span className="pill-dot"></span>
                        {STATUS_LABEL[solicitacao.status] || solicitacao.status}
                      </span>
                    </td>
                    <td data-label="Solicitada em" data-mobile-hidden="true">{formatarData(solicitacao.solicitado_em)}</td>
                    <td data-label="Decisao" data-mobile-hidden="true">
                      {solicitacao.decisor?.nome ? (
                        <div>
                          <strong style={{ fontSize: 12 }}>{solicitacao.decisor.nome}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>{formatarData(solicitacao.decidido_em)}</div>
                          {solicitacao.observacao_decisao && (
                            <div className="muted" style={{ fontSize: 12 }}>{solicitacao.observacao_decisao}</div>
                          )}
                        </div>
                      ) : '-'}
                    </td>
                    <td data-label="Acoes" className="aprovacoes-actions-col m-actions">
                      <div className="aprovacoes-actions">
{podeDecidir && solicitacao.status === 'pendente' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary aprovacao-action-approve"
                              disabled={salvandoId === solicitacao.id}
                              onClick={event => { event.stopPropagation(); aprovar(solicitacao); }}
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost aprovacao-action-reject"
                              disabled={salvandoId === solicitacao.id}
                              onClick={event => {
                                event.stopPropagation();
                                setRecusando(solicitacao);
                                setObservacao('');
                              }}
                            >
                              Recusar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {recusando && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div className="modal-header-row">
                <div>
                  <div className="modal-client">Recusar solicitação</div>
                  <div className="modal-sub">{nomeVenda(recusando.venda)}</div>
                </div>
                <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={() => setRecusando(null)}>
                  <I.Close size={14} />
                </button>
              </div>
            </div>

            <div className="modal-body" data-navigation-scroll="VendasAprovacoesPage-2">
              <div className="form-field">
                <label>Observação</label>
                <textarea
                  value={observacao}
                  onChange={event => setObservacao(event.target.value)}
                  placeholder="Descreva o motivo da recusa"
                  rows={4}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setRecusando(null)}>Cancelar</button>
              <button type="button" className="btn btn-danger" disabled={salvandoId === recusando.id} onClick={() => recusar(recusando)}>
                {salvandoId === recusando.id ? 'Recusando...' : 'Recusar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {vendaModal && (
        <VendaModal
          venda={vendaModal}
          initialValues={null}
          clientes={clientes}
          vendas={solicitacoes.map(solicitacao => solicitacao.venda).filter(Boolean)}
          vendedoras={vendedoras}
          operadoras={operadoras}
          tiposVenda={tiposVenda}
          servicos={servicos}
          vendasPorCliente={new Map()}
          podeEditarVenda={podeEditarVenda}
          podeCompartilharVenda={podeCompartilharVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuario}
          motivoLiberacaoAprovacao={solicitacaoModal?.motivo_descricao || ''}
          initialTab="venda"
          initialProblemaId={null}
          modoEdicao={modalModoEdicao}
          onStartEdit={() => setModalModoEdicao(true)}
          onClose={() => {
            setVendaModal(null);
            setSolicitacaoModal(null);
            setModalModoEdicao(false);
          }}
          onSave={salvarVendaModal}
          onSendToPosVenda={podeDecidir && solicitacaoModal?.status === 'pendente' ? aprovarEEnviarPosVendaModal : enviarPosVendaModal}
          sendToPosVendaLabel={podeDecidir && solicitacaoModal?.status === 'pendente' ? 'Aprovar' : 'Enviar para o pós-venda'}
          ignorarSolicitacaoLiberacao={podeDecidir && solicitacaoModal?.status === 'pendente'}
          onCreateClient={() => {}}
        />
      )}
    </LayoutPrivado>
  );
}

export default VendasAprovacoesPage;
