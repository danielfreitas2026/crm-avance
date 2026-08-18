import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import {
  listarUsuarios,
  deletarUsuario,
  atualizarUsuario,
  buscarUsuarioPorId,
  listarPermissoes
} from '../../services/usuario.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  garantirPermissaoPosVenda as garantirPermissaoPosVendaCompartilhada,
  montarGruposPermissoes as montarGruposPermissoesCompartilhados,
  getPermissoesCopiaveis as getPermissoesCopiaveisCompartilhado,
  getPermissoesSelecionadasUsuario,
  montarPermissoesAdminParaSalvar
} from './permissoes';
import {
  CopiarPermissoesSelect,
  PermissaoGrupo as PermissaoGrupoCompartilhado
} from './permissoes.components';
import './Usuarios.css';

/**
 * Retorna permissoes iniciais a partir dos dados informados.
 */
function getPermissoesIniciais(usuario, permissoesDisponiveis = []) {
  return getPermissoesSelecionadasUsuario(usuario, permissoesDisponiveis);
}

/**
 * Processa modal permissoes conforme as regras do dominio.
 */
function ModalPermissoes({ usuarioId, usuarios, onClose, onSave }) {
  const [usuario, setUsuario] = useState(null);
  const [permissoes, setPermissoes] = useState([]);
  const [selecionadas, setSelecionadas] = useState([]);
  const [buscaPermissao, setBuscaPermissao] = useState('');
  const [usuarioOrigemId, setUsuarioOrigemId] = useState('');
  const [avisoCopia, setAvisoCopia] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    /**
     * Carrega  e atualiza o estado relacionado.
     */
    async function carregar() {
      try {
        const [usuarioData, permissoesData] = await Promise.all([
          buscarUsuarioPorId(usuarioId),
          listarPermissoes()
        ]);

        const permissoesCompletas = garantirPermissaoPosVendaCompartilhada(permissoesData);

        setUsuario(usuarioData);
        setPermissoes(permissoesCompletas);
        setSelecionadas(getPermissoesIniciais(usuarioData, permissoesCompletas));
      } catch {
        setErro('Erro ao carregar permissões do usuário.');
      } finally {
        setCarregando(false);
      }
    }

    carregar();
  }, [usuarioId]);

  /**
   * Alterna  no estado atual.
   */
  function toggle(chave, opcoes = {}) {
    setAvisoCopia('');
    setSelecionadas(prev => {
      const selecionada = prev.includes(chave);

      if (opcoes.grupoExclusivo) {
        const semGrupo = prev.filter(item => !opcoes.grupoExclusivo.includes(item));
        return selecionada ? semGrupo : [...semGrupo, chave];
      }

      return selecionada ? prev.filter(c => c !== chave) : [...prev, chave];
    });
  }

  /**
   * Alterna bloco no estado atual.
   */
  function toggleBloco(chaves, selecionar) {
    setAvisoCopia('');
    setSelecionadas(prev => {
      if (!selecionar) {
        return prev.filter(chave => !chaves.includes(chave));
      }

      return Array.from(new Set([...prev, ...chaves]));
    });
  }

  /**
   * Copia permissoes para o destino esperado.
   */
  function copiarPermissoes() {
    const usuarioOrigem = usuarios.find(item => String(item.id) === String(usuarioOrigemId));

    if (!usuarioOrigem) {
      setAvisoCopia('');
      return;
    }

    const proximasPermissoes = getPermissoesCopiaveisCompartilhado(usuarioOrigem, permissoes);
    setSelecionadas(proximasPermissoes);
    setAvisoCopia(`Permissões de ${usuarioOrigem.nome} copiadas. Revise e salve para aplicar.`);
  }

  /**
   * Trata o evento de save.
   */
  async function handleSave() {
    setSalvando(true);
    setErro('');

    try {
      const permissoesParaSalvar = usuario?.role?.nome === 'admin'
        ? montarPermissoesAdminParaSalvar(selecionadas, permissoes)
        : selecionadas;

      await onSave(usuarioId, permissoesParaSalvar);
      onClose();
    } catch (error) {
      setErro(error.message || 'Erro ao salvar permissões.');
      setSalvando(false);
    }
  }

  const gruposPermissoesCompartilhados = montarGruposPermissoesCompartilhados(permissoes);
  const termoBuscaPermissao = buscaPermissao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const gruposFiltrados = !termoBuscaPermissao ? gruposPermissoesCompartilhados : gruposPermissoesCompartilhados.map(grupo => ({ ...grupo, secoes: grupo.secoes.map(secao => ({ ...secao, itens: secao.itens.filter(item => [grupo.titulo, grupo.descricao, secao.titulo, item.chave, item.nome, item.descricao].some(texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(termoBuscaPermissao))) })).filter(secao => secao.itens.length > 0) })).filter(grupo => grupo.secoes.length > 0);
  const totalSelecionadas = selecionadas.length;
  const usuariosOrigem = usuarios.filter(item => Number(item.id) !== Number(usuarioId));

  return (
    <div
      className="permissions-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel permissions-modal">
        <div className="panel-header permissions-modal__header">
          <div>
            <h3 style={{ margin: 0 }}>Gerenciar permissões</h3>
            {usuario && (
              <div className="permissions-modal__sub">
                {usuario.nome} · {totalSelecionadas} permissões selecionadas
              </div>
            )}
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <I.Close size={14} />
          </button>
        </div>

        <div className="panel-body permissions-modal__body">
          {carregando ? (
            <div className="muted" style={{ textAlign: 'center', padding: '24px 0', fontSize: 13 }}>
              Carregando...
            </div>
          ) : erro && !usuario ? (
            <div style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</div>
          ) : (
            <>
              <div className="permissions-copy">
                <div className="permissions-copy__field">
                  <label>Copiar permissões de</label>
                  <CopiarPermissoesSelect
                    value={usuarioOrigemId}
                    onChange={setUsuarioOrigemId}
                    options={usuariosOrigem.map(item => ({
                      value: item.id,
                      label: `${item.nome} - ${item.role?.nome || 'Sem perfil'}`,
                    }))}
                  />
                </div>
                <button className="btn" type="button" onClick={copiarPermissoes} disabled={!usuarioOrigemId}>
                  <I.Users size={14} /> Copiar
                </button>
              </div>

              {avisoCopia && <div className="permissions-copy__notice">{avisoCopia}</div>}

              <div className="permissions-search">
                <I.Search size={15} aria-hidden="true" />
                <input type="search" value={buscaPermissao} onChange={(event) => setBuscaPermissao(event.target.value)} placeholder="Buscar permissão" aria-label="Buscar permissão" />
              </div>

              <div className="permissions-grid">
                {gruposFiltrados.map(grupo => (
                  <PermissaoGrupoCompartilhado
                    key={grupo.id}
                    grupo={grupo}
                    selecionadas={selecionadas}
                    onToggle={toggle}
                    onToggleBloco={toggleBloco}
                  />
                ))}

                {termoBuscaPermissao && gruposFiltrados.length === 0 && (
                  <div className="permissions-search__empty">Nenhuma permissão encontrada.</div>
                )}
              </div>

              {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12 }}>{erro}</div>}

              <div className="permissions-modal__footer">
                <button className="btn" onClick={onClose}>Cancelar</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar permissões'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Processa usuarios conforme as regras do dominio.
 */
function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [deletando, setDeletando] = useState(null);
  const [gerenciandoId, setGerenciandoId] = useState(null);
  const navigate = useNavigate();

  const usuarioLogado = getUsuarioLocal();
  const podeGerenciarPermissoes = temPermissao(usuarioLogado, 'gerenciar_permissoes');
  const podeCriarUsuarios = temPermissao(usuarioLogado, 'usuarios_criar');
  const podeEditarUsuarios = temPermissao(usuarioLogado, 'usuarios_editar');
  const podeExcluirUsuarios = temPermissao(usuarioLogado, 'usuarios_excluir');
  const usuarioLogadoEhAdmin = usuarioLogado?.role?.nome === 'admin';
  const podeMostrarAcoesUsuarios = podeEditarUsuarios || podeGerenciarPermissoes || podeExcluirUsuarios;

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  useEffect(() => {
    if (!erro) return undefined;
    const timer = setTimeout(() => setErro(''), 6000);
    return () => clearTimeout(timer);
  }, [erro]);

  useEffect(() => {
    /**
     * Carrega usuarios e atualiza o estado relacionado.
     */
    async function carregarUsuarios() {
      try {
        const dados = await listarUsuarios();
        setUsuarios(dados);
      } catch {
        setErro('Erro ao carregar usuários.');
      } finally {
        setCarregando(false);
      }
    }

    carregarUsuarios();
  }, []);

  /**
   * Trata o evento de delete.
   */
  async function handleDelete(u) {
    if (deletando === u.id) {
      try {
        await deletarUsuario(u.id);
        setUsuarios(prev => prev.filter(x => x.id !== u.id));
        setSucesso('Usuário excluído com sucesso.');
      } catch (error) {
        setErro(error.message || 'Erro ao excluir usuário.');
      } finally {
        setDeletando(null);
      }
    } else {
      setDeletando(u.id);
    }
  }

  /**
   * Trata o evento de save permissoes.
   */
  async function handleSavePermissoes(id, permissoesSelecionadas) {
    await atualizarUsuario(id, {
      permissoes: permissoesSelecionadas
    });
    setUsuarios(prev =>
      prev.map(u => u.id === id ? { ...u, permissoes: permissoesSelecionadas } : u)
    );

    if (Number(usuarioLogado?.id) === Number(id)) {
      localStorage.setItem('usuario', JSON.stringify({
        ...usuarioLogado,
        permissoes: permissoesSelecionadas
      }));
    }

    setSucesso('Permissões atualizadas com sucesso.');
  }

  /**
   * Retorna initials a partir dos dados informados.
   */
  const getInitials = (name) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  return (
    <LayoutPrivado>
      {gerenciandoId !== null && (
        <ModalPermissoes
          usuarioId={gerenciandoId}
          usuarios={usuarios}
          onClose={() => setGerenciandoId(null)}
          onSave={handleSavePermissoes}
        />
      )}

      <div className="users-page">
        <div className="users-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {usuarios.length} usuários · {usuarios.filter(u => u.ativo).length} ativos
          </div>
          {podeCriarUsuarios && (
            <button className="btn btn-primary users-add-btn" onClick={() => navigate('/usuarios/novo')}>
              <I.Plus size={14} /> Adicionar usuário
            </button>
          )}
        </div>

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erro}</div>}

        <div className="list-table" style={{ margin: 0 }}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  {podeMostrarAcoesUsuarios && <th></th>}
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={podeMostrarAcoesUsuarios ? 5 : 4} style={{ textAlign: 'center', padding: '40px' }} className="muted">
                      Carregando usuários...
                    </td>
                  </tr>
                ) : usuarios.length === 0 ? (
                  <tr>
                    <td colSpan={podeMostrarAcoesUsuarios ? 5 : 4} style={{ textAlign: 'center', padding: '40px' }} className="muted">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  usuarios.map(u => (
                    <tr key={u.id}>
                      <td data-label="Usuario" className="m-primary">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="avatar" style={{ width: 28, height: 28, fontSize: 11, overflow: 'hidden' }}>
                            {u.foto_perfil ? (
                              <img
                                src={u.foto_perfil}
                                alt={u.nome || 'Foto de perfil'}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              getInitials(u.nome)
                            )}
                          </span>
                          <span style={{ fontWeight: 500 }}>{u.nome}</span>
                        </div>
                        <details className="mobile-row-drawer">
                          <summary>Ver dados do usuario</summary>
                          <dl>
                            <dt>E-mail</dt>
                            <dd>{u.email}</dd>
                            <dt>Perfil</dt>
                            <dd>{u.role?.nome || 'Nenhum'}</dd>
                          </dl>
                        </details>
                      </td>
                      <td data-label="E-mail" className="muted m-secondary">{u.email}</td>
                      <td data-label="Perfil" data-mobile-hidden="true"><span className="tag">{u.role?.nome || 'Nenhum'}</span></td>
                      <td data-label="Status" className="m-meta">
                        <span className={`pill ${u.ativo ? 'success' : ''}`}>
                          <span className="pill-dot"></span>
                          {u.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      {podeMostrarAcoesUsuarios && (
                        <td data-label="Acoes" className="row-actions m-actions">
                          {podeEditarUsuarios && (
                            <button className="btn btn-icon btn-ghost users-edit-btn" title="Editar" onClick={() => navigate(`/usuarios/${u.id}/editar`)}>
                              <I.Edit size={13} />
                            </button>
                          )}

                          {podeGerenciarPermissoes && (
                            <button className="btn btn-sm btn-ghost users-permissions-btn" onClick={() => setGerenciandoId(u.id)}>
                              Gerenciar permissões
                            </button>
                          )}

                          {podeExcluirUsuarios && Number(usuarioLogado?.id) !== Number(u.id) && (usuarioLogadoEhAdmin || u.role?.nome !== 'admin') && deletando === u.id ? (
                            <>
                              <button
                                className="btn btn-sm"
                                style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 11 }}
                                onClick={() => handleDelete(u)}
                              >
                                Confirmar
                              </button>
                              <button className="btn btn-sm btn-ghost" onClick={() => setDeletando(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : podeExcluirUsuarios && Number(usuarioLogado?.id) !== Number(u.id) && (usuarioLogadoEhAdmin || u.role?.nome !== 'admin') ? (
                            <button className="btn btn-icon btn-ghost btn-danger-icon users-delete-btn" title="Excluir" onClick={() => handleDelete(u)}>
                              <I.Trash size={13} />
                            </button>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default Usuarios;

