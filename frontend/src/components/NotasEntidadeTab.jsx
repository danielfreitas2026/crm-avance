import { useEffect, useMemo, useState } from 'react';
import AutoResizeTextarea from './AutoResizeTextarea';
import * as I from './Icons';
import {
  atualizarNota,
  criarNotaEntidade,
  excluirNota,
  listarNotasEntidade
} from '../services/nota.service';
import { formatUtcDateTime, localDateTimeInputToUtc, toLocalDateTimeInputFromUtc } from '../utils/datetime';

const NOTA_VAZIA = { titulo: '', conteudo: '', retorno_agendado_para: null };

/**
 * Formata data nota para exibicao ou envio.
 */
function formatarDataNota(valor) {
  return formatUtcDateTime(valor, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Renderiza formatar data input.
 */
function formatarDataInput(valor) {
  return toLocalDateTimeInputFromUtc(valor);
}

/**
 * Monta draft nota a partir dos dados informados.
 */
function montarDraftNota(nota = NOTA_VAZIA) {
  return {
    titulo: nota.titulo || '',
    conteudo: nota.conteudo || '',
    retorno_agendado_para: nota.retorno_agendado_para ? formatarDataInput(nota.retorno_agendado_para) : null
  };
}

function montarPayloadNota(nota) {
  return {
    ...nota,
    retorno_agendado_para: nota.retorno_agendado_para
      ? localDateTimeInputToUtc(nota.retorno_agendado_para)
      : nota.retorno_agendado_para
  };
}
/**
 * Processa nota editor conforme as regras do dominio.
 */
function NotaEditor({ value, salvando, onChange, onCancel, onSave, saveLabel = 'Salvar' }) {
  const podeSalvar = String(value.titulo || '').trim() || String(value.conteudo || '').trim();
  const retornoAtivo = value.retorno_agendado_para !== null && value.retorno_agendado_para !== undefined;

  return (
    <div className="note-editor">
      <input
        value={value.titulo}
        onChange={event => onChange({ ...value, titulo: event.target.value })}
        onKeyDown={event => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        placeholder="Título (opcional)"
      />
      <AutoResizeTextarea
        value={value.conteudo}
        onChange={event => onChange({ ...value, conteudo: event.target.value })}
        placeholder="Escreva uma anotação..."
        minRows={3}
        maxRows={8}
      />
      <div className="note-return">
        <button
          type="button"
          className={`btn btn-sm ${retornoAtivo ? 'btn-primary' : ''}`}
          onClick={() => onChange({
            ...value,
            retorno_agendado_para: retornoAtivo ? null : ''
          })}
          disabled={salvando}
        >
          <I.Calendar size={13} /> Marcar retorno
        </button>

        {retornoAtivo && (
          <label className="note-return__field">
            <span>Data e hora</span>
            <input
              type="datetime-local"
              value={value.retorno_agendado_para || ''}
              onChange={event => onChange({ ...value, retorno_agendado_para: event.target.value })}
            />
          </label>
        )}
      </div>
      <div className="note-editor__actions">
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={salvando}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={onSave}
          disabled={salvando || !podeSalvar || (retornoAtivo && !value.retorno_agendado_para)}
        >
          {salvando ? 'Salvando...' : saveLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Renderiza notas entidade tab.
 */
function NotasEntidadeTab({ tipo, entidadeId, pendingNotas = [], onPendingNotasChange = () => {} }) {
  const [notas, setNotas] = useState([]);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [draftNova, setDraftNova] = useState(NOTA_VAZIA);
  const [editandoId, setEditandoId] = useState(null);
  const [draftEdicao, setDraftEdicao] = useState(NOTA_VAZIA);
  const [salvando, setSalvando] = useState(false);
  const [chaveNotasCarregadas, setChaveNotasCarregadas] = useState('');
  const chaveNotas = entidadeId ? `${tipo}:${entidadeId}` : '';
  const carregandoVisivel = Boolean(chaveNotas && chaveNotasCarregadas !== chaveNotas);

  const labelEntidade = useMemo(() => {
    if (tipo === 'cliente') return 'cliente';
    if (tipo === 'lead') return 'lead';
    return 'venda';
  }, [tipo]);

  useEffect(() => {
    if (!entidadeId) return undefined;
    let ativo = true;

    listarNotasEntidade(tipo, entidadeId)
      .then(data => {
        if (!ativo) return;
        setNotas(Array.isArray(data) ? data : []);
        setErro('');
        setChaveNotasCarregadas(chaveNotas);
      })
      .catch(error => {
        if (!ativo) return;
        setErro(error.message || 'Erro ao carregar notas.');
        setChaveNotasCarregadas(chaveNotas);
      });

    return () => {
      ativo = false;
    };
  }, [tipo, entidadeId, chaveNotas]);

  /**
   * Executa a acao de iniciar nova nota mantendo o estado da tela consistente.
   */
  function iniciarNovaNota() {
    setCriando(true);
    setDraftNova(NOTA_VAZIA);
    setEditandoId(null);
  }

  /**
   * Executa a acao de iniciar edicao mantendo o estado da tela consistente.
   */
  function iniciarEdicao(nota) {
    setEditandoId(nota.id);
    setDraftEdicao(montarDraftNota(nota));
    setCriando(false);
  }

  /**
   * Adiciona pendente ao conjunto atual.
   */
  function adicionarPendente() {
    onPendingNotasChange([...pendingNotas, { ...draftNova }]);
    setCriando(false);
    setDraftNova(NOTA_VAZIA);
  }

  /**
   * Remove pendente da colecao ou estado atual.
   */
  function removerPendente(idx) {
    onPendingNotasChange(pendingNotas.filter((_, i) => i !== idx));
  }

  /**
   * Processa notificar atualizar conforme as regras do dominio.
   */
  function notificarAtualizar(notasAtualizadas) {
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    if (tipo === 'cliente' && entidadeId) {
      window.dispatchEvent(new CustomEvent('pos-venda:notas-cliente-atualizar', {
        detail: { clienteId: Number(entidadeId), notas: notasAtualizadas }
      }));
    }
  }

  /**
   * Salva nova nota com os dados informados.
   */
  async function salvarNovaNota() {
    setSalvando(true);
    setErro('');

    try {
      const nota = await criarNotaEntidade(tipo, entidadeId, montarPayloadNota(draftNova));
      const novasNotas = [nota, ...notas];
      setNotas(novasNotas);
      setCriando(false);
      setDraftNova(NOTA_VAZIA);
      notificarAtualizar(novasNotas);
    } catch (error) {
      setErro(error.message || 'Erro ao criar nota.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Salva edicao com os dados informados.
   */
  async function salvarEdicao() {
    if (!editandoId) return;

    setSalvando(true);
    setErro('');

    try {
      const nota = await atualizarNota(editandoId, montarPayloadNota(draftEdicao));
      const novasNotas = notas.map(item => item.id === nota.id ? nota : item);
      setNotas(novasNotas);
      setEditandoId(null);
      setDraftEdicao(NOTA_VAZIA);
      notificarAtualizar(novasNotas);
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar nota.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Remove nota da colecao ou estado atual.
   */
  async function removerNota(nota) {
    const confirmado = window.confirm('Excluir esta nota?');
    if (!confirmado) return;

    setSalvando(true);
    setErro('');

    try {
      await excluirNota(nota.id);
      const novasNotas = notas.filter(item => item.id !== nota.id);
      setNotas(novasNotas);
      notificarAtualizar(novasNotas);
    } catch (error) {
      setErro(error.message || 'Erro ao excluir nota.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Remove retorno da colecao ou estado atual.
   */
  async function removerRetorno(nota) {
    setSalvando(true);
    setErro('');

    try {
      const notaAtualizada = await atualizarNota(nota.id, {
        titulo: nota.titulo || '',
        conteudo: nota.conteudo || '',
        retorno_agendado_para: null
      });
      const novasNotas = notas.map(item => item.id === notaAtualizada.id ? notaAtualizada : item);
      setNotas(novasNotas);
      notificarAtualizar(novasNotas);
    } catch (error) {
      setErro(error.message || 'Erro ao remover retorno.');
    } finally {
      setSalvando(false);
    }
  }

  // Modo offline: cliente/venda ainda não foi salvo
  if (!entidadeId) {
    return (
      <div className="notes-tab">
        <div className="notes-toolbar">
          <div>
            <strong>Minhas notas</strong>
            <span>{pendingNotas.length} anotação(ões)</span>
          </div>
          {!criando && (
            <button type="button" className="btn btn-sm btn-primary" onClick={iniciarNovaNota}>
              <I.Plus size={13} /> Nova nota
            </button>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
          As notas serão salvas automaticamente ao salvar o {labelEntidade}.
        </p>

        {criando && (
          <NotaEditor
            value={draftNova}
            salvando={false}
            onChange={setDraftNova}
            onCancel={() => { setCriando(false); setDraftNova(NOTA_VAZIA); }}
            onSave={adicionarPendente}
            saveLabel="Adicionar"
          />
        )}

        {pendingNotas.length === 0 && !criando ? (
          <div className="notes-empty notes-empty--compact">
            <I.Note size={20} />
            <strong>Nenhuma nota ainda.</strong>
            <span>Crie uma nota para guardar lembretes sobre este {labelEntidade}.</span>
          </div>
        ) : (
          <div className="notes-list">
            {pendingNotas.map((nota, idx) => (
              <article key={idx} className="note-card">
                <div className="note-card__head">
                  <div>
                    <strong>{nota.titulo || 'Sem título'}</strong>
                    {nota.retorno_agendado_para && (
                      <span><I.Calendar size={12} /> Retorno: {formatarDataNota(nota.retorno_agendado_para)}</span>
                    )}
                  </div>
                  <div className="note-card__actions">
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-danger-icon"
                      title="Remover nota"
                      onClick={() => removerPendente(idx)}
                    >
                      <I.Trash size={13} />
                    </button>
                  </div>
                </div>
                {nota.conteudo && <p>{nota.conteudo}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="notes-tab">
      <div className="notes-toolbar">
        <div>
          <strong>Minhas notas</strong>
          <span>{notas.length} anotação(ões)</span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={iniciarNovaNota} disabled={criando || salvando}>
          <I.Plus size={13} /> Nova nota
        </button>
      </div>

      {erro && <div className="alert-error">{erro}</div>}

      {criando && (
        <NotaEditor
          value={draftNova}
          salvando={salvando}
          onChange={setDraftNova}
          onCancel={() => {
            setCriando(false);
            setDraftNova(NOTA_VAZIA);
          }}
          onSave={salvarNovaNota}
        />
      )}

      {carregandoVisivel ? (
        <div className="notes-loading">Carregando notas...</div>
      ) : notas.length === 0 && !criando ? (
        <div className="notes-empty notes-empty--compact">
          <I.Note size={20} />
          <strong>Nenhuma nota ainda.</strong>
          <span>Crie uma nota para guardar lembretes sobre este {labelEntidade}.</span>
        </div>
      ) : (
        <div className="notes-list">
          {notas.map(nota => (
            <article key={nota.id} className="note-card">
              {editandoId === nota.id ? (
                <NotaEditor
                  value={draftEdicao}
                  salvando={salvando}
                  onChange={setDraftEdicao}
                  onCancel={() => {
                    setEditandoId(null);
                    setDraftEdicao(NOTA_VAZIA);
                  }}
                  onSave={salvarEdicao}
                />
              ) : (
                <>
                  <div className="note-card__head">
                    <div>
                      <strong>{nota.titulo || 'Sem título'}</strong>
                      <span>{formatarDataNota(nota.updated_at)}</span>
                    </div>
                    <div className="note-card__actions">
                      <button type="button" className="btn btn-icon btn-ghost" title="Editar nota" onClick={() => iniciarEdicao(nota)} disabled={salvando}>
                        <I.Edit size={13} />
                      </button>
                      <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" title="Excluir nota" onClick={() => removerNota(nota)} disabled={salvando}>
                        <I.Trash size={13} />
                      </button>
                    </div>
                  </div>
                  <p>{nota.conteudo || '-'}</p>
                  {nota.retorno_agendado_para && (
                    <div className="note-card__return">
                      <span><I.Calendar size={13} /> Retorno em {formatarDataNota(nota.retorno_agendado_para)}</span>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => removerRetorno(nota)} disabled={salvando}>
                        Remover
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotasEntidadeTab;
