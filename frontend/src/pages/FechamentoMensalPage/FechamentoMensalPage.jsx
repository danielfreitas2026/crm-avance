import { useNavigationRecord } from '../../utils/useNavigationRecord';
import { useNavigationState } from '../../utils/useNavigationState';
import { useCallback, useEffect, useMemo, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { exportarVendasPeriodo, getResumo } from '../../services/fechamento.service';
import { listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { listarClientes } from '../../services/cliente.service';
import {
  atualizarVenda,
  buscarVendaPorId,
  enviarVendaParaPosVenda,
  listarVendas,
  listarVendedoras
} from '../../services/venda.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import ClienteModal from '../Clientes/ClienteModal';
import VendaModal from '../VendasPage/VendaModal';
import DetalhesAtivasModal from './DetalhesAtivasModal';
import FechamentoSecao from './FechamentoSecao';
import PainelGerencial from './PainelGerencial';
import { TableSheet } from '../../components/Icons';
import './FechamentoMensalPage.css';

/**
 * Retorna data iso no formato esperado pelo fluxo.
 */
function dataISO(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, '0'),
    String(data.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Retorna periodo mes atual no formato esperado pelo fluxo.
 */
function periodoMesAtual() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  return {
    data_inicio: dataISO(inicio),
    data_fim: dataISO(fim)
  };
}

/**
 * Retorna data valida no formato esperado pelo fluxo.
 */
function dataValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ''));
}

/**
 * Retorna chave cliente venda no formato esperado pelo fluxo.
 */
function chaveClienteVenda(venda = {}) {
  if (venda.cliente_id) return `cliente:${venda.cliente_id}`;
  if (venda.cliente?.id) return `cliente:${venda.cliente.id}`;
  if (venda.cnpj || venda.cliente?.cnpj) return `cnpj:${String(venda.cnpj || venda.cliente?.cnpj).replace(/\D/g, '')}`;

  const nome = String(venda.nome || venda.cliente?.nome || venda.razao_social || venda.cliente?.razao_social || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  return nome ? `nome:${nome}` : '';
}

/**
 * Conta vendas por cliente conforme os dados informados.
 */
function contarVendasPorCliente(vendas = []) {
  return vendas.reduce((acc, venda) => {
    const chave = chaveClienteVenda(venda);
    if (!chave) return acc;
    acc.set(chave, (acc.get(chave) || 0) + 1);
    return acc;
  }, new Map());
}

/**
 * Renderiza fechamento mensal page.
 */
function FechamentoMensalPage() {
  const [periodo, setPeriodo] = useNavigationState('FechamentoMensalPage:periodo', () => periodoMesAtual());
  const [periodoConsulta, setPeriodoConsulta] = useNavigationState('FechamentoMensalPage:periodoConsulta', () => periodoMesAtual());
  const [resumo, setResumo] = useState({ total: [], tratando: [], ativas: [] });
  const [painel, setPainel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');
  const [modalDetalhes, setModalDetalhes] = useNavigationState('FechamentoMensalPage:secao', null, { validate: value => value === null || ['total', 'tratando', 'ativas'].includes(value) });
  const [detalhesReloadKey, setDetalhesReloadKey] = useState(0);
  const [modalVenda, setModalVenda] = useNavigationRecord('FechamentoMensalPage:venda', {
    load: async id => { await carregarDadosVenda(); return buscarVendaPorId(id); },
    onRestore: () => { setModalModoEdicao(false); setModalVendaAberto(true); },
    onError: error => setErro(error.message)
  });
  const [modalVendaAberto, setModalVendaAberto] = useState(false);
  const [modalModoEdicao, setModalModoEdicao] = useState(false);
  const [vendaLoadingId, setVendaLoadingId] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [vendas, setVendas] = useState([]);
  const [vendedoras, setVendedoras] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [tiposVenda, setTiposVenda] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [clienteRapidoAberto, setClienteRapidoAberto] = useState(false);
  const [, setResolverClienteRapido] = useState(null);
  const usuarioLogado = getUsuarioLocal();
  const podeEditarVenda = temPermissao(usuarioLogado, ['vendas_editar', 'pos_venda']);
  const podeVerDocumentosVenda = temPermissao(usuarioLogado, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuarioLogado, 'adicionar_documentos');
  const podeListarClientes = temPermissao(usuarioLogado, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const vendasPorCliente = useMemo(() => contarVendasPorCliente(vendas), [vendas]);

  const carregarResumo = useCallback(async (periodoAtual, { sinalizarLoading = true } = {}) => {
    if (sinalizarLoading) setLoading(true);
    setErro('');

    try {
      const dados = await getResumo(periodoAtual);
      setResumo(dados?.secoes || { total: [], tratando: [], ativas: [] });
      setPainel(dados?.painel || []);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar fechamento mensal.');
    } finally {
      if (sinalizarLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ativo = true;

    getResumo(periodoConsulta)
      .then(dados => {
        if (!ativo) return;
        setResumo(dados?.secoes || { total: [], tratando: [], ativas: [] });
        setPainel(dados?.painel || []);
        setErro('');
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar fechamento mensal.');
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [periodoConsulta]);

  /**
   * Carrega dados venda e atualiza o estado relacionado.
   */
  async function carregarDadosVenda() {
    const [vendasData, clientesData, vendedorasData, operadorasData, tiposVendaData, servicosData] = await Promise.all([
      listarVendas(),
      podeListarClientes ? listarClientes() : Promise.resolve([]),
      listarVendedoras(),
      listarOperadoras(),
      listarTiposVenda(),
      listarServicos()
    ]);

    setVendas(vendasData || []);
    setClientes(clientesData || []);
    setVendedoras(vendedorasData || []);
    setOperadoras(operadorasData || []);
    setTiposVenda(tiposVendaData || []);
    setServicos(servicosData || []);
  }

  /**
   * Abre venda e prepara o estado necessario.
   */
  async function abrirVenda(vendaId) {
    if (!vendaId) return;
    setErro('');
    setVendaLoadingId(vendaId);

    try {
      const [venda] = await Promise.all([
        buscarVendaPorId(vendaId),
        carregarDadosVenda()
      ]);

      setModalVenda(venda);
      setModalModoEdicao(false);
      setModalVendaAberto(true);
    } catch (error) {
      setErro(error.message || 'Erro ao abrir venda.');
    } finally {
      setVendaLoadingId(null);
    }
  }

  /**
   * Fecha venda e limpa o estado relacionado.
   */
  function fecharVenda() {
    setModalVendaAberto(false);
    setModalVenda(null);
    setModalModoEdicao(false);
  }

  /**
   * Atualiza dados fechamento com os dados informados.
   */
  async function atualizarDadosFechamento() {
    await Promise.all([
      carregarResumo(periodoConsulta, { sinalizarLoading: false }),
      carregarDadosVenda()
    ]);
    setDetalhesReloadKey(prev => prev + 1);
  }

  /**
   * Salva venda com os dados informados.
   */
  async function salvarVenda(dados) {
    setErro('');

    try {
      await atualizarVenda(modalVenda.id, dados);

      fecharVenda();
      await atualizarDadosFechamento();
    } catch (error) {
      setErro(error.message || 'Erro ao salvar venda.');
      throw error;
    }
  }

  /**
   * Envia pos venda para processamento.
   */
  async function enviarPosVenda(venda) {
    setErro('');

    try {
      await enviarVendaParaPosVenda(venda.id);
      fecharVenda();
      await atualizarDadosFechamento();
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    } catch (error) {
      setErro(error.message || 'Erro ao enviar venda para o pos-venda.');
      throw error;
    }
  }

  /**
   * Abre cliente rapido e prepara o estado necessario.
   */
  function abrirClienteRapido() {
    return new Promise(resolve => {
      setResolverClienteRapido(() => resolve);
      setClienteRapidoAberto(true);
    });
  }

  /**
   * Fecha cliente rapido e limpa o estado relacionado.
   */
  function fecharClienteRapido(cliente = null) {
    setClienteRapidoAberto(false);
    setResolverClienteRapido(resolve => {
      resolve?.(cliente);
      return null;
    });
  }

  /**
   * Salva cliente rapido com os dados informados.
   */
  async function salvarClienteRapido(clienteCriado) {
    const clientesAtualizados = podeListarClientes ? await listarClientes() : [];
    setClientes(clientesAtualizados || []);
    fecharClienteRapido(clienteCriado);
    return clienteCriado;
  }

  /**
   * Atualiza periodo com os dados informados.
   */
  function atualizarPeriodo(campo, valor) {
    setPeriodo(prev => ({ ...prev, [campo]: valor }));

    if (dataValida(valor)) {
      setPeriodoConsulta(prev => ({ ...prev, [campo]: valor }));
    }
  }

  /**
   * Exporta vendas no formato esperado.
   */
  async function exportarVendas() {
    if (!dataValida(periodoConsulta.data_inicio) || !dataValida(periodoConsulta.data_fim)) {
      setErro('Informe um período válido para exportar.');
      return;
    }

    setErro('');
    setExportando(true);

    try {
      await exportarVendasPeriodo(periodoConsulta);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar vendas do período.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <LayoutPrivado>
      <div className="fechamento-page">
        <div className="fechamento-filtros">
          <div className="form-field">
            <label>Data inicial</label>
            <input
              type="date"
              value={periodo.data_inicio}
              onChange={event => atualizarPeriodo('data_inicio', event.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Data final</label>
            <input
              type="date"
              value={periodo.data_fim}
              onChange={event => atualizarPeriodo('data_fim', event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn fechamento-export-btn"
            onClick={exportarVendas}
            disabled={exportando || loading}
            title="Exportar vendas do período em Excel"
          >
            <TableSheet size={16} />
            <span>{exportando ? 'Exportando...' : 'Exportar Excel'}</span>
          </button>
        </div>

        {erro && <div className="alert-error" style={{ marginBottom: 16 }}>{erro}</div>}
        {vendaLoadingId && (
          <div className="alert-info" style={{ marginBottom: 16 }}>
            Abrindo venda #{vendaLoadingId}...
          </div>
        )}

        <PainelGerencial linhas={painel} loading={loading} />

        <FechamentoSecao
          titulo="Total de vendas"
          subtitulo="Todos os status do funil, incluindo retornos"
          linhas={resumo.total || []}
          secao="total"
          loading={loading}
          onDetalhes={setModalDetalhes}
        />

        <FechamentoSecao
          titulo="Contratos tratando"
          subtitulo="Aprovação, ativação, envio, entrega e confirmação"
          linhas={resumo.tratando || []}
          secao="tratando"
          loading={loading}
          onDetalhes={setModalDetalhes}
        />

        <FechamentoSecao
          titulo="Vendas ativas"
          subtitulo="Contratos concluídos pela data de ativação, com UGRs por chip"
          linhas={resumo.ativas || []}
          secao="ativas"
          loading={loading}
          onDetalhes={setModalDetalhes}
        />

        {modalDetalhes && (
          <DetalhesAtivasModal
            secao={modalDetalhes}
            periodo={periodoConsulta}
            reloadKey={detalhesReloadKey}
            onAbrirVenda={abrirVenda}
            onClose={() => setModalDetalhes(null)}
          />
        )}
      </div>

      {modalVendaAberto && (
        <VendaModal
          venda={modalVenda}
          clientes={clientes}
          vendas={vendas}
          vendedoras={vendedoras}
          operadoras={operadoras}
          tiposVenda={tiposVenda}
          servicos={servicos}
          vendasPorCliente={vendasPorCliente}
          podeEditarVenda={podeEditarVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuarioLogado}
          modoEdicao={modalModoEdicao}
          onStartEdit={() => setModalModoEdicao(true)}
          onClose={fecharVenda}
          onSave={salvarVenda}
          onSendToPosVenda={enviarPosVenda}
          onCreateClient={abrirClienteRapido}
        />
      )}

      {clienteRapidoAberto && (
        <ClienteModal
          cliente={null}
          operadoras={operadoras}
          onClose={() => fecharClienteRapido(null)}
          onSave={salvarClienteRapido}
        />
      )}
    </LayoutPrivado>
  );
}

export default FechamentoMensalPage;
