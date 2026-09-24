import { useCallback, useEffect, useRef, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import { formatUtcDateTime } from '../../utils/datetime';
import {
  coletarHistoricoAutomacoes,
  diagnosticarImapClaro,
  descartarAutomacao,
  corrigirHistoricoAutomacao,
  listarAutomacoes,
  listarInconsistenciasHistoricoAutomacoes,
  listarVendasCandidatasAutomacao,
  obterPreviaCorrecaoHistoricoAutomacao,
  obterDiagnosticoClaro,
  obterResumoAutomacoes,
  repetirAutomacao,
  repetirAutomacoesEmRevisao,
  repetirInvalidosClaro,
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
const INTEGRACAO_LABEL = {
  ativo: 'Gmail ativo',
  falha: 'Falha na automação',
  sem_resposta: 'Worker sem resposta',
  desabilitado: 'Gmail desabilitado',
  aguardando: 'Aguardando primeiro ciclo'
};
const FASE_LABEL = {
  coleta: 'Falha na coleta do Gmail',
  processamento: 'Falha no processamento',
  telegram: 'Falha na notificação no Telegram'
};
const FASE_LABEL_CLARO = {
  coleta: 'Falha na coleta do IMAP Claro',
  processamento: 'Falha no processamento da Claro'
};

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
  const claro = item.operadora === 'Claro';
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
        setCnpjInput(formatarCnpj(resultado.cnpj || ''));
        setCnpjPesquisado(resultado.cnpj || '');
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
          {!claro && <form className="automation-sale-search" onSubmit={buscarOutroCnpj}>
            <label htmlFor="automation-sale-cnpj">CNPJ para buscar vendas</label>
            <div>
              <input id="automation-sale-cnpj" inputMode="numeric" maxLength="18" placeholder="00.000.000/0000-00" value={cnpjInput} onChange={alterarCnpj} disabled={carregando} />
              <button type="submit" className="btn btn-primary" disabled={carregando || cnpjInput.replace(/\D/g, '').length !== 14 || !buscaPendente}>{carregando ? 'Buscando...' : 'Buscar'}</button>
            </div>
            {cnpjOriginal && <small>CNPJ extraído do e-mail: {formatarCnpj(cnpjOriginal)}</small>}
          </form>}
          {claro && <div className="automation-sale-search"><strong>Empresa extraída do e-mail</strong><span>{dados?.empresa || item.dados_extraidos?.empresa || 'Não identificada'}</span></div>}

          {carregando && <div className="automation-sale-state">{claro ? 'Buscando vendas Claro com o mesmo nome...' : 'Buscando vendas do mesmo CNPJ...'}</div>}
          {erro && <div className="alert-error" role="alert">{erro}</div>}
          {!carregando && buscaPendente && !erro && <div className="automation-sale-state">Clique em Buscar para atualizar as vendas deste CNPJ.</div>}

          {!carregando && dados && !buscaPendente && (
            <>
              {cnpjDiferente && <div className="automation-sale-warning" role="status"><I.AlertTriangle size={16} />O CNPJ pesquisado será usado somente para selecionar a venda. O documento extraído do e-mail não será alterado.</div>}
              {!dados.vendas.length ? (
                <div className="automation-sale-state">{claro ? 'Nenhuma venda Claro ativa foi encontrada para este nome.' : 'Nenhuma venda foi encontrada para este CNPJ.'}</div>
              ) : (
                <div className="automation-sale-list">
                  {dados.vendas.map(venda => (
                    <article className={`automation-sale-item${venda.elegivel ? '' : ' is-blocked'}`} key={venda.id}>
                      <div className="automation-sale-item__heading">
                        <div><strong>Venda #{venda.id}</strong><span>{venda.razao_social || venda.nome || 'Razão social não informada'}</span></div>
                        <strong>{venda.valor_total == null || venda.valor_total === '' ? '—' : Number(venda.valor_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                      </div>
                      <div className="automation-sale-item__details">
                        <span>Data<strong>{formatarData(venda.data_venda)}</strong></span>
                        <span>Etapa<strong>{venda.status_funil_nome || 'Sem etapa'}</strong></span>
                        <span>Vendedores<strong>{venda.vendedores?.map(vendedor => vendedor.nome).join(', ') || '—'}</strong></span>
                        <span>Criador<strong>{venda.criador?.nome || '—'}</strong></span>
                      </div>
                      <div className="automation-sale-item__chips">
                        <strong>Chips</strong>
                        {venda.chips?.length > 0 ? (
                          <div className="automation-sale-item__chip-list">
                            {venda.chips.map((chip, index) => (
                              <div key={`${chip.tipo_linha}-${chip.valor_unitario}-${index}`}>
                                <span>{chip.quantidade} {Number(chip.quantidade) === 1 ? 'chip' : 'chips'} · {chip.tipo_linha === 'portabilidade' ? 'Portabilidade' : 'Novo'}</span>
                                <strong>{Number(chip.valor_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} cada</strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span><strong>{venda.tipo_venda || 'Tipo não informado'}</strong> · Valores unitários não cadastrados</span>
                        )}
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
          {vendaSelecionada && (
            <span>
              <strong>Venda #{vendaSelecionada.id}</strong>
              {vendaSelecionada.razao_social || vendaSelecionada.nome} · {vendaSelecionada.status_funil_nome}
              <small className="automation-review__pending-sale" role="status">Vínculo ainda não salvo; informe a justificativa e clique em Corrigir e reprocessar.</small>
            </span>
          )}
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
        <button type="button" className="btn" disabled={salvando || Boolean(vendaSelecionada)} onClick={() => executar('repetir')}>Repetir sem alterações</button>
        <button type="button" className="btn btn-danger" disabled={salvando || !justificativa.trim()} onClick={() => executar('descartar')}>Descartar</button>
      </div>
    </div>
  );
}

function CorrecaoHistoricoModal({ item, onClose, onCorrigido, onErro }) {
  const dialogRef = useDialogAcessivel(onClose);
  const [previa, setPrevia] = useState(null);
  const [statusDestino, setStatusDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const [reverterEfeitos, setReverterEfeitos] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    obterPreviaCorrecaoHistoricoAutomacao(item.historico_id)
      .then(resultado => {
        if (!ativo) return;
        setPrevia(resultado);
        setStatusDestino(resultado.status_sugerido || resultado.venda_status_atual || '');
      })
      .catch(error => { if (ativo) onErro(error.message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [item.historico_id, onErro]);

  async function confirmar() {
    if (!previa || !statusDestino || !motivo.trim()) return;
    setSalvando(true);
    onErro('');
    try {
      await corrigirHistoricoAutomacao(item.historico_id, {
        status_destino: statusDestino,
        motivo,
        versao_venda: previa.venda_updated_at,
        reverter_efeitos_derivados: reverterEfeitos
      });
      await onCorrigido();
      onClose();
    } catch (error) {
      onErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div ref={dialogRef} tabIndex={-1} className="modal automation-history-modal" role="dialog" aria-modal="true" aria-label="Corrigir histórico da automação">
        <div className="modal-header"><div className="modal-header-row"><div><div className="modal-client">Corrigir histórico da venda #{item.venda_id}</div><div className="modal-sub">Evento #{item.historico_id} · Automação {item.automacao_id ? `#${item.automacao_id}` : 'não encontrada'}</div></div><button type="button" className="btn btn-icon btn-ghost" title="Fechar" disabled={salvando} onClick={onClose}><I.Close size={14} /></button></div></div>
        <div className="modal-body automation-history-modal__body">
          {carregando && <div className="automation-sale-state">Gerando prévia segura...</div>}
          {previa && <>
            <div className="automation-history-reasons"><strong>Por que foi sinalizado</strong>{previa.motivos.map(motivoItem => <span key={motivoItem}>{motivoItem}</span>)}</div>
            <dl className="automation-history-dates"><div><dt>E-mail recebido</dt><dd>{dataHora(previa.email_recebido_em)}</dd></div><div><dt>Venda criada</dt><dd>{dataHora(previa.venda_criada_em)}</dd></div><div><dt>Evento gravado</dt><dd>{dataHora(previa.historico_em)}</dd></div></dl>
            <label>Etapa que deve permanecer<select value={statusDestino} onChange={event => setStatusDestino(event.target.value)}>{previa.etapas.map(etapa => <option key={etapa.codigo} value={etapa.codigo}>{etapa.nome}</option>)}</select></label>
            {previa.efeitos_derivados_comprovados.length > 0 && <label className="automation-history-effects"><input type="checkbox" checked={reverterEfeitos} onChange={event => setReverterEfeitos(event.target.checked)} />Reverter também efeitos comprovadamente produzidos por esta automação: {previa.efeitos_derivados_comprovados.join(', ')}</label>}
            {previa.efeitos_nao_revertidos_automaticamente.length > 0 && <div className="automation-sale-warning" role="status"><I.AlertTriangle size={16} />Não serão revertidos automaticamente: {previa.efeitos_nao_revertidos_automaticamente.join(', ')}.</div>}
            <label>Justificativa<textarea value={motivo} onChange={event => setMotivo(event.target.value)} placeholder="Explique por que o vínculo está incorreto" /></label>
          </>}
        </div>
        <div className="modal-footer"><button type="button" className="btn" disabled={salvando} onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={carregando || salvando || !statusDestino || !motivo.trim()} onClick={confirmar}>{salvando ? 'Corrigindo...' : 'Confirmar correção'}</button></div>
      </div>
    </div>
  );
}

export default function AutomacoesPage() {
  const [status, setStatus] = useState('');
  const [classificacao, setClassificacao] = useState('');
  const [operadora, setOperadora] = useState('');
  const [tituloInput, setTituloInput] = useState('');
  const [titulo, setTitulo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [itens, setItens] = useState([]);
  const [resumo, setResumo] = useState({ contadores: {} });
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [coletandoHistorico, setColetandoHistorico] = useState(false);
  const [diagnosticandoImap, setDiagnosticandoImap] = useState(false);
  const [repetindoRevisoes, setRepetindoRevisoes] = useState(false);
  const [repetindoInvalidosClaro, setRepetindoInvalidosClaro] = useState(false);
  const [diagnosticoClaro, setDiagnosticoClaro] = useState(null);
  const [resultadoClaro, setResultadoClaro] = useState(null);
  const [carregandoDiagnosticoClaro, setCarregandoDiagnosticoClaro] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [inconsistencias, setInconsistencias] = useState(null);
  const [auditandoHistorico, setAuditandoHistorico] = useState(false);
  const [correcaoHistorico, setCorrecaoHistorico] = useState(null);

  const carregar = useCallback(async (manual = false, ativo = { valor: true }) => {
    if (manual) setAtualizando(true);
    else setCarregando(true);
    try {
      setErro('');
      const [lista, dadosResumo] = await Promise.all([
        listarAutomacoes({ status, ...(operadora ? { operadora } : {}), ...(classificacao ? { classificacao } : {}), ...(titulo ? { titulo } : {}), page: pagina, perPage: porPagina }),
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
  }, [classificacao, operadora, pagina, porPagina, status, titulo]);

  useEffect(() => {
    const agendamento = window.setTimeout(() => {
      const novoTitulo = tituloInput.trim();
      if (novoTitulo === titulo) return;
      setCarregando(true);
      setPagina(1);
      setTitulo(novoTitulo);
    }, 350);
    return () => window.clearTimeout(agendamento);
  }, [titulo, tituloInput]);

  async function coletarHistorico() {
    setColetandoHistorico(true);
    setErro('');
    setSucesso('');
    try {
      const origem = operadora === 'Claro' || (!operadora && !resumo.habilitada && resumo.habilitada_claro) ? 'imap_claro' : 'gmail_vivo';
      const resultado = await coletarHistoricoAutomacoes(origem);
      setSucesso(`${resultado.coletados} e-mail(is) anterior(es) encontrado(s); ${resultado.processados} processado(s) agora.`);
      await carregar(true);
    } catch (error) {
      setErro(error.message);
    } finally {
      setColetandoHistorico(false);
    }
  }

  async function diagnosticarImap() {
    setDiagnosticandoImap(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await diagnosticarImapClaro();
      const formatarTeste = (rotulo, teste) => teste?.ok
        ? `${rotulo} conectado`
        : `${rotulo} falhou: ${teste?.codigo || 'erro desconhecido'} · ${teste?.mensagem || 'sem detalhe'}`;
      const enderecos = resultado.dns_imap?.enderecos?.map(item => `${item.endereco} (IPv${item.familia})`).join(', ');
      const dns = resultado.dns_imap?.ok
        ? `DNS ${resultado.dns_imap.host}: ${enderecos || 'sem endereço'}`
        : `DNS falhou: ${resultado.dns_imap?.codigo || 'erro desconhecido'} · ${resultado.dns_imap?.mensagem || 'sem detalhe'}`;
      const imap993 = formatarTeste('IMAP 993/TLS', resultado.imap);
      const imap143 = formatarTeste('IMAP 143/STARTTLS', resultado.imap_starttls);
      const controle993 = formatarTeste(`Controle ${resultado.controles_tcp?.host || 'externo'}:993/TCP`, resultado.controles_tcp?.porta_993);
      const controle143 = formatarTeste(`Controle ${resultado.controles_tcp?.host || 'externo'}:143/TCP`, resultado.controles_tcp?.porta_143);
      const ip = resultado.ip_saida_https?.ok
        ? `IP HTTPS ${resultado.ip_saida_https.ip || 'não informado'}`
        : `IP HTTPS indisponível: ${resultado.ip_saida_https?.codigo || 'erro desconhecido'}`;
      const mensagem = `Diagnóstico do runtime: ${dns}; ${imap993}; ${imap143}; ${controle993}; ${controle143}; ${ip}; executado em ${resultado.executado_em}.`;
      if (resultado.imap?.ok || resultado.imap_starttls?.ok) setSucesso(mensagem);
      else setErro(mensagem);
    } catch (error) {
      setErro(error.message);
    } finally {
      setDiagnosticandoImap(false);
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

  async function reprocessarInvalidosClaro() {
    if (!diagnosticoClaro) {
      if (await carregarDiagnosticoClaro()) setSucesso('Prévia Claro carregada. Confira os registros e clique novamente para confirmar o reprocessamento.');
      return;
    }
    const elegiveis = diagnosticoClaro.registros.filter(item => item.elegivel_reprocessamento).length;
    if (!window.confirm(`Revalidar a origem e reprocessar até ${elegiveis} emails Claro? Apenas mensagens com DKIM válido e venda única elegível poderão movimentar o Funil de Automações.`)) return;
    setRepetindoInvalidosClaro(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await repetirInvalidosClaro();
      setResultadoClaro(resultado);
      const concluidos = resultado.registros?.filter(item => item.status === 'concluido').length || 0;
      setSucesso(`${Number(resultado.selecionados || 0)} selecionado(s); ${concluidos} concluído(s); ${Number(resultado.falhas || 0)} erro(s). Confira o resultado por ID abaixo.`);
      setDiagnosticoClaro(await obterDiagnosticoClaro());
      await carregar(true);
    } catch (error) {
      setErro(error.message);
    } finally {
      setRepetindoInvalidosClaro(false);
    }
  }

  async function carregarDiagnosticoClaro() {
    setCarregandoDiagnosticoClaro(true);
    setErro('');
    try {
      const previa = await obterDiagnosticoClaro();
      if (!previa || !Array.isArray(previa.registros)) throw new Error('Resposta inválida do servidor. Verifique se o backend atualizado foi implantado.');
      setDiagnosticoClaro(previa);
      return previa;
    } catch (error) {
      setErro(`Não foi possível carregar a prévia Claro: ${error.message}`);
      return null;
    }
    finally { setCarregandoDiagnosticoClaro(false); }
  }

  async function auditarHistoricos() {
    setAuditandoHistorico(true);
    setErro('');
    try {
      const resultado = await listarInconsistenciasHistoricoAutomacoes();
      setInconsistencias(resultado);
      setSucesso(`${Number(resultado.total || 0)} histórico(s) potencialmente inconsistente(s) encontrado(s).`);
    } catch (error) {
      setErro(error.message);
    } finally {
      setAuditandoHistorico(false);
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
  const barraOcupada = atualizando || coletandoHistorico || diagnosticandoImap || repetindoRevisoes || repetindoInvalidosClaro || carregandoDiagnosticoClaro || auditandoHistorico;
  const integracao = resumo.integracao || { estado: resumo.habilitada ? 'ativo' : 'desabilitado' };
  const estadoIntegracao = integracao.estado || (resumo.habilitada ? 'ativo' : 'desabilitado');
  const integracaoComFalha = estadoIntegracao === 'falha' || estadoIntegracao === 'sem_resposta';
  const classeIntegracao = estadoIntegracao === 'ativo' ? 'is-active' : integracaoComFalha ? 'is-error' : 'is-disabled';
  const tituloIntegracao = estadoIntegracao === 'falha' && integracao.fase_erro
    ? FASE_LABEL[integracao.fase_erro] || 'Falha na automação'
    : INTEGRACAO_LABEL[estadoIntegracao] || 'Estado do Gmail indisponível';
  const integracaoClaro = resumo.integracoes?.imap_claro || { estado: resumo.habilitada_claro ? 'aguardando' : 'desabilitado' };
  const claroComFalha = ['falha', 'sem_resposta'].includes(integracaoClaro.estado);
  const classeClaro = integracaoClaro.estado === 'ativo' ? 'is-active' : claroComFalha ? 'is-error' : 'is-disabled';
  const tituloClaro = integracaoClaro.estado === 'falha' && integracaoClaro.fase_erro
    ? FASE_LABEL_CLARO[integracaoClaro.fase_erro] || 'Falha na automação Claro'
    : ({ ativo: 'IMAP Claro ativo', falha: 'Falha na automação Claro', sem_resposta: 'Worker Claro sem resposta', desabilitado: 'IMAP Claro desabilitado', aguardando: 'Claro aguardando primeiro ciclo' }[integracaoClaro.estado] || 'Estado do IMAP Claro indisponível');
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
          <div className={`automation-connection ${classeIntegracao}`}>
            <span className="automation-summary__icon">{integracaoComFalha ? <I.AlertTriangle size={18} /> : <I.Mail size={18} />}</span>
            <div>
              <strong>{tituloIntegracao}</strong>
              <span>Última mensagem: {dataHora(resumo.ultima_mensagem_em)}</span>
              {integracao.ultimo_sucesso_em && <span>Último ciclo concluído: {dataHora(integracao.ultimo_sucesso_em)}</span>}
              {integracao.ultimo_erro && <small className="automation-connection__error" role="alert">{integracao.ultimo_erro}</small>}
            </div>
          </div>
          <div className={`automation-connection ${classeClaro}`}>
            <span className="automation-summary__icon">{claroComFalha ? <I.AlertTriangle size={18} /> : <I.Mail size={18} />}</span>
            <div><strong>{tituloClaro}</strong>{integracaoClaro.ultimo_sucesso_em && <span>Último ciclo concluído: {dataHora(integracaoClaro.ultimo_sucesso_em)}</span>}{integracaoClaro.ultimo_erro && <small className="automation-connection__error" role="alert">{integracaoClaro.ultimo_erro}</small>}</div>
          </div>
          <button type="button" className={`automation-metric ${status === '' && classificacao === '' ? 'is-selected' : ''}`} aria-label={`Mostrar todas as ${total} execuções`} aria-pressed={status === '' && classificacao === ''} onClick={() => alterarFiltro('')}><strong>{total}</strong><span>Todas</span></button>
          {STATUS.filter(Boolean).map(chave => (
            <button type="button" key={chave} className={`automation-metric status-${chave} ${status === chave ? 'is-selected' : ''}`} aria-label={`Filtrar por ${STATUS_LABEL[chave]}: ${Number(contadores[chave] || 0)}`} aria-pressed={status === chave} onClick={() => alterarFiltro(chave)}><strong>{Number(contadores[chave] || 0)}</strong><span>{STATUS_LABEL[chave]}</span></button>
          ))}
          <button type="button" className={`automation-metric classification-cancelamento ${classificacao === 'cancelamento' ? 'is-selected' : ''}`} aria-label={`Filtrar por Vendas canceladas: ${totalCancelamentos}`} aria-pressed={classificacao === 'cancelamento'} onClick={() => alterarFiltro('cancelamento')}><strong>{totalCancelamentos}</strong><span>Vendas canceladas</span></button>
        </section>

        <section className="automation-toolbar" aria-label="Filtros das automações">
          <div className="automation-toolbar__filters">
            <label>
              Status ou classificação
              <select value={classificacao || status} onChange={event => alterarFiltro(event.target.value)}>
                {STATUS.map(item => <option key={item} value={item}>{item ? STATUS_LABEL[item] : 'Todas as execuções'}</option>)}
                <option value="cancelamento">Vendas canceladas</option>
              </select>
            </label>
            <label>
              Operadora
              <select value={operadora} onChange={event => { setOperadora(event.target.value); setPagina(1); setCarregando(true); }}>
                <option value="">Vivo e Claro</option>
                <option value="Vivo">Vivo</option>
                <option value="Claro">Claro</option>
              </select>
            </label>
            <label>
              Título do e-mail
              <span className="automation-title-search">
                <I.Search size={15} aria-hidden="true" />
                <input type="search" maxLength={500} value={tituloInput} onChange={event => setTituloInput(event.target.value)} placeholder="Pesquisar pelo título" />
              </span>
            </label>
          </div>
          <div className="automation-toolbar__actions">
            <button type="button" className="btn" disabled={barraOcupada} onClick={diagnosticarImap}><I.Shield size={14} /> {diagnosticandoImap ? 'Diagnosticando...' : 'Diagnosticar IMAP Claro'}</button>
            <button type="button" className="btn" disabled={barraOcupada} onClick={carregarDiagnosticoClaro}><I.Shield size={14} /> {carregandoDiagnosticoClaro ? 'Analisando...' : 'Prévia das revisões Claro'}</button>
            <button type="button" className="btn" disabled={barraOcupada || totalRevisoes === 0} onClick={repetirRevisoes}><I.Refresh size={14} /> {repetindoRevisoes ? 'Reprocessando...' : `Repetir revisões e regressões (${totalRevisoes})`}</button>
            <button type="button" className="btn" disabled={barraOcupada} onClick={reprocessarInvalidosClaro}><I.Refresh size={14} /> {repetindoInvalidosClaro ? 'Reprocessando Claro...' : diagnosticoClaro ? 'Reprocessar emails Claro' : 'Abrir prévia para reprocessar Claro'}</button>
            <button type="button" className="btn" disabled={barraOcupada} onClick={auditarHistoricos}><I.AlertTriangle size={14} /> {auditandoHistorico ? 'Auditando...' : 'Auditar históricos'}</button>
            <button type="button" className="btn" disabled={barraOcupada || (operadora === 'Claro' ? !resumo.habilitada_claro : operadora === 'Vivo' ? !resumo.habilitada : !resumo.habilitada && !resumo.habilitada_claro)} onClick={coletarHistorico}><I.History size={14} /> {coletandoHistorico ? 'Buscando histórico...' : `Buscar e-mails anteriores${operadora ? ` (${operadora})` : ''}`}</button>
            <button type="button" className="btn automation-refresh" disabled={barraOcupada} onClick={() => carregar(true)}><I.Refresh size={14} /> {atualizando ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </section>

        {erro && <div className="alert-error automation-alert" role="alert">{erro}</div>}
        {sucesso && <div className="alert-success automation-alert" role="status">{sucesso}</div>}

        {diagnosticoClaro && <section className="automation-history-audit" aria-label="Diagnóstico das revisões Claro">
          <div className="automation-history-audit__heading"><div><strong>Diagnóstico Claro · {diagnosticoClaro.total} em revisão</strong><span>Ações automáticas: {diagnosticoClaro.acoes_habilitadas ? 'habilitadas' : 'desabilitadas no ambiente'}. Prévia: {diagnosticoClaro.registros.filter(item => item.elegivel_reprocessamento).length} registro(s) com corpo e sem revisão manual; a origem será verificada no IMAP ao executar.</span></div><button type="button" className="btn btn-icon btn-ghost" title="Fechar diagnóstico" onClick={() => setDiagnosticoClaro(null)}><I.Close size={14} /></button></div>
          {Object.entries(diagnosticoClaro.contagens).map(([motivo, quantidade]) => <div key={motivo}>{quantidade} · {motivo}</div>)}
          {diagnosticoClaro.registros.map(item => <article key={item.id} className="automation-history-item"><div><strong>Email #{item.id} · {item.empresa || 'Razão não extraída'}</strong><span>Origem: {item.autenticacao_valida ? 'DKIM do original validado' : item.autenticacao?.motivo || 'Não comprovada'} · {item.elegivel_reprocessamento ? 'selecionável' : 'fora da prévia'}</span><small>Motivo registrado: {item.motivo}</small>{item.venda_sugerida_id && <span>Prévia atual: venda #{item.venda_sugerida_id} é a única elegível.</span>}{item.motivo_vinculo && <small>Vínculo atual: {item.motivo_vinculo}</small>}{item.candidatas?.map(venda => <small key={venda.id}>Venda #{venda.id}: {venda.inelegibilidades.length ? venda.inelegibilidades.join(', ') : 'elegível'}</small>)}</div></article>)}
        </section>}

        {resultadoClaro && <section className="automation-history-audit" aria-label="Resultado do reprocessamento Claro"><div className="automation-history-audit__heading"><strong>Resultado por email</strong><button type="button" className="btn btn-icon btn-ghost" title="Fechar resultado" onClick={() => setResultadoClaro(null)}><I.Close size={14} /></button></div>{resultadoClaro.registros?.map(item => <div key={item.id}>#{item.id} · {item.status} · {item.motivo || 'Sem pendências'}</div>)}</section>}

        {inconsistencias && <section className="automation-history-audit" aria-label="Históricos potencialmente inconsistentes">
          <div className="automation-history-audit__heading"><div><strong>Auditoria de históricos</strong><span>{inconsistencias.total} caso(s) aguardando análise individual.</span></div><button type="button" className="btn btn-icon btn-ghost" title="Fechar auditoria" onClick={() => setInconsistencias(null)}><I.Close size={14} /></button></div>
          {inconsistencias.data.length === 0 ? <div className="automation-sale-state">Nenhuma inconsistência encontrada.</div> : inconsistencias.data.map(item => <article key={item.historico_id} className="automation-history-item"><div><strong>Venda #{item.venda_id}</strong><span>Evento #{item.historico_id} · {item.status_anterior || 'sem etapa'} → {item.status_novo || 'sem etapa'}</span>{item.motivos.map(motivo => <small key={motivo}>{motivo}</small>)}</div><button type="button" className="btn btn-primary" onClick={() => setCorrecaoHistorico(item)}>Revisar correção</button></article>)}
        </section>}

        {correcaoHistorico && <CorrecaoHistoricoModal item={correcaoHistorico} onClose={() => setCorrecaoHistorico(null)} onErro={setErro} onCorrigido={async () => { await auditarHistoricos(); await carregar(true); }} />}

        <section className="automation-list" aria-busy={carregando}>
          {carregando && <div className="automation-empty"><span className="automation-spinner" aria-hidden="true" /><strong>Carregando execuções</strong><span>Consultando o histórico da automação.</span></div>}
          {!carregando && itens.length === 0 && <div className="automation-empty"><span className="automation-empty__icon"><I.History size={24} /></span><strong>Nenhuma execução encontrada</strong><span>{titulo ? `Nenhum título de e-mail contém “${titulo}”.` : classificacao === 'cancelamento' ? 'Não há execuções com a classificação “Vendas canceladas”.' : status ? `Não há execuções com o status “${STATUS_LABEL[status]}”.` : 'Os novos e-mails processados aparecerão aqui.'}</span></div>}
          {!carregando && itens.map(item => (
            <details key={item.id} className={`automation-card status-${item.status}`}>
              <summary>
                <div className="automation-card__identity"><strong>{item.assunto || '(sem assunto)'}</strong><span>{item.operadora || 'Vivo'} · {item.origem || 'gmail_vivo'} · {item.remetente || 'Remetente não informado'}</span></div>
                <div className="automation-card__meta"><span className="automation-status">{STATUS_LABEL[item.status] || item.status}</span><time>{dataHora(item.recebido_em)}</time><I.ChevronDown className="automation-chevron" size={16} /></div>
              </summary>
              <div className="automation-detail">
                <dl>
                  <div><dt>Venda</dt><dd>{item.venda_id ? `#${item.venda_id}` : 'Não vinculada'}</dd></div>
                  <div><dt>Classificação</dt><dd>{CLASSIFICACAO_LABEL[item.classificacao || item.dados_extraidos?.classificacao] || '—'}</dd></div>
                  <div><dt>Destino</dt><dd>{item.dados_extraidos?.destino || '—'}</dd></div>
                  <div><dt>Documento</dt><dd>{item.dados_extraidos?.documento || '—'}</dd></div>
                  {item.operadora === 'Claro' && <div><dt>Autenticação</dt><dd>{item.autenticacao_valida && item.dados_extraidos?.autenticacao_email?.metodo === 'dkim_original' ? 'DKIM do original validado' : 'Origem não comprovada'}</dd></div>}
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
