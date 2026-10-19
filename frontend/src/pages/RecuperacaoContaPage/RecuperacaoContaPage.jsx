import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from '../../components/Icons';
import { confirmarEmailRecuperacao, solicitarRecuperacao, redefinirSenha, logout } from '../../services/auth.service';
import logo from '../../assets/LogoClaraSemFundo.png';
import './RecuperacaoContaPage.css';

const TITULOS = {
  solicitar: 'Recuperar acesso', confirmar: 'Confirmar e-mail de recuperação', redefinir: 'Redefinir senha'
};

export default function RecuperacaoContaPage({ tipo }) {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token') || '';
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmacao, setMostrarConfirmacao] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const linkInvalido = tipo !== 'solicitar' && !/^[a-f0-9]{64}$/.test(token);

  useEffect(() => {
    if (tipo !== 'redefinir' || !sucesso) return undefined;
    const timer = setTimeout(() => navigate('/login', { replace: true }), 2500);
    return () => clearTimeout(timer);
  }, [tipo, sucesso, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');
    if (tipo === 'redefinir') {
      if (senha !== confirmacao) {
        setErro('As senhas não coincidem.');
        return;
      }
      if (senha.length < 8 || !/\d/.test(senha) || new TextEncoder().encode(senha).length > 72) {
        setErro('A senha deve ter pelo menos 8 caracteres, um número e no máximo 72 bytes.');
        return;
      }
    }
    setEnviando(true);
    try {
      let resultado;
      if (tipo === 'solicitar') resultado = await solicitarRecuperacao(email.trim());
      if (tipo === 'confirmar') resultado = await confirmarEmailRecuperacao(token);
      if (tipo === 'redefinir') {
        resultado = await redefinirSenha(token, senha);
        logout();
        setSenha('');
        setConfirmacao('');
      }
      setSucesso(resultado.message);
    } catch (error) {
      setErro(error.message || 'Não foi possível concluir a operação.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login-page recuperacao-conta-page">
      <section className="login-card">
        <div className="login-logo"><img src={logo} alt="Avance" /></div>
        <h1>{TITULOS[tipo]}</h1>
        {tipo === 'solicitar' && <p>Informe o e-mail de acesso usado no CRM. As instruções serão enviadas ao e-mail real confirmado no seu perfil.</p>}
        {tipo === 'confirmar' && <p>Clique abaixo para confirmar que você tem acesso a este endereço de e-mail.</p>}
        {linkInvalido && <p role="alert">Link inválido. Abra o link completo recebido por e-mail.</p>}
        {erro && <p role="alert" className="recuperacao-conta-erro">{erro}</p>}
        {sucesso && <p role="status">{sucesso}</p>}
        {!sucesso && !linkInvalido && (
          <form onSubmit={handleSubmit}>
            {tipo === 'solicitar' && (
              <div className="form-field">
                <label htmlFor="recuperacao-email">E-mail de acesso</label>
                <input id="recuperacao-email" type="email" autoComplete="username" value={email}
                  onChange={e => setEmail(e.target.value)} maxLength={254} required />
              </div>
            )}
            {tipo === 'redefinir' && (
              <>
                <p id="regras-senha">Use pelo menos 8 caracteres, um número e no máximo 72 bytes.</p>
                <div className="form-field">
                  <label htmlFor="recuperacao-senha">Nova senha</label>
                  <div className="login-password-field">
                    <input id="recuperacao-senha" type={mostrarSenha ? 'text' : 'password'} autoComplete="new-password"
                      aria-describedby="regras-senha" value={senha} onChange={e => setSenha(e.target.value)} required />
                    <button type="button" className="login-password-toggle" aria-pressed={mostrarSenha}
                      aria-label={mostrarSenha ? 'Ocultar nova senha' : 'Visualizar nova senha'}
                      title={mostrarSenha ? 'Ocultar nova senha' : 'Visualizar nova senha'}
                      onClick={() => setMostrarSenha(atual => !atual)}>
                      {mostrarSenha ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="recuperacao-confirmacao">Confirme a nova senha</label>
                  <div className="login-password-field">
                    <input id="recuperacao-confirmacao" type={mostrarConfirmacao ? 'text' : 'password'} autoComplete="new-password"
                      value={confirmacao} onChange={e => setConfirmacao(e.target.value)} required />
                    <button type="button" className="login-password-toggle" aria-pressed={mostrarConfirmacao}
                      aria-label={mostrarConfirmacao ? 'Ocultar confirmação da nova senha' : 'Visualizar confirmação da nova senha'}
                      title={mostrarConfirmacao ? 'Ocultar confirmação da nova senha' : 'Visualizar confirmação da nova senha'}
                      onClick={() => setMostrarConfirmacao(atual => !atual)}>
                      {mostrarConfirmacao ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </>
            )}
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Aguarde...' : tipo === 'solicitar' ? 'Enviar instruções' : tipo === 'confirmar' ? 'Confirmar e-mail' : 'Salvar nova senha'}
            </button>
          </form>
        )}
        {tipo === 'solicitar' && <p>Sem e-mail de recuperação confirmado? Procure um administrador.</p>}
        {tipo === 'redefinir' && !sucesso && <p><Link to="/esqueci-minha-senha">Solicitar outro link</Link></p>}
        {tipo === 'confirmar' && <p>Para reenviar a confirmação, acesse Editar perfil no CRM.</p>}
        <p><Link to="/login">Voltar ao login</Link></p>
      </section>
    </main>
  );
}
