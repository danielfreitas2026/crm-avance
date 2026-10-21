import { useNavigationRecord } from '../../utils/useNavigationRecord';
import { useNavigationState } from '../../utils/useNavigationState';
import { useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import { STAGES as FALLBACK_STAGES } from '../../config/constants';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam
} from '../../services/notificacao-abertura.service';
import ClienteModal from '../Clientes/ClienteModal';
import VendaModal, { ArquivosVendaTab } from '../VendasPage/VendaModal';
import VendaProblemaPanel from '../VendasPage/VendaProblemaPanel';
import { WhatsappMensagemModal } from '../VendasPage/VendasPage';
import { montarChecklistWhatsappVenda, obterDocumentosFaltantesPadrao } from '../VendasPage/vendasWhatsapp';
import {
  atualizarEtapaFunil,
  criarEtapaFunil,
  excluirEtapaFunil,
  listarEtapasFunil,
  listarEtapasFunilAdmin,
  listarOperadoras,
  listarServicos,
  listarTiposVenda,
  reordenarEtapasFunil
} from '../../services/config.service';
import { listarClientes } from '../../services/cliente.service';
import { agruparOpcoesServicos, formatarNomeServico, servicoIdInclui } from '../../utils/servicos';
import {
  atualizarAceiteBiometriaVenda,
  atualizarConclusaoVenda,
  atualizarStatusVenda,
  atualizarStatusVendaFunilAutomacoes,
  cancelarVenda,
  reverterCancelamentoVenda,
  atualizarVenda,
  baixarXlsxClaro,
  buscarVendaPorId,
  enviarVendaParaPosVenda,
  gerarEmailVenda,
  listarVendas,
  listarVendasFunilAutomacoes,
  listarVendedoras
} from '../../services/venda.service';
import { localDateTimeInputToUtc, parseUtcDateTime, toLocalDateTimeInputFromUtc } from '../../utils/datetime';
import { getAutorHistorico } from '../../utils/origemHistorico';
import {
  VISIBILIDADE_OCULTAR,
  VISIBILIDADE_SOMENTE,
  VISIBILIDADE_TODAS,
  vendaCorrespondeAtalhos,
  vendaSemDocumento
} from './funilFiltros';
import '../VendasPage/VendasPage.css';

/**
 * Formata brl para exibicao.
 */
const formatBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STAGE_LABELS = {
  ...Object.fromEntries(FALLBACK_STAGES.map(stage => [stage.id, stage.name])),
  retorno: 'Retorno',
};

/**
 * Renderiza problema venda modal.
 */
function ProblemaVendaModal({ venda, usuario, onClose }) {
  if (!venda) return null;

  return (
    <div className="modal-overlay venda-problema-modal-overlay" onClick={onClose}>
      <div className="modal venda-problema-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Problemas da venda</div>
              <div className="modal-sub">{venda?.cliente?.nome || venda?.nome || `Venda #${venda?.id}`}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body" data-navigation-scroll="FunilPage-1">
          <VendaProblemaPanel venda={venda} usuario={usuario} />
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza email template modal.
 */
function EmailTemplateModal({ dados, copiando, onClose, onCopy }) {
  if (!dados) return null;

  return (
    <div className="modal-overlay" onClick={event => !copiando && event.target === event.currentTarget && onClose()}>
      <div className="modal venda-email-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Corpo do email</div>
              <div className="modal-sub">{dados.operadora} - {dados.venda?.cliente?.nome || dados.venda?.nome || `Venda #${dados.venda?.id}`}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={copiando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body" data-navigation-scroll="FunilPage-2">
          <div className="venda-email-container">
            <textarea className="venda-email-preview" value={dados.texto || ''} readOnly />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={copiando}>Fechar</button>
          <button type="button" className="btn btn-primary" onClick={onCopy} disabled={copiando}>
            {copiando ? 'Copiando...' : 'Copiar e-mail'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Normaliza ativo para uso interno consistente.
 */
function normalizarAtivo(valor) {
  if (typeof valor === 'string') {
    return !['0', 'false'].includes(valor.trim().toLowerCase());
  }

  return ![false, 0].includes(valor);
}

/**
 * Normaliza etapas funil para uso interno consistente.
 */
function normalizarEtapasFunil(etapas = [], usarFallback = true) {
  const normalizadas = etapas
    .map((etapa, index) => {
      const id = etapa.codigo || etapa.id;

      return {
        id,
        adminId: etapa.id,
        name: etapa.nome || etapa.name || STAGE_LABELS[id],
        dot: id || `etapa_${index}`,
        ordem: Number(etapa.ordem ?? index),
        ativo: normalizarAtivo(etapa.ativo),
        etapaFinal: Boolean(etapa.etapa_final || etapa.etapaFinal),
        bloqueiaAvanco: Boolean(etapa.bloqueia_avanco || etapa.bloqueiaAvanco),
        aceiteBiometria: Boolean(etapa.aceite_biometria || etapa.aceiteBiometria)
      };
    })
    .filter(etapa => etapa.id && etapa.name);

  return normalizadas.length > 0 || !usarFallback ? normalizadas : FALLBACK_STAGES;
}

/**
 * Monta stage labels a partir dos dados informados.
 */
function montarStageLabels(stages = []) {
  return {
    ...STAGE_LABELS,
    ...Object.fromEntries(stages.map(stage => [stage.id, stage.name]))
  };
}

const PRIORITIES = {
  alta: { label: 'Prioridade Alta', color: '#ef4444' },
  media: { label: 'Prioridade Média', color: '#3b82f6' },
  baixa: { label: 'Prioridade Baixa', color: '#eab308' },
};

/**
 * Retorna priority info a partir dos dados informados.
 */
function getPriorityInfo(priority) {
  const key = PRIORITIES[priority] ? priority : 'media';
  return { key, ...PRIORITIES[key] };
}

const RETURN_REASONS = [
  'Endereço inválido',
  'Cliente recusou',
  'Chip danificado',
  'Reprovado na operadora',
  'Cancelamento do cliente',
  'Outro motivo',
];

const STATUS_CANCELADA_FILTRO = '__cancelada';

const UFS_BRASIL = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

/**
 * Converte date para o formato interno esperado.
 */
function parseDate(value) {
  if (!value) return new Date();
  // Strings do banco vêm em UTC ("YYYY-MM-DD HH:MM:SS"); adiciona Z para evitar
  // interpretação como horário local do browser.
  return parseUtcDateTime(value) || new Date();
}

/**
 * Formata date para exibicao.
 */
function formatDate(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Formata date time para exibicao.
 */
function formatDateTime(d) {
  return `${formatDate(d)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Valida no cliente os mesmos limites aplicados pelo servidor à conclusão. */
function validarConclusaoInput({ valor, dataMinima, dataAtual, agora }) {
  if (!valor) return { concluidaEm: null, erro: 'Informe uma data de conclusão.' };

  const concluidaEm = localDateTimeInputToUtc(valor);
  if (!concluidaEm) return { concluidaEm: null, erro: 'Informe uma data de conclusão válida.' };
  if (!dataMinima) {
    return { concluidaEm: null, erro: 'A venda não possui data de envio ao pós-venda. Não é possível editar a conclusão.' };
  }

  const instante = parseUtcDateTime(concluidaEm);
  if (instante.getTime() < dataMinima.getTime()) {
    return { concluidaEm: null, erro: 'A conclusão não pode ser anterior ao envio ao pós-venda.' };
  }
  if (agora && instante.getTime() > agora.getTime()) {
    return { concluidaEm: null, erro: 'A data de conclusão não pode ser futura.' };
  }
  if (dataAtual && valor === toLocalDateTimeInputFromUtc(dataAtual)) {
    return { concluidaEm: null, erro: 'Escolha uma data diferente da conclusão atual.' };
  }

  return { concluidaEm, erro: '' };
}

/**
 * Processa time ago conforme as regras do dominio.
 */
function timeAgo(d) {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  if (hours < 24) return `${hours}h atrás`;
  return `${days}d atrás`;
}

/**
 * Processa initials conforme as regras do dominio.
 */
function initials(name) {
  return String(name || 'SV')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'SV';
}

/**
 * Normaliza busca para uso interno consistente.
 */
function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Monta texto busca venda a partir dos dados informados.
 */
function montarTextoBuscaVenda(sale) {
  const raw = sale.raw || {};
  const campos = [
    sale.id,
    sale.client,
    sale.operator,
    sale.plan,
    sale.cpfCnpj,
    sale.seller?.name,
    sale.linha,
    sale.endereco,
    sale.stage,
    sale.priority,
    formatBRL(sale.value),
    raw.nome,
    raw.razao_social,
    raw.email,
    raw.email_2,
    raw.telefone,
    raw.fixo_ddd,
    raw.cnpj,
    raw.protocolo,
    raw.login,
    raw.municipio,
    raw.uf,
    raw.bairro,
    raw.cep,
    raw.produto_fechado,
    raw.gb,
    raw.ddd,
    raw.quantidade_linhas,
    raw.dia_vencimento,
    raw.observacoes,
    raw.operadora?.nome,
    raw.tipoVenda?.nome,
    raw.servico?.nome,
    raw.vendedora?.nome,
    ...(Array.isArray(raw.vendedoras) ? raw.vendedoras.map(item => item?.nome) : []),
    raw.cliente?.nome,
    raw.cliente?.razao_social,
    raw.cliente?.email
  ];

  return normalizarBusca(campos.filter(Boolean).join(' '));
}

/**
 * Verifica se venda corresponde busca atende a condicao esperada.
 */
function vendaCorrespondeBusca(sale, busca) {
  const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;

  const texto = montarTextoBuscaVenda(sale);
  return termos.every(termo => texto.includes(termo));
}

/**
 * Normaliza numero filtro para uso interno consistente.
 */
function normalizarNumeroFiltro(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Obtem data venda filtro a partir dos dados informados.
 */
function obterDataVendaFiltro(sale) {
  const raw = sale.raw || {};
  return String(raw.data_venda || raw.criado_em || raw.created_at || '').slice(0, 10);
}

/**
 * Obtem vendedoras venda a partir dos dados informados.
 */
function obterVendedorasVenda(venda = {}) {
  const vendedoras = Array.isArray(venda.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras
    : [venda.vendedora].filter(Boolean);

  return vendedoras.map(item => String(item?.id || item?.usuario_id || item?.vendedora_id || '')).filter(Boolean);
}

/**
 * Verifica se venda corresponde filtros atende a condicao esperada.
 */
function vendaCorrespondeFiltros(sale, filtros) {
  const raw = sale.raw || {};
  const valorMin = normalizarNumeroFiltro(filtros.valorMin);
  const valorMax = normalizarNumeroFiltro(filtros.valorMax);
  const dataVenda = obterDataVendaFiltro(sale);

  if (filtros.vendedoraId && !obterVendedorasVenda(raw).includes(String(filtros.vendedoraId))) return false;
  if (filtros.operadoraId && String(raw.operadora_id || raw.operadora?.id || '') !== String(filtros.operadoraId)) return false;
  if (filtros.tipoVendaId && String(raw.tipo_venda_id || raw.tipoVenda?.id || '') !== String(filtros.tipoVendaId)) return false;
  if (filtros.servicoId && !servicoIdInclui(filtros.servicoId, raw.servico_id || raw.servico?.id)) return false;
  if (filtros.statusFunil === STATUS_CANCELADA_FILTRO && !sale.canceladaEm) return false;
  if (
    filtros.statusFunil &&
    filtros.statusFunil !== STATUS_CANCELADA_FILTRO &&
    String(sale.stage || '') !== String(filtros.statusFunil)
  ) return false;
  if (filtros.prioridadeFunil && String(sale.priority || '') !== String(filtros.prioridadeFunil)) return false;
  if (filtros.uf && String(raw.uf || '').toUpperCase() !== String(filtros.uf).toUpperCase()) return false;
  if (filtros.municipio && !normalizarBusca(raw.municipio).includes(normalizarBusca(filtros.municipio))) return false;
  if (filtros.dataInicio && (!dataVenda || dataVenda < filtros.dataInicio)) return false;
  if (filtros.dataFim && (!dataVenda || dataVenda > filtros.dataFim)) return false;
  if (valorMin !== null && Number(sale.value || 0) < valorMin) return false;
  if (valorMax !== null && Number(sale.value || 0) > valorMax) return false;

  return true;
}

/**
 * Retorna chave cliente venda a partir dos dados informados.
 */
function getChaveClienteVenda(venda = {}) {
  if (venda.cliente_id) return `cliente:${venda.cliente_id}`;
  if (venda.cliente?.id) return `cliente:${venda.cliente.id}`;

  const cnpj = String(venda.cnpj || venda.cliente?.cnpj || '').replace(/\D/g, '');
  if (cnpj) return `cnpj:${cnpj}`;

  const nome = normalizarBusca(venda.nome || venda.cliente?.nome || venda.razao_social || venda.cliente?.razao_social || '');
  return nome ? `nome:${nome}` : '';
}

/**
 * Conta vendas por cliente conforme os dados informados.
 */
function contarVendasPorCliente(vendas = []) {
  return vendas.reduce((acc, venda) => {
    const chave = getChaveClienteVenda(venda);
    if (!chave) return acc;
    acc.set(chave, (acc.get(chave) || 0) + 1);
    return acc;
  }, new Map());
}

/**
 * Renderiza seller avatar.
 */
function SellerAvatar({ seller, className = 'mini-avatar' }) {
  return (
    <span className={className}>
      {seller?.photo ? (
        <img src={seller.photo} alt={seller.name || 'Foto do vendedor'} />
      ) : (
        seller?.initials || initials(seller?.name)
      )}
    </span>
  );
}

/**
 * Retorna client a partir dos dados informados.
 */
function getClient(venda) {
  return venda.nome || venda.razao_social || `Venda #${venda.id}`;
}

/**
 * Retorna operator a partir dos dados informados.
 */
function getOperator(venda) {
  return venda.operadora?.nome || venda.operadora || 'Sem operadora';
}

/**
 * Rotulos do resultado da verificacao com o 0800 (etapa 1 da conferencia).
 */
const ROTULOS_BASE_0800 = {
  nao_e_base: 'Não é base',
  base_claro: 'Base da Claro',
  base_vivo: 'Base da Vivo'
};

/**
 * Retorna o rotulo da base verificada no 0800, ou vazio se a etapa ainda nao foi concluida.
 */
function getBase0800(venda) {
  return ROTULOS_BASE_0800[venda.etapa_0800_resultado] || '';
}

/**
 * Retorna plan a partir dos dados informados.
 */
function getPlan(venda) {
  return venda.produto_fechado || formatarNomeServico(venda.servico?.nome) || venda.tipoVenda?.nome || 'Plano não informado';
}

/**
 * Retorna seller photo a partir dos dados informados.
 */
function getSellerPhoto(venda) {
  return venda.vendedora?.foto_perfil
    || venda.vendedora?.fotoPerfil
    || venda.vendedora_foto_perfil
    || venda.foto_perfil_vendedora
    || '';
}

/**
 * Retorna seller photo from user a partir dos dados informados.
 */
function getSellerPhotoFromUser(usuario = {}) {
  return usuario.foto_perfil
    || usuario.fotoPerfil
    || usuario.vendedora_foto_perfil
    || usuario.foto_perfil_vendedora
    || '';
}

/**
 * Retorna sellers a partir dos dados informados.
 */
function getSellers(venda = {}) {
  const vendedoras = Array.isArray(venda.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras
    : [venda.vendedora].filter(Boolean);

  const sellers = vendedoras
    .map(item => {
      const name = item?.nome || item?.name || '';

      return {
        id: item?.id || item?.usuario_id || item?.vendedora_id || name,
        name: name || 'Sem vendedor',
        initials: initials(name || 'Sem vendedor'),
        photo: getSellerPhotoFromUser(item)
      };
    })
    .filter(item => item.name);

  if (sellers.length > 0) return sellers;

  const sellerName = venda.vendedora?.nome || 'Sem vendedor';
  return [{
    id: venda.vendedora_id || sellerName,
    name: sellerName,
    initials: initials(sellerName),
    photo: getSellerPhoto(venda)
  }];
}

/**
 * Retorna history author a partir dos dados informados.
 */
function getHistoryAuthor(item) {
  return getAutorHistorico(item);
}

/**
 * Retorna history title a partir dos dados informados.
 */
function getHistoryTitle(item, stageLabels = STAGE_LABELS) {
  if (item.acao === 'venda.criada') return 'Venda cadastrada';
  if (item.acao === 'venda.retorno_registrado') return 'Marcada como retorno';
  if (item.acao === 'venda.retorno_corrigido') return 'Retorno corrigido';
  if (item.acao === 'venda.observacao_adicionada') return 'Observação adicionada';
  if (item.acao === 'venda.cancelada') return 'Venda cancelada';
  if (item.acao === 'venda.cancelamento_revertido') return 'Cancelamento revertido';
  if (item.acao === 'venda.prioridade_atualizada') return 'Prioridade atualizada';
  if (item.acao === 'venda.conclusao_editada') return 'Data de conclusão editada';
  if (item.acao === 'venda.status_atualizado') {
    return `Movido para ${stageLabels[item.status_novo] || item.status_novo}`;
  }
  return item.acao || 'Atualização registrada';
}

/**
 * Retorna history label a partir dos dados informados.
 */
function getHistoryLabel(item, stageLabels = STAGE_LABELS) {
  return [getHistoryTitle(item, stageLabels), item.observacao].filter(Boolean).join(' - ');
}

/**
 * Retorna history type a partir dos dados informados.
 */
function getHistoryType(item) {
  if (item.acao === 'venda.criada') return 'create';
  if (item.acao === 'venda.observacao_adicionada') return 'obs';
  return 'move';
}

/** Converte os dados estruturados de um evento de historico. */
function parseDadosHistorico(dados) {
  if (!dados) return {};
  if (typeof dados === 'object') return dados;

  try {
    return JSON.parse(dados);
  } catch {
    return {};
  }
}

/**
 * Mapeia historico venda para o formato usado pela aplicacao.
 */
function mapHistoricoVenda(venda, stage, updated, created, sellerName, stageLabels = STAGE_LABELS) {
  const historico = Array.isArray(venda.historico) ? venda.historico : [];

  if (historico.length === 0) {
    return [
      { acao: `Status atual: ${stageLabels[stage] || stage}`, autor: 'Sistema', data: updated, tipo: 'move' },
      { acao: 'Venda cadastrada', autor: sellerName, data: created, tipo: 'create' },
    ];
  }

  return historico.map(item => {
    const dados = parseDadosHistorico(item.dados);

    return {
      id: item.id || null,
      acao: getHistoryLabel(item, stageLabels),
      titulo: getHistoryTitle(item, stageLabels),
      acaoRaw: item.acao || null,
      observacao: item.observacao || null,
      autor: getHistoryAuthor(item),
      data: parseDate(item.created_at),
      tipo: getHistoryType(item),
      statusAnterior: item.status_anterior || null,
      statusNovo: item.status_novo || null,
      statusConclusao: item.acao === 'venda.conclusao_editada' ? dados.status_funil || stage : null,
      conclusaoEm: item.acao === 'venda.conclusao_editada' ? parseUtcDateTime(dados.concluida_em) : null,
      excluidoEm: item.deleted_at || null,
      invalidadoEm: item.invalidated_at || null,
      motivoInvalidacao: item.invalidation_reason || null
    };
  });
}

/** Retorna a ultima entrada valida da venda na etapa informada. */
function obterEntradaEtapa(historico, etapa) {
  return (Array.isArray(historico) ? historico : [])
    .filter(item => (
      !item.excluidoEm
      && !item.invalidadoEm
      && item.data instanceof Date
      && !Number.isNaN(item.data.getTime())
      && (
        (item.acaoRaw === 'venda.conclusao_editada'
          && item.statusConclusao === etapa
          && item.conclusaoEm instanceof Date
          && !Number.isNaN(item.conclusaoEm.getTime()))
        || (item.statusNovo === etapa && item.statusAnterior !== item.statusNovo)
      )
    ))
    .map(item => ({ ...item, dataConclusao: item.conclusaoEm || item.data }))
    .reduce((maisRecente, item) => (
      !maisRecente
        || item.data.getTime() > maisRecente.data.getTime()
        || (item.data.getTime() === maisRecente.data.getTime() && Number(item.id || 0) > Number(maisRecente.id || 0))
        ? item
        : maisRecente
    ), null);
}

/**
 * Conta quantas entradas a venda teve em cada etapa do funil.
 */
function contarPassagensEtapas(venda, stage, stageLabels = STAGE_LABELS) {
  const contagens = new Map();
  const historico = Array.isArray(venda.historico) ? venda.historico : [];

  historico.forEach(item => {
    const codigo = item.status_novo;
    if (!codigo) return;

    contagens.set(codigo, (contagens.get(codigo) || 0) + 1);
  });

  // Vendas antigas podem não ter o registro de criação no histórico.
  if (contagens.size === 0 && stage) {
    contagens.set(stage, 1);
  }

  return [...contagens].map(([codigo, quantidade]) => ({
    codigo,
    nome: stageLabels[codigo] || codigo,
    quantidade
  }));
}

/**
 * Retorna etapas puladas a partir dos dados informados.
 */
function getEtapasPuladas(item, stages) {
  if (item.tipo !== 'move' || !item.statusAnterior || !item.statusNovo) {
    return [];
  }

  if (item.statusAnterior === 'retorno' || item.statusNovo === 'retorno') {
    return [];
  }

  const origem = stages.findIndex(stage => stage.id === item.statusAnterior);
  const destino = stages.findIndex(stage => stage.id === item.statusNovo);

  if (origem < 0 || destino < 0 || destino <= origem + 1) {
    return [];
  }

  return stages.slice(origem + 1, destino);
}

/**
 * Processa build sale delivery progress conforme as regras do dominio.
 */
function buildSaleDeliveryProgress(sale, stages) {
  const etapas = stages.filter(stage => stage.id !== 'retorno');
  const etapaAtualIndex = Math.max(0, etapas.findIndex(stage => stage.id === sale.stage));
  const reached = new Map();
  const skipped = new Set();

  sale.historico.forEach(item => {
    if (item.invalidadoEm) return;
    if (item.tipo === 'create' && etapas[0] && !reached.has(etapas[0].id)) {
      reached.set(etapas[0].id, { data: item.data, autor: item.autor });
    }

    if (item.statusNovo && etapas.some(stage => stage.id === item.statusNovo)) {
      reached.set(item.statusNovo, { data: item.data, autor: item.autor });
    }

    getEtapasPuladas(item, etapas).forEach(stage => skipped.add(stage.id));
  });

  if (sale.stage && etapas.some(stage => stage.id === sale.stage) && !reached.has(sale.stage)) {
    reached.set(sale.stage, { data: sale.updated, autor: 'Sistema' });
  }

  etapas.slice(0, etapaAtualIndex + 1).forEach((stage, index) => {
    if (!skipped.has(stage.id) && !reached.has(stage.id)) {
      reached.set(stage.id, { data: index === etapaAtualIndex ? sale.updated : null, autor: null });
    }
  });

  const progressStages = etapas.map((stage, index) => {
    const isSkipped = skipped.has(stage.id);
    const isReached = reached.has(stage.id);
    const isCurrent = stage.id === sale.stage;
    const status = isSkipped ? 'skipped' : isCurrent ? 'current' : isReached || index < etapaAtualIndex ? 'done' : 'pending';

    return {
      ...stage,
      status,
      ...reached.get(stage.id)
    };
  });

  return {
    stages: progressStages,
    skippedCount: skipped.size
  };
}

/**
 * Retorna delivery connector type a partir dos dados informados.
 */
function getDeliveryConnectorType(stageA, stageB) {
  if (stageA.status === 'skipped' || stageB.status === 'skipped') return 'skip';
  if (
    ['done', 'current'].includes(stageA.status) &&
    ['done', 'current'].includes(stageB.status)
  ) return 'done';
  return 'pending';
}

/**
 * Processa sale event item conforme as regras do dominio.
 */
function SaleEventItem({ item }) {
  const [aberto, setAberto] = useState(false);
  const isCancel = item.acaoRaw === 'venda.cancelada';
  const isRevert = item.acaoRaw === 'venda.cancelamento_revertido';
  const variant = isCancel ? 'cancel' : isRevert ? 'revert' : item.tipo || 'move';
  const icon = isCancel
    ? <I.AlertTriangle size={11} />
    : isRevert
      ? <I.Check size={11} />
      : variant === 'create'
        ? <I.Plus size={11} />
        : <I.ChevronDown size={11} />;
  const titulo = item.titulo || item.acao || 'Atualização';
  const invalidado = Boolean(item.invalidadoEm);
  const temObservacao = Boolean(item.observacao);

  return (
    <li className={`sale-event-list__item sale-event-list__item--${variant}${aberto ? ' is-open' : ''}${invalidado ? ' is-invalidated' : ''}`}>
      <div className="sale-event-list__row">
        <span className="sale-event-list__icon">{icon}</span>
        <div className="sale-event-list__body">
          <div className="sale-event-list__head">
            <strong>{titulo}{invalidado ? ' (invalidado)' : ''}</strong>
            <span className="sale-event-list__date">
              {item.data ? formatDateTime(item.data) : ''}
            </span>
          </div>
          <div className="sale-event-list__author">por {item.autor}</div>
        </div>
        {temObservacao && (
          <button
            type="button"
            className="sale-event-list__toggle"
            onClick={() => setAberto(v => !v)}
            aria-expanded={aberto}
            title={aberto ? 'Ocultar comentário' : 'Ver comentário'}
          >
            <I.ChevronDown size={12} className={aberto ? 'is-rotated' : ''} />
          </button>
        )}
      </div>
      {temObservacao && aberto && (
        <div className="sale-event-list__comment">
          <div className="sale-event-list__comment-label">Comentário</div>
          <p className="sale-event-list__comment-text">{item.observacao}</p>
        </div>
      )}
      {invalidado && <div className="sale-event-list__comment"><div className="sale-event-list__comment-label">Correção auditada</div><p className="sale-event-list__comment-text">{item.motivoInvalidacao || 'Vínculo de automação invalidado.'}</p></div>}
    </li>
  );
}

/**
 * Renderiza sale event list com os dados informados.
 */
function SaleEventList({ sale }) {
  const eventos = Array.isArray(sale.historico) ? sale.historico : [];

  if (eventos.length === 0) {
    return (
      <div className="sale-event-list sale-event-list--empty">
        Sem eventos registrados.
      </div>
    );
  }

  const ordenados = [...eventos].sort((a, b) => {
    const ta = a.data ? new Date(a.data).getTime() : 0;
    const tb = b.data ? new Date(b.data).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="sale-event-list">
      <div className="sale-event-list__title">Eventos da venda</div>
      <ol className="sale-event-list__items">
        {ordenados.map((item, idx) => (
          <SaleEventItem key={idx} item={item} />
        ))}
      </ol>
    </div>
  );
}

/**
 * Renderiza sale delivery tracker com os dados informados.
 */
function SaleDeliveryTracker({ sale, stages, stageLabels }) {
  const progress = buildSaleDeliveryProgress(sale, stages);

  return (
    <div className="sale-delivery">
      <aside className="sale-delivery__summary">
        <strong title={sale.client}>{sale.client}</strong>
        <span>#{sale.id}</span>
        <span className="sale-delivery__stage-badge">{stageLabels[sale.stage] || sale.stage}</span>
        {progress.skippedCount > 0 && (
          <span className="sale-delivery__skip-badge">
            <I.AlertTriangle size={11} />
            {progress.skippedCount} pulada{progress.skippedCount > 1 ? 's' : ''}
          </span>
        )}
        <span className="sale-delivery__events">
          <I.ChevronDown size={12} />
          {sale.historico.length} eventos
        </span>
      </aside>

      <div className="sale-delivery__track" role="list" aria-label={`Acompanhamento da venda ${sale.id}`}>
        {progress.stages.map((stage, index) => {
          const connectorType = index < progress.stages.length - 1
            ? getDeliveryConnectorType(stage, progress.stages[index + 1])
            : null;

          return (
            <div
              key={stage.id}
              className={`sale-delivery__step sale-delivery__step--${stage.status}`}
              data-connector={connectorType}
              role="listitem"
            >
              <div className="sale-delivery__dot">
                {stage.status === 'skipped' ? (
                  <I.AlertTriangle size={11} />
                ) : ['done', 'current'].includes(stage.status) ? (
                  <I.Check size={11} />
                ) : (
                  <span />
                )}
              </div>
              <strong>{stage.name}</strong>
              <small>{stage.data ? formatDateTime(stage.data) : ''}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Mapeia venda to sale para o formato usado pela aplicacao.
 */
function mapVendaToSale(venda, stageLabels = STAGE_LABELS) {
  const sellers = getSellers(venda);
  const seller = sellers[0];
  const sellerName = sellers.map(item => item.name).join(', ') || 'Sem vendedor';
  const updated = parseDate(venda.ultima_atividade_em || venda.updated_at || venda.created_at);
  const created = parseDate(venda.criado_em || venda.created_at || venda.data_venda);
  const stage = venda.status_funil || 'aprovacao';

  return {
    raw: venda,
    id: venda.id,
    client: getClient(venda),
    value: Number(venda.valor_total || 0),
    operator: getOperator(venda),
    base0800: getBase0800(venda),
    plan: getPlan(venda),
    cpfCnpj: venda.cnpj || venda.cpf || '-',
    seller,
    sellers,
    linha: venda.telefone || venda.quantidade_linhas || '-',
    endereco: [
      venda.endereco,
      venda.numero_endereco,
      venda.bairro,
      venda.municipio,
      venda.uf
    ].filter(Boolean).join(', ') || 'Endereço não informado',
    stage,
    priority: getPriorityInfo(venda.prioridade_funil).key,
    aceiteConcluido: Boolean(venda.aceite_concluido),
    biometriaConcluida: Boolean(venda.biometria_concluida),
    lancadaEm: created,
    updated,
    canceladaEm: venda.cancelada_em || null,
    semDocumento: vendaSemDocumento(venda),
    motivoCancelamento: venda.motivo_cancelamento || null,
    canceladaPorId: venda.cancelada_por_id || null,
    statusFunilReal: venda.status_funil_real || null,
    canceladaEmReal: venda.cancelada_em_real || null,
    divergenteAutomacao: Boolean(venda.divergente_automacao),
    historico: mapHistoricoVenda(venda, stage, updated, created, sellerName, stageLabels),
    passagensEtapas: contarPassagensEtapas(venda, stage, stageLabels),
  };
}

/**
 * Renderiza sale modal.
 */
export function SaleModal({ sale, stages, stageLabels, onClose, onUpdateSale, onUpdateConclusao, onUpdatePossuiDocNaCasa, onOpenFullSale, openingFullSale, podeCancelar, podeReverterCancelamento, onCancelSale, onReverterCancelamento, podeEditarVenda, podeEditarConclusao = false, podeVerDocumentos, podeAdicionarDocumentos, finalizada = false, modoAutomacoes = false, onEtapasAtualizadas = () => {}, onArquivosAlterados = () => {} }) {
  const [tab, setTab] = useNavigationState(`sale-modal:${modoAutomacoes}:${sale.id}:tab`, 'info', { allowed: ['info', 'historico', 'status', ...(!modoAutomacoes && (podeVerDocumentos || podeAdicionarDocumentos) ? ['documentos'] : [])] });
  const [novaFase, setNovaFase] = useState(sale.stage);
  const [novaPrioridade, setNovaPrioridade] = useState(sale.priority || 'media');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [historicoEventos, setHistoricoEventos] = useState(sale.historico);
  const [historicoCarregando, setHistoricoCarregando] = useState(!modoAutomacoes);
  const [editandoConclusao, setEditandoConclusao] = useState(false);
  const [conclusaoInput, setConclusaoInput] = useState('');
  const [conclusaoAgora, setConclusaoAgora] = useState(null);
  const [possuiDocNaCasa, setPossuiDocNaCasa] = useState(
    sale.raw?.possui_doc_na_casa === true || Number(sale.raw?.possui_doc_na_casa) === 1
  );
  const [salvandoDocNaCasa, setSalvandoDocNaCasa] = useState(false);
  const cancelada = Boolean(sale.canceladaEm);
  const priorityInfo = getPriorityInfo(sale.priority);
  const podeAcessarDocumentos = Boolean(podeVerDocumentos || podeAdicionarDocumentos);
  const entradaEtapaFinal = finalizada ? obterEntradaEtapa(historicoEventos, sale.stage) : null;
  const dataMinimaConclusao = parseUtcDateTime(sale.raw?.enviada_pos_venda_em);
  const conclusaoMinInput = toLocalDateTimeInputFromUtc(dataMinimaConclusao);
  const conclusaoMaxInput = toLocalDateTimeInputFromUtc(conclusaoAgora);
  const validacaoConclusao = validarConclusaoInput({
    valor: conclusaoInput,
    dataMinima: dataMinimaConclusao,
    dataAtual: entradaEtapaFinal?.dataConclusao,
    agora: conclusaoAgora
  });

  useEffect(() => {
    if (modoAutomacoes) return undefined;
    let cancelado = false;
    buscarVendaPorId(sale.id)
      .then(venda => {
        if (cancelado) return;
        const sellerName = (venda.vendedoras || []).map(v => v?.nome).filter(Boolean).join(', ')
          || venda.vendedora?.nome
          || 'Sem vendedor';
        const stage = venda.status_funil || sale.stage;
        const created = venda.criado_em || venda.created_at || venda.data_venda;
        const updated = venda.ultima_atividade_em || venda.updated_at || venda.created_at;
        setHistoricoEventos(mapHistoricoVenda(venda, stage, updated, created, sellerName, stageLabels));
      })
      .catch(() => { /* mantém fallback */ })
      .finally(() => {
        if (!cancelado) setHistoricoCarregando(false);
      });

    return () => { cancelado = true; };
  }, [sale.id, sale.stage, stageLabels, modoAutomacoes]);

  const saleComHistorico = { ...sale, historico: historicoEventos };
  const observacaoMovimentacaoObrigatoria = !modoAutomacoes && novaFase !== sale.stage;
  const observacaoMovimentacaoValida = !observacaoMovimentacaoObrigatoria || observacao.trim() !== '';

  const alterou = novaFase !== sale.stage
    || novaPrioridade !== (sale.priority || 'media')
    || observacao.trim() !== '';

  /**
   * Envia status para processamento.
   */
  async function submitStatus(status, statusObservacao = observacao.trim(), motivoRetorno = '', options = {}) {
    setSaving(true);
    setError('');

    try {
      await onUpdateSale(sale.id, status, options.prioridade || novaPrioridade, statusObservacao, motivoRetorno);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao atualizar status.');
      setSaving(false);
      if (options.rethrow) {
        throw err;
      }
    }
  }

  /**
   * Trata o evento de atualizar.
   */
  function handleAtualizar() {
    if (!observacaoMovimentacaoValida) {
      setError('É obrigatório escrever uma observação para movimentar a venda no funil.');
      return;
    }
    submitStatus(novaFase);
  }

  /**
   * Trata o evento de prioridade click.
   */
  function handlePrioridadeClick(prioridade) {
    setNovaPrioridade(prioridade);

    if (prioridade === (sale.priority || 'media')) return;
    if (novaFase !== sale.stage || observacao.trim()) return;

    submitStatus(sale.stage, '', '', { prioridade });
  }

  /** Abre a edicao com a data efetiva atual no fuso local do navegador. */
  function iniciarEdicaoConclusao() {
    if (!dataMinimaConclusao) {
      setError('A venda não possui data de envio ao pós-venda. Não é possível editar a conclusão.');
      return;
    }

    setConclusaoInput(toLocalDateTimeInputFromUtc(entradaEtapaFinal?.dataConclusao));
    setConclusaoAgora(new Date());
    setEditandoConclusao(true);
    setError('');
  }

  /** Persiste a nova data e atualiza autor e historico exibidos no modal. */
  async function salvarConclusao() {
    if (validacaoConclusao.erro) {
      setError(validacaoConclusao.erro);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const saleAtualizada = await onUpdateConclusao(sale.id, validacaoConclusao.concluidaEm);
      setHistoricoEventos(saleAtualizada.historico);
      setEditandoConclusao(false);
    } catch (err) {
      setError(err.message || 'Erro ao atualizar a data de conclusão.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Persiste imediatamente o marcador de documento fisico alterado no modal rapido.
   */
  async function handlePossuiDocNaCasaChange(valor) {
    const valorAnterior = possuiDocNaCasa;
    setPossuiDocNaCasa(valor);
    setSalvandoDocNaCasa(true);
    setError('');

    try {
      await onUpdatePossuiDocNaCasa(sale.id, valor);
    } catch (err) {
      setPossuiDocNaCasa(valorAnterior);
      setError(err.message || 'Erro ao atualizar documento na casa.');
    } finally {
      setSalvandoDocNaCasa(false);
    }
  }

  /**
   * Trata o evento de confirm retorno.
   */
  function handleConfirmRetorno({ motivo, observacao: observacaoRetorno }) {
    return submitStatus('retorno', observacaoRetorno, motivo, { rethrow: true });
  }

  /**
   * Trata o evento de confirm cancelamento.
   */
  async function handleConfirmCancelamento({ motivo }) {
    setSaving(true);
    setError('');

    try {
      await onCancelSale(sale.id, motivo);
      setCancelModalOpen(false);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao cancelar venda.');
      setSaving(false);
      throw err;
    }
  }

  /**
   * Trata o evento de confirm reverter.
   */
  async function handleConfirmReverter({ observacao }) {
    setSaving(true);
    setError('');

    try {
      await onReverterCancelamento(sale.id, observacao);
      setRevertModalOpen(false);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao reverter cancelamento.');
      setSaving(false);
      throw err;
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => !saving && e.target === e.currentTarget && onClose()}
    >
      {returnModalOpen && (
        <ReturnReasonModal
          sale={sale}
          saving={saving}
          onClose={() => setReturnModalOpen(false)}
          onConfirm={handleConfirmRetorno}
        />
      )}
      {cancelModalOpen && (
        <CancelReasonModal
          sale={sale}
          saving={saving}
          onClose={() => setCancelModalOpen(false)}
          onConfirm={handleConfirmCancelamento}
        />
      )}
      {revertModalOpen && (
        <RevertCancelamentoModal
          sale={sale}
          saving={saving}
          onClose={() => setRevertModalOpen(false)}
          onConfirm={handleConfirmReverter}
        />
      )}

      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="modal-client">{sale.client}</div>
              <div className="modal-sub">{sale.id} · {sale.operator} · {sale.plan}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span className="pill">
                <span className="pill-dot"></span>
                {stageLabels[sale.stage] || sale.stage}
              </span>
              <span
                className={`sale-priority-badge sale-priority-badge--${priorityInfo.key}`}
                title={priorityInfo.label}
              >
                {priorityInfo.label.replace('Prioridade ', '')}
              </span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
                <I.Close size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="modal-tabs">
          {[
            { id: 'info', label: 'Informações' },
            { id: 'historico', label: 'Histórico' },
            ...(!modoAutomacoes && podeAcessarDocumentos ? [{ id: 'documentos', label: 'Documentos' }] : []),
            { id: 'status', label: 'Atualizar status' },
          ].map(t => (
            <button
              type="button"
              key={t.id}
              className={`modal-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body" data-navigation-scroll={`funil:${sale.id}:${tab}`}>
          {tab === 'info' && (
            <div className="detail-grid">
              {modoAutomacoes && (
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <div className="label">COMPARAÇÃO COM O FUNIL REAL</div>
                  <div className="value">
                    Real: {stageLabels[sale.statusFunilReal] || sale.statusFunilReal || 'Sem etapa'}
                    {' · '}{sale.canceladaEmReal ? 'Cancelada' : 'Ativa'}
                    {sale.divergenteAutomacao ? ' · Divergente' : ' · Em conformidade'}
                  </div>
                </div>
              )}
              <div className="detail-item">
                <div className="label">VALOR</div>
                <div className="value big">{formatBRL(sale.value)}</div>
              </div>
              <div className="detail-item">
                <div className="label">{sale.sellers?.length > 1 ? 'VENDEDORES' : 'VENDEDOR'}</div>
                <div className="value funil-sellers-list">
                  {(sale.sellers || [sale.seller]).map(seller => (
                    <span key={seller.id || seller.name} className="funil-seller-item">
                      <SellerAvatar seller={seller} className="seller-detail-avatar" />
                      <span>{seller.name}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="detail-item">
                <div className="label">CPF / CNPJ</div>
                <div className="value mono">{sale.cpfCnpj}</div>
              </div>
              <div className="detail-item">
                <div className="label">OPERADORA</div>
                <div className="value">{sale.operator}</div>
              </div>
              <div className="detail-item">
                <div className="label">PLANO</div>
                <div className="value">{sale.plan}</div>
              </div>
              <div className="detail-item">
                <div className="label">TELEFONE CELULAR</div>
                <div className="value mono">{sale.linha}</div>
              </div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <div className="label">ENDERECO DE ENTREGA</div>
                <div className="value">{sale.endereco}</div>
              </div>
              <div className="detail-item">
                <div className="label">LANCADA EM</div>
                <div className="value">{formatDate(sale.lancadaEm)}</div>
              </div>
              <div className="detail-item">
                <div className="label">ATUALIZADA</div>
                <div className="value">{timeAgo(sale.updated)}</div>
              </div>
              {finalizada && (
                <div className={`detail-item${editandoConclusao ? ' detail-item--conclusao-editando' : ''}`}>
                  <div className="label">CONCLUÍDA EM</div>
                  {editandoConclusao ? (
                    <div className="conclusao-editor">
                      <input
                        type="datetime-local"
                        aria-label="Data de conclusão"
                        aria-describedby="conclusao-validacao"
                        value={conclusaoInput}
                        min={conclusaoMinInput}
                        max={conclusaoMaxInput}
                        required
                        onChange={event => {
                          setConclusaoInput(event.target.value);
                          setError('');
                        }}
                        disabled={saving}
                      />
                      <div className="conclusao-editor__actions">
                        <button type="button" className="btn btn-primary btn-sm" onClick={salvarConclusao} disabled={saving || Boolean(validacaoConclusao.erro)}>
                          Salvar
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => { setEditandoConclusao(false); setError(''); }} disabled={saving}>
                          Cancelar
                        </button>
                      </div>
                      {validacaoConclusao.erro && (
                        <div id="conclusao-validacao" className="conclusao-editor__feedback" role="status">
                          {validacaoConclusao.erro}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="value conclusao-resumo">
                      <span>{entradaEtapaFinal ? formatDateTime(entradaEtapaFinal.dataConclusao) : historicoCarregando ? 'Carregando…' : 'Data não registrada'}</span>
                      {podeEditarConclusao && !historicoCarregando && (
                        <button type="button" className="btn btn-icon btn-ghost" onClick={iniciarEdicaoConclusao} title="Editar data de conclusão" aria-label="Editar data de conclusão">
                          <I.Edit size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {finalizada && (
                <div className="detail-item">
                  <div className="label">CONCLUÍDA POR</div>
                  <div className="value">
                    {entradaEtapaFinal?.autor || (historicoCarregando ? 'Carregando…' : 'Responsável não registrado')}
                  </div>
                </div>
              )}
              <div className="detail-item">
                <div className="label">PRIORIDADE</div>
                <div className="value">
                  <span className={`sale-priority-badge sale-priority-badge--${priorityInfo.key}`}>
                    {priorityInfo.label.replace('Prioridade ', '')}
                  </span>
                </div>
              </div>
              {error && <div className="alert-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
            </div>
          )}

          {tab === 'historico' && (
            <>
              <SaleDeliveryTracker
                sale={saleComHistorico}
                stages={stages}
                stageLabels={stageLabels}
              />
              {historicoCarregando && historicoEventos === sale.historico ? (
                <div className="sale-event-list sale-event-list--empty">Carregando eventos…</div>
              ) : (
                <SaleEventList sale={saleComHistorico} />
              )}
            </>
          )}

          {tab === 'documentos' && podeAcessarDocumentos && (
            <>
              <ArquivosVendaTab
                venda={{ id: sale.id }}
                podeEditar={podeEditarVenda && !salvandoDocNaCasa}
                podeVisualizar={podeVerDocumentos}
                podeAdicionar={podeAdicionarDocumentos}
                possuiDocNaCasa={possuiDocNaCasa}
                onPossuiDocNaCasaChange={handlePossuiDocNaCasaChange}
                onEtapasAtualizadas={etapas => onEtapasAtualizadas(sale.id, etapas)}
                onArquivosAlterados={() => onArquivosAlterados(sale.id)}
              />
              {error && <div className="alert-error" style={{ marginTop: 12 }}>{error}</div>}
            </>
          )}

          {tab === 'status' && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
                Mover esta venda para a fase
              </div>
              <div className="stage-selector">
                {stages.map(st => (
                  <button
                    type="button"
                    key={st.id}
                    className={`stage-chip ${novaFase === st.id ? 'active' : ''}`}
                    onClick={() => setNovaFase(st.id)}
                    disabled={saving}
                  >
                    {st.name}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                  Prioridade
                </div>
                <div className="stage-selector">
                  {Object.entries(PRIORITIES).map(([key, p]) => (
                    <button
                      type="button"
                      key={key}
                      className={`stage-chip ${novaPrioridade === key ? 'active' : ''}`}
                      onClick={() => handlePrioridadeClick(key)}
                      disabled={saving}
                    >
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: p.color, marginRight: 8 }}></span>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                  Observação {observacaoMovimentacaoObrigatoria ? '(obrigatória)' : '(opcional)'}
                </div>
                <textarea
                  className="obs-textarea"
                  placeholder="Adicione um detalhe sobre essa atualização..."
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                  disabled={saving}
                  aria-required={observacaoMovimentacaoObrigatoria}
                />
              </div>

              {error && <div className="alert-error" style={{ marginTop: 12 }}>{error}</div>}

              {cancelada && (
                <div className="alert-error" style={{ marginTop: 16 }}>
                  <strong>Venda cancelada.</strong> Motivo: {sale.motivoCancelamento || '(não informado)'}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!modoAutomacoes && !cancelada && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ color: 'var(--danger)', borderColor: '#fecaca' }}
                      onClick={() => setReturnModalOpen(true)}
                      disabled={saving}
                    >
                      <I.AlertTriangle size={13} /> Marcar como retorno
                    </button>
                  )}
                  {!modoAutomacoes && !cancelada && podeCancelar && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ color: '#fff', background: '#dc2626', borderColor: '#dc2626' }}
                      onClick={() => setCancelModalOpen(true)}
                      disabled={saving}
                    >
                      <I.AlertTriangle size={13} /> Cancelar venda
                    </button>
                  )}
                  {!modoAutomacoes && cancelada && podeReverterCancelamento && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setRevertModalOpen(true)}
                      disabled={saving}
                    >
                      Reverter cancelamento
                    </button>
                  )}
                </div>
                {!cancelada && alterou && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleAtualizar} disabled={saving}>
                    {saving ? 'Salvando...' : 'Confirmar mudança'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {onOpenFullSale && (
            <button type="button" className="btn btn-primary" onClick={onOpenFullSale} disabled={saving || openingFullSale}>
              <I.External size={13} /> {openingFullSale ? 'Abrindo...' : 'Abrir venda completa'}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza return reason modal.
 */
function ReturnReasonModal({ sale, saving, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const [observacao, setObservacao] = useState('');
  const [error, setError] = useState('');

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    const observacaoNormalizada = observacao.trim();
    const motivoFinal = motivo || observacaoNormalizada;

    if (!observacaoNormalizada) {
      setError('É obrigatório escrever uma observação para movimentar a venda no funil.');
      return;
    }

    setError('');

    try {
      await onConfirm({ motivo: motivoFinal, observacao: observacaoNormalizada });
    } catch (err) {
      setError(err.message || 'Erro ao marcar retorno.');
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={event => !saving && event.target === event.currentTarget && onClose()}
      style={{ zIndex: 60 }}
    >
      <form className="modal return-status-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Motivo do retorno</div>
              <div className="modal-sub">{sale.client} · #{sale.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="FunilPage-4">
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
            Por que esse chip retornou?
          </div>
          <div className="stage-selector">
            {RETURN_REASONS.map(reason => (
              <button
                type="button"
                key={reason}
                className={`stage-chip ${motivo === reason ? 'active' : ''}`}
                onClick={() => setMotivo(reason)}
                disabled={saving}
              >
                {reason}
              </button>
            ))}
          </div>

          <div className="form-field" style={{ marginTop: 20 }}>
            <label>Observação (obrigatória)</label>
            <textarea
              className="obs-textarea"
              placeholder="Ex: cliente recusou por endereço divergente, confirmar novo envio."
              value={observacao}
              onChange={event => setObservacao(event.target.value)}
              disabled={saving}
              aria-required="true"
              rows={4}
            />
          </div>

          {error && <div className="alert-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Confirmar retorno'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Renderiza revert cancelamento modal.
 */
function RevertCancelamentoModal({ sale, saving, onClose, onConfirm }) {
  const [observacao, setObservacao] = useState('');
  const [error, setError] = useState('');

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    try {
      await onConfirm({ observacao: observacao.trim() });
    } catch (err) {
      setError(err.message || 'Erro ao reverter cancelamento.');
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={event => !saving && event.target === event.currentTarget && onClose()}
      style={{ zIndex: 60 }}
    >
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Reverter cancelamento</div>
              <div className="modal-sub">{sale.client} · #{sale.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="FunilPage-5">
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
            A venda voltará ao estado normal na etapa atual. Você pode registrar uma observação explicando o motivo da reversão (opcional).
          </div>
          {sale.motivoCancelamento && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              <strong>Motivo do cancelamento original:</strong> {sale.motivoCancelamento}
            </div>
          )}
          <div className="form-field">
            <label>Observação (opcional)</label>
            <textarea
              className="obs-textarea"
              placeholder="Ex: cliente confirmou que quer prosseguir com a venda."
              value={observacao}
              onChange={event => setObservacao(event.target.value)}
              disabled={saving}
              rows={4}
              autoFocus
            />
          </div>

          {error && <div className="alert-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Voltar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Revertendo...' : 'Confirmar reversão'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Renderiza cancel reason modal.
 */
function CancelReasonModal({ sale, saving, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    const motivoLimpo = motivo.trim();

    if (!motivoLimpo) {
      setError('Informe o motivo do cancelamento.');
      return;
    }

    setError('');

    try {
      await onConfirm({ motivo: motivoLimpo });
    } catch (err) {
      setError(err.message || 'Erro ao cancelar venda.');
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={event => !saving && event.target === event.currentTarget && onClose()}
      style={{ zIndex: 60 }}
    >
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Cancelar venda</div>
              <div className="modal-sub">{sale.client} · #{sale.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="FunilPage-6">
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
            A venda permanecerá no funil, marcada como cancelada. Informe o motivo:
          </div>
          <div className="form-field">
            <label>Motivo do cancelamento</label>
            <textarea
              className="obs-textarea"
              placeholder="Ex: cliente desistiu, problema cadastral, etc."
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              disabled={saving}
              rows={4}
              autoFocus
            />
          </div>

          {error && <div className="alert-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Voltar</button>
          <button
            type="submit"
            className="btn"
            style={{ color: '#fff', background: '#dc2626', borderColor: '#dc2626' }}
            disabled={saving || !motivo.trim()}
          >
            {saving ? 'Cancelando...' : 'Confirmar cancelamento'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Renderiza delete stage modal.
 */
function DeleteStageModal({ stage, saving, onClose, onConfirm }) {
  const vendasCount = Number(stage?.vendasCount || 0);

  return (
    <div
      className="modal-overlay"
      onClick={event => !saving && event.target === event.currentTarget && onClose()}
    >
      <div className="modal delete-stage-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Excluir etapa</div>
              <div className="modal-sub">{stage?.name || stage?.nome}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={saving}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="FunilPage-7">
          <p className="delete-stage-text">
            Tem certeza que deseja excluir esta etapa do funil?
          </p>
          {vendasCount === 0 ? (
            <div className="alert-success">
              Esta etapa não possui vendas e será excluída definitivamente.
            </div>
          ) : (
            <div className="alert-error">
              Existem {vendasCount} venda{vendasCount === 1 ? '' : 's'} nessa etapa. Por isso, ela será apenas desativada, continuará aparecendo no funil e deixará de ser um destino válido para vendas.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={saving}>
            {saving ? 'Processando...' : vendasCount === 0 ? 'Excluir etapa' : 'Desativar etapa'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza o menu de acoes de uma etapa do funil, em portal para nao ser cortado
 * pelo overflow da coluna.
 */
function StageMenu({ stage, disabled, onRename, onToggleFinal, onToggleBarrier, onToggleAceiteBiometria, onToggleActive, onDelete }) {
  const [aberto, setAberto] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  /**
   * Calcula a posicao do menu ancorada no gatilho, com flip quando falta espaco.
   */
  function calcularPosicao() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const altura = menuRef.current?.offsetHeight || 200;
    const largura = menuRef.current?.offsetWidth || 210;
    const abreParaCima = rect.bottom + 4 + altura > window.innerHeight && rect.top - 4 - altura > 0;
    setMenuPos({
      top: abreParaCima ? rect.top - 4 - altura : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - largura, window.innerWidth - largura - 8))
    });
  }

  useLayoutEffect(() => {
    if (aberto) calcularPosicao();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    /**
     * Fecha o menu ao clicar fora do gatilho e do proprio menu.
     */
    function fecharFora(e) {
      if (!triggerRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) {
        setAberto(false);
      }
    }

    /**
     * Fecha o menu ao pressionar Escape.
     */
    function fecharEsc(e) {
      if (e.key === 'Escape') setAberto(false);
    }

    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEsc);
    window.addEventListener('resize', calcularPosicao);
    window.addEventListener('scroll', calcularPosicao, true);

    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEsc);
      window.removeEventListener('resize', calcularPosicao);
      window.removeEventListener('scroll', calcularPosicao, true);
    };
  }, [aberto]);

  /**
   * Fecha o menu e dispara a acao escolhida.
   */
  function executar(acao) {
    setAberto(false);
    acao();
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`btn btn-icon btn-ghost column-menu-btn${aberto ? ' is-open' : ''}`}
        onClick={() => setAberto(v => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Ações da etapa"
      >
        <I.More size={14} />
      </button>

      {aberto && createPortal(
        <div className="stage-menu" ref={menuRef} role="menu" style={{ top: menuPos.top, left: menuPos.left }}>
          <button type="button" role="menuitem" className="stage-menu__item" onClick={() => executar(onRename)}>
            <I.Edit size={13} /> Renomear
          </button>
          <button type="button" role="menuitem" className="stage-menu__item" onClick={() => executar(onToggleFinal)}>
            <I.Flag size={13} /> {stage.etapaFinal ? 'Remover etapa final' : 'Marcar como etapa final'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="stage-menu__item"
            onClick={() => executar(onToggleBarrier)}
            title="Vendas nesta etapa só avançam com todas as etapas de conferência concluídas"
          >
            <I.Shield size={13} /> {stage.bloqueiaAvanco ? 'Remover barreira' : 'Ativar barreira'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="stage-menu__item"
            onClick={() => executar(onToggleAceiteBiometria)}
            title="Exibe os marcadores de Aceite e Biometria e exige ambos para avançar"
          >
            <I.Check size={13} /> {stage.aceiteBiometria ? 'Remover Aceite/Biometria' : 'Marcar como Aceite/Biometria'}
          </button>

          <div className="stage-menu__sep" />

          <button type="button" role="menuitem" className="stage-menu__item" onClick={() => executar(onToggleActive)}>
            <I.EyeOff size={13} /> {stage.ativo === false ? 'Reativar etapa' : 'Desativar etapa'}
          </button>
          <button type="button" role="menuitem" className="stage-menu__item is-danger" onClick={() => executar(onDelete)}>
            <I.Trash size={13} /> Excluir etapa
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * Renderiza sale card.
 */
export function SaleCard({ sale, finalizada = false, aceiteBiometria = false, marcadorSaving = '', onToggleMarcador = () => {}, onClick, onEmail, gerandoEmailId, onXlsxClaro, baixandoXlsxId, onWhatsapp, onProblema, podeOperarPosVenda, modoAutomacoes = false, stageLabels = STAGE_LABELS }) {
  const priorityInfo = getPriorityInfo(sale.priority);
  const cancelada = Boolean(sale.canceladaEm);
  const semDocumento = sale.semDocumento ?? vendaSemDocumento(sale);
  const biometriaAplicavel = String(sale.operator || '').trim().toLowerCase() === 'claro';
  const marcadoresAceite = [
    ['aceite', 'Aceite', sale.aceiteConcluido],
    ...(biometriaAplicavel ? [['biometria', 'Biometria', sale.biometriaConcluida]] : [])
  ];
  const classeStatus = cancelada ? ' sale-card-cancelada' : finalizada ? ' sale-card-finalizada' : '';
  const classeDocumento = semDocumento ? ' sale-card-sem-documento' : '';
  const cardRef = useRef(null);
  const [tooltipPosicao, setTooltipPosicao] = useState(null);

  function exibirTooltip() {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const largura = 260;
    const alturaEstimada = 130;
    const esquerda = Math.min(
      Math.max(rect.left + (rect.width / 2), (largura / 2) + 8),
      window.innerWidth - (largura / 2) - 8
    );
    const abaixo = rect.bottom + alturaEstimada + 8 <= window.innerHeight;

    setTooltipPosicao({
      left: esquerda,
      top: abaixo ? rect.bottom + 8 : Math.max(8, rect.top - alturaEstimada - 8)
    });
  }

  return (
    <>
    <div
      ref={cardRef}
      className={`sale-card sale-card-priority-${priorityInfo.key}${classeStatus}${classeDocumento}${sale.divergenteAutomacao ? ' sale-card-divergente' : ''}`}
      onClick={onClick}
      onMouseEnter={exibirTooltip}
      onMouseLeave={() => setTooltipPosicao(null)}
      title={[
        cancelada && (sale.motivoCancelamento ? `Cancelada: ${sale.motivoCancelamento}` : 'Venda cancelada'),
        semDocumento && 'Venda sem documento na casa nem anexado no sistema',
        !cancelada && finalizada && 'Venda na etapa final',
        priorityInfo.label
      ].filter(Boolean).join(' - ')}
    >

      {cancelada && (
        <span className="sale-card-cancelada-tag">Cancelada</span>
      )}
      {modoAutomacoes && sale.divergenteAutomacao && (
        <span className="sale-card-divergente-tag">Divergente</span>
      )}
      {semDocumento && (
        <span className="sale-card-sem-documento-tag">Venda sem doc</span>
      )}
      {!cancelada && finalizada && (
        <span className="sale-card-finalizada-tag">Finalizada</span>
      )}
      <div className="sale-card-top">
        <div className="client" title={sale.client}>{sale.client}</div>
        <div className="value">{formatBRL(sale.value)}</div>
      </div>
      <div className="sale-card-meta">
        <span className="operator">{sale.operator}</span>
        <span>·</span>
        <span>{sale.plan}</span>
        {sale.base0800 && (
          <span
            className={`sale-base-badge sale-base-badge--${sale.raw?.etapa_0800_resultado}`}
            title={`Verificação com o 0800: ${sale.base0800}`}
          >
            {sale.base0800}
          </span>
        )}
        <span
          className={`sale-priority-badge sale-priority-badge--${priorityInfo.key}`}
          title={priorityInfo.label}
        >
          {priorityInfo.label.replace('Prioridade ', '')}
        </span>
      </div>
      {modoAutomacoes && (
        <div className="sale-card-real-state">
          Real: {stageLabels[sale.statusFunilReal] || sale.statusFunilReal || 'Sem etapa'}
          {' · '}{sale.canceladaEmReal ? 'Cancelada' : 'Ativa'}
        </div>
      )}
      {aceiteBiometria && (
        <div className="sale-card-markers" aria-label={biometriaAplicavel ? 'Conclusão de Aceite e Biometria' : 'Conclusão de Aceite'}>
          {marcadoresAceite.map(([marcador, rotulo, concluido]) => {
            const chave = `${sale.id}:${marcador}`;
            const vendaSalvando = marcadorSaving.startsWith(`${sale.id}:`);
            const salvando = marcadorSaving === chave;
            const indisponivel = Boolean(sale.canceladaEm) || vendaSalvando;
            return (
              <button
                key={marcador}
                type="button"
                className={`sale-card-marker${concluido ? ' is-complete' : ''}${salvando ? ' is-saving' : ''}`}
                aria-pressed={concluido}
                aria-busy={salvando || undefined}
                aria-disabled={indisponivel}
                title={`${rotulo}: ${concluido ? 'concluído' : 'pendente'}. Clique para alterar.`}
                disabled={Boolean(sale.canceladaEm)}
                onClick={event => {
                  event.stopPropagation();
                  if (vendaSalvando) return;
                  onToggleMarcador(sale, marcador, !concluido);
                }}
              >
                {rotulo}
              </button>
            );
          })}
        </div>
      )}
      <div className="sale-card-bottom">
        <span className="seller">
          <SellerAvatar seller={sale.seller} />
          <span className="seller-name">{sale.seller.name}</span>
          <span>#{sale.id}</span>
        </span>
        <div className="vendas-contact-actions sale-card-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto' }}>
          {!modoAutomacoes && (
            <>
              {podeOperarPosVenda && (
                <button
                  type="button"
                  className="btn btn-icon btn-ghost btn-warn-icon"
                  title="Problemas da venda"
                  onClick={(e) => {
                    e.stopPropagation();
                    onProblema(sale.raw);
                  }}
                  style={{ padding: 4, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <I.AlertTriangle size={12} />
                </button>
              )}
              <button
                type="button"
                className="btn btn-icon btn-ghost vendas-whatsapp-btn"
                title="Gerar mensagem para WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  onWhatsapp(sale.raw);
                }}
                style={{ padding: 4, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <I.Whatsapp size={12} />
              </button>
              <button
                type="button"
                className="btn btn-icon btn-ghost vendas-email-btn"
                title="Gerar corpo de email"
                disabled={gerandoEmailId === sale.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onEmail(sale.raw);
                }}
                style={{ padding: 4, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {gerandoEmailId === sale.id ? (
                  <div className="spinner-small" style={{ width: 12, height: 12, border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                ) : (
                  <I.Mail size={12} />
                )}
              </button>
              {/claro/i.test(sale.raw?.operadora?.nome) && (
                <button
                  type="button"
                  className="btn btn-icon btn-ghost vendas-xlsx-btn"
                  title="Baixar planilha Claro"
                  disabled={baixandoXlsxId === sale.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onXlsxClaro(sale.raw);
                  }}
                  style={{ padding: 4, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <I.TableSheet size={12} />
                </button>
              )}
            </>
          )}
          <span style={{ fontSize: '10px' }}>{timeAgo(sale.updated)}</span>
        </div>
      </div>
    </div>
    {tooltipPosicao && createPortal(
      <div
        className="sale-stage-history-tooltip"
        role="tooltip"
        style={{ left: tooltipPosicao.left, top: tooltipPosicao.top }}
      >
        <strong>Passagens pelas etapas</strong>
        <ul>
          {sale.passagensEtapas.map(etapa => (
            <li key={etapa.codigo}>
              <span>{etapa.nome}</span>
              <b>{etapa.quantidade}x</b>
            </li>
          ))}
        </ul>
      </div>,
      document.body
    )}
    </>
  );
}

const NOVA_ETAPA = {
  nome: '',
  ordem: 0,
  ativo: true,
  etapa_final: false,
  bloqueia_avanco: false,
  aceite_biometria: false
};

/**
 * Renderiza sortable column com os dados informados.
 */
function SortableColumn({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  return children({ setNodeRef, transform, transition, isDragging, dragAttributes: attributes, dragListeners: listeners });
}

const DADOS_MODAL_VENDA_INICIAIS = {
  loaded: false,
  clientes: [],
  vendas: [],
  vendedoras: [],
  operadoras: [],
  tiposVenda: [],
  servicos: [],
  etapasFunil: []
};

/**
 * Renderiza funil page.
 */
function FunilPage({ modoAutomacoes = false }) {
  const [searchParams] = useSearchParams();
  const usuario = getUsuarioLocal();
  const podeGerenciarEtapas = !modoAutomacoes && temPermissao(usuario, 'crud_funil_etapas');
  const podeAbrirVendaCompleta = temPermissao(usuario, [
    'vendas',
    'vendas_ver_proprias',
    'vendas_ver_todas',
    'vendas_criar',
    'vendas_editar',
    'vendas_excluir'
  ]);
  const podeEditarVenda = temPermissao(usuario, ['vendas_editar', 'pos_venda']);
  const podeCancelarVenda = temPermissao(usuario, 'vendas_cancelar');
  const podeReverterCancelamentoVenda = temPermissao(usuario, 'vendas_reverter_cancelamento');
  const podeVerDocumentosVenda = temPermissao(usuario, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuario, 'adicionar_documentos');
  const podeListarClientes = temPermissao(usuario, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const podeOperarPosVenda = temPermissao(usuario, 'pos_venda');
  const [sales, setSales] = useState([]);
  const [stages, setStages] = useState(FALLBACK_STAGES);
  const [adminStages, setAdminStages] = useState([]);
  const [busca, setBusca] = useNavigationState(`FunilPage:${modoAutomacoes}:busca`, '');
  const [vendedoras, setVendedoras] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [tiposVenda, setTiposVenda] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [vendedoraId, setVendedoraId] = useNavigationState(`FunilPage:${modoAutomacoes}:vendedoraId`, '');
  const [operadoraId, setOperadoraId] = useNavigationState(`FunilPage:${modoAutomacoes}:operadoraId`, '');
  const [tipoVendaId, setTipoVendaId] = useNavigationState(`FunilPage:${modoAutomacoes}:tipoVendaId`, '');
  const [servicoId, setServicoId] = useNavigationState(`FunilPage:${modoAutomacoes}:servicoId`, '');
  const [statusFunil, setStatusFunil] = useNavigationState(`FunilPage:${modoAutomacoes}:statusFunil`, '');
  const [prioridadeFunil, setPrioridadeFunil] = useNavigationState(`FunilPage:${modoAutomacoes}:prioridadeFunil`, '');
  const [uf, setUf] = useNavigationState(`FunilPage:${modoAutomacoes}:uf`, '');
  const [municipio, setMunicipio] = useNavigationState(`FunilPage:${modoAutomacoes}:municipio`, '');
  const [dataInicio, setDataInicio] = useNavigationState(`FunilPage:${modoAutomacoes}:dataInicio`, '');
  const [dataFim, setDataFim] = useNavigationState(`FunilPage:${modoAutomacoes}:dataFim`, '');
  const [valorMin, setValorMin] = useNavigationState(`FunilPage:${modoAutomacoes}:valorMin`, '');
  const [valorMax, setValorMax] = useNavigationState(`FunilPage:${modoAutomacoes}:valorMax`, '');
  const [visibilidadeCanceladas, setVisibilidadeCanceladas] = useNavigationState(`FunilPage:${modoAutomacoes}:visibilidadeCanceladas`, VISIBILIDADE_TODAS);
  const [visibilidadeSemDocumento, setVisibilidadeSemDocumento] = useNavigationState(`FunilPage:${modoAutomacoes}:visibilidadeSemDocumento`, VISIBILIDADE_TODAS);
  const [somenteDivergentes, setSomenteDivergentes] = useNavigationState(`FunilPage:${modoAutomacoes}:somenteDivergentes`, false);
  const [filtrosAbertos, setFiltrosAbertos] = useNavigationState(`FunilPage:${modoAutomacoes}:filtrosAbertos`, false);
  const buscaDeferred = useDeferredValue(busca);
  const [selectedSaleId, setSelectedSaleId] = useNavigationState(`FunilPage:${modoAutomacoes}:selecao`, null, { validate: value => value === null || (Number.isSafeInteger(value) && value > 0) });
  const [vendaProblema, setVendaProblema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [stageSavingId, setStageSavingId] = useState(null);
  const [creatingStage, setCreatingStage] = useState(false);
  const [newStage, setNewStage] = useState(NOVA_ETAPA);
  const [editStageNames, setEditStageNames] = useState({});
  const [showNewStageForm, setShowNewStageForm] = useState(false);
  const [editingStageId, setEditingStageId] = useState(null);
  const [stageToDelete, setStageToDelete] = useState(null);
  const [error, setError] = useState('');
  const [stageFeedback, setStageFeedback] = useState({ type: '', message: '' });
  const [marcadorSaving, setMarcadorSaving] = useState('');

  const [emailTemplate, setEmailTemplate] = useState(null);
  const [gerandoEmailId, setGerandoEmailId] = useState(null);
  const [copiandoEmail, setCopiandoEmail] = useState(false);
  const [whatsappMensagem, setWhatsappMensagem] = useState(null);
  const [copiandoWhatsapp, setCopiandoWhatsapp] = useState(false);
  const [, setAgora] = useState(Date.now);
  const [baixandoXlsxId, setBaixandoXlsxId] = useState(null);
  const [vendaCompleta, setVendaCompleta] = useNavigationRecord(`FunilPage:${modoAutomacoes}:venda`, {
    load: async id => {
      if (!podeAbrirVendaCompleta) throw new Error('Você não tem acesso ao detalhe desta venda.');
      await carregarDadosModalVenda();
      return buscarVendaPorId(id);
    },
    ready: !searchParams.has('venda_id'),
    onRestore: () => setModalVendaModoEdicao(false),
    onError: error => setStageFeedback({ type: 'error', message: error.message })
  });
  const [dadosModalVenda, setDadosModalVenda] = useState(DADOS_MODAL_VENDA_INICIAIS);
  const [abrindoVendaCompletaId, setAbrindoVendaCompletaId] = useState(null);
  const [modalVendaModoEdicao, setModalVendaModoEdicao] = useState(false);
  const [clienteRapidoAberto, setClienteRapidoAberto] = useState(false);
  const [clienteRapidoInicial, setClienteRapidoInicial] = useState(null);
  const resolverClienteRapidoRef = useRef(null);
  const aberturaNotificacaoProcessadaRef = useRef('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const vendasPorCliente = useMemo(() => contarVendasPorCliente(dadosModalVenda.vendas), [dadosModalVenda.vendas]);
  const vendasEmAndamentoPorCliente = useMemo(() => {
    const codigosFinais = new Set(dadosModalVenda.etapasFunil.filter(etapa => etapa.etapa_final).map(etapa => etapa.codigo));
    const ativas = dadosModalVenda.vendas.filter(venda => !codigosFinais.has(venda.status_funil));
    return contarVendasPorCliente(ativas);
  }, [dadosModalVenda.vendas, dadosModalVenda.etapasFunil]);

  /**
   * Carrega dados modal venda e atualiza o estado relacionado.
   */
  async function carregarDadosModalVenda({ force = false } = {}) {
    if (dadosModalVenda.loaded && !force) {
      return dadosModalVenda;
    }

    const [
      vendasData,
      clientesData,
      vendedorasData,
      operadorasData,
      tiposVendaData,
      servicosData,
      etapasFunilData
    ] = await Promise.all([
      listarVendas(),
      podeListarClientes ? listarClientes() : Promise.resolve([]),
      listarVendedoras(),
      listarOperadoras(),
      listarTiposVenda(),
      listarServicos(),
      listarEtapasFunil()
    ]);

    const dados = {
      loaded: true,
      clientes: clientesData || [],
      vendas: vendasData || [],
      vendedoras: vendedorasData || [],
      operadoras: operadorasData || [],
      tiposVenda: tiposVendaData || [],
      servicos: servicosData || [],
      etapasFunil: etapasFunilData || []
    };

    setDadosModalVenda(dados);
    return dados;
  }

  /**
   * Abre venda completa e prepara o estado necessario.
   */
  async function abrirVendaCompleta(sale) {
    if (!podeAbrirVendaCompleta || !sale?.id) return;

    setAbrindoVendaCompletaId(sale.id);
    setStageFeedback({ type: '', message: '' });

    try {
      const [venda] = await Promise.all([
        buscarVendaPorId(sale.id),
        carregarDadosModalVenda()
      ]);
      setVendaCompleta(venda);
      setModalVendaModoEdicao(false);
      setSelectedSaleId(null);
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao abrir venda completa.' });
    } finally {
      setAbrindoVendaCompletaId(null);
    }
  }

  /**
   * Reflete no card do funil o resultado do 0800 alterado dentro do modal da venda.
   */
  function handleEtapasAtualizadas(saleId, etapas) {
    const resultado = (etapas || []).find(etapa => etapa.chave === '0800')?.resultado || null;

    setSales(prev => prev.map(sale => (
      sale.id === saleId
        ? {
          ...sale,
          base0800: ROTULOS_BASE_0800[resultado] || '',
          raw: { ...sale.raw, etapa_0800_resultado: resultado }
        }
        : sale
    )));
  }

  /**
   * Atualiza o marcador de documento fisico e reflete o resultado no funil.
   */
  async function handleUpdatePossuiDocNaCasa(saleId, possuiDocNaCasa) {
    const vendaAtualizada = await atualizarVenda(saleId, {
      possui_doc_na_casa: possuiDocNaCasa
    });

    setSales(prev => prev.map(sale => (
      sale.id === saleId
        ? { ...sale, ...mapVendaToSale(vendaAtualizada, stageLabels) }
        : sale
    )));
  }

  /**
   * Fecha venda completa e limpa o estado relacionado.
   */
  function fecharVendaCompleta() {
    setVendaCompleta(null);
    setModalVendaModoEdicao(false);
  }

  /**
   * Salva venda completa com os dados informados.
   */
  async function salvarVendaCompleta(dados) {
    if (!vendaCompleta?.id) return;

    await atualizarVenda(vendaCompleta.id, dados);
    fecharVendaCompleta();
    await carregarDadosModalVenda({ force: true });
    await carregarVendas();
    setStageFeedback({ type: 'success', message: 'Venda atualizada com sucesso.' });
  }

  /**
   * Envia pos venda completa para processamento.
   */
  async function enviarPosVendaCompleta(venda) {
    const resultado = await enviarVendaParaPosVenda(venda.id);
    fecharVendaCompleta();
    await carregarDadosModalVenda({ force: true });
    await carregarVendas();
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    setStageFeedback({
      type: 'success',
      message: resultado?.status === 'pendente'
        ? (resultado.message || 'Solicitação enviada para aprovação do ADM.')
        : 'Venda enviada para o pos-venda.'
    });
  }

  /**
   * Abre cliente rapido e prepara o estado necessario.
   */
  function abrirClienteRapido(clienteInicial = null) {
    return new Promise(resolve => {
      resolverClienteRapidoRef.current = resolve;
      setClienteRapidoInicial(clienteInicial);
      setClienteRapidoAberto(true);
    });
  }

  /**
   * Fecha cliente rapido e limpa o estado relacionado.
   */
  function fecharClienteRapido(cliente = null) {
    setClienteRapidoAberto(false);
    setClienteRapidoInicial(null);
    resolverClienteRapidoRef.current?.(cliente);
    resolverClienteRapidoRef.current = null;
  }

  /**
   * Salva cliente rapido com os dados informados.
   */
  async function salvarClienteRapido(clienteCriado) {
    const clientesAtualizados = podeListarClientes ? await listarClientes() : [];
    setDadosModalVenda(prev => ({ ...prev, clientes: clientesAtualizados }));
    fecharClienteRapido(clienteCriado);
    return clienteCriado;
  }

  /**
   * Trata o evento de baixar xlsx claro.
   */
  async function handleBaixarXlsxClaro(venda) {
    if (!venda?.id) return;
    setBaixandoXlsxId(venda.id);
    try {
      const nome = venda.razao_social || venda.cliente?.razao_social || venda.cliente?.nome || venda.id;
      await baixarXlsxClaro(venda.id, nome);
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao gerar planilha Claro.' });
    } finally {
      setBaixandoXlsxId(null);
    }
  }

  /**
   * Abre email venda e prepara o estado necessario.
   */
  async function abrirEmailVenda(venda) {
    if (!venda?.id) return;
    setGerandoEmailId(venda.id);

    try {
      const resultado = await gerarEmailVenda(venda.id);
      setEmailTemplate({ ...resultado, venda });
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao gerar corpo de email.' });
    } finally {
      setGerandoEmailId(null);
    }
  }

  /**
   * Copia email venda para o destino esperado.
   */
  async function copiarEmailVenda() {
    if (!emailTemplate?.texto) return;

    setCopiandoEmail(true);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(emailTemplate.texto);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = emailTemplate.texto;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setStageFeedback({ type: 'success', message: 'Corpo do email copiado.' });
      setEmailTemplate(null);
    } catch {
      setStageFeedback({ type: 'error', message: 'Erro ao copiar email.' });
    } finally {
      setCopiandoEmail(false);
    }
  }

  /**
   * Renderiza abrir mensagem whatsapp.
   */
  function abrirMensagemWhatsapp(venda) {
    if (!venda?.id) return;
    const documentosFaltantes = obterDocumentosFaltantesPadrao(venda);
    setWhatsappMensagem({
      venda,
      documentosFaltantes,
      texto: montarChecklistWhatsappVenda(venda, documentosFaltantes)
    });
  }

  /**
   * Renderiza atualizar documentos whatsapp.
   */
  function atualizarDocumentosWhatsapp(documentosFaltantes) {
    setWhatsappMensagem(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        documentosFaltantes,
        texto: montarChecklistWhatsappVenda(prev.venda, documentosFaltantes)
      };
    });
  }

  /**
   * Renderiza copiar mensagem whatsapp.
   */
  async function copiarMensagemWhatsapp() {
    if (!whatsappMensagem?.texto) return;

    setCopiandoWhatsapp(true);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(whatsappMensagem.texto);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = whatsappMensagem.texto;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setStageFeedback({ type: 'success', message: 'Mensagem do WhatsApp copiada.' });
      setWhatsappMensagem(null);
    } catch {
      setStageFeedback({ type: 'error', message: 'Não foi possível copiar a mensagem automaticamente.' });
    } finally {
      setCopiandoWhatsapp(false);
    }
  }

  /**
   * Sincroniza etapas com os dados atuais.
   */
  function sincronizarEtapas(etapas, { atualizarAdmin = false, fallbackAdminEtapa = null } = {}) {
    const etapasNormalizadas = normalizarEtapasFunil(etapas, !atualizarAdmin);
    const etapasComFallback = fallbackAdminEtapa
      ? [
        ...etapasNormalizadas.filter(etapa => etapa.adminId !== fallbackAdminEtapa.adminId),
        fallbackAdminEtapa
      ].sort((a, b) => {
        if (a.ordem !== b.ordem) return a.ordem - b.ordem;
        return a.name.localeCompare(b.name);
      })
      : etapasNormalizadas;

    setStages(etapasComFallback.length > 0 || atualizarAdmin ? etapasComFallback : FALLBACK_STAGES);

    if (atualizarAdmin) {
      setAdminStages(etapasComFallback);
      setEditStageNames(Object.fromEntries(etapasComFallback.map(etapa => [etapa.adminId, etapa.name])));
    }

    return montarStageLabels(etapasComFallback);
  }

  /**
   * Carrega etapas admin e atualiza o estado relacionado.
   */
  async function carregarEtapasAdmin(fallbackAdminEtapa = null) {
    if (!podeGerenciarEtapas) return;

    setStagesLoading(true);
    try {
      const etapas = await listarEtapasFunilAdmin();
      sincronizarEtapas(etapas, { atualizarAdmin: true, fallbackAdminEtapa });
    } catch (err) {
      if (fallbackAdminEtapa) {
        sincronizarEtapas([...adminStages, fallbackAdminEtapa], { atualizarAdmin: true });
      } else {
        setStageFeedback({ type: 'error', message: err.message || 'Erro ao carregar etapas do funil.' });
      }
    } finally {
      setStagesLoading(false);
    }
  }

  /**
   * Carrega vendas e atualiza o estado relacionado.
   */
  async function carregarVendas() {
    setLoading(true);
    setError('');

    try {
      const [vendas, etapas, vendedorasData, operadorasData, tiposVendaData, servicosData] = await Promise.all([
        modoAutomacoes
          ? listarVendasFunilAutomacoes()
          : listarVendas({ enviadas_pos_venda: '1', ocultar_concluidas_antigas: '1' }),
        podeGerenciarEtapas ? listarEtapasFunilAdmin() : listarEtapasFunil(),
        listarVendedoras().catch(() => []),
        listarOperadoras().catch(() => []),
        listarTiposVenda().catch(() => []),
        listarServicos().catch(() => [])
      ]);
      const labels = sincronizarEtapas(etapas, { atualizarAdmin: podeGerenciarEtapas });
      setSales(Array.isArray(vendas) ? vendas.map(venda => mapVendaToSale(venda, labels)) : []);
      setVendedoras(Array.isArray(vendedorasData) ? vendedorasData : []);
      setOperadoras(Array.isArray(operadorasData) ? operadorasData : []);
      setTiposVenda(Array.isArray(tiposVendaData) ? tiposVendaData : []);
      setServicos(Array.isArray(servicosData) ? servicosData : []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar funil.');
    } finally {
      setLoading(false);
    }
  }

  const carregarVendasInicial = useEffectEvent(carregarVendas);
  useEffect(() => {
    carregarVendasInicial();
  }, []);

  useEffect(() => {
    const vendaId = Number(searchParams.get('venda_id') || 0);
    const notificacaoId = getNotificacaoIdParam(searchParams);
    if (loading || !vendaId || !notificacaoId) return;
    const chaveAbertura = `${vendaId}:${notificacaoId}`;
    if (aberturaNotificacaoProcessadaRef.current === chaveAbertura) return;
    aberturaNotificacaoProcessadaRef.current = chaveAbertura;

    const venda = sales.find(item => Number(item.id) === vendaId);
    if (!venda) {
      falharAberturaNotificacao(notificacaoId);
      queueMicrotask(() => setError('A venda desta notificação não está mais disponível no funil.'));
      return;
    }

    queueMicrotask(() => {
      setSelectedSaleId(venda.id);
      void confirmarAberturaNotificacao(notificacaoId).catch(error => {
        console.error('Erro ao confirmar abertura da notificacao:', error);
      });
    });
  }, [loading, sales, searchParams, setSelectedSaleId]);

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!stageFeedback.message) return undefined;
    const timer = setTimeout(() => setStageFeedback({ type: '', message: '' }), 5000);
    return () => clearTimeout(timer);
  }, [stageFeedback.message]);

  /**
   * Atualiza etapas apos crud com os dados informados.
   */
  async function atualizarEtapasAposCrud(message, fallbackAdminEtapa = null) {
    await carregarEtapasAdmin(fallbackAdminEtapa);
    setStageFeedback({ type: 'success', message });
  }

  /**
   * Trata o evento de create stage.
   */
  async function handleCreateStage(event) {
    event.preventDefault();

    if (!newStage.nome.trim()) return;

    setCreatingStage(true);
    setStageFeedback({ type: '', message: '' });

    try {
      await criarEtapaFunil({
        nome: newStage.nome.trim(),
        etapa_final: newStage.etapa_final,
        bloqueia_avanco: newStage.bloqueia_avanco,
        aceite_biometria: newStage.aceite_biometria,
        ativo: true,
        ordem: stagesVisiveis.filter(s => s.adminId).length + 1
      });
      setNewStage(NOVA_ETAPA);
      setShowNewStageForm(false);
      await atualizarEtapasAposCrud('Etapa adicionada com sucesso.');
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao adicionar etapa.' });
    } finally {
      setCreatingStage(false);
    }
  }

  /**
   * Trata o evento de drag end.
   */
  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIndex = stagesVisiveis.findIndex(s => s.id === active.id);
    const newIndex = stagesVisiveis.findIndex(s => s.id === over.id);
    const reordenadas = arrayMove(stagesVisiveis, oldIndex, newIndex);
    flushSync(() => setStages(reordenadas));
    const ordens = reordenadas.filter(s => s.adminId).map((s, i) => ({ id: s.adminId, ordem: i + 1 }));
    try {
      await reordenarEtapasFunil(ordens);
    } catch {
      await carregarEtapasAdmin();
    }
  }

  /**
   * Cancela a edicao inline do nome, restaurando o valor original.
   */
  function cancelarEdicaoEtapa(stage) {
    setEditingStageId(null);
    setEditStageNames(prev => ({ ...prev, [stage.adminId]: stage.name }));
  }

  /**
   * Trata o evento de save stage name.
   */
  async function handleSaveStageName(stage) {
    const nome = editStageNames[stage.adminId]?.trim();
    if (!stage.adminId || !nome || nome === stage.name) return;

    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      await atualizarEtapaFunil(stage.adminId, {
        nome,
        ordem: Number(stage.ordem || 0),
        ativo: stage.ativo,
        etapa_final: stage.etapaFinal
      });
      setEditingStageId(null);
      await atualizarEtapasAposCrud('Nome da etapa atualizado.');
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao atualizar etapa.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Trata o evento de toggle stage.
   */
  async function handleToggleStage(stage) {
    if (!stage.adminId) return;

    const proximoAtivo = !stage.ativo;
    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      await atualizarEtapaFunil(stage.adminId, {
        nome: editStageNames[stage.adminId]?.trim() || stage.name,
        ordem: Number(stage.ordem || 0),
        ativo: proximoAtivo,
        etapa_final: stage.etapaFinal
      });
      await atualizarEtapasAposCrud(proximoAtivo ? 'Etapa reativada.' : 'Etapa desativada.');
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao alterar status da etapa.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Trata o evento de delete stage.
   */
  async function handleDeleteStage(stage) {
    if (!stage.adminId) return;

    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      const resultado = await excluirEtapaFunil(stage.adminId);
      const etapaFallback = resultado?.acao === 'desativada' && resultado?.etapa
        ? normalizarEtapasFunil([resultado.etapa], false)[0]
        : null;
      setEditingStageId(null);
      setStageToDelete(null);
      await atualizarEtapasAposCrud(
        resultado?.acao === 'desativada'
          ? 'Etapa desativada porque possui vendas vinculadas. Ela continuará visível no funil.'
          : 'Etapa excluída com sucesso.',
        etapaFallback
      );
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao excluir etapa.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Trata o evento de toggle final stage.
   */
  async function handleToggleFinalStage(stage) {
    if (!stage.adminId) return;

    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      await atualizarEtapaFunil(stage.adminId, {
        nome: editStageNames[stage.adminId]?.trim() || stage.name,
        ordem: Number(stage.ordem || 0),
        ativo: stage.ativo,
        etapa_final: !stage.etapaFinal
      });
      await atualizarEtapasAposCrud(!stage.etapaFinal ? 'Etapa final definida.' : 'Etapa deixou de ser final.');
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao definir etapa final.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Trata o evento de toggle barrier stage.
   */
  async function handleToggleBarrierStage(stage) {
    if (!stage.adminId) return;

    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      await atualizarEtapaFunil(stage.adminId, {
        bloqueia_avanco: !stage.bloqueiaAvanco
      });
      await atualizarEtapasAposCrud(
        !stage.bloqueiaAvanco
          ? 'Barreira definida: vendas nesta etapa só avançam com as etapas de conferência concluídas.'
          : 'Barreira removida da etapa.'
      );
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao definir barreira da etapa.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Alterna se a etapa exige os marcadores de aceite e biometria.
   */
  async function handleToggleAceiteBiometriaStage(stage) {
    if (!stage.adminId) return;

    setStageSavingId(stage.adminId);
    setStageFeedback({ type: '', message: '' });

    try {
      await atualizarEtapaFunil(stage.adminId, {
        aceite_biometria: !stage.aceiteBiometria
      });
      await atualizarEtapasAposCrud(
        !stage.aceiteBiometria
          ? 'Etapa marcada como Aceite/Biometria.'
          : 'Marcação de Aceite/Biometria removida da etapa.'
      );
    } catch (err) {
      setStageFeedback({ type: 'error', message: err.message || 'Erro ao configurar Aceite/Biometria.' });
    } finally {
      setStageSavingId(null);
    }
  }

  /**
   * Atualiza uma tag do cartão sem abrir a venda ou alterar os demais cartões.
   */
  async function handleToggleMarcador(sale, marcador, concluido) {
    const chave = `${sale.id}:${marcador}`;
    setMarcadorSaving(chave);
    setError('');

    try {
      const marcadores = await atualizarAceiteBiometriaVenda(sale.id, marcador, concluido);
      setSales(prev => prev.map(item => (
        item.id === sale.id
          ? {
            ...item,
            aceiteConcluido: Boolean(marcadores.aceite_concluido),
            biometriaConcluida: Boolean(marcadores.biometria_concluida),
            raw: { ...item.raw, ...marcadores }
          }
          : item
      )));
    } catch (err) {
      setError(err.message || 'Erro ao atualizar Aceite/Biometria da venda.');
    } finally {
      setMarcadorSaving('');
    }
  }

  /**
   * Trata o evento de update sale.
   */
  async function handleUpdateSale(saleId, novaFase, novaPrioridade, observacao, motivoRetorno) {
    if (modoAutomacoes) {
      const vendaAtualizada = await atualizarStatusVendaFunilAutomacoes(saleId, {
        status_funil: novaFase,
        prioridade_funil: novaPrioridade,
        observacao
      });
      setSales(prev => prev.map(sale => (
        sale.id === saleId ? mapVendaToSale(vendaAtualizada, stageLabels) : sale
      )));
      return;
    }

    if (novaFase === 'retorno') {
      await atualizarStatusVenda(saleId, {
        status_funil: 'retorno',
        prioridade_funil: novaPrioridade,
        motivo_retorno: motivoRetorno,
        observacao
      });

      setSelectedSaleId(null);
      setSales(prev => prev.filter(sale => sale.id !== saleId));
      return;
    }

    const vendaAtualizada = await atualizarStatusVenda(saleId, {
      status_funil: novaFase,
      prioridade_funil: novaPrioridade,
      observacao
    });

    setSales(prev => prev.map(sale => {
      if (sale.id !== saleId) return sale;
      return {
        ...sale,
        ...mapVendaToSale(vendaAtualizada, stageLabels)
      };
    }));
  }

  /** Atualiza a data auditavel de conclusao e devolve o resumo remapeado ao modal. */
  async function handleUpdateConclusao(saleId, concluidaEm) {
    const vendaAtualizada = await atualizarConclusaoVenda(saleId, concluidaEm);
    const saleAtualizada = mapVendaToSale(vendaAtualizada, stageLabels);
    setSales(prev => prev.map(sale => (sale.id === saleId ? saleAtualizada : sale)));
    return saleAtualizada;
  }

  /**
   * Trata o evento de cancelar venda.
   */
  async function handleCancelarVenda(saleId, motivo) {
    const vendaAtualizada = await cancelarVenda(saleId, motivo);
    setSales(prev => prev.map(sale => {
      if (sale.id !== saleId) return sale;
      return {
        ...sale,
        ...mapVendaToSale(vendaAtualizada, stageLabels)
      };
    }));
  }

  /**
   * Trata o evento de reverter cancelamento venda.
   */
  async function handleReverterCancelamentoVenda(saleId, observacao) {
    const vendaAtualizada = await reverterCancelamentoVenda(saleId, observacao);
    setSales(prev => prev.map(sale => {
      if (sale.id !== saleId) return sale;
      return {
        ...sale,
        ...mapVendaToSale(vendaAtualizada, stageLabels)
      };
    }));
  }

  /**
   * Limpa filtros e restaura o estado inicial.
   */
  function limparFiltros() {
    setVendedoraId('');
    setOperadoraId('');
    setTipoVendaId('');
    setServicoId('');
    setStatusFunil('');
    setPrioridadeFunil('');
    setUf('');
    setMunicipio('');
    setDataInicio('');
    setDataFim('');
    setValorMin('');
    setValorMax('');
    setVisibilidadeCanceladas(VISIBILIDADE_TODAS);
    setVisibilidadeSemDocumento(VISIBILIDADE_TODAS);
    setSomenteDivergentes(false);
  }

  const selectedSale = selectedSaleId ? sales.find(s => s.id === selectedSaleId) : null;
  const adminStagesByCode = useMemo(
    () => new Map(adminStages.map(stage => [stage.id, stage])),
    [adminStages]
  );
  const inactiveStages = useMemo(
    () => adminStages.filter(stage => stage.ativo === false),
    [adminStages]
  );
  const stagesVisiveis = useMemo(() => {
    const conhecidos = new Set(stages.map(stage => stage.id));
    const extras = Array.from(new Set(
      sales
        .map(sale => sale.stage)
        .filter(stage => stage && stage !== 'retorno' && !conhecidos.has(stage))
    ));

    return [
      ...stages,
      ...extras.map(stage => ({ id: stage, name: STAGE_LABELS[stage] || stage, dot: stage }))
    ];
  }, [sales, stages]);
  const stagesValidas = useMemo(
    () => stagesVisiveis.filter(stage => stage.ativo !== false),
    [stagesVisiveis]
  );
  const etapasFinaisIds = useMemo(() => {
    const finais = new Set(stagesVisiveis.filter(st => st.etapaFinal).map(st => st.id));
    if (finais.size === 0) {
      const validas = stagesVisiveis.filter(st => st.id !== 'retorno');
      if (validas.length > 0) {
        const maxOrdem = Math.max(...validas.map(st => st.ordem ?? 0));
        validas.filter(st => (st.ordem ?? 0) === maxOrdem).forEach(st => finais.add(st.id));
      }
    }
    return finais;
  }, [stagesVisiveis]);
  const filtrosFunil = useMemo(() => ({
    vendedoraId,
    operadoraId,
    tipoVendaId,
    servicoId,
    statusFunil,
    prioridadeFunil,
    uf,
    municipio,
    dataInicio,
    dataFim,
    valorMin,
    valorMax
  }), [vendedoraId, operadoraId, tipoVendaId, servicoId, statusFunil, prioridadeFunil, uf, municipio, dataInicio, dataFim, valorMin, valorMax]);
  const filtrosPopupAtivos = Object.values(filtrosFunil).filter(valor => valor !== '').length;
  const atalhosAtivos = Number(visibilidadeCanceladas !== VISIBILIDADE_TODAS)
    + Number(visibilidadeSemDocumento !== VISIBILIDADE_TODAS)
    + Number(modoAutomacoes && somenteDivergentes);
  const totalFiltrosAtivos = filtrosPopupAtivos + atalhosAtivos;
  const filtrosAtalhos = useMemo(() => ({
    canceladas: visibilidadeCanceladas,
    semDocumento: visibilidadeSemDocumento
  }), [visibilidadeCanceladas, visibilidadeSemDocumento]);
  const { filtradas, total } = useMemo(() => {
    const filtered = sales.filter(s => {
      if (s.stage === 'retorno') return false;
      if (!vendaCorrespondeBusca(s, buscaDeferred)) return false;
      if (!vendaCorrespondeFiltros(s, filtrosFunil)) return false;
      if (!vendaCorrespondeAtalhos(s, filtrosAtalhos)) return false;
      if (modoAutomacoes && somenteDivergentes && !s.divergenteAutomacao) return false;
      return true;
    });
    return { filtradas: filtered, total: filtered.reduce((sum, s) => sum + s.value, 0) };
  }, [sales, buscaDeferred, filtrosFunil, filtrosAtalhos, modoAutomacoes, somenteDivergentes]);
  const stageLabels = montarStageLabels(stagesVisiveis);
  const statusFunilFiltros = useMemo(
    () => [
      ...stagesVisiveis.map(stage => ({ id: stage.id, label: stage.name })),
      { id: STATUS_CANCELADA_FILTRO, label: 'Canceladas' }
    ],
    [stagesVisiveis]
  );

  return (
    <LayoutPrivado>
      {selectedSale && (
        <SaleModal
          key={selectedSale.id}
          sale={selectedSale}
          stages={stagesValidas}
          stageLabels={stageLabels}
          onClose={() => setSelectedSaleId(null)}
          onUpdateSale={handleUpdateSale}
          onUpdateConclusao={handleUpdateConclusao}
          onUpdatePossuiDocNaCasa={handleUpdatePossuiDocNaCasa}
          onOpenFullSale={!modoAutomacoes && podeAbrirVendaCompleta ? () => abrirVendaCompleta(selectedSale) : null}
          openingFullSale={abrindoVendaCompletaId === selectedSale.id}
          podeCancelar={!modoAutomacoes && podeCancelarVenda}
          podeReverterCancelamento={!modoAutomacoes && podeReverterCancelamentoVenda}
          onCancelSale={handleCancelarVenda}
          onReverterCancelamento={handleReverterCancelamentoVenda}
          podeEditarVenda={podeEditarVenda}
          podeEditarConclusao={!modoAutomacoes && podeOperarPosVenda}
          podeVerDocumentos={!modoAutomacoes && podeVerDocumentosVenda}
          podeAdicionarDocumentos={!modoAutomacoes && podeAdicionarDocumentosVenda}
          finalizada={etapasFinaisIds.has(selectedSale.stage)}
          modoAutomacoes={modoAutomacoes}
          onEtapasAtualizadas={handleEtapasAtualizadas}
          onArquivosAlterados={carregarVendas}
        />
      )}
      {vendaCompleta && (
        <VendaModal
          venda={vendaCompleta}
          clientes={dadosModalVenda.clientes}
          vendas={dadosModalVenda.vendas}
          vendedoras={dadosModalVenda.vendedoras}
          operadoras={dadosModalVenda.operadoras}
          tiposVenda={dadosModalVenda.tiposVenda}
          servicos={dadosModalVenda.servicos}
          vendasPorCliente={vendasPorCliente}
          vendasEmAndamentoPorCliente={vendasEmAndamentoPorCliente}
          podeEditarVenda={podeEditarVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuario}
          modoEdicao={modalVendaModoEdicao}
          onEtapasAtualizadas={etapas => handleEtapasAtualizadas(vendaCompleta.id, etapas)}
          onArquivosAlterados={carregarVendas}
          onStartEdit={() => setModalVendaModoEdicao(true)}
          onClose={fecharVendaCompleta}
          onSave={salvarVendaCompleta}
          onSendToPosVenda={enviarPosVendaCompleta}
          onCreateClient={abrirClienteRapido}
        />
      )}
      {clienteRapidoAberto && (
        <ClienteModal
          cliente={clienteRapidoInicial}
          operadoras={dadosModalVenda.operadoras}
          onClose={() => fecharClienteRapido(null)}
          onSave={salvarClienteRapido}
        />
      )}
      {stageToDelete && (
        <DeleteStageModal
          stage={stageToDelete}
          saving={stageSavingId === stageToDelete.adminId}
          onClose={() => setStageToDelete(null)}
          onConfirm={() => handleDeleteStage(stageToDelete)}
        />
      )}
      {filtrosAbertos && (
        <div className="filtros-popup-overlay" onClick={() => setFiltrosAbertos(false)}>
          <div className="filtros-popup" onClick={event => event.stopPropagation()}>
            <div className="filtros-popup__header">
              <span>Filtros</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setFiltrosAbertos(false)}>
                <I.Close size={14} />
              </button>
            </div>
            <div className="filtros-popup__body">
              <div className="filter-field">
                <label>Vendedor(a)</label>
                <SelectFiltro
                  value={vendedoraId}
                  onChange={setVendedoraId}
                  placeholder="Todas"
                  options={vendedoras.map(v => ({ value: String(v.id), label: v.nome }))}
                />
              </div>
              <div className="filter-field">
                <label>Operadora</label>
                <SelectFiltro
                  value={operadoraId}
                  onChange={setOperadoraId}
                  placeholder="Todas"
                  options={operadoras.map(op => ({ value: String(op.id), label: op.nome }))}
                />
              </div>
              <div className="filter-field">
                <label>Tipo de venda</label>
                <SelectFiltro
                  value={tipoVendaId}
                  onChange={setTipoVendaId}
                  placeholder="Todos"
                  options={tiposVenda.map(t => ({ value: String(t.id), label: t.nome }))}
                />
              </div>
              <div className="filter-field">
                <label>Produto</label>
                <SelectFiltro
                  value={servicoId}
                  onChange={setServicoId}
                  placeholder="Todos"
                  options={agruparOpcoesServicos(servicos)}
                />
              </div>
              <div className="filter-field">
                <label>Status</label>
                <SelectFiltro
                  value={statusFunil}
                  onChange={setStatusFunil}
                  placeholder="Todos"
                  options={statusFunilFiltros.map(s => ({ value: String(s.id), label: s.label }))}
                />
              </div>
              <div className="filter-field">
                <label>Prioridade</label>
                <SelectFiltro
                  value={prioridadeFunil}
                  onChange={setPrioridadeFunil}
                  placeholder="Todas"
                  options={[
                    { value: 'alta', label: 'Alta' },
                    { value: 'media', label: 'Média' },
                    { value: 'baixa', label: 'Baixa' },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>UF</label>
                <SelectFiltro
                  value={uf}
                  onChange={setUf}
                  placeholder="Todos"
                  options={UFS_BRASIL.map(sigla => ({ value: sigla, label: sigla }))}
                />
              </div>
              <div className="filter-field">
                <label>Município</label>
                <input value={municipio} onChange={event => setMunicipio(event.target.value)} placeholder="Buscar por município" />
              </div>
              <div className="filter-field">
                <label>Data inicial</label>
                <input type="date" value={dataInicio} onChange={event => setDataInicio(event.target.value)} />
              </div>
              <div className="filter-field">
                <label>Data final</label>
                <input type="date" value={dataFim} onChange={event => setDataFim(event.target.value)} />
              </div>
              <div className="filter-field">
                <label>Valor min.</label>
                <input value={valorMin} onChange={event => setValorMin(event.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="filter-field">
                <label>Valor max.</label>
                <input value={valorMax} onChange={event => setValorMax(event.target.value)} placeholder="999,99" inputMode="decimal" />
              </div>
            </div>
            <div className="filtros-popup__footer">
              <button type="button" className="btn btn-ghost" onClick={limparFiltros} disabled={totalFiltrosAtivos === 0}>
                <I.Close size={13} /> Limpar filtros
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setFiltrosAbertos(false)}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page funil-page">
        <div className="filters funil-filters">
          <div className="search-box funnel-search-box">
            <I.Search size={14} />
            <input
              value={busca}
              onChange={event => setBusca(event.target.value)}
              placeholder="Buscar venda, cliente, CNPJ, telefone, plano..."
            />
            {busca && (
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                onClick={() => setBusca('')}
                title="Limpar busca"
              >
                <I.Close size={12} />
              </button>
            )}
          </div>
          <div className="funil-chips-row">
            <button className="btn" type="button" onClick={() => setFiltrosAbertos(true)}>
              <I.Filter size={14} /> Filtros
              {totalFiltrosAtivos > 0 && <span className="filtros-count">{totalFiltrosAtivos}</span>}
            </button>
            <button
              type="button"
              className={`filter-chip funil-quick-filter${visibilidadeCanceladas === VISIBILIDADE_OCULTAR ? ' active' : ''}`}
              aria-pressed={visibilidadeCanceladas === VISIBILIDADE_OCULTAR}
              onClick={() => setVisibilidadeCanceladas(atual => (
                atual === VISIBILIDADE_OCULTAR ? VISIBILIDADE_TODAS : VISIBILIDADE_OCULTAR
              ))}
            >
              {visibilidadeCanceladas === VISIBILIDADE_OCULTAR ? <I.Eye size={12} /> : <I.EyeOff size={12} />}
              {visibilidadeCanceladas === VISIBILIDADE_OCULTAR ? 'Mostrar canceladas' : 'Ocultar canceladas'}
            </button>
            <button
              type="button"
              className={`filter-chip funil-quick-filter${visibilidadeCanceladas === VISIBILIDADE_SOMENTE ? ' active' : ''}`}
              aria-pressed={visibilidadeCanceladas === VISIBILIDADE_SOMENTE}
              onClick={() => setVisibilidadeCanceladas(atual => (
                atual === VISIBILIDADE_SOMENTE ? VISIBILIDADE_TODAS : VISIBILIDADE_SOMENTE
              ))}
            >
              <I.Filter size={12} /> Somente canceladas
            </button>
            <button
              type="button"
              className={`filter-chip funil-quick-filter${visibilidadeSemDocumento === VISIBILIDADE_SOMENTE ? ' active' : ''}`}
              aria-pressed={visibilidadeSemDocumento === VISIBILIDADE_SOMENTE}
              onClick={() => setVisibilidadeSemDocumento(atual => (
                atual === VISIBILIDADE_SOMENTE ? VISIBILIDADE_TODAS : VISIBILIDADE_SOMENTE
              ))}
            >
              <I.Document size={12} /> Somente sem doc
            </button>
            <button
              type="button"
              className={`filter-chip funil-quick-filter${visibilidadeSemDocumento === VISIBILIDADE_OCULTAR ? ' active' : ''}`}
              aria-pressed={visibilidadeSemDocumento === VISIBILIDADE_OCULTAR}
              onClick={() => setVisibilidadeSemDocumento(atual => (
                atual === VISIBILIDADE_OCULTAR ? VISIBILIDADE_TODAS : VISIBILIDADE_OCULTAR
              ))}
            >
              {visibilidadeSemDocumento === VISIBILIDADE_OCULTAR ? <I.Eye size={12} /> : <I.EyeOff size={12} />}
              {visibilidadeSemDocumento === VISIBILIDADE_OCULTAR ? 'Mostrar vendas sem doc' : 'Ocultar vendas sem doc'}
            </button>
            {modoAutomacoes && (
              <button
                type="button"
                className={`filter-chip funil-quick-filter${somenteDivergentes ? ' active' : ''}`}
                aria-pressed={somenteDivergentes}
                onClick={() => setSomenteDivergentes(valor => !valor)}
              >
                <I.AlertTriangle size={12} /> Somente divergentes
              </button>
            )}
            <div className="funil-stats" style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12.5, flexShrink: 0 }}>
              <span className="muted">{filtradas.length} vendas</span>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <span>
                <span className="muted">Total: </span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatBRL(total)}</strong>
              </span>
            </div>
          </div>
        </div>

        {error && <div className="alert-error" style={{ margin: 16 }}>{error}</div>}
        {podeGerenciarEtapas && (
          <>
            {stageFeedback.message && (
              <div
                className={stageFeedback.type === 'success' ? 'alert-success alert-timed alert-timed--success' : 'alert-error alert-timed alert-timed--error'}
                style={{ margin: '12px 24px 0' }}
              >
                {stageFeedback.message}
              </div>
            )}
            <div className="funnel-stage-toolbar">
              {!showNewStageForm ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowNewStageForm(true)}>
                  <I.Plus size={13} /> Nova etapa
                </button>
              ) : (
                <form className="funnel-stage-form" onSubmit={handleCreateStage}>
                  <input
                    value={newStage.nome}
                    onChange={event => setNewStage({ ...newStage, nome: event.target.value })}
                    placeholder="Nome da nova etapa"
                    disabled={creatingStage}
                    required
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={newStage.etapa_final}
                      onChange={event => setNewStage({ ...newStage, etapa_final: event.target.checked })}
                      disabled={creatingStage}
                    />
                    Etapa final
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                    title="Vendas nesta etapa só avançam com todas as etapas de conferência concluídas"
                  >
                    <input
                      type="checkbox"
                      checked={newStage.bloqueia_avanco}
                      onChange={event => setNewStage({ ...newStage, bloqueia_avanco: event.target.checked })}
                      disabled={creatingStage}
                    />
                    Barreira de conferência
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                    title="Exibe Aceite e Biometria nos cartões e exige ambos para avançar"
                  >
                    <input
                      type="checkbox"
                      checked={newStage.aceite_biometria}
                      onChange={event => setNewStage({ ...newStage, aceite_biometria: event.target.checked })}
                      disabled={creatingStage}
                    />
                    Aceite/Biometria
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={creatingStage || !newStage.nome.trim()}>
                    {creatingStage ? 'Adicionando...' : 'Adicionar'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setNewStage(NOVA_ETAPA);
                      setShowNewStageForm(false);
                    }}
                    disabled={creatingStage}
                  >
                    Cancelar
                  </button>
                </form>
              )}
              {stagesLoading && <span className="muted" style={{ fontSize: 12 }}>Atualizando etapas...</span>}
            </div>
            {inactiveStages.length > 0 && (
              <div className="inactive-stage-bar">
                <span className="inactive-stage-bar__label">Etapas desativadas</span>
                {inactiveStages.map(stage => (
                  <button
                    type="button"
                    key={stage.adminId}
                    className="btn btn-sm"
                    onClick={() => handleToggleStage(stage)}
                    disabled={stageSavingId === stage.adminId}
                    title={`Reativar ${stage.name}`}
                  >
                    <I.Check size={12} />
                    {stageSavingId === stage.adminId ? 'Reativando...' : stage.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stagesVisiveis.map(s => s.id)} strategy={horizontalListSortingStrategy}>
        <div className="kanban" data-navigation-scroll="funil">
          {stagesVisiveis.map(st => {
            const editableStage = adminStagesByCode.get(st.id) || st;
            const canEditStage = podeGerenciarEtapas && editableStage.adminId;
            const isEditingStage = canEditStage && editingStageId === editableStage.adminId;
            const stageSaving = canEditStage && stageSavingId === editableStage.adminId;
            const editValue = canEditStage ? (editStageNames[editableStage.adminId] ?? editableStage.name) : st.name;
            const editChanged = canEditStage && editValue.trim() && editValue.trim() !== editableStage.name;
            const priorityWeight = { alta: 1, media: 2, baixa: 3 };
            const items = filtradas
              .filter(s => s.stage === st.id)
              .sort((a, b) => {
                const wA = priorityWeight[a.priority || 'media'];
                const wB = priorityWeight[b.priority || 'media'];
                if (wA !== wB) return wA - wB;
                return b.updated.getTime() - a.updated.getTime();
              });
            const colTotal = items.reduce((sum, s) => sum + s.value, 0);
            return (
              <SortableColumn key={st.id} id={st.id} disabled={!canEditStage}>
                {({ setNodeRef, transform, transition, isDragging, dragAttributes, dragListeners }) => (
              <div
                ref={setNodeRef}
                className="kanban-column" data-navigation-scroll={`etapa:${st.id}`}
                style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
              >
                <div className="column-header">
                  <div className="column-title-row">
                    {canEditStage && !isEditingStage && (
                      <span
                        {...dragAttributes}
                        {...dragListeners}
                        className="drag-handle"
                        title="Arrastar para reordenar"
                      >
                        <I.GripVertical size={12} />
                      </span>
                    )}
                    <span className={`column-dot ${st.dot}`}></span>
                    {isEditingStage ? (
                      <>
                        <input
                          className="column-name-input"
                          value={editValue}
                          onChange={event => setEditStageNames(prev => ({ ...prev, [editableStage.adminId]: event.target.value }))}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && editChanged && !stageSaving) handleSaveStageName(editableStage);
                            if (event.key === 'Escape') cancelarEdicaoEtapa(editableStage);
                          }}
                          disabled={stageSaving}
                          autoFocus
                          aria-label={`Editar nome da etapa ${editableStage.name}`}
                        />
                        <button
                          type="button"
                          className="btn btn-icon btn-ghost column-edit-btn"
                          onClick={() => handleSaveStageName(editableStage)}
                          disabled={stageSaving || !editChanged}
                          title="Salvar nome"
                        >
                          <I.Check size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon btn-ghost column-edit-btn"
                          onClick={() => cancelarEdicaoEtapa(editableStage)}
                          disabled={stageSaving}
                          title="Cancelar edição"
                        >
                          <I.Close size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="column-name" title={st.name}>{st.name}</span>
                        {(st.etapaFinal || st.bloqueiaAvanco) && (
                          <span className="column-flags">
                            {st.etapaFinal && (
                              <span className="column-flag is-final" title="Etapa final" aria-label="Etapa final">
                                <I.Flag size={12} />
                              </span>
                            )}
                            {st.bloqueiaAvanco && (
                              <span
                                className="column-flag is-barrier"
                                title="Barreira: vendas só avançam com as etapas de conferência concluídas"
                                aria-label="Barreira"
                              >
                                <I.Shield size={12} />
                              </span>
                            )}
                            {st.aceiteBiometria && (
                              <span
                                className="column-flag is-acceptance"
                                title="Etapa de Aceite/Biometria"
                                aria-label="Etapa de Aceite/Biometria"
                              >
                                <I.Check size={12} />
                              </span>
                            )}
                          </span>
                        )}
                        <span className="column-count">{items.length}</span>
                        {canEditStage && (
                          <StageMenu
                            stage={editableStage}
                            disabled={stageSaving}
                            onRename={() => {
                              setEditingStageId(editableStage.adminId);
                              setEditStageNames(prev => ({ ...prev, [editableStage.adminId]: editableStage.name }));
                            }}
                            onToggleFinal={() => handleToggleFinalStage(editableStage)}
                            onToggleBarrier={() => handleToggleBarrierStage(editableStage)}
                            onToggleAceiteBiometria={() => handleToggleAceiteBiometriaStage(editableStage)}
                            onToggleActive={() => handleToggleStage(editableStage)}
                            onDelete={() => setStageToDelete({ ...editableStage, vendasCount: items.length })}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div className="column-total">
                    <span className="label">Total</span>
                    <span className="value">{formatBRL(colTotal)}</span>
                  </div>
                </div>
                <div className="column-body">
                  {loading ? (
                    <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                      Carregando...
                    </div>
                  ) : items.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                      Vazio
                    </div>
                  ) : (
                    items.map(s => (
                      <SaleCard
                        key={s.id}
                        sale={s}
                        finalizada={etapasFinaisIds.has(s.stage)}
                        aceiteBiometria={!modoAutomacoes && st.aceiteBiometria}
                        marcadorSaving={marcadorSaving}
                        onToggleMarcador={handleToggleMarcador}
                        onClick={() => setSelectedSaleId(s.id)}
                        onEmail={abrirEmailVenda}
                        gerandoEmailId={gerandoEmailId}
                        onXlsxClaro={handleBaixarXlsxClaro}
                        baixandoXlsxId={baixandoXlsxId}
                        onWhatsapp={abrirMensagemWhatsapp}
                        onProblema={(raw) => setVendaProblema(raw)}
                        podeOperarPosVenda={!modoAutomacoes && podeOperarPosVenda}
                        modoAutomacoes={modoAutomacoes}
                        stageLabels={stageLabels}
                      />
                    ))
                  )}
                </div>
              </div>
                )}
              </SortableColumn>
            );
          })}
        </div>
          </SortableContext>
        </DndContext>
      </div>

      <EmailTemplateModal
        dados={emailTemplate}
        copiando={copiandoEmail}
        onClose={() => setEmailTemplate(null)}
        onCopy={copiarEmailVenda}
      />

      <WhatsappMensagemModal
        dados={whatsappMensagem}
        copiando={copiandoWhatsapp}
        onClose={() => setWhatsappMensagem(null)}
        onChange={texto => setWhatsappMensagem(prev => prev ? { ...prev, texto } : prev)}
        onDocsChange={atualizarDocumentosWhatsapp}
        onCopy={copiarMensagemWhatsapp}
      />

      {vendaProblema && (
        <ProblemaVendaModal
          venda={vendaProblema}
          usuario={usuario}
          onClose={() => setVendaProblema(null)}
        />
      )}
    </LayoutPrivado>
  );
}

export default FunilPage;
