import { useNavigationState } from '../../utils/useNavigationState';
import { useEffect, useMemo, useState } from 'react';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import Paginacao from '../../components/Paginacao/Paginacao';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { sanitizarCnpj, validarDigitosCnpj } from '../../services/cnpj.service';
import { atualizarClienteAntigo, buscarClienteAntigo, excluirClienteAntigo, listarHistoricoClientesAntigos } from '../../services/cliente-antigo.service';
import '../Clientes/Clientes.css';
import './ClientesAntigosPage.css';

/**
 * Formata um CNPJ (parcial ou completo) para exibicao 00.000.000/0000-00.
 */
function formatarCnpj(valor) {
  const d = sanitizarCnpj(valor);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Formata a quantidade de chips para exibicao.
 */
function formatarQuantidadeChips(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toLocaleString('pt-BR') : '-';
}

/**
 * Formata uma data (YYYY-MM-DD ou ISO) para DD/MM/AAAA. Retorna '-' se vazio.
 */
function formatarData(valor) {
  if (!valor) return '-';
  const texto = String(valor);
  const match = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

/**
 * Formata timestamp para "DD/MM/AA às HH:MM".
 */
function formatarDataHora(valor) {
  if (!valor) return '-';
  const data = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T'));
  if (Number.isNaN(data.getTime())) return String(valor);
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');
  const aa = String(data.getFullYear()).slice(2);
  const hh = String(data.getHours()).padStart(2, '0');
  const min = String(data.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${aa} às ${hh}:${min}`;
}

function valorDataInput(valor) {
  if (!valor) return '';
  const match = String(valor).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function tituloVendaAntiga(venda) {
  return venda?.razao_social || venda?.cnpj || `Registro #${venda?.id}`;
}

function ConfirmarExclusaoClienteAntigoModal({ venda, excluindo, onClose, onConfirm }) {
  if (!venda) return null;

  return (
    <div className="modal-overlay cliente-antigo-modal-overlay" onClick={event => !excluindo && event.target === event.currentTarget && onClose()}>
      <div className="modal cliente-antigo-confirm-delete-modal" role="dialog" aria-modal="true" aria-labelledby="cliente-antigo-delete-title">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="cliente-antigo-delete-title" className="modal-client">Excluir cliente antigo?</div>
              <div className="modal-sub">{tituloVendaAntiga(venda)}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={excluindo} title="Fechar">
              <I.Close size={16} />
            </button>
          </div>
        </div>
        <div className="modal-body" data-navigation-scroll="ClientesAntigosPage-1">
          <div className="cliente-antigo-delete-warning">
            <div className="cliente-antigo-delete-warning__icon">
              <I.AlertTriangle size={22} />
            </div>
            <div>
              <strong>Essa acao remove o registro da base de clientes antigos.</strong>
              <p>
                {venda.cnpj ? `Documento ${venda.cnpj}. ` : ''}
                {venda.data_venda ? `Venda de ${formatarData(venda.data_venda)}. ` : ''}
                Depois da exclusao, ele deixa de aparecer nas buscas e sera necessario importar ou cadastrar novamente para recuperar.
              </p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={excluindo}>
            <I.Trash size={13} /> {excluindo ? 'Excluindo...' : 'Excluir registro'}
          </button>
        </div>
      </div>
    </div>
  );
}
function ClienteAntigoEditModal({ venda, salvando, excluindo, erro, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    razao_social: venda?.razao_social || '',
    cnpj: venda?.cnpj || '',
    operadora: venda?.operadora || '',
    responsavel_nome: venda?.responsavel_nome || '',
    telefone: venda?.telefone || '',
    data_venda: valorDataInput(venda?.data_venda),
    quantidade_chips: venda?.quantidade_chips ?? ''
  }));

  function alterar(campo, valor) {
    setForm(prev => ({ ...prev, [campo]: valor }));
  }

  function enviar(event) {
    event.preventDefault();
    onSave(form);
  }


  return (
    <div className="modal-overlay cliente-antigo-modal-overlay">
      <div className="modal cliente-antigo-modal">
        <form onSubmit={enviar}>
          <div className="modal-header">
            <div>
              <div className="modal-client">Editar cliente antigo</div>
              <h2>{venda?.razao_social || venda?.cnpj || 'Registro antigo'}</h2>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={salvando || excluindo}>
              <I.Close size={16} />
            </button>
          </div>

          <div className="modal-body" data-navigation-scroll="ClientesAntigosPage-2">
            {erro && <div className="alert-error">{erro}</div>}
            <div className="cliente-antigo-form-grid">
              <div className="form-field span-2">
                <label>Razao social</label>
                <input value={form.razao_social} onChange={event => alterar('razao_social', event.target.value)} maxLength={255} />
              </div>
              <div className="form-field">
                <label>Documento</label>
                <input value={form.cnpj} onChange={event => alterar('cnpj', event.target.value)} maxLength={18} placeholder="CPF ou CNPJ" />
              </div>
              <div className="form-field">
                <label>Operadora</label>
                <input value={form.operadora} onChange={event => alterar('operadora', event.target.value)} maxLength={255} />
              </div>
              <div className="form-field">
                <label>Responsável</label>
                <input value={form.responsavel_nome} onChange={event => alterar('responsavel_nome', event.target.value)} maxLength={255} />
              </div>
              <div className="form-field">
                <label>Telefone</label>
                <input value={form.telefone} onChange={event => alterar('telefone', event.target.value)} maxLength={80} />
              </div>
              <div className="form-field">
                <label>Data da venda/Ativação</label>
                <input type="date" value={form.data_venda} onChange={event => alterar('data_venda', event.target.value)} />
              </div>
              <div className="form-field">
                <label>Chips</label>
                <input type="number" min="0" step="1" value={form.quantidade_chips} onChange={event => alterar('quantidade_chips', event.target.value)} />
              </div>
            </div>
          </div>

          <div className="modal-footer cliente-antigo-modal-footer">
            <button type="button" className="btn btn-danger cliente-antigo-delete-btn" onClick={onDelete} disabled={salvando || excluindo}>
              <I.Trash size={13} /> {excluindo ? 'Excluindo...' : 'Excluir'}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={salvando || excluindo}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={salvando || excluindo}>
              {salvando ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
/**
 * Pagina de busca de clientes antigos (vendas fora da fidelidade) e historico de buscas.
 */
function ClientesAntigosPage() {
  const usuario = getUsuarioLocal();
  const podeBuscar = temPermissao(usuario, 'clientes_antigos_buscar');
  const podeHistorico = temPermissao(usuario, 'clientes_antigos_ver_historico');
  const podeEditarAntigos = temPermissao(usuario, 'clientes_antigos_editar');

  const abas = useMemo(() => [
    { id: 'buscar', label: 'Buscar', permitido: podeBuscar },
    { id: 'historico', label: 'Histórico de buscas', permitido: podeHistorico }
  ].filter(item => item.permitido), [podeBuscar, podeHistorico]);

  const [aba, setAba] = useNavigationState('ClientesAntigosPage:aba', abas[0]?.id || '', { allowed: abas.map(item => item.id) });

  // --- Busca ---
  const [termoInput, setTermoInput] = useNavigationState('ClientesAntigosPage:termoInput', '');
  const [consultaAplicada, setConsultaAplicada] = useNavigationState('ClientesAntigosPage:consulta', '');
  const [buscando, setBuscando] = useState(Boolean(consultaAplicada) && podeBuscar);
  const [resposta, setResposta] = useState(null);
  const [paginaBusca, setPaginaBusca] = useNavigationState('ClientesAntigosPage:paginaBusca', 1);
  const [consultaInicial, setConsultaInicial] = useState(() => consultaAplicada ? { termo: consultaAplicada, pagina: paginaBusca } : null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!consultaInicial || !podeBuscar) return undefined;
    let ativo = true;
    buscarClienteAntigo(consultaInicial.termo, { page: consultaInicial.pagina, per_page: 20 })
      .then(data => { if (ativo) setResposta(data); })
      .catch(error => { if (ativo) setErro(error.message || 'Erro ao restaurar busca.'); })
      .finally(() => { if (ativo) setBuscando(false); });
    return () => { ativo = false; };
  }, [consultaInicial, podeBuscar]);

  const cnpjDigitos = sanitizarCnpj(termoInput);
  const vendasClientes = resposta?.vendas_clientes || [];
  const temVendasClientes = vendasClientes.length > 0;
  const temVendasAntigas = (resposta?.resultados || []).length > 0;
  const cnpjValido = cnpjDigitos.length === 14 && validarDigitosCnpj(cnpjDigitos);
  const termoBuscavel = cnpjValido || termoInput.trim().length >= 3;

  /**
   * Mascara de CNPJ so quando o texto ainda pode ser um documento; nomes de
   * empresa passam crus.
   */
  function alterarTermo(valor) {
    const texto = String(valor || '');
    const apenasDocumento = texto.replace(/[0-9.\-/\s]/g, '') === '';
    setTermoInput(apenasDocumento && sanitizarCnpj(texto).length > 11 ? formatarCnpj(texto) : texto);
  }

  async function executarBusca(pagina) {
    setConsultaInicial(null);
    setBuscando(true);
    setErro('');

    try {
      const data = await buscarClienteAntigo(termoInput, { page: pagina, per_page: 20 });
      setResposta(data);
      setConsultaAplicada(termoInput);
      setPaginaBusca(pagina);
    } catch (error) {
      setResposta(null);
      setErro(error.message || 'Erro ao buscar cliente antigo.');
    } finally {
      setBuscando(false);
    }
  }

  async function buscar(event) {
    event.preventDefault();
    if (!termoBuscavel || buscando) return;
    await executarBusca(1);
  }

  // --- Historico ---
  const [historico, setHistorico] = useState([]);
  const [totalHistorico, setTotalHistorico] = useState(0);
  const [pagina, setPagina] = useNavigationState('ClientesAntigosPage:pagina', 1);
  const [porPagina, setPorPagina] = useNavigationState('ClientesAntigosPage:porPagina', 20);
  const [buscaHistorico, setBuscaHistorico] = useNavigationState('ClientesAntigosPage:buscaHistorico', '');
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState('');
  const [vendaEditando, setVendaEditando] = useState(null);
  const [vendaParaExcluir, setVendaParaExcluir] = useState(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [excluindoEdicao, setExcluindoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState('');

  useEffect(() => {
    if (aba !== 'historico' || !podeHistorico) return;

    let ativo = true;
    const timer = setTimeout(async () => {
      setCarregandoHistorico(true);
      setErroHistorico('');
      try {
        const data = await listarHistoricoClientesAntigos({
          page: pagina,
          per_page: porPagina,
          busca: buscaHistorico
        });
        if (!ativo) return;
        setHistorico(data?.data || []);
        setTotalHistorico(Number(data?.total || 0));
      } catch (error) {
        if (ativo) setErroHistorico(error.message || 'Erro ao carregar histórico.');
      } finally {
        if (ativo) setCarregandoHistorico(false);
      }
    }, 300);

    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [aba, podeHistorico, pagina, porPagina, buscaHistorico]);

  function trocarAba(id) {
    setAba(id);
    setErro('');
    setErroHistorico('');
  }

  function alterarBuscaHistorico(valor) {
    const texto = String(valor || '');
    const digitos = sanitizarCnpj(texto);
    const apenasDocumento = digitos && texto.replace(/[0-9.\-/\s]/g, '') === '';

    setPagina(1);
    setBuscaHistorico(apenasDocumento ? formatarCnpj(digitos) : valor);
  }

  function substituirVendaAntiga(vendaAtualizada) {
    setResposta(prev => {
      if (!prev) return prev;

      const atualizarLista = lista => (lista || []).map(item => (
        Number(item.id) === Number(vendaAtualizada.id) ? vendaAtualizada : item
      ));

      return {
        ...prev,
        venda: Number(prev.venda?.id) === Number(vendaAtualizada.id) ? vendaAtualizada : prev.venda,
        resultados: atualizarLista(prev.resultados)
      };
    });
  }

  function removerVendaAntiga(id) {
    setResposta(prev => {
      if (!prev) return prev;

      const removida = Number(id);
      const resultados = (prev.resultados || []).filter(item => Number(item.id) !== removida);

      return {
        ...prev,
        venda: Number(prev.venda?.id) === removida ? (resultados[0] || null) : prev.venda,
        resultados,
        total: Math.max(Number(prev.total || 0) - 1, 0)
      };
    });
  }

  function abrirEdicaoVendaAntiga(venda) {
    setVendaEditando(venda);
    setVendaParaExcluir(null);
    setErroEdicao('');
  }

  function solicitarExclusaoVendaAntiga() {
    if (!vendaEditando?.id || salvandoEdicao || excluindoEdicao) return;
    setErroEdicao('');
    setVendaParaExcluir(vendaEditando);
  }

  async function salvarVendaAntiga(dados) {
    if (!vendaEditando?.id || salvandoEdicao || excluindoEdicao) return;
    setSalvandoEdicao(true);
    setErroEdicao('');

    try {
      const atualizada = await atualizarClienteAntigo(vendaEditando.id, dados);
      substituirVendaAntiga(atualizada);
      setVendaEditando(null);
    } catch (error) {
      setErroEdicao(error.message || 'Erro ao salvar cliente antigo.');
    } finally {
      setSalvandoEdicao(false);
    }
  }
  async function excluirVendaAntiga() {
    const vendaAlvo = vendaParaExcluir || vendaEditando;
    if (!vendaAlvo?.id || salvandoEdicao || excluindoEdicao) return;
    setExcluindoEdicao(true);
    setErroEdicao('');

    try {
      await excluirClienteAntigo(vendaAlvo.id);
      removerVendaAntiga(vendaAlvo.id);
      setVendaParaExcluir(null);
      if (Number(vendaEditando?.id) === Number(vendaAlvo.id)) {
        setVendaEditando(null);
      }
    } catch (error) {
      setErroEdicao(error.message || 'Erro ao excluir cliente antigo.');
    } finally {
      setExcluindoEdicao(false);
    }
  }
  function renderAcoesVendaAntiga(item) {
    if (!podeEditarAntigos) return null;

    return (
      <td className="row-actions">
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          title="Editar registro"
          onClick={() => abrirEdicaoVendaAntiga(item)}
          disabled={!item.id}
        >
          <I.Edit size={13} />
        </button>
      </td>
    );
  }
  return (
    <LayoutPrivado>
      <div className="clientes-antigos-page">
        {abas.length === 0 ? (
          <div className="empty">Você não tem permissão para acessar esta ferramenta.</div>
        ) : (
          <div className="panel">
            <div className="panel-header">
              <div className="config-tabs">
                {abas.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-chip ${aba === item.id ? 'active' : ''}`}
                    onClick={() => trocarAba(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-body">
              {aba === 'buscar' && (
                <div className="clientes-antigos-buscar">
                  <form className="clientes-antigos-form" onSubmit={buscar}>
                    <div className="form-field">
                      <label>Buscar correspondencia</label>
                      <input
                        type="text"
                        maxLength={255}
                        value={termoInput}
                        onChange={event => alterarTermo(event.target.value)}
                        placeholder="CNPJ, CPF, telefone, razao social, responsavel..."
                        autoFocus
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={!termoBuscavel || buscando}>
                      <I.Search size={14} />
                      {buscando ? 'Buscando...' : 'Buscar'}
                    </button>
                  </form>


                  {erro && <div className="alert-error">{erro}</div>}
                  {resposta && !erro && temVendasClientes && (
                    <div className="clientes-antigos-resultado">
                      <div className="config-list-header">
                        <div>
                          <h3>Vendas de clientes cadastrados</h3>
                          <p>{resposta.total_vendas_clientes || vendasClientes.length} venda(s) encontrada(s)</p>
                        </div>
                      </div>
                      <div className="list-table">
                        <div className="scroll" data-navigation-scroll="ClientesAntigosPage-3">
                          <table>
                            <thead>
                              <tr>
                                <th>Nome</th>
                                <th>Razão social</th>
                                <th>Documento</th>
                                <th>Operadora</th>
                                <th>Responsável</th>
                                <th>Terminal</th>
                                <th>Data da venda/Ativação</th>
                                <th>Fidelidade</th>
                                <th>Chips</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vendasClientes.map(item => (
                                <tr key={`cliente:${item.id}`}>
                                  <td>{item.nome || '-'}</td>
                                  <td>{item.razao_social || '-'}</td>
                                  <td>{item.cnpj || <em>sem documento</em>}</td>
                                  <td>{item.operadora || '-'}</td>
                                  <td>{item.responsavel_nome || '-'}</td>
                                  <td>{item.telefone || '-'}</td>
                                  <td>{formatarData(item.data_venda)}</td>
                                  <td>{formatarData(item.fidelidade_fim)}</td>
                                  <td>{formatarQuantidadeChips(item.quantidade_chips)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                  {resposta && !erro && resposta.tipo === 'documento' && (
                    temVendasAntigas ? (
                      <div className="clientes-antigos-resultado">
                        <div className="list-table">
                          <div className="scroll" data-navigation-scroll="ClientesAntigosPage-4">
                            <table>
                              <thead>
                                <tr>
                                  <th>Razão social</th>
                                  <th>Documento</th>
                                  <th>Operadora</th>
                                  <th>Responsável</th>
                                <th>Terminal</th>
                                <th>Data da venda/Ativação</th>
                                  <th>Fidelidade</th>
                                  <th>Chips</th>
                                  {podeEditarAntigos && <th>Acoes</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {(resposta.resultados || [resposta.venda]).map((item, indice) => (
                                  <tr key={`${item.cnpj || item.razao_social}:${item.data_venda || ''}:${indice}`}>
                                    <td>{item.razao_social || '-'}</td>
                                    <td>{item.cnpj || <em>sem documento</em>}</td>
                                    <td>{item.operadora || '-'}</td>
                                    <td>{item.responsavel_nome || '-'}</td>
                                  <td>{item.telefone || '-'}</td>
                                  <td>{formatarData(item.data_venda)}</td>
                                    <td>{formatarData(item.fidelidade_fim)}</td>
                                    <td>{formatarQuantidadeChips(item.quantidade_chips)}</td>
                                    {renderAcoesVendaAntiga(item)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <Paginacao
                          total={resposta.total}
                          paginaAtual={paginaBusca}
                          itensPorPagina={resposta.per_page}
                          onPagina={executarBusca}
                        />
                      </div>
                    ) : (!temVendasClientes ? (
                      <div className="empty">Nenhuma venda antiga encontrada para esta busca.</div>
                    ) : null)
                  )}

                  {resposta && !erro && resposta.tipo === 'nome' && (
                    temVendasAntigas ? (
                      <div className="clientes-antigos-resultado">
                        <div className="list-table">
                          <div className="scroll" data-navigation-scroll="ClientesAntigosPage-5">
                            <table>
                              <thead>
                                <tr>
                                  <th>Razão social</th>
                                  <th>Documento</th>
                                  <th>Operadora</th>
                                  <th>Responsável</th>
                                <th>Terminal</th>
                                <th>Data da venda/Ativação</th>
                                  <th>Fidelidade</th>
                                  <th>Chips</th>
                                  {podeEditarAntigos && <th>Acoes</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {resposta.resultados.map((item, indice) => (
                                  <tr key={`${item.cnpj || item.razao_social}:${indice}`}>
                                    <td>{item.razao_social || '-'}</td>
                                    <td>{item.cnpj || <em>sem documento</em>}</td>
                                    <td>{item.operadora || '-'}</td>
                                    <td>{item.responsavel_nome || '-'}</td>
                                  <td>{item.telefone || '-'}</td>
                                  <td>{formatarData(item.data_venda)}</td>
                                    <td>{formatarData(item.fidelidade_fim)}</td>
                                    <td>{formatarQuantidadeChips(item.quantidade_chips)}</td>
                                    {renderAcoesVendaAntiga(item)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <Paginacao
                          total={resposta.total}
                          paginaAtual={paginaBusca}
                          itensPorPagina={resposta.per_page}
                          onPagina={executarBusca}
                        />
                      </div>
                    ) : (!temVendasClientes ? (
                      <div className="empty">Nenhuma venda antiga encontrada para esta busca.</div>
                    ) : null)
                  )}
                </div>
              )}

              {aba === 'historico' && (
                <div className="clientes-antigos-historico">
                  <div className="search-box">
                    <I.Search size={14} />
                    <input
                      value={buscaHistorico}
                      onChange={event => alterarBuscaHistorico(event.target.value)}
                      placeholder="Filtrar por usuário ou termo buscado"
                    />
                  </div>

                  {erroHistorico && <div className="alert-error">{erroHistorico}</div>}

                  <div className="list-table">
                    <div className="scroll" data-navigation-scroll="ClientesAntigosPage-6">
                      <table>
                        <thead>
                          <tr>
                            <th>Usuário</th>
                            <th>Termo buscado</th>
                            <th>Data e hora</th>
                            <th>Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {carregandoHistorico ? (
                            <tr><td colSpan={4}>Carregando...</td></tr>
                          ) : historico.length === 0 ? (
                            <tr><td colSpan={4}>Nenhuma busca registrada.</td></tr>
                          ) : historico.map(item => (
                            <tr key={item.id}>
                              <td>{item.usuario_nome || '—'}</td>
                              <td>{item.termo || item.cnpj_formatado || formatarCnpj(item.cnpj_digitos)}</td>
                              <td>{formatarDataHora(item.buscado_em)}</td>
                              <td>
                                <span className={`tag ${item.encontrou ? 'tag-success' : 'tag-danger'}`}>
                                  {item.encontrou ? 'Encontrado' : 'Não encontrado'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <Paginacao
                    total={totalHistorico}
                    paginaAtual={pagina}
                    itensPorPagina={porPagina}
                    onPagina={setPagina}
                    onItensPorPagina={valor => { setPagina(1); setPorPagina(valor); }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
        {vendaEditando && (
          <ClienteAntigoEditModal
            venda={vendaEditando}
            salvando={salvandoEdicao}
            excluindo={excluindoEdicao}
            erro={erroEdicao}
            onClose={() => { if (!salvandoEdicao && !excluindoEdicao) setVendaEditando(null); }}
            onSave={salvarVendaAntiga}
            onDelete={solicitarExclusaoVendaAntiga}
          />
        )}
        <ConfirmarExclusaoClienteAntigoModal
          venda={vendaParaExcluir}
          excluindo={excluindoEdicao}
          onClose={() => { if (!excluindoEdicao) setVendaParaExcluir(null); }}
          onConfirm={excluirVendaAntiga}
        />
    </LayoutPrivado>
  );
}

export default ClientesAntigosPage;
