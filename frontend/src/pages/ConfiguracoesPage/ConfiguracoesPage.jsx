import { useEffect, useMemo, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  atualizarAparenciaNotificacao,
  atualizarLinkExterno,
  atualizarOperadora,
  atualizarRegraComissao,
  atualizarServico,
  atualizarTipoVenda,
  criarLinkExterno,
  criarOperadora,
  criarRegraComissao,
  criarServico,
  criarTipoVenda,
  excluirLinkExterno,
  excluirOperadora,
  excluirRegraComissao,
  excluirServico,
  excluirTipoVenda,
  listarOperadoras,
  listarAparenciasNotificacaoAdmin,
  listarLinksExternosAdmin,
  listarOperadorasAdmin,
  listarRegrasComissaoAdmin,
  listarServicosAdmin,
  listarTiposVendaAdmin
} from '../../services/config.service';
import {
  previewPlanilhaClientesAntigos,
  importarPlanilhaClientesAntigos
} from '../../services/cliente-antigo.service';
import './ConfiguracoesPage.css';
import HorarioAcessoConfig from './HorarioAcessoConfig';

const MAPEAMENTO_CLIENTES_ANTIGOS = {
  cnpj: '',
  razao_social: '',
  data_venda: '',
  operadora: '',
  responsavel_nome: '',
  telefone: '',
  quantidade_chips: ''
};

const FORM_SIMPLES = {
  nome: '',
  ativo: true
};

const CORES_MARCADOR = {
  vivo: '#5e0a8a',
  tim: '#003a8c',
  claro: '#c8102e',
  gov: '#1f7a1f',
  abr: '#0f766e'
};

const LINK_VAZIO = {
  chave: '',
  nome: '',
  url: '',
  dot: '',
  cor: '#0f766e',
  ativo: true
};

const REGRA_COMISSAO_VAZIA = {
  operadora_id: '',
  valor_min: '',
  valor_max: '',
  valor_comissao: '',
  valor_comissao_base: '',
  valor_comissao_base_propria: '',
  prioridade_base_dupla: 'base_propria',
  ativo: true
};

const PRIORIDADES_BASE_DUPLA = [
  { value: 'base_propria', label: 'Nossa base' },
  { value: 'base_operadora', label: 'Base da operadora' }
];

/**
 * Formata moeda para exibicao.
 */
function fmtMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Retorna valor form no formato esperado pelo fluxo.
 */
function valorForm(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return fmtMoeda(valor);
}

function normalizarColunaImportacao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokensBuscaColuna(valor) {
  return normalizarColunaImportacao(valor)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function colunaCorrespondeBusca(coluna, busca) {
  const termo = normalizarColunaImportacao(busca);
  const nome = normalizarColunaImportacao(coluna?.nome);
  if (!termo || !nome) return false;
  if (nome === termo || nome.includes(termo)) return true;

  const tokens = tokensBuscaColuna(busca);
  return tokens.length > 0 && tokens.every(token => nome.includes(token));
}

function encontrarColunaImportacao(colunas, busca) {
  if (!busca) return null;
  return colunas.find(coluna => colunaCorrespondeBusca(coluna, busca)) || null;
}

function sugerirColunaImportacao(colunas, termos) {
  return termos.map(termo => encontrarColunaImportacao(colunas, termo)).find(Boolean)?.nome || '';
}
function montarSugestoesClientesAntigos(colunas) {
  return {
    cnpj: sugerirColunaImportacao(colunas, ['cnpj', 'cpf/cnpj', 'documento']),
    razao_social: sugerirColunaImportacao(colunas, ['razao', 'razao social', 'empresa']),
    data_venda: sugerirColunaImportacao(colunas, ['data da venda', 'data venda', 'data']),
    operadora: sugerirColunaImportacao(colunas, ['operadora', 'operadoras']),
    responsavel_nome: sugerirColunaImportacao(colunas, ['responsavel', 'nome responsavel', 'nome do responsavel', 'contato']),
    telefone: sugerirColunaImportacao(colunas, ['telefone', 'fone', 'celular', 'whatsapp', 'contato telefone']),
    quantidade_chips: sugerirColunaImportacao(colunas, ['quantidade de chips', 'qtd chips', 'chips', 'quantidade', 'qtd', 'ctns'])
  };
}

function obterColunasClientesAntigos(preview, abasSelecionadas) {
  const abasComColunas = preview?.abas?.filter(item => Array.isArray(item.colunas)) || [];
  const selecionadas = new Set(abasSelecionadas);
  const origem = abasComColunas.length > 0
    ? abasComColunas.filter(item => selecionadas.has(item.nome)).flatMap(item => item.colunas || [])
    : preview?.colunas || [];
  const vistas = new Set();

  return origem.filter(coluna => {
    if (!coluna?.nome || vistas.has(coluna.nome)) return false;
    vistas.add(coluna.nome);
    return true;
  });
}

function ajustarMapeamentoClientesAntigos(mapeamento, colunas) {
  const sugestoes = montarSugestoesClientesAntigos(colunas);
  const proximo = { ...mapeamento };

  Object.keys(proximo).forEach(campo => {
    if (proximo[campo] && !encontrarColunaImportacao(colunas, proximo[campo])) {
      proximo[campo] = sugestoes[campo] || '';
    }
  });

  if (!proximo.cnpj && sugestoes.cnpj) proximo.cnpj = sugestoes.cnpj;
  return proximo;
}

/**
 * Processa mascarar brl conforme as regras do dominio.
 */
function mascararBRL(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';

  return fmtMoeda(Number(digits) / 100);
}

/**
 * Processa moeda para numero conforme as regras do dominio.
 */
function moedaParaNumero(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';

  return Number((Number(digits) / 100).toFixed(2));
}

/**
 * Retorna label prioridade base dupla no formato esperado pelo fluxo.
 */
function labelPrioridadeBaseDupla(valor) {
  return PRIORIDADES_BASE_DUPLA.find(item => item.value === valor)?.label || 'Nossa base';
}

/**
 * Retorna status pill no formato esperado pelo fluxo.
 */
function StatusPill({ ativo }) {
  return (
    <span className={`config-status ${ativo ? 'is-active' : 'is-inactive'}`}>
      <span />
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

/**
 * Renderiza confirmar exclusao config modal.
 */
function ConfirmarExclusaoConfigModal({ item, tipo, excluindo, onClose, onConfirm }) {
  if (!item) return null;

  const nomeItem = item.nome || item.chave || `#${item.id}`;

  return (
    <div className="modal-overlay" onClick={event => !excluindo && event.target === event.currentTarget && onClose()}>
      <div className="modal config-delete-modal" role="dialog" aria-modal="true" aria-labelledby="config-delete-title">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="config-delete-title" className="modal-client">Excluir configuração?</div>
              <div className="modal-sub">{tipo} - {nomeItem}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={excluindo} title="Fechar">
              <I.Close size={16} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <div className="config-delete-warning">
            <div className="config-delete-icon">
              <I.AlertTriangle size={22} />
            </div>
            <div>
              <strong>Essa ação remove o cadastro das configurações.</strong>
              <p>Confira se este item não está em uso antes de confirmar. Depois da exclusão, ele deixará de aparecer nas listas do sistema.</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={excluindo}>
            <I.Trash size={13} /> {excluindo ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza configuracoes page.
 */
function ConfiguracoesPage() {
  const [usuario, setUsuario] = useState(() => getUsuarioLocal());
  const permissoes = {
    operadoras: temPermissao(usuario, 'crud_operadoras'),
    tiposVenda: temPermissao(usuario, 'crud_tipos_venda'),
    servicos: temPermissao(usuario, 'crud_servicos'),
    links: temPermissao(usuario, 'crud_links'),
    regrasComissao: temPermissao(usuario, 'crud_regras_comissao'),
    notificacoes: temPermissao(usuario, 'configurar_notificacoes'),
    horarioAcesso: temPermissao(usuario, 'configurar_horario_acesso')
  };

  const abas = useMemo(() => [
    { id: 'operadoras', label: 'Operadoras', permitido: permissoes.operadoras },
    { id: 'tiposVenda', label: 'Tipos de venda', permitido: permissoes.tiposVenda },
    { id: 'servicos', label: 'Serviços', permitido: permissoes.servicos },
    { id: 'links', label: 'Links externos', permitido: permissoes.links },
    { id: 'regrasComissao', label: 'Comissões', permitido: permissoes.regrasComissao },
    { id: 'notificacoes', label: 'Notificações', permitido: permissoes.notificacoes },
    { id: 'horarioAcesso', label: 'Horário de acesso', permitido: permissoes.horarioAcesso },
  ].filter(abaItem => abaItem.permitido), [
    permissoes.operadoras,
    permissoes.tiposVenda,
    permissoes.servicos,
    permissoes.links,
    permissoes.regrasComissao,
    permissoes.notificacoes,
    permissoes.horarioAcesso
  ]);

  const [aba, setAba] = useState(abas[0]?.id || '');
  useEffect(() => {
    const atualizarUsuario = event => {
      const usuarioAtualizado = event.detail || getUsuarioLocal();
      setUsuario(usuarioAtualizado);
      if (!temPermissao(usuarioAtualizado, 'configurar_horario_acesso')) {
        setAba(atual => atual === 'horarioAcesso' ? '' : atual);
      }
    };
    window.addEventListener('auth:usuario-atualizado', atualizarUsuario);
    return () => window.removeEventListener('auth:usuario-atualizado', atualizarUsuario);
  }, []);

  const [dados, setDados] = useState({
    operadoras: [],
    tiposVenda: [],
    servicos: [],
    links: [],
    regrasComissao: [],
    notificacoes: []
  });
  const [formSimples, setFormSimples] = useState(FORM_SIMPLES);
  const [linkForm, setLinkForm] = useState(LINK_VAZIO);
  const [regraComissaoForm, setRegraComissaoForm] = useState(REGRA_COMISSAO_VAZIA);
  const [editandoId, setEditandoId] = useState(null);
  const [itemParaExcluir, setItemParaExcluir] = useState(null);
  const [excluindoId, setExcluindoId] = useState(null);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [notificacaoSalvandoId, setNotificacaoSalvandoId] = useState(null);

  // Estado da aba "Clientes antigos" (upload de planilha).
  const [caArquivo, setCaArquivo] = useState(null);
  const [caPreview, setCaPreview] = useState(null);
  const [caMapeamento, setCaMapeamento] = useState(MAPEAMENTO_CLIENTES_ANTIGOS);
  const [caCarregandoPreview, setCaCarregandoPreview] = useState(false);
  const [caImportando, setCaImportando] = useState(false);
  const [caResultado, setCaResultado] = useState(null);
  const [caAbasSelecionadas, setCaAbasSelecionadas] = useState([]);

  const caColunasSelecionadas = useMemo(
    () => obterColunasClientesAntigos(caPreview, caAbasSelecionadas),
    [caPreview, caAbasSelecionadas]
  );

  const caCnpjSelecionadoValido = useMemo(() => (
    Boolean(caMapeamento.cnpj && encontrarColunaImportacao(caColunasSelecionadas, caMapeamento.cnpj))
  ), [caMapeamento.cnpj, caColunasSelecionadas]);

  async function caCarregarPreview(file) {
    setCaArquivo(file || null);
    setCaPreview(null);
    setCaResultado(null);
    setCaMapeamento(MAPEAMENTO_CLIENTES_ANTIGOS);
    setCaAbasSelecionadas([]);
    setErro('');
    setSucesso('');

    if (!file) return;

    setCaCarregandoPreview(true);
    try {
      const data = await previewPlanilhaClientesAntigos(file);
      setCaPreview(data);
      setCaAbasSelecionadas((data.abas || []).map(item => item.nome));
      setCaMapeamento({
        cnpj: data.sugestoes?.cnpj || '',
        razao_social: data.sugestoes?.razao_social || '',
        data_venda: data.sugestoes?.data_venda || '',
        operadora: data.sugestoes?.operadora || '',
        responsavel_nome: data.sugestoes?.responsavel_nome || '',
        telefone: data.sugestoes?.telefone || '',
        quantidade_chips: data.sugestoes?.quantidade_chips || ''
      });
    } catch (error) {
      setErro(error.message || 'Erro ao ler planilha.');
    } finally {
      setCaCarregandoPreview(false);
    }
  }

  async function caImportar() {
    if (!caArquivo || caImportando) return;

    if (caAbasSelecionadas.length === 0) {
      setErro('Selecione ao menos uma aba para importar.');
      return;
    }

    if (!caCnpjSelecionadoValido) {
      setErro('Selecione a coluna que contem o CNPJ nas abas marcadas.');
      return;
    }

    setCaImportando(true);
    setErro('');
    setSucesso('');
    setCaResultado(null);

    try {
      const data = await importarPlanilhaClientesAntigos(caArquivo, caMapeamento, caAbasSelecionadas);
      setCaResultado(data);
      setSucesso(`Importacao concluida: ${data.inseridos} novo(s), ${data.atualizados} atualizado(s), ${data.sem_cnpj || 0} sem CNPJ, ${data.invalidos || 0} invalido(s).`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar planilha.');
    } finally {
      setCaImportando(false);
    }
  }


  function caToggleTodasAbas(marcar) {
    const proximas = marcar ? (caPreview?.abas || []).map(item => item.nome) : [];
    setCaAbasSelecionadas(proximas);
    setCaMapeamento(prev => ajustarMapeamentoClientesAntigos(prev, obterColunasClientesAntigos(caPreview, proximas)));
  }

  function caToggleAba(nome) {
    const proximas = caAbasSelecionadas.includes(nome)
      ? caAbasSelecionadas.filter(item => item !== nome)
      : [...caAbasSelecionadas, nome];
    setCaAbasSelecionadas(proximas);
    setCaMapeamento(mapeamento => ajustarMapeamentoClientesAntigos(
      mapeamento,
      obterColunasClientesAntigos(caPreview, proximas)
    ));
  }

  useEffect(() => {
    if (!sucesso) return undefined;
    const timer = setTimeout(() => setSucesso(''), 4000);
    return () => clearTimeout(timer);
  }, [sucesso]);

  useEffect(() => {
    if (!erro) return undefined;
    const timer = setTimeout(() => setErro(''), 6000);
    return () => clearTimeout(timer);
  }, [erro]);

  /**
   * Carrega dados e atualiza o estado relacionado.
   */
  async function carregarDados() {
    setErro('');
    setCarregando(true);

    try {
      const [operadoras, tiposVenda, servicos, links, regrasComissao, notificacoes] = await Promise.all([
        permissoes.operadoras
          ? listarOperadorasAdmin()
          : permissoes.regrasComissao
            ? listarOperadoras()
            : Promise.resolve([]),
        permissoes.tiposVenda ? listarTiposVendaAdmin() : Promise.resolve([]),
        permissoes.servicos ? listarServicosAdmin() : Promise.resolve([]),
        permissoes.links ? listarLinksExternosAdmin() : Promise.resolve([]),
        permissoes.regrasComissao ? listarRegrasComissaoAdmin() : Promise.resolve([]),
        permissoes.notificacoes ? listarAparenciasNotificacaoAdmin() : Promise.resolve([])
      ]);

      setDados({ operadoras, tiposVenda, servicos, links, regrasComissao, notificacoes });
    } catch (error) {
      setErro(error.message || 'Erro ao carregar configurações.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    Promise.all([
      permissoes.operadoras
        ? listarOperadorasAdmin()
        : permissoes.regrasComissao ? listarOperadoras() : Promise.resolve([]),
      permissoes.tiposVenda ? listarTiposVendaAdmin() : Promise.resolve([]),
      permissoes.servicos ? listarServicosAdmin() : Promise.resolve([]),
      permissoes.links ? listarLinksExternosAdmin() : Promise.resolve([]),
      permissoes.regrasComissao ? listarRegrasComissaoAdmin() : Promise.resolve([]),
      permissoes.notificacoes ? listarAparenciasNotificacaoAdmin() : Promise.resolve([])
    ])
      .then(([operadoras, tiposVenda, servicos, links, regrasComissao, notificacoes]) => {
        if (ativo) setDados({ operadoras, tiposVenda, servicos, links, regrasComissao, notificacoes });
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar configurações.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  }, [
    permissoes.operadoras,
    permissoes.tiposVenda,
    permissoes.servicos,
    permissoes.links,
    permissoes.regrasComissao,
    permissoes.notificacoes
  ]);

  /**
   * Executa a acao de resetar forms mantendo o estado da tela consistente.
   */
  function resetarForms() {
    setFormSimples(FORM_SIMPLES);
    setLinkForm(LINK_VAZIO);
    setRegraComissaoForm(REGRA_COMISSAO_VAZIA);
    setEditandoId(null);
  }

  /**
   * Executa a acao de mudar aba mantendo o estado da tela consistente.
   */
  function mudarAba(id) {
    setAba(id);
    setItemParaExcluir(null);
    resetarForms();
  }

  /**
   * Executa a acao de editar item mantendo o estado da tela consistente.
   */
  function editarItem(item) {
    setEditandoId(item.id);

    if (aba === 'links') {
      setLinkForm({
        chave: item.chave || '',
        nome: item.nome || '',
        url: item.url || '',
        dot: item.dot || '',
        cor: item.cor || CORES_MARCADOR[item.dot] || '#0f766e',
        ativo: Boolean(item.ativo)
      });
      return;
    }

    if (aba === 'regrasComissao') {
      setRegraComissaoForm({
        operadora_id: item.operadora_id || '',
        valor_min: valorForm(item.valor_min),
        valor_max: valorForm(item.valor_max),
        valor_comissao: valorForm(item.valor_comissao),
        valor_comissao_base: valorForm(item.valor_comissao_base ?? item.valor_comissao),
        valor_comissao_base_propria: valorForm(item.valor_comissao_base_propria ?? item.valor_comissao_base ?? item.valor_comissao),
        prioridade_base_dupla: item.prioridade_base_dupla || 'base_propria',
        ativo: Boolean(item.ativo)
      });
      return;
    }

    setFormSimples({
      nome: item.nome || '',
      ativo: Boolean(item.ativo)
    });
  }

  /**
   * Renderiza render form header.
   */
  function renderFormHeader(tituloAdicionar, tituloEditar, subtitulo) {
    return (
      <div className="config-form-header">
        <div>
          <span className="config-kicker">{editandoId ? 'Editando cadastro' : 'Novo cadastro'}</span>
          <h2>{editandoId ? tituloEditar : tituloAdicionar}</h2>
          <p>{subtitulo}</p>
        </div>
        {editandoId && (
          <button className="btn btn-ghost" type="button" onClick={resetarForms}>
            <I.Close size={14} /> Cancelar edição
          </button>
        )}
      </div>
    );
  }

  /**
   * Renderiza form actions no fluxo da tela.
   */
  function renderFormActions(salvandoLabel = 'Salvar alterações', adicionandoLabel = 'Adicionar') {
    return (
      <div className="config-form-actions">
        <button className="btn btn-primary" type="submit">
          {editandoId ? <I.Check size={14} /> : <I.Plus size={14} />}
          {editandoId ? salvandoLabel : adicionandoLabel}
        </button>
        {editandoId && (
          <button className="btn" type="button" onClick={resetarForms}>
            Limpar
          </button>
        )}
      </div>
    );
  }

  /**
   * Salva simples com os dados informados.
   */
  async function salvarSimples(event) {
    event.preventDefault();
    setErro('');
    const editando = Boolean(editandoId);

    const mapa = {
      operadoras: [criarOperadora, atualizarOperadora],
      tiposVenda: [criarTipoVenda, atualizarTipoVenda],
      servicos: [criarServico, atualizarServico]
    };
    const [criar, atualizar] = mapa[aba];
    const payload = { ...formSimples };

    try {
      if (editandoId) {
        await atualizar(editandoId, payload);
      } else {
        await criar(payload);
      }

      resetarForms();
      await carregarDados();
      setSucesso(editando ? 'Configuração atualizada com sucesso.' : 'Configuração adicionada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar configuração.');
    }
  }

  /**
   * Salva link com os dados informados.
   */
  async function salvarLink(event) {
    event.preventDefault();
    setErro('');
    const editando = Boolean(editandoId);
    const payload = { ...linkForm };

    try {
      if (editandoId) {
        await atualizarLinkExterno(editandoId, payload);
      } else {
        await criarLinkExterno(payload);
      }

      resetarForms();
      await carregarDados();
      setSucesso(editando ? 'Link atualizado com sucesso.' : 'Link adicionado com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar link.');
    }
  }

  /**
   * Salva regra comissao com os dados informados.
   */
  async function salvarRegraComissao(event) {
    event.preventDefault();
    setErro('');
    const editando = Boolean(editandoId);
    const payload = {
      ...regraComissaoForm,
      operadora_id: regraComissaoForm.operadora_id || null,
      valor_min: moedaParaNumero(regraComissaoForm.valor_min),
      valor_max: moedaParaNumero(regraComissaoForm.valor_max),
      valor_comissao: moedaParaNumero(regraComissaoForm.valor_comissao),
      valor_comissao_base: moedaParaNumero(regraComissaoForm.valor_comissao_base),
      valor_comissao_base_propria: moedaParaNumero(regraComissaoForm.valor_comissao_base_propria),
      prioridade_base_dupla: regraComissaoForm.prioridade_base_dupla || 'base_propria'
    };

    try {
      if (editandoId) {
        await atualizarRegraComissao(editandoId, payload);
      } else {
        await criarRegraComissao(payload);
      }

      resetarForms();
      await carregarDados();
      setSucesso(editando ? 'Regra atualizada com sucesso.' : 'Regra adicionada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar regra de comissão.');
    }
  }

  /**
   * Executa a acao de solicitar exclusao mantendo o estado da tela consistente.
   */
  function solicitarExclusao(item) {
    setItemParaExcluir(item);
  }

  /**
   * Executa a acao de confirmar exclusao mantendo o estado da tela consistente.
   */
  async function confirmarExclusao() {
    if (!itemParaExcluir) return;

    const mapa = {
      operadoras: excluirOperadora,
      tiposVenda: excluirTipoVenda,
      servicos: excluirServico,
      links: excluirLinkExterno,
      regrasComissao: excluirRegraComissao
    };

    try {
      setExcluindoId(itemParaExcluir.id);
      await mapa[aba](itemParaExcluir.id);
      if (editandoId === itemParaExcluir.id) {
        resetarForms();
      }
      setItemParaExcluir(null);
      await carregarDados();
      setSucesso('Item excluído com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir item.');
    } finally {
      setExcluindoId(null);
    }
  }

  /**
   * Renderiza links no fluxo da tela.
   */
  function renderLinks(listaAtual) {
    return (
      <>
        <form className="config-form" onSubmit={salvarLink}>
          {renderFormHeader('Adicionar link externo', 'Editar link externo', 'Defina os atalhos exibidos no topo do sistema.')}
          <div className="config-form-grid config-form-grid--links">
          <div className="form-field">
            <label>Chave</label>
            <input value={linkForm.chave} onChange={e => setLinkForm({ ...linkForm, chave: e.target.value })} required />
          </div>
          <div className="form-field">
            <label>Nome</label>
            <input value={linkForm.nome} onChange={e => setLinkForm({ ...linkForm, nome: e.target.value })} required />
          </div>
          <div className="form-field">
            <label>URL</label>
            <input value={linkForm.url} onChange={e => setLinkForm({ ...linkForm, url: e.target.value })} required />
          </div>
          <div className="form-field">
            <label>Marcador</label>
            <input value={linkForm.dot} onChange={e => setLinkForm({ ...linkForm, dot: e.target.value })} placeholder="vivo, tim, claro, gov, abr" />
          </div>
          <div className="form-field">
            <label>Cor do marcador</label>
            <input type="color" value={linkForm.cor} onChange={e => setLinkForm({ ...linkForm, cor: e.target.value })} aria-label="Cor do marcador" />
          </div>
          <label className="config-toggle">
            <input type="checkbox" checked={linkForm.ativo} onChange={e => setLinkForm({ ...linkForm, ativo: e.target.checked })} />
            Ativo
          </label>
          </div>
          {renderFormActions('Salvar link', 'Adicionar link')}
        </form>

        <div className="config-list-header">
          <div>
            <h3>Links cadastrados</h3>
            <p>{listaAtual.length} item(ns) encontrado(s)</p>
          </div>
        </div>

        <div className="list-table config-table">
          <table>
            <thead><tr><th>Nome</th><th>URL</th><th>Marcador</th><th>Cor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {listaAtual.map(item => (
                <tr key={item.id}>
                  <td data-label="Nome" className="m-primary">
                    {item.nome}
                    <details className="mobile-row-drawer">
                      <summary>Ver detalhes</summary>
                      <dl>
                        <dt>URL</dt>
                        <dd>{item.url}</dd>
                        <dt>Marcador</dt>
                        <dd>{item.dot || '-'}</dd>
                      </dl>
                    </details>
                  </td>
                  <td data-label="URL" data-mobile-hidden="true" className="muted">{item.url}</td>
                  <td data-label="Marcador" data-mobile-hidden="true">{item.dot}</td>
                  <td data-label="Cor" data-mobile-hidden="true">
                    <span className="config-link-color" style={{ backgroundColor: item.cor || CORES_MARCADOR[item.dot] || undefined }} title={item.cor || 'Cor definida pelo marcador'} />
                  </td>
                  <td data-label="Status" className="m-meta"><StatusPill ativo={item.ativo} /></td>
                  <td data-label="Acoes" className="row-actions m-actions">
                    <button type="button" className="btn btn-sm config-edit" onClick={() => editarItem(item)}><I.Edit size={13} /> Editar</button>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger-icon config-danger" onClick={() => solicitarExclusao(item)}><I.Trash size={13} /> Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /**
   * Renderiza regras comissao no fluxo da tela.
   */
  function renderRegrasComissao(listaAtual) {
    return (
      <>
        <form className="config-form" onSubmit={salvarRegraComissao}>
          {renderFormHeader('Adicionar regra de comissão', 'Editar regra de comissão', 'Organize faixas de valor e comissão para vendas novas e clientes da base.')}
          <div className="config-form-grid config-form-grid--commission">
          <div className="form-field">
            <label>Operadora</label>
            <select
              value={regraComissaoForm.operadora_id}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, operadora_id: e.target.value })}
            >
              <option value="">Todas</option>
              {dados.operadoras.map(operadora => (
                <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Valor inicial</label>
            <input
              type="text"
              inputMode="numeric"
              value={regraComissaoForm.valor_min}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, valor_min: mascararBRL(e.target.value) })}
              placeholder="R$ 29,99"
              required
            />
          </div>
          <div className="form-field">
            <label>Valor final</label>
            <input
              type="text"
              inputMode="numeric"
              value={regraComissaoForm.valor_max}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, valor_max: mascararBRL(e.target.value) })}
              placeholder="R$ 59,99"
              required
            />
          </div>
          <div className="form-field">
            <label>Comissao integral</label>
            <input
              type="text"
              inputMode="numeric"
              value={regraComissaoForm.valor_comissao}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, valor_comissao: mascararBRL(e.target.value) })}
              placeholder="R$ 10,00"
              required
            />
          </div>
          <div className="form-field">
            <label>Comissao base da operadora</label>
            <input
              type="text"
              inputMode="numeric"
              value={regraComissaoForm.valor_comissao_base}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, valor_comissao_base: mascararBRL(e.target.value) })}
              placeholder="R$ 5,00"
              required
            />
          </div>
          <div className="form-field">
            <label>Comissao nossa base</label>
            <input
              type="text"
              inputMode="numeric"
              value={regraComissaoForm.valor_comissao_base_propria}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, valor_comissao_base_propria: mascararBRL(e.target.value) })}
              placeholder="R$ 5,00"
              required
            />
          </div>
          <div className="form-field">
            <label>Se estiver nas duas bases</label>
            <select
              value={regraComissaoForm.prioridade_base_dupla}
              onChange={e => setRegraComissaoForm({ ...regraComissaoForm, prioridade_base_dupla: e.target.value })}
            >
              {PRIORIDADES_BASE_DUPLA.map(item => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <label className="config-toggle">
            <input type="checkbox" checked={regraComissaoForm.ativo} onChange={e => setRegraComissaoForm({ ...regraComissaoForm, ativo: e.target.checked })} />
            Ativo
          </label>
          </div>
          {renderFormActions('Salvar regra', 'Adicionar regra')}
        </form>

        <div className="config-list-header">
          <div>
            <h3>Regras cadastradas</h3>
            <p>{listaAtual.length} faixa(s) encontrada(s)</p>
          </div>
        </div>

        <div className="list-table config-table">
          <table>
            <thead><tr><th>Operadora</th><th>Faixa</th><th>Integral</th><th>Base operadora</th><th>Nossa base</th><th>Prioridade</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {listaAtual.map(item => (
                <tr key={item.id}>
                  <td data-label="Operadora" data-mobile-hidden="true">{item.operadora_nome || 'Todas'}</td>
                  <td data-label="Faixa" className="m-primary">
                    {fmtMoeda(item.valor_min)} até {fmtMoeda(item.valor_max)}
                    <details className="mobile-row-drawer">
                      <summary>Ver detalhes</summary>
                      <dl>
                        <dt>Operadora</dt>
                        <dd>{item.operadora_nome || 'Todas'}</dd>
                        <dt>Integral</dt>
                        <dd>{fmtMoeda(item.valor_comissao)}</dd>
                        <dt>Base da operadora</dt>
                        <dd>{fmtMoeda(item.valor_comissao_base ?? item.valor_comissao)}</dd>
                        <dt>Nossa base</dt>
                        <dd>{fmtMoeda(item.valor_comissao_base_propria ?? item.valor_comissao_base ?? item.valor_comissao)}</dd>
                        <dt>Se estiver nas duas bases</dt>
                        <dd>{labelPrioridadeBaseDupla(item.prioridade_base_dupla)}</dd>
                      </dl>
                    </details>
                  </td>
                  <td data-label="Integral" data-mobile-hidden="true">{fmtMoeda(item.valor_comissao)}</td>
                  <td data-label="Base operadora" data-mobile-hidden="true">{fmtMoeda(item.valor_comissao_base ?? item.valor_comissao)}</td>
                  <td data-label="Nossa base" data-mobile-hidden="true">{fmtMoeda(item.valor_comissao_base_propria ?? item.valor_comissao_base ?? item.valor_comissao)}</td>
                  <td data-label="Prioridade" data-mobile-hidden="true">{labelPrioridadeBaseDupla(item.prioridade_base_dupla)}</td>
                  <td data-label="Status" className="m-meta"><StatusPill ativo={item.ativo} /></td>
                  <td data-label="Acoes" className="row-actions m-actions">
                    <button type="button" className="btn btn-sm config-edit" onClick={() => editarItem(item)}><I.Edit size={13} /> Editar</button>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger-icon config-danger" onClick={() => solicitarExclusao(item)}><I.Trash size={13} /> Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /**
   * Renderiza simples no fluxo da tela.
   */
  function renderSimples(listaAtual) {
    const labelAtual = abas.find(item => item.id === aba)?.label || 'item';

    return (
      <>
        <form className="config-form" onSubmit={salvarSimples}>
          {renderFormHeader(`Adicionar ${labelAtual.toLowerCase()}`, `Editar ${labelAtual.toLowerCase()}`, 'Cadastre o nome e controle se o item fica disponível no sistema.')}
          <div className="config-form-grid config-form-grid--simple">
          <div className="form-field">
            <label>Nome</label>
            <input value={formSimples.nome} onChange={e => setFormSimples({ ...formSimples, nome: e.target.value })} required />
          </div>
          <label className="config-toggle">
            <input type="checkbox" checked={formSimples.ativo} onChange={e => setFormSimples({ ...formSimples, ativo: e.target.checked })} />
            Ativo
          </label>
          </div>
          {renderFormActions('Salvar alterações', 'Adicionar')}
        </form>

        <div className="config-list-header">
          <div>
            <h3>{labelAtual} cadastrados</h3>
            <p>{listaAtual.length} item(ns) encontrado(s)</p>
          </div>
        </div>

        <div className="list-table config-table">
          <table>
            <thead><tr><th>Nome</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {listaAtual.map(item => (
                <tr key={item.id}>
                  <td data-label="Nome" className="m-primary">
                    {item.nome}
                  </td>
                  <td data-label="Status" className="m-meta"><StatusPill ativo={item.ativo} /></td>
                  <td data-label="Acoes" className="row-actions m-actions">
                    <button type="button" className="btn btn-sm config-edit" onClick={() => editarItem(item)}><I.Edit size={13} /> Editar</button>
                    <button type="button" className="btn btn-sm btn-ghost btn-danger-icon config-danger" onClick={() => solicitarExclusao(item)}><I.Trash size={13} /> Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  async function salvarCorNotificacao(item, cor) {
    setNotificacaoSalvandoId(item.id);
    try { const atualizado = await atualizarAparenciaNotificacao(item.id, { cor }); setDados(prev => ({ ...prev, notificacoes: prev.notificacoes.map(atual => atual.id === item.id ? atualizado : atual) })); window.dispatchEvent(new CustomEvent('pos-venda:notificacao-aparencias-atualizar')); setSucesso('Cor da notificação atualizada com sucesso.'); } catch (error) { setErro(error.message || 'Erro ao atualizar a cor da notificação.'); } finally { setNotificacaoSalvandoId(null); }
  }

  function renderNotificacoes(listaAtual) {
    return <div className="list-table config-table"><table><thead><tr><th>Tipo de notificação</th><th>Cor</th><th></th></tr></thead><tbody>{listaAtual.map(item => <tr key={item.id}><td className="m-primary">{item.nome}</td><td><input type="color" value={item.cor} onChange={event => salvarCorNotificacao(item, event.target.value)} disabled={notificacaoSalvandoId === item.id} /></td><td className="muted">{item.cor}</td></tr>)}</tbody></table></div>;
  }
  function renderClientesAntigos() {
    const colunas = caColunasSelecionadas;
    const abasPlanilha = caPreview?.abas || [];
    const totalLinhasSelecionadas = abasPlanilha
      .filter(item => caAbasSelecionadas.includes(item.nome))
      .reduce((soma, item) => soma + Number(item.linhas || 0), 0);
    const todasAbasSelecionadas = abasPlanilha.length > 0 && caAbasSelecionadas.length === abasPlanilha.length;
    const campos = [
      { chave: 'cnpj', label: 'CNPJ', obrigatorio: true },
      { chave: 'razao_social', label: 'Razão social', obrigatorio: false },
      { chave: 'data_venda', label: 'Data da venda', obrigatorio: false },
      { chave: 'operadora', label: 'Operadora', obrigatorio: false },
      { chave: 'responsavel_nome', label: 'Nome do responsavel', obrigatorio: false },
      { chave: 'telefone', label: 'Telefone', obrigatorio: false },
      { chave: 'quantidade_chips', label: 'Quantidade de chips', obrigatorio: false }
    ];

    return (
      <div className="clientes-antigos-config">
        <div className="panel-header">
          <div>
            <h2>Base de clientes antigos</h2>
            <p>Envie uma planilha .xlsx com vendas antigas (fora da fidelidade). Mapeie as colunas e importe. Cada linha da planilha vira uma venda antiga; CNPJs repetidos sao mantidos como vendas separadas.</p>
          </div>
        </div>

        <div className="cliente-import-controls">
          <div className="form-field">
            <label>Arquivo .xlsx</label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={event => caCarregarPreview(event.target.files?.[0])}
              disabled={caCarregandoPreview || caImportando}
            />
          </div>
        </div>

        {caCarregandoPreview && <div className="muted">Lendo planilha...</div>}

        {caPreview && (
          <>
            <div className="cliente-import-summary">
              <span>Arquivo: <strong>{caPreview.arquivo}</strong></span>
              <span>Abas: <strong>{caPreview.total_abas || 1}</strong></span>
              <span>Linhas selecionadas: <strong>{totalLinhasSelecionadas}</strong></span>
              <span>Colunas: <strong>{colunas.length}</strong></span>
            </div>

            {abasPlanilha.length > 0 && (
              <div className="clientes-antigos-abas">
                <div className="clientes-antigos-abas-header">
                  <div>
                    <strong>Abas para importar</strong>
                    <p>Escolha uma por uma ou marque todas de uma vez. O mesmo mapeamento sera usado nas abas selecionadas.</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => caToggleTodasAbas(!todasAbasSelecionadas)}
                    disabled={caImportando}
                  >
                    {todasAbasSelecionadas ? 'Desmarcar todas' : 'Selecionar todas'}
                  </button>
                </div>
                <div className="clientes-antigos-abas-lista">
                  {abasPlanilha.map(item => (
                    <label key={item.nome} className="clientes-antigos-aba-option">
                      <input
                        type="checkbox"
                        checked={caAbasSelecionadas.includes(item.nome)}
                        onChange={() => caToggleAba(item.nome)}
                        disabled={caImportando}
                      />
                      <span>{item.nome}</span>
                      <small>{item.linhas} linha(s)</small>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="cliente-import-mapeamento">
              {campos.map(campo => (
                <div className="form-field" key={campo.chave}>
                  <label>{campo.label}{campo.obrigatorio ? ' *' : ''}</label>
                  <input
                    type="text"
                    list={`clientes-antigos-colunas-${campo.chave}`}
                    value={caMapeamento[campo.chave]}
                    onChange={event => setCaMapeamento(prev => ({ ...prev, [campo.chave]: event.target.value }))}
                    placeholder={campo.chave === 'operadora' ? 'Ex.: operadora ou Claro' : (campo.obrigatorio ? 'Ex.: cnpj' : 'Ex.: data ativacao')}
                    disabled={caImportando}
                  />
                  <datalist id={`clientes-antigos-colunas-${campo.chave}`}>
                    {colunas.map(coluna => (
                      <option key={`${campo.chave}:${coluna.nome}:${coluna.index}`} value={coluna.nome} />
                    ))}
                  </datalist>
                  {caMapeamento[campo.chave] && encontrarColunaImportacao(colunas, caMapeamento[campo.chave]) && (
                    <small>Encontrada: {encontrarColunaImportacao(colunas, caMapeamento[campo.chave])?.nome}</small>
                  )}
                </div>
              ))}
            </div>

            {erro && (
              <div className="alert-error clientes-antigos-import-error">{erro}</div>
            )}

            <div className="config-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={caImportar}
                disabled={!caCnpjSelecionadoValido || caImportando || caAbasSelecionadas.length === 0}
              >
                <I.Upload size={14} />
                {caImportando ? 'Importando...' : 'Importar base'}
              </button>
            </div>
          </>
        )}

        {caResultado && (
          <>
            <div className="cliente-import-summary">
              <span>Total de linhas: <strong>{caResultado.total}</strong></span>
              <span>Vendas validas: <strong>{caResultado.unicos ?? ((caResultado.inseridos || 0) + (caResultado.atualizados || 0))}</strong></span>
              <span>Novos: <strong>{caResultado.inseridos}</strong></span>
              <span>Atualizados: <strong>{caResultado.atualizados}</strong></span>
              <span>Importados sem CNPJ: <strong>{caResultado.sem_cnpj || 0}</strong></span>
              <span>Invalidos ignorados: <strong>{caResultado.invalidos ?? caResultado.ignorados}</strong></span>
            </div>

            {caResultado.invalidos_detalhes?.length > 0 && (
              <div className="cliente-import-invalidos">
                <h4>Linhas ignoradas</h4>
                {caResultado.invalidos > caResultado.invalidos_detalhes.length && (
                  <p className="cliente-import-invalidos-aviso">
                    Mostrando as primeiras {caResultado.invalidos_detalhes.length} de {caResultado.invalidos} linhas ignoradas.
                  </p>
                )}
                <div className="cliente-import-invalidos-tabela">
                  <table>
                    <thead>
                      <tr>
                        <th>Aba</th>
                        <th>Linha</th>
                        <th>Valor lido</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caResultado.invalidos_detalhes.map(item => (
                        <tr key={`${item.aba}:${item.linha}`}>
                          <td>{item.aba}</td>
                          <td>{item.linha}</td>
                          <td>{item.valor || <em>(célula vazia)</em>}</td>
                          <td>{item.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const listaAtual = dados[aba] || [];
  const abaAtual = abas.find(item => item.id === aba);

  return (
    <LayoutPrivado>
      <div className="users-page configuracoes-page">
        <ConfirmarExclusaoConfigModal
          item={itemParaExcluir}
          tipo={abaAtual?.label || 'Configuração'}
          excluindo={excluindoId === itemParaExcluir?.id}
          onClose={() => setItemParaExcluir(null)}
          onConfirm={confirmarExclusao}
        />

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erro}</div>}

        {abas.length === 0 ? (
          <div className="empty">Você não tem permissão para gerenciar configurações.</div>
        ) : (
          <div className="panel config-panel">
            <div className="panel-header config-panel-header">
              <div className="config-tabs">
                {abas.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-chip ${aba === item.id ? 'active' : ''}`}
                    onClick={() => mudarAba(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {!['clientesAntigos', 'horarioAcesso'].includes(aba) && (
                <div className="config-panel-summary">
                  <strong>{abaAtual?.label}</strong>
                  <span>{listaAtual.length} cadastrado(s)</span>
                </div>
              )}
            </div>

            <div className="panel-body">
              {aba === 'clientesAntigos' ? (
                renderClientesAntigos()
              ) : aba === 'horarioAcesso' ? (
                <HorarioAcessoConfig />
              ) : carregando ? (
                <div className="muted">Carregando...</div>
              ) : aba === 'links' ? (
                renderLinks(listaAtual)
              ) : aba === 'regrasComissao' ? (
                renderRegrasComissao(listaAtual)
              ) : aba === 'notificacoes' ? (
                renderNotificacoes(listaAtual)
              ) : (
                renderSimples(listaAtual)
              )}
            </div>
          </div>
        )}
      </div>
    </LayoutPrivado>
  );
}

export default ConfiguracoesPage;
