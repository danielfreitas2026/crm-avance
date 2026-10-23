import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../../services/api';
import DispositivosAcessoConfig from './DispositivosAcessoConfig';

export default function AcessoRedeConfig() {
  const [config, setConfig] = useState(null);
  const [redes, setRedes] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    apiGet('/config/admin/acesso-rede').then(data => {
      setConfig({ ...data, modo: data.modo || 'rede' });
      setRedes(data.redes.join('\n'));
    }).catch(error => setErro(error.message));
  }, []);

  async function salvar(event) {
    event.preventDefault();
    setErro('');
    setSucesso('');
    setSalvando(true);
    try {
      const data = await apiPut('/config/admin/acesso-rede', {
        ativo: config.ativo, modo: config.modo, redes: redes.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
      });
      setConfig({ ...data, modo: data.modo || 'rede' });
      setRedes(data.redes.join('\n'));
      setSucesso('Configuração salva. Liberações e solicitações anteriores foram invalidadas.');
    } catch (error) { setErro(error.message); }
    finally { setSalvando(false); }
  }

  if (!config) return <p role="status">{erro || 'Carregando acesso por rede...'}</p>;
  return <><form onSubmit={salvar}>
    <h3>Acesso por rede e dispositivos</h3>
    <p>Administradores e usuários com a permissão “Acessar de qualquer rede sem código” são dispensados do código. Os horários de acesso continuam valendo.</p>
    <p>IP identificado nesta conexão: <strong>{config.ip_detectado}</strong></p>
    <p>Proxy confiável configurado: {config.proxy_configurado ? 'Sim' : 'Não'}. Telegram configurado: {config.telegram_configurado ? 'Sim' : 'Não'}.</p>
    <div className="form-field"><label htmlFor="modo-acesso">Modo de controle de acesso</label>
      <select id="modo-acesso" value={config.modo} disabled={salvando}
        onChange={event => setConfig({ ...config, modo: event.target.value })}>
        <option value="rede">Por rede</option>
        <option value="dispositivo">Por navegador autorizado</option>
      </select>
    </div>
    <p>{config.modo === 'dispositivo'
      ? 'Somente navegadores autorizados dispensam o código para usuários sem dispensa. IPs cadastrados não liberam o acesso neste modo.'
      : 'Antes de ativar, confira se o IP identificado corresponde à conexão da empresa e se muda quando você acessa por outra internet. Uma VPN com saída pela empresa será considerada interna.'}</p>
    {erro && <p role="alert" className="alert-error">{erro}</p>}
    {sucesso && <p role="status" className="alert-success">{sucesso}</p>}
    <div className="form-field"><label>
      <input type="checkbox" checked={config.ativo} onChange={event => setConfig({ ...config, ativo: event.target.checked })} disabled={salvando} />
      Ativar bloqueio de acesso
    </label></div>
    {config.modo === 'rede' && <div className="form-field"><label htmlFor="redes-empresa">IPs públicos ou faixas da empresa (um por linha)</label>
      <textarea id="redes-empresa" rows={6} value={redes} onChange={event => setRedes(event.target.value)} disabled={salvando}
        placeholder={'Exemplos: 203.0.113.10 ou 2001:db8:1234::/48'} />
    </div>}
    <button className="btn btn-primary" disabled={salvando} type="submit">{salvando ? 'Salvando...' : 'Salvar controle de acesso'}</button>
  </form><DispositivosAcessoConfig /></>;
}
