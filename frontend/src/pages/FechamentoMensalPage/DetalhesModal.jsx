import { useEffect, useState } from 'react';
import * as I from '../../components/Icons';
import { getDetalhes } from '../../services/fechamento.service';

/**
 * Formata moeda para exibicao.
 */
function fmtMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata data para exibicao.
 */
function fmtData(valor) {
  if (!valor) return '—';
  const iso = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Processa venda teve retorno conforme as regras do dominio.
 */
function vendaTeveRetorno(venda = {}) {
  return venda.status_funil !== 'retorno' && Boolean(venda.retornou_em || venda.motivo_retorno || venda.status_anterior_retorno);
}

/**
 * Formata retorno badge para exibicao.
 */
function fmtRetornoBadge(venda = {}) {
  if (venda.retornou_em) return `Já retornou em ${fmtData(venda.retornou_em)}`;
  return 'Já retornou';
}

const STATUS_LABEL = {
  aprovacao: 'Aprovação',
  ativacao: 'Ativação',
  envio: 'Envio',
  entrega: 'Entrega',
  confirmacao: 'Confirmação',
  concluido: 'Concluído',
  retorno: 'Retorno'
};

/**
 * Renderiza detalhes modal.
 */
function DetalhesModal({ secao, periodo, onClose }) {
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let ativo = true;
    getDetalhes({ secao, ...periodo })
      .then(lista => {
        if (!ativo) return;
        setDados(Array.isArray(lista) ? lista : []);
      })
      .catch(err => {
        if (!ativo) return;
        setErro(err?.message || 'Erro ao carregar detalhes.');
      })
      .finally(() => {
        if (!ativo) return;
        setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [secao, periodo]);

  const titulosSecao = {
    total: 'Detalhes — Total de vendas',
    tratando: 'Detalhes — Contratos tratando',
    ativas: 'Detalhes — Vendas ativas'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fechamento-modal-large" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">{titulosSecao[secao] || 'Detalhes'}</div>
              <div className="modal-sub">
                {dados.length} venda(s) no período selecionado
              </div>
            </div>
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Fechar">
              <I.Close size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {erro && (
            <div className="alert-error" style={{ margin: 16 }}>{erro}</div>
          )}
          {loading ? (
            <div className="fechamento-empty">Carregando...</div>
          ) : dados.length === 0 ? (
            <div className="fechamento-empty">Nenhuma venda nesta seção.</div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
              <table className="fechamento-modal-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Data da venda</th>
                    <th>Data de ativação</th>
                    <th>Vendedora</th>
                    <th>Cliente</th>
                    <th>CNPJ</th>
                    <th>Operadora</th>
                    <th>GB</th>
                    <th>Tipo</th>
                    <th>Serviço</th>
                    <th className="num">Linhas</th>
                    <th className="num">Valor</th>
                    <th className="num">Vencimento</th>
                    <th>Fidelidade</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.map(venda => (
                    <tr key={venda.id}>
                      <td>{venda.id}</td>
                      <td>{fmtData(venda.data_venda)}</td>
                      <td>{fmtData(venda.data_ativacao)}</td>
                      <td>{venda.vendedora?.nome || '—'}</td>
                      <td>{venda.cliente?.nome || venda.cliente?.razao_social || '—'}</td>
                      <td>{venda.cliente?.cnpj || '—'}</td>
                      <td>{venda.operadora?.nome || '—'}</td>
                      <td>{venda.gb || '—'}</td>
                      <td>{venda.tipo_venda || '—'}</td>
                      <td>{venda.servico || '—'}</td>
                      <td className="num">{venda.chips_total}</td>
                      <td className="num">{fmtMoeda(venda.valor_total)}</td>
                      <td className="num">{venda.dia_vencimento ?? '—'}</td>
                      <td>{fmtData(venda.cliente?.fidelidade_fim)}</td>
                      <td>
                        <div className="fechamento-venda-etapa">
                          <span className={`fechamento-etapa-badge ${venda.status_funil === 'retorno' ? 'is-return' : venda.status_funil === 'concluido' ? 'is-final' : ''}`}>
                            {STATUS_LABEL[venda.status_funil] || venda.status_funil}
                          </span>
                          {vendaTeveRetorno(venda) && (
                            <span className="fechamento-etapa-badge is-return is-return-history" title={venda.motivo_retorno || ''}>
                              {fmtRetornoBadge(venda)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default DetalhesModal;
