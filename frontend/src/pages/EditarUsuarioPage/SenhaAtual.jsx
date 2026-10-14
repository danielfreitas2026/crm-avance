import { useEffect, useRef, useState } from 'react';
import { visualizarSenhaUsuario } from '../../services/usuario.service';

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
    <div className="editar-usuario__field-wrapper editar-usuario__field-wrapper--full">
      {senha !== null && (
        <div className="form-field">
          <label htmlFor="senha-atual">Senha atual</label>
          <input id="senha-atual" type="text" value={senha} readOnly autoComplete="off" />
        </div>
      )}
      <button
        type="button"
        className="btn btn-outline"
        disabled={disabled || carregando}
        onClick={senha === null ? visualizar : () => setSenha(null)}
      >
        {carregando ? 'Consultando senha...' : senha === null ? 'Visualizar senha atual' : 'Ocultar senha'}
      </button>
      {erro && <p role="alert">{erro}</p>}
    </div>
  );
}
