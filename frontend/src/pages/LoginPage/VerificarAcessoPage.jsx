import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { logout, validarAcessoRede } from '../../services/auth.service';

function lerPendente() {
  try { return JSON.parse(sessionStorage.getItem('acesso_rede_pendente')); } catch { return null; }
}

export default function VerificarAcessoPage() {
  const navigate = useNavigate();
  const [pendente] = useState(lerPendente);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!pendente?.solicitacao_id) return <Navigate to="/login" replace />;
  const segundos = Math.max(0, Math.ceil((Date.parse(pendente.expira_em) - agora) / 1000));

  async function confirmar(event) {
    event.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await validarAcessoRede(pendente.solicitacao_id, codigo);
      navigate('/', { replace: true });
    } catch (error) {
      setErro(error.message || 'Não foi possível validar o código.');
    } finally { setCarregando(false); }
  }

  async function voltar() {
    setCarregando(true);
    try { await logout(); } catch {
      sessionStorage.setItem('logout_message', 'Não foi possível confirmar o encerramento no servidor. A liberação anterior pode continuar válida até expirar.');
    }
    navigate('/login', { replace: true });
  }

  return <div className="login-page"><div className="login-card">
    <h1>Autorizar acesso externo</h1>
    <p>Você está fora da rede da empresa. Peça ao administrador o código enviado pelo Telegram.</p>
    <p>Solicitação: <small>{pendente.solicitacao_id}</small></p>
    <p>{segundos > 0 ? `Código válido por ${Math.floor(segundos / 60)}min ${segundos % 60}s.` : 'Código expirado. Volte ao login para solicitar outro.'}</p>
    <form onSubmit={confirmar}>
      <div className="form-field">
        <label htmlFor="codigo-acesso">Código de 6 letras</label>
        <input id="codigo-acesso" autoComplete="one-time-code" autoCapitalize="characters"
          value={codigo} onChange={event => setCodigo(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6))}
          maxLength={6} pattern="[A-Za-z]{6}" required disabled={carregando || segundos === 0} />
      </div>
      {erro && <p role="alert" className="alert-error">{erro}</p>}
      <div className="login-access-actions">
        <button className="btn" type="button" onClick={voltar} disabled={carregando}>Voltar ao login</button>
        <button className="btn login-access-submit" type="submit" disabled={carregando || segundos === 0 || codigo.length !== 6}>
          {carregando ? 'Aguarde...' : 'Liberar acesso'}
        </button>
      </div>
    </form>
  </div></div>;
}
