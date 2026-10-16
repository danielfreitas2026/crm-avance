import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { atualizarPerfil, buscarPerfil } from '../../services/auth.service';
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
  const temAlteracoes = (isAdmin && nomeAlterado) || senha.trim() !== '' || fotoAlterada;

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

    setSalvando(true);

    try {
      const dados = {};
      if (isAdmin && nomeAlterado) dados.nome = nome.trim();
      if (senha.trim() !== '') dados.senha = senha;
      if (fotoAlterada) dados.foto_perfil = fotoPerfil || null;

      const perfilAtualizado = await atualizarPerfil(dados);
      setUsuario(perfilAtualizado);
      setNome(perfilAtualizado.nome || '');
      setFotoPerfil(perfilAtualizado.foto_perfil || '');
      setSenha('');
      setSucesso('Alteracoes salvas com sucesso.');
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

        <div className="editar-perfil-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Dados da conta</h3>
                <span className="editar-perfil-panel-sub">Identificacao usada no sistema</span>
              </div>
            </div>
            <div className="panel-body">
              <div className="editar-perfil-foto">
                <div className="avatar editar-perfil-foto__preview">
                  {fotoPerfil ? (
                    <img src={fotoPerfil} alt={usuario?.nome || 'Foto de perfil'} />
                  ) : (
                    getInitials(usuario?.nome)
                  )}
                </div>
                <div className="editar-perfil-foto__actions">
                  <label className="btn btn-sm">
                    Escolher foto
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFotoChange}
                    />
                  </label>
                  {fotoPerfil && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFotoPerfil('')}>
                      Remover
                    </button>
                  )}
                  <div className="editar-perfil-help">PNG, JPG ou WEBP até 4 MB.</div>
                </div>
              </div>

              <div className="form-field">
                <label>Nome de exibicao</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  disabled={!isAdmin}
                  required={isAdmin}
                />
                {!isAdmin && (
                  <div className="editar-perfil-help">Somente administradores podem alterar o nome.</div>
                )}
              </div>

              <div className="form-field">
                <label>E-mail de acesso</label>
                <input value={usuario?.email || ''} disabled />
                <div className="editar-perfil-help">O e-mail não pode ser alterado por aqui.</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Seguranca</h3>
                <span className="editar-perfil-panel-sub">Atualize sua senha de acesso</span>
              </div>
            </div>
            <div className="panel-body">
              <div className="form-field">
                <label>Nova senha</label>
                <div className="editar-perfil-password">
                  <input
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
                  >
                    {mostrarSenha ? <I.EyeOff size={15} /> : <I.Eye size={15} />}
                  </button>
                </div>

                <div className="editar-perfil-password-meter">
                  <span className={`meter-bar ${forcaSenha.nivel >= 1 ? 'active' : ''}`} />
                  <span className={`meter-bar ${forcaSenha.nivel >= 2 ? 'active' : ''}`} />
                  <span className={`meter-bar ${forcaSenha.nivel >= 3 ? 'active' : ''}`} />
                  <small>{forcaSenha.label}</small>
                </div>
              </div>
            </div>
          </section>
        </div>

        {(erro || sucesso) && (
          <div className="editar-perfil-feedback">
            {erro && <div className="alert-error alert-timed alert-timed--error">{erro}</div>}
            {sucesso && <div className="editar-perfil-success alert-timed alert-timed--success">{sucesso}</div>}
          </div>
        )}

        <div className="editar-perfil-actions">
          <button type="button" className="btn" onClick={() => navigate('/perfil')}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={salvando || !temAlteracoes}>
            {salvando ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </LayoutPrivado>
  );
}

export default EditarPerfilPage;
