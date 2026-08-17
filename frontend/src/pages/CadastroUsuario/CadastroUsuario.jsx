import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { criarUsuario, listarPermissoes, listarUsuarios } from '../../services/usuario.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import * as I from '../../components/Icons';
import {
  garantirPermissaoPosVenda as garantirPermissaoPosVendaCompartilhada,
  montarGruposPermissoes as montarGruposPermissoesCompartilhados,
  montarPermissoesAdminParaSalvar,
  PERMISSOES_ADMIN_EXPLICITAS,
  getPermissoesCopiaveis
} from '../Usuarios/permissoes';
import {
  CopiarPermissoesSelect,
  PermissaoGrupo as PermissaoGrupoCompartilhado
} from '../Usuarios/permissoes.components';
import '../Usuarios/Usuarios.css';
import './CadastroUsuario.css';

/**
 * Processa cadastro usuario conforme as regras do dominio.
 */
function CadastroUsuario() {
  const navigate = useNavigate();

  const usuarioLogado = getUsuarioLocal();
  const podeGerenciarPermissoes = temPermissao(usuarioLogado, 'gerenciar_permissoes');

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [roleId, setRoleId] = useState(2);
  const [permissoes, setPermissoes] = useState([]);
  const [permissoesSelecionadas, setPermissoesSelecionadas] = useState([]);
  const [usuariosOrigem, setUsuariosOrigem] = useState([]);
  const [usuarioOrigemId, setUsuarioOrigemId] = useState('');
  const [avisoCopia, setAvisoCopia] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [carregando, setCarregando] = useState(false);

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
     * Carrega permissoes e atualiza o estado relacionado.
     */
    async function carregarPermissoes() {
      if (!podeGerenciarPermissoes) {
        setPermissoes([]);
        setPermissoesSelecionadas([]);
        setRoleId(2);
        return;
      }

      try {
        const [permissoesData, usuariosData] = await Promise.all([
          listarPermissoes(),
          listarUsuarios().catch(() => [])
        ]);
        setPermissoes(garantirPermissaoPosVendaCompartilhada(permissoesData));
        setUsuariosOrigem(usuariosData || []);
      } catch (error) {
        setErro(error.message || 'Erro ao carregar permissões.');
      }
    }

    carregarPermissoes();
  }, [podeGerenciarPermissoes]);

  /**
   * Copia permissoes de usuario para o destino esperado.
   */
  function copiarPermissoesDeUsuario() {
    const usuarioOrigem = usuariosOrigem.find(item => String(item.id) === String(usuarioOrigemId));
    if (!usuarioOrigem) {
      setAvisoCopia('');
      return;
    }
    const proximas = getPermissoesCopiaveis(usuarioOrigem, permissoes);
    setPermissoesSelecionadas(proximas);
    setAvisoCopia(`Permissões de ${usuarioOrigem.nome} copiadas. Revise antes de cadastrar.`);
  }

  /**
   * Alterna permissao no estado atual.
   */
  function togglePermissao(chave, opcoes = {}) {
    setPermissoesSelecionadas(prev => {
      const selecionada = prev.includes(chave);

      if (opcoes.grupoExclusivo) {
        const semGrupo = prev.filter(item => !opcoes.grupoExclusivo.includes(item));
        return selecionada ? semGrupo : [...semGrupo, chave];
      }

      return selecionada ? prev.filter(c => c !== chave) : [...prev, chave];
    });
  }

  /**
   * Alterna bloco permissoes no estado atual.
   */
  function toggleBlocoPermissoes(chaves, selecionar) {
    setPermissoesSelecionadas(prev => {
      if (!selecionar) {
        return prev.filter(chave => !chaves.includes(chave));
      }

      return Array.from(new Set([...prev, ...chaves]));
    });
  }

  const gruposPermissoes = useMemo(() => montarGruposPermissoesCompartilhados(permissoes), [permissoes]);

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');
    setSucesso('');
    setCarregando(true);

    try {
      const dados = {
        nome,
        email,
        senha,
        role_id: podeGerenciarPermissoes ? Number(roleId) : 2
      };

      if (podeGerenciarPermissoes) {
        dados.permissoes = Number(roleId) === 1
          ? montarPermissoesAdminParaSalvar(permissoesSelecionadas, permissoes)
          : permissoesSelecionadas;
      }

      await criarUsuario(dados);
      setSucesso('Usuário cadastrado com sucesso. Redirecionando...');
      setTimeout(() => navigate('/usuarios'), 800);
    } catch (error) {
      setErro(error.message || 'Erro ao cadastrar usuário.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <LayoutPrivado>
      <div className="users-page cadastro-usuario-page">
        <div className="panel">
          <div className="panel-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn-icon btn-ghost" onClick={() => navigate('/usuarios')}>
                <I.ArrowRight style={{ transform: 'rotate(180deg)' }} />
              </button>
              Novo Usuário
            </h3>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSubmit}>
              <div className="form-field">
                <label>Nome Completo</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Joao Silva"
                  required
                />
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="joao@empresa.com"
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Senha</label>
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="********"
                    required
                  />
                </div>
              </div>

              {podeGerenciarPermissoes ? (
                <>
                  <div className="form-field">
                    <label htmlFor="role">Funcao</label>
                    <select
                      id="role"
                      value={roleId}
                      onChange={(event) => {
                        const novaRoleId = Number(event.target.value);
                        setRoleId(novaRoleId);

                        if (novaRoleId === 1) {
                          setPermissoesSelecionadas(permissoes
                            .map(permissao => permissao.chave)
                            .filter(chave => !PERMISSOES_ADMIN_EXPLICITAS.has(chave)));
                        }
                      }}
                    >
                      <option value={2}>Usuário Comum</option>
                      <option value={1}>Administrador</option>
                    </select>
                  </div>

                  <div className="cadastro-usuario__permissions">
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', marginBottom: 8 }}>
                      Permissoes de acesso
                    </div>

                    {Number(roleId) !== 1 && usuariosOrigem.length > 0 && (
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
                          <button
                            className="btn"
                            type="button"
                            onClick={copiarPermissoesDeUsuario}
                            disabled={!usuarioOrigemId}
                          >
                            <I.Users size={14} /> Copiar
                          </button>
                        </div>
                        {avisoCopia && <div className="permissions-copy__notice">{avisoCopia}</div>}
                      </>
                    )}

                    <div className="cadastro-usuario__permissions-grid permissions-grid">
                      {permissoes.length === 0 ? (
                        <div className="muted" style={{ fontSize: 13 }}>
                          Nenhuma permissão disponível.
                        </div>
                      ) : (
                        gruposPermissoes.map(grupo => (
                          <PermissaoGrupoCompartilhado
                            key={grupo.id}
                            grupo={grupo}
                            selecionadas={permissoesSelecionadas}
                            onToggle={togglePermissao}
                            onToggleBloco={toggleBlocoPermissoes}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text-2)', marginTop: 20 }}>
                  Você pode cadastrar usuários, mas não pode definir permissões.
                </div>
              )}

              {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginTop: 16 }}>{sucesso}</div>}
              {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginTop: 16 }}>{erro}</div>}

              <div style={{ marginTop: '24px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => navigate('/usuarios')}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={carregando}>
                  {carregando ? 'Salvando...' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default CadastroUsuario;

