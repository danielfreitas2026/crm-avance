import { useNavigationState } from '../../utils/useNavigationState';
import { useEffect, useMemo, useState } from 'react';
import * as I from '../../components/Icons';
import { atualizarHorarioAcesso, buscarHorarioAcesso } from '../../services/config.service';
import './HorarioAcessoConfig.css';

const NOMES_DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function HorarioAcessoConfig() {
  const [configuracao, setConfiguracao] = useState(null);
  const [busca, setBusca] = useNavigationState('HorarioAcessoConfig:busca', '');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  useEffect(() => {
    buscarHorarioAcesso()
      .then(setConfiguracao)
      .catch(error => setErro(error.message || 'Erro ao carregar o horário de acesso.'))
      .finally(() => setCarregando(false));
  }, []);

  const usuariosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return configuracao?.usuarios || [];
    return (configuracao?.usuarios || []).filter(usuario =>
      `${usuario.nome} ${usuario.email} ${usuario.role_nome || ''}`.toLocaleLowerCase('pt-BR').includes(termo)
    );
  }, [busca, configuracao?.usuarios]);

  function alterarDia(diaSemana, campo, valor) {
    setAlteracoesPendentes(true);
    setSucesso('');
    setConfiguracao(atual => ({
      ...atual,
      dias: atual.dias.map(dia => dia.dia_semana === diaSemana ? { ...dia, [campo]: valor } : dia)
    }));
  }

  function alternarUsuario(usuarioId) {
    setAlteracoesPendentes(true);
    setSucesso('');
    setConfiguracao(atual => {
      const selecionados = atual.usuario_ids.map(Number);
      return {
        ...atual,
        usuario_ids: selecionados.includes(Number(usuarioId))
          ? selecionados.filter(id => id !== Number(usuarioId))
          : [...selecionados, Number(usuarioId)]
      };
    });
  }

  async function salvar() {
    setErro('');
    setSucesso('');
    setSalvando(true);
    try {
      const atualizada = await atualizarHorarioAcesso({
        ativo: configuracao.ativo,
        dias: configuracao.dias.map(({ dia_semana, ativo, abertura, fechamento }) => ({ dia_semana, ativo, abertura, fechamento })),
        usuario_ids: configuracao.usuario_ids
      });
      setConfiguracao(atualizada);
      setAlteracoesPendentes(false);
      setSucesso('Horário de acesso atualizado com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar o horário de acesso.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="muted">Carregando horário de acesso...</div>;
  if (!configuracao) return <div className="alert-error">{erro || 'Não foi possível carregar a configuração.'}</div>;

  return (
    <div className="access-hours">
      {erro && <div className="alert-error access-hours__alert">{erro}</div>}
      {sucesso && <div className="alert-success access-hours__alert">{sucesso}</div>}

      <div className="access-hours__heading">
        <div>
          <h3>Controle de horário</h3>
          <p>Fuso horário fixo: America/Sao_Paulo</p>
        </div>
        <label className="access-hours__master">
          <input
            type="checkbox"
            checked={configuracao.ativo}
            onChange={event => {
              setAlteracoesPendentes(true);
              setSucesso('');
              setConfiguracao(atual => ({ ...atual, ativo: event.target.checked }));
            }}
          />
          <span>{configuracao.ativo ? 'Trava ativada' : 'Trava desativada'}</span>
        </label>
      </div>

      <div className="access-hours__warning">
        <I.AlertTriangle size={20} />
        <span>Fora dos períodos abaixo, apenas os usuários selecionados poderão acessar. Administradores não possuem liberação automática.</span>
      </div>

      <div className="access-hours__days">
        {configuracao.dias.map(dia => (
          <div className={`access-hours__day ${dia.ativo ? '' : 'is-disabled'}`} key={dia.dia_semana}>
            <label className="access-hours__day-name">
              <input type="checkbox" checked={dia.ativo} onChange={event => alterarDia(dia.dia_semana, 'ativo', event.target.checked)} />
              <span>{NOMES_DIAS[dia.dia_semana]}</span>
            </label>
            <label>
              <span>Abertura</span>
              <input type="time" value={dia.abertura} disabled={!dia.ativo} onChange={event => alterarDia(dia.dia_semana, 'abertura', event.target.value)} />
            </label>
            <label>
              <span>Fechamento</span>
              <input type="time" value={dia.fechamento} disabled={!dia.ativo} onChange={event => alterarDia(dia.dia_semana, 'fechamento', event.target.value)} />
            </label>
          </div>
        ))}
      </div>

      <div className="access-hours__users">
        <div className="access-hours__users-title">
          <div><h3>Usuários liberados fora do horário</h3><p>{configuracao.usuario_ids.length} selecionado(s)</p></div>
          <input type="search" placeholder="Buscar por nome ou e-mail" value={busca} onChange={event => setBusca(event.target.value)} />
        </div>
        <div className="access-hours__user-list">
          {usuariosFiltrados.map(usuario => (
            <label key={usuario.id} className="access-hours__user">
              <input type="checkbox" checked={configuracao.usuario_ids.map(Number).includes(Number(usuario.id))} onChange={() => alternarUsuario(usuario.id)} />
              <span><strong>{usuario.nome}</strong><small>{usuario.email} · {usuario.role_nome || 'Sem perfil'}</small></span>
            </label>
          ))}
          {usuariosFiltrados.length === 0 && <div className="empty">Nenhum usuário encontrado.</div>}
        </div>
      </div>

      <div className="access-hours__actions">
        <div className={`access-hours__save-status ${alteracoesPendentes ? 'is-pending' : 'is-saved'}`} role="status">
          {alteracoesPendentes ? <I.AlertTriangle size={16} /> : <I.Check size={16} />}
          <span>{alteracoesPendentes ? 'Existem alterações não salvas' : (sucesso ? 'Configurações salvas' : 'Nenhuma alteração pendente')}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !alteracoesPendentes}>
          {salvando ? 'Salvando...' : (sucesso ? 'Configurações salvas' : 'Salvar horário de acesso')}
        </button>
      </div>
    </div>
  );
}

export default HorarioAcessoConfig;
