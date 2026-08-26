import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as I from '../Icons';
import { formatUtcDateTime } from '../../utils/datetime';
import './RetornoFuturoClientePopup.css';

const FORMATACAO_RETORNO = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo'
};

/** Aviso global que se sobrepoe sem desmontar o modal ou a tela em uso. */
function RetornoFuturoClientePopup({ notificacao, atendimentoUrl, onConfirmar }) {
  const dialogRef = useRef(null);
  const botaoPrincipalRef = useRef(null);
  const focoAnteriorRef = useRef(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');
  const notificacaoId = notificacao?.id;

  async function confirmarVisualizacao() {
    if (confirmando) return false;
    setConfirmando(true);
    setErro('');
    try {
      await onConfirmar(notificacao);
      return true;
    } catch (error) {
      setErro(error.message || 'Não foi possível confirmar o aviso. Tente novamente.');
      return false;
    } finally {
      setConfirmando(false);
    }
  }

  useEffect(() => {
    focoAnteriorRef.current = document.activeElement;
    botaoPrincipalRef.current?.focus();

    function interceptarTeclado(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        botaoPrincipalRef.current?.click();
        return;
      }

      if (event.key === 'Tab') {
        const focaveis = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href]') || [])];
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (!dialogRef.current.contains(document.activeElement)
          || (event.shiftKey && document.activeElement === primeiro)
          || (!event.shiftKey && document.activeElement === ultimo)) {
          event.preventDefault();
          (event.shiftKey ? ultimo : primeiro).focus();
        }
      }
    }

    window.addEventListener('keydown', interceptarTeclado, true);
    return () => {
      window.removeEventListener('keydown', interceptarTeclado, true);
      if (focoAnteriorRef.current?.isConnected) focoAnteriorRef.current.focus();
    };
  }, [notificacaoId]);

  if (!notificacao) return null;

  const dados = notificacao.dados || {};
  const nome = dados.titulo_nota || notificacao.titulo || 'Futuro cliente';
  const retornoFormatado = formatUtcDateTime(
    dados.retorno_agendado_para,
    FORMATACAO_RETORNO,
    'Horário não informado'
  );

  return createPortal(
    <div className="retorno-futuro-popup-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="retorno-futuro-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retorno-futuro-popup-titulo"
        aria-describedby="retorno-futuro-popup-descricao"
      >
        <div className="retorno-futuro-popup__icone" aria-hidden="true">
          <I.Bell size={25} />
        </div>
        <div className="retorno-futuro-popup__conteudo">
          <span className="retorno-futuro-popup__sobrelinha">Retorno em até 15 minutos</span>
          <h2 id="retorno-futuro-popup-titulo">Hora de retornar para {nome}</h2>
          <p id="retorno-futuro-popup-descricao">
            O retorno deste futuro cliente está marcado para <strong>{retornoFormatado}</strong>.
          </p>
          {erro && <div className="alert-error" role="alert">{erro}</div>}
          <div className="retorno-futuro-popup__acoes">
            <button
              ref={botaoPrincipalRef}
              type="button"
              className="btn btn-secondary"
              disabled={confirmando}
              onClick={() => void confirmarVisualizacao()}
            >
              {confirmando ? 'Confirmando...' : 'Entendi'}
            </button>
            {atendimentoUrl && (
              <a
                className="btn btn-primary"
                href={atendimentoUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void confirmarVisualizacao()}
              >
                Atender agora <I.External size={14} />
              </a>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export default RetornoFuturoClientePopup;
