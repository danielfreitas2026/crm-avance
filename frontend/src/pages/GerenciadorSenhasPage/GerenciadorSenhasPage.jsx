import { useCallback, useEffect, useRef, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { listarCredenciais, revelarSenha } from '../../services/gerenciador-senhas.service';
import './GerenciadorSenhasPage.css';

function GerenciadorSenhasPage() {
  const [usuarios, setUsuarios] = useState([]);
  const [busca, setBusca] = useState('');
  const [senhas, setSenhas] = useState({});
  const [pendentes, setPendentes] = useState({});
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const consultas = useRef(new Map());
  const timers = useRef(new Map());

  const cancelarConsultas = useCallback(() => {
    consultas.current.forEach(controller => controller.abort());
    consultas.current.clear();
    timers.current.forEach(timer => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const limpar = useCallback(() => {
    cancelarConsultas();
    setSenhas({});
    setPendentes({});
  }, [cancelarConsultas]);

  useEffect(() => {
    const controller = new AbortController();
    listarCredenciais(controller.signal)
      .then(dados => { if (!controller.signal.aborted) setUsuarios(dados); })
      .catch(error => { if (!controller.signal.aborted) setErro(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });

    const aoOcultar = () => { if (document.hidden) limpar(); };
    const aoAlterarSessao = event => {
      if (event.type !== 'storage' || event.key === null || ['token', 'usuario'].includes(event.key)) limpar();
    };
    document.addEventListener('visibilitychange', aoOcultar);
    window.addEventListener('pagehide', limpar);
    window.addEventListener('auth:sessao-encerrada', limpar);
    window.addEventListener('storage', aoAlterarSessao);
    return () => {
      controller.abort();
      cancelarConsultas();
      document.removeEventListener('visibilitychange', aoOcultar);
      window.removeEventListener('pagehide', limpar);
      window.removeEventListener('auth:sessao-encerrada', limpar);
      window.removeEventListener('storage', aoAlterarSessao);
    };
  }, [cancelarConsultas, limpar]);

  function ocultar(id) {
    consultas.current.get(id)?.abort();
    consultas.current.delete(id);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setSenhas(atuais => {
      const proximas = { ...atuais };
      delete proximas[id];
      return proximas;
    });
    setPendentes(atuais => {
      const proximas = { ...atuais };
      delete proximas[id];
      return proximas;
    });
  }

  async function revelar(id) {
    if (document.hidden || consultas.current.has(id)) return;
    const controller = new AbortController();
    consultas.current.set(id, controller);
    setPendentes(atuais => ({ ...atuais, [id]: true }));
    setErro('');
    try {
      const resultado = await revelarSenha(id, controller.signal);
      if (controller.signal.aborted || document.hidden) return;
      setSenhas(atuais => ({ ...atuais, [id]: resultado.senha }));
      timers.current.set(id, setTimeout(() => ocultar(id), 30000));
    } catch (error) {
      if (!controller.signal.aborted) setErro(error.message || 'Erro ao revelar senha.');
    } finally {
      if (!controller.signal.aborted) {
        consultas.current.delete(id);
        setPendentes(atuais => {
          const proximas = { ...atuais };
          delete proximas[id];
          return proximas;
        });
      }
    }
  }

  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const filtrados = usuarios.filter(usuario =>
    `${usuario.nome} ${usuario.email}`.toLocaleLowerCase('pt-BR').includes(termo));

  return (
    <LayoutPrivado>
      <section className="panel gerenciador-senhas">
        <div className="panel-header"><h1>Gerenciador de senhas</h1></div>
        <div className="panel-body">
          <p className="muted">Revele uma senha por vez. Cada consulta é registrada no histórico e a senha fica visível por até 30 segundos.</p>
          <div className="form-field">
            <label htmlFor="busca-credenciais">Buscar por nome ou e-mail</label>
            <input id="busca-credenciais" type="search" value={busca} onChange={event => { limpar(); setBusca(event.target.value); }} />
          </div>
          {erro && <div className="alert-error" role="alert">{erro}</div>}
          {carregando ? <p role="status">Carregando usuários...</p> : (
            <div className="gerenciador-senhas__scroll">
              <table className="gerenciador-senhas__table">
                <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Status</th><th>Senha</th><th>Ação</th></tr></thead>
                <tbody>
                  {filtrados.map(usuario => (
                    <tr key={usuario.id}>
                      <td>{usuario.nome}</td><td>{usuario.email}</td>
                      <td>{usuario.funcao === 'admin' ? 'Administrador' : 'Usuário'}</td>
                      <td><span className={`pill ${usuario.ativo ? 'success' : 'danger'}`}>{usuario.ativo ? 'Ativo' : 'Inativo'}</span></td>
                      <td>{usuario.senha_disponivel
                        ? <span className="gerenciador-senhas__senha">{senhas[usuario.id] ?? '••••••••'}</span>
                        : <span className="muted">Senha indisponível até a próxima troca</span>}</td>
                      <td>{usuario.senha_disponivel && (
                        <button type="button" className="btn btn-sm" aria-label={`${senhas[usuario.id] !== undefined || pendentes[usuario.id] ? 'Ocultar' : 'Revelar'} senha de ${usuario.nome}`}
                          onClick={() => senhas[usuario.id] !== undefined || pendentes[usuario.id] ? ocultar(usuario.id) : revelar(usuario.id)}>
                          {pendentes[usuario.id] ? 'Cancelar' : senhas[usuario.id] !== undefined ? 'Ocultar' : 'Revelar'}
                        </button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtrados.length === 0 && !erro && <p>Nenhum usuário encontrado.</p>}
            </div>
          )}
        </div>
      </section>
    </LayoutPrivado>
  );
}

export default GerenciadorSenhasPage;
