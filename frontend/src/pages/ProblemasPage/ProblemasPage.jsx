import { useNavigationState } from '../../utils/useNavigationState';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import { formatUtcDateTime } from '../../utils/datetime';
import VendaModal from '../VendasPage/VendaModal';
import {
  listarProblemasAutomaticos,
  obterVendaProblemaAutomatico,
  resolverProblemaAutomatico
} from '../../services/automacao.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { listarClientesSelect } from '../../services/cliente.service';
import { listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { atualizarVenda, listarVendedoras } from '../../services/venda.service';
import '../AutomacoesPage/AutomacoesPage.css';

const EVENTO_LABEL = { abertura_automatica: 'Problema identificado', resolucao_automatica: 'Problema resolvido' };
const ABAS = {
  abertos: { label: 'Problemas abertos', vazio: 'Nenhum problema automático pendente' },
  resolvidos: { label: 'Problemas resolvidos', vazio: 'Nenhum problema resolvido no histórico' }
};
const PAGINACAO_INICIAL = { abertos: { page: 1, perPage: 20 }, resolvidos: { page: 1, perPage: 20 } };
const DATA_HORA_OPTIONS = {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'America/Sao_Paulo'
};
const dataHora = valor => formatUtcDateTime(valor, DATA_HORA_OPTIONS, '—');
const data = valor => valor ? new Date(`${String(valor).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const moeda = valor => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tipoLinha = valor => ({ novo: 'Novo', portabilidade: 'Portabilidade', migracao: 'Migração' }[String(valor || '').toLowerCase()] || valor || '—');

function lerExpandidos(chave) {
  try {
    const ids = JSON.parse(localStorage.getItem(chave) || '[]');
    return new Set(Array.isArray(ids) ? ids.map(Number).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function referenciasDaVenda(venda) {
  const vendedores = Array.isArray(venda?.vendedoras) && venda.vendedoras.length
    ? venda.vendedoras
    : (venda?.vendedora ? [venda.vendedora] : []);
  return {
    clientes: venda?.cliente ? [venda.cliente] : [],
    vendedoras: vendedores,
    operadoras: [venda?.operadora, venda?.cliente?.operadoraAtual].filter(Boolean),
    tiposVenda: venda?.tipoVenda ? [venda.tipoVenda] : [],
    servicos: venda?.servico ? [venda.servico] : []
  };
}

function ResumoVendaCard({ resumo }) {
  const chips = Array.isArray(resumo?.chips) ? resumo.chips : [];
  const nomesVendedoras = (resumo?.vendedoras || []).map(item => item.nome).filter(Boolean).join(', ');
  return (
    <section className="problem-sale-summary" aria-label="Informações principais da venda">
      <div className="problem-sale-summary__facts">
        <div><span><I.User size={14} /> Vendedora(s)</span><strong>{nomesVendedoras || 'Não informada(s)'}</strong></div>
        <div><span><I.Calendar size={14} /> {resumo?.data_venda_origem === 'cadastro' ? 'Cadastro no CRM' : 'Data da venda'}</span><strong>{data(resumo?.data_venda)}</strong>{resumo?.data_venda_origem === 'cadastro' && <small>Data comercial não informada</small>}</div>
        <div><span><I.SimCard size={14} /> Total de chips</span><strong>{chips.reduce((total, chip) => total + Number(chip.quantidade || 0), 0)}</strong></div>
      </div>
      <div className="problem-sale-summary__chips">
        <strong>Chips envolvidos na venda</strong>
        {chips.length === 0 ? <p className="problem-sale-summary__empty">Nenhum chip informado.</p> : (
          <div className="problem-sale-summary__table-wrap">
            <table>
              <thead><tr><th>Chips</th><th>Operadoras</th><th>Vendedora</th><th>Valor unitário</th><th>Subtotal</th></tr></thead>
              <tbody>{chips.map((chip, index) => <tr key={`${chip.operadora_destino || 'chip'}-${index}`}>
                <td><strong>{chip.quantidade}×</strong><span>{chip.gb ? `${chip.gb} GB` : 'Franquia não informada'} · {tipoLinha(chip.tipo_linha)}</span></td>
                <td><span className="problem-sale-summary__route">{chip.operadora_atual || '—'} <I.ArrowRight size={13} /> {chip.operadora_destino || '—'}</span></td>
                <td>{chip.vendedora || '—'}</td><td>{moeda(chip.valor_unitario)}</td><td><strong>{moeda(chip.subtotal)}</strong></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ProblemasPage() {
  const usuario = getUsuarioLocal();
  const chaveExpandidos = `problemas-page:expandidos:v1:${usuario?.id || 'anonimo'}`;
  const [aba, setAba] = useNavigationState('ProblemasPage:aba', 'abertos', { allowed: Object.keys(ABAS) });
  const [paginacao, setPaginacao] = useNavigationState('ProblemasPage:paginacao', PAGINACAO_INICIAL);
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [totais, setTotais] = useState({ abertos: 0, resolvidos: 0 });
  const [erro, setErro] = useState('');
  const [resolucoes, setResolucoes] = useState({});
  const [salvando, setSalvando] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizacao, setAtualizacao] = useState(0);
  const [expandidos, setExpandidos] = useState(() => lerExpandidos(chaveExpandidos));
  const [vendaModal, setVendaModal] = useState(null);
  const [modalModoEdicao, setModalModoEdicao] = useState(false);
  const [carregandoVenda, setCarregandoVenda] = useState(null);
  const [problemaVendaModal, setProblemaVendaModal] = useNavigationState('ProblemasPage:detalhe', null, {
    validate: value => value === null || (Number.isSafeInteger(value) && value > 0)
  });
  const [referenciasModal, setReferenciasModal] = useState({ clientes: [], vendedoras: [], operadoras: [], tiposVenda: [], servicos: [] });
  const paginaAtual = paginacao[aba];

  const carregar = useCallback(async (ativo = { valor: true }) => {
    setCarregando(true);
    try {
      const resposta = await listarProblemasAutomaticos({ status: aba, page: paginaAtual.page, perPage: paginaAtual.perPage });
      if (!ativo.valor) return;
      const totalPaginas = Math.max(1, Math.ceil(Number(resposta.total || 0) / paginaAtual.perPage));
      if (paginaAtual.page > totalPaginas) {
        setPaginacao(atual => ({ ...atual, [aba]: { ...atual[aba], page: totalPaginas } }));
        return;
      }
      setItens(resposta.data || []);
      setTotal(Number(resposta.total || 0));
      setTotais(resposta.totals || { abertos: 0, resolvidos: 0 });
      setErro('');
    } catch (error) {
      if (ativo.valor) setErro(error.message);
    } finally {
      if (ativo.valor) setCarregando(false);
    }
  }, [aba, paginaAtual.page, paginaAtual.perPage, setPaginacao]);

  useEffect(() => {
    const ativo = { valor: true };
    const agendamento = window.setTimeout(() => carregar(ativo), 0);
    return () => { ativo.valor = false; window.clearTimeout(agendamento); };
  }, [carregar, atualizacao]);

  useEffect(() => {
    try { localStorage.setItem(chaveExpandidos, JSON.stringify(Array.from(expandidos))); } catch { /* armazenamento indisponível */ }
  }, [chaveExpandidos, expandidos]);

  function alternarDetalhes(id) {
    setExpandidos(atual => {
      const proximo = new Set(atual);
      if (proximo.has(Number(id))) proximo.delete(Number(id));
      else proximo.add(Number(id));
      return proximo;
    });
  }

  async function resolver(item) {
    setSalvando(item.problema_id);
    setErro('');
    try {
      await resolverProblemaAutomatico(item.problema_id, resolucoes[item.problema_id]);
      setResolucoes(atual => ({ ...atual, [item.problema_id]: '' }));
      setAtualizacao(valor => valor + 1);
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(null);
    }
  }

  async function abrirVenda(item) {
    setCarregandoVenda(item.problema_id);
    setErro('');
    try {
      const venda = await obterVendaProblemaAutomatico(item.problema_id);
      const fallback = referenciasDaVenda(venda);
      const resultados = await Promise.allSettled([
        listarClientesSelect(), listarVendedoras(), listarOperadoras(), listarTiposVenda(), listarServicos()
      ]);
      const valorOu = (indice, padrao) => resultados[indice].status === 'fulfilled' ? resultados[indice].value : padrao;
      setReferenciasModal({
        clientes: valorOu(0, fallback.clientes),
        vendedoras: valorOu(1, fallback.vendedoras),
        operadoras: valorOu(2, fallback.operadoras),
        tiposVenda: valorOu(3, fallback.tiposVenda),
        servicos: valorOu(4, fallback.servicos)
      });
      setProblemaVendaModal(item.problema_id);
      setVendaModal(venda);
      setModalModoEdicao(false);
    } catch (error) {
      setProblemaVendaModal(null);
      setErro(error.message || 'Erro ao abrir a venda vinculada.');
    } finally {
      setCarregandoVenda(null);
    }
  }

  const restaurarVenda = useEffectEvent(async () => {
    if (!problemaVendaModal || vendaModal) return;
    await abrirVenda({ problema_id: problemaVendaModal });
  });
  useEffect(() => {
    const timer = setTimeout(() => { void restaurarVenda(); }, 0);
    return () => clearTimeout(timer);
  }, [problemaVendaModal]);

  async function salvarVendaModal(dados) {
    await atualizarVenda(vendaModal.id, dados);
    const atualizada = await obterVendaProblemaAutomatico(problemaVendaModal);
    setVendaModal(atualizada);
    setModalModoEdicao(false);
  }

  function mudarAba(novaAba) {
    setAba(novaAba);
    setErro('');
  }

  return (
    <LayoutPrivado>
      <main className="automation-page problems-page">
        <section className="automation-summary" aria-label="Resumo dos problemas">
          <div className={`automation-connection ${totais.abertos > 0 ? 'has-problems' : ''}`}>
            <span className="automation-summary__icon"><I.AlertTriangle size={18} /></span>
            <div><strong>{totais.abertos} problema{totais.abertos === 1 ? '' : 's'} aberto{totais.abertos === 1 ? '' : 's'}</strong><span>Originados automaticamente pelos e-mails das operadoras</span></div>
          </div>
          <button type="button" className="btn automation-refresh" disabled={carregando} onClick={() => setAtualizacao(valor => valor + 1)}><I.Refresh size={14} /> {carregando ? 'Atualizando...' : 'Atualizar'}</button>
        </section>

        <div className="problems-tabs" role="tablist" aria-label="Situação dos problemas">
          {Object.entries(ABAS).map(([id, config]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'is-active' : ''} onClick={() => mudarAba(id)}>
              {config.label} <span>{totais[id]}</span>
            </button>
          ))}
        </div>

        {erro && <div className="alert-error automation-alert" role="alert">{erro}</div>}

        <section className="automation-list" aria-busy={carregando} aria-live="polite">
          {carregando && <div className="automation-empty"><span className="automation-spinner" aria-hidden="true" /><strong>Carregando problemas</strong><span>Consultando as ocorrências identificadas pela automação.</span></div>}
          {!carregando && itens.length === 0 && <div className="automation-empty"><span className="automation-empty__icon is-success"><I.Check size={24} /></span><strong>{ABAS[aba].vazio}</strong><span>{aba === 'abertos' ? 'As vendas que exigirem correção aparecerão aqui.' : 'As correções finalizadas aparecerão nesta aba.'}</span></div>}
          {!carregando && itens.map(item => {
            const expandido = expandidos.has(Number(item.problema_id));
            const detalhesId = `problema-detalhes-${item.problema_id}`;
            return (
              <article className={`automation-card problem-card ${aba === 'resolvidos' ? 'status-concluido' : 'status-revisao'}${expandido ? ' is-expanded' : ''}`} key={item.problema_id}>
                <header className="problem-card__header">
                  <button
                    type="button"
                    className="problem-card__header-click"
                    aria-label={`${expandido ? 'Recolher' : 'Expandir'} informações da venda #${item.venda_id}`}
                    aria-expanded={expandido}
                    aria-controls={detalhesId}
                    onClick={() => alternarDetalhes(item.problema_id)}
                  />
                  <div className="problem-card__identity">
                    <span className="automation-status">{aba === 'resolvidos' ? 'Problema resolvido' : 'Correção necessária'}</span>
                    <h2>Venda #{item.venda_id} — {item.venda_nome || item.razao_social}</h2>
                    <span>{item.cnpj || 'Documento não informado'}</span>
                    <div className="problem-card__dates"><span>E-mail recebido em <strong>{dataHora(item.recebido_em)}</strong></span><span>Problema aberto em <strong>{dataHora(item.aberto_em)}</strong></span></div>
                  </div>
                  <div className="problem-card__header-actions">
                    <button type="button" className="btn btn-sm" disabled={carregandoVenda === item.problema_id} onClick={() => abrirVenda(item)}>{carregandoVenda === item.problema_id ? 'Abrindo...' : 'Abrir venda completa'}</button>
                    <button type="button" className="btn btn-sm btn-ghost problem-card__toggle" aria-expanded={expandido} aria-controls={detalhesId} onClick={() => alternarDetalhes(item.problema_id)}><I.ChevronDown size={16} /> {expandido ? 'Recolher informações' : 'Expandir informações'}</button>
                  </div>
                </header>
                {expandido && (
                  <div className="automation-detail" id={detalhesId}>
                    <ResumoVendaCard resumo={item.venda_resumo} />
                    <div className="problem-message"><strong>Mensagem da operadora</strong><p>{item.dados_extraidos?.mensagem_operador || 'Mensagem não informada.'}</p></div>
                    {(item.eventos || []).length > 0 && (
                      <div className="problem-history"><strong>Histórico</strong>{item.eventos.map(evento => <div key={evento.id} className="problem-history__item"><span>{EVENTO_LABEL[evento.tipo] || evento.tipo} · {dataHora(evento.created_at)}</span><p>{evento.mensagem}</p></div>)}</div>
                    )}
                    {aba === 'resolvidos' ? (
                      <section className="problem-resolved" aria-label="Resolução do problema">
                        <div><span>Resolvido por</span><strong>{item.resolucao?.usuario?.nome || 'Usuário removido'}</strong></div>
                        <div><span>Resolvido em</span><strong>{dataHora(item.resolucao?.resolvido_em)}</strong></div>
                        <div className="problem-resolved__note"><span>Observação da resolução</span><p>{item.resolucao?.mensagem || 'Nenhuma observação registrada.'}</p></div>
                      </section>
                    ) : (
                      <>
                        <label className="problem-resolution">Como foi resolvido<textarea value={resolucoes[item.problema_id] || ''} onChange={event => setResolucoes(atual => ({ ...atual, [item.problema_id]: event.target.value }))} placeholder="Descreva a correção realizada" /></label>
                        <div className="automation-actions"><button type="button" className="btn btn-primary" disabled={salvando === item.problema_id || !resolucoes[item.problema_id]?.trim()} onClick={() => resolver(item)}>{salvando === item.problema_id ? 'Salvando...' : 'Resolver problema'}</button></div>
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {!carregando && total > 0 && <Paginacao total={total} paginaAtual={paginaAtual.page} itensPorPagina={paginaAtual.perPage} onPagina={page => setPaginacao(atual => ({ ...atual, [aba]: { ...atual[aba], page } }))} onItensPorPagina={perPage => setPaginacao(atual => ({ ...atual, [aba]: { page: 1, perPage } }))} />}
      </main>

      {vendaModal && (
        <VendaModal
          venda={vendaModal}
          clientes={referenciasModal.clientes}
          vendas={[]}
          vendedoras={referenciasModal.vendedoras}
          operadoras={referenciasModal.operadoras}
          tiposVenda={referenciasModal.tiposVenda}
          servicos={referenciasModal.servicos}
          vendasPorCliente={new Map()}
          vendasEmAndamentoPorCliente={new Map()}
          podeEditarVenda={temPermissao(usuario, ['vendas_editar', 'pos_venda'])}
          podeCompartilharVenda={temPermissao(usuario, 'compartilhar_venda')}
          podeVerDocumentosVenda={temPermissao(usuario, 'vendas_documentos')}
          podeAdicionarDocumentosVenda={temPermissao(usuario, 'adicionar_documentos')}
          usuarioLogado={usuario}
          initialTab="venda"
          modoEdicao={modalModoEdicao}
          onStartEdit={() => setModalModoEdicao(true)}
          onClose={() => { setVendaModal(null); setModalModoEdicao(false); setProblemaVendaModal(null); }}
          onSave={salvarVendaModal}
          onSendToPosVenda={() => {}}
        />
      )}
    </LayoutPrivado>
  );
}
