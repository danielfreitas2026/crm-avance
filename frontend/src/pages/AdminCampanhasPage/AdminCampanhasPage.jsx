import { useEffect, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { createCampanha, deleteCampanha, getCampanhas, getParticipantesCampanha, updateCampanhas } from '../../services/campanha.service';
import { listarOperadoras } from '../../services/config.service';
import * as I from '../../components/Icons';
import './AdminCampanhasPage.css';

const CATEGORIAS = [['registro_cliente', 'Registro de cliente'], ['venda', 'Venda'], ['chip_novo', 'Chip novo'], ['portabilidade', 'Portabilidade'], ['internet', 'Internet'], ['valor_monetario', 'Valor em vendas'], ['outros', 'Outros']];
const PUBLICOS = [['ambos', 'Clientes base e não base'], ['base', 'Somente clientes base'], ['nao_base', 'Somente clientes não base']];
const TIPOS_REGRA = [['categoria', 'Categoria da campanha'], ['chip_novo', 'Chip novo'], ['portabilidade', 'Portabilidade'], ['internet', 'Internet']];
const alternarId = (ids, id) => ids.map(Number).includes(Number(id)) ? ids.filter(item => Number(item) !== Number(id)) : [...ids, Number(id)];
const regraPadrao = () => ({ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' });
const hojeISO = () => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  return `${partes.year}-${partes.month}-${partes.day}`;
};

const normalizarRegrasTela = campanha => {
  if (Array.isArray(campanha.regras) && campanha.regras.length) return campanha.regras;
  const ids = campanha.operadora_ids || [];
  return (ids.length ? ids : [null]).map(operadora_id => ({
    operadora_id,
    publico_base: campanha.categoria === 'registro_cliente' ? 'ambos' : (campanha.publico_base || 'ambos'),
    tipo: 'categoria'
  }));
};

function AdminCampanhasPage() {
  const [campanhas, setCampanhas] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    try {
      const [data, ops, users] = await Promise.all([getCampanhas(), listarOperadoras(), getParticipantesCampanha()]);
      setCampanhas(data.map(c => ({ ...c, operadora_ids: c.operadora_ids || [], participante_ids: c.participante_ids || [], regras: normalizarRegrasTela(c) })));
      // A API de participantes já retorna somente usuários ativos (id, nome e e-mail).
      // Não filtre por `ativo` aqui: esse campo não é enviado pela rota.
      setOperadoras(ops); setUsuarios(users);
    } catch { setMessage({ type: 'error', text: 'Não foi possível carregar as campanhas.' }); }
    finally { setLoading(false); }
  };
  // A carga inicial sincroniza o estado local com as três fontes da tela.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);
  const change = (id, field, value) => setCampanhas(items => items.map(c => {
    if (c.id !== id) return c;
    const next = { ...c, [field]: value };
    if (field === 'categoria' && value === 'registro_cliente') {
      next.publico_base = 'ambos';
      next.regras = (next.regras || [regraPadrao()]).map(regra => ({ ...regra, publico_base: 'ambos', tipo: 'categoria' }));
    }
    return next;
  }));
  const changeRegra = (campanhaId, index, field, value) => setCampanhas(items => items.map(campanha => {
    if (campanha.id !== campanhaId) return campanha;
    return {
      ...campanha,
      regras: campanha.regras.map((regra, regraIndex) => regraIndex === index
        ? { ...regra, [field]: field === 'operadora_id' ? (value ? Number(value) : null) : value }
        : regra)
    };
  }));
  const addRegra = campanhaId => setCampanhas(items => items.map(campanha => campanha.id === campanhaId
    ? { ...campanha, regras: [...campanha.regras, regraPadrao()] }
    : campanha));
  const removeRegra = (campanhaId, index) => setCampanhas(items => items.map(campanha => campanha.id === campanhaId
    ? { ...campanha, regras: campanha.regras.filter((_, regraIndex) => regraIndex !== index) }
    : campanha));
  const add = async () => {
    setSaving(true);
    try {
      const hoje = hojeISO();
      const created = await createCampanha({ periodo: 'personalizado', data_inicio: hoje, data_fim: hoje, categoria: 'registro_cliente', publico_base: 'ambos', target: 1, desc: 'Registrar 1 cliente', reward: '', regras: [regraPadrao()], operadora_ids: [], participante_ids: [] });
      setCampanhas(items => [...items, { ...created, regras: normalizarRegrasTela(created) }]);
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Erro ao adicionar campanha.' }); }
    finally { setSaving(false); }
  };
  const save = async () => {
    const periodoInvalido = campanhas.find(campanha => campanha.is_gift && (
      !campanha.data_inicio || !campanha.data_fim || campanha.data_inicio > campanha.data_fim
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
    if (!window.confirm('Deseja excluir esta campanha?')) return;
    setSaving(true);
    try { await deleteCampanha(id); setCampanhas(items => items.filter(c => c.id !== id)); }
    catch { setMessage({ type: 'error', text: 'Erro ao excluir campanha.' }); }
    finally { setSaving(false); }
  };
  if (loading) return <LayoutPrivado><div className="empty">Carregando campanhas...</div></LayoutPrivado>;

  return <LayoutPrivado><div className="page admin-campanhas-page">
    {message && <div className={`alert-${message.type} admin-campanhas-alert`}>{message.text}</div>}
    <div className="panel admin-campanhas-panel"><div className="panel-header admin-campanhas-panel__header"><div><h3>Gamificação: presentes e recompensas</h3><span className="muted">Defina as metas, o público e a recompensa de cada campanha.</span></div><button className="btn admin-campanhas-add-button" onClick={add} disabled={saving}><I.Plus size={16} /> Adicionar campanha</button></div>
      <div className="panel-body admin-campanhas-panel__body">
        {campanhas.filter(c => c.is_gift).map((campanha, index) => <section key={campanha.id} className="admin-campanhas-campaign">
          <header className="admin-campanhas-campaign__header"><div><span className="admin-campanhas-campaign__eyebrow">Campanha {index + 1}</span><h4>Configuração da recompensa</h4></div><button className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => remove(campanha.id)} disabled={saving} title="Excluir campanha" aria-label={`Excluir campanha ${index + 1}`}><I.Trash size={16} /></button></header>
          <div className="admin-campanhas-section">
            <h5>Meta da campanha</h5>
            <div className="admin-campanhas-fields admin-campanhas-fields--four">
              <label>Data inicial{campanha.periodo_bloqueado && <small>Bloqueada após o primeiro resgate.</small>}<input type="date" value={campanha.data_inicio || ''} disabled={campanha.periodo_bloqueado} onChange={e => change(campanha.id, 'data_inicio', e.target.value)} required /></label>
              <label>Data final{campanha.periodo_bloqueado && <small>Bloqueada após o primeiro resgate.</small>}<input type="date" value={campanha.data_fim || ''} disabled={campanha.periodo_bloqueado} min={campanha.data_inicio || undefined} onChange={e => change(campanha.id, 'data_fim', e.target.value)} required /></label>
              <label>Categoria<select value={campanha.categoria} onChange={e => change(campanha.id, 'categoria', e.target.value)}>{CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>{campanha.categoria === 'valor_monetario' ? 'Meta (R$)' : 'Alvo'}<input type="number" min="0.01" step={campanha.categoria === 'valor_monetario' ? '0.01' : '1'} value={campanha.target} onChange={e => change(campanha.id, 'target', Number(e.target.value) || 0)} /></label>
              {campanha.categoria === 'outros' && <label className="admin-campanhas-field--wide">Nome da categoria<input value={campanha.categoria_personalizada || ''} onChange={e => change(campanha.id, 'categoria_personalizada', e.target.value)} placeholder="Ex.: Seguro" /></label>}
            </div>
          </div>
          <div className="admin-campanhas-section">
            <h5>Quem participa</h5>
            <div className="admin-campanhas-rules-field">
              <span>Regras de elegibilidade <small>Uma venda precisa atender pelo menos uma regra.</small></span>
              <div className="admin-campanhas-rules">
                {campanha.regras.map((regra, regraIndex) => <div className="admin-campanhas-rule" key={`${campanha.id}-regra-${regraIndex}`}>
                  <label>Operadora<select value={regra.operadora_id || ''} onChange={e => changeRegra(campanha.id, regraIndex, 'operadora_id', e.target.value)}><option value="">Todas</option>{operadoras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></label>
                  <label>Público<select disabled={campanha.categoria === 'registro_cliente'} value={campanha.categoria === 'registro_cliente' ? 'ambos' : (regra.publico_base || 'ambos')} onChange={e => changeRegra(campanha.id, regraIndex, 'publico_base', e.target.value)}>{PUBLICOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label>Tipo considerado<select disabled={campanha.categoria === 'registro_cliente'} value={campanha.categoria === 'registro_cliente' ? 'categoria' : (regra.tipo || 'categoria')} onChange={e => changeRegra(campanha.id, regraIndex, 'tipo', e.target.value)}>{TIPOS_REGRA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <button type="button" className="btn btn-icon btn-ghost btn-danger-icon admin-campanhas-rule-remove" onClick={() => removeRegra(campanha.id, regraIndex)} disabled={campanha.regras.length === 1} title="Remover regra" aria-label={`Remover regra ${regraIndex + 1}`}><I.Trash size={15} /></button>
                </div>)}
              </div>
              <button type="button" className="btn btn-sm admin-campanhas-add-rule" onClick={() => addRegra(campanha.id)}><I.Plus size={14} /> Adicionar regra</button>
            </div>
            <div className="admin-campanhas-fields admin-campanhas-fields--participants-only">
              <div className="admin-campanhas-choice-field"><span>Participantes <small>(deixe vazio para todos)</small></span><div className="admin-campanhas-checkboxes admin-campanhas-checkboxes--participants">{usuarios.map(u => <label key={u.id} className="admin-campanhas-checkbox"><input type="checkbox" checked={campanha.participante_ids.map(Number).includes(Number(u.id))} onChange={() => change(campanha.id, 'participante_ids', alternarId(campanha.participante_ids, u.id))} /><span>{u.nome}</span></label>)}</div><button type="button" className="btn btn-sm admin-campanhas-select-all" onClick={() => change(campanha.id, 'participante_ids', usuarios.map(u => Number(u.id)))}>Selecionar todos os ativos</button></div>
            </div>
          </div>
          <div className="admin-campanhas-section admin-campanhas-section--last">
            <h5>Comunicação</h5>
            <div className="admin-campanhas-fields admin-campanhas-fields--two"><label>Descrição exibida<input value={campanha.desc || ''} onChange={e => change(campanha.id, 'desc', e.target.value)} placeholder="Ex.: Registre 10 clientes" /></label><label>Recompensa<input value={campanha.reward || ''} onChange={e => change(campanha.id, 'reward', e.target.value)} placeholder="Ex.: Folga na sexta-feira" /></label></div>
          </div>
        </section>)}
      </div>
    </div>
    <div className="admin-campanhas-actions"><button className="btn btn-primary" onClick={save} disabled={saving}><I.Check size={16} /> {saving ? 'Salvando...' : 'Salvar alterações'}</button></div>
  </div></LayoutPrivado>;
}
export default AdminCampanhasPage;
