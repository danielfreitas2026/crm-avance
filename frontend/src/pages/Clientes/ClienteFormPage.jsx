import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import CnpjSugestoes from '../../components/CnpjSugestoes';
import { formatarMensagemResumoCnpj } from '../../components/cnpjSugestoes.utils';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import {
  atualizarCliente,
  atualizarClienteSecreto,
  buscarClientePorId,
  buscarClienteSecretoPorId,
  criarCliente,
  criarClienteSecreto,
  verificarDocumentoCliente,
  verificarDocumentoClienteSecreto
} from '../../services/cliente.service';
import { consultarCnpj, sanitizarCnpj, validarDigitosCnpj, formatarCpf, sanitizarCpf, validarDigitosCpf } from '../../services/cnpj.service';
import { listarOperadoras } from '../../services/config.service';
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
  fidelidade_fim: '',
  operadora_atual_id: '',
  valor_pago: '',
  quantidade_chips: '',
  operadoras_atuais: []
};

const CNPJ_SUGESTOES_CLIENTE = {
  nomeFantasia: { campo: 'nome', label: 'Nome fantasia' },
  razaoSocial: { campo: 'razao_social', label: 'Razão social' },
  email: { campo: 'email', label: 'Email' },
  telefone: { campo: 'whatsapp', label: 'Whatsapp' }
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

  if (texto === '1899-11-30') {
    return '';
  }

  return texto;
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
 * Monta payload a partir dos dados informados.
 */
function montarPayload(form) {
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
    cnpj: formatarCnpj(form.cnpj),
    whatsapp_ddd: whatsapp.ddd,
    whatsapp_numero: whatsapp.numero,
    fixo_ddd: fixo.ddd,
    fixo_numero: fixo.numero,
    operadoras_atuais: operadorasAtuais,
    fidelidade_fim: operadorasAtuais[0]?.fidelidade_fim || null,
    operadora_atual_id: operadorasAtuais[0]?.operadora_id || null,
    valor_pago: operadorasAtuais.reduce((total, item) => total + Number(item.valor_pago || 0), 0) || null,
    quantidade_chips: operadorasAtuais.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0) || null
  };
}

/**
 * Renderiza cliente form page.
 */
function ClienteFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const editando = Boolean(id);
  const modoSecreto = location.pathname.startsWith('/clientes-secretos');
  const rotaLista = modoSecreto ? '/clientes-secretos' : '/clientes';

  const [form, setForm] = useState(FORM_INICIAL);
  const [operadoras, setOperadoras] = useState([]);
  const [carregando, setCarregando] = useState(editando);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [cnpjStatus, setCnpjStatus] = useState({ tipo: '', mensagem: '' });
  const [documentoDuplicado, setDocumentoDuplicado] = useState(null);
  const [documentoStatus, setDocumentoStatus] = useState({ tipo: '', mensagem: '' });
  const [verificandoDocumento, setVerificandoDocumento] = useState(false);
  const [cnpjDados, setCnpjDados] = useState(null);
  const [cnpjSugestoes, setCnpjSugestoes] = useState({});
  const [tipoBusca, setTipoBusca] = useState('cnpj');
  const ultimoCnpjConsultadoRef = useRef('');
  const ultimoDocumentoVerificadoRef = useRef('');

  useEffect(() => {
    if (!erro) return undefined;
    const timer = setTimeout(() => setErro(''), 6000);
    return () => clearTimeout(timer);
  }, [erro]);

  useEffect(() => {
    /**
     * Carrega  e atualiza o estado relacionado.
     */
    async function carregar() {
      setErro('');
      setCarregando(true);

      try {
        const [operadorasData, clienteData] = await Promise.all([
          listarOperadoras(),
          editando ? (modoSecreto ? buscarClienteSecretoPorId(id) : buscarClientePorId(id)) : Promise.resolve(null)
        ]);

        setOperadoras(operadorasData);

        if (clienteData) {
          const documentoDigitos = sanitizarCnpj(clienteData.cnpj);
          const ehCpf = documentoDigitos.length === 11;
          ultimoCnpjConsultadoRef.current = documentoDigitos;
          setTipoBusca(ehCpf ? 'cpf' : 'cnpj');
          setForm({
            nome: clienteData.nome || '',
            razao_social: clienteData.razao_social || '',
            cnpj: ehCpf ? formatarCpf(clienteData.cnpj) : formatarCnpj(clienteData.cnpj),
            responsavel_tipo: clienteData.responsavel_tipo || 'rl',
            responsavel_nome: clienteData.responsavel_nome || '',
            email: clienteData.email || '',
            whatsapp: juntarTelefone(clienteData.whatsapp_ddd, clienteData.whatsapp_numero, true),
            fixo: juntarTelefone(clienteData.fixo_ddd, clienteData.fixo_numero),
            fidelidade_fim: normalizarDataInput(clienteData.fidelidade_fim),
            operadora_atual_id: clienteData.operadora_atual_id || '',
            valor_pago: formatarValorPagoInput(clienteData.valor_pago),
            quantidade_chips: clienteData.quantidade_chips ?? '',
            operadoras_atuais: normalizarOperadorasClienteForm(clienteData)
          });
        }
      } catch (error) {
        setErro(error.message || 'Erro ao carregar cliente.');
      } finally {
        setCarregando(false);
      }
    }

    carregar();
  }, [editando, id, modoSecreto]);

  const titulo = useMemo(() => {
    if (modoSecreto) return editando ? 'Editar lead' : 'Novo lead';
    return editando ? 'Editar cliente' : 'Novo cliente';
  }, [editando, modoSecreto]);

  /**
   * Atualiza campo com os dados informados.
   */
  function atualizarCampo(campo, valor) {
    setForm(prev => ({
      ...prev,
      [campo]: valor
    }));
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
      const resultado = modoSecreto
        ? await verificarDocumentoClienteSecreto(digitos, editando ? id : null)
        : await verificarDocumentoCliente(digitos, editando ? id : null);
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
        if (!duplicado) buscarCnpjNoEffect(false);
      });
    }, 450);

    return () => clearTimeout(timeout);
  }, [form.cnpj, tipoBusca]);

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

    if (tipoBusca === 'cpf') {
      const cpf = sanitizarCpf(form.cnpj);
      if (cpf.length !== 11) {
        setErro('Informe um CPF com 11 digitos.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'Informe um CPF com 11 digitos.' });
        return;
      }

      if (!validarDigitosCpf(cpf)) {
        setErro('CPF invalido.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'CPF invalido.' });
        return;
      }

      const duplicado = await verificarDuplicidadeDocumento(cpf);
      if (duplicado) {
        setErro(formatarMensagemDocumentoDuplicado(duplicado));
        return;
      }
    } else {
      const cnpj = sanitizarCnpj(form.cnpj);
      if (cnpj.length !== 14) {
        setErro('Informe um CNPJ com 14 digitos.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'Informe um CNPJ com 14 digitos.' });
        return;
      }

      if (!validarDigitosCnpj(cnpj)) {
        setErro('CNPJ invalido.');
        setCnpjStatus({ tipo: 'erro', mensagem: 'CNPJ invalido.' });
        return;
      }

      const duplicado = await verificarDuplicidadeDocumento(cnpj);
      if (duplicado) {
        setErro(formatarMensagemDocumentoDuplicado(duplicado));
        return;
      }
    }

    setSalvando(true);

    try {
      const payload = montarPayload(form);

      if (editando) {
        if (modoSecreto) {
          await atualizarClienteSecreto(id, payload);
        } else {
          await atualizarCliente(id, payload);
        }
      } else {
        if (modoSecreto) {
          await criarClienteSecreto(payload);
        } else {
          await criarCliente(payload);
        }
      }

      navigate(rotaLista);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar cliente.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <LayoutPrivado>
      <div className="cliente-form-page">
        <section className="panel">
          <div className="cliente-form-header">
            <div className="cliente-form-header__title">
              <button
                className="btn btn-icon btn-ghost"
                type="button"
                onClick={() => navigate(rotaLista)}
                title="Voltar"
              >
                <I.ArrowRight style={{ transform: 'rotate(180deg)' }} />
              </button>
              <div>
                <h2>{titulo}</h2>
                <p>{modoSecreto ? 'Cadastre leads para qualificacao e acompanhamento.' : 'Cadastre representantes de empresas para vincular as vendas.'}</p>
              </div>
            </div>
          </div>

          <div className="panel-body">
            {erro && <div className="alert-error alert-timed alert-timed--error" style={{ margin: 18, marginBottom: 0 }}>{erro}</div>}

            {carregando ? (
              <div className="muted" style={{ padding: 24 }}>
                Carregando cliente...
              </div>
            ) : (
              <form className="cliente-form" onSubmit={handleSubmit}>
                <section className="cliente-form-section">
                  <div className="cliente-form-section__header">
                    <h3>Dados da empresa</h3>
                  </div>

                  <div className="cliente-form-grid">
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
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => buscarDadosCnpj(true)}
                              disabled={consultandoCnpj || sanitizarCnpj(form.cnpj).length !== 14}
                            >
                              {consultandoCnpj ? 'Buscando...' : 'Buscar dados do CNPJ'}
                            </button>
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

                  </div>

                  <CnpjSugestoes
                    dados={cnpjDados}
                    sugestoes={cnpjSugestoes}
                    labels={CNPJ_LABELS_CLIENTE}
                    onAceitar={aceitarSugestaoCnpj}
                    onRecusar={recusarSugestaoCnpj}
                  />
                </section>

                <section className="cliente-form-section">
                  <div className="cliente-form-section__header">
                    <h3>Responsavel e contato</h3>
                  </div>

                  <div className="cliente-form-grid cliente-form-grid--three">
                    <div className="form-field">
                      <label>Tipo</label>
                      <select value={form.responsavel_tipo} onChange={event => atualizarCampo('responsavel_tipo', event.target.value)}>
                        <option value="rl">RL</option>
                        <option value="adm">ADM</option>
                      </select>
                    </div>

                    <div className="form-field span-2">
                      <label>Nome do ADM/RL</label>
                      <input value={form.responsavel_nome} onChange={event => atualizarCampo('responsavel_nome', event.target.value)} />
                    </div>

                    <div className="form-field span-3">
                      <label>E-mail</label>
                      <input type="email" value={form.email} onChange={event => atualizarCampo('email', event.target.value)} />
                    </div>

                    <div className="form-field">
                      <label>WhatsApp com DDD</label>
                      <input
                        value={form.whatsapp}
                        onChange={event => atualizarCampo('whatsapp', formatarTelefoneComDdd(event.target.value, true))}
                        placeholder="(11) 99999-9999"
                        inputMode="numeric"
                        maxLength={15}
                        pattern="\([0-9]{2}\) [0-9]{5}-[0-9]{4}"
                        title="Informe o WhatsApp com DDD. Exemplo: (11) 99999-9999"
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
                        pattern="\([0-9]{2}\) [0-9]{4}-[0-9]{4}"
                        title="Informe o telefone fixo com DDD. Exemplo: (11) 9999-9999"
                      />
                    </div>

                    <div className="form-field span-3 cliente-operadoras-field">
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
                                <select value={item.operadora_id} onChange={event => atualizarOperadoraCliente(index, 'operadora_id', event.target.value)}>
                                  <option value="">Selecione</option>
                                  {operadoras.map(operadora => (
                                    <option key={operadora.id} value={operadora.id}>{operadora.nome}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Chips</label>
                                <input type="number" min="0" value={item.quantidade_chips} onChange={event => atualizarOperadoraCliente(index, 'quantidade_chips', event.target.value)} />
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
                                <input type="date" value={item.fidelidade_fim} onChange={event => atualizarOperadoraCliente(index, 'fidelidade_fim', event.target.value)} />
                              </div>
                              <button type="button" className="btn btn-icon btn-ghost btn-danger-icon cliente-operadora-remove" onClick={() => removerOperadoraCliente(index)} title="Remover operadora">
                                <I.Trash size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <div className="cliente-form-actions">
                  <button className="btn" type="button" onClick={() => navigate(rotaLista)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" type="submit" disabled={salvando}>
                    {salvando ? 'Salvando...' : 'Salvar cliente'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>

    </LayoutPrivado>
  );
}

export default ClienteFormPage;
