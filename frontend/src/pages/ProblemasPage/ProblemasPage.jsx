import { useEffect, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import { listarProblemasAutomaticos, resolverProblemaAutomatico } from '../../services/automacao.service';
import '../AutomacoesPage/AutomacoesPage.css';

const EVENTO_LABEL = { abertura_automatica: 'Problema identificado', resolucao_automatica: 'Problema resolvido' };
const dataHora = valor => valor ? new Date(valor).toLocaleString('pt-BR') : '—';

export default function ProblemasPage() {
  const [itens, setItens] = useState([]);
  const [erro, setErro] = useState('');
  const [resolucoes, setResolucoes] = useState({});
  const [salvando, setSalvando] = useState(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      setItens(await listarProblemasAutomaticos());
      setErro('');
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    listarProblemasAutomaticos()
      .then(dados => {
        if (!ativo) return;
        setItens(dados);
        setErro('');
      })
      .catch(error => { if (ativo) setErro(error.message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  async function resolver(item) {
    setSalvando(item.problema_id);
    setErro('');
    try {
      await resolverProblemaAutomatico(item.problema_id, resolucoes[item.problema_id]);
      setResolucoes(atual => ({ ...atual, [item.problema_id]: '' }));
      await carregar();
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <LayoutPrivado>
      <main className="automation-page problems-page">
        <section className="automation-summary" aria-label="Resumo dos problemas">
          <div className="automation-connection has-problems">
            <span className="automation-summary__icon"><I.AlertTriangle size={18} /></span>
            <div><strong>{itens.length} problema{itens.length === 1 ? '' : 's'} aberto{itens.length === 1 ? '' : 's'}</strong><span>Originados automaticamente pelos e-mails da VIVO</span></div>
          </div>
          <button type="button" className="btn automation-refresh" disabled={carregando} onClick={carregar}><I.Refresh size={14} /> {carregando ? 'Atualizando...' : 'Atualizar'}</button>
        </section>

        {erro && <div className="alert-error automation-alert" role="alert">{erro}</div>}

        <section className="automation-list" aria-busy={carregando}>
          {carregando && <div className="automation-empty"><span className="automation-spinner" aria-hidden="true" /><strong>Carregando problemas</strong><span>Consultando as pendências identificadas pela automação.</span></div>}
          {!carregando && itens.length === 0 && <div className="automation-empty"><span className="automation-empty__icon is-success"><I.Check size={24} /></span><strong>Nenhum problema automático pendente</strong><span>As vendas que exigirem correção aparecerão aqui.</span></div>}
          {!carregando && itens.map(item => (
            <article className="automation-card problem-card status-revisao" key={item.problema_id}>
              <div className="automation-detail">
                <header className="problem-card__header">
                  <div><span className="automation-status">Correção necessária</span><h2>Venda #{item.venda_id} — {item.venda_nome || item.razao_social}</h2><span>{item.cnpj || 'Documento não informado'} · aberto em {dataHora(item.aberto_em)}</span></div>
                </header>
                <div className="problem-message"><strong>Mensagem da operadora</strong><p>{item.dados_extraidos?.mensagem_operador || 'Mensagem não informada.'}</p></div>
                {(item.eventos || []).length > 0 && (
                  <div className="problem-history"><strong>Histórico</strong>{item.eventos.map(evento => <div key={evento.id} className="problem-history__item"><span>{EVENTO_LABEL[evento.tipo] || evento.tipo}</span><p>{evento.mensagem}</p></div>)}</div>
                )}
                <label className="problem-resolution">Como foi resolvido<textarea value={resolucoes[item.problema_id] || ''} onChange={event => setResolucoes(atual => ({ ...atual, [item.problema_id]: event.target.value }))} placeholder="Descreva a correção realizada" /></label>
                <div className="automation-actions"><button type="button" className="btn btn-primary" disabled={salvando === item.problema_id || !resolucoes[item.problema_id]?.trim()} onClick={() => resolver(item)}>{salvando === item.problema_id ? 'Salvando...' : 'Resolver problema'}</button></div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </LayoutPrivado>
  );
}
