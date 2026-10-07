import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { createCampanha, deleteCampanha, getCampanhas, getParticipantesCampanha, getVendasExcecaoCampanha, updateCampanhas } from '../../services/campanha.service';
import { listarOperadoras } from '../../services/config.service';
import Paginacao from '../../components/Paginacao/Paginacao';
import * as I from '../../components/Icons';
import './AdminCampanhasPage.css';

const CATEGORIAS = [['registro_cliente', 'Registro de cliente'], ['registro_futuro_cliente', 'Registro de futuro cliente'], ['valor_monetario', 'Valor em vendas'], ['quantidade_chip', 'Quantidade de chip'], ['outros', 'Outro']];
const CATEGORIAS_LEGADAS = { venda: 'Venda', chip_novo: 'Chip novo', portabilidade: 'Portabilidade', internet: 'Internet' };
const PUBLICOS = [['ambos', 'Clientes base e não base'], ['base', 'Somente clientes base'], ['nao_base', 'Somente clientes não base']];
const TIPOS_REGRA = [['categoria', 'Categoria da campanha'], ['chip_novo', 'Chip novo'], ['portabilidade', 'Portabilidade'], ['novo_portabilidade', 'Novo e portabilidade'], ['internet', 'Internet']];
const TIPOS_CHIP = [['novo', 'Novo'], ['portabilidade', 'Portabilidade'], ['ambos', 'Novo e portabilidade']];
const alternarId = (ids, id) => ids.map(Number).includes(Number(id)) ? ids.filter(item => Number(item) !== Number(id)) : [...ids, Number(id)];
const regraPadrao = () => ({ operadora_id: null, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'ambos' });
const categoriasDisponiveis = categoriaAtual => CATEGORIAS.some(([valor]) => valor === categoriaAtual)
  ? CATEGORIAS
  : [...CATEGORIAS, [categoriaAtual, CATEGORIAS_LEGADAS[categoriaAtual] || categoriaAtual]];
const hojeISO = () => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  return `${partes.year}-${partes.month}-${partes.day}`;
};

const normalizarRegrasTela = campanha => {
  if (Array.isArray(campanha.regras) && campanha.regras.length) return campanha.regras.map(regra => ({
    ...regra,
    tipo_chip: ['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria)
      ? 'ambos'
      : regra.tipo === 'chip_novo'
        ? 'novo'
        : regra.tipo === 'portabilidade'
          ? 'portabilidade'
          : regra.tipo === 'novo_portabilidade'
            ? 'ambos'
          : (regra.tipo_chip || 'ambos')
  }));
  const ids = campanha.operadora_ids || [];
  return (ids.length ? ids : [null]).map(operadora_id => ({
    operadora_id,
    publico_base: ['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria) ? 'ambos' : (campanha.publico_base || 'ambos'),
    tipo: 'categoria',
    tipo_chip: 'ambos'
  }));
};

const formatarData = valor => valor ? String(valor).slice(0, 10).split('-').reverse().join('/') : 'Sem data';
const formatarMoeda = valor => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const montarRascunhoCampanha = campanha => ({
  data_inicio: campanha.data_inicio,
  data_fim: campanha.data_fim,
  hora_inicio: campanha.hora_inicio || null,
  hora_fim: campanha.hora_fim || null,
  categoria: campanha.categoria,
  categoria_personalizada: campanha.categoria_personalizada,
  target: campanha.target,
  desc: campanha.desc,
  reward: campanha.reward,
  publico_base: campanha.publico_base,
  operadora_id: campanha.operadora_id,
  operadora_ids: campanha.operadora_ids || [],
  participante_ids: campanha.participante_ids || [],
  regras: campanha.regras || []
});

function VendaExcecaoResumo({ venda, onRemove }) {
  return <div className={`admin-campanhas-exception-chip${venda.valida === false ? ' is-invalid' : ''}`}>
    <div><strong>#{venda.id} · {venda.cliente_nome || venda.razao_social || 'Cliente não informado'}</strong><span>{formatarData(venda.data_venda)} · {venda.vendedora_nome || 'Sem vendedor'}{venda.valida === false ? ' · Indisponível' : ''}</span></div>
    <button type="button" className="btn btn-icon btn-ghost" onClick={onRemove} aria-label={`Remover exceção da venda ${venda.id}`}><I.Close size={14} /></button>
  </div>;
}

function VendasExcecaoModal({ campanha, onClose, onConfirm }) {
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(20);
  const [resultado, setResultado] = useState({ data: [], total: 0 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [selecionadas, setSelecionadas] = useState(() => new Map());

  useEffect(() => {
    let ativo = true;
    const timer = setTimeout(async () => {
      setCarregando(true); setErro('');
      try {
        const dados = await getVendasExcecaoCampanha(campanha.id, {
          campanha: montarRascunhoCampanha(campanha),
          busca,
          page: pagina,
          per_page: porPagina,
          excluir_ids: campanha.venda_excecao_ids || []
        });
        if (ativo) setResultado({ data: dados.data || [], total: Number(dados.total || 0) });
      } catch (error) {
        if (ativo) setErro(error.message || 'Não foi possível carregar as vendas.');
      } finally {
        if (ativo) setCarregando(false);
      }
    }, busca ? 250 : 0);
    return () => { ativo = false; clearTimeout(timer); };
  }, [busca, pagina, porPagina, campanha]);

  useEffect(() => {
    const fechar = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fechar);
    return () => document.removeEventListener('keydown', fechar);
  }, [onClose]);

  const alternar = venda => setSelecionadas(atuais => {
    const proximas = new Map(atuais);
    if (proximas.has(Number(venda.id))) proximas.delete(Number(venda.id));
    else proximas.set(Number(venda.id), { ...venda, valida: true });
    return proximas;
  });
  const confirmar = () => onConfirm([...selecionadas.values()]);

  return <div className="modal-overlay admin-campanhas-exception-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
    <section className="modal admin-campanhas-exception-modal" role="dialog" aria-modal="true" aria-labelledby="vendas-excecao-title">
      <div className="modal-header"><div className="modal-header-row"><div><div id="vendas-excecao-title" className="modal-client">Adicionar exceção</div><div className="modal-sub">Apenas vendas que ainda não contribuem para esta campanha são exibidas.</div></div><button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Fechar"><I.Close size={16} /></button></div></div>
      <div className="modal-body admin-campanhas-exception-body">
        <label className="admin-campanhas-exception-search">Buscar venda<input autoFocus value={busca} onChange={event => { setBusca(event.target.value); setPagina(1); }} placeholder="ID, cliente, razão social, CNPJ ou vendedor" /></label>
        {selecionadas.size > 0 && <div className="admin-campanhas-exception-selected"><strong>{selecionadas.size} selecionada{selecionadas.size === 1 ? '' : 's'}</strong><div>{[...selecionadas.values()].map(venda => <VendaExcecaoResumo key={venda.id} venda={venda} onRemove={() => alternar(venda)} />)}</div></div>}
        {erro && <div className="alert-error">{erro}</div>}
        <div className="admin-campanhas-exception-results">
          <div className="admin-campanhas-exception-list" aria-busy={carregando}>
            {carregando ? <div className="empty">Carregando vendas...</div> : resultado.data.length === 0 ? <div className="empty">Nenhuma venda sem contribuição disponível para adicionar.</div> : resultado.data.map(venda => <label key={venda.id} className={`admin-campanhas-exception-row${selecionadas.has(Number(venda.id)) ? ' is-selected' : ''}`}>
              <input type="checkbox" checked={selecionadas.has(Number(venda.id))} onChange={() => alternar(venda)} />
              <span className="admin-campanhas-exception-main"><strong>#{venda.id} · {venda.cliente_nome || venda.razao_social || 'Cliente não informado'}</strong><small>{venda.cnpj || 'CNPJ não informado'} · {venda.vendedora_nome || 'Sem vendedor'}</small></span>
              <span className="admin-campanhas-exception-meta"><strong>{formatarMoeda(venda.valor_total)}</strong><small>{formatarData(venda.data_venda)} · {venda.quantidade_linhas || 0} linha(s)</small></span>
            </label>)}
          </div>
        </div>
        <Paginacao total={resultado.total} paginaAtual={pagina} itensPorPagina={porPagina} onPagina={setPagina} onItensPorPagina={valor => { setPorPagina(valor); setPagina(1); }} />
      </div>
      <div className="modal-footer"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={confirmar}><I.Check size={15} /> Confirmar {selecionadas.size ? `(${selecionadas.size})` : ''}</button></div>
    </section>
  </div>;
}

function AdminCampanhasPage() {
  const [campanhas, setCampanhas] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState(null);
  const [campanhaConfirmandoExclusao, setCampanhaConfirmandoExclusao] = useState(null);
  const [campanhaExcecoesAberta, setCampanhaExcecoesAberta] = useState(null);
  const [campanhasRecolhidas, setCampanhasRecolhidas] = useState(() => new Set());
  const campanhaAdicionadaId = useRef(null);
  const elementosCampanhas = useRef(new Map());

  const load = async () => {
    try {
      const [data, ops, users] = await Promise.all([getCampanhas(), listarOperadoras(), getParticipantesCampanha()]);
      setCampanhas(data.map(c => ({ ...c, operadora_ids: c.operadora_ids || [], participante_ids: c.participante_ids || [], venda_excecao_ids: c.venda_excecao_ids || [], vendas_excecao: c.vendas_excecao || [], regras: normalizarRegrasTela(c) })));
      // A API de participantes já retorna somente usuários ativos (id, nome e e-mail).
      // Não filtre por `ativo` aqui: esse campo não é enviado pela rota.
      setOperadoras(ops); setUsuarios(users);
    } catch { setMessage({ type: 'error', text: 'Não foi possível carregar as campanhas.' }); }
    finally { setLoading(false); }
  };
  // A carga inicial sincroniza o estado local com as três fontes da tela.
  useEffect(() => {
    let ativo = true;
    Promise.all([getCampanhas(), listarOperadoras(), getParticipantesCampanha()])
      .then(([data, ops, users]) => {
        if (!ativo) return;
        setCampanhas(data.map(c => ({ ...c, operadora_ids: c.operadora_ids || [], participante_ids: c.participante_ids || [], venda_excecao_ids: c.venda_excecao_ids || [], vendas_excecao: c.vendas_excecao || [], regras: normalizarRegrasTela(c) })));
        setCampanhasRecolhidas(new Set(data.filter(campanha => campanha.is_gift).map(campanha => campanha.id)));
        setOperadoras(ops);
        setUsuarios(users);
      })
      .catch(() => {
        if (ativo) setMessage({ type: 'error', text: 'Não foi possível carregar as campanhas.' });
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => { ativo = false; };
  }, []);
  useLayoutEffect(() => {
    if (campanhaAdicionadaId.current === null) return;
    const elemento = elementosCampanhas.current.get(campanhaAdicionadaId.current);
    if (!elemento) return;
    campanhaAdicionadaId.current = null;
    elemento.scrollIntoView({ behavior: 'smooth', block: 'start' });
    elemento.focus({ preventScroll: true });
  }, [campanhas]);
  const change = (id, field, value) => setCampanhas(items => items.map(c => {
    if (c.id !== id) return c;
    const next = { ...c, [field]: value };
    if (field === 'categoria' && ['registro_cliente', 'registro_futuro_cliente'].includes(value)) {
      if (value === 'registro_futuro_cliente') { next.venda_excecao_ids = []; next.vendas_excecao = []; }
      next.publico_base = 'ambos';
      next.regras = (next.regras || [regraPadrao()]).map(regra => ({ ...regra, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'ambos' }));
    }
    return next;
  }));
  const changeRegra = (campanhaId, index, field, value) => setCampanhas(items => items.map(campanha => {
    if (campanha.id !== campanhaId) return campanha;
    return {
      ...campanha,
      regras: campanha.regras.map((regra, regraIndex) => {
        if (regraIndex !== index) return regra;
        const proxima = { ...regra, [field]: field === 'operadora_id' ? (value ? Number(value) : null) : value };
        if (field === 'tipo' && value === 'chip_novo') proxima.tipo_chip = 'novo';
        if (field === 'tipo' && value === 'portabilidade') proxima.tipo_chip = 'portabilidade';
        if (field === 'tipo' && value === 'novo_portabilidade') proxima.tipo_chip = 'ambos';
        return proxima;
      })
    };
  }));
  const addRegra = campanhaId => setCampanhas(items => items.map(campanha => campanha.id === campanhaId
    ? { ...campanha, regras: [...campanha.regras, regraPadrao()] }
    : campanha));
  const removeRegra = (campanhaId, index) => setCampanhas(items => items.map(campanha => campanha.id === campanhaId
    ? { ...campanha, regras: campanha.regras.filter((_, regraIndex) => regraIndex !== index) }
    : campanha));
  const toggleCampanha = id => setCampanhasRecolhidas(ids => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const expandirCampanhaAoClicar = (event, id) => {
    if (!campanhasRecolhidas.has(id) || event.target.closest('button')) return;
    toggleCampanha(id);
  };
  const recolherCampanhaAoClicar = (event, id) => {
    if (campanhasRecolhidas.has(id) || event.target.closest('button')) return;
    toggleCampanha(id);
  };
  const atualizarExcecoes = (campanhaId, vendas) => setCampanhas(items => items.map(campanha => campanha.id === campanhaId ? {
    ...campanha,
    vendas_excecao: vendas,
    venda_excecao_ids: vendas.map(venda => Number(venda.id))
  } : campanha));
  const add = async () => {
    setSaving(true); setAdding(true); setMessage(null);
    try {
      const hoje = hojeISO();
      const created = await createCampanha({ periodo: 'personalizado', data_inicio: hoje, data_fim: hoje, categoria: 'registro_cliente', publico_base: 'ambos', target: 1, desc: 'Registrar 1 cliente', reward: '', regras: [regraPadrao()], operadora_ids: [], participante_ids: [], venda_excecao_ids: [] });
      campanhaAdicionadaId.current = created.id;
      setCampanhasRecolhidas(ids => {
        const next = new Set(ids);
        next.delete(created.id);
        return next;
      });
      setCampanhas(items => [...items, { ...created, regras: normalizarRegrasTela(created) }]);
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Erro ao adicionar campanha.' }); }
    finally { setSaving(false); setAdding(false); }
  };
  const save = async () => {
    const alvoInvalido = campanhas.find(campanha => campanha.is_gift && (
      !Number.isFinite(Number(campanha.target)) || Number(campanha.target) <= 0
      || (campanha.categoria !== 'valor_monetario' && !Number.isInteger(Number(campanha.target)))
    ));
    if (alvoInvalido) {
      setMessage({ type: 'error', text: alvoInvalido.categoria === 'valor_monetario'
        ? 'Meta financeira deve ser maior que zero.'
        : 'Alvo deve ser um número inteiro positivo para metas não monetárias.' });
      return;
    }
    const periodoInvalido = campanhas.find(campanha => campanha.is_gift && (
      !campanha.data_inicio || !campanha.data_fim || campanha.data_inicio > campanha.data_fim
      || Boolean(campanha.hora_inicio) !== Boolean(campanha.hora_fim)
      || (campanha.hora_inicio && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(campanha.hora_inicio)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(campanha.hora_fim)
        || `${campanha.data_inicio}T${campanha.hora_inicio}` >= `${campanha.data_fim}T${campanha.hora_fim}`))
    ));
    if (periodoInvalido) {
      setMessage({ type: 'error', text: 'Informe um período válido em todas as campanhas.' });
      return;
    }
    setSaving(true); setMessage(null);
    try { await updateCampanhas(campanhas); await load(); setMessage({ type: 'success', text: 'Campanhas atualizadas com sucesso.' }); }
    catch (error) { setMessage({ type: 'error', text: error.message || 'Erro ao salvar as campanhas.' }); }
    finally { setSaving(false); }
  };
  const remove = async id => {
    setSaving(true); setMessage(null);
    try {
      await deleteCampanha(id);
      setCampanhas(items => items.filter(c => c.id !== id));
      setCampanhaConfirmandoExclusao(null);
      setMessage({ type: 'success', text: 'Campanha excluída com sucesso.' });
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Erro ao excluir campanha.' }); }
    finally { setSaving(false); }
  };
  const campanhasGift = campanhas.filter(campanha => campanha.is_gift);
  const gruposCampanhas = [
    {
      id: 'atuais',
      titulo: 'Campanhas atuais',
      descricao: 'Campanhas ativas e programadas.',
      campanhas: campanhasGift.filter(campanha => campanha.estado_periodo !== 'encerrada')
    },
    {
      id: 'historico',
      titulo: 'Histórico de campanhas',
      descricao: 'Campanhas encerradas permanecem disponíveis para consulta e edição.',
      campanhas: campanhasGift.filter(campanha => campanha.estado_periodo === 'encerrada')
    }
  ];
  if (loading) return <LayoutPrivado><div className="empty">Carregando campanhas...</div></LayoutPrivado>;

  return <LayoutPrivado><div className="page admin-campanhas-page">
    {message && <div className={`alert-${message.type} admin-campanhas-alert`}>{message.text}</div>}
    <div className="panel admin-campanhas-panel"><div className="panel-header admin-campanhas-panel__header"><div><h3>Gamificação: presentes e recompensas</h3><span className="muted">Defina as metas, o público e a recompensa de cada campanha.</span></div><button type="button" className="btn admin-campanhas-add-button" onClick={add} disabled={saving}><I.Plus size={16} /> {adding ? 'Adicionando...' : 'Adicionar campanha'}</button></div>
      <div className="panel-body admin-campanhas-panel__body">
        {gruposCampanhas.filter(grupo => grupo.campanhas.length).map(grupo => <div className="admin-campanhas-group" key={grupo.id}>
          <div className="admin-campanhas-group__header"><div><h4>{grupo.titulo}</h4><p>{grupo.descricao}</p></div><span>{grupo.campanhas.length}</span></div>
          {grupo.campanhas.map(campanha => {
            const index = campanhasGift.findIndex(item => Number(item.id) === Number(campanha.id));
            const encerrada = campanha.estado_periodo === 'encerrada';
            return <section key={campanha.id} ref={elemento => {
          if (elemento) elementosCampanhas.current.set(campanha.id, elemento);
          else elementosCampanhas.current.delete(campanha.id);
        }} className={`admin-campanhas-campaign${campanhasRecolhidas.has(campanha.id) ? ' is-collapsed' : ''}`} onClick={event => expandirCampanhaAoClicar(event, campanha.id)} tabIndex="-1">
          <header className="admin-campanhas-campaign__header" onClick={event => recolherCampanhaAoClicar(event, campanha.id)}><div className="admin-campanhas-campaign__heading"><span className="admin-campanhas-campaign__eyebrow">Campanha {index + 1}{encerrada && <span className="admin-campanhas-ended-badge">Encerrada</span>}</span><h4>{campanha.desc?.trim() || `Campanha ${index + 1}`}</h4></div><div className="admin-campanhas-campaign__header-actions">{campanhaConfirmandoExclusao === campanha.id ? <div className="admin-campanhas-delete-confirm" role="group" aria-label={`Confirmar exclusão da campanha ${index + 1}`}><span>Excluir esta campanha?</span><button type="button" className="btn btn-sm btn-ghost" onClick={() => setCampanhaConfirmandoExclusao(null)} disabled={saving}>Cancelar</button><button type="button" className="btn btn-sm admin-campanhas-delete-confirm__button" onClick={() => remove(campanha.id)} disabled={saving}>{saving ? 'Excluindo...' : 'Sim'}</button></div> : <><button type="button" className="btn btn-sm btn-ghost admin-campanhas-toggle" onClick={() => toggleCampanha(campanha.id)} aria-expanded={!campanhasRecolhidas.has(campanha.id)} aria-controls={`campanha-detalhes-${campanha.id}`}><I.ChevronDown size={16} /> {campanhasRecolhidas.has(campanha.id) ? 'Expandir' : 'Recolher'}</button>{!encerrada && <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => setCampanhaConfirmandoExclusao(campanha.id)} disabled={saving} title="Excluir campanha" aria-label={`Excluir campanha ${index + 1}`}><I.Trash size={16} /></button>}</>}</div></header>
          <div id={`campanha-detalhes-${campanha.id}`} className="admin-campanhas-campaign__details" hidden={campanhasRecolhidas.has(campanha.id)}>
          <div className="admin-campanhas-section">
            <h5>Meta da campanha</h5>
            <div className="admin-campanhas-fields admin-campanhas-fields--four">
              <label className="admin-campanhas-field--wide">Nome da campanha<input value={campanha.desc || ''} onChange={e => change(campanha.id, 'desc', e.target.value)} placeholder="Ex.: Registre 10 clientes" /></label>
              <label>Data inicial{campanha.periodo_bloqueado && <small>Bloqueada após o primeiro resgate.</small>}<input type="date" value={campanha.data_inicio || ''} disabled={campanha.periodo_bloqueado} onChange={e => change(campanha.id, 'data_inicio', e.target.value)} required /></label>
              <label>Hora inicial<input type="time" value={campanha.hora_inicio || ''} disabled={campanha.periodo_bloqueado} onChange={e => change(campanha.id, 'hora_inicio', e.target.value || null)} /></label>
              <label>Data final{campanha.periodo_bloqueado && <small>Bloqueada após o primeiro resgate.</small>}<input type="date" value={campanha.data_fim || ''} disabled={campanha.periodo_bloqueado} min={campanha.data_inicio || undefined} onChange={e => change(campanha.id, 'data_fim', e.target.value)} required /></label>
              <label>Hora final<input type="time" value={campanha.hora_fim || ''} disabled={campanha.periodo_bloqueado} onChange={e => change(campanha.id, 'hora_fim', e.target.value || null)} /></label>
              <small className="admin-campanhas-field--wide admin-campanhas-period-hint">Horários opcionais. Preencha ambos para um intervalo contínuo, com término exclusivo. Nas vendas com horário, vale o cadastro no CRM.</small>
              <div className="admin-campanhas-fields admin-campanhas-fields--two admin-campanhas-field--wide">
                <label>Categoria<select value={campanha.categoria} onChange={e => change(campanha.id, 'categoria', e.target.value)}>{categoriasDisponiveis(campanha.categoria).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label>{campanha.categoria === 'valor_monetario' ? 'Meta (R$)' : 'Alvo'}<input type="number" min={campanha.categoria === 'valor_monetario' ? '0.01' : '1'} step={campanha.categoria === 'valor_monetario' ? '0.01' : '1'} value={campanha.target} onChange={e => change(campanha.id, 'target', Number(e.target.value) || 0)} /></label>
              </div>
              {campanha.categoria === 'outros' && <label className="admin-campanhas-field--wide">Nome da categoria<input value={campanha.categoria_personalizada || ''} onChange={e => change(campanha.id, 'categoria_personalizada', e.target.value)} placeholder="Ex.: Seguro" /></label>}
            </div>
          </div>
          <div className="admin-campanhas-section">
            <h5>Quem participa</h5>
            <div className="admin-campanhas-rules-field">
              <span>Regras de elegibilidade <small>Um registro precisa atender pelo menos uma regra.</small></span>
              <div className="admin-campanhas-rules">
                {campanha.regras.map((regra, regraIndex) => <div className="admin-campanhas-rule" key={`${campanha.id}-regra-${regraIndex}`}>
                  <label>Operadora<select value={regra.operadora_id || ''} onChange={e => changeRegra(campanha.id, regraIndex, 'operadora_id', e.target.value)}><option value="">Todas</option>{operadoras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></label>
                  <label>Público<select disabled={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria)} value={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria) ? 'ambos' : (regra.publico_base || 'ambos')} onChange={e => changeRegra(campanha.id, regraIndex, 'publico_base', e.target.value)}>{PUBLICOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label>Tipo considerado<select disabled={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria)} value={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria) ? 'categoria' : (regra.tipo || 'categoria')} onChange={e => changeRegra(campanha.id, regraIndex, 'tipo', e.target.value)}>{TIPOS_REGRA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label>Tipo de chip<select disabled={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria) || regra.tipo === 'chip_novo' || regra.tipo === 'portabilidade' || regra.tipo === 'novo_portabilidade'} value={['registro_cliente', 'registro_futuro_cliente'].includes(campanha.categoria) ? 'ambos' : (regra.tipo_chip || 'ambos')} onChange={e => changeRegra(campanha.id, regraIndex, 'tipo_chip', e.target.value)}>{TIPOS_CHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <button type="button" className="btn btn-icon btn-ghost btn-danger-icon admin-campanhas-rule-remove" onClick={() => removeRegra(campanha.id, regraIndex)} disabled={campanha.regras.length === 1} title="Remover regra" aria-label={`Remover regra ${regraIndex + 1}`}><I.Trash size={15} /></button>
                </div>)}
              </div>
              <button type="button" className="btn btn-sm admin-campanhas-add-rule" onClick={() => addRegra(campanha.id)}><I.Plus size={14} /> Adicionar regra</button>
            </div>
            <div className="admin-campanhas-fields admin-campanhas-fields--participants-only">
              <div className="admin-campanhas-choice-field"><span>Participantes <small>(deixe vazio para todos)</small></span><div className="admin-campanhas-checkboxes admin-campanhas-checkboxes--participants">{usuarios.map(u => <label key={u.id} className="admin-campanhas-checkbox"><input type="checkbox" checked={campanha.participante_ids.map(Number).includes(Number(u.id))} onChange={() => change(campanha.id, 'participante_ids', alternarId(campanha.participante_ids, u.id))} /><span>{u.nome}</span></label>)}</div><button type="button" className="btn btn-sm admin-campanhas-select-all" onClick={() => change(campanha.id, 'participante_ids', usuarios.map(u => Number(u.id)))}>Selecionar todos os ativos</button></div>
            </div>
            {campanha.categoria !== 'registro_futuro_cliente' && <div className="admin-campanhas-exceptions">
              <div className="admin-campanhas-exceptions__header"><span>Exceções de vendas <small>Contam mesmo sem atender ao período, participante ou regras.</small></span><button type="button" className="btn btn-sm" onClick={() => setCampanhaExcecoesAberta(campanha.id)}><I.Plus size={14} /> Adicionar exceção</button></div>
              {(campanha.vendas_excecao || []).length > 0 ? <div className="admin-campanhas-exceptions__list">{campanha.vendas_excecao.map(venda => <VendaExcecaoResumo key={venda.id} venda={venda} onRemove={() => atualizarExcecoes(campanha.id, campanha.vendas_excecao.filter(item => Number(item.id) !== Number(venda.id)))} />)}</div> : <span className="admin-campanhas-exceptions__empty">Nenhuma venda adicionada como exceção.</span>}
            </div>}
          </div>
          <div className="admin-campanhas-section admin-campanhas-section--last">
            <h5>Comunicação</h5>
            <div className="admin-campanhas-fields"><label className="admin-campanhas-field--wide">Recompensa<input value={campanha.reward || ''} onChange={e => change(campanha.id, 'reward', e.target.value)} placeholder="Ex.: Folga na sexta-feira" /></label></div>
          </div>
          </div>
        </section>;
          })}
        </div>)}
      </div>
    </div>
    <div className="admin-campanhas-actions"><button className="btn btn-primary" onClick={save} disabled={saving}><I.Check size={16} /> {saving ? 'Salvando...' : 'Salvar alterações'}</button></div>
    {campanhaExcecoesAberta && (() => {
      const campanha = campanhas.find(item => item.id === campanhaExcecoesAberta);
      return campanha ? <VendasExcecaoModal campanha={campanha} onClose={() => setCampanhaExcecoesAberta(null)} onConfirm={vendas => { atualizarExcecoes(campanha.id, [...(campanha.vendas_excecao || []), ...vendas]); setCampanhaExcecoesAberta(null); }} /> : null;
    })()}
  </div></LayoutPrivado>;
}
export default AdminCampanhasPage;
