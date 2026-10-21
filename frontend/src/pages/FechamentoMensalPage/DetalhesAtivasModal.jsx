import { useNavigationState } from '../../utils/useNavigationState';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import * as I from '../../components/Icons';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import { getDetalhesChips } from '../../services/fechamento.service';
import { formatarNomeServico, normalizarNomeServicoParaFiltro } from '../../utils/servicos';

const DADOS_VAZIOS = {
  linhas: [],
  totais_por_vendedora: [],
  total_geral: {
    chips: 0,
    valor: 0,
    comissao: 0,
    ugrs_sem_regra: 0
  }
};

const FILTROS_INICIAIS = {
  vendaId: '',
  vendaTexto: '',
  vendedora: '',
  operadora: '',
  etapa: '',
  tipoVenda: '',
  servico: '',
  repasse: '',
  regra: ''
};

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
 * Formata bool para exibicao.
 */
function fmtBool(valor) {
  if (valor === true) return 'Sim';
  if (valor === false) return 'Não';
  return '-';
}

/**
 * Formata texto para exibicao.
 */
function fmtTexto(valor) {
  return String(valor || '').trim() || '-';
}

/**
 * Retorna linha teve retorno no formato esperado pelo fluxo.
 */
function linhaTeveRetorno(linha = {}) {
  return linha.status_funil !== 'retorno' && Boolean(linha.retornou_em || linha.motivo_retorno || linha.status_anterior_retorno);
}

/**
 * Formata retorno badge para exibicao.
 */
function fmtRetornoBadge(linha = {}) {
  if (linha.retornou_em) return `Já retornou em ${fmtData(linha.retornou_em)}`;
  return 'Já retornou';
}

/**
 * Formata lista para exibicao.
 */
function fmtLista(valor) {
  if (!valor) return '-';
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '-';
  if (typeof valor === 'object') return JSON.stringify(valor);

  const texto = String(valor).trim();
  if (!texto) return '-';

  try {
    const parsed = JSON.parse(texto);
    return fmtLista(parsed);
  } catch {
    return texto;
  }
}

/**
 * Processa juntar valores conforme as regras do dominio.
 */
function juntarValores(valores, separador = ', ') {
  const texto = (valores || []).map(item => String(item || '').trim()).filter(Boolean).join(separador);
  return texto || '-';
}

/**
 * Formata horario aceite para exibicao ou envio.
 */
function formatarHorarioAceite(linha) {
  const partes = [];
  const range = [linha.horario_aceite_inicio, linha.horario_aceite_fim].filter(Boolean);
  if (range.length) partes.push(range.join(' até '));
  const fixoParts = [linha.dia_aceite_fixo, linha.horario_aceite_fixo].filter(Boolean);
  if (fixoParts.length) partes.push(fixoParts.join(' às '));
  return partes.join(' ou ') || '-';
}

/**
 * Formata endereco para exibicao.
 */
function fmtEndereco(linha) {
  return juntarValores([
    linha.endereco,
    linha.numero_endereco,
    linha.complemento,
    linha.bairro,
    linha.municipio,
    linha.uf,
    linha.cep
  ]);
}

/**
 * Formata endereco real para exibicao.
 */
function fmtEnderecoReal(linha) {
  return juntarValores([
    linha.endereco_real,
    linha.numero_endereco_real,
    linha.complemento_real,
    linha.bairro_real,
    linha.municipio_real,
    linha.uf_real,
    linha.cep_real
  ]);
}

/**
 * Formata regra para exibicao.
 */
function fmtRegra(regra) {
  if (!regra) return 'Sem regra';
  return `${fmtMoeda(regra.valor_min)} até ${fmtMoeda(regra.valor_max)}`;
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
 * Formata tipo de linha para exibicao.
 */
function fmtTipoLinha(valor) {
  const tipo = normalizarBusca(valor);
  if (tipo.includes('porta')) return 'Portabilidade';
  if (tipo.includes('novo')) return 'Novo';
  return fmtTexto(valor);
}

/**
 * Retorna tipo de linha da UGR, com fallback para vendas antigas.
 */
function tipoLinhaUgr(linha) {
  return linha.tipo_linha || linha.tipo_venda || '';
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

  return etapas[codigo] || codigo || '-';
}

/**
 * Formata prioridade funil para exibicao.
 */
function fmtPrioridadeFunil(valor) {
  const prioridades = {
    alta: 'Alta',
    media: 'Média',
    baixa: 'Baixa'
  };
  const chave = String(valor || '').trim().toLowerCase();
  return prioridades[chave] || fmtTexto(valor);
}

/**
 * Retorna classe etapa funil no formato esperado pelo fluxo.
 */
function classeEtapaFunil(codigo) {
  if (codigo === 'retorno') return 'is-return';
  if (codigo === 'concluido') return 'is-final';
  return '';
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
 * Retorna chave opcao no formato esperado pelo fluxo.
 */
function chaveOpcao(valor) {
  return normalizarBusca(valor);
}

/**
 * Cria opcoes com os dados informados.
 */
function criarOpcoes(linhas, obterValor, obterLabel = obterValor) {
  const mapa = new Map();

  linhas.forEach(linha => {
    const valor = obterValor(linha);
    const chave = chaveOpcao(valor);
    if (!chave || mapa.has(chave)) return;
    mapa.set(chave, {
      value: chave,
      label: obterLabel(linha) || valor || '-'
    });
  });

  return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/**
 * Retorna valores busca linha no formato esperado pelo fluxo.
 */
function valoresBuscaLinha(linha) {
  const vendedorasLinha = Array.isArray(linha.vendedoras) && linha.vendedoras.length > 0
    ? linha.vendedoras
    : [linha.vendedora].filter(Boolean);

  return [
    linha.venda_id,
    `#${linha.venda_id}`,
    linha.protocolo,
    linha.login,
    linha.numero_cliente_contrato,
    linha.nome,
    linha.razao_social,
    linha.cnpj,
    linha.email,
    linha.email_2,
    linha.telefone,
    linha.fixo_ddd,
    linha.nome_representante_legal,
    linha.cpf_representante_legal,
    linha.telefone_representante_legal,
    linha.email_representante_legal,
    linha.nome_administrador,
    linha.cpf_administrador,
    linha.telefone_administrador,
    linha.email_administrador,
    linha.nome_fechou_venda,
    linha.setor_funcao,
    linha.chip_index,
    linha.numero_ativado,
    linha.numero_portado,
    linha.data_ativacao,
    fmtData(linha.data_ativacao),
    linha.data_venda,
    fmtData(linha.data_venda),
    vendedorasLinha.map(item => item?.nome).filter(Boolean).join(' '),
    vendedorasLinha.map(item => item?.email).filter(Boolean).join(' '),
    linha.cliente?.nome,
    linha.cliente?.razao_social,
    linha.cliente?.cnpj,
    linha.cliente?.fidelidade_fim,
    linha.cliente?.operadora_atual?.nome,
    linha.operadora?.nome,
    linha.status_funil,
    fmtEtapaFunil(linha.status_funil),
    fmtRepasse(linha),
    tipoLinhaUgr(linha),
    fmtTipoLinha(tipoLinhaUgr(linha)),
    linha.servico,
    linha.dia_vencimento,
    linha.ddd,
    linha.gb,
    fmtLista(linha.numeros_ativados),
    fmtLista(linha.cliente_solicitou_servicos),
    linha.cliente_solicitou_bloqueio_qtd,
    linha.cliente_solicitou_cancelamento_qtd,
    fmtLista(linha.cliente_solicitou_numeros),
    linha.qc_feito_por,
    linha.promessa_cliente,
    linha.promessa_cumprida,
    linha.observacoes,
    fmtEndereco(linha),
    fmtBool(linha.endereco_real_divergente),
    fmtEnderecoReal(linha),
    linha.ponto_referencia,
    linha.tipo_local_cpf,
    linha.horario_aceite_inicio,
    linha.horario_aceite_fim,
    linha.dia_aceite_inicio,
    linha.dia_aceite_fim,
    linha.dia_aceite_fixo,
    linha.horario_aceite_fixo,
    linha.motivo_retorno,
    linha.status_anterior_retorno,
    linha.retornou_em,
    fmtData(linha.retornou_em),
    linha.corrigido_em,
    fmtData(linha.corrigido_em),
    linha.valor_unitario,
    fmtMoeda(linha.valor_unitario),
    linha.regra_comissao?.valor_min,
    linha.regra_comissao?.valor_max,
    linha.regra_comissao?.operadora_nome,
    fmtRegra(linha.regra_comissao),
    linha.comissao_integral,
    linha.comissao_base,
    linha.comissao_base_propria,
    linha.comissao,
    fmtMoeda(linha.comissao),
    fmtRepasse(linha)
  ].map(valor => normalizarBusca(valor)).join(' ');
}

/**
 * Retorna vendedoras comissao linha no formato esperado pelo fluxo.
 */
function vendedorasComissaoLinha(linha) {
  if (linha.vendedora?.id) return [linha.vendedora];
  return Array.isArray(linha.vendedoras) ? linha.vendedoras.filter(item => item?.id) : [];
}

/**
 * Retorna nomes vendedoras linha no formato esperado pelo fluxo.
 */
function nomesVendedorasLinha(linha) {
  if (linha.vendedora?.nome) {
    return linha.vendedora.nome;
  }

  const lista = Array.isArray(linha.vendedoras) && linha.vendedoras.length > 0
    ? linha.vendedoras
    : [linha.vendedora].filter(Boolean);

  return lista.map(item => item?.nome).filter(Boolean).join(' / ') || '-';
}

/**
 * Calcula totais com base nos valores informados.
 */
function calcularTotais(linhas) {
  const totaisVendedora = new Map();

  linhas.forEach(linha => {
    if (linha.comissao === null) return;
    const vendedorasLinha = vendedorasComissaoLinha(linha);
    if (vendedorasLinha.length === 0) return;

    const comissaoPorVendedora = Number(linha.comissao || 0) / vendedorasLinha.length;
    const ugrPorVendedora = 1 / vendedorasLinha.length;

    vendedorasLinha.forEach(vendedora => {
      const chave = vendedora.id || 'sem_vendedora';
      const atual = totaisVendedora.get(chave) || {
        vendedora_id: vendedora.id || null,
        vendedora_nome: vendedora.nome || 'Sem vendedora',
        total_ugrs: 0,
        total_comissao: 0
      };

      atual.total_ugrs += ugrPorVendedora;
      atual.total_comissao += comissaoPorVendedora;
      totaisVendedora.set(chave, atual);
    });
  });

  return {
    totais_por_vendedora: Array.from(totaisVendedora.values())
      .map(item => ({
        ...item,
        total_ugrs: Number(item.total_ugrs.toFixed(2)),
        total_comissao: Number(item.total_comissao.toFixed(2))
      }))
      .sort((a, b) => b.total_comissao - a.total_comissao),
    total_geral: {
      chips: linhas.length,
      valor: Number(linhas.reduce((soma, linha) => soma + Number(linha.valor_unitario || 0), 0).toFixed(2)),
      comissao: Number(linhas.reduce((soma, linha) => soma + Number(linha.comissao || 0), 0).toFixed(2)),
      ugrs_sem_regra: linhas.filter(linha => linha.sem_regra).length
    }
  };
}

/**
 * Renderiza detalhes ativas modal.
 */
function DetalhesAtivasModal({ secao = 'ativas', periodo, onClose, onAbrirVenda, reloadKey = 0 }) {
  const [dados, setDados] = useState(DADOS_VAZIOS);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useNavigationState(`DetalhesAtivasModal:${secao}:busca`, '');
  const buscaDeferred = useDeferredValue(busca);
  const [filtros, setFiltros] = useNavigationState(`DetalhesAtivasModal:${secao}:filtros`, FILTROS_INICIAIS);

  useEffect(() => {
    let ativo = true;
    getDetalhesChips({ secao, ...periodo })
      .then(resp => {
        if (!ativo) return;
        setDados({
          ...DADOS_VAZIOS,
          ...(resp || {}),
          total_geral: {
            ...DADOS_VAZIOS.total_geral,
            ...(resp?.total_geral || {})
          }
        });
      })
      .catch(err => {
        if (!ativo) return;
        setErro(err?.message || 'Erro ao carregar detalhes por chip.');
      })
      .finally(() => {
        if (!ativo) return;
        setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [secao, periodo, reloadKey]);

  const linhasBase = useMemo(() => (Array.isArray(dados.linhas) ? dados.linhas : []), [dados.linhas]);

  const opcoesFiltro = useMemo(() => ({
    vendedoras: criarOpcoes(
      linhasBase.flatMap(linha => Array.isArray(linha.vendedoras) && linha.vendedoras.length > 0 ? linha.vendedoras : [linha.vendedora].filter(Boolean)),
      item => item?.id || item?.nome,
      item => item?.nome
    ),
    operadoras: criarOpcoes(linhasBase, linha => linha.operadora?.id || linha.operadora?.nome, linha => linha.operadora?.nome),
    etapas: criarOpcoes(linhasBase, linha => linha.status_funil, linha => fmtEtapaFunil(linha.status_funil)),
    tiposVenda: criarOpcoes(linhasBase, linha => tipoLinhaUgr(linha), linha => fmtTipoLinha(tipoLinhaUgr(linha))),
    servicos: criarOpcoes(linhasBase, linha => normalizarNomeServicoParaFiltro(linha.servico), linha => formatarNomeServico(linha.servico)),
    repasses: [
      { value: 'base_propria', label: 'Nossa base' },
      { value: 'base_operadora', label: 'Base da operadora' },
      { value: 'base_propria_operadora', label: 'Nossa base + base da operadora' },
      { value: 'cliente_novo_portabilidade', label: 'Cliente novo/portabilidade' }
    ],
    regras: [
      { value: 'com_regra', label: 'Com regra' },
      { value: 'sem_regra', label: 'Sem regra' }
    ]
  }), [linhasBase]);

  const filtrosAtivos = Object.values(filtros).some(Boolean) || Boolean(buscaDeferred.trim());

  const linhasFiltradas = useMemo(() => {
    const termo = normalizarBusca(buscaDeferred);
    const vendaId = normalizarBusca(filtros.vendaId).replace(/^#/, '');
    const textoVenda = normalizarBusca(filtros.vendaTexto);

    return linhasBase.filter(linha => {
      if (vendaId && !normalizarBusca(linha.venda_id).includes(vendaId)) return false;
      if (textoVenda) {
        const alvoVenda = [
          linha.protocolo,
          linha.login,
          linha.numero_cliente_contrato,
          linha.cliente?.nome,
          linha.cliente?.razao_social,
          linha.cliente?.cnpj,
          linha.nome,
          linha.razao_social,
          linha.cnpj
        ].map(valor => normalizarBusca(valor)).join(' ');
        if (!alvoVenda.includes(textoVenda)) return false;
      }
      if (filtros.vendedora) {
        const vendedorasLinha = Array.isArray(linha.vendedoras) && linha.vendedoras.length > 0
          ? linha.vendedoras
          : [linha.vendedora].filter(Boolean);
        if (!vendedorasLinha.some(item => chaveOpcao(item?.id || item?.nome) === filtros.vendedora)) return false;
      }
      if (filtros.operadora && chaveOpcao(linha.operadora?.id || linha.operadora?.nome) !== filtros.operadora) return false;
      if (filtros.etapa && chaveOpcao(linha.status_funil) !== filtros.etapa) return false;
      if (filtros.tipoVenda && chaveOpcao(tipoLinhaUgr(linha)) !== filtros.tipoVenda) return false;
      if (filtros.servico && normalizarNomeServicoParaFiltro(linha.servico) !== filtros.servico) return false;
      if (filtros.repasse && linha.tipo_repasse !== filtros.repasse) return false;
      if (filtros.regra === 'com_regra' && linha.sem_regra) return false;
      if (filtros.regra === 'sem_regra' && !linha.sem_regra) return false;
      if (termo && !valoresBuscaLinha(linha).includes(termo)) return false;
      return true;
    });
  }, [buscaDeferred, filtros, linhasBase]);

  const totaisFiltrados = useMemo(() => calcularTotais(linhasFiltradas), [linhasFiltradas]);
  const totalGeral = totaisFiltrados.total_geral;
  const totaisPorVendedora = totaisFiltrados.totais_por_vendedora;
  const titulosSecao = {
    total: 'Detalhes - Total de vendas (linha por UGR)',
    tratando: 'Detalhes - Contratos tratando (linha por UGR)',
    ativas: 'Detalhes - Vendas ativas (linha por UGR)'
  };

  /**
   * Abre venda e prepara o estado necessario.
   */
  function abrirVenda(vendaId) {
    if (!vendaId) return;
    onAbrirVenda?.(vendaId);
  }

  /**
   * Trata o evento de linha key down.
   */
  function handleLinhaKeyDown(event, vendaId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      abrirVenda(vendaId);
    }
  }

  /**
   * Atualiza filtro com os dados informados.
   */
  function atualizarFiltro(campo, valor) {
    setFiltros(prev => ({ ...prev, [campo]: valor }));
  }

  /**
   * Limpa filtros e restaura o estado inicial.
   */
  function limparFiltros() {
    setBusca('');
    setFiltros(FILTROS_INICIAIS);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fechamento-modal-large" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">{titulosSecao[secao] || 'Detalhes - linha por UGR'}</div>
              <div className="modal-sub">
                {linhasFiltradas.length} de {dados.linhas.length} UGR(s) - Comissão total: {fmtMoeda(totalGeral.comissao)}
                {totalGeral.ugrs_sem_regra > 0 && (
                  <span className="fechamento-pendencia">
                    {totalGeral.ugrs_sem_regra} sem regra
                  </span>
                )}
              </div>
            </div>
            <button type="button" className="btn-icon btn-ghost" onClick={onClose} aria-label="Fechar">
              <I.Close size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body" data-navigation-scroll="DetalhesAtivasModal-1" style={{ padding: 0 }}>
          {erro && <div className="alert-error" style={{ margin: 16 }}>{erro}</div>}
          {loading ? (
            <div className="fechamento-empty">Carregando...</div>
          ) : dados.linhas.length === 0 ? (
            <div className="fechamento-empty">Nenhum chip no período.</div>
          ) : (
            <>
              <div className="fechamento-modal-filters">
                <div className="fechamento-modal-filters__grid">
                  <label>
                    <span>Venda #</span>
                    <input
                      type="search"
                      value={filtros.vendaId}
                      onChange={event => atualizarFiltro('vendaId', event.target.value)}
                      placeholder="Ex: 123"
                    />
                  </label>
                  <label>
                    <span>Cliente / protocolo</span>
                    <input
                      type="search"
                      value={filtros.vendaTexto}
                      onChange={event => atualizarFiltro('vendaTexto', event.target.value)}
                      placeholder="Nome, CNPJ, login..."
                    />
                  </label>
                  <label>
                    <span>Vendedora</span>
                    <SelectFiltro value={filtros.vendedora} onChange={val => atualizarFiltro('vendedora', val)} placeholder="Todas" options={opcoesFiltro.vendedoras} />
                  </label>
                  <label>
                    <span>Operadora</span>
                    <SelectFiltro value={filtros.operadora} onChange={val => atualizarFiltro('operadora', val)} placeholder="Todas" options={opcoesFiltro.operadoras} />
                  </label>
                  <label>
                    <span>Etapa</span>
                    <SelectFiltro value={filtros.etapa} onChange={val => atualizarFiltro('etapa', val)} placeholder="Todas" options={opcoesFiltro.etapas} />
                  </label>
                  <label>
                    <span>Tipo de linha</span>
                    <SelectFiltro value={filtros.tipoVenda} onChange={val => atualizarFiltro('tipoVenda', val)} placeholder="Todos" options={opcoesFiltro.tiposVenda} />
                  </label>
                  <label>
                    <span>Serviço</span>
                    <SelectFiltro value={filtros.servico} onChange={val => atualizarFiltro('servico', val)} placeholder="Todos" options={opcoesFiltro.servicos} />
                  </label>
                  <label>
                    <span>Repasse</span>
                    <SelectFiltro value={filtros.repasse} onChange={val => atualizarFiltro('repasse', val)} placeholder="Todos" options={opcoesFiltro.repasses} />
                  </label>
                  <label>
                    <span>Regra</span>
                    <SelectFiltro value={filtros.regra} onChange={val => atualizarFiltro('regra', val)} placeholder="Todas" options={opcoesFiltro.regras} />
                  </label>
                  <label className="fechamento-modal-filters__wide">
                    <span>Busca geral</span>
                    <input
                      type="search"
                      value={busca}
                      onChange={event => setBusca(event.target.value)}
                      placeholder="Buscar em todos os campos"
                    />
                  </label>
                </div>
                <div className="fechamento-modal-filters__footer">
                  <span>{filtrosAtivos ? `${linhasFiltradas.length} resultado(s) filtrado(s)` : 'Sem filtros aplicados'}</span>
                  <button type="button" className="btn btn-sm" onClick={limparFiltros} disabled={!filtrosAtivos}>
                    Limpar filtros
                  </button>
                </div>
              </div>
              {linhasFiltradas.length === 0 ? (
                <div className="fechamento-empty">Nenhum resultado para a busca.</div>
              ) : (
              <div className="fechamento-modal-table-wrapper">
                <table className="fechamento-modal-table">
                  <thead>
                    <tr>
                      <th>Venda / etapa</th>
                      <th>Protocolo</th>
                      <th>Login</th>
                      <th>Contrato</th>
                      <th>Ativação</th>
                      <th>Venda</th>
                      <th>Prioridade</th>
                      <th>Vendedora</th>
                      <th>Cliente</th>
                      <th>Nome da venda</th>
                      <th>Razão da venda</th>
                      <th>CNPJ</th>
                      <th>CNPJ da venda</th>
                      <th>E-mail</th>
                      <th>E-mail 2</th>
                      <th>Celular</th>
                      <th>Fixo</th>
                      <th>Fechada com</th>
                      <th>Setor/Função</th>
                      <th>Nome RL</th>
                      <th>CPF RL</th>
                      <th>Telefone RL</th>
                      <th>E-mail RL</th>
                      <th>Nome ADM</th>
                      <th>CPF ADM</th>
                      <th>Telefone ADM</th>
                      <th>E-mail ADM</th>
                      <th>Operadora</th>
                      <th>Etapa</th>
                      <th>Operadora atual</th>
                      <th>Repasse</th>
                      <th>Tipo</th>
                      <th>Serviço</th>
                      <th className="num">Vencimento</th>
                      <th>Cliente solicitou</th>
                      <th>Qtd. bloqueio</th>
                      <th>Qtd. cancelamento</th>
                      <th>Números solicitados</th>
                      <th>Números portados</th>
                      <th>Endereço da Receita</th>
                      <th>Endereço real divergente</th>
                      <th>Endereço real</th>
                      <th>Ponto de referência</th>
                      <th>Local CPF</th>
                      <th>Horário de aceite</th>
                      <th>Dias de aceite</th>
                      <th>QC feito por</th>
                      <th>Promessa</th>
                      <th>Promessa cumprida</th>
                      <th>Observações</th>
                      <th>Motivo do retorno</th>
                      <th>Status anterior ao retorno</th>
                      <th>Chip</th>
                      <th>Número ativado</th>
                      <th>DDD</th>
                      <th>GB</th>
                      <th>Fidelidade</th>
                      <th className="num">Valor do chip</th>
                      <th>Regra</th>
                      <th className="num">Comissão R$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFiltradas.map((linha, idx) => (
                      <tr
                        key={`${linha.venda_id}-${linha.chip_index}-${idx}`}
                        className={`${linha.sem_regra ? 'row-warning ' : ''}is-clickable`}
                        tabIndex={0}
                        title="Abrir venda"
                        onClick={() => abrirVenda(linha.venda_id)}
                        onKeyDown={event => handleLinhaKeyDown(event, linha.venda_id)}
                      >
                        <td>
                          <div className="fechamento-venda-etapa">
                            <strong>#{linha.venda_id}</strong>
                            <span className={`fechamento-etapa-badge ${classeEtapaFunil(linha.status_funil)}`}>
                              {fmtEtapaFunil(linha.status_funil)}
                            </span>
                            {linhaTeveRetorno(linha) && (
                              <span className="fechamento-etapa-badge is-return is-return-history" title={fmtTexto(linha.motivo_retorno)}>
                                {fmtRetornoBadge(linha)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{fmtTexto(linha.protocolo)}</td>
                        <td>{fmtTexto(linha.login)}</td>
                        <td>{fmtTexto(linha.numero_cliente_contrato)}</td>
                        <td>{fmtData(linha.data_ativacao)}</td>
                        <td>{fmtData(linha.data_venda)}</td>
                        <td>{fmtPrioridadeFunil(linha.prioridade_funil)}</td>
                        <td>{nomesVendedorasLinha(linha)}</td>
                        <td>{linha.cliente?.nome || linha.cliente?.razao_social || '-'}</td>
                        <td>{fmtTexto(linha.nome)}</td>
                        <td>{fmtTexto(linha.razao_social)}</td>
                        <td>{linha.cliente?.cnpj || '-'}</td>
                        <td>{fmtTexto(linha.cnpj)}</td>
                        <td>{fmtTexto(linha.email)}</td>
                        <td>{fmtTexto(linha.email_2)}</td>
                        <td>{fmtTexto(linha.telefone)}</td>
                        <td>{fmtTexto(linha.fixo_ddd)}</td>
                        <td>{fmtTexto(linha.nome_fechou_venda)}</td>
                        <td>{fmtTexto(linha.setor_funcao)}</td>
                        <td>{fmtTexto(linha.nome_representante_legal)}</td>
                        <td>{fmtTexto(linha.cpf_representante_legal)}</td>
                        <td>{fmtTexto(linha.telefone_representante_legal)}</td>
                        <td>{fmtTexto(linha.email_representante_legal)}</td>
                        <td>{fmtTexto(linha.nome_administrador)}</td>
                        <td>{fmtTexto(linha.cpf_administrador)}</td>
                        <td>{fmtTexto(linha.telefone_administrador)}</td>
                        <td>{fmtTexto(linha.email_administrador)}</td>
                        <td>{linha.operadora?.nome || '-'}</td>
                        <td>{fmtEtapaFunil(linha.status_funil)}</td>
                        <td>{linha.cliente?.operadora_atual?.nome || '-'}</td>
                        <td>{fmtRepasse(linha)}</td>
                        <td>{fmtTipoLinha(tipoLinhaUgr(linha))}</td>
                        <td>{formatarNomeServico(linha.servico) || '-'}</td>
                        <td className="num">{linha.dia_vencimento ?? '-'}</td>
                        <td>{fmtLista(linha.cliente_solicitou_servicos)}</td>
                        <td>{linha.cliente_solicitou_bloqueio_qtd ?? '-'}</td>
                        <td>{linha.cliente_solicitou_cancelamento_qtd ?? '-'}</td>
                        <td>{fmtLista(linha.cliente_solicitou_numeros)}</td>
                        <td>{linha.numero_portado || '-'}</td>
                        <td>{fmtEndereco(linha)}</td>
                        <td>{fmtBool(linha.endereco_real_divergente)}</td>
                        <td>{fmtEnderecoReal(linha)}</td>
                        <td>{fmtTexto(linha.ponto_referencia)}</td>
                        <td>{fmtTexto(linha.tipo_local_cpf)}</td>
                        <td>{formatarHorarioAceite(linha)}</td>
                        <td>{juntarValores([linha.dia_aceite_inicio, linha.dia_aceite_fim], ' até ')}</td>
                        <td>{fmtTexto(linha.qc_feito_por)}</td>
                        <td>{fmtTexto(linha.promessa_cliente)}</td>
                        <td>{fmtTexto(linha.promessa_cumprida)}</td>
                        <td>{fmtTexto(linha.observacoes)}</td>
                        <td>{fmtTexto(linha.motivo_retorno)}</td>
                        <td>{fmtEtapaFunil(linha.status_anterior_retorno)}</td>
                        <td>{linha.chip_index}</td>
                        <td>{linha.numero_ativado || '-'}</td>
                        <td>{linha.ddd || '-'}</td>
                        <td>{linha.gb || '-'}</td>
                        <td>{fmtData(linha.cliente?.fidelidade_fim)}</td>
                        <td className="num">{fmtMoeda(linha.valor_unitario)}</td>
                        <td>{fmtRegra(linha.regra_comissao)}</td>
                        <td className="num">{linha.comissao != null ? fmtMoeda(linha.comissao) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              )}

              <div className="fechamento-totais">
                <div className="fechamento-totais__title">Comissão por vendedora</div>
                {totaisPorVendedora.length === 0 ? (
                  <div className="muted">Nenhuma comissão calculada.</div>
                ) : (
                  totaisPorVendedora.map(item => (
                    <div className="fechamento-totais__row" key={item.vendedora_id ?? item.vendedora_nome}>
                      <span>{item.vendedora_nome} <span className="muted">({item.total_ugrs} UGRs)</span></span>
                      <strong>{fmtMoeda(item.total_comissao)}</strong>
                    </div>
                  ))
                )}
                <div className="fechamento-totais__geral">
                  <span>Total geral</span>
                  <span>{fmtMoeda(totalGeral.comissao)}</span>
                </div>
                {totalGeral.ugrs_sem_regra > 0 && (
                  <div className="muted">
                    {totalGeral.ugrs_sem_regra} UGR(s) sem regra não entram nos totais.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default DetalhesAtivasModal;
