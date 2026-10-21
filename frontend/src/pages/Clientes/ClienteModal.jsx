import { useNavigationState } from '../../utils/useNavigationState';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import NotasEntidadeTab from '../../components/NotasEntidadeTab';
import * as I from '../../components/Icons';
import CnpjSugestoes from '../../components/CnpjSugestoes';
import { formatarMensagemResumoCnpj } from '../../components/cnpjSugestoes.utils';
import { consultarCnpj, sanitizarCnpj, validarDigitosCnpj, formatarCpf, sanitizarCpf, validarDigitosCpf } from '../../services/cnpj.service';
import { criarCliente, atualizarCliente, atualizarConsultorasCliente, verificarDocumentoCliente } from '../../services/cliente.service';
import { criarNotaEntidade } from '../../services/nota.service';
import { listarVendas } from '../../services/venda.service';
import { useFormDraft } from '../../utils/useFormDraft';
import { formatarNomeServico } from '../../utils/servicos';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import './Clientes.css';


const FORM_INICIAL = {
  nome: '',
  razao_social: '',
  cnpj: '',
  responsavel_tipo: 'rl',
  responsavel_nome: '',
  email: '',
  whatsapp: '',
  fixo: '',
  telefone_receita: '',
  telefone_receita_contatavel: false,
  telefone_google: '',
  telefone_google_contatavel: false,
  fidelidade_fim: '',
  operadora_atual_id: '',
  valor_pago: '',
  quantidade_chips: '',
  operadoras_atuais: []
};

const CNPJ_SUGESTOES_CLIENTE = {
  nomeFantasia: { campo: 'nome', label: 'Nome fantasia' },
  razaoSocial: { campo: 'razao_social', label: 'Razão social' },
  email: { campo: 'email', label: 'E-mail' },
  telefone: { campo: 'telefone', label: 'Telefone' },
};

const CNPJ_LABELS_CLIENTE = Object.fromEntries(
  Object.entries(CNPJ_SUGESTOES_CLIENTE).map(([campo, config]) => [campo, config.label])
);

/**
 * Renderiza normalizar data input.
 */
function normalizarDataInput(valor) {
  if (!valor) return '';

  const texto = String(valor).slice(0, 10);
  return texto === '1899-11-30' ? '' : texto;
}

/**
 * Processa apenas digitos conforme as regras do dominio.
 */
function apenasDigitos(valor, limite) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return limite ? digitos.slice(0, limite) : digitos;
}

/**
 * Formata cnpj para exibicao ou envio.
 */
function formatarCnpj(valor) {
  const digitos = apenasDigitos(valor, 14);

  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  if (digitos.length <= 8) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  if (digitos.length <= 12) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

/**
 * Obtem nome cliente documento a partir dos dados informados.
 */
function obterNomeClienteDocumento(cliente) {
  return cliente?.razao_social || cliente?.nome || `#${cliente?.id}`;
}

/**
 * Formata mensagem documento duplicado para exibicao ou envio.
 */
function formatarMensagemDocumentoDuplicado(cliente) {
  if (!cliente) return '';
  const sufixo = cliente.excluido
    ? ' O cliente esta na lixeira; restaure-o para usar este documento.'
    : '';
  return `Ja existe um cliente cadastrado com este documento (${obterNomeClienteDocumento(cliente)}).${sufixo}`;
}

/**
 * Formata telefone com ddd para exibicao ou envio.
 */
function formatarTelefoneComDdd(valor, celular = false) {
  const digitos = apenasDigitos(valor, celular ? 11 : 10);

  if (digitos.length <= 2) {
    return digitos ? `(${digitos}` : '';
  }

  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);

  if (celular) {
    if (numero.length <= 5) return `(${ddd}) ${numero}`;
    return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  }

  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
}

/**
 * Processa juntar telefone conforme as regras do dominio.
 */
function juntarTelefone(ddd, numero, celular = false) {
  return formatarTelefoneComDdd(`${ddd || ''}${numero || ''}`, celular);
}
function formatarTelefoneOrigem(valor) {
  const digitos = apenasDigitos(valor, 11);
  return formatarTelefoneComDdd(digitos, digitos.length > 10);
}

/**
 * Processa separar telefone conforme as regras do dominio.
 */
function separarTelefone(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (!digitos) {
    return { ddd: null, numero: null };
  }

  return {
    ddd: digitos.slice(0, 2) || null,
    numero: digitos.slice(2) || null
  };
}

/**
 * Renderiza parse valor input.
 */
function parseValorInput(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  const numero = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Formata input moeda br para exibicao ou envio.
 */
function formatarInputMoedaBR(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (!digitos) return '';

  return (Number(digitos) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Renderiza formatar valor pago input.
 */
function formatarValorPagoInput(valor) {
  if (valor === undefined || valor === null || valor === '') return '';

  return Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Processa nova operadora cliente conforme as regras do dominio.
 */
function novaOperadoraCliente(dados = {}) {
  return {
    operadora_id: dados.operadora_id ? String(dados.operadora_id) : '',
    quantidade_chips: dados.quantidade_chips ?? '',
    valor_pago: formatarValorPagoInput(dados.valor_pago),
    fidelidade_fim: normalizarDataInput(dados.fidelidade_fim)
  };
}

/**
 * Normaliza operadoras cliente form para uso interno consistente.
 */
function normalizarOperadorasClienteForm(cliente) {
  const operadorasCliente = cliente?.operadoras_atuais || cliente?.operadorasAtuais || [];
  if (Array.isArray(operadorasCliente) && operadorasCliente.length > 0) {
    return operadorasCliente.map(novaOperadoraCliente);
  }

  if (cliente?.operadora_atual_id || cliente?.quantidade_chips || cliente?.valor_pago || cliente?.fidelidade_fim) {
    return [novaOperadoraCliente({
      operadora_id: cliente.operadora_atual_id,
      quantidade_chips: cliente.quantidade_chips,
      valor_pago: cliente.valor_pago,
      fidelidade_fim: cliente.fidelidade_fim
    })];
  }

  return [];
}

/**
 * Monta payload cliente a partir dos dados informados.
 */
function montarPayloadCliente(form) {
  const whatsapp = separarTelefone(form.whatsapp);
  const fixo = separarTelefone(form.fixo);
  const operadorasAtuais = (form.operadoras_atuais || [])
    .filter(item => item.operadora_id)
    .map(item => ({
      operadora_id: Number(item.operadora_id),
      quantidade_chips: item.quantidade_chips !== '' ? Number(item.quantidade_chips) : null,
      valor_pago: parseValorInput(item.valor_pago),
      fidelidade_fim: item.fidelidade_fim || null
    }));

  return {
    ...form,
    cnpj: sanitizarCnpj(form.cnpj).length === 11 ? formatarCpf(form.cnpj) : formatarCnpj(form.cnpj),
    whatsapp_ddd: whatsapp.ddd,
    whatsapp_numero: whatsapp.numero,
    fixo_ddd: fixo.ddd,
    fixo_numero: fixo.numero,
    telefone_receita: apenasDigitos(form.telefone_receita, 11) || null,
    telefone_receita_contatavel: Boolean(form.telefone_receita_contatavel),
    telefone_google: apenasDigitos(form.telefone_google, 11) || null,
    telefone_google_contatavel: Boolean(form.telefone_google_contatavel),
    operadoras_atuais: operadorasAtuais,
    fidelidade_fim: operadorasAtuais[0]?.fidelidade_fim || null,
    operadora_atual_id: operadorasAtuais[0]?.operadora_id || null,
    valor_pago: operadorasAtuais.reduce((total, item) => total + Number(item.valor_pago || 0), 0) || null,
    quantidade_chips: operadorasAtuais.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0) || null
  };
}

/**
 * Normaliza cliente form para uso interno consistente.
 */
function normalizarClienteForm(cliente) {
  if (!cliente) return FORM_INICIAL;

  return {
    nome: cliente.nome || '',
    razao_social: cliente.razao_social || '',
    cnpj: sanitizarCnpj(cliente.cnpj).length === 11 ? formatarCpf(cliente.cnpj) : formatarCnpj(cliente.cnpj),
    responsavel_tipo: cliente.responsavel_tipo || 'rl',
    responsavel_nome: cliente.responsavel_nome || '',
    email: cliente.email || '',
    whatsapp: juntarTelefone(cliente.whatsapp_ddd, cliente.whatsapp_numero, true),
    fixo: juntarTelefone(cliente.fixo_ddd, cliente.fixo_numero),
    telefone_receita: formatarTelefoneOrigem(cliente.telefone_receita),
    telefone_receita_contatavel: Boolean(cliente.telefone_receita_contatavel),
    telefone_google: formatarTelefoneOrigem(cliente.telefone_google),
    telefone_google_contatavel: Boolean(cliente.telefone_google_contatavel),
    fidelidade_fim: normalizarDataInput(cliente.fidelidade_fim),
    operadora_atual_id: cliente.operadora_atual_id || '',
    valor_pago: formatarValorPagoInput(cliente.valor_pago),
    quantidade_chips: cliente.quantidade_chips ?? '',
    operadoras_atuais: normalizarOperadorasClienteForm(cliente)
  };
}

/**
 * Formata data venda para exibicao ou envio.
 */
function formatarDataVenda(valor) {
  if (!valor) return '-';

  const texto = String(valor).slice(0, 10);
  const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (partes) return `${partes[3]}/${partes[2]}/${partes[1]}`;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';

  return data.toLocaleDateString('pt-BR');
}

/**
 * Formata moeda para exibicao ou envio.
 */
function formatarMoeda(valor) {
  if (valor === undefined || valor === null || valor === '') return '-';

  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Obtem timestamp venda a partir dos dados informados.
 */
function obterTimestampVenda(venda) {
  const valor = venda.data_venda || venda.criado_em || venda.created_at;
  if (!valor) return 0;

  const texto = String(valor);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(texto.slice(0, 10))
    ? new Date(`${texto.slice(0, 10)}T00:00:00`)
    : new Date(valor);

  return Number.isNaN(data.getTime()) ? 0 : data.getTime();
}

/**
 * Processa ordenar vendas recentes conforme as regras do dominio.
 */
function ordenarVendasRecentes(vendas) {
  return [...(vendas || [])].sort((a, b) => (
    obterTimestampVenda(b) - obterTimestampVenda(a) || Number(b.id || 0) - Number(a.id || 0)
  ));
}

/**
 * Obtem titulo venda a partir dos dados informados.
 */
function obterTituloVenda(venda) {
  return formatarNomeServico(venda.servico?.nome) || venda.produto_fechado || venda.tipoVenda?.nome || `Venda #${venda.id}`;
}

/**
 * Obtem responsaveis venda a partir dos dados informados.
 */
function obterResponsaveisVenda(venda) {
  const nomes = Array.isArray(venda.vendedoras)
    ? venda.vendedoras.map(item => item?.nome).filter(Boolean)
    : [];

  if (nomes.length > 0) return nomes.join(', ');
  return venda.vendedora?.nome || venda.criador?.nome || '-';
}

/**
 * Renderiza cliente modal.
 */
function ClienteModal({
  cliente,
  operadoras,
  onClose,
  onSave,
  onTabChange,
  initialTab = 'cliente',
  initialDraft = null,
  onDraftChange,
  notesOnly = false,
  onOpenVenda,
  entidade = 'cliente',
  draftKey: draftKeyProp,
  criarFn = criarCliente,
  atualizarFn = atualizarCliente,
  verificarDocumentoFn = verificarDocumentoCliente,
  podeGerenciarConsultoras = false,
  consultorasDisponiveis = [],
  somenteConsultoras = false
}) {
  const editando = Boolean(cliente);
  const isLead = entidade === 'lead';
  const draftKey = draftKeyProp || (isLead ? 'lead_novo' : 'cliente_novo');
  const entidadeLabel = isLead ? 'lead' : 'cliente';
  const entidadeLabelCapitalizada = isLead ? 'Lead' : 'Cliente';
  const tipoNotas = isLead ? 'lead' : 'cliente';
  const podeMostrarNotas = true;

  const [form, setForm] = useState(() => {
    const base = normalizarClienteForm(cliente);
    if (editando) {
      return base;
    }

    // Para novo cliente, tenta carregar rascunho salvo, depois initialDraft, depois formulário vazio
    let savedDraft = null;
    try {
      const draft = localStorage.getItem(`form_draft_${draftKey}`);
      savedDraft = draft ? JSON.parse(draft) : null;
    } catch {
      // Ignora erros ao carregar do localStorage
    }

    return { ...base, ...(savedDraft || initialDraft || {}) };
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [cnpjStatus, setCnpjStatus] = useState({ tipo: '', mensagem: '' });
  const [documentoDuplicado, setDocumentoDuplicado] = useState(null);
  const [documentoStatus, setDocumentoStatus] = useState({ tipo: '', mensagem: '' });
  const [verificandoDocumento, setVerificandoDocumento] = useState(false);
  const [cnpjDados, setCnpjDados] = useState(null);
  const [cnpjSugestoes, setCnpjSugestoes] = useState({});
  const [tipoBusca, setTipoBusca] = useState(() => sanitizarCnpj(form.cnpj).length === 11 ? 'cpf' : 'cnpj');
  const [abaAtiva, persistirAba] = useNavigationState(cliente?.id ? `cliente-modal:${window.location.pathname}:${entidade}:${cliente.id}` : null, notesOnly ? 'notas' : initialTab, {
    allowed: notesOnly ? ['notas'] : ['cliente', 'notas', ...(onOpenVenda ? ['vendas'] : [])],
    preferInitial: notesOnly || initialTab !== 'cliente' || new URLSearchParams(window.location.search).has('aba')
  });
  function setAbaAtiva(aba) {
    persistirAba(aba);
    onTabChange?.(aba);
  }
  const [pendingNotas, setPendingNotas] = useState([]);
  const [consultoraIds, setConsultoraIds] = useState(() => (cliente?.consultoras || []).map(item => Number(item.id)));
  const [vendasCliente, setVendasCliente] = useState([]);
  const [carregandoVendas, setCarregandoVendas] = useState(false);
  const [erroVendas, setErroVendas] = useState('');
  const ultimoCnpjConsultadoRef = useRef(sanitizarCnpj(cliente?.cnpj));
  const ultimoDocumentoVerificadoRef = useRef('');
  const podeMostrarHistoricoVendas = Boolean(cliente?.id && onOpenVenda);
  const modalRef = useRef(null);
  const alturaModalAnteriorRef = useRef(null);

  // Anima a altura do modal quando o conteudo muda de tamanho (ex.: alternar CNPJ/CPF).
  useLayoutEffect(() => {
    const el = modalRef.current;
    if (!el) return undefined;

    const alturaNova = el.offsetHeight;
    const alturaAnterior = alturaModalAnteriorRef.current;
    alturaModalAnteriorRef.current = alturaNova;

    if (alturaAnterior == null || alturaAnterior === alturaNova) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    el.style.height = `${alturaAnterior}px`;
    el.getBoundingClientRect(); // forca reflow para o navegador registrar a altura inicial
    el.style.transition = 'height 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    el.style.height = `${alturaNova}px`;

    /**
     * Processa finalizar conforme as regras do dominio.
     */
    const finalizar = () => {
      el.style.height = '';
      el.style.transition = '';
      el.removeEventListener('transitionend', finalizar);
    };
    el.addEventListener('transitionend', finalizar);

    return () => {
      el.removeEventListener('transitionend', finalizar);
      el.style.height = '';
      el.style.transition = '';
    };
  }, [tipoBusca, abaAtiva]);

  // Usar hook para persistência de rascunhos
  const { clearDraft } = useFormDraft(editando ? null : draftKey, form, editando);

  useEffect(() => {
    if (editando || !onDraftChange) return;
    onDraftChange(form);
  }, [editando, form, onDraftChange]);

  useEffect(() => {
    if (abaAtiva !== 'vendas' || !cliente?.id) return undefined;

    let ativo = true;
    listarVendas({ cliente_id: cliente.id })
      .then(data => {
        if (!ativo) return;
        const lista = Array.isArray(data) ? data : (data?.data || []);
        setVendasCliente(ordenarVendasRecentes(lista));
      })
      .catch(error => {
        if (ativo) setErroVendas(error.message || 'Erro ao carregar vendas do cliente.');
      })
      .finally(() => {
        if (ativo) setCarregandoVendas(false);
      });

    return () => {
      ativo = false;
    };
  }, [abaAtiva, cliente?.id]);

  /**
   * Trata o evento de close.
   */
  function handleClose() {
    if (!editando && onDraftChange) {
      onDraftChange(form);
    }

    onClose();
  }

  /**
   * Limpa dados cliente e restaura o estado inicial.
   */
  function limparDadosCliente() {
    if (editando || salvando) return;

    const formLimpo = { ...FORM_INICIAL };

    clearDraft();
    setForm(formLimpo);
    onDraftChange?.(formLimpo);
    setErro('');
    setCnpjStatus({ tipo: '', mensagem: '' });
    setDocumentoDuplicado(null);
    setDocumentoStatus({ tipo: '', mensagem: '' });
    setCnpjDados(null);
    setCnpjSugestoes({});
    setTipoBusca('cnpj');
    setPendingNotas([]);
    setAbaAtiva('cliente');
    ultimoCnpjConsultadoRef.current = '';
    ultimoDocumentoVerificadoRef.current = '';
  }

  /**
   * Atualiza campo com os dados informados.
   */
  function atualizarCampo(campo, valor) {
    setForm(prev => ({ ...prev, [campo]: valor }));
  }

  function atualizarDocumento(valor) {
    atualizarCampo('cnpj', valor);
    const cnpjInvalido = tipoBusca === 'cnpj'
      && sanitizarCnpj(valor).length === 14
      && !validarDigitosCnpj(sanitizarCnpj(valor));
    setCnpjStatus(cnpjInvalido
      ? { tipo: 'erro', mensagem: 'CNPJ inválido.' }
      : { tipo: '', mensagem: '' });
    setDocumentoDuplicado(null);
    setDocumentoStatus({ tipo: '', mensagem: '' });
    setCnpjDados(null);
    setCnpjSugestoes({});
    ultimoCnpjConsultadoRef.current = '';
    ultimoDocumentoVerificadoRef.current = '';
  }

  function atualizarCheckbox(campo, valor) {
    setForm(prev => ({ ...prev, [campo]: Boolean(valor) }));
  }

  /**
   * Executa a acao de alterar tipo busca mantendo o estado da tela consistente.
   */
  function alterarTipoBusca(tipo) {
    setTipoBusca(tipo);
    setForm(prev => ({ ...prev, cnpj: '' }));
    setCnpjStatus({ tipo: '', mensagem: '' });
    setDocumentoDuplicado(null);
    setDocumentoStatus({ tipo: '', mensagem: '' });
    setCnpjDados(null);
    setCnpjSugestoes({});
    ultimoCnpjConsultadoRef.current = '';
    ultimoDocumentoVerificadoRef.current = '';
  }

  /**
   * Adiciona operadora cliente ao conjunto atual.
   */
  function adicionarOperadoraCliente() {
    setForm(prev => ({
      ...prev,
      operadoras_atuais: [...(prev.operadoras_atuais || []), novaOperadoraCliente()]
    }));
  }

  /**
   * Atualiza operadora cliente com os dados informados.
   */
  function atualizarOperadoraCliente(index, campo, valor) {
    setForm(prev => ({
      ...prev,
      operadoras_atuais: (prev.operadoras_atuais || []).map((item, idx) => (
        idx === index ? { ...item, [campo]: valor } : item
      ))
    }));
  }

  /**
   * Remove operadora cliente da colecao ou estado atual.
   */
  function removerOperadoraCliente(index) {
    setForm(prev => ({
      ...prev,
      operadoras_atuais: (prev.operadoras_atuais || []).filter((_, idx) => idx !== index)
    }));
  }

  /**
   * Formata mensagem cnpj para exibicao ou envio.
   */
  function formatarMensagemCnpj(dados) {
    return formatarMensagemResumoCnpj(dados);
  }

  /**
   * Monta sugestoes cnpj a partir dos dados informados.
   */
  function montarSugestoesCnpj(dados) {
    return Object.entries(CNPJ_SUGESTOES_CLIENTE).reduce((acc, [campoApi]) => {
      const valor = dados[campoApi];
      if (String(valor || '').trim()) acc[campoApi] = valor;
      return acc;
    }, {});
  }

  /**
   * Processa aceitar sugestao cnpj conforme as regras do dominio.
   */
  function aceitarSugestaoCnpj(campoApi) {
    const valor = cnpjSugestoes[campoApi];
    const config = CNPJ_SUGESTOES_CLIENTE[campoApi];
    if (!config || !String(valor || '').trim()) return;

    setForm(prev => {
      if (campoApi === 'telefone') {
        const digitos = apenasDigitos(valor, 11);
        const campoTelefone = digitos.length > 10 ? 'whatsapp' : 'fixo';
        return {
          ...prev,
          [campoTelefone]: formatarTelefoneComDdd(valor, digitos.length > 10)
        };
      }

      return {
        ...prev,
        [config.campo]: valor
      };
    });

    setCnpjSugestoes(prev => {
      const proximo = { ...prev };
      delete proximo[campoApi];
      return proximo;
    });
  }

  /**
   * Processa recusar sugestao cnpj conforme as regras do dominio.
   */
  function recusarSugestaoCnpj(campoApi) {
    setCnpjSugestoes(prev => {
      const proximo = { ...prev };
      delete proximo[campoApi];
      return proximo;
    });
  }

  /**
   * Busca dados cnpj conforme os parametros informados.
   */
  async function buscarDadosCnpj(manual = false) {
    const cnpj = sanitizarCnpj(form.cnpj);

    if (cnpj.length !== 14) {
      if (manual) {
        setCnpjStatus({ tipo: 'erro', mensagem: 'Informe um CNPJ com 14 dígitos.' });
      }
      return;
    }

    if (!validarDigitosCnpj(cnpj)) {
      setCnpjStatus({ tipo: 'erro', mensagem: 'CNPJ inválido.' });
      setCnpjDados(null);
      setCnpjSugestoes({});
      return;
    }

    if (!manual && ultimoCnpjConsultadoRef.current === cnpj) {
      return;
    }

    ultimoCnpjConsultadoRef.current = cnpj;
    setConsultandoCnpj(true);
    setCnpjStatus({ tipo: 'info', mensagem: 'Buscando CNPJ...' });

    try {
      const dados = await consultarCnpj(cnpj);
      setCnpjDados(dados);
      setCnpjSugestoes(montarSugestoesCnpj(dados));
      setCnpjStatus({
        tipo: 'sucesso',
        mensagem: formatarMensagemCnpj(dados)
      });
    } catch (error) {
      setCnpjDados(null);
      setCnpjSugestoes({});
      setCnpjStatus({ tipo: 'erro', mensagem: error.message || 'Não foi possível consultar o CNPJ.' });
    } finally {
      setConsultandoCnpj(false);
    }
  }

  /**
   * Processa verificar duplicidade documento conforme as regras do dominio.
   */
  async function verificarDuplicidadeDocumento(documento) {
    const digitos = tipoBusca === 'cpf' ? sanitizarCpf(documento) : sanitizarCnpj(documento);
    const tamanhoEsperado = tipoBusca === 'cpf' ? 11 : 14;

    if (digitos.length !== tamanhoEsperado) {
      setDocumentoDuplicado(null);
      setDocumentoStatus({ tipo: '', mensagem: '' });
      ultimoDocumentoVerificadoRef.current = '';
      return null;
    }

    ultimoDocumentoVerificadoRef.current = `${tipoBusca}:${digitos}`;
    setVerificandoDocumento(true);
    setDocumentoStatus({ tipo: 'info', mensagem: tipoBusca === 'cpf' ? 'Verificando documento...' : 'Verificando CNPJ...' });

    try {
      const resultado = await verificarDocumentoFn(digitos, cliente?.id);
      const duplicado = resultado?.existe ? resultado.cliente : null;
      setDocumentoDuplicado(duplicado);
      setDocumentoStatus(duplicado
        ? { tipo: 'erro', mensagem: formatarMensagemDocumentoDuplicado(duplicado) }
        : { tipo: 'sucesso', mensagem: tipoBusca === 'cpf' ? 'Documento ainda nao cadastrado.' : 'CNPJ ainda nao cadastrado.' });
      return duplicado;
    } catch {
      setDocumentoDuplicado(null);
      setDocumentoStatus({ tipo: 'erro', mensagem: 'Nao foi possivel verificar se o documento ja esta cadastrado.' });
      return null;
    } finally {
      setVerificandoDocumento(false);
    }
  }

  const verificarDocumentoNoEffect = useEffectEvent(verificarDuplicidadeDocumento);
  const buscarCnpjNoEffect = useEffectEvent(buscarDadosCnpj);

  useEffect(() => {
    if (tipoBusca !== 'cnpj') return undefined;

    const cnpj = sanitizarCnpj(form.cnpj);
    if (cnpj.length !== 14 || !validarDigitosCnpj(cnpj)) return undefined;

    const timeout = setTimeout(() => {
      verificarDocumentoNoEffect(cnpj).then(duplicado => {
        if (!duplicado && !isLead) buscarCnpjNoEffect(false);
      });
    }, 450);

    return () => clearTimeout(timeout);
  }, [form.cnpj, tipoBusca, isLead]);

  useEffect(() => {
    if (tipoBusca !== 'cpf') return;

    const cpf = sanitizarCpf(form.cnpj);

    if (cpf.length !== 11 || !validarDigitosCpf(cpf)) return undefined;

    const timeout = setTimeout(() => {
      verificarDocumentoNoEffect(cpf);
    }, 450);

    return () => clearTimeout(timeout);
  }, [form.cnpj, tipoBusca]);

  /**
   * Trata o evento de submit.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setErro('');

    if (somenteConsultoras) {
      if (!cliente?.id) return;
      setSalvando(true);
      try {
        const saved = await atualizarConsultorasCliente(cliente.id, consultoraIds);
        await onSave(saved);
      } catch (error) {
        setErro(error.message || 'Erro ao vincular consultoras.');
        setSalvando(false);
      }
      return;
    }

    if (!form.nome.trim()) {
      setErro(`Preencha o nome do ${entidadeLabel}.`);
      setAbaAtiva('cliente');
      return;
    }

    if (tipoBusca === 'cpf') {
      const cpf = sanitizarCpf(form.cnpj);
      if (cpf.length !== 11) {
        setErro('Informe um CPF com 11 digitos.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'Informe um CPF com 11 digitos.' });
        setAbaAtiva('cliente');
        return;
      }

      if (!validarDigitosCpf(cpf)) {
        setErro('CPF invalido.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'CPF invalido.' });
        setAbaAtiva('cliente');
        return;
      }

      const duplicado = await verificarDuplicidadeDocumento(cpf);
      if (duplicado) {
        setErro(formatarMensagemDocumentoDuplicado(duplicado));
        setAbaAtiva('cliente');
        return;
      }
    } else {
      const cnpj = sanitizarCnpj(form.cnpj);
      if (cnpj.length !== 14) {
        setErro('Informe um CNPJ com 14 digitos.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'Informe um CNPJ com 14 digitos.' });
        setAbaAtiva('cliente');
        return;
      }

      if (!validarDigitosCnpj(cnpj)) {
        setErro('CNPJ invalido.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'CNPJ invalido.' });
        setAbaAtiva('cliente');
        return;
      }

      const duplicado = await verificarDuplicidadeDocumento(cnpj);
      if (duplicado) {
        setErro(formatarMensagemDocumentoDuplicado(duplicado));
        setAbaAtiva('cliente');
        return;
      }
    }

    setSalvando(true);

    try {
      const payload = montarPayloadCliente(form);
      if (isLead) {
        payload.whatsapp = '';
        payload.fixo = '';
        payload.whatsapp_ddd = null;
        payload.whatsapp_numero = null;
        payload.fixo_ddd = null;
        payload.fixo_numero = null;
      }
      let saved;

      if (cliente?.id) {
        saved = await atualizarFn(cliente.id, payload);
      } else {
        saved = await criarFn(payload);
        if (podeMostrarNotas) for (const nota of pendingNotas) {
          try {
            await criarNotaEntidade(tipoNotas, saved.id, nota);
          } catch {
            // best effort
          }
        }
      }

      if (!isLead && podeGerenciarConsultoras && saved?.id) {
        saved = await atualizarConsultorasCliente(saved.id, consultoraIds);
      }

      // Limpar rascunho após sucesso
      if (!cliente?.id) {
        localStorage.removeItem(`form_draft_${draftKey}`);
      }

      await onSave(saved);
    } catch (error) {
      setErro(error.message || `Erro ao salvar ${entidadeLabel}.`);
      setSalvando(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal cliente-modal" onSubmit={handleSubmit} ref={modalRef}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">{notesOnly ? `Notas do ${entidadeLabel}` : editando ? `Editar ${entidadeLabel}` : `Novo ${entidadeLabel}`}</div>
              <div className="modal-sub">
                {notesOnly
                  ? (cliente?.nome || cliente?.razao_social || `${entidadeLabelCapitalizada} #${cliente?.id}`)
                  : 'Atualize representantes, contatos e dados de fidelidade.'}
              </div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={handleClose} disabled={salvando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        {!notesOnly && (
        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${abaAtiva === 'cliente' ? 'active' : ''}`}
            onClick={() => setAbaAtiva('cliente')}
          >
            <I.User size={14} /> {entidadeLabelCapitalizada}
          </button>
          {podeMostrarNotas && (
            <button
              type="button"
              className={`modal-tab ${abaAtiva === 'notas' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('notas')}
            >
              <I.Note size={14} /> Notas{!cliente?.id && pendingNotas.length > 0 && ` (${pendingNotas.length})`}
            </button>
          )}
          {podeMostrarHistoricoVendas && (
            <button
              type="button"
              className={`modal-tab ${abaAtiva === 'vendas' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('vendas')}
            >
              <I.History size={14} /> Vendas
            </button>
          )}
        </div>
        )}

        <div className="modal-body" data-navigation-scroll={`cliente:${cliente?.id || 'novo'}:${abaAtiva}`}>
          {erro && <div className="alert-error" style={{ marginBottom: 12 }}>{erro}</div>}
          {abaAtiva === 'notas' ? (
            <NotasEntidadeTab
              tipo={tipoNotas}
              entidadeId={cliente?.id}
              pendingNotas={pendingNotas}
              onPendingNotasChange={setPendingNotas}
            />
          ) : abaAtiva === 'vendas' ? (
            <div className="cliente-vendas-history">
              {erroVendas && <div className="alert-error">{erroVendas}</div>}

              {carregandoVendas ? (
                <div className="cliente-vendas-empty">Carregando vendas...</div>
              ) : vendasCliente.length === 0 ? (
                <div className="cliente-vendas-empty">Nenhuma venda encontrada para este cliente.</div>
              ) : (
                <div className="cliente-vendas-list">
                  {vendasCliente.map(venda => (
                    <button
                      type="button"
                      key={venda.id}
                      className="cliente-venda-item"
                      onClick={() => onOpenVenda?.(venda)}
                    >
                      <span className="cliente-venda-item__date">{formatarDataVenda(venda.data_venda || venda.created_at)}</span>
                      <span className="cliente-venda-item__main">
                        <strong>{obterTituloVenda(venda)}</strong>
                        <small>
                          Protocolo {venda.protocolo || '-'} - {obterResponsaveisVenda(venda)}
                        </small>
                      </span>
                      <span className="cliente-venda-item__meta">
                        <strong>{formatarMoeda(venda.valor_total)}</strong>
                        <small>{venda.status_funil || 'sem etapa'}</small>
                      </span>
                      <I.ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <>
            {somenteConsultoras && <div className="alert-info" style={{ marginBottom: 12 }}>Você pode alterar somente as consultoras vinculadas a este cliente.</div>}
            <div className="cliente-form-grid">
            {!isLead && podeGerenciarConsultoras && (
              <div className="form-field span-2 cliente-consultoras-field">
                <div className="cliente-consultoras-field__head">
                  <label>Consultoras vinculadas</label>
                  <span>{consultoraIds.length} selecionada{consultoraIds.length === 1 ? '' : 's'}</span>
                </div>
                <div className="cliente-consultoras-list" role="group" aria-label="Consultoras vinculadas">
                  {consultorasDisponiveis.length === 0 ? (
                    <span className="cliente-consultoras-list__empty">Nenhuma consultora ativa disponível.</span>
                  ) : consultorasDisponiveis.map(consultora => {
                    const selecionada = consultoraIds.includes(Number(consultora.id));
                    return (
                      <label key={consultora.id} className={`cliente-consultora-option${selecionada ? ' is-selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selecionada}
                          onChange={event => setConsultoraIds(ids => (
                            event.target.checked
                              ? [...ids, Number(consultora.id)]
                              : ids.filter(id => id !== Number(consultora.id))
                          ))}
                        />
                        <span className="cliente-consultora-option__content">
                          <strong>{consultora.nome}</strong>
                          {consultora.email && <small>{consultora.email}</small>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span className="field-hint">Marque todas as consultoras que devem acessar este cliente.</span>
              </div>
            )}
            <div className="form-field">
              <label>Nome</label>
              <input value={form.nome} onChange={event => atualizarCampo('nome', event.target.value)} required />
            </div>

            <div className="form-field">
              <label>Razão social</label>
              <AutoResizeTextarea
                value={form.razao_social}
                onChange={event => atualizarCampo('razao_social', event.target.value)}
                maxRows={4}
              />
            </div>

            <div className="form-field span-2 cliente-doc-field">
              <div className="cliente-doc-field__head">
                <label>{tipoBusca === 'cpf' ? 'CPF' : 'CNPJ'}</label>
                <div className="doc-tipo-toggle">
                  <button type="button" className={`btn btn-sm${tipoBusca === 'cnpj' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => alterarTipoBusca('cnpj')}>CNPJ</button>
                  <button type="button" className={`btn btn-sm${tipoBusca === 'cpf' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => alterarTipoBusca('cpf')}>CPF</button>
                </div>
              </div>
              <div className="cliente-doc-field__control" key={tipoBusca}>
                {tipoBusca === 'cpf' ? (
                  <>
                    <input
                      value={form.cnpj}
                      onChange={event => atualizarDocumento(formatarCpf(event.target.value))}
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      maxLength={14}
                      required
                    />
                    {(() => {
                      const digitos = sanitizarCpf(form.cnpj);
                      if (digitos.length > 0 && digitos.length < 11) return <span className="field-hint field-hint--error">CPF incompleto</span>;
                      if (digitos.length === 11 && !validarDigitosCpf(digitos)) return <span className="field-hint field-hint--error">CPF inválido</span>;
                      return null;
                    })()}
                    {verificandoDocumento && <span className="field-hint">Verificando documento...</span>}
                    {!verificandoDocumento && documentoStatus.mensagem && !documentoDuplicado && (
                      <span className={`field-hint cnpj-lookup-status ${documentoStatus.tipo}`}>
                        {documentoStatus.mensagem}
                      </span>
                    )}
                    {documentoDuplicado && (
                      <span className="field-hint field-hint--error">
                        {formatarMensagemDocumentoDuplicado(documentoDuplicado)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      value={form.cnpj}
                      onChange={event => atualizarDocumento(formatarCnpj(event.target.value))}
                      placeholder="00.000.000/0000-00"
                      inputMode="numeric"
                      maxLength={18}
                      required
                    />
                    {!isLead && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => buscarDadosCnpj(true)}
                        disabled={consultandoCnpj || sanitizarCnpj(form.cnpj).length !== 14}
                      >
                        {consultandoCnpj ? 'Buscando...' : 'Buscar dados do CNPJ'}
                      </button>
                    )}
                    {cnpjStatus.mensagem && (
                      <span className={`field-hint cnpj-lookup-status ${cnpjStatus.tipo}`}>
                        {cnpjStatus.mensagem}
                      </span>
                    )}
                    {verificandoDocumento && <span className="field-hint">Verificando CNPJ...</span>}
                    {!verificandoDocumento && documentoStatus.mensagem && !documentoDuplicado && (
                      <span className={`field-hint cnpj-lookup-status ${documentoStatus.tipo}`}>
                        {documentoStatus.mensagem}
                      </span>
                    )}
                    {documentoDuplicado && (
                      <span className="field-hint field-hint--error">
                        {formatarMensagemDocumentoDuplicado(documentoDuplicado)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="form-field">
              <label>Tipo</label>
              <SelectFiltro
                value={form.responsavel_tipo || 'rl'}
                onChange={val => atualizarCampo('responsavel_tipo', val || 'rl')}
                placeholder="RL"
                options={[
                  { value: 'rl', label: 'RL' },
                  { value: 'adm', label: 'ADM' },
                ]}
              />
            </div>

            <div className="form-field">
              <label>Nome do ADM/RL</label>
              <input value={form.responsavel_nome} onChange={event => atualizarCampo('responsavel_nome', event.target.value)} />
            </div>

            <div className="form-field span-2">
              <label>E-mail</label>
              <input type="email" value={form.email} onChange={event => atualizarCampo('email', event.target.value)} />
            </div>

            {isLead ? (
              <>
                <div className="form-field cliente-phone-field">
                  <label>Telefone Receita</label>
                  <input
                    value={form.telefone_receita}
                    onChange={event => atualizarCampo('telefone_receita', formatarTelefoneOrigem(event.target.value))}
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    maxLength={15}
                  />
                  <label className="checkbox-inline cliente-phone-check">
                    <input
                      type="checkbox"
                      checked={Boolean(form.telefone_receita_contatavel)}
                      onChange={event => atualizarCheckbox('telefone_receita_contatavel', event.target.checked)}
                    />
                    Pode falar
                  </label>
                </div>

                <div className="form-field cliente-phone-field">
                  <label>Telefone Google</label>
                  <input
                    value={form.telefone_google}
                    onChange={event => atualizarCampo('telefone_google', formatarTelefoneOrigem(event.target.value))}
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    maxLength={15}
                  />
                  <label className="checkbox-inline cliente-phone-check">
                    <input
                      type="checkbox"
                      checked={Boolean(form.telefone_google_contatavel)}
                      onChange={event => atualizarCheckbox('telefone_google_contatavel', event.target.checked)}
                    />
                    Pode falar
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="form-field">
                  <label>WhatsApp com DDD</label>
                  <input
                    value={form.whatsapp}
                    onChange={event => atualizarCampo('whatsapp', formatarTelefoneComDdd(event.target.value, true))}
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    maxLength={15}
                  />
                </div>

                <div className="form-field">
                  <label>Fixo com DDD</label>
                  <input
                    value={form.fixo}
                    onChange={event => atualizarCampo('fixo', formatarTelefoneComDdd(event.target.value))}
                    placeholder="(11) 9999-9999"
                    inputMode="numeric"
                    maxLength={14}
                  />
                </div>
              </>
            )}

            <div className="form-field span-2 cliente-operadoras-field">
              <div className="cliente-operadoras-head">
                <label>Operadoras contratadas</label>
                <button type="button" className="btn btn-sm" onClick={adicionarOperadoraCliente}>
                  <I.Plus size={13} /> Adicionar
                </button>
              </div>

              {(form.operadoras_atuais || []).length === 0 ? (
                <div className="cliente-operadoras-empty">Nenhuma operadora cadastrada.</div>
              ) : (
                <div className="cliente-operadoras-list">
                  {(form.operadoras_atuais || []).map((item, index) => (
                    <div className="cliente-operadora-row" key={`operadora-${index}`}>
                      <div className="form-field">
                        <label>Operadora</label>
                        <SelectFiltro
                          value={item.operadora_id ? String(item.operadora_id) : ''}
                          onChange={val => atualizarOperadoraCliente(index, 'operadora_id', val)}
                          placeholder="Selecione"
                          options={operadoras.map(op => ({ value: String(op.id), label: op.nome }))}
                        />
                      </div>
                      <div className="form-field">
                        <label>Chips</label>
                        <input
                          type="number"
                          min="0"
                          value={item.quantidade_chips}
                          onChange={event => atualizarOperadoraCliente(index, 'quantidade_chips', event.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label>Valor pago</label>
                        <input
                          value={item.valor_pago}
                          onChange={event => atualizarOperadoraCliente(index, 'valor_pago', formatarInputMoedaBR(event.target.value))}
                          placeholder="0,00"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="form-field">
                        <label>Fim da fidelidade</label>
                        <input
                          type="date"
                          value={item.fidelidade_fim}
                          onChange={event => atualizarOperadoraCliente(index, 'fidelidade_fim', event.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost btn-danger-icon cliente-operadora-remove"
                        onClick={() => removerOperadoraCliente(index)}
                        title="Remover operadora"
                      >
                        <I.Trash size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!isLead && (
            <CnpjSugestoes
              dados={cnpjDados}
              sugestoes={cnpjSugestoes}
              labels={CNPJ_LABELS_CLIENTE}
              onAceitar={aceitarSugestaoCnpj}
              onRecusar={recusarSugestaoCnpj}
            />
          )}

          {erro && <div className="alert-error" style={{ marginTop: 16 }}>{erro}</div>}
          </>
          )}
        </div>

        <div className="modal-footer">
          {['notas', 'vendas'].includes(abaAtiva) && cliente?.id ? (
            <button type="button" className="btn" onClick={handleClose}>Fechar</button>
          ) : (
            <>
              {!editando && (
                <button type="button" className="btn btn-ghost" onClick={limparDadosCliente} disabled={salvando}>
                  <I.Trash size={14} /> Limpar Dados
                </button>
              )}
              <button type="button" className="btn" onClick={handleClose} disabled={salvando}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={salvando}>
                {salvando ? 'Salvando...' : `Salvar ${entidadeLabel}`}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

export default ClienteModal;
