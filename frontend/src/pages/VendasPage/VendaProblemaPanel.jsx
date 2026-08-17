import { useEffect, useState } from 'react';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import { temPermissao } from '../../services/auth.service';
import {
  listarDestinatariosProblemaVenda,
  listarProblemasVenda,
  marcarProblemaVenda,
  resolverProblemaVenda,
  solicitarCorrecaoProblemaVenda,
  verificarProblemaVenda
} from '../../services/venda.service';

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(value) {
  if (!value) return '-';

  const texto = String(value).slice(0, 10);
  const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!partes) return value;

  const [, ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Retorna problema status label a partir dos dados informados.
 */
function getProblemaStatusLabel(status) {
  if (status === 'resolvido') return 'Aguardando verificação';
  if (status === 'correcao_solicitada') return 'Correção solicitada';
  return 'Problema aberto';
}

/**
 * Retorna problema titulo a partir dos dados informados.
 */
function getProblemaTitulo(problema) {
  const abertura = (problema.eventos || []).find(evento => evento.tipo === 'abertura');
  return abertura?.mensagem || `Problema #${problema.id}`;
}

/**
 * Retorna responsaveis a partir dos dados informados.
 */
function getResponsaveis(problema) {
  return (problema.destinatarios || []).map(item => item.usuario?.nome).filter(Boolean).join(', ') || '-';
}

/**
 * Renderiza venda problema card.
 */
function VendaProblemaCard({ problema, usuario, destacado, onAtualizar }) {
  const [mensagemResolucao, setMensagemResolucao] = useState('');
  const [mensagemCorrecao, setMensagemCorrecao] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);

  const usuarioId = Number(usuario?.id);
  const solicitanteId = Number(problema.solicitante_id);
  const responsavel = (problema.destinatarios || []).some(item => Number(item.usuario_id) === usuarioId);
  const solicitante = solicitanteId === usuarioId;
  const ehAdmin = usuario?.role?.nome === 'admin';
  const podeResolver = (responsavel || ehAdmin) && problema.status !== 'resolvido';
  const podeRevisar = (solicitante || ehAdmin) && problema.status === 'resolvido';
  const detalhesId = `problema-${problema.id}-detalhes`;

  /**
   * Processa executar conforme as regras do dominio.
   */
  async function executar(acao) {
    setErro('');
    setSalvando(true);

    try {
      let atualizado;

      if (acao === 'resolver') {
        atualizado = await resolverProblemaVenda(problema.id, { mensagem: mensagemResolucao });
        setMensagemResolucao('');
      } else if (acao === 'correcao') {
        atualizado = await solicitarCorrecaoProblemaVenda(problema.id, { mensagem: mensagemCorrecao });
        setMensagemCorrecao('');
      } else {
        atualizado = await verificarProblemaVenda(problema.id);
      }

      onAtualizar(problema.id, atualizado);
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar problema da venda.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <article className={`venda-problema-card ${destacado ? 'is-highlighted' : ''}`} id={`problema-${problema.id}`}>
      <button
        type="button"
        className="venda-problema-card-header"
        aria-expanded={detalhesAbertos}
        aria-controls={detalhesId}
        onClick={() => setDetalhesAbertos(aberto => !aberto)}
      >
        <div className="venda-problema-card-main">
          <span className={`venda-problema-status-badge status-${problema.status}`}>{getProblemaStatusLabel(problema.status)}</span>
          <span>{getProblemaTitulo(problema)}</span>
          <em>Solicitado por {problema.solicitante?.nome || 'usuário'} em {formatarData(problema.aberto_em)}</em>
        </div>
      </button>

      <div
        className={`venda-problema-detalhes ${detalhesAbertos ? 'is-open' : 'is-closed'}`}
        id={detalhesId}
        aria-hidden={!detalhesAbertos}
      >
        <div className="venda-problema-detalhes-inner">
          <div className="venda-problema-responsaveis">
            <strong>Responsáveis</strong>
            <span>{getResponsaveis(problema)}</span>
          </div>

          <div className="venda-problema-eventos">
            {(problema.eventos || []).map(evento => (
              <div key={evento.id} className="venda-problema-evento">
                <strong>{evento.usuario?.nome || 'Sistema'} - {evento.tipo}</strong>
                <span>{evento.mensagem}</span>
                <em>{formatarData(evento.created_at)}</em>
              </div>
            ))}
          </div>

          {erro && <div className="alert-error">{erro}</div>}

          {podeResolver && (
            <div className="venda-problema-action">
              <label>Mensagem de resolução</label>
              <AutoResizeTextarea value={mensagemResolucao} onChange={event => setMensagemResolucao(event.target.value)} placeholder="Explique o que foi corrigido" />
              <button type="button" className="btn btn-primary" disabled={salvando || !mensagemResolucao.trim()} onClick={() => executar('resolver')}>
                Marcar resolvido
              </button>
            </div>
          )}

          {podeRevisar && (
            <div className="venda-problema-action">
              <div className="venda-problema-review-actions">
                <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => executar('verificar')}>
                  Verificado
                </button>
              </div>
              <label>Solicitar nova correção</label>
              <AutoResizeTextarea value={mensagemCorrecao} onChange={event => setMensagemCorrecao(event.target.value)} placeholder="Descreva o que ainda precisa ser ajustado" />
              <button type="button" className="btn" disabled={salvando || !mensagemCorrecao.trim()} onClick={() => executar('correcao')}>
                Enviar correção
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Processa novo problema form conforme as regras do dominio.
 */
function NovoProblemaForm({ venda, onSalvo }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [modo, setModo] = useState('responsaveis');
  const [destinatarios, setDestinatarios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  /**
   * Abre  e prepara o estado necessario.
   */
  async function abrir() {
    setAberto(true);
    setErro('');
    try {
      setUsuarios(await listarDestinatariosProblemaVenda());
    } catch {
      setUsuarios([]);
    }
  }

  /**
   * Fecha  e limpa o estado relacionado.
   */
  function fechar() {
    setAberto(false);
    setMotivo('');
    setModo('responsaveis');
    setDestinatarios([]);
    setErro('');
  }

  /**
   * Alterna usuario no estado atual.
   */
  function toggleUsuario(id) {
    setDestinatarios(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  }

  /**
   * Salva  com os dados informados.
   */
  async function salvar() {
    setErro('');
    setSalvando(true);
    try {
      const novo = await marcarProblemaVenda(venda.id, {
        motivo,
        modo_destinatario: modo === 'manual' ? 'manual' : 'responsaveis',
        destinatarios
      });
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
      fechar();
      onSalvo(novo);
    } catch (error) {
      setErro(error.message || 'Erro ao marcar problema.');
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn btn-danger btn-sm venda-problema-novo-btn" onClick={abrir}>
        + Adicionar problema
      </button>
    );
  }

  return (
    <div className="venda-problema-novo-form">
      <div className="form-field">
        <label>Motivo do problema</label>
        <AutoResizeTextarea
          value={motivo}
          onChange={event => setMotivo(event.target.value)}
          placeholder="Explique por que esta venda está com problema"
        />
      </div>
      <div className="venda-problema-recipient-mode">
        <label>
          <input type="radio" checked={modo === 'responsaveis'} onChange={() => setModo('responsaveis')} />
          Enviar aos responsáveis da venda
        </label>
        <label>
          <input type="radio" checked={modo === 'manual'} onChange={() => setModo('manual')} />
          Escolher manualmente
        </label>
      </div>
      {modo === 'manual' && (
        <div className="venda-problema-user-list">
          {usuarios.map(u => (
            <label key={u.id}>
              <input type="checkbox" checked={destinatarios.includes(u.id)} onChange={() => toggleUsuario(u.id)} />
              <span>{u.nome}</span>
              <em>{u.email}</em>
            </label>
          ))}
        </div>
      )}
      {erro && <div className="alert-error">{erro}</div>}
      <div className="venda-problema-novo-form-actions">
        <button type="button" className="btn" onClick={fechar} disabled={salvando}>Cancelar</button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={salvando || !motivo.trim() || (modo === 'manual' && destinatarios.length === 0)}
          onClick={salvar}
        >
          {salvando ? 'Enviando...' : 'Marcar problema'}
        </button>
      </div>
    </div>
  );
}

/**
 * Processa venda problema panel conforme as regras do dominio.
 */
function VendaProblemaPanel({ venda, usuario, initialProblemaId }) {
  const [problemas, setProblemas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const podeAdicionarProblema = temPermissao(usuario, 'pos_venda');

  useEffect(() => {
    if (!venda?.id) return undefined;
    let ativo = true;
    listarProblemasVenda(venda.id)
      .then(data => { if (ativo) setProblemas(data); })
      .catch(error => { if (ativo) setErro(error.message || 'Erro ao carregar problemas da venda.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [venda?.id]);

  useEffect(() => {
    if (!initialProblemaId || problemas.length === 0) return undefined;

    const timer = setTimeout(() => {
      document.getElementById(`problema-${initialProblemaId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 80);

    return () => clearTimeout(timer);
  }, [initialProblemaId, problemas.length]);

  /**
   * Atualiza problema com os dados informados.
   */
  function atualizarProblema(problemaId, atualizado) {
    setProblemas(prev => {
      if (atualizado?.status === 'verificado') {
        return prev.filter(item => Number(item.id) !== Number(problemaId));
      }

      return prev.map(item => Number(item.id) === Number(problemaId) ? atualizado : item);
    });
  }

  /**
   * Adiciona problema ao conjunto atual.
   */
  function adicionarProblema(novo) {
    setProblemas(prev => [...prev, novo]);
  }

  if (!venda?.id) {
    return <div className="venda-problema-empty">Salve a venda antes de acompanhar problemas.</div>;
  }

  if (carregando) {
    return <div className="venda-problema-empty">Carregando problemas da venda...</div>;
  }

  if (erro && problemas.length === 0) {
    return (
      <>
        <div className="alert-error">{erro}</div>
        {podeAdicionarProblema && <NovoProblemaForm venda={venda} onSalvo={adicionarProblema} />}
      </>
    );
  }

  if (problemas.length === 0) {
    return (
      <div className="venda-problema-panel">
        <div className="venda-problema-empty">Nenhum problema ativo para esta venda.</div>
        {podeAdicionarProblema && <NovoProblemaForm venda={venda} onSalvo={adicionarProblema} />}
      </div>
    );
  }

  return (
    <div className="venda-problema-panel">
      <div className="venda-problema-summary">
        <strong>{problemas.length} problema{problemas.length === 1 ? '' : 's'} ativo{problemas.length === 1 ? '' : 's'}</strong>
        <span>Cada problema possui responsáveis, histórico e revisão independentes.</span>
      </div>

      {erro && <div className="alert-error">{erro}</div>}
      {problemas.map(problema => (
        <VendaProblemaCard
          key={problema.id}
          problema={problema}
          usuario={usuario}
          destacado={Number(problema.id) === Number(initialProblemaId)}
          onAtualizar={atualizarProblema}
        />
      ))}
      {podeAdicionarProblema && <NovoProblemaForm venda={venda} onSalvo={adicionarProblema} />}
    </div>
  );
}

export default VendaProblemaPanel;
