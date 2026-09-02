import { useCallback, useEffect, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import { formatUtcDateTime } from '../../utils/datetime';
import {
  coletarHistoricoAutomacoes,
  descartarAutomacao,
  listarAutomacoes,
  obterResumoAutomacoes,
  repetirAutomacao,
  repetirAutomacoesEmRevisao,
  revisarAutomacao
} from '../../services/automacao.service';
import './AutomacoesPage.css';

const STATUS = ['', 'pendente', 'processando', 'concluido', 'revisao', 'erro', 'rejeitado', 'descartado'];
const STATUS_LABEL = {
  pendente: 'Pendente',
  processando: 'Processando',
  concluido: 'Concluído',
  revisao: 'Revisão manual',
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

function Revisao({ item, onAtualizar, onErro }) {
  const extraidos = item.dados_extraidos || {};
  const candidatas = Array.isArray(extraidos.candidatas) ? extraidos.candidatas : [];
  const [vendaId, setVendaId] = useState(item.venda_id || '');
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
      ) : vinculandoVenda ? (
        <label className="wide">
          Venda vinculada ao CNPJ {extraidos.documento || ''}
          <select value={vendaId} onChange={event => setVendaId(event.target.value)}>
            <option value="">Selecione uma venda</option>
            {candidatas.map(candidata => (
              <option key={candidata.id} value={candidata.id} disabled={!candidata.elegivel}>
                {`#${candidata.id} — ${candidata.nome || 'Sem nome'} — Etapa: ${candidata.status_funil_nome || candidata.status_funil || 'Sem etapa'}${candidata.elegivel ? '' : ` — Indisponível: ${(candidata.inelegibilidades || []).join(', ')}`}`}
              </option>
            ))}
          </select>
          {candidatas.length === 0 && <small>Nenhuma venda foi encontrada para este CNPJ.</small>}
        </label>
      ) : (
        <div className="automation-review__link-sale">
          <button type="button" className="btn" onClick={() => setVinculandoVenda(true)}>Vincular venda</button>
        </div>
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
        listarAutomacoes({ status, page: pagina, perPage: porPagina }),
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
  }, [pagina, porPagina, status]);

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
    const quantidade = Number(resumo.contadores?.revisao || 0);
    if (!quantidade || !window.confirm(`Repetir a execução das ${quantidade} automações em revisão manual? Isso pode movimentar vendas ou abrir problemas.`)) return;
    setRepetindoRevisoes(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await repetirAutomacoesEmRevisao();
      const repetidos = Number(resultado.repetidos || 0);
      const falhas = Number(resultado.falhas || 0);
      setSucesso(falhas
        ? `${repetidos} execução(ões) em revisão repetida(s); ${falhas} falharam durante a preparação.`
        : `${repetidos} execução(ões) em revisão repetida(s) com sucesso.`);
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
  const total = Object.values(contadores).reduce((soma, quantidade) => soma + Number(quantidade || 0), 0);
  const totalRevisoes = Number(contadores.revisao || 0);
  const barraOcupada = atualizando || coletandoHistorico || repetindoRevisoes;
  function alterarStatus(novoStatus) {
    if (novoStatus !== status) setCarregando(true);
    setPagina(1);
    setStatus(novoStatus);
  }

  return (
    <LayoutPrivado>
      <main className="automation-page">
        <section className="automation-summary" aria-label="Resumo das automações">
          <div className={`automation-connection ${resumo.habilitada ? 'is-active' : 'is-disabled'}`}>
            <span className="automation-summary__icon"><I.Mail size={18} /></span>
            <div><strong>{resumo.habilitada ? 'Gmail ativo' : 'Gmail desabilitado'}</strong><span>Última mensagem: {dataHora(resumo.ultima_mensagem_em)}</span></div>
          </div>
          <button type="button" className={`automation-metric ${status === '' ? 'is-selected' : ''}`} aria-label={`Mostrar todas as ${total} execuções`} aria-pressed={status === ''} onClick={() => alterarStatus('')}><strong>{total}</strong><span>Todas</span></button>
          {STATUS.filter(Boolean).map(chave => (
            <button type="button" key={chave} className={`automation-metric status-${chave} ${status === chave ? 'is-selected' : ''}`} aria-label={`Filtrar por ${STATUS_LABEL[chave]}: ${Number(contadores[chave] || 0)}`} aria-pressed={status === chave} onClick={() => alterarStatus(chave)}><strong>{Number(contadores[chave] || 0)}</strong><span>{STATUS_LABEL[chave]}</span></button>
          ))}
        </section>

        <section className="automation-toolbar" aria-label="Filtros das automações">
          <label>
            Status
            <select value={status} onChange={event => alterarStatus(event.target.value)}>
              {STATUS.map(item => <option key={item} value={item}>{item ? STATUS_LABEL[item] : 'Todos os status'}</option>)}
            </select>
          </label>
          <div className="automation-toolbar__actions">
            <button type="button" className="btn" disabled={barraOcupada || totalRevisoes === 0} onClick={repetirRevisoes}><I.Refresh size={14} /> {repetindoRevisoes ? 'Reprocessando...' : `Repetir revisões (${totalRevisoes})`}</button>
            <button type="button" className="btn" disabled={barraOcupada || !resumo.habilitada} onClick={coletarHistorico}><I.History size={14} /> {coletandoHistorico ? 'Buscando histórico...' : 'Buscar e-mails anteriores'}</button>
            <button type="button" className="btn automation-refresh" disabled={barraOcupada} onClick={() => carregar(true)}><I.Refresh size={14} /> {atualizando ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </section>

        {erro && <div className="alert-error automation-alert" role="alert">{erro}</div>}
        {sucesso && <div className="alert-success automation-alert" role="status">{sucesso}</div>}

        <section className="automation-list" aria-busy={carregando}>
          {carregando && <div className="automation-empty"><span className="automation-spinner" aria-hidden="true" /><strong>Carregando execuções</strong><span>Consultando o histórico da automação.</span></div>}
          {!carregando && itens.length === 0 && <div className="automation-empty"><span className="automation-empty__icon"><I.History size={24} /></span><strong>Nenhuma execução encontrada</strong><span>{status ? `Não há execuções com o status “${STATUS_LABEL[status]}”.` : 'Os novos e-mails processados aparecerão aqui.'}</span></div>}
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
                {item.erro && <div className="alert-error automation-alert" role="alert">{item.erro}</div>}
                <div className="automation-email-body"><strong>Conteúdo recebido</strong><pre>{item.corpo_texto || 'Corpo removido ou não armazenado.'}</pre></div>
                {['revisao', 'erro'].includes(item.status) && <Revisao item={item} onAtualizar={() => carregar(true)} onErro={setErro} />}
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
