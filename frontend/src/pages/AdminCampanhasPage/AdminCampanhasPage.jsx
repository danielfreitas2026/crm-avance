import React, { useEffect, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { createCampanha, deleteCampanha, getCampanhas, getParticipantesCampanha, updateCampanhas } from '../../services/campanha.service';
import { listarOperadoras } from '../../services/config.service';
import * as I from '../../components/Icons';
import './AdminCampanhasPage.css';

const PERIODOS = [['diaria', 'Diária'], ['semanal', 'Semanal'], ['mensal', 'Mensal']];
const CATEGORIAS = [['registro_cliente', 'Registro de cliente'], ['chip_novo', 'Chip novo'], ['portabilidade', 'Portabilidade'], ['internet', 'Internet'], ['valor_monetario', 'Valor em vendas'], ['outros', 'Outros']];
const PUBLICOS = [['ambos', 'Clientes base e não base'], ['base', 'Somente clientes base'], ['nao_base', 'Somente clientes não base']];
const idsSelecionados = event => Array.from(event.target.selectedOptions, option => Number(option.value));
const alternarId = (ids, id) => ids.map(Number).includes(Number(id)) ? ids.filter(item => Number(item) !== Number(id)) : [...ids, Number(id)];

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
      setCampanhas(data.map(c => ({ ...c, operadora_ids: c.operadora_ids || [], participante_ids: c.participante_ids || [] })));
      // A API de participantes já retorna somente usuários ativos (id, nome e e-mail).
      // Não filtre por `ativo` aqui: esse campo não é enviado pela rota.
      setOperadoras(ops); setUsuarios(users);
    } catch { setMessage({ type: 'error', text: 'Não foi possível carregar as campanhas.' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const change = (id, field, value) => setCampanhas(items => items.map(c => {
    if (c.id !== id) return c;
    const next = { ...c, [field]: value };
    if (field === 'categoria' && value === 'registro_cliente') next.publico_base = 'ambos';
    return next;
  }));
  const add = async () => {
    setSaving(true);
    try {
      const created = await createCampanha({ periodo: 'diaria', categoria: 'registro_cliente', publico_base: 'ambos', target: 1, desc: 'Registrar 1 cliente', reward: '', operadora_ids: [], participante_ids: [] });
      setCampanhas(items => [...items, created]);
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Erro ao adicionar campanha.' }); }
    finally { setSaving(false); }
  };
  const save = async () => {
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
            <div className="admin-campanhas-fields admin-campanhas-fields--three">
              <label>Período<select value={campanha.periodo || 'diaria'} onChange={e => change(campanha.id, 'periodo', e.target.value)}>{PERIODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Categoria<select value={campanha.categoria} onChange={e => change(campanha.id, 'categoria', e.target.value)}>{CATEGORIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>{campanha.categoria === 'valor_monetario' ? 'Meta (R$)' : 'Alvo'}<input type="number" min="0.01" step={campanha.categoria === 'valor_monetario' ? '0.01' : '1'} value={campanha.target} onChange={e => change(campanha.id, 'target', Number(e.target.value) || 0)} /></label>
              {campanha.categoria === 'outros' && <label className="admin-campanhas-field--wide">Nome da categoria<input value={campanha.categoria_personalizada || ''} onChange={e => change(campanha.id, 'categoria_personalizada', e.target.value)} placeholder="Ex.: Seguro" /></label>}
            </div>
          </div>
          <div className="admin-campanhas-section">
            <h5>Quem participa</h5>
            <div className="admin-campanhas-fields admin-campanhas-fields--audience">
              <label>Filtro de base<select disabled={campanha.categoria === 'registro_cliente'} value={campanha.categoria === 'registro_cliente' ? 'ambos' : (campanha.publico_base || 'ambos')} onChange={e => change(campanha.id, 'publico_base', e.target.value)}>{PUBLICOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{campanha.categoria === 'registro_cliente' && <small>Definido automaticamente para esta categoria.</small>}</label>
              <div className="admin-campanhas-choice-field"><span>Operadoras <small>(deixe vazio para todas)</small></span><div className="admin-campanhas-checkboxes">{operadoras.map(o => <label key={o.id} className="admin-campanhas-checkbox"><input type="checkbox" checked={campanha.operadora_ids.map(Number).includes(Number(o.id))} onChange={() => change(campanha.id, 'operadora_ids', alternarId(campanha.operadora_ids, o.id))} /><span>{o.nome}</span></label>)}</div></div>
              <label>Participantes <small>(deixe vazio para todos)</small><select multiple value={campanha.participante_ids.map(String)} onChange={e => change(campanha.id, 'participante_ids', idsSelecionados(e))}>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select><button type="button" className="btn btn-sm admin-campanhas-select-all" onClick={() => change(campanha.id, 'participante_ids', usuarios.map(u => Number(u.id)))}>Selecionar todos os ativos</button></label>
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
