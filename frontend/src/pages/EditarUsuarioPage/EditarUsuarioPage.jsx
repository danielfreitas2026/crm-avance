import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import Botao from '../../components/Botao/Botao';
import CampoTexto from '../../components/CampoTexto/CampoTexto';
import Card from '../../components/Card/Card';
import SenhaAtual from './SenhaAtual';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';

import {
  atualizarUsuario,
  buscarUsuarioPorId,
  listarPermissoes
} from '../../services/usuario.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  getPermissoesSelecionadasUsuario,
  montarGruposPermissoes,
  montarPermissoesAdminParaSalvar,
  PERMISSOES_ADMIN_EXPLICITAS
} from '../Usuarios/permissoes';
import { PermissaoGrupo } from '../Usuarios/permissoes.components';

import '../Usuarios/Usuarios.css';
import './EditarUsuarioPage.css';

const PERMISSAO_POS_VENDA = {
  chave: 'pos_venda',
  nome: 'Pós-venda',
  descricao: 'Permite editar vendas enviadas ao pós-venda e movimentar vendas no funil.'
};

/**
 * Garante permissao pos venda antes de continuar o fluxo.
 */
function garantirPermissaoPosVenda(permissoes = []) {
  if (permissoes.some(permissao => permissao.chave === PERMISSAO_POS_VENDA.chave)) {
    return permissoes;
  }

  return [...permissoes, PERMISSAO_POS_VENDA];
}

/**
 * Renderiza editar usuario page.
 */
function EditarUsuarioPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false);
  const [roleId, setRoleId] = useState(2);
  const [roleIdOriginal, setRoleIdOriginal] = useState(2);
  const [ativo, setAtivo] = useState(true);

  const [permissoes, setPermissoes] = useState([]);
  const [permissoesSelecionadas, setPermissoesSelecionadas] = useState([]);

  const [podeGerenciarPermissoes, setPodeGerenciarPermissoes] = useState(false);

  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [dadosOriginais, setDadosOriginais] = useState(null);

  const isAdminEditado = Number(roleId) === 1;
  const usuarioLogado = getUsuarioLocal();
  const podeVisualizarSenha = temPermissao(usuarioLogado, 'usuarios_editar') &&
    (Number(roleIdOriginal) !== 1 || usuarioLogado?.role?.nome === 'admin');
  const iniciaisUsuario = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase() || 'U';

  useEffect(() => {
    /**
     * Carrega dados e atualiza o estado relacionado.
     */
    async function carregarDados() {
      try {
        const usuarioLogado = getUsuarioLocal();
        const podeEditarPermissoes = temPermissao(usuarioLogado, 'gerenciar_permissoes');

        setPodeGerenciarPermissoes(podeEditarPermissoes);

        const usuarioPromise = buscarUsuarioPorId(id);
        const permissoesPromise = podeEditarPermissoes ? listarPermissoes() : Promise.resolve([]);
        const [usuarioData, permissoesData] = await Promise.all([usuarioPromise, permissoesPromise]);

        const roleAtual = Number(usuarioData.role_id);

        const nomeVal = usuarioData.nome || '';
        const emailVal = usuarioData.email || '';
        const ativoVal = Boolean(usuarioData.ativo);
        const permissoesCompletas = garantirPermissaoPosVenda(permissoesData);
        const permissoesSelecionadasParsed = getPermissoesSelecionadasUsuario(usuarioData, permissoesCompletas);

        const originais = {
          nome: nomeVal,
          email: emailVal,
          roleId: roleAtual,
          ativo: ativoVal,
          permissoes: [...permissoesSelecionadasParsed]
        };

        setMostrarNovaSenha(false);
        setNome(nomeVal);
        setEmail(emailVal);
        setRoleId(roleAtual);
        setRoleIdOriginal(roleAtual);
        setAtivo(ativoVal);
        setPermissoes(permissoesCompletas);
        setPermissoesSelecionadas(permissoesSelecionadasParsed);
        setDadosOriginais(originais);
      } catch (error) {
        setErro(error.message);
      } finally {
        setCarregando(false);
      }
    }

    carregarDados();
  }, [id]);

  /**
   * Trata o evento de permissao change.
   */
  function handlePermissaoChange(chave, opcoes = {}) {
    setPermissoesSelecionadas((atuais) => {
      if (opcoes.grupoExclusivo) {
        const semGrupo = atuais.filter(item => !opcoes.grupoExclusivo.includes(item));
        return atuais.includes(chave) ? semGrupo : [...semGrupo, chave];
      }

      if (atuais.includes(chave)) {
        return atuais.filter((item) => item !== chave);
      }

      return [...atuais, chave];
    });
  }

  /**
   * Trata o evento de bloco permissoes change.
   */
  function handleBlocoPermissoesChange(chaves, selecionar) {
    setPermissoesSelecionadas((atuais) => {
      if (!selecionar) {
        return atuais.filter(chave => !chaves.includes(chave));
      }

      return Array.from(new Set([...atuais, ...chaves]));
    });
  }

  // Calcula as mudancas sem causar re-renders
  const mudancas = useMemo(() => {
    if (!dadosOriginais) return {};

    const m = {};

    if (nome !== dadosOriginais.nome) m.nome = true;
    if (email !== dadosOriginais.email) m.email = true;
    if (ativo !== dadosOriginais.ativo) m.ativo = true;
    if (senha.trim() !== '') m.senha = true;

    if (podeGerenciarPermissoes) {
      if (Number(roleId) !== dadosOriginais.roleId) m.roleId = true;
      const permissoesOriginais = new Set(dadosOriginais.permissoes);
      const permissoesAtuais = new Set(permissoesSelecionadas);
      if (permissoesOriginais.size !== permissoesAtuais.size ||
          [...permissoesOriginais].some(p => !permissoesAtuais.has(p))) {
        m.permissoes = true;
      }
    }

    return m;
  }, [nome, email, ativo, senha, roleId, permissoesSelecionadas, dadosOriginais, podeGerenciarPermissoes]);

  const temMudancas = Object.keys(mudancas).length > 0;
  const totalMudancas = Object.keys(mudancas).length;
  const totalPermissoesSelecionadas = permissoesSelecionadas.length;
  const gruposPermissoes = useMemo(() => montarGruposPermissoes(permissoes), [permissoes]);
  const feedback = erro
    ? { tipo: 'error', texto: erro, Icone: I.AlertTriangle }
    : sucesso
      ? { tipo: 'success', texto: sucesso, Icone: I.Check }
      : null;

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

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();

    if (!temMudancas) {
      setErro('Nenhuma alteração foi feita.');
      return;
    }

    setErro('');
    setSucesso('');
    setSalvando(true);
    setMostrarNovaSenha(false);

    try {
      const dados = {
        nome,
        email,
        ativo
      };

      if (senha.trim() !== '') {
        dados.senha = senha;
      }

      if (podeGerenciarPermissoes) {
        dados.role_id = Number(roleId);
        dados.permissoes = isAdminEditado
          ? montarPermissoesAdminParaSalvar(permissoesSelecionadas, permissoes)
          : permissoesSelecionadas;
      } else {
        dados.role_id = roleIdOriginal;
      }

      await atualizarUsuario(id, dados);

      const usuarioLogado = getUsuarioLocal();
      if (Number(usuarioLogado?.id) === Number(id) && dados.permissoes !== undefined) {
        localStorage.setItem('usuario', JSON.stringify({
          ...usuarioLogado,
          permissoes: dados.permissoes
        }));
      }

      setSucesso('Usuário atualizado com sucesso!');
      setSenha('');
      setDadosOriginais({
        nome,
        email,
        roleId: Number(roleId),
        ativo,
        permissoes: [...permissoesSelecionadas]
      });

    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <LayoutPrivado>
        <div className="editar-usuario-page">
          <Card className="editar-usuario-card">
            <div className="editar-usuario__loading">Carregando usuário...</div>
          </Card>
        </div>
      </LayoutPrivado>
    );
  }

  return (
    <LayoutPrivado>
      <div className="editar-usuario-page">
        <Card className="editar-usuario-card">
        <div className="editar-usuario__header">
          <div className="editar-usuario__identity">
            <button
              type="button"
              className="btn btn-icon btn-ghost editar-usuario__back"
              onClick={() => navigate('/usuarios')}
              aria-label="Voltar para usuários"
              title="Voltar"
            >
              <I.ArrowRight style={{ transform: 'rotate(180deg)' }} />
            </button>

            <div className="editar-usuario__avatar">{iniciaisUsuario}</div>

            <div>
              <h1 className="editar-usuario__title">Editar usuário</h1>
              <p className="editar-usuario__subtitle">
                Atualize dados de acesso, status e permissões.
              </p>
            </div>
          </div>

          <div className="editar-usuario__summary">
            <span className={`pill ${ativo ? 'success' : 'danger'}`}>
              <span className="pill-dot"></span>
              {ativo ? 'Ativo' : 'Inativo'}
            </span>
            <span className="pill">
              <I.Shield size={13} />
              {Number(roleId) === 1 ? 'Administrador' : 'Usuário comum'}
            </span>
            {temMudancas && (
              <span className="pill warn">
                <span className="pill-dot"></span>
                {totalMudancas} alteração{totalMudancas > 1 ? 'es' : ''}
              </span>
            )}
          </div>
        </div>

        {feedback && (
          <div
            className={`editar-usuario__message editar-usuario__message--${feedback.tipo} alert-timed alert-timed--${feedback.tipo}`}
            aria-hidden="true"
          >
            <feedback.Icone className="editar-usuario__message-icon" size={15} />
            {feedback.texto}
          </div>
        )}

        {temMudancas && !erro && !sucesso && (
          <div className="editar-usuario__changes-indicator">
            <span className="editar-usuario__changes-dot"></span>
            Alterações não salvas
          </div>
        )}

        <form className="editar-usuario__form" onSubmit={handleSubmit}>
          <section className="editar-usuario__section">
            <div className="editar-usuario__section-header">
              <div>
                <h2>Dados do usuário</h2>
                <p>Informações usadas para identificação e login.</p>
              </div>
            </div>

            <div className="editar-usuario__form-grid">
              <div className={`editar-usuario__field-wrapper ${mudancas.nome ? 'modified' : ''}`}>
                <CampoTexto
                  label="Nome"
                  value={nome}
                  onChange={(event) => setNome(event.target.value)}
                  required
                />
                {mudancas.nome && <span className="editar-usuario__field-modified">modificado</span>}
              </div>

              <div className={`editar-usuario__field-wrapper ${mudancas.email ? 'modified' : ''}`}>
                <CampoTexto
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                {mudancas.email && <span className="editar-usuario__field-modified">modificado</span>}
              </div>

              <div className="editar-usuario__passwords editar-usuario__field-wrapper--full">
                <div className="editar-usuario__passwords-heading">
                  <h3>Senhas de acesso</h3>
                  <p>Consulte a senha atual ou defina uma nova senha.</p>
                </div>
                <div className="editar-usuario__password-grid">
                  {podeVisualizarSenha && (
                    <SenhaAtual key={`${id}-${salvando}`} id={id} disabled={salvando} />
                  )}
                  <div className={`editar-usuario__password-card editar-usuario__field-wrapper ${mudancas.senha ? 'modified' : ''}`}>
                    <div className="form-field">
                      <label htmlFor="nova-senha">Nova senha</label>
                      <div className="editar-usuario__password-control">
                        <input
                          id="nova-senha"
                          type={mostrarNovaSenha ? 'text' : 'password'}
                          value={senha}
                          autoComplete="new-password"
                          aria-describedby="nova-senha-ajuda"
                          placeholder="Digite a nova senha"
                          onChange={(event) => setSenha(event.target.value)}
                        />
                        <button
                          type="button"
                          className="editar-usuario__password-toggle"
                          aria-label={mostrarNovaSenha ? 'Ocultar nova senha' : 'Visualizar nova senha'}
                          title={mostrarNovaSenha ? 'Ocultar nova senha' : 'Visualizar nova senha'}
                          onClick={() => setMostrarNovaSenha(atual => !atual)}
                        >
                          {mostrarNovaSenha ? <I.EyeOff size={18} /> : <I.Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    <p id="nova-senha-ajuda" className="editar-usuario__password-help">Deixe em branco para manter a senha atual.</p>
                    {mudancas.senha && <span className="editar-usuario__field-modified">modificado</span>}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="editar-usuario__section">
            <div className="editar-usuario__section-header">
              <div>
                <h2>Acesso</h2>
                <p>Controle função e disponibilidade da conta.</p>
              </div>
            </div>

            <div className="editar-usuario__access-grid">
          {podeGerenciarPermissoes ? (
            <div className={`editar-usuario__field ${mudancas.roleId ? 'modified' : ''}`}>
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
                <option value={1}>Administrador</option>
                <option value={2}>Usuário comum</option>
              </select>
              {mudancas.roleId && <span className="editar-usuario__field-modified">modificado</span>}
            </div>
          ) : (
            <p className="editar-usuario__info">
              Você pode editar os dados do usuário, mas não pode alterar função ou permissões.
            </p>
          )}

              <div className={`editar-usuario__status-card ${ativo ? 'is-active' : 'is-inactive'} ${mudancas.ativo ? 'modified' : ''}`}>
                <label className="editar-usuario__checkbox editar-usuario__status-toggle">
                  <input
                    type="checkbox"
                    checked={ativo}
                    onChange={(event) => setAtivo(event.target.checked)}
                  />

                  <span className="editar-usuario__switch" aria-hidden="true"></span>
                  <span>
                    <strong>Usuário ativo</strong>
                    <small>{ativo ? 'Pode acessar o sistema.' : 'Acesso bloqueado.'}</small>
                  </span>
                </label>
                {mudancas.ativo && <span className="editar-usuario__field-modified">modificado</span>}
              </div>
            </div>
          </section>

          {podeGerenciarPermissoes && (<section className="editar-usuario__section editar-usuario__permissions">
                <div className="editar-usuario__section-header">
                  <div>
                    <h2>Permissoes</h2>
                    <p>Selecione quais áreas e ações este usuário pode acessar.</p>
                  </div>

                  <span className="editar-usuario__permissions-count">
                    {totalPermissoesSelecionadas} de {permissoes.length}
                  </span>
                </div>

                <div className="editar-usuario__permissions-grid permissions-grid">
                  {gruposPermissoes.map(grupo => (
                    <PermissaoGrupo
                      key={grupo.id}
                      grupo={grupo}
                      selecionadas={permissoesSelecionadas}
                      onToggle={handlePermissaoChange}
                      onToggleBloco={handleBlocoPermissoesChange}
                    />
                  ))}
                </div>
              </section>)}

          <div className="editar-usuario__actions">
            {feedback && (
              <div
                className={`editar-usuario__action-feedback editar-usuario__action-feedback--${feedback.tipo} alert-timed alert-timed--${feedback.tipo}`}
                role="alert"
              >
                <feedback.Icone className="editar-usuario__message-icon" size={15} />
                <span>{feedback.texto}</span>
              </div>
            )}

            <div className="editar-usuario__actions-buttons">
              <Botao
                title={salvando ? 'Salvando...' : 'Salvar alterações'}
                type="submit"
                carregando={salvando}
                disabled={!temMudancas}
              />

              <Botao
                title="Cancelar"
                variant="outline"
                onClick={() => navigate('/usuarios')}
              />
            </div>
          </div>
        </form>
        </Card>
      </div>
    </LayoutPrivado>
  );
}

export default EditarUsuarioPage;

