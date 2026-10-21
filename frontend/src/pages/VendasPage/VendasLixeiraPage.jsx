import NavigationDetails from '../../components/NavigationDetails';
import { useNavigationState } from '../../utils/useNavigationState';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { deletarVendaDefinitivo, listarVendasLixeira, restaurarVenda } from '../../services/venda.service';
import { formatDateValue } from '../../utils/datetime';
import { formatarNomeServico } from '../../utils/servicos';
import './VendasPage.css';

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(value) {
  return formatDateValue(value, undefined, '-');
}

/**
 * Formata moeda para exibicao ou envio.
 */
function formatarMoeda(value) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Renderiza confirmar exclusao definitiva modal.
 */
function ConfirmarExclusaoDefinitivaModal({ venda, excluindo, onClose, onConfirm }) {
  if (!venda) return null;

  return (
    <div className="modal-overlay" onClick={event => !excluindo && event.target === event.currentTarget && onClose()}>
      <div className="modal trash-confirm-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Excluir venda definitivamente?</div>
              <div className="modal-sub">{venda.cliente?.nome || venda.nome || `Venda #${venda.id}`}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={excluindo}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="VendasLixeiraPage-1">
          <div className="trash-warning">
            <I.AlertTriangle size={20} />
            <div>
              <strong>Esta exclusão não pode ser desfeita.</strong>
              <span>A venda será removida permanentemente da lixeira.</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={excluindo}>
            {excluindo ? 'Excluindo...' : 'Excluir definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza vendas lixeira page.
 */
function VendasLixeiraPage() {
  const navigate = useNavigate();
  const usuario = getUsuarioLocal();
  const podeExcluirVenda = temPermissao(usuario, 'vendas_excluir');
  const [vendas, setVendas] = useState([]);
  const [busca, setBusca] = useNavigationState('VendasLixeiraPage:busca', '');
  const buscaDeferred = useDeferredValue(busca);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [processandoId, setProcessandoId] = useState(null);
  const [vendaParaExcluir, setVendaParaExcluir] = useState(null);

  const filtros = useMemo(() => ({ busca: buscaDeferred }), [buscaDeferred]);

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

  /**
   * Carrega dados e atualiza o estado relacionado.
   */
  async function carregarDados(proximosFiltros = filtros) {
    setErro('');
    setCarregando(true);

    try {
      setVendas(await listarVendasLixeira(proximosFiltros));
    } catch (error) {
      setErro(error.message || 'Erro ao carregar lixeira de vendas.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    listarVendasLixeira({ busca: '' })
      .then(data => { if (ativo) setVendas(data); })
      .catch(error => { if (ativo) setErro(error.message || 'Erro ao carregar lixeira de vendas.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  /**
   * Trata o evento de buscar.
   */
  async function handleBuscar(event) {
    event.preventDefault();
    await carregarDados({ busca });
  }

  /**
   * Trata o evento de restaurar.
   */
  async function handleRestaurar(venda) {
    setProcessandoId(venda.id);
    setErro('');
    setSucesso('');

    try {
      await restaurarVenda(venda.id);
      setVendas(prev => prev.filter(item => item.id !== venda.id));
      setSucesso('Venda restaurada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao restaurar venda.');
    } finally {
      setProcessandoId(null);
    }
  }

  /**
   * Executa a acao de confirmar exclusao definitiva mantendo o estado da tela consistente.
   */
  async function confirmarExclusaoDefinitiva() {
    if (!vendaParaExcluir) return;

    setProcessandoId(vendaParaExcluir.id);
    setErro('');
    setSucesso('');

    try {
      await deletarVendaDefinitivo(vendaParaExcluir.id);
      setVendas(prev => prev.filter(item => item.id !== vendaParaExcluir.id));
      setVendaParaExcluir(null);
      setSucesso('Venda excluída definitivamente.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir venda definitivamente.');
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <LayoutPrivado>
      <ConfirmarExclusaoDefinitivaModal
        venda={vendaParaExcluir}
        excluindo={processandoId === vendaParaExcluir?.id}
        onClose={() => setVendaParaExcluir(null)}
        onConfirm={confirmarExclusaoDefinitiva}
      />

      <div className="vendas-page">
        <div className="vendas-toolbar vendas-toolbar--trash">
          <form className="search-box" onSubmit={handleBuscar}>
            <I.Search size={14} />
            <input
              value={busca}
              onChange={event => setBusca(event.target.value)}
              placeholder="Buscar na lixeira de vendas"
            />
          </form>

          <button className="btn" type="button" onClick={() => navigate('/vendas')}>
            <I.ArrowRight size={14} style={{ transform: 'rotate(180deg)' }} /> Voltar
          </button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          {vendas.length} vendas na lixeira
        </div>

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erro}</div>}

        <div className="list-table" style={{ margin: 0 }}>
          <div className="scroll" data-navigation-scroll="VendasLixeiraPage-2">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Operadora</th>
                  <th>Produto</th>
                  <th>Valor</th>
                  <th>Enviada em</th>
                  <th>Exclusão definitiva</th>
                  <th>Enviada por</th>
                  {podeExcluirVenda && (
                    <th className="vendas-trash-actions-col">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={podeExcluirVenda ? 8 : 7} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Carregando lixeira...
                    </td>
                  </tr>
                ) : vendas.length === 0 ? (
                  <tr>
                    <td colSpan={podeExcluirVenda ? 8 : 7} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Nenhuma venda na lixeira.
                    </td>
                  </tr>
                ) : (
                  vendas.map(venda => (
                    <tr key={venda.id} className="vendas-trash-row">
                      <td data-label="Cliente" className="m-primary">
                        <div className="vendas-table-name">
                          <div className="vendas-table-name__title">
                            <strong>{venda.cliente?.nome || venda.nome}</strong>
                            {venda.cliente_excluido_permanentemente_em && (
                              <span className="vendas-cliente-excluido-badge">
                                <I.AlertTriangle size={11} />
                                Cliente excluído
                              </span>
                            )}
                          </div>
                          <span>
                            {venda.cliente_excluido_permanentemente_nome
                              || venda.cliente?.razao_social
                              || venda.razao_social
                              || venda.telefone
                              || venda.email
                              || '-'}
                            {venda.cliente_excluido_permanentemente_cnpj ? ` - ${venda.cliente_excluido_permanentemente_cnpj}` : ''}
                          </span>
                          <NavigationDetails navigationScope={`vendas-lixeira:${venda.id}`} className="mobile-row-drawer">
                            <summary>Ver dados da lixeira</summary>
                            <dl>
                              <dt>Operadora</dt>
                              <dd>{venda.operadora?.nome || '-'}</dd>
                              <dt>Produto</dt>
                              <dd>{formatarNomeServico(venda.servico?.nome) || venda.tipoVenda?.nome || '-'}</dd>
                              <dt>Valor</dt>
                              <dd>{formatarMoeda(venda.valor_total)}</dd>
                              <dt>Enviada em</dt>
                              <dd>{formatarData(venda.excluido_em)}</dd>
                              <dt>Exclusao definitiva</dt>
                              <dd>{formatarData(venda.excluir_definitivo_em)}</dd>
                              <dt>Enviada por</dt>
                              <dd>{venda.excluidoPor?.nome || '-'}</dd>
                            </dl>
                          </NavigationDetails>
                        </div>
                      </td>
                      <td data-label="Operadora" className="m-secondary"><span className="tag">{venda.operadora?.nome || '-'}</span> · {formatarNomeServico(venda.servico?.nome) || venda.tipoVenda?.nome || '-'}</td>
                      <td data-label="Produto" data-mobile-hidden="true">{formatarNomeServico(venda.servico?.nome) || venda.tipoVenda?.nome || '-'}</td>
                      <td data-label="Valor" className="vendas-value m-meta">{formatarMoeda(venda.valor_total)}</td>
                      <td data-label="Enviada em" data-mobile-hidden="true">{formatarData(venda.excluido_em)}</td>
                      <td data-label="Exclusao definitiva" data-mobile-hidden="true">{formatarData(venda.excluir_definitivo_em)}</td>
                      <td data-label="Enviada por" data-mobile-hidden="true"><span className="tag">{venda.excluidoPor?.nome || '-'}</span></td>
                      {podeExcluirVenda && (
                        <td data-label="Acoes" className="vendas-trash-actions-col m-actions">
                          <div className="vendas-trash-actions">
                            <button className="btn btn-sm vendas-restore-action" disabled={processandoId === venda.id} onClick={() => handleRestaurar(venda)}>
                              <I.Return size={13} /> Restaurar
                            </button>
                            <button
                              className="btn btn-sm btn-ghost btn-danger-icon vendas-trash-delete"
                              disabled={processandoId === venda.id}
                              onClick={() => setVendaParaExcluir(venda)}
                            >
                              <I.Trash size={13} /> Excluir
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default VendasLixeiraPage;
