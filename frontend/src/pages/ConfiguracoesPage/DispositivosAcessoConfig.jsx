import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../services/api';

const ENDPOINT = '/config/admin/acesso-rede/dispositivos';

export default function DispositivosAcessoConfig() {
  const [lista, setLista] = useState(null);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [revogando, setRevogando] = useState(null);

  useEffect(() => {
    apiGet(ENDPOINT).then(setLista).catch(error => setErro(error.message));
  }, []);

  async function autorizar(event) {
    event.preventDefault();
    setErro('');
    setSucesso('');
    setOcupado(true);
    try {
      const { dispositivo } = await apiPost(`${ENDPOINT}/atual`, { nome: nome.trim(), senha_atual: senha });
      const atualizada = await apiGet(ENDPOINT);
      setLista(atualizada);
      if (atualizada.dispositivo_atual_id !== dispositivo.id) {
        setErro('O navegador não confirmou a credencial. Confira se os cookies estão permitidos e se o CRM usa HTTPS.');
      } else {
        setNome('');
        setSucesso('Este navegador foi autorizado. Você pode sair da conta sem perder a autorização.');
      }
    } catch (error) { setErro(error.message); }
    finally { setSenha(''); setOcupado(false); }
  }

  async function revogar() {
    setErro('');
    setSucesso('');
    setOcupado(true);
    try {
      await apiDelete(`${ENDPOINT}/${revogando.id}`);
      setLista(await apiGet(ENDPOINT));
      setRevogando(null);
      setSucesso('Autorização do navegador revogada.');
    } catch (error) { setErro(error.message); }
    finally { setOcupado(false); }
  }

  return <section aria-labelledby="titulo-navegadores">
    <h3 id="titulo-navegadores">Navegadores autorizados</h3>
    <p>A autorização vale para qualquer funcionário neste navegador, sem depender do IP. Login, senha e horários continuam obrigatórios.</p>
    <p>O cadastro não tem vencimento. Apagar os dados do navegador exige nova autorização. Outro navegador, perfil ou janela anônima não recebe esta autorização.</p>
    {erro && <p role="alert" className="alert-error">{erro}</p>}
    {sucesso && <p role="status" className="alert-success">{sucesso}</p>}
    <form onSubmit={autorizar}>
      <div className="form-field"><label htmlFor="nome-dispositivo">Nome deste navegador</label>
        <input id="nome-dispositivo" value={nome} onChange={event => setNome(event.target.value)}
          maxLength={80} required disabled={ocupado || !lista} placeholder="Ex.: Recepção — Chrome" />
      </div>
      <div className="form-field"><label htmlFor="senha-dispositivo">Sua senha atual</label>
        <input id="senha-dispositivo" type="password" autoComplete="current-password" value={senha}
          onChange={event => setSenha(event.target.value)} maxLength={1024} required disabled={ocupado || !lista} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={ocupado || !lista || !nome.trim() || !senha}>
        {ocupado ? 'Aguarde...' : 'Autorizar este navegador'}
      </button>
    </form>
    {!lista && !erro && <p role="status">Carregando navegadores...</p>}
    {lista && (lista.dispositivos.length === 0 ? <p>Nenhum navegador cadastrado.</p> : <ul>
      {lista.dispositivos.map(dispositivo => <li key={dispositivo.id}>
        <strong>{dispositivo.nome}</strong>
        {lista.dispositivo_atual_id === dispositivo.id && <span> — Este navegador</span>}
        <p>Responsável: {dispositivo.responsavel_nome || 'Conta removida'}. Cadastro: {new Date(dispositivo.cadastrado_em).toLocaleString('pt-BR')}.</p>
        <p>Situação: {dispositivo.revogado_em ? 'Revogado' : 'Autorizado'}.</p>
        {!dispositivo.revogado_em && <button type="button" className="btn" disabled={ocupado}
          onClick={() => setRevogando(dispositivo)} aria-label={`Revogar ${dispositivo.nome}`}>Revogar</button>}
      </li>)}
    </ul>)}
    {revogando && <div role="group" aria-labelledby="confirmar-revogacao">
      <h4 id="confirmar-revogacao">Revogar {revogando.nome}?</h4>
      <p>Este navegador perderá a dispensa do código. Liberações temporárias já obtidas continuam até o fim da sessão.</p>
      <button type="button" className="btn" disabled={ocupado} onClick={() => setRevogando(null)}>Cancelar revogação</button>
      <button type="button" className="btn" disabled={ocupado} onClick={revogar}>Confirmar revogação</button>
    </div>}
  </section>;
}
