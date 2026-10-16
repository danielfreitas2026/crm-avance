import { useEffect, useRef, useState } from 'react';
import { visualizarSenhaUsuario } from '../../services/usuario.service';
import { Eye, EyeOff } from '../../components/Icons';

export default function SenhaAtual({ id, disabled = false }) {
  const [senha, setSenha] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const consulta = useRef(0);

  useEffect(() => () => { consulta.current += 1; }, []);

  async function visualizar() {
    const atual = ++consulta.current;
    setCarregando(true);
    setErro('');
    try {
      const resultado = await visualizarSenhaUsuario(id);
      if (consulta.current === atual) setSenha(resultado.senha);
    } catch (error) {
      if (consulta.current === atual) setErro(error.message || 'Não foi possível visualizar a senha.');
    } finally {
      if (consulta.current === atual) setCarregando(false);
    }
  }

  return (
    <div className="editar-usuario__password-card">
      <div className="form-field">
        <label htmlFor={senha !== null ? 'senha-atual' : undefined}>Senha atual</label>
        <div className="editar-usuario__password-control" aria-busy={carregando}>
          {senha !== null ? (
            <input id="senha-atual" type="text" value={senha} readOnly autoComplete="off" aria-describedby="senha-atual-ajuda" />
          ) : (
            <span className="editar-usuario__password-mask" aria-hidden="true">••••••••</span>
          )}
          <button
            type="button"
            className="editar-usuario__password-toggle"
            disabled={disabled || carregando}
            aria-label={carregando ? 'Consultando senha...' : senha === null ? 'Visualizar senha atual' : 'Ocultar senha'}
            title={senha === null ? 'Visualizar senha atual' : 'Ocultar senha'}
            onClick={senha === null ? visualizar : () => setSenha(null)}
          >
            {senha === null ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
      </div>
      <p id="senha-atual-ajuda" className="editar-usuario__password-help" role="status">
        {carregando ? 'Consultando senha...' : senha === null ? 'Clique no olho para visualizar a senha atual.' : 'Senha exibida apenas para consulta.'}
      </p>
      {erro && <p className="editar-usuario__password-error" role="alert">{erro}</p>}
    </div>
  );
}
