import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as I from '../Icons';
import AutoResizeTextarea from '../AutoResizeTextarea';
import { formatUtcDateTime } from '../../utils/datetime';
import { chaveDataMensagem, rotuloDataMensagem } from './chatFlutuante.utils';
import {
  baixarAnexoMensagem,
  enviarMensagem,
  enviarMensagensEmLote,
  listarContatos,
  listarConversas,
  listarMensagens,
  uploadAnexoMensagem
} from '../../services/mensagem.service';
import './ChatFlutuante.css';

const INTERVALO_CONVERSAS = 10000;
const INTERVALO_MENSAGENS = 3500;
const ANEXO_TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ANEXO_TAMANHO_MAX_MB = 50;

function iniciais(nome) {
  return String(nome || '?').split(' ').filter(Boolean).map(parte => parte[0]).join('').slice(0, 2).toUpperCase();
}

function Avatar({ contato }) {
  if (contato?.foto_perfil) return <span className="chat-flutuante__avatar"><img src={contato.foto_perfil} alt="" /></span>;
  return <span className="chat-flutuante__avatar chat-flutuante__avatar--iniciais">{iniciais(contato?.nome)}</span>;
}

function hora(valor) {
  return formatUtcDateTime(valor, { hour: '2-digit', minute: '2-digit' });
}

function formatarTamanho(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function AnexoCompacto({ anexo, temporario = false }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [baixando, setBaixando] = useState(false);
  const ehImagem = anexo?.mime_type?.startsWith('image/');

  useEffect(() => {
    if (!anexo || !ehImagem || temporario) return undefined;
    let url;
    let cancelado = false;
    baixarAnexoMensagem(anexo.id).then(blob => {
      if (cancelado) return;
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
    }).catch(() => {});
    return () => {
      cancelado = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [anexo, ehImagem, temporario]);

  async function baixar() {
    if (temporario || baixando) return;
    setBaixando(true);
    try {
      const blob = await baixarAnexoMensagem(anexo.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = anexo.nome_original || 'anexo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBaixando(false);
    }
  }

  if (ehImagem && objectUrl) {
    return <button type="button" className="chat-flutuante__anexo chat-flutuante__anexo--imagem" onClick={baixar}><img src={objectUrl} alt={anexo.nome_original} /></button>;
  }

  return (
    <button type="button" className="chat-flutuante__anexo" onClick={baixar} disabled={temporario || baixando}>
      <I.Document size={22} />
      <span><strong>{anexo.nome_original}</strong><small>{temporario ? 'Enviando...' : formatarTamanho(anexo.tamanho_bytes)}</small></span>
      {!temporario && <I.Download size={14} />}
    </button>
  );
}

/** Mantém as conversas disponíveis em qualquer tela sem substituir a página completa. */
function ChatFlutuante({ usuario, naoLidas = 0 }) {
  const [aberto, setAberto] = useState(false);
  const [novaConversa, setNovaConversa] = useState(false);
  const [busca, setBusca] = useState('');
  const [contatos, setContatos] = useState([]);
  const [conversas, setConversas] = useState([]);
  const [contatoSelecionado, setContatoSelecionado] = useState(null);
  const [destinatariosSelecionados, setDestinatariosSelecionados] = useState([]);
  const [mensagens, setMensagens] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [texto, setTexto] = useState('');
  const [anexoPendente, setAnexoPendente] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const listaRef = useRef(null);
  const campoRef = useRef(null);
  const inputAnexoRef = useRef(null);
  const tempIdRef = useRef(0);

  const carregarConversas = useCallback(async () => {
    try {
      const dados = await listarConversas();
      setConversas(Array.isArray(dados) ? dados : []);
    } catch {
      setConversas([]);
    }
  }, []);

  const carregarMensagens = useCallback(async (contatoId, rolar = false) => {
    try {
      const dados = await listarMensagens(contatoId);
      setMensagens(Array.isArray(dados) ? dados : []);
      if (rolar) requestAnimationFrame(() => {
        if (listaRef.current) listaRef.current.scrollTop = listaRef.current.scrollHeight;
      });
      window.dispatchEvent(new CustomEvent('pos-venda:mensagens-atualizar'));
    } catch {
      setErro('Não foi possível carregar as mensagens.');
    }
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    carregarConversas();
    listarContatos().then(dados => setContatos(Array.isArray(dados) ? dados : [])).catch(() => setContatos([]));
    const timer = setInterval(carregarConversas, INTERVALO_CONVERSAS);
    return () => clearInterval(timer);
  }, [aberto, carregarConversas]);

  useEffect(() => {
    if (!aberto || !contatoSelecionado?.id) return undefined;
    carregarMensagens(contatoSelecionado.id, true);
    const timer = setInterval(() => carregarMensagens(contatoSelecionado.id), INTERVALO_MENSAGENS);
    return () => clearInterval(timer);
  }, [aberto, contatoSelecionado?.id, carregarMensagens]);

  useEffect(() => {
    if (aberto && (contatoSelecionado || novaConversa)) campoRef.current?.focus();
  }, [aberto, contatoSelecionado, novaConversa]);

  const contatosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase();
    return termo ? contatos.filter(contato => contato.nome?.toLocaleLowerCase().includes(termo)) : contatos;
  }, [busca, contatos]);
  const todosFiltradosSelecionados = contatosFiltrados.length > 0 && contatosFiltrados.every(contato => destinatariosSelecionados.includes(Number(contato.id)));

  function limparCompositor() {
    setTexto('');
    setAnexoPendente(null);
    setErro('');
    setSucesso('');
  }

  function selecionarContato(contato) {
    limparCompositor();
    setMensagens([]);
    setPendentes([]);
    setNovaConversa(false);
    setDestinatariosSelecionados([]);
    setBusca('');
    setContatoSelecionado(contato);
  }

  function abrirNovaConversa() {
    limparCompositor();
    setAberto(true);
    setContatoSelecionado(null);
    setBusca('');
    setDestinatariosSelecionados([]);
    setNovaConversa(true);
  }

  function alternarDestinatario(contatoId) {
    const id = Number(contatoId);
    setDestinatariosSelecionados(atuais => atuais.includes(id) ? atuais.filter(item => item !== id) : [...atuais, id]);
  }

  function alternarTodosFiltrados() {
    const ids = contatosFiltrados.map(contato => Number(contato.id));
    setDestinatariosSelecionados(atuais => todosFiltradosSelecionados
      ? atuais.filter(id => !ids.includes(id))
      : Array.from(new Set([...atuais, ...ids])));
  }

  function abrirSelecaoArquivo() {
    inputAnexoRef.current?.click();
  }

  async function selecionarArquivo(evento) {
    const file = evento.target.files?.[0];
    evento.target.value = '';
    if (!file) return;
    if (!ANEXO_TIPOS_PERMITIDOS.includes(file.type)) {
      setErro('Use PDF, JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > ANEXO_TAMANHO_MAX_MB * 1024 * 1024) {
      setErro(`Arquivo maior que ${ANEXO_TAMANHO_MAX_MB} MB.`);
      return;
    }
    setErro('');
    setAnexoPendente({ file, nome: file.name, tamanho: file.size, status: 'enviando' });
    try {
      const resultado = await uploadAnexoMensagem(file);
      setAnexoPendente(atual => atual?.file === file ? { ...atual, ...resultado, status: 'pronto' } : atual);
    } catch (error) {
      setAnexoPendente(atual => atual?.file === file ? { ...atual, status: 'erro', erro: error.message || 'Falha no upload.' } : atual);
    }
  }

  async function enviarIndividual(evento) {
    evento.preventDefault();
    const conteudo = texto.trim();
    const anexoPronto = anexoPendente?.status === 'pronto' ? anexoPendente : null;
    if (!contatoSelecionado || enviando || (!conteudo && !anexoPronto) || (anexoPendente && !anexoPronto)) return;
    const tempId = `temp-${++tempIdRef.current}`;
    const temporaria = {
      id: tempId,
      remetente_id: Number(usuario?.id),
      destinatario_id: contatoSelecionado.id,
      conteudo: conteudo || null,
      recebida_em: null,
      lida_em: null,
      created_at: new Date().toISOString(),
      anexo: anexoPronto ? { id: tempId, nome_original: anexoPronto.nome_original, mime_type: anexoPronto.file.type, tamanho_bytes: anexoPronto.tamanho } : null
    };
    setEnviando(true);
    setErro('');
    setTexto('');
    setAnexoPendente(null);
    setPendentes(atuais => [...atuais, temporaria]);
    try {
      await enviarMensagem(contatoSelecionado.id, conteudo, anexoPronto ? { arquivo_id: anexoPronto.arquivo_id, nome_original: anexoPronto.nome_original } : null);
      setPendentes(atuais => atuais.filter(item => item.id !== tempId));
      await Promise.all([carregarMensagens(contatoSelecionado.id, true), carregarConversas()]);
    } catch (error) {
      setPendentes(atuais => atuais.filter(item => item.id !== tempId));
      setTexto(conteudo);
      setAnexoPendente(anexoPronto);
      setErro(error.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setEnviando(false);
    }
  }

  async function enviarLote(evento) {
    evento.preventDefault();
    const conteudo = texto.trim();
    const anexoPronto = anexoPendente?.status === 'pronto' ? anexoPendente : null;
    if (destinatariosSelecionados.length === 0 || enviando || (!conteudo && !anexoPronto) || (anexoPendente && !anexoPronto)) return;
    setEnviando(true);
    setErro('');
    setSucesso('');
    try {
      const resultado = await enviarMensagensEmLote(destinatariosSelecionados, conteudo, anexoPronto ? { arquivo_id: anexoPronto.arquivo_id, nome_original: anexoPronto.nome_original } : null);
      const falhas = Array.isArray(resultado?.falhas) ? resultado.falhas : [];
      const enviadas = Number(resultado?.resumo?.enviadas || 0);
      await carregarConversas();
      window.dispatchEvent(new CustomEvent('pos-venda:mensagens-atualizar'));
      if (falhas.length) {
        setDestinatariosSelecionados(falhas.map(item => Number(item.destinatario_id)).filter(Number.isFinite));
        setErro(`${enviadas} enviada(s). Falharam: ${falhas.map(item => item.motivo).join('; ')}`);
      } else {
        setTexto('');
        setAnexoPendente(null);
        setDestinatariosSelecionados([]);
        setNovaConversa(false);
        setSucesso(`Mensagem enviada para ${enviadas} pessoa(s).`);
      }
    } catch (error) {
      setErro(error.message || 'Não foi possível enviar as mensagens.');
    } finally {
      setEnviando(false);
    }
  }

  function fecharPainel() {
    setAberto(false);
    setNovaConversa(false);
    setErro('');
  }

  function renderFormulario(lote = false) {
    const handler = lote ? enviarLote : enviarIndividual;
    const bloqueado = enviando || (lote && destinatariosSelecionados.length === 0)
      || (!texto.trim() && anexoPendente?.status !== 'pronto')
      || (anexoPendente && anexoPendente.status !== 'pronto');
    return (
      <>
        {anexoPendente && (
          <div className={`chat-flutuante__anexo-pendente is-${anexoPendente.status}`}>
            <I.Document size={18} /><span><strong>{anexoPendente.nome}</strong><small>{anexoPendente.status === 'enviando' ? 'Enviando...' : anexoPendente.status === 'pronto' ? formatarTamanho(anexoPendente.tamanho) : anexoPendente.erro}</small></span>
            <button type="button" onClick={() => setAnexoPendente(null)} aria-label="Remover anexo"><I.Close size={13} /></button>
          </div>
        )}
        <form className="chat-flutuante__form" onSubmit={handler}>
          {erro && <p className="chat-flutuante__erro">{erro}</p>}
          <input ref={inputAnexoRef} type="file" accept={ANEXO_TIPOS_PERMITIDOS.join(',')} onChange={selecionarArquivo} hidden />
          <button type="button" className="chat-flutuante__anexar" onClick={abrirSelecaoArquivo} disabled={enviando || Boolean(anexoPendente)} aria-label="Anexar arquivo" title="Anexar arquivo"><I.Paperclip size={17} /></button>
          <AutoResizeTextarea
            ref={campoRef}
            minRows={1}
            maxRows={6}
            value={texto}
            placeholder={lote ? 'Escreva a mensagem...' : `Escreva para ${contatoSelecionado?.nome?.split(' ')[0] || ''}...`}
            onChange={evento => setTexto(evento.target.value)}
            onKeyDown={evento => {
              if (evento.key === 'Enter' && !evento.shiftKey) {
                evento.preventDefault();
                handler(evento);
              }
            }}
          />
          <button type="submit" className="chat-flutuante__enviar" disabled={bloqueado} aria-label="Enviar mensagem"><I.Send size={17} /></button>
        </form>
      </>
    );
  }

  const itensThread = [...mensagens, ...pendentes];
  const painel = (
    <div className="chat-flutuante" aria-live="polite">
      {aberto ? (
        <section className="chat-flutuante__painel" role="dialog" aria-label="Mensagens rápidas">
          <header className="chat-flutuante__cabecalho">
            {contatoSelecionado ? (
              <>
                <button type="button" className="chat-flutuante__icone" onClick={() => setContatoSelecionado(null)} aria-label="Voltar para conversas"><I.Return size={17} /></button>
                <Avatar contato={contatoSelecionado} />
                <div className="chat-flutuante__titulo"><strong>{contatoSelecionado.nome}</strong><span>{contatoSelecionado.role?.nome || 'Usuário'}</span></div>
                <button type="button" className="chat-flutuante__icone" onClick={abrirNovaConversa} aria-label="Nova mensagem" title="Nova mensagem"><I.Plus size={18} /></button>
              </>
            ) : (
              <>
                {novaConversa && <button type="button" className="chat-flutuante__icone" onClick={() => setNovaConversa(false)} aria-label="Voltar para conversas"><I.Return size={17} /></button>}
                {!novaConversa && <I.Chat size={19} />}
                <div className="chat-flutuante__titulo"><strong>{novaConversa ? 'Nova mensagem' : 'Mensagens'}</strong><span>{novaConversa ? `${destinatariosSelecionados.length} destinatário(s)` : 'Conversas internas'}</span></div>
                <button type="button" className="chat-flutuante__icone" onClick={novaConversa ? () => setNovaConversa(false) : abrirNovaConversa} aria-label={novaConversa ? 'Cancelar nova mensagem' : 'Nova mensagem'} title="Nova mensagem">{novaConversa ? <I.Close size={17} /> : <I.Plus size={18} />}</button>
              </>
            )}
            {naoLidas > 0 && (
              <span className="chat-flutuante__nao-lidas" aria-label={`${naoLidas} mensagem(ns) não visualizada(s)`} title="Mensagens não visualizadas">
                {naoLidas > 99 ? '99+' : naoLidas}
              </span>
            )}
            <button type="button" className="chat-flutuante__icone" onClick={fecharPainel} aria-label="Minimizar mensagens" title="Minimizar"><I.ChevronDown size={17} /></button>
          </header>

          {contatoSelecionado ? (
            <>
              <div className="chat-flutuante__mensagens" ref={listaRef}>
                {itensThread.length === 0 ? <p className="chat-flutuante__vazio">Nenhuma mensagem ainda. Diga olá!</p> : itensThread.map((mensagem, indice) => {
                  const minha = Number(mensagem.remetente_id) === Number(usuario?.id);
                  const status = mensagem.lida_em ? 'lida' : mensagem.recebida_em ? 'recebida' : 'enviada';
                  const excluida = Boolean(mensagem.excluida);
                  const temporaria = typeof mensagem.id === 'string' && mensagem.id.startsWith('temp-');
                  const dataAnterior = indice > 0 ? chaveDataMensagem(itensThread[indice - 1].created_at) : '';
                  const dataAtual = chaveDataMensagem(mensagem.created_at);
                  return (
                    <Fragment key={mensagem.id}>
                      {dataAtual !== dataAnterior && <div className="chat-flutuante__data"><span>{rotuloDataMensagem(mensagem.created_at)}</span></div>}
                      <div className={`chat-flutuante__bolha ${minha ? 'chat-flutuante__bolha--minha' : ''} ${excluida ? 'chat-flutuante__bolha--excluida' : ''}`}>
                        {excluida ? (mensagem.tinha_anexo ? 'Arquivo deletado' : 'Mensagem deletada') : <>{mensagem.anexo && <AnexoCompacto anexo={mensagem.anexo} temporario={temporaria} />}{mensagem.conteudo && <span className="chat-flutuante__texto">{mensagem.conteudo}</span>}</>}
                        <small>{hora(mensagem.created_at)}{minha && !excluida && <span className={`chat-flutuante__check is-${status}`} title={status === 'lida' ? 'Lido' : status === 'recebida' ? 'Recebido' : 'Enviado'}>{status === 'enviada' ? '✓' : '✓✓'}</span>}</small>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
              {renderFormulario()}
            </>
          ) : novaConversa ? (
            <>
              <div className="chat-flutuante__lote">
                <div className="chat-flutuante__busca"><I.Search size={15} /><input autoFocus value={busca} onChange={evento => setBusca(evento.target.value)} placeholder="Buscar usuário..." /></div>
                {contatosFiltrados.length > 0 && <button type="button" className="chat-flutuante__selecionar-todos" onClick={alternarTodosFiltrados}>{todosFiltradosSelecionados ? 'Desmarcar resultados' : 'Selecionar resultados'}</button>}
                {contatosFiltrados.map(contato => (
                  <label key={contato.id} className="chat-flutuante__contato chat-flutuante__contato--selecao">
                    <input type="checkbox" checked={destinatariosSelecionados.includes(Number(contato.id))} onChange={() => alternarDestinatario(contato.id)} />
                    <Avatar contato={contato} /><span><strong>{contato.nome}</strong><small>{contato.role?.nome || 'Usuário'}</small></span>
                  </label>
                ))}
                {!contatosFiltrados.length && <p className="chat-flutuante__vazio">Nenhum usuário encontrado.</p>}
              </div>
              {renderFormulario(true)}
            </>
          ) : (
            <div className="chat-flutuante__lista">
              {sucesso && <p className="chat-flutuante__sucesso">{sucesso}</p>}
              {conversas.length ? <><p className="chat-flutuante__lista-titulo">Recentes</p>{conversas.map(conversa => {
                const contato = conversa.contato;
                const ultima = conversa.ultima_mensagem;
                return <button key={contato.id} type="button" className="chat-flutuante__contato" onClick={() => selecionarContato(contato)}><Avatar contato={contato} /><span><strong>{contato.nome}</strong><small>{ultima?.conteudo || (ultima?.anexo ? '📎 Anexo' : 'Sem mensagens')}</small></span>{conversa.nao_lidas > 0 && <em>{conversa.nao_lidas > 9 ? '9+' : conversa.nao_lidas}</em>}</button>;
              })}</> : <p className="chat-flutuante__vazio">Nenhuma conversa ainda. Use + para iniciar.</p>}
            </div>
          )}
        </section>
      ) : (
        <div className="chat-flutuante__atalho">
          <button type="button" className="chat-flutuante__atalho-principal" onClick={() => setAberto(true)} aria-label="Abrir mensagens">
            <span className="chat-flutuante__atalho-avatar"><Avatar contato={usuario} /></span>
            <span className="chat-flutuante__atalho-mobile-icon" aria-hidden="true"><I.Chat size={21} /></span>
            <span className="chat-flutuante__atalho-titulo">Mensagens</span>
            {naoLidas > 0 && <em>{naoLidas > 99 ? '99+' : naoLidas}</em>}
          </button>
          <div className="chat-flutuante__atalho-acoes">
            <button type="button" onClick={abrirNovaConversa} aria-label="Nova mensagem" title="Nova mensagem"><I.Edit size={17} /></button>
            <button type="button" onClick={() => setAberto(true)} aria-label="Expandir mensagens" title="Expandir mensagens"><I.ChevronDown className="chat-flutuante__chevron--abrir" size={17} /></button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(painel, document.body);
}

export default ChatFlutuante;
