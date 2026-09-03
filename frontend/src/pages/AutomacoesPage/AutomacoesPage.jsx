import { useCallback, useEffect, useRef, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import { formatUtcDateTime } from '../../utils/datetime';
import {
  coletarHistoricoAutomacoes,
  descartarAutomacao,
  listarAutomacoes,
  listarVendasCandidatasAutomacao,
  obterResumoAutomacoes,
  repetirAutomacao,
  repetirAutomacoesEmRevisao,
  revisarAutomacao
} from '../../services/automacao.service';
import './AutomacoesPage.css';

const STATUS = ['', 'pendente', 'processando', 'concluido', 'revisao', 'regressao_funil', 'erro', 'rejeitado', 'descartado'];
const STATUS_LABEL = {
  pendente: 'Pendente',
  processando: 'Processando',
  concluido: 'Concluído',
  revisao: 'Revisão manual',
  regressao_funil: 'Regressão de funil',
  erro: 'Erro',
  rejeitado: 'Rejeitado',
  descartado: 'Descartado'
};
const CLASSIFICACAO_LABEL = {
  tipo_1: 'Atualização de etapa',
  tipo_2: 'Problema pós-venda',
  sem_acao: 'Sem ação',
  cancelamento: 'Cancelamento de venda'
};

const DATA_HORA_OPTIONS = {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'America/Sao_Paulo'
};
const dataHora = valor => formatUtcDateTime(valor, DATA_HORA_OPTIONS, '—');

function formatarCnpj(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 14);
  return digitos
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

function useDialogAcessivel(onClose, bloqueado = false) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const bloqueadoRef = useRef(bloqueado);

  useEffect(() => {
    onCloseRef.current = onClose;
    bloqueadoRef.current = bloqueado;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const anterior = document.activeElement;
    dialog.focus();
    function aoTeclado(event) {
      if (event.key === 'Escape' && !bloqueadoRef.current) onCloseRef.current();
    }
    document.addEventListener('keydown', aoTeclado);
    return () => {
      document.removeEventListener('keydown', aoTeclado);
      anterior?.focus?.();
    };
  }, []);
  return dialogRef;
}

export function VincularVendaAutomacaoModal({ item, onClose, onSelecionar }) {
  const dialogRef = useDialogAcessivel(onClose);
  const buscaSequenciaRef = useRef(0);
  const documentoOriginal = String(item.dados_extraidos?.documento || '').replace(/\D/g, '');
  const [dados, setDados] = useState(null);
  const [cnpjInput, setCnpjInput] = useState(formatarCnpj(documentoOriginal));
  const [cnpjPesquisado, setCnpjPesquisado] = useState('');
  const [buscaPendente, setBuscaPendente] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [confirmacao, setConfirmacao] = useState(null);

  useEffect(() => {
    let ativo = true;
    listarVendasCandidatasAutomacao(item.id)
      .then(resultado => {
        if (!ativo) return;
        setDados(resultado);
        setCnpjInput(formatarCnpj(resultado.cnpj));
        setCnpjPesquisado(resultado.cnpj);
        setBuscaPendente(false);
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
  }, [item.id]);

  function alterarCnpj(event) {
    const valor = formatarCnpj(event.target.value);
    setCnpjInput(valor);
    setBuscaPendente(valor.replace(/\D/g, '') !== cnpjPesquisado);
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
      const resultado = await listarVendasCandidatasAutomacao(item.id, cnpj);
      if (buscaSequenciaRef.current !== sequencia) return;
      setDados(resultado);
      setCnpjInput(formatarCnpj(resultado.cnpj));
      setCnpjPesquisado(resultado.cnpj);
      setBuscaPendente(false);
    } catch (error) {
      if (buscaSequenciaRef.current === sequencia) setErro(error.message || 'Erro ao localizar vendas do CNPJ.');
    } finally {
      if (buscaSequenciaRef.current === sequencia) setCarregando(false);
    }
  }

  function confirmarVenda() {
    onSelecionar(confirmacao, cnpjPesquisado);
    onClose();
  }

  const cnpjOriginal = dados?.cnpj_original || (documentoOriginal.length === 14 ? documentoOriginal : null);
  const cnpjDiferente = Boolean(cnpjOriginal && cnpjPesquisado && cnpjOriginal !== cnpjPesquisado);
  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal automation-sale-modal" role="dialog" aria-modal="true" aria-label="Vincular venda">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Selecionar venda para a automação</div>
              <div className="modal-sub">Execução #{item.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose}><I.Close size={14} /></button>
          </div>
        </div>

        <div className="modal-body automation-sale-modal__body">
          <form className="automation-sale-search" onSubmit={buscarOutroCnpj}>
            <label htmlFor="automation-sale-cnpj">CNPJ para buscar vendas</label>
            <div>
              <input id="automation-sale-cnpj" inputMode="numeric" maxLength="18" placeholder="00.000.000/0000-00" value={cnpjInput} onChange={alterarCnpj} disabled={carregando} />
              <button type="submit" className="btn btn-primary" disabled={carregando || cnpjInput.replace(/\D/g, '').length !== 14 || !buscaPendente}>{carregando ? 'Buscando...' : 'Buscar'}</button>
            </div>
            {cnpjOriginal && <small>CNPJ extraído do e-mail: {formatarCnpj(cnpjOriginal)}</small>}
          </form>

          {carregando && <div className="automation-sale-state">Buscando vendas do mesmo CNPJ...</div>}
          {erro && <div className="alert-error" role="alert">{erro}</div>}
          {!carregando && buscaPendente && !erro && <div className="automation-sale-state">Clique em Buscar para atualizar as vendas deste CNPJ.</div>}

          {!carregando && dados && !buscaPendente && (
            <>
              {cnpjDiferente && <div className="automation-sale-warning" role="status"><I.AlertTriangle size={16} />O CNPJ pesquisado será usado somente para selecionar a venda. O documento extraído do e-mail não será alterado.</div>}
              {!dados.vendas.length ? (
                <div className="automation-sale-state">Nenhuma venda foi encontrada para este CNPJ.</div>
              ) : (
                <div className="automation-sale-list">
                  {dados.vendas.map(venda => (
                    <article className={`automation-sale-item${venda.elegivel ? '' : ' is-blocked'}`} key={venda.id}>
                      <div className="automation-sale-item__heading">
                        <div><strong>Venda #{venda.id}</strong><span>{venda.razao_social || venda.nome || 'Razão social não informada'}</span></div>
                        <strong>{Number(venda.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                      </div>
                      <div className="automation-sale-item__details">
                        <span>Data<strong>{formatarData(venda.data_venda)}</strong></span>
                        <span>Etapa<strong>{venda.status_funil_nome || 'Sem etapa'}</strong></span>
                        <span>Vendedores<strong>{venda.vendedores?.map(vendedor => vendedor.nome).join(', ') || '—'}</strong></span>
                        <span>Criador<strong>{venda.criador?.nome || '—'}</strong></span>
                      </div>
                      {venda.divergencias?.length > 0 && <div className="automation-sale-divergences"><strong>Divergências do e-mail</strong>{venda.divergencias.map(divergencia => <span key={divergencia}>{divergencia}</span>)}</div>}
                      {!venda.elegivel ? (
                        <div className="automation-sale-block"><I.AlertTriangle size={14} />{venda.motivo_bloqueio || venda.inelegibilidades?.join(', ') || 'Venda indisponível'}</div>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={() => setConfirmacao(venda)}>Selecionar venda</button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {confirmacao && (
            <div className="automation-sale-confirmation" role="alertdialog" aria-label="Confirmar vínculo">
              <strong>Vincular a venda #{confirmacao.id}?</strong>
              <span>A venda será apenas selecionada. A automação somente será reprocessada após informar a justificativa e confirmar a revisão.</span>
              <div>
                <button type="button" className="btn" onClick={() => setConfirmacao(null)}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={confirmarVenda}>Confirmar</button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer"><button type="button" className="btn" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}

function Revisao({ item, onAtualizar, onErro }) {
  const extraidos = item.dados_extraidos || {};
  const [vendaId, setVendaId] = useState(item.venda_id || '');
  const [vendaSelecionada, setVendaSelecionada] = useState(null);
  const [cnpjVenda, setCnpjVenda] = useState(extraidos.documento || '');
  const [vinculandoVenda, setVinculandoVenda] = useState(false);
  const [tipo, setTipo] = useState(item.classificacao || extraidos.classificacao || 'tipo_1');
  const [etapa, setEtapa] = useState(item.etapa_destino || extraidos.alvo || 'entrega');
  const [mensagem, setMensagem] = useState(extraidos.mensagem_operador || '');
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function executar(acao) {
    setSalvando(true);
    onErro('');
    try {
      if (acao === 'revisar') {
        await revisarAutomacao(item.id, {
          venda_id: Number(vendaId),
          cnpj_venda: cnpjVenda,
          classificacao: tipo,
          etapa_destino: tipo === 'tipo_1' ? etapa : null,
          mensagem_operador: mensagem,
          justificativa
        });
      }
      if (acao === 'repetir') await repetirAutomacao(item.id);
      if (acao === 'descartar') await descartarAutomacao(item.id, justificativa);
      await onAtualizar();
    } catch (error) {
      onErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="automation-review">
      <div className="automation-review__heading">
        <strong>Revisão manual</strong>
        <span>Corrija os dados abaixo antes de reprocessar esta execução.</span>
      </div>
      {item.venda_id ? (
        <label>Venda ID<input value={vendaId} onChange={event => setVendaId(event.target.value)} inputMode="numeric" /></label>
      ) : (
        <div className="automation-review__link-sale">
          {vendaSelecionada && <span><strong>Venda #{vendaSelecionada.id}</strong>{vendaSelecionada.razao_social || vendaSelecionada.nome} · {vendaSelecionada.status_funil_nome}</span>}
          <button type="button" className="btn" onClick={() => setVinculandoVenda(true)}>{vendaSelecionada ? 'Trocar venda' : 'Vincular venda'}</button>
        </div>
      )}
      {vinculandoVenda && (
        <VincularVendaAutomacaoModal
          item={item}
          onClose={() => setVinculandoVenda(false)}
          onSelecionar={(venda, cnpj) => {
            setVendaId(venda.id);
            setVendaSelecionada(venda);
            setCnpjVenda(cnpj);
          }}
        />
      )}
      <label>
        Tipo
        <select value={tipo} onChange={event => setTipo(event.target.value)}>
          <option value="tipo_1">Atualização de etapa</option>
          <option value="tipo_2">Problema</option>
          <option value="sem_acao">Sem ação</option>
          <option value="cancelamento">Cancelamento de venda</option>
        </select>
      </label>
      {tipo === 'tipo_1' && (
        <label>
          Destino
          <select value={etapa} onChange={event => setEtapa(event.target.value)}>
            <option value="entrega">Entrega</option>
            <option value="aceite_biometria">Aceite/Biometria</option>
            <option value="apos_aceite_biometria">Pedido na Operadora</option>
            <option value="confirmacao_sms_portabilidade">Confirmação SMS Portabilidade</option>
            <option value="etapa_final">Etapa final configurada</option>
          </select>
        </label>
      )}
      {tipo === 'tipo_2' && <label className="wide">Mensagem ao operador<textarea value={mensagem} onChange={event => setMensagem(event.target.value)} /></label>}
      <label className="wide">Justificativa<textarea value={justificativa} onChange={event => setJustificativa(event.target.value)} placeholder="Informe o motivo da correção ou descarte" /></label>
      <div className="automation-actions">
        <button type="button" className="btn btn-primary" disabled={salvando || !vendaId || !justificativa.trim()} onClick={() => executar('revisar')}>{salvando ? 'Processando...' : 'Corrigir e reprocessar'}</button>
        <button type="button" className="btn" disabled={salvando} onClick={() => executar('repetir')}>Repetir execução</button>
        <button type="button" className="btn btn-danger" disabled={salvando || !justificativa.trim()} onClick={() => executar('descartar')}>Descartar</button>
      </div>
    </div>
  );
}

export default function AutomacoesPage() {
  const [status, setStatus] = useState('');
  const [classificacao, setClassificacao] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [itens, setItens] = useState([]);
  const [resumo, setResumo] = useState({ contadores: {} });
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [coletandoHistorico, setColetandoHistorico] = useState(false);
  const [repetindoRevisoes, setRepetindoRevisoes] = useState(false);
  const [sucesso, setSucesso] = useState('');

  const carregar = useCallback(async (manual = false, ativo = { valor: true }) => {
    if (manual) setAtualizando(true);
    else setCarregando(true);
    try {
      setErro('');
      const [lista, dadosResumo] = await Promise.all([
        listarAutomacoes({ status, ...(classificacao ? { classificacao } : {}), page: pagina, perPage: porPagina }),
        obterResumoAutomacoes()
      ]);
      if (!ativo.valor) return;
      const totalLista = Number(lista.total || 0);
      const totalPaginas = Math.max(1, Math.ceil(totalLista / porPagina));
      setTotalRegistros(totalLista);
      setResumo(dadosResumo);
      if (pagina > totalPaginas) {
        setPagina(totalPaginas);
        return;
      }
      setItens(lista.data || []);
    } catch (error) {
      if (ativo.valor) setErro(error.message);
    } finally {
      if (ativo.valor) {
        setCarregando(false);
        setAtualizando(false);
      }
    }
  }, [classificacao, pagina, porPagina, status]);

  async function coletarHistorico() {
    setColetandoHistorico(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await coletarHistoricoAutomacoes();
      setSucesso(`${resultado.coletados} e-mail(is) anterior(es) encontrado(s); ${resultado.processados} processado(s) agora.`);
      await carregar(true);
    } catch (error) {
      setErro(error.message);
    } finally {
      setColetandoHistorico(false);
    }
  }

  async function repetirRevisoes() {
    const quantidade = Number(resumo.contadores?.revisao || 0) + Number(resumo.contadores?.regressao_funil || 0);
    if (!quantidade || !window.confirm(`Repetir a execução das ${quantidade} automações em revisão ou regressão de funil? Isso pode movimentar vendas ou abrir problemas.`)) return;
    setRepetindoRevisoes(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await repetirAutomacoesEmRevisao();
      const repetidos = Number(resultado.repetidos || 0);
      const falhas = Number(resultado.falhas || 0);
      setSucesso(falhas
        ? `${repetidos} execução(ões) em revisão/regressão repetida(s); ${falhas} falharam durante a preparação.`
        : `${repetidos} execução(ões) em revisão/regressão repetida(s) com sucesso.`);
      await carregar(true);
    } catch (error) {
      setErro(error.message);
    } finally {
      setRepetindoRevisoes(false);
    }
  }

  useEffect(() => {
    const ativo = { valor: true };
    const agendamento = window.setTimeout(() => carregar(false, ativo), 0);
    return () => { ativo.valor = false; window.clearTimeout(agendamento); };
  }, [carregar]);

  const contadores = resumo.contadores || {};
  const totalCancelamentos = Number(resumo.contadores_classificacao?.cancelamento || 0);
  const total = Object.values(contadores).reduce((soma, quantidade) => soma + Number(quantidade || 0), 0);
  const totalRevisoes = Number(contadores.revisao || 0) + Number(contadores.regressao_funil || 0);
  const barraOcupada = atualizando || coletandoHistorico || repetindoRevisoes;
  function alterarFiltro(novoFiltro) {
    const novaClassificacao = novoFiltro === 'cancelamento' ? 'cancelamento' : '';
    const novoStatus = novaClassificacao ? '' : novoFiltro;
    if (novoStatus !== status || novaClassificacao !== classificacao) setCarregando(true);
    setPagina(1);
    setStatus(novoStatus);
    setClassificacao(novaClassificacao);
  }

  return (
    <LayoutPrivado>
      <main className="automation-page">
        <section className="automation-summary" aria-label="Resumo das automações">
          <div className={`automation-connection ${resumo.habilitada ? 'is-active' : 'is-disabled'}`}>
            <span className="automation-summary__icon"><I.Mail size={18} /></span>
            <div><strong>{resumo.habilitada ? 'Gmail ativo' : 'Gmail desabilitado'}</strong><span>Última mensagem: {dataHora(resumo.ultima_mensagem_em)}</span></div>
          </div>
          <button type="button" className={`automation-metric ${status === '' && classificacao === '' ? 'is-selected' : ''}`} aria-label={`Mostrar todas as ${total} execuções`} aria-pressed={status === '' && classificacao === ''} onClick={() => alterarFiltro('')}><strong>{total}</strong><span>Todas</span></button>
          {STATUS.filter(Boolean).map(chave => (
            <button type="button" key={chave} className={`automation-metric status-${chave} ${status === chave ? 'is-selected' : ''}`} aria-label={`Filtrar por ${STATUS_LABEL[chave]}: ${Number(contadores[chave] || 0)}`} aria-pressed={status === chave} onClick={() => alterarFiltro(chave)}><strong>{Number(contadores[chave] || 0)}</strong><span>{STATUS_LABEL[chave]}</span></button>
          ))}
          <button type="button" className={`automation-metric classification-cancelamento ${classificacao === 'cancelamento' ? 'is-selected' : ''}`} aria-label={`Filtrar por Vendas canceladas: ${totalCancelamentos}`} aria-pressed={classificacao === 'cancelamento'} onClick={() => alterarFiltro('cancelamento')}><strong>{totalCancelamentos}</strong><span>Vendas canceladas</span></button>
        </section>

        <section className="automation-toolbar" aria-label="Filtros das automações">
          <label>
            Status ou classificação
            <select value={classificacao || status} onChange={event => alterarFiltro(event.target.value)}>
              {STATUS.map(item => <option key={item} value={item}>{item ? STATUS_LABEL[item] : 'Todas as execuções'}</option>)}
              <option value="cancelamento">Vendas canceladas</option>
            </select>
          </label>
          <div className="automation-toolbar__actions">
            <button type="button" className="btn" disabled={barraOcupada || totalRevisoes === 0} onClick={repetirRevisoes}><I.Refresh size={14} /> {repetindoRevisoes ? 'Reprocessando...' : `Repetir revisões e regressões (${totalRevisoes})`}</button>
            <button type="button" className="btn" disabled={barraOcupada || !resumo.habilitada} onClick={coletarHistorico}><I.History size={14} /> {coletandoHistorico ? 'Buscando histórico...' : 'Buscar e-mails anteriores'}</button>
            <button type="button" className="btn automation-refresh" disabled={barraOcupada} onClick={() => carregar(true)}><I.Refresh size={14} /> {atualizando ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </section>

        {erro && <div className="alert-error automation-alert" role="alert">{erro}</div>}
        {sucesso && <div className="alert-success automation-alert" role="status">{sucesso}</div>}

        <section className="automation-list" aria-busy={carregando}>
          {carregando && <div className="automation-empty"><span className="automation-spinner" aria-hidden="true" /><strong>Carregando execuções</strong><span>Consultando o histórico da automação.</span></div>}
          {!carregando && itens.length === 0 && <div className="automation-empty"><span className="automation-empty__icon"><I.History size={24} /></span><strong>Nenhuma execução encontrada</strong><span>{classificacao === 'cancelamento' ? 'Não há execuções com a classificação “Vendas canceladas”.' : status ? `Não há execuções com o status “${STATUS_LABEL[status]}”.` : 'Os novos e-mails processados aparecerão aqui.'}</span></div>}
          {!carregando && itens.map(item => (
            <details key={item.id} className={`automation-card status-${item.status}`}>
              <summary>
                <div className="automation-card__identity"><strong>{item.assunto || '(sem assunto)'}</strong><span>{item.remetente || 'Remetente não informado'}</span></div>
                <div className="automation-card__meta"><span className="automation-status">{STATUS_LABEL[item.status] || item.status}</span><time>{dataHora(item.recebido_em)}</time><I.ChevronDown className="automation-chevron" size={16} /></div>
              </summary>
              <div className="automation-detail">
                <dl>
                  <div><dt>Venda</dt><dd>{item.venda_id ? `#${item.venda_id}` : 'Não vinculada'}</dd></div>
                  <div><dt>Classificação</dt><dd>{CLASSIFICACAO_LABEL[item.classificacao || item.dados_extraidos?.classificacao] || '—'}</dd></div>
                  <div><dt>Destino</dt><dd>{item.dados_extraidos?.destino || '—'}</dd></div>
                  <div><dt>Documento</dt><dd>{item.dados_extraidos?.documento || '—'}</dd></div>
                </dl>
                {item.erro && <div className={`alert-error automation-alert ${item.status === 'regressao_funil' ? 'automation-regression-alert' : ''}`} role="alert">{item.erro}</div>}
                <div className="automation-email-body"><strong>Conteúdo recebido</strong><pre>{item.corpo_texto || 'Corpo removido ou não armazenado.'}</pre></div>
                {['revisao', 'regressao_funil', 'erro'].includes(item.status) && <Revisao item={item} onAtualizar={() => carregar(true)} onErro={setErro} />}
              </div>
            </details>
          ))}
        </section>

        {!carregando && totalRegistros > 0 && (
          <Paginacao
            total={totalRegistros}
            paginaAtual={pagina}
            itensPorPagina={porPagina}
            onPagina={setPagina}
            onItensPorPagina={quantidade => { setPorPagina(quantidade); setPagina(1); }}
          />
        )}
      </main>
    </LayoutPrivado>
  );
}
