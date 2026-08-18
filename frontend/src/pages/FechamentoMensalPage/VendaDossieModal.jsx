import { useEffect, useMemo, useState } from 'react';
import NotasEntidadeTab from '../../components/NotasEntidadeTab';
import * as I from '../../components/Icons';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  baixarArquivoVenda,
  baixarPacoteArquivosVenda,
  listarArquivosVenda,
  visualizarArquivoVenda
} from '../../services/venda.service';
import { getDossieVenda } from '../../services/fechamento.service';
import { formatUtcDateTime } from '../../utils/datetime';
import { formatarNomeServico } from '../../utils/servicos';

const ABAS_BASE = [
  { id: 'resumo', label: 'Dados da venda' },
  { id: 'linhas', label: 'Linhas / UGRs' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'operacional', label: 'Operacional' },
  { id: 'notas', label: 'Notas' }
];

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
  if (!valor) return '-';
  const iso = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Formata data hora para exibicao.
 */
function fmtDataHora(valor) {
  return formatUtcDateTime(valor, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }, valor ? String(valor) : '-');
}

/**
 * Retorna valor no formato esperado pelo fluxo.
 */
function valor(valor) {
  return valor || '-';
}

/**
 * Retorna valor boolean no formato esperado pelo fluxo.
 */
function valorBoolean(valor) {
  if (valor === true) return 'Sim';
  if (valor === false) return 'Não';
  return '-';
}

/**
 * Formata etapa funil para exibicao.
 */
function fmtEtapaFunil(codigo) {
  const etapas = {
    aprovacao: 'Aprovação',
    ativacao: 'Ativação',
    envio: 'Envio',
    entrega: 'Entrega',
    confirmacao: 'Confirmação',
    concluido: 'Concluído',
    retorno: 'Retorno'
  };

  return etapas[codigo] || valor(codigo);
}

/**
 * Formata prioridade funil para exibicao.
 */
function fmtPrioridadeFunil(valorPrioridade) {
  const prioridades = {
    alta: 'Alta',
    media: 'Média',
    baixa: 'Baixa'
  };
  const chave = String(valorPrioridade || '').trim().toLowerCase();
  return prioridades[chave] || valor(valorPrioridade);
}

/**
 * Formata repasse para exibicao.
 */
function fmtRepasse(linha) {
  if (linha.cliente_base_propria && linha.cliente_base_operadora) return 'Nossa base + base da operadora';
  if (linha.cliente_base_propria) return 'Nossa base';
  if (linha.cliente_base_operadora) return 'Base da operadora';
  return 'Cliente novo/portabilidade';
}

/**
 * Processa juntar valores conforme as regras do dominio.
 */
function juntarValores(valores, separador = ', ') {
  const texto = (valores || [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join(separador);

  return texto || '-';
}

/**
 * Formata horario aceite para exibicao ou envio.
 */
function formatarHorarioAceite(venda) {
  const partes = [];
  const range = [venda.horario_aceite_inicio, venda.horario_aceite_fim].filter(Boolean);
  if (range.length) partes.push(range.join(' até '));
  const fixoParts = [venda.dia_aceite_fixo, venda.horario_aceite_fixo].filter(Boolean);
  if (fixoParts.length) partes.push(fixoParts.join(' às '));
  return partes.join(' ou ') || '-';
}

/**
 * Retorna nomes vendedoras no formato esperado pelo fluxo.
 */
function nomesVendedoras(venda) {
  const nomes = (venda.vendedoras || []).map(item => item.nome).filter(Boolean);
  return nomes.length > 0 ? nomes.join(', ') : valor(venda.vendedora?.nome);
}

/**
 * Formata endereco para exibicao ou envio.
 */
function formatarEndereco(venda) {
  return juntarValores([
    venda.endereco,
    venda.numero_endereco,
    venda.complemento,
    venda.bairro,
    venda.municipio,
    venda.uf,
    venda.cep
  ]);
}

/**
 * Formata endereco real para exibicao ou envio.
 */
function formatarEnderecoReal(venda) {
  return juntarValores([
    venda.endereco_real,
    venda.numero_endereco_real,
    venda.complemento_real,
    venda.bairro_real,
    venda.municipio_real,
    venda.uf_real,
    venda.cep_real
  ]);
}

/**
 * Formata lista para exibicao ou envio.
 */
function formatarLista(valorCampo) {
  if (!valorCampo) return '-';
  if (Array.isArray(valorCampo)) {
    return valorCampo.length > 0 ? valorCampo.join(', ') : '-';
  }
  if (typeof valorCampo === 'object') {
    return JSON.stringify(valorCampo);
  }
  return String(valorCampo);
}

/**
 * Renderiza info grid com os dados informados.
 */
function InfoGrid({ itens }) {
  return (
    <div className="fechamento-modal-table-wrapper dossie-info-table-wrap">
      <table className="fechamento-modal-table dossie-info-table">
        <thead>
          <tr>
            <th>Campo</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(item => (
            item.section ? (
              <tr key={item.section} className="dossie-info-table__section">
                <td colSpan={2}>{item.section}</td>
              </tr>
            ) : (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.value ?? '-'}</td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renderiza resumo tab.
 */
function ResumoTab({ dossie }) {
  const venda = dossie.venda || {};
  const total = dossie.total_geral || {};
  const cliente = venda.cliente || {};
  const itensResumo = [
    { section: 'Identificação' },
    { label: 'Venda', value: `#${venda.id}` },
    { label: 'Protocolo', value: valor(venda.protocolo) },
    { label: 'Login', value: valor(venda.login) },
    { label: 'Senha', value: valor(venda.senha) },
    { label: 'Número do cliente no contrato', value: valor(venda.numero_cliente_contrato) },
    { label: 'Cliente', value: valor(cliente.nome || venda.nome) },
    { label: 'Razão social', value: valor(cliente.razao_social || venda.razao_social) },
    { label: 'CNPJ', value: valor(cliente.cnpj || venda.cnpj) },
    { label: 'E-mail principal', value: valor(venda.email || cliente.email) },
    { label: 'E-mail secundário', value: valor(venda.email_2) },
    { label: 'Celular', value: valor(venda.telefone) },
    { label: 'Telefone fixo', value: valor(venda.fixo_ddd) },
    { section: 'Responsáveis' },
    { label: 'Venda fechada com', value: valor(venda.nome_fechou_venda) },
    { label: 'Setor/Função', value: valor(venda.setor_funcao) },
    { label: 'Representante legal', value: valor(venda.nome_representante_legal) },
    { label: 'CPF RL', value: valor(venda.cpf_representante_legal) },
    { label: 'Telefone RL', value: valor(venda.telefone_representante_legal) },
    { label: 'E-mail RL', value: valor(venda.email_representante_legal) },
    { label: 'Administrador', value: valor(venda.nome_administrador) },
    { label: 'CPF ADM', value: valor(venda.cpf_administrador) },
    { label: 'Telefone ADM', value: valor(venda.telefone_administrador) },
    { label: 'E-mail ADM', value: valor(venda.email_administrador) },
    { label: 'Responsáveis pelo recebimento', value: formatarLista(venda.responsaveis_recebimento) },
    { section: 'Venda e produto' },
    { label: 'Categoria', value: valor(dossie.contexto?.categoria_label) },
    { label: 'Operadora', value: valor(venda.operadora?.nome) },
    { label: 'Operadora atual do cliente', value: valor(cliente.operadoraAtual?.nome || cliente.operadora_atual?.nome) },
    { label: 'Serviço', value: valor(formatarNomeServico(venda.servico?.nome)) },
    { label: 'Tipo de venda', value: valor(venda.tipoVenda?.nome) },
    { label: 'Quantidade de linhas fechadas', value: valor(venda.quantidade_linhas) },
    { label: 'DDD', value: valor(venda.ddd) },
    { label: 'GB', value: valor(venda.gb) },
    { label: 'Dia de vencimento', value: valor(venda.dia_vencimento) },
    { label: 'Etapa do funil', value: valor(dossie.contexto?.status_funil_label || fmtEtapaFunil(venda.status_funil)) },
    { label: 'Prioridade', value: fmtPrioridadeFunil(venda.prioridade_funil) },
    { label: 'Data da venda', value: fmtData(venda.data_venda) },
    { label: 'Data de ativação', value: fmtData(venda.data_ativacao) },
    { label: 'Fidelidade fim', value: fmtData(cliente.fidelidade_fim) },
    { label: 'Valor total', value: fmtMoeda(venda.valor_total) },
    { label: 'Vendedoras', value: nomesVendedoras(venda) },
    { label: 'UGRs', value: total.chips || 0 },
    { label: 'Comissão estimada', value: fmtMoeda(total.comissao) },
    { section: 'Solicitações do cliente' },
    { label: 'Cliente solicitou', value: formatarLista(venda.cliente_solicitou_servicos) },
    { label: 'Qtd. bloqueio', value: valor(venda.cliente_solicitou_bloqueio_qtd) },
    { label: 'Qtd. cancelamento', value: valor(venda.cliente_solicitou_cancelamento_qtd) },
    { label: 'Números solicitados', value: formatarLista(venda.cliente_solicitou_numeros) },
    { label: 'Números ativados', value: formatarLista(venda.numeros_ativados) },
    { label: 'Números portados', value: formatarLista(venda.numeros_portados) },
    { section: 'Endereço' },
    { label: 'Endereço da Receita', value: formatarEndereco(venda) },
    { label: 'Endereço real divergente', value: valorBoolean(venda.endereco_real_divergente) },
    { label: 'Endereço real', value: formatarEnderecoReal(venda) },
    { label: 'Ponto de referência', value: valor(venda.ponto_referencia) },
    { label: 'Venda CPF: local', value: valor(venda.tipo_local_cpf) },
    { section: 'Operacional' },
    { label: 'QC feito por', value: valor(venda.qc_feito_por) },
    { label: 'Horário de fazer aceite', value: formatarHorarioAceite(venda) },
    { label: 'Dias para aceite', value: juntarValores([venda.dia_aceite_inicio, venda.dia_aceite_fim], ' até ') },
    { label: 'Promessa ao cliente', value: valor(venda.promessa_cliente) },
    { label: 'Promessa cumprida', value: valor(venda.promessa_cumprida) },
    { label: 'Observações', value: valor(venda.observacoes) },
    { label: 'Motivo do retorno', value: valor(venda.motivo_retorno) },
    { label: 'Status anterior ao retorno', value: fmtEtapaFunil(venda.status_anterior_retorno) },
    { label: 'Retornou em', value: fmtDataHora(venda.retornou_em) },
    { label: 'Corrigido em', value: fmtDataHora(venda.corrigido_em) },
    { label: 'Criado em', value: fmtDataHora(venda.created_at) },
    { label: 'Atualizado em', value: fmtDataHora(venda.updated_at) }
  ];

  return (
    <div className="dossie-section-stack">
      <InfoGrid itens={itensResumo} />
    </div>
  );
}

/**
 * Renderiza linhas tab.
 */
function LinhasTab({ dossie }) {
  const linhas = dossie.linhas || [];

  if (linhas.length === 0) {
    return <div className="fechamento-empty">Nenhuma linha/UGR calculada para esta venda.</div>;
  }

  return (
    <div className="fechamento-modal-table-wrapper dossie-table-wrap">
      <table className="fechamento-modal-table">
        <thead>
          <tr>
            <th>Chip</th>
            <th>Número ativado</th>
            <th>Tipo</th>
            <th>DDD</th>
            <th>GB</th>
            <th>Repasse</th>
            <th className="num">Valor unit.</th>
            <th>Regra</th>
            <th className="num">Comissão</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, index) => (
            <tr key={`${linha.chip_index}-${index}`} className={linha.sem_regra ? 'row-warning' : ''}>
              <td>{linha.chip_index}</td>
              <td>{linha.numero_ativado || '-'}</td>
              <td>{linha.tipo_linha || '-'}</td>
              <td>{linha.ddd || '-'}</td>
              <td>{linha.gb || '-'}</td>
              <td>{fmtRepasse(linha)}</td>
              <td className="num">{fmtMoeda(linha.valor_unitario)}</td>
              <td>{linha.regra_comissao ? `${fmtMoeda(linha.regra_comissao.valor_min)} até ${fmtMoeda(linha.regra_comissao.valor_max)}` : 'Sem regra'}</td>
              <td className="num">{linha.comissao != null ? fmtMoeda(linha.comissao) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renderiza cliente tab.
 */
function ClienteTab({ dossie }) {
  const venda = dossie.venda || {};
  const cliente = venda.cliente || {};

  return (
    <InfoGrid itens={[
      { label: 'Nome', value: valor(cliente.nome || venda.nome) },
      { label: 'Razão social', value: valor(cliente.razao_social || venda.razao_social) },
      { label: 'CNPJ', value: valor(cliente.cnpj || venda.cnpj) },
      { label: 'E-mail', value: valor(cliente.email || venda.email) },
      { label: 'Telefone venda', value: valor(venda.telefone) },
      { label: 'WhatsApp cliente', value: valor([cliente.whatsapp_ddd, cliente.whatsapp_numero].filter(Boolean).join(' ')) },
      { label: 'Fixo cliente', value: valor([cliente.fixo_ddd, cliente.fixo_numero].filter(Boolean).join(' ')) },
      { label: 'Operadora atual', value: valor(cliente.operadoraAtual?.nome) },
      { label: 'Fidelidade fim', value: fmtData(cliente.fidelidade_fim) },
      { label: 'Responsável', value: valor(cliente.responsavel_nome) },
      { label: 'Tipo responsável', value: valor(cliente.responsavel_tipo) },
      { label: 'Endereço', value: valor([venda.endereco, venda.numero_endereco, venda.bairro, venda.municipio, venda.uf].filter(Boolean).join(', ')) },
      { label: 'CEP', value: valor(venda.cep) },
      { label: 'Dia vencimento', value: valor(venda.dia_vencimento) }
    ]} />
  );
}

/**
 * Renderiza operacional tab.
 */
function OperacionalTab({ dossie }) {
  const venda = dossie.venda || {};
  const historico = venda.historico || [];

  return (
    <div className="dossie-section-stack">
      <InfoGrid itens={[
        { label: 'Etapa atual', value: valor(dossie.contexto?.status_funil_label || venda.status_funil) },
        { label: 'Código da etapa', value: valor(venda.status_funil) },
        { label: 'Status final', value: valor(dossie.contexto?.status_final) },
        { label: 'Churn aproximado', value: dossie.contexto?.churn_aproximado ? 'Sim' : 'Não' },
        { label: 'Motivo do retorno', value: valor(venda.motivo_retorno) },
        { label: 'Status anterior ao retorno', value: fmtEtapaFunil(venda.status_anterior_retorno) },
        { label: 'Retornou em', value: fmtDataHora(venda.retornou_em) },
        { label: 'Corrigido em', value: fmtDataHora(venda.corrigido_em) },
        { label: 'Protocolo', value: valor(venda.protocolo) },
        { label: 'Login', value: valor(venda.login) },
        { label: 'QC feito por', value: valor(venda.qc_feito_por) }
      ]} />

      <div className="dossie-history">
        <strong>Histórico</strong>
        {historico.length === 0 ? (
          <span className="muted">Sem histórico registrado.</span>
        ) : (
          historico.slice(0, 20).map(item => (
            <div key={item.id} className="dossie-history__item">
              <span>{fmtDataHora(item.created_at)} · {item.usuario?.nome || 'Sistema'}</span>
              <strong>{item.observacao || item.acao}</strong>
              <small>{[item.status_anterior, item.status_novo].filter(Boolean).join(' → ')}</small>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Renderiza documentos tab.
 */
function DocumentosTab({ vendaId }) {
  const [dados, setDados] = useState({ arquivos: [], pacote: null });
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    listarArquivosVenda(vendaId)
      .then(resp => {
        if (!ativo) return;
        setDados({ arquivos: resp?.arquivos || [], pacote: resp?.pacote || null });
      })
      .catch(error => {
        if (!ativo) return;
        setErro(error.message || 'Erro ao carregar documentos.');
      })
      .finally(() => {
        if (!ativo) return;
        setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [vendaId]);

  if (loading) return <div className="fechamento-empty">Carregando documentos...</div>;
  if (erro) return <div className="alert-error">{erro}</div>;
  if (dados.arquivos.length === 0) return <div className="fechamento-empty">Nenhum documento anexado.</div>;

  return (
    <div className="dossie-docs">
      {dados.pacote?.status === 'pronto' && (
        <button type="button" className="btn" onClick={() => baixarPacoteArquivosVenda(vendaId)}>
          <I.Download size={13} /> Baixar ZIP
        </button>
      )}

      {dados.arquivos.map(arquivo => (
        <div key={arquivo.id} className="dossie-doc">
          <div>
            <strong>{arquivo.nome_original}</strong>
            <span>{arquivo.categoria || 'documento'} · {arquivo.criado_por?.nome || 'Usuário'}</span>
          </div>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => visualizarArquivoVenda(vendaId, arquivo.id)} disabled={Boolean(arquivo.arquivo?.removido_em)}>
              <I.Eye size={12} /> Visualizar
            </button>
            <button type="button" className="btn btn-sm" onClick={() => baixarArquivoVenda(vendaId, arquivo.id, arquivo.nome_original)} disabled={Boolean(arquivo.arquivo?.removido_em)}>
              <I.Download size={12} /> Baixar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renderiza venda dossie modal.
 */
function VendaDossieModal({ vendaId, periodo, onClose }) {
  const [dossie, setDossie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('resumo');
  const podeVerDocumentos = temPermissao(getUsuarioLocal(), 'vendas_documentos');
  const abas = useMemo(() => (
    podeVerDocumentos
      ? [...ABAS_BASE, { id: 'documentos', label: 'Documentos' }]
      : ABAS_BASE
  ), [podeVerDocumentos]);

  useEffect(() => {
    let ativo = true;
    getDossieVenda(vendaId, periodo)
      .then(resp => {
        if (!ativo) return;
        setDossie(resp);
      })
      .catch(error => {
        if (!ativo) return;
        setErro(error.message || 'Erro ao carregar dossiê.');
      })
      .finally(() => {
        if (!ativo) return;
        setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [vendaId, periodo]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fechamento-modal-large dossie-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Dossiê da venda #{vendaId}</div>
              <div className="modal-sub">Visão completa com os dados atuais do sistema.</div>
            </div>
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Fechar">
              <I.Close size={16} />
            </button>
          </div>
        </div>

        <div className="modal-tabs">
          {abas.map(item => (
            <button
              key={item.id}
              type="button"
              className={`modal-tab ${aba === item.id ? 'active' : ''}`}
              onClick={() => setAba(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="modal-body dossie-body">
          {loading ? (
            <div className="fechamento-empty">Carregando dossiê...</div>
          ) : erro ? (
            <div className="alert-error">{erro}</div>
          ) : aba === 'linhas' ? (
            <LinhasTab dossie={dossie} />
          ) : aba === 'cliente' ? (
            <ClienteTab dossie={dossie} />
          ) : aba === 'operacional' ? (
            <OperacionalTab dossie={dossie} />
          ) : aba === 'notas' ? (
            <NotasEntidadeTab tipo="venda" entidadeId={vendaId} />
          ) : aba === 'documentos' && podeVerDocumentos ? (
            <DocumentosTab vendaId={vendaId} />
          ) : (
            <ResumoTab dossie={dossie} />
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default VendaDossieModal;
