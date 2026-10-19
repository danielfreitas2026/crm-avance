import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { atualizarPerfil, buscarPerfil, reenviarConfirmacaoEmailRecuperacao } from '../../services/auth.service';
import './EditarPerfilPage.css';

/**
 * Retorna initials a partir dos dados informados.
 */
const getInitials = (name) => {
  if (!name) return '??';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

/**
 * Processa medir senha conforme as regras do dominio.
 */
function medirSenha(senha) {
  if (!senha) return { nivel: 0, label: 'Opcional' };

  let pontos = 0;
  if (senha.length >= 8) pontos += 1;
  if (/[A-Z]/.test(senha)) pontos += 1;
  if (/[0-9]/.test(senha)) pontos += 1;
  if (/[^A-Za-z0-9]/.test(senha)) pontos += 1;

  if (pontos <= 1) return { nivel: 1, label: 'Fraca' };
  if (pontos <= 3) return { nivel: 2, label: 'Boa' };
  return { nivel: 3, label: 'Forte' };
}

/**
 * Renderiza editar perfil page.
 */
function EditarPerfilPage() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState(null);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [emailRecuperacao, setEmailRecuperacao] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [fotoPerfil, setFotoPerfil] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

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
     * Carrega  e atualiza o estado relacionado.
     */
    async function carregar() {
      try {
        const perfil = await buscarPerfil();
        setUsuario(perfil);
        setEmailRecuperacao(perfil.email_recuperacao_pendente || perfil.email_recuperacao || '');
        setNome(perfil.nome || '');
        setFotoPerfil(perfil.foto_perfil || '');
      } catch (error) {
        setErro(error.message);
      } finally {
        setCarregando(false);
      }
    }

    carregar();
  }, []);

  const isAdmin = usuario?.role?.nome === 'admin';
  const forcaSenha = useMemo(() => medirSenha(senha), [senha]);
  const nomeAlterado = nome.trim() !== '' && nome.trim() !== (usuario?.nome || '');
  const fotoAlterada = fotoPerfil !== (usuario?.foto_perfil || '');
  const emailRecuperacaoAlterado = emailRecuperacao.trim().toLowerCase() !==
    (usuario?.email_recuperacao_pendente || usuario?.email_recuperacao || '');
  const temAlteracoes = (isAdmin && nomeAlterado) || senha.trim() !== '' || fotoAlterada || emailRecuperacaoAlterado;

  async function handleReenviar() {
    setErro('');
    setSucesso('');
    if (!senhaAtual) { setErro('Informe sua senha atual para reenviar.'); return; }
    setSalvando(true);
    try {
      const resultado = await reenviarConfirmacaoEmailRecuperacao(senhaAtual);
      setSenhaAtual('');
      setSucesso(resultado.message);
    } catch (error) {
      setErro(error.message || 'Não foi possível reenviar o e-mail.');
    } finally { setSalvando(false); }
  }

  /**
   * Trata o evento de foto change.
   */
  function handleFotoChange(event) {
    const arquivo = event.target.files?.[0];

    if (!arquivo) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.type)) {
      setErro('Use uma imagem PNG, JPG ou WEBP.');
      return;
    }

    if (arquivo.size > 4 * 1024 * 1024) {
      setErro('A foto deve ter até 4 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setErro('');
      setFotoPerfil(String(reader.result || ''));
    };
    reader.readAsDataURL(arquivo);
  }

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');
    setSucesso('');

    if (!temAlteracoes) {
      setErro('Informe uma alteracao antes de salvar.');
      return;
    }

    if (emailRecuperacaoAlterado && !senhaAtual) {
      setErro('Informe sua senha atual para alterar o e-mail de recuperação.');
      return;
    }

    setSalvando(true);

    try {
      const dados = {};
      if (isAdmin && nomeAlterado) dados.nome = nome.trim();
      if (senha.trim() !== '') dados.senha = senha;
      if (fotoAlterada) dados.foto_perfil = fotoPerfil || null;
      if (emailRecuperacaoAlterado) {
        dados.email_recuperacao = emailRecuperacao.trim().toLowerCase() || null;
        dados.senha_atual = senhaAtual;
      }

      const perfilAtualizado = await atualizarPerfil(dados);
      setUsuario(perfilAtualizado);
      setEmailRecuperacao(perfilAtualizado.email_recuperacao_pendente || perfilAtualizado.email_recuperacao || '');
      setSenhaAtual('');
      setNome(perfilAtualizado.nome || '');
      setFotoPerfil(perfilAtualizado.foto_perfil || '');
      setSenha('');
      setSucesso(emailRecuperacaoAlterado && perfilAtualizado.email_recuperacao_pendente
        ? 'Alterações salvas. Enviamos um link para confirmar seu e-mail de recuperação.'
        : 'Alteracoes salvas com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar alterações.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <LayoutPrivado>
        <div className="empty">Carregando...</div>
      </LayoutPrivado>
    );
  }

  return (
    <LayoutPrivado>
      <form className="editar-perfil-page" onSubmit={handleSubmit}>
        <section className="editar-perfil-hero">
          <div className="avatar editar-perfil-avatar">
            {fotoPerfil ? (
              <img src={fotoPerfil} alt={usuario?.nome || 'Foto de perfil'} />
            ) : (
              getInitials(usuario?.nome)
            )}
          </div>
          <div className="editar-perfil-hero__main">
            <h2>{usuario?.nome}</h2>
            <span>{usuario?.email}</span>
            <div className="editar-perfil-badges">
              <span className="tag">{usuario?.role?.nome}</span>
              <span className={`pill ${usuario?.ativo ? 'success' : ''}`}>
                <span className="pill-dot"></span>
                {usuario?.ativo ? 'Conta ativa' : 'Inativa'}
              </span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/perfil')}>
            <I.ArrowRight style={{ transform: 'rotate(180deg)' }} size={14} />
            Voltar
          </button>
        </section>

        <div className="editar-perfil-panel" role="group" aria-label="Configurações do perfil">
          <section className="editar-perfil-section" aria-labelledby="dados-conta-titulo">
            <div className="editar-perfil-section-header">
              <I.User size={18} aria-hidden="true" />
              <div>
                <h3 id="dados-conta-titulo">Dados da conta</h3>
                <span className="editar-perfil-panel-sub">Sua identificação no CRM</span>
              </div>
            </div>
            <div className="editar-perfil-section-body">
              <div className="editar-perfil-foto">
                <div className="avatar editar-perfil-foto__preview">
                  {fotoPerfil ? (
                    <img src={fotoPerfil} alt={usuario?.nome || 'Foto de perfil'} />
                  ) : (
                    getInitials(usuario?.nome)
                  )}
                </div>
                <div className="editar-perfil-foto__actions">
                  <label className="btn btn-sm editar-perfil-foto__upload">
                    Escolher foto
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-describedby="foto-ajuda"
                      onChange={handleFotoChange}
                    />
                  </label>
                  {fotoPerfil && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFotoPerfil('')}>
                      Remover foto
                    </button>
                  )}
                  <div id="foto-ajuda" className="editar-perfil-help">PNG, JPG ou WEBP até 4 MB.</div>
                </div>
              </div>

              <div className="editar-perfil-fields">
                <div className="form-field">
                  <label htmlFor="perfil-nome">Nome de exibição</label>
                  <input
                    id="perfil-nome"
                    autoComplete="name"
                    aria-describedby={!isAdmin ? 'nome-ajuda' : undefined}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    disabled={!isAdmin}
                    required={isAdmin}
                  />
                  {!isAdmin && (
                    <div id="nome-ajuda" className="editar-perfil-help">Somente administradores podem alterar o nome.</div>
                  )}
                </div>

                <div className="form-field">
                  <label htmlFor="perfil-email">E-mail de acesso</label>
                  <input id="perfil-email" aria-describedby="email-acesso-ajuda" value={usuario?.email || ''} disabled />
                  <div id="email-acesso-ajuda" className="editar-perfil-help">O e-mail não pode ser alterado por aqui.</div>
                </div>
              </div>
            </div>
          </section>

          <section className="editar-perfil-section" aria-labelledby="recuperacao-titulo">
            <div className="editar-perfil-section-header">
              <I.Mail size={18} aria-hidden="true" />
              <div>
                <h3 id="recuperacao-titulo">Recuperação de conta</h3>
                <span className="editar-perfil-panel-sub">Recupere seu acesso quando precisar</span>
              </div>
            </div>
            <div className="editar-perfil-section-body">
              <div className="editar-perfil-fields">
                <div className="form-field">
                  <label htmlFor="email-recuperacao">E-mail de recuperação</label>
                  <input id="email-recuperacao" type="email" maxLength={254} autoComplete="email"
                    aria-describedby="email-recuperacao-ajuda"
                    value={emailRecuperacao} onChange={e => setEmailRecuperacao(e.target.value)} />
                  <div id="email-recuperacao-ajuda" className="editar-perfil-help">
                    Use um e-mail real ao qual você tenha acesso. Seu e-mail de acesso ao CRM continua o mesmo.
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="senha-atual-recuperacao">Senha atual</label>
                  <input id="senha-atual-recuperacao" type="password" autoComplete="current-password"
                    aria-describedby="senha-atual-ajuda"
                    value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} />
                  <div id="senha-atual-ajuda" className="editar-perfil-help">Obrigatória para cadastrar, trocar, remover ou reenviar a confirmação do e-mail de recuperação.</div>
                </div>
              </div>
              <div className="editar-perfil-recuperacao-status">
                <p role="status" className={`pill ${usuario?.email_recuperacao_pendente ? 'warn'
                  : usuario?.email_recuperacao_confirmado_em ? 'success' : ''}`}>
                  <span className="pill-dot" aria-hidden="true" />
                  {usuario?.email_recuperacao_pendente ? 'Aguardando confirmação'
                  : usuario?.email_recuperacao_confirmado_em ? 'Confirmado' : 'Não configurado'}</p>
                {usuario?.email_recuperacao && <p>Endereço confirmado: {usuario.email_recuperacao}</p>}
                {usuario?.email_recuperacao_pendente && (
                  <p>Confirmação pendente: {usuario.email_recuperacao_pendente}</p>
                )}
                <div className="editar-perfil-recuperacao-actions">
                  {usuario?.email_recuperacao_pendente && (
                    <button type="button" className="btn btn-sm" disabled={salvando || emailRecuperacaoAlterado}
                      onClick={handleReenviar}>Reenviar confirmação</button>
                  )}
                  {(usuario?.email_recuperacao || usuario?.email_recuperacao_pendente) && (
                    <button type="button" className="btn btn-sm btn-ghost editar-perfil-remove" disabled={salvando}
                      onClick={() => setEmailRecuperacao('')}>Remover e-mail de recuperação</button>
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="editar-perfil-section" aria-labelledby="alterar-senha-titulo">
            <div className="editar-perfil-section-header">
              <I.Shield size={18} aria-hidden="true" />
              <div>
                <h3 id="alterar-senha-titulo">Alterar senha</h3>
                <span className="editar-perfil-panel-sub">Atualize sua senha de acesso</span>
              </div>
            </div>
            <div className="editar-perfil-section-body">
              <div className="form-field">
                <label htmlFor="perfil-nova-senha">Nova senha</label>
                <div className="editar-perfil-password">
                  <input
                    id="perfil-nova-senha"
                    autoComplete="new-password"
                    aria-describedby="nova-senha-ajuda nova-senha-forca"
                    type={mostrarSenha ? 'text' : 'password'}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Deixe em branco para manter"
                  />
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost"
                    onClick={() => setMostrarSenha(prev => !prev)}
                    title={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
                    aria-pressed={mostrarSenha}
                    aria-controls="perfil-nova-senha"
                  >
                    {mostrarSenha ? <I.EyeOff size={15} /> : <I.Eye size={15} />}
                  </button>
                </div>

                <div id="nova-senha-ajuda" className="editar-perfil-help">Deixe em branco para manter sua senha atual.</div>
                <div className="editar-perfil-password-meter">
                  <span aria-hidden="true" className={`meter-bar ${forcaSenha.nivel >= 1 ? 'active' : ''}`} />
                  <span aria-hidden="true" className={`meter-bar ${forcaSenha.nivel >= 2 ? 'active' : ''}`} />
                  <span aria-hidden="true" className={`meter-bar ${forcaSenha.nivel >= 3 ? 'active' : ''}`} />
                  <small id="nova-senha-forca">{forcaSenha.label}</small>
                </div>
              </div>
            </div>
          </section>
          <footer className="editar-perfil-footer" role="group" aria-label="Ações do perfil">
            {(erro || sucesso) && (
              <div className="editar-perfil-feedback" aria-live="polite">
                {erro && <div role="alert" className="alert-error alert-timed alert-timed--error">{erro}</div>}
                {sucesso && <div className="editar-perfil-success alert-timed alert-timed--success">{sucesso}</div>}
              </div>
            )}

            <div className="editar-perfil-actions">
              <button type="button" className="btn" onClick={() => navigate('/perfil')}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={salvando || !temAlteracoes}>
                {salvando ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </footer>
        </div>
      </form>
    </LayoutPrivado>
  );
}

export default EditarPerfilPage;
