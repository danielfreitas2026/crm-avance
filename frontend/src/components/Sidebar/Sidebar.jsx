import { useEffect, useState } from 'react';
import * as I from '../Icons';
import logo from '../../assets/LogoClaraSemFundo.png';
import { temPermissao } from '../../services/auth.service';
import { getCampanhas, getProgresso } from '../../services/campanha.service';

/**
 * Renderiza sidebar.
 */
function Sidebar({ page, setPage, counts, usuario, onLogout, onPerfilClick, isMobileOpen = false, onClose }) {
  const [campanhas, setCampanhas] = useState([]);
  const [progresso, setProgresso] = useState({});
  const podeVerCampanhas = temPermissao(usuario, 'campanhas_visualizar');

  useEffect(() => {
    if (!podeVerCampanhas) return undefined;

    const carregarCampanhas = () => {
      getCampanhas().then(setCampanhas).catch(console.error);
      getProgresso().then(setProgresso).catch(console.error);
    };
    carregarCampanhas();
    window.addEventListener('pos-venda:campanhas-atualizar', carregarCampanhas);
    return () => window.removeEventListener('pos-venda:campanhas-atualizar', carregarCampanhas);
  }, [podeVerCampanhas]);

  const campanhasPermitidas = podeVerCampanhas ? campanhas : [];
  const progressoPermitido = podeVerCampanhas ? progresso : {};

  const items = [
    { id: 'dashboard', label: 'Início', icon: <I.Home /> },
    { id: 'vendas', label: 'Vendas', icon: <I.Chart />, permission: ['vendas', 'vendas_ver_proprias', 'vendas_ver_todas', 'vendas_criar', 'vendas_editar', 'vendas_excluir'] },
    { id: 'clientes', label: 'Clientes', icon: <I.Users />, permission: ['clientes_ver_proprios', 'clientes_ver_todos', 'clientes_criar', 'clientes_importar_planilhas', 'clientes_editar', 'clientes_excluir'] },
    { id: 'clientes-secretos', label: 'Qualificação de Leads', icon: <I.Shield />, permission: ['clientes_secretos_ver', 'clientes_secretos_ver_todos'] },
    { id: 'clientes-antigos', label: 'Busca de Clientes Antigos', icon: <I.Search />, permission: ['clientes_antigos_buscar', 'clientes_antigos_ver_historico'] },
    { id: 'futuros-clientes', label: 'Futuros Clientes', icon: <I.Calendar />, badge: counts?.futurosClientes, alert: counts?.futurosClientes > 0, permission: ['futuros_clientes_ver'] },
    { id: 'funil', label: 'Funil de Vendas', icon: <I.Funnel />, badge: counts?.active, permission: 'funil_vendas' },
    { id: 'funil-automacoes', label: 'Funil automações', icon: <I.Funnel />, permission: 'funil_automacoes' },
    { id: 'aprovacoes', label: 'Aprovações', icon: <I.Shield />, badge: counts?.aprovacoes, alert: counts?.aprovacoes > 0, permission: 'vendas_aprovacoes_visualizar' },
    { id: 'retornos', label: 'Retornos', icon: <I.Return />, badge: counts?.returns, permission: ['vendas_ver_proprias', 'vendas_ver_todas', 'ver_vendas_compartilhadas'] },
    { id: 'relatorios', label: 'Relatórios', icon: <I.Chart />, permission: 'relatorios_visualizar' },
    { id: 'historico', label: 'Histórico', icon: <I.History />, permission: 'historico_visualizar' },
    { id: 'mensagens', label: 'Mensagens', icon: <I.Chat />, badge: counts?.mensagens, permission: ['chat_usar', 'chat_visualizar_todas'] },
    { id: 'problemas', label: 'Problemas Pós-venda', icon: <I.Shield />, permission: 'problemas_pos_venda_responsavel' },
  ].filter(it => !it.permission || temPermissao(usuario, it.permission));

  const admin = [
    { id: 'usuarios', label: 'Usuários', icon: <I.Users />, permission: ['crud_usuarios', 'usuarios_listar', 'usuarios_criar', 'usuarios_editar', 'usuarios_excluir', 'gerenciar_permissoes'] },
    { id: 'config', label: 'Configurações', icon: <I.Settings />, permission: ['crud_operadoras', 'crud_links', 'crud_tipos_venda', 'crud_servicos', 'clientes_antigos_gerenciar', 'configurar_notificacoes', 'configurar_horario_acesso', 'configurar_acesso_rede'] },
    { id: 'campanhas', label: 'Configurar Campanhas', icon: <I.Settings />, permission: ['gerenciar_campanhas'] },
    { id: 'fechamento-mensal', label: 'Fechamento Mensal', icon: <I.Chart />, permission: 'vendas_fechamento_mensal' },
    { id: 'leads', label: 'Planilha de Mailing', icon: <I.LayoutList />, permission: 'gerenciar_leads' },
    { id: 'cruzar-vendas', label: 'Cruzar Vendas', icon: <I.TableSheet />, permission: 'vendas_cruzar' },
    { id: 'consultar-cnpj', label: 'Consultar CNPJ', icon: <I.Search />, permission: 'clientes_importar_planilhas' },
    { id: 'automacoes', label: 'Automações', icon: <I.Settings />, permission: 'automacoes_gerenciar' },
  ].filter(it => !it.permission || temPermissao(usuario, it.permission));

  /**
   * Retorna initials a partir dos dados informados.
   */
  const getInitials = (name) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  /**
   * Retorna campanha key a partir dos dados informados.
   */
  const getCampanhaKey = (campanha) => (
    campanha.tipo || `${campanha.periodo || 'diaria'}_${campanha.categoria || 'registro_cliente'}`
  );

  const idsVisiveis = Array.isArray(progressoPermitido.campanhas_visiveis)
    ? new Set(progressoPermitido.campanhas_visiveis.map(Number))
    : null;
  const giftCampanhas = campanhasPermitidas.filter(m => {
    const estadoPeriodo = progressoPermitido.estados_campanhas?.[m.id] || m.estado_periodo || 'ativa';
    return m.is_gift
      && estadoPeriodo !== 'encerrada'
      && (!m.participante_ids?.length || m.participante_ids.map(Number).includes(Number(usuario?.id)))
      && (!idsVisiveis || idsVisiveis.has(Number(m.id)));
  });
  const resgatadas = new Set((progressoPermitido.resgatadas || []).map(Number));

  return (
    <aside
      id="app-sidebar"
      className={`sidebar ${isMobileOpen ? 'is-open' : ''}`}
      aria-label="NavegaÃ§Ã£o principal"
    >
      <div className="sidebar-logo">
        <img src={logo} alt="Logo" className="sidebar-logo-img" />
        <button
          type="button"
          className="btn btn-icon btn-ghost sidebar-close-btn"
          aria-label="Fechar menu"
          onClick={onClose}
        >
          <I.Close size={15} />
        </button>
      </div>

      <div className="sidebar-scroll">
        {items.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Operação</div>
            {items.map(it => (
              <button
                key={it.id}
                className={`nav-item ${page === it.id ? 'active' : ''} ${it.alert ? 'nav-item--alert' : ''}`}
                onClick={() => setPage(it.id)}
              >
                <span className="icon">{it.icon}</span>
                <span>{it.label}</span>
                {it.badge != null && it.badge > 0 && <span className="badge">{it.badge}</span>}
              </button>
            ))}
          </div>
        )}

        {admin.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Administração</div>
            {admin.map(it => (
              <button
                key={it.id}
                className={`nav-item ${page === it.id ? 'active' : ''}`}
                onClick={() => setPage(it.id)}
              >
                <span className="icon">{it.icon}</span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
      {podeVerCampanhas && giftCampanhas.length > 0 && (
        <div className="sidebar-goals">
          <div className="header-row">
            <span className="title">Campanhas</span>
            <span className="count">{giftCampanhas.filter(m => {
              return resgatadas.has(Number(m.id));
            }).length}/{giftCampanhas.length}</span>
          </div>
          {giftCampanhas.map(campanha => {
            const detalhe = progresso.campanhas?.[campanha.id];
            const current = typeof detalhe === 'object' ? Number(detalhe.current || 0) : Number(detalhe ?? progresso[getCampanhaKey(campanha)] ?? 0);
            const target = Number(detalhe?.target ?? campanha.target) || 0;
            const pct = typeof detalhe === 'object' ? Number(detalhe.pct || 0) : (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0);
            const achieved = pct >= 100;
            const claimed = resgatadas.has(Number(campanha.id));
            const estadoPeriodo = progresso.estados_campanhas?.[campanha.id] || campanha.estado_periodo || 'ativa';
            const futura = estadoPeriodo === 'futura';
            return (
              <div
                key={campanha.id}
                className={`sidebar-goal ${achieved ? 'achieved' : ''} ${claimed ? 'claimed' : ''}`}
                title={`${futura ? 'Campanha em breve' : claimed ? 'Recompensa resgatada' : 'Recompensa ainda não resgatada'}${campanha.em_grupo ? ' · Meta em grupo' : ''}${campanha.operadora_nome ? ` - ${campanha.operadora_nome}` : ''}`}
              >
                <div className="top">
                  <span className="g-icon">{futura ? '📅' : claimed ? '✅' : '🎁'}</span>
                  <span className="g-name">{campanha.desc}</span>
                  <span className="g-pct">{futura ? 'Em breve' : `${pct}%`}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: achieved ? 'var(--success)' : 'var(--text)' }}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      <div className="sidebar-footer" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="user-card">
          <button
            className="user-card-info"
            onClick={onPerfilClick}
            title="Editar perfil"
            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', color: 'inherit' }}
          >
            <div className="avatar" style={{ overflow: 'hidden' }}>
              {usuario?.foto_perfil ? (
                <img
                  src={usuario.foto_perfil}
                  alt={usuario?.nome || 'Foto de perfil'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                getInitials(usuario?.nome)
              )}
            </div>
            <div className="user-info">
              <div className="user-name">{usuario?.nome || 'Usuário'}</div>
              <div className="user-email">{usuario?.email || 'Email nao informado'}</div>
              <div className="user-role">{usuario?.role?.nome || 'Perfil'}</div>
            </div>
          </button>
          <button
            className="btn-icon btn-ghost"
            title="Sair"
            onClick={onLogout}
          >
            <I.Logout size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
