import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Estrutura comum dos detalhes; o diálogo nativo mantém o foco dentro do modal. */
export default function HistoricoDetalheModal({ children, actions, onClose, suspenso = false }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const origemRef = useRef(null);
  const titleId = useId();

  useLayoutEffect(() => { origemRef.current = document.activeElement; }, []);

  useLayoutEffect(() => {
    if (suspenso) return undefined;
    const dialog = dialogRef.current;
    const overflowAnterior = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    closeRef.current.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflowAnterior;
      if (origemRef.current?.isConnected) origemRef.current.focus();
    };
  }, [suspenso]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="history-detail-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        // O backdrop nativo pertence ao diálogo; cliques no cartão não fecham.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="history-detail-card">
        <header className="history-detail-header">
          <h3 id={titleId}>Detalhes do Registro</h3>
          <div className="history-detail-actions">
            {actions}
            <button ref={closeRef} type="button" className="history-detail-close" onClick={onClose} aria-label="Fechar">
              ×
            </button>
          </div>
        </header>
        <div className="history-detail-body">{children}</div>
      </div>
    </dialog>,
    document.body
  );
}
