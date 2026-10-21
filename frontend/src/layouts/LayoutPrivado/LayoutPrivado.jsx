import { useNavigationScroll } from '../../utils/useNavigationScroll';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../components/Sidebar/Sidebar';
import Header from '../../components/Header/Header';
import ChatFlutuante from '../../components/ChatFlutuante/ChatFlutuante';
import RetornoFuturoClientePopup from '../../components/RetornoFuturoClientePopup/RetornoFuturoClientePopup';
import { reconciliarPopupRetornoFuturo } from '../../components/RetornoFuturoClientePopup/retorno-futuro-popup.utils';
import * as I from '../../components/Icons';
import { buscarPerfil, getUsuarioLocal, logout, temPermissao } from '../../services/auth.service';
import VendaModal from '../../pages/VendasPage/VendaModal';
import ClienteModal from '../../pages/Clientes/ClienteModal';
import { listarClientesSelect } from '../../services/cliente.service';
import { listarAparenciasNotificacao, listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { criarVenda, listarAprovacoesVenda, listarVendedoras, obterReferenciasClientesVendas, uploadArquivoVenda } from '../../services/venda.service';
import { criarNotaEntidade } from '../../services/nota.service';
import {
  excluirNotificacao,
  listarNotificacoesUrgentes,
  marcarTodasNotificacoesLidas,
  marcarPopupNotificacaoVisto
} from '../../services/notificacao.service';
import {
  aberturaNotificacaoPendente,
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  iniciarAberturaNotificacao
} from '../../services/notificacao-abertura.service';
import { contarMensagensNaoLidas } from '../../services/mensagem.service';
import { listarFuturosClientesRecebidos } from '../../services/lead-planilha.service';
import {
  assinaturaNotificacoesNavbar,
  chaveNotificacaoNavbar,
  filtrarExclusoesPendentesNavbar,
  restaurarNotificacaoNavbar
} from './notificacao-navbar.utils';
import { resolverDestinoNotificacao } from './notificacao-destino';

const routeConfigs = [
  { path: '/', title: 'Dashboard', sub: 'Indicadores, campanhas e gamificação', id: 'dashboard', end: true },
  { path: '/vendas', title: 'Vendas', sub: 'Cadastro manual das vendas fechadas', id: 'vendas' },
  { path: '/vendas/lixeira', title: 'Lixeira de vendas', sub: 'Vendas removidas e prazo de exclusão definitiva', id: 'vendas' },
  { path: '/clientes', title: 'Clientes', sub: 'Representantes e empresas vinculados as vendas', id: 'clientes', end: true },
  { path: '/clientes-secretos', title: 'Qualificação de Leads', sub: 'Registros para qualificar e acompanhar novos leads', id: 'clientes-secretos', end: true },
  { path: '/clientes-secretos/novo', title: 'Novo lead', sub: 'Cadastre um lead para qualificacao', id: 'clientes-secretos' },
  { path: '/clientes-secretos/:id/editar', title: 'Editar lead', sub: 'Atualize a qualificacao do lead', id: 'clientes-secretos' },
  { path: '/clientes/lixeira', title: 'Lixeira de clientes', sub: 'Clientes removidos e prazo de exclusão definitiva', id: 'clientes' },
  { path: '/clientes/:id/editar', title: 'Editar cliente', sub: 'Atualize dados do representante e fidelidade', id: 'clientes' },
  { path: '/funil', title: 'Funil de Vendas', sub: 'Acompanhe cada venda do lançamento até a conclusão', id: 'funil' },
  { path: '/funil-automacoes', title: 'Funil automações', sub: 'Compare o processo automático com o funil real', id: 'funil-automacoes' },
  { path: '/vendas/aprovacoes', title: 'Aprovações', sub: 'Solicitações de liberação ADM para vendas especiais', id: 'aprovacoes' },
  { path: '/retornos', title: 'Retornos', sub: 'Chips que retornaram por algum erro', id: 'retornos' },
  { path: '/relatorios', title: 'Relatórios', sub: 'Indicadores comerciais e desempenho por usuário', id: 'relatorios' },
  { path: '/historico', title: 'Histórico', sub: 'Todas as movimentações do sistema', id: 'historico' },
  { path: '/historico/lixeira', title: 'Lixeira de vendas', sub: 'Histórico das vendas excluídas', id: 'historico' },
  { path: '/usuarios', title: 'Usuários', sub: 'Gerencie acessos e permissões', id: 'usuarios', end: true },
  { path: '/usuarios/novo', title: 'Novo Usuário', sub: 'Cadastrar novo acesso no sistema', id: 'usuarios' },
  { path: '/usuarios/cadastrar', title: 'Novo Usuário', sub: 'Cadastrar novo acesso no sistema', id: 'usuarios' },
  { path: '/usuarios/:id/editar', title: 'Editar Usuário', sub: 'Atualize dados, status e permissões', id: 'usuarios' },
  { path: '/perfil', title: 'Perfil', sub: 'Suas informações de conta e acesso', id: 'perfil', end: true },
  { path: '/perfil/editar', title: 'Editar perfil', sub: 'Atualize seus dados de acesso', id: 'perfil' },
  { path: '/configuracoes', title: 'Configurações', sub: 'Gerencie operadoras, tipos de venda, serviços e links externos', id: 'config' },
  { path: '/admin/campanhas', title: 'Campanhas', sub: 'Configure desafios e recompensas do time', id: 'campanhas' },
  { path: '/admin/fechamento-mensal', title: 'Fechamento Mensal', sub: 'Consolide contratos, UGRs e comissões do período', id: 'fechamento-mensal' },
  { path: '/admin/leads', title: 'Planilha de Mailing', sub: 'Importe, filtre e distribua mailing para vendedores', id: 'leads' },
  { path: '/admin/cruzar-vendas', title: 'Cruzar Vendas', sub: 'Cruze a planilha principal com as concluídas das operadoras', id: 'cruzar-vendas' },
  { path: '/admin/consultar-cnpj', title: 'Consultar CNPJ', sub: 'Enriqueça planilhas com dados cadastrais de empresas', id: 'consultar-cnpj' },
  { path: '/clientes-antigos', title: 'Busca de Clientes Antigos', sub: 'Consulte vendas antigas por CNPJ para revenda', id: 'clientes-antigos', end: true },
  { path: '/futuros-clientes', title: 'Futuros Clientes', sub: 'Mailing marcados para acompanhamento futuro', id: 'futuros-clientes', end: true },
  { path: '/mensagens', title: 'Mensagens', sub: 'Conversas internas entre usuários', id: 'mensagens', end: true },
  { path: '/problemas', title: 'Problemas Pós-venda', sub: 'Correções solicitadas pela operadora', id: 'problemas', end: true },
  { path: '/automacoes', title: 'Automações', sub: 'Histórico e revisão da integração Gmail', id: 'automacoes', end: true },
];

/**
 * Retorna route config a partir dos dados informados.
 */
function getRouteConfig(pathname) {
  return (
    routeConfigs.find(config =>
      matchPath({ path: config.path, end: config.end ?? true }, pathname)
    ) || { title: 'Sistema', sub: '', id: '' }
  );
}

/**
 * Monta mapa referencias a partir dos dados informados.
 */
function montarMapaReferencias(referencias = [], campo = 'total') {
  return referencias.reduce((mapa, item) => {
    if (item?.chave) mapa.set(item.chave, Number(item[campo] || 0));
    return mapa;
  }, new Map());
}

/**
 * Processa layout privado conforme as regras do dominio.
 */
function LayoutPrivado({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationRoot = useRef(null);
  useNavigationScroll(navigationRoot, location.pathname + location.search);
  const [usuario, setUsuario] = useState(() => getUsuarioLocal());
  const currentConfig = getRouteConfig(location.pathname);
  const podeCriarVenda = usuario && temPermissao(usuario, 'vendas_criar');
  const podeEditarVenda = usuario && temPermissao(usuario, ['vendas_editar', 'pos_venda']);
  const podeVerDocumentosVenda = usuario && temPermissao(usuario, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = usuario && temPermissao(usuario, 'adicionar_documentos');
  const podeListarVendas = usuario && temPermissao(usuario, ['vendas_ver_proprias', 'vendas_ver_todas']);
  const podeListarClientes = usuario && temPermissao(usuario, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const [novaVendaAberta, setNovaVendaAberta] = useState(false);
  const [carregandoNovaVenda, setCarregandoNovaVenda] = useState(false);
  const [erroNovaVenda, setErroNovaVenda] = useState('');
  const [sucessoNovaVenda, setSucessoNovaVenda] = useState('');
  const [clientesNovaVenda, setClientesNovaVenda] = useState([]);
  const [referenciasClientesNovaVenda, setReferenciasClientesNovaVenda] = useState([]);
  const [vendedorasNovaVenda, setVendedorasNovaVenda] = useState([]);
  const [operadorasNovaVenda, setOperadorasNovaVenda] = useState([]);
  const [tiposVendaNovaVenda, setTiposVendaNovaVenda] = useState([]);
  const [servicosNovaVenda, setServicosNovaVenda] = useState([]);
  const [clienteRapidoAberto, setClienteRapidoAberto] = useState(false);
  const [, setResolverClienteRapido] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const vendasPorClienteNovaVenda = useMemo(() => montarMapaReferencias(referenciasClientesNovaVenda, 'total'), [referenciasClientesNovaVenda]);
  const vendasEmAndamentoPorClienteNovaVenda = useMemo(() => montarMapaReferencias(referenciasClientesNovaVenda, 'em_andamento_total'), [referenciasClientesNovaVenda]);

  useEffect(() => {
    let ativo = true;

    const verificarAcesso = () => buscarPerfil()
      .then(usuarioAtualizado => {
        if (!ativo) return;
        localStorage.setItem('usuario', JSON.stringify(usuarioAtualizado));
        setUsuario(usuarioAtualizado);
        window.dispatchEvent(new CustomEvent('auth:usuario-atualizado', { detail: usuarioAtualizado }));
      })
      .catch(() => {});

    verificarAcesso();
    const intervalo = setInterval(verificarAcesso, 30000);

    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  /**
   * Trata o evento de logout.
   */
  async function handleLogout() {
    setMobileMenuOpen(false);
    try { await logout(); } catch {
      sessionStorage.setItem('logout_message', 'Não foi possível confirmar o encerramento no servidor. A liberação anterior pode continuar válida até expirar.');
    }
    navigate('/login');
  }

  /**
   * Renderiza handle set page.
   */
  const handleSetPage = (id) => {
    const routeMap = {
      dashboard: '/',
      vendas: '/vendas',
      clientes: '/clientes',
      'clientes-secretos': '/clientes-secretos',
      'clientes-antigos': '/clientes-antigos',
      'futuros-clientes': '/futuros-clientes',
      funil: '/funil',
      'funil-automacoes': '/funil-automacoes',
      aprovacoes: '/vendas/aprovacoes',
      retornos: '/retornos',
      relatorios: '/relatorios',
      historico: '/historico',
      mensagens: '/mensagens',
      usuarios: '/usuarios',
      config: '/configuracoes',
      campanhas: '/admin/campanhas',
      'fechamento-mensal': '/admin/fechamento-mensal',
      leads: '/admin/leads',
      'cruzar-vendas': '/admin/cruzar-vendas',
      'consultar-cnpj': '/admin/consultar-cnpj',
      problemas: '/problemas',
      automacoes: '/automacoes',
    };

    if (routeMap[id]) {
      setMobileMenuOpen(false);
      navigate(routeMap[id]);
    }
  };

  useEffect(() => {
    if (!sucessoNovaVenda) return undefined;
    const timer = setTimeout(() => setSucessoNovaVenda(''), 4000);
    return () => clearTimeout(timer);
  }, [sucessoNovaVenda]);

  useEffect(() => {
    if (!erroNovaVenda) return undefined;
    const timer = setTimeout(() => setErroNovaVenda(''), 6000);
    return () => clearTimeout(timer);
  }, [erroNovaVenda]);

  useEffect(() => {
    /**
     * Trata o evento de key down.
     */
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.body.classList.toggle('mobile-menu-open', mobileMenuOpen);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('mobile-menu-open');
    };
  }, [mobileMenuOpen]);

  /**
   * Carrega dados nova venda e atualiza o estado relacionado.
   */
  async function carregarDadosNovaVenda() {
    const [referenciasClientesData, clientesData, vendedorasData, operadorasData, tiposVendaData, servicosData] = await Promise.all([
      podeListarVendas ? obterReferenciasClientesVendas() : Promise.resolve([]),
      podeListarClientes ? listarClientesSelect() : Promise.resolve([]),
      listarVendedoras(),
      listarOperadoras(),
      listarTiposVenda(),
      listarServicos()
    ]);

    setReferenciasClientesNovaVenda(referenciasClientesData || []);
    setClientesNovaVenda(clientesData);
    setVendedorasNovaVenda(vendedorasData);
    setOperadorasNovaVenda(operadorasData);
    setTiposVendaNovaVenda(tiposVendaData);
    setServicosNovaVenda(servicosData);
  }

  /**
   * Trata o evento de new sale.
   */
  async function handleNewSale() {
    if (!podeCriarVenda || carregandoNovaVenda) return;

    setErroNovaVenda('');
    setSucessoNovaVenda('');
    setCarregandoNovaVenda(true);

    try {
      await carregarDadosNovaVenda();
      setNovaVendaAberta(true);
    } catch (error) {
      setErroNovaVenda(error.message || 'Erro ao preparar cadastro de venda.');
    } finally {
      setCarregandoNovaVenda(false);
    }
  }

  /**
   * Salva nova venda com os dados informados.
   */
  async function salvarNovaVenda(dados, notasPendentes = [], arquivosPendentes = []) {
    setErroNovaVenda('');
    const vendaSalva = await criarVenda(dados);
    if (vendaSalva?.id && Array.isArray(notasPendentes) && notasPendentes.length > 0) {
      for (const nota of notasPendentes) {
        try {
          await criarNotaEntidade('venda', vendaSalva.id, nota);
        } catch (error) {
          console.error('Erro ao salvar nota pendente da venda:', error);
        }
      }
    }
    if (vendaSalva?.id && Array.isArray(arquivosPendentes) && arquivosPendentes.length > 0) {
      for (const item of arquivosPendentes) {
        try {
          await uploadArquivoVenda(vendaSalva.id, item.file, { categoria: item.categoria });
        } catch (error) {
          console.error('Erro ao enviar arquivo pendente da venda:', error);
        }
      }
    }
    setNovaVendaAberta(false);
    setSucessoNovaVenda('Venda cadastrada com sucesso.');
    window.dispatchEvent(new CustomEvent('pos-venda:vendas-atualizadas'));
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
    const clientesAtualizados = podeListarClientes ? await listarClientesSelect() : [];
    setClientesNovaVenda(clientesAtualizados);
    fecharClienteRapido(clienteCriado);
    setSucessoNovaVenda('Cliente cadastrado com sucesso.');
    return clienteCriado;
  }

  const [alertasUrgentes, setAlertasUrgentes] = useState([]);
  const [popupRetornoFuturo, setPopupRetornoFuturo] = useState(null);
  const [aparenciasNotificacao, setAparenciasNotificacao] = useState([]);
  const [detalheAlerta, setDetalheAlerta] = useState(null);
  const carregandoAlertasUrgentesRef = useRef(false);
  const atualizacaoAlertasUrgentesPendenteRef = useRef(false);
  const assinaturaAlertasUrgentesRef = useRef(null);
  const exclusoesAlertasPendentesRef = useRef(new Set());
  const versaoAlertasRef = useRef(0);
  const marcandoTodasLidasRef = useRef(false);
  const [marcandoTodasLidas, setMarcandoTodasLidas] = useState(false);
  const [erroMarcarTodasLidas, setErroMarcarTodasLidas] = useState('');
  const [aprovacoesPendentes, setAprovacoesPendentes] = useState(0);
  const [mensagensNaoLidas, setMensagensNaoLidas] = useState(0);
  const [futurosClientesPendentes, setFuturosClientesPendentes] = useState(0);
  const podeVerAprovacoes = usuario && temPermissao(usuario, 'vendas_aprovacoes_visualizar');
  const podeUsarChat = usuario && temPermissao(usuario, 'chat_usar');
  const podeVerFuturosClientes = usuario && temPermissao(usuario, 'futuros_clientes_ver');

  useEffect(() => {
    if (!podeVerAprovacoes) return undefined;

    let ativo = true;

    /**
     * Carrega  e atualiza o estado relacionado.
     */
    async function carregar() {
      try {
        const lista = await listarAprovacoesVenda({ status: 'pendente' });
        if (!ativo) return;
        setAprovacoesPendentes(Array.isArray(lista) ? lista.length : 0);
      } catch {
        if (ativo) setAprovacoesPendentes(0);
      }
    }

    carregar();
    const timer = setInterval(carregar, 15000);

    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [podeVerAprovacoes]);

  useEffect(() => {
    if (!podeUsarChat) return undefined;

    let ativo = true;

    /**
     * Carrega  e atualiza o estado relacionado.
     */
    async function carregar() {
      try {
        const dados = await contarMensagensNaoLidas();
        if (ativo) setMensagensNaoLidas(Number(dados?.total || 0));
      } catch {
        if (ativo) setMensagensNaoLidas(0);
      }
    }

    carregar();
    const timer = setInterval(carregar, 10000);
    window.addEventListener('pos-venda:mensagens-atualizar', carregar);

    return () => {
      ativo = false;
      clearInterval(timer);
      window.removeEventListener('pos-venda:mensagens-atualizar', carregar);
    };
  }, [podeUsarChat]);

  useEffect(() => {
    if (!podeVerFuturosClientes) {
      return undefined;
    }

    let ativo = true;

    async function carregar() {
      try {
        const dados = await listarFuturosClientesRecebidos({ page: 1, page_size: 1, status: 'acao' });
        if (ativo) setFuturosClientesPendentes(Number(dados?.total || 0));
      } catch {
        if (ativo) setFuturosClientesPendentes(0);
      }
    }

    carregar();
    const timer = setInterval(carregar, 15000);
    window.addEventListener('pos-venda:mailing-atualizar', carregar);

    return () => {
      ativo = false;
      clearInterval(timer);
      window.removeEventListener('pos-venda:mailing-atualizar', carregar);
    };
  }, [podeVerFuturosClientes]);

  /**
   * Carrega alertas urgentes e atualiza o estado relacionado.
   */
  async function carregarAparenciasNotificacao() { try { setAparenciasNotificacao(await listarAparenciasNotificacao()); } catch { setAparenciasNotificacao([]); } }
  useEffect(() => {
    window.addEventListener('pos-venda:notificacao-aparencias-atualizar', carregarAparenciasNotificacao);
    window.dispatchEvent(new CustomEvent('pos-venda:notificacao-aparencias-atualizar'));
    return () => window.removeEventListener('pos-venda:notificacao-aparencias-atualizar', carregarAparenciasNotificacao);
  }, []);
  function estiloAlerta(n) { const cor = aparenciasNotificacao.find(item => item.tipo === n.tipo)?.cor; return cor ? { '--tone-color': cor } : undefined; }

  useEffect(() => {
    if (!usuario) return undefined;

    let ativo = true;
    async function carregarAlertasUrgentes() {
      // Em producao a sincronizacao no servidor pode levar mais que o intervalo
      // de consulta. Evita requisicoes concorrentes, sem perder uma atualizacao
      // solicitada por uma alteracao feita pelo usuario.
      if (carregandoAlertasUrgentesRef.current || marcandoTodasLidasRef.current) {
        atualizacaoAlertasUrgentesPendenteRef.current = true;
        return;
      }

      carregandoAlertasUrgentesRef.current = true;
      const versao = versaoAlertasRef.current;
      try {
        const dados = await listarNotificacoesUrgentes();
        if (!ativo || versao !== versaoAlertasRef.current) return;
        const semExclusoesPendentes = filtrarExclusoesPendentesNavbar(
          dados.notificacoes || [],
          exclusoesAlertasPendentesRef.current
        );
        const notificacoes = semExclusoesPendentes.filter(
          notificacao => !aberturaNotificacaoPendente(notificacao.id)
        );
        const assinatura = assinaturaNotificacoesNavbar(notificacoes);
        assinaturaAlertasUrgentesRef.current = assinatura;
        setAlertasUrgentes(notificacoes);
        setPopupRetornoFuturo(atual => reconciliarPopupRetornoFuturo(atual, notificacoes));
      } catch (error) {
        // Conserva o ultimo resultado valido; apagar a pilha em uma falha temporaria
        // torna o problema invisivel e faz parecer que a notificacao nao chegou.
        console.error('Erro ao carregar alertas urgentes:', error);
      } finally {
        carregandoAlertasUrgentesRef.current = false;
        if (ativo && !marcandoTodasLidasRef.current && atualizacaoAlertasUrgentesPendenteRef.current) {
          atualizacaoAlertasUrgentesPendenteRef.current = false;
          void carregarAlertasUrgentes();
        }
      }
    }

    const timer = setInterval(carregarAlertasUrgentes, 5000);
    window.addEventListener('pos-venda:notificacoes-atualizar', carregarAlertasUrgentes);
    window.addEventListener('pos-venda:navbar-notificacoes-atualizar', carregarAlertasUrgentes);
    void carregarAlertasUrgentes();

    return () => {
      ativo = false;
      clearInterval(timer);
      window.removeEventListener('pos-venda:notificacoes-atualizar', carregarAlertasUrgentes);
      window.removeEventListener('pos-venda:navbar-notificacoes-atualizar', carregarAlertasUrgentes);
    };
  }, [usuario]);

  /** Confirma a leitura antes de retirar avisos e invalida consultas anteriores ao envio. */
  async function marcarTodosAlertasLidos() {
    if (marcandoTodasLidasRef.current || alertasUrgentes.length === 0) return;
    marcandoTodasLidasRef.current = true;
    versaoAlertasRef.current += 1;
    setMarcandoTodasLidas(true);
    setErroMarcarTodasLidas('');
    const ids = new Set(alertasUrgentes.map(chaveNotificacaoNavbar));
    try {
      await marcarTodasNotificacoesLidas({ escopo: 'navbar' });
      setAlertasUrgentes(atuais => atuais.filter(item => !ids.has(chaveNotificacaoNavbar(item))));
      setPopupRetornoFuturo(null);
    } catch (error) {
      console.error('Erro ao marcar avisos como lidos:', error);
      setErroMarcarTodasLidas('Não foi possível marcar os avisos como lidos. Tente novamente.');
    } finally {
      marcandoTodasLidasRef.current = false;
      setMarcandoTodasLidas(false);
      window.dispatchEvent(new CustomEvent('pos-venda:navbar-notificacoes-atualizar'));
    }
  }

  /**
   * Executa a acao de ocultar alerta urgente mantendo o estado da tela consistente.
   */
  function ocultarAlertaUrgente(notificacao) {
    const chave = notificacao.destinatario_id || notificacao.id;
    setAlertasUrgentes(prev => {
      const atualizadas = prev.filter(item => (item.destinatario_id || item.id) !== chave);
      assinaturaAlertasUrgentesRef.current = assinaturaNotificacoesNavbar(atualizadas);
      return atualizadas;
    });
  }

  /** Confirma somente o popup, sem alterar a tela ou qualquer modal em uso. */
  async function confirmarPopupRetornoFuturo(notificacao) {
    await marcarPopupNotificacaoVisto(notificacao.id);
    setPopupRetornoFuturo(atual => (
      Number(atual?.id) === Number(notificacao.id)
        ? reconciliarPopupRetornoFuturo(
          null,
          alertasUrgentes.filter(item => Number(item.id) !== Number(notificacao.id))
        )
        : atual
    ));
    ocultarAlertaUrgente(notificacao);
  }

  /**
   * Exclui alerta urgente somente para o usuario atual.
   */
  async function excluirAlertaUrgente(notificacao) {
    const chave = chaveNotificacaoNavbar(notificacao);
    exclusoesAlertasPendentesRef.current.add(chave);
    ocultarAlertaUrgente(notificacao);

    try {
      await excluirNotificacao(notificacao.id);
    } catch (error) {
      console.error('Erro ao excluir notificacao:', error);
      setAlertasUrgentes(prev => {
        const restauradas = restaurarNotificacaoNavbar(prev, notificacao);
        assinaturaAlertasUrgentesRef.current = assinaturaNotificacoesNavbar(restauradas);
        return restauradas;
      });
    } finally {
      exclusoesAlertasPendentesRef.current.delete(chave);
    }
  }

  /**
   * Retorna tom alerta no formato esperado pelo fluxo.
   */
  function tomAlerta(notificacao) {
    switch (notificacao.tipo) {
      case 'venda_problema_aberto':
      case 'venda_problema_resolvido':
      case 'venda_problema_correcao':
      case 'venda_problema_automatico':
        return 'info';
      case 'venda_retorno_registrado':
        return 'danger';
      case 'venda_aprovacao_pendente':
      case 'venda_parada_funil':
      case 'cliente_fidelidade':
        return 'warn';
      case 'nota_retorno_pre':
      case 'nota_retorno_due':
      case 'futuro_cliente_retorno_pre':
      case 'futuro_cliente_retorno_due':
      case 'lead_retorno_pre':
      case 'lead_retorno_due':
        return 'contact';
      default:
        return notificacao.nivel === 'warn' ? 'warn' : 'danger';
    }
  }

  /**
   * Abre venda alerta e prepara o estado necessario.
   */
  function abrirVendaAlerta(notificacao) {
    const destino = resolverDestinoNotificacao(notificacao, usuario);
    iniciarAberturaNotificacao(notificacao.id);
    ocultarAlertaUrgente(notificacao);
    if (destino.podeAbrir) {
      navigate(destino.rota);
      return;
    }

    if (destino.motivoTipo !== 'sem_permissao') {
      falharAberturaNotificacao(notificacao.id);
    }
    setDetalheAlerta({
      notificacao,
      motivo: destino.motivo,
      confirmarAoExibir: destino.motivoTipo === 'sem_permissao'
    });
  }

  useEffect(() => {
    if (!detalheAlerta?.notificacao?.id || !detalheAlerta.confirmarAoExibir) return;
    const notificacao = detalheAlerta.notificacao;
    confirmarAberturaNotificacao(notificacao.id).catch(error => {
      console.error('Erro ao confirmar abertura da notificacao:', error);
      setAlertasUrgentes(prev => restaurarNotificacaoNavbar(prev, notificacao));
    });
  }, [detalheAlerta]);

  const mostrarMobileFabNovaVenda = podeCriarVenda && location.pathname === '/vendas';
  const destinoPopupRetorno = popupRetornoFuturo
    ? resolverDestinoNotificacao(popupRetornoFuturo, usuario)
    : null;
  const appClasses = [
    'app',
    mobileMenuOpen ? 'is-mobile-menu-open' : '',
    mostrarMobileFabNovaVenda ? 'has-mobile-fab' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={appClasses} ref={navigationRoot}>
      <button
        type="button"
        className="sidebar-mobile-backdrop"
        aria-label="Fechar menu"
        onClick={() => setMobileMenuOpen(false)}
      />
      <Sidebar
        page={currentConfig.id}
        setPage={handleSetPage}
        counts={{
          active: 0,
          returns: 0,
          aprovacoes: podeVerAprovacoes ? aprovacoesPendentes : 0,
          futurosClientes: podeVerFuturosClientes ? futurosClientesPendentes : 0,
          mensagens: podeUsarChat ? mensagensNaoLidas : 0
        }}
        usuario={usuario}
        onLogout={handleLogout}
        isMobileOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onPerfilClick={() => {
          setMobileMenuOpen(false);
          navigate('/perfil');
        }}
      />
      <div className="main">
        <Header
          title={currentConfig.title}
          subtitle={currentConfig.sub}
          onNew={podeCriarVenda ? handleNewSale : null}
          onMenuClick={() => setMobileMenuOpen(open => !open)}
          mobileMenuOpen={mobileMenuOpen}
          alertasUrgentes={alertasUrgentes}
          estiloAlerta={estiloAlerta}
          tomAlerta={tomAlerta}
          onAbrirAlerta={abrirVendaAlerta}
          onExcluirAlerta={excluirAlertaUrgente}
          onMarcarTodasLidas={marcarTodosAlertasLidos}
          marcandoTodasLidas={marcandoTodasLidas}
          erroMarcarTodasLidas={erroMarcarTodasLidas}
        />
        <div className="content">
          {sucessoNovaVenda && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucessoNovaVenda}</div>}
          {erroNovaVenda && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erroNovaVenda}</div>}
          <div className="content__viewport" data-navigation-scroll="viewport">
            {children}
          </div>
        </div>
      </div>

      {mostrarMobileFabNovaVenda && (
        <button
          type="button"
          className="mobile-fab"
          aria-label="Nova venda"
          onClick={handleNewSale}
          disabled={carregandoNovaVenda}
        >
          <I.Plus size={22} />
        </button>
      )}

      {novaVendaAberta && (
        <VendaModal
          venda={null}
          clientes={clientesNovaVenda}
          vendas={[]}
          vendedoras={vendedorasNovaVenda}
          operadoras={operadorasNovaVenda}
          tiposVenda={tiposVendaNovaVenda}
          servicos={servicosNovaVenda}
          vendasPorCliente={vendasPorClienteNovaVenda}
          vendasEmAndamentoPorCliente={vendasEmAndamentoPorClienteNovaVenda}
          podeEditarVenda={podeEditarVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuario}
          modoEdicao
          onClose={() => setNovaVendaAberta(false)}
          onSave={salvarNovaVenda}
          onSendToPosVenda={() => {}}
          onCreateClient={abrirClienteRapido}
        />
      )}

      {clienteRapidoAberto && (
        <ClienteModal
          cliente={null}
          operadoras={operadorasNovaVenda}
          onClose={() => fecharClienteRapido(null)}
          onSave={salvarClienteRapido}
        />
      )}

      {detalheAlerta && (
        <div className="modal-overlay" role="presentation" onMouseDown={() => setDetalheAlerta(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="detalhe-notificacao-titulo" onMouseDown={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-client" id="detalhe-notificacao-titulo">{detalheAlerta.notificacao.titulo}</div>
                <div className="modal-sub">Detalhes da notificação</div>
              </div>
              <button type="button" className="btn btn-icon btn-ghost" aria-label="Fechar detalhes da notificação" onClick={() => setDetalheAlerta(null)}>
                <I.Close size={14} />
              </button>
            </div>
            <div className="modal-body" data-navigation-scroll="LayoutPrivado-1">
              <p>{detalheAlerta.notificacao.mensagem}</p>
              <div className="alert-error">{detalheAlerta.motivo}</div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setDetalheAlerta(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}

      {popupRetornoFuturo && (
        <RetornoFuturoClientePopup
          key={popupRetornoFuturo.id}
          notificacao={popupRetornoFuturo}
          atendimentoUrl={destinoPopupRetorno?.podeAbrir ? destinoPopupRetorno.rota : null}
          onConfirmar={confirmarPopupRetornoFuturo}
        />
      )}

      {podeUsarChat && location.pathname !== '/mensagens' && (
        <ChatFlutuante usuario={usuario} naoLidas={podeUsarChat ? mensagensNaoLidas : 0} />
      )}
    </div>
  );
}

export default LayoutPrivado;
