import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as I from '../../components/Icons';
import { login } from '../../services/auth.service';
import { SYSTEM_CLOSED_MESSAGE } from '../../services/api';
import logo from '../../assets/LogoClaraSemFundo.png';

function mensagemInicial() {
  const mensagem = sessionStorage.getItem('system_closed_message') || sessionStorage.getItem('logout_message');
  sessionStorage.removeItem('system_closed_message');
  sessionStorage.removeItem('logout_message');
  return mensagem || '';
}

/**
 * Renderiza login page.
 */
function LoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState(mensagemInicial);
  const [carregando, setCarregando] = useState(false);

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');
    setCarregando(true);

    try {
      await login(email, senha);
      navigate('/');
    } catch (error) {
      if (error.code === 'NETWORK_ACCESS_REQUIRED') {
        navigate('/verificar-acesso');
        return;
      }
      setErro(error.code === 'SYSTEM_CLOSED' ? SYSTEM_CLOSED_MESSAGE : (error.message || 'E-mail ou senha inválidos.'));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src={logo} alt="Logo da empresa" style={{ maxWidth: '100%', maxHeight: '80px', objectFit: 'contain' }} />
        </div>
        <h1>Entrar no sistema</h1>
        <p className="sub">Acesse com sua conta da empresa</p>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>
          <div className="form-field">
            <label>Senha</label>
            <div className="login-password-field">
              <input
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setMostrarSenha(prev => !prev)}
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
                title={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
              >
                {mostrarSenha ? <I.EyeOff size={16} /> : <I.Eye size={16} />}
              </button>
            </div>
          </div>

          {erro && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '12px' }}>
              {erro}
            </div>
          )}

          <div className="row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)' }}>
              <input type="checkbox" defaultChecked /> Manter conectado
            </label>
            <Link to="/esqueci-minha-senha">Esqueci minha senha</Link>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
            disabled={carregando}
          >
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="login-public-links" aria-label="Informações públicas">
          <Link to="/integracao-gmail">Integração Gmail</Link>
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center' }}>
          v1.0 · Sistema interno · Acesso restrito
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
