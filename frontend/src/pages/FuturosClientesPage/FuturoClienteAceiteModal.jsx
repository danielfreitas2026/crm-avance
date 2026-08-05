import { useState } from 'react';
import * as I from '../../components/Icons';
import {
  aceitarFuturoCliente,
  recusarFuturoCliente
} from '../../services/lead-planilha.service';

function FuturoClienteAceiteModal({ linha, onClose, onAceito, onRecusado }) {
  const [processando, setProcessando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  async function aceitar() {
    setProcessando(true);
    setErro('');
    try {
      const resultado = await aceitarFuturoCliente(linha.id);
      onAceito({
        ...resultado.linha,
        distribuicao: resultado.distribuicao,
        detalhes_bloqueados: false
      });
    } catch (error) {
      setErro(error.message || 'Erro ao aceitar a indicação.');
      setProcessando(false);
    }
  }

  async function recusar() {
    setProcessando(true);
    setErro('');
    try {
      await recusarFuturoCliente(linha.id, motivo);
      onRecusado();
    } catch (error) {
      setErro(error.message || 'Erro ao recusar a indicação.');
      setProcessando(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal adicionar-lead-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aceite-indicacao-titulo"
      >
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client" id="aceite-indicacao-titulo">Nova indicação</div>
              <div className="modal-sub">Os dados serão liberados somente depois do aceite.</div>
            </div>
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              title="Fechar"
              aria-label="Fechar modal"
              onClick={onClose}
              disabled={processando}
            >
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="trash-warning">
            <I.History size={20} />
            <div>
              <strong>Ao aceitar, você terá 30 minutos para registrar uma ação no CRM.</strong>
              <span>Venda, cliente recusou, chamada não atendida ou retorno agendado encerram a contagem.</span>
            </div>
          </div>

          <label className="form-field" style={{ marginTop: 16 }}>
            <span>Motivo da recusa (opcional)</span>
            <textarea
              rows={3}
              maxLength={255}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              disabled={processando}
            />
          </label>
          {erro && <div className="alert-error" style={{ marginTop: 12 }}>{erro}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-danger" onClick={recusar} disabled={processando}>
            {processando ? 'Processando...' : 'Recusar indicação'}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={processando}>Agora não</button>
          <button type="button" className="btn btn-primary" onClick={aceitar} disabled={processando}>
            {processando ? 'Processando...' : 'Aceitar e ver detalhes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FuturoClienteAceiteModal;
