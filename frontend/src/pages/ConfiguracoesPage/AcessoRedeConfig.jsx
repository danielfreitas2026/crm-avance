import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../../services/api';
import DispositivosAcessoConfig from './DispositivosAcessoConfig';

export default function AcessoRedeConfig() {
  const [config, setConfig] = useState(null);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    apiGet('/config/admin/acesso-rede').then(data => {
      setConfig(data);
    }).catch(error => setErro(error.message));
  }, []);

  async function salvar(event) {
    event.preventDefault();
    setErro('');
    setSucesso('');
    setSalvando(true);
    try {
      const data = await apiPut('/config/admin/acesso-rede', {
        ativo: config.ativo, modo: 'dispositivo'
      });
      setConfig(data);
      setSucesso('Configuração salva. Liberações e solicitações anteriores foram invalidadas.');
    } catch (error) { setErro(error.message); }
    finally { setSalvando(false); }
  }

  if (!config) return <p role="status">{erro || 'Carregando controle de acesso...'}</p>;
  return <><form onSubmit={salvar}>
    <h3>Acesso por dispositivos</h3>
    <p>Administradores e usuários com a permissão “Acessar sem código em qualquer navegador” são dispensados do código. Os horários de acesso continuam valendo.</p>
    <p>Telegram configurado: {config.telegram_configurado ? 'Sim' : 'Não'}.</p>
    <p>Com o bloqueio ativo, funcionários sem dispensa precisam de um navegador autorizado ou de um código temporário. O acesso não é liberado pelo IP da internet.</p>
    {erro && <p role="alert" className="alert-error">{erro}</p>}
    {sucesso && <p role="status" className="alert-success">{sucesso}</p>}
    <div className="form-field"><label>
      <input type="checkbox" checked={config.ativo} onChange={event => setConfig({ ...config, ativo: event.target.checked })} disabled={salvando} />
      Ativar bloqueio de acesso
    </label></div>
    <button className="btn btn-primary" disabled={salvando} type="submit">{salvando ? 'Salvando...' : 'Salvar controle de acesso'}</button>
  </form><DispositivosAcessoConfig /></>;
}
