import { useCallback, useEffect, useState } from 'react';
import { descartarAutomacao, listarAutomacoes, obterResumoAutomacoes, repetirAutomacao, revisarAutomacao } from '../../services/automacao.service';
import './AutomacoesPage.css';

const STATUS = ['', 'pendente', 'processando', 'concluido', 'revisao', 'erro', 'rejeitado', 'descartado'];
const dataHora = valor => valor ? new Date(valor).toLocaleString('pt-BR') : '—';

function Revisao({ item, onAtualizar }) {
  const extraidos = item.dados_extraidos || {};
  const [vendaId, setVendaId] = useState(item.venda_id || '');
  const [tipo, setTipo] = useState(item.classificacao || extraidos.classificacao || 'tipo_1');
  const [etapa, setEtapa] = useState(item.etapa_destino || extraidos.alvo || 'entrega');
  const [mensagem, setMensagem] = useState(extraidos.mensagem_operador || '');
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function executar(acao) {
    setSalvando(true);
    try {
      if (acao === 'revisar') await revisarAutomacao(item.id, { venda_id: Number(vendaId), classificacao: tipo, etapa_destino: tipo === 'tipo_1' ? etapa : null, mensagem_operador: mensagem, justificativa });
      if (acao === 'repetir') await repetirAutomacao(item.id);
      if (acao === 'descartar') await descartarAutomacao(item.id, justificativa);
      onAtualizar();
    } finally { setSalvando(false); }
  }

  return <div className="automation-review">
    <label>Venda ID<input value={vendaId} onChange={event => setVendaId(event.target.value)} inputMode="numeric" /></label>
    <label>Tipo<select value={tipo} onChange={event => setTipo(event.target.value)}><option value="tipo_1">Atualização de etapa</option><option value="tipo_2">Problema</option></select></label>
    {tipo === 'tipo_1' && <label>Destino<select value={etapa} onChange={event => setEtapa(event.target.value)}><option value="entrega">Entrega</option><option value="aceite_biometria">Aceite/Biometria</option></select></label>}
    {tipo === 'tipo_2' && <label className="wide">Mensagem ao operador<textarea value={mensagem} onChange={event => setMensagem(event.target.value)} /></label>}
    <label className="wide">Justificativa<textarea value={justificativa} onChange={event => setJustificativa(event.target.value)} /></label>
    <div className="automation-actions"><button className="btn btn-primary" disabled={salvando || !vendaId || !justificativa.trim()} onClick={() => executar('revisar')}>Corrigir e reprocessar</button><button className="btn" disabled={salvando} onClick={() => executar('repetir')}>Repetir</button><button className="btn btn-danger" disabled={salvando || !justificativa.trim()} onClick={() => executar('descartar')}>Descartar</button></div>
  </div>;
}

export default function AutomacoesPage() {
  const [status, setStatus] = useState(''); const [itens, setItens] = useState([]); const [resumo, setResumo] = useState({ contadores: {} }); const [erro, setErro] = useState('');
  const carregar = useCallback(async () => { try { setErro(''); const [lista, dadosResumo] = await Promise.all([listarAutomacoes(status), obterResumoAutomacoes()]); setItens(lista.data || []); setResumo(dadosResumo); } catch (error) { setErro(error.message); } }, [status]);
  useEffect(() => {
    let ativo = true;
    Promise.all([listarAutomacoes(status), obterResumoAutomacoes()])
      .then(([lista, dadosResumo]) => { if (ativo) { setItens(lista.data || []); setResumo(dadosResumo); setErro(''); } })
      .catch(error => { if (ativo) setErro(error.message); });
    return () => { ativo = false; };
  }, [status]);
  return <main className="automation-page">
    <section className="automation-summary"><div><strong>{resumo.habilitada ? 'Gmail ativo' : 'Gmail desabilitado'}</strong><span>Última mensagem: {dataHora(resumo.ultima_mensagem_em)}</span></div>{Object.entries(resumo.contadores || {}).map(([chave, total]) => <button key={chave} onClick={() => setStatus(chave)}><strong>{total}</strong><span>{chave}</span></button>)}</section>
    <div className="automation-toolbar"><label>Status<select value={status} onChange={event => setStatus(event.target.value)}>{STATUS.map(item => <option key={item} value={item}>{item || 'Todos'}</option>)}</select></label><button className="btn" onClick={carregar}>Atualizar</button></div>
    {erro && <div className="alert-error">{erro}</div>}
    <section className="automation-list">{itens.length === 0 && <div className="empty">Nenhuma execução encontrada.</div>}{itens.map(item => <details key={item.id} className={`automation-card status-${item.status}`}><summary><div><strong>{item.assunto || '(sem assunto)'}</strong><span>{item.remetente}</span></div><div><span className="automation-status">{item.status}</span><time>{dataHora(item.recebido_em)}</time></div></summary><div className="automation-detail"><dl><div><dt>Venda</dt><dd>{item.venda_id || 'não vinculada'}</dd></div><div><dt>Classificação</dt><dd>{item.classificacao || item.dados_extraidos?.classificacao || '—'}</dd></div><div><dt>Destino</dt><dd>{item.dados_extraidos?.destino || '—'}</dd></div><div><dt>Documento</dt><dd>{item.dados_extraidos?.documento || '—'}</dd></div></dl>{item.erro && <div className="alert-error">{item.erro}</div>}<pre>{item.corpo_texto || 'Corpo removido ou não armazenado.'}</pre>{['revisao', 'erro'].includes(item.status) && <Revisao item={item} onAtualizar={carregar} />}</div></details>)}</section>
  </main>;
}
