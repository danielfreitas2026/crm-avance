
/**
 * Renderiza planos manager modal.
 */
function PlanosManagerModal({ onClose = () => {} }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fechamento-modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-client">Gestão de planos removida</div>
        </div>
        <div className="modal-body" style={{ padding: 16 }}>
          A funcionalidade de planos foi removida do sistema.
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default PlanosManagerModal;
