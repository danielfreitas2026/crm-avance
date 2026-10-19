import { useEffect, useRef, useState } from 'react';
import * as I from '../Icons';
import { listarLinksExternos } from '../../services/config.service';
import { filtrarNotificacoes, intervaloNotificacoesInvalido, nomeTipoNotificacao } from './notificacao-filtros';

/**
 * Renderiza header.
 */
function Header({ title, subtitle, onNew, onMenuClick, mobileMenuOpen = false, alertasUrgentes = [], estiloAlerta, tomAlerta, onAbrirAlerta, onExcluirAlerta, onMarcarTodasLidas, marcandoTodasLidas = false, erroMarcarTodasLidas = '' }) {
  const [linksExternos, setLinksExternos] = useState([]);
  const [linksOpen, setLinksOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [filtros, setFiltros] = useState({ busca: '', tipo: '', de: '', ate: '' });
  const notificacoesFiltradas = filtrarNotificacoes(alertasUrgentes, filtros);
  const temFiltros = Object.values(filtros).some(Boolean);
  const intervaloInvalido = intervaloNotificacoesInvalido(filtros);
  const tipos = [...new Set([...alertasUrgentes.map(item => item.tipo), filtros.tipo].filter(Boolean))]
    .sort((a, b) => nomeTipoNotificacao(a).localeCompare(nomeTipoNotificacao(b), 'pt-BR'));
  function alterarFiltro(event) {
    const { name, value } = event.target;
    setFiltros(atuais => ({ ...atuais, [name]: value }));
  }
  const linksMenuRef = useRef(null);
  const notificationsMenuRef = useRef(null);

  useEffect(() => {
    /**
     * Carrega links e atualiza o estado relacionado.
     */
    async function carregarLinks() {
      try {
        const dados = await listarLinksExternos();
        if (Array.isArray(dados) && dados.length > 0) {
          setLinksExternos(dados.map(link => ({
            id: link.chave || link.id,
            name: link.nome,
            url: link.url,
            dot: link.dot,
            cor: link.cor
          })));
        } else {
          setLinksExternos([
            { id: 'gov', name: 'Receita Federal', url: 'https://www.gov.br/receitafederal/', dot: 'gov' },
            { id: 'vivo', name: 'Vivo Empresas', url: 'https://www.vivo.com.br/empresas/', dot: 'vivo' },
            { id: 'tim', name: 'TIM Empresas', url: 'https://www.tim.com.br/empresas/', dot: 'tim' },
            { id: 'claro', name: 'Claro Empresas', url: 'https://www.claro.com.br/empresas/', dot: 'claro' },
          ]);
        }
      } catch {
        setLinksExternos([]);
      }
    }

    carregarLinks();
  }, []);

  useEffect(() => {
    /**
     * Trata o evento de click outside.
     */
    function handleClickOutside(event) {
      if (linksMenuRef.current && !linksMenuRef.current.contains(event.target)) {
        setLinksOpen(false);
      }

      if (notificationsMenuRef.current && !notificationsMenuRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="header">
      {onMenuClick && (
        <button
          type="button"
          className="btn btn-icon btn-ghost header-menu-btn"
          aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-controls="app-sidebar"
          aria-expanded={mobileMenuOpen}
          onClick={onMenuClick}
        >
          {mobileMenuOpen ? <I.Close size={16} /> : <I.Menu size={16} />}
        </button>
      )}

      <div className="header-info">
        <div className="header-title">{title}</div>
        {subtitle && <div className="header-subtitle">{subtitle}</div>}
      </div>

      <div className="header-actions">
        

        {linksExternos.length > 0 && (
          <div className="external-links-menu" ref={linksMenuRef}>
            <button
              type="button"
              className="btn btn-secondary btn-links"
              onClick={() => setLinksOpen(open => !open)}
              aria-expanded={linksOpen}
              aria-haspopup="menu"
            >
              <I.External size={14} />
              <span>Links uteis</span>
              <I.ChevronDown size={12} className={`chevron ${linksOpen ? 'is-open' : ''}`} />
            </button>

            {linksOpen && (
              <div className="external-links-popover" role="menu">
                {linksExternos.map(link => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`external-link external-link--${link.dot || 'gov'}${link.cor ? ' external-link--custom-color' : ''}`}
                    style={link.cor ? { '--link-color': link.cor } : undefined}
                    title={`Abrir ${link.name}`}
                    role="menuitem"
                    onClick={() => setLinksOpen(false)}
                  >
                    <span className={`dot ${link.dot || 'gov'}`} style={link.cor ? { backgroundColor: link.cor } : undefined}></span>
                    <span>{link.name}</span>
                    <I.External size={11} style={{ opacity: 0.5 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="notification-menu" ref={notificationsMenuRef}>
          <button
            type="button"
            className="btn btn-ghost btn-notification btn-notification--urgent"
            title="Exibir avisos pendentes"
            onClick={() => setNotificationsOpen(open => !open)}
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
            aria-controls="avisos-pendentes-painel"
          >
            <span className={`notification-bell${alertasUrgentes.length > 0 ? ' notification-bell--urgent' : ''}`}>
              {alertasUrgentes.length > 0 && <span className="urgent-alert-panel__pulse" aria-hidden="true" />}
              <I.Bell size={16} />
            </span>
            <strong>{alertasUrgentes.length} {alertasUrgentes.length === 1 ? 'aviso pendente' : 'avisos pendentes'}</strong>
            <span className="btn-notification__show-label">Exibir</span>
            <I.ChevronDown size={10} className={`chevron ${notificationsOpen ? 'is-open' : ''}`} />
          </button>

          {notificationsOpen && (
            <section id="avisos-pendentes-painel" className={`notification-popover notification-popover--urgent${alertasUrgentes.length > 0 ? ' notification-popover--attention' : ''}`} role="dialog" aria-label="Avisos pendentes" onKeyDown={event => {
              if (event.key === 'Escape') {
                setNotificationsOpen(false);
                notificationsMenuRef.current?.querySelector('button')?.focus();
              }
            }}>
              <div className="notification-popover__header">
                <span className="notification-popover__icon" aria-hidden="true"><I.Bell size={20} /></span>
                <div className="notification-popover__heading">
                  <strong className="notification-popover__urgent-title">Avisos pendentes</strong>
                  <span className="notification-popover__subtitle">Acompanhe o que precisa da sua atenção.</span>
                </div>
                <span className="notification-popover__count" aria-live="polite">{temFiltros ? `${notificacoesFiltradas.length} de ${alertasUrgentes.length} avisos` : `${alertasUrgentes.length} ${alertasUrgentes.length === 1 ? 'aviso' : 'avisos'}`}</span>
              </div>

              <div className="notification-filters">
                <label className="notification-filters__search">Buscar notificações
                  <input type="search" name="busca" value={filtros.busca} onChange={alterarFiltro} placeholder="Título ou mensagem" />
                </label>
                <label>Tipo
                  <select name="tipo" value={filtros.tipo} onChange={alterarFiltro}>
                    <option value="">Todos os tipos</option>
                    {tipos.map(tipo => <option key={tipo} value={tipo}>{nomeTipoNotificacao(tipo)}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!temFiltros} onClick={() => setFiltros({ busca: '', tipo: '', de: '', ate: '' })}>Limpar filtros</button>
                <div className="notification-filters__dates">
                  <label>De<input type="date" name="de" value={filtros.de} onChange={alterarFiltro} aria-invalid={intervaloInvalido} aria-describedby={intervaloInvalido ? 'avisos-periodo-erro' : undefined} /></label>
                  <label>Até<input type="date" name="ate" value={filtros.ate} onChange={alterarFiltro} aria-invalid={intervaloInvalido} aria-describedby={intervaloInvalido ? 'avisos-periodo-erro' : undefined} /></label>
                </div>
                {intervaloInvalido && <p id="avisos-periodo-erro" className="notification-filters__error" role="alert">A data inicial deve ser anterior ou igual à data final.</p>}
              </div>

              <div className="notification-bulk-actions">
                <button type="button" className="btn btn-secondary btn-sm" disabled={marcandoTodasLidas || alertasUrgentes.length === 0 || !onMarcarTodasLidas} onClick={onMarcarTodasLidas}>
                  {marcandoTodasLidas ? 'Marcando…' : 'Marcar todas como lidas'}
                </button>
                <span>Inclui todos os avisos pendentes, mesmo com filtros ativos.</span>
                {erroMarcarTodasLidas && <p className="notification-filters__error" role="alert">{erroMarcarTodasLidas}</p>}
              </div>

              {alertasUrgentes.length === 0 ? (
                <div className="notification-empty" role="status">
                  <span className="notification-empty__icon" aria-hidden="true"><I.Check size={26} /></span>
                  <strong>Tudo em dia!</strong>
                  <span>Nenhuma notificação ativa.</span>
                  <span>Novos avisos aparecerão aqui.</span>
                </div>
              ) : notificacoesFiltradas.length === 0 ? (
                <div className="notification-empty" role="status">Nenhuma notificação encontrada para os filtros informados.</div>
              ) : (
                <div className="urgent-alert-stack header-urgent-alert-stack" aria-live="polite">
                  {notificacoesFiltradas.map(alerta => (
                    <div key={alerta.destinatario_id || alerta.id} className={`urgent-alert-card urgent-alert-card--${tomAlerta?.(alerta) || 'danger'}`} style={estiloAlerta?.(alerta)}>
                      <div className="urgent-alert-card__icon"><I.AlertTriangle size={18} /></div>
                      <div className="urgent-alert-card__body">
                        <strong>{alerta.titulo}</strong>
                        <span>{alerta.mensagem}</span>
                      </div>
                      <div className="urgent-alert-card__actions">
                        <button type="button" className="btn btn-sm" onClick={() => { setNotificationsOpen(false); onAbrirAlerta?.(alerta); }}>
                          {['lead_retorno_pre', 'lead_retorno_due', 'futuro_cliente_retorno_pre', 'futuro_cliente_retorno_due', 'futuro_cliente_distribuido'].includes(alerta.tipo) ? 'Atender agora' : (alerta.entidade === 'clientes' ? 'Abrir cliente' : 'Abrir')}
                        </button>
                        <button type="button" className="btn btn-icon btn-ghost urgent-alert-card__close" onClick={() => onExcluirAlerta?.(alerta)} title="Excluir notificação" aria-label="Excluir notificação">
                          <I.Close size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {onNew && (
          <button type="button" className="btn btn-primary btn-new-sale" onClick={onNew}>
            <I.Plus size={14} /> Nova venda
          </button>
        )}
      </div>
    </header>
  );
}

export default Header;
