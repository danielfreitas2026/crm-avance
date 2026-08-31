import { useEffect, useState } from 'react';
import { listarProblemasAutomaticos, resolverProblemaAutomatico } from '../../services/automacao.service';
import '../AutomacoesPage/AutomacoesPage.css';

export default function ProblemasPage() {
  const [itens, setItens] = useState([]); const [erro, setErro] = useState(''); const [resolucoes, setResolucoes] = useState({}); const [salvando, setSalvando] = useState(null);
  async function carregar() { try { setItens(await listarProblemasAutomaticos()); setErro(''); } catch (error) { setErro(error.message); } }
  useEffect(() => {
    let ativo = true;
    listarProblemasAutomaticos().then(dados => { if (ativo) { setItens(dados); setErro(''); } }).catch(error => { if (ativo) setErro(error.message); });
    return () => { ativo = false; };
  }, []);
  async function resolver(item) { setSalvando(item.problema_id); try { await resolverProblemaAutomatico(item.problema_id, resolucoes[item.problema_id]); await carregar(); } catch (error) { setErro(error.message); } finally { setSalvando(null); } }
  return <main className="automation-page"><section className="automation-summary"><div><strong>{itens.length} problema{itens.length === 1 ? '' : 's'} aberto{itens.length === 1 ? '' : 's'}</strong><span>Originados automaticamente pelos e-mails da VIVO</span></div></section>{erro && <div className="alert-error">{erro}</div>}<section className="automation-list">{itens.length === 0 && <div className="empty">Nenhum problema automático pendente.</div>}{itens.map(item => <article className="automation-card status-revisao" key={item.problema_id}><div className="automation-detail" style={{paddingTop:16}}><div><strong>Venda #{item.venda_id} — {item.venda_nome || item.razao_social}</strong><div>{item.cnpj} · aberto em {new Date(item.aberto_em).toLocaleString('pt-BR')}</div></div><div><strong>Mensagem ao operador</strong><p>{item.dados_extraidos?.mensagem_operador}</p></div><div>{(item.eventos || []).map(evento => <p key={evento.id}><strong>{evento.tipo}:</strong> {evento.mensagem}</p>)}</div><label>Como foi resolvido<textarea value={resolucoes[item.problema_id] || ''} onChange={event => setResolucoes(atual => ({...atual,[item.problema_id]:event.target.value}))} /></label><button className="btn btn-primary" disabled={salvando === item.problema_id || !resolucoes[item.problema_id]?.trim()} onClick={() => resolver(item)}>Resolver problema</button></div></article>)}</section></main>;
}
