import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '../../utils/useDebounce';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Paginacao from '../../components/Paginacao/Paginacao';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import CnpjSugestoes, { formatarMensagemResumoCnpj } from '../../components/CnpjSugestoes';
import NotasEntidadeTab from '../../components/NotasEntidadeTab';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import ClienteModal from '../Clientes/ClienteModal';
import VendaModal from './VendaModal';
import {
  atualizarVenda,
  baixarArquivoVenda,
  baixarPacoteArquivosVenda,
  baixarXlsxClaro,
  buscarVendaPorId,
  criarVenda,
  deletarVenda,
  enviarVendaParaPosVenda,
  excluirArquivoVenda,
  excluirReversaoVenda,
  exportarVendasExcel,
  gerarPacoteArquivosVenda,
  gerarEmailVenda,
  listarArquivosVenda,
  listarDestinatariosProblemaVenda,
  obterReferenciasClientesVendas,
  listarVendas,
  listarVendedoras,
  marcarProblemaVenda,
  registrarReversaoVenda,
  reenviarVendaParaDashboard,
  uploadArquivoVenda,
  visualizarArquivoVenda
} from '../../services/venda.service';
import { consultarCnpj, sanitizarCnpj, validarDigitosCnpj } from '../../services/cnpj.service';
import { criarNotaEntidade } from '../../services/nota.service';
import { listarEtapasFunil, listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { criarCliente as criarClientePrincipal, listarClientesSelect, verificarDocumentoCliente } from '../../services/cliente.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { formatUtcDateTime } from '../../utils/datetime';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import { agruparOpcoesServicos, formatarNomeServico } from '../../utils/servicos';
import './VendasPage.css';

const VENDA_VAZIA = {
  cliente_id: '',
  nome: '',
  telefone: '',
  email: '',
  email_2: '',
  fixo_ddd: '',
  razao_social: '',
  cnpj: '',
  // Representante Legal
  nome_representante_legal: '',
  cpf_representante_legal: '',
  telefone_representante_legal: '',
  email_representante_legal: '',
  // Administrador
  nome_administrador: '',
  cpf_administrador: '',
  telefone_administrador: '',
  email_administrador: '',
  // Dados da venda
  nome_fechou_venda: '',
  setor_funcao: '',
  produto_fechado: '',
  qc_feito_por: '',
  data_venda: '',
  // Produto e valores
  tipo_venda_id: '',
  servico_id: '',
  quantidade_linhas: '',
  ddd: '',
  numeros_ativados: [],
  gb: '',
  valores_unitarios_chips: [{ quantidade: '', gb: '', valor_unitario: '', tipo_linha: 'novo', vendedora_id: '' }],
  valor_total: '',
  cliente_solicitou_servicos: [],
  cliente_solicitou_bloqueio_qtd: '',
  cliente_solicitou_cancelamento_qtd: '',
  cliente_solicitou_numeros: { bloqueio: [], cancelamento: [] },
  ponto_referencia: '',
  tipo_local_cpf: '',
  razao_social: '',
  cnpj: '',
  data_venda: '',
  data_ativacao: '',
  qc_feito_por: '',
  observacoes: '',
  dia_vencimento: '',
  // Endereço
  cep: '',
  endereco: '',
  numero_endereco: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: '',
  endereco_real_divergente: false,
  cep_real: '',
  endereco_real: '',
  numero_endereco_real: '',
  complemento_real: '',
  bairro_real: '',
  municipio_real: '',
  uf_real: '',
  ponto_referencia: '',
  tipo_local_cpf: '',
  // Aceite
  horario_aceite_voz: '',
  horario_aceite_inicio: '',
  horario_aceite_fim: '',
  dia_aceite_inicio: '',
  dia_aceite_fim: '',
  protocolo: '',
  login: '',
  senha: '',
  numero_cliente_contrato: '',
  responsavel_recebimento: '',
  rg_responsavel_recebimento: '',
  responsavel_recebimento_2: '',
  rg_responsavel_recebimento_2: '',
  responsavel_recebimento_3: '',
  rg_responsavel_recebimento_3: '',
  promessa_cliente: '',
  promessa_cumprida: '',
  observacoes: '',
  // Referências
  operadora_id: '',
  vendedora_id: '',
  vendedoras: []
};

const AVALIACOES_PRIMEIRA_LIGACAO = {
  bom: { label: 'Bom', classe: 'is-bom' },
  mais_ou_menos: { label: 'Mais ou menos', classe: 'is-mais-ou-menos' },
  ruim: { label: 'Ruim', classe: 'is-ruim' }
};

/**
 * Obtem operadoras cliente a partir dos dados informados.
 */
function obterOperadorasCliente(cliente) {
  return cliente?.operadoras_atuais || cliente?.operadorasAtuais || [];
}

/**
 * Formata resumo operadoras cliente para exibicao ou envio.
 */
function formatarResumoOperadorasCliente(cliente) {
  const operadorasCliente = obterOperadorasCliente(cliente);
  if (operadorasCliente.length === 0) {
    return `${cliente?.operadoraAtual?.nome || 'Sem operadora'} - ${cliente?.quantidade_chips ?? 0} chips`;
  }

  const nomes = operadorasCliente.map(item => item.operadora?.nome).filter(Boolean);
  const chips = operadorasCliente.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0);
  return `${nomes.slice(0, 2).join(', ') || 'Sem operadora'}${nomes.length > 2 ? ` +${nomes.length - 2}` : ''} - ${chips} chips`;
}

const CNPJ_SUGESTOES_VENDA = {
  nomeFantasia: { campo: 'nome', label: 'Nome fantasia' },
  razaoSocial: { campo: 'razao_social', label: 'Razão social' },
  email: { campo: 'email', label: 'Email' },
  telefone: { campo: 'telefone', label: 'Telefone' },
  cep: { campo: 'cep', label: 'CEP' },
  endereco: { campo: 'endereco', label: 'Endereço' },
  numero: { campo: 'numero_endereco', label: 'Número' },
  complemento: { campo: 'complemento', label: 'Complemento' },
  bairro: { campo: 'bairro', label: 'Bairro' },
  municipio: { campo: 'municipio', label: 'Município' },
  uf: { campo: 'uf', label: 'UF' }
};

const CNPJ_LABELS_VENDA = Object.fromEntries(
  Object.entries(CNPJ_SUGESTOES_VENDA).map(([campo, config]) => [campo, config.label])
);

const CAMPOS_ENDERECO_REAL_VENDA = [
  { name: 'cep_real', label: 'CEP' },
  { name: 'endereco_real', label: 'Endereço real', type: 'longText', span: true },
  { name: 'numero_endereco_real', label: 'Número' },
  { name: 'complemento_real', label: 'Complemento', type: 'longText', span: true },
  { name: 'bairro_real', label: 'Bairro' },
  { name: 'municipio_real', label: 'Município' },
  { name: 'uf_real', label: 'UF', maxLength: 2 }
];

const ITEM_CHIP_VAZIO = { quantidade: '', gb: '', valor_unitario: '', tipo_linha: 'novo', vendedora_id: '' };
const NUMERO_PORTADO_VAZIO = '';
const TIPOS_LINHA_CHIP = [
  { value: 'novo', label: 'Novo' },
  { value: 'portabilidade', label: 'Port.' }
];

const CLIENTE_SOLICITOU_OPCOES = [
  { value: 'bloqueio', label: 'Bloqueio' },
  { value: 'cancelamento', label: 'Cancelamento' },
  { value: 'nenhum_servico', label: 'Nenhum serviço' }
];

const CLIENTE_SOLICITOU_ACOES = ['bloqueio', 'cancelamento'];

const DIAS_SEMANA = [
  { value: 'segunda', label: 'Segunda-feira' },
  { value: 'terca', label: 'Terça-feira' },
  { value: 'quarta', label: 'Quarta-feira' },
  { value: 'quinta', label: 'Quinta-feira' },
  { value: 'sexta', label: 'Sexta-feira' },
  { value: 'sabado', label: 'Sábado' },
  { value: 'domingo', label: 'Domingo' },
];

const FECHOU_VENDA_OPCOES = [
  { value: 'RL', label: 'RL' },
  { value: 'ADM', label: 'ADM' }
];

const PROMESSA_CUMPRIDA_OPCOES = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'sim', label: 'Sim' },
  { value: 'nao', label: 'Não' }
];

const CAMPOS = [
  { section: 'Cliente' },
  { name: 'cliente_id', label: 'Cliente', type: 'client', required: true, span: true },
  { name: 'cnpj', label: 'CNPJ para preencher dados', type: 'cnpj' },
  { name: 'vendedoras', label: 'Vendedoras', type: 'sellers', span: true },

  { section: 'Dados do cliente' },
  { name: 'nome', label: 'Nome / Fantasia' },
  { name: 'razao_social', label: 'Razão Social' },
  { name: 'telefone', label: 'Telefone Celular' },
  { name: 'fixo_ddd', label: 'Telefone fixo' },
  { section: 'Representante Legal (RL)' },
  { name: 'nome_representante_legal', label: 'Nome RL' },
  { name: 'cpf_representante_legal', label: 'CPF RL' },
  { name: 'telefone_representante_legal', label: 'Telefone RL' },
  { name: 'email_representante_legal', label: 'Email RL' },

  { section: 'Administrador (ADM)' },
  { name: 'nome_administrador', label: 'Nome ADM' },
  { name: 'cpf_administrador', label: 'CPF ADM' },
  { name: 'telefone_administrador', label: 'Telefone ADM' },
  { name: 'email_administrador', label: 'E-mail ADM' },

  { section: 'Dados da venda' },
  { name: 'data_venda', label: 'Data da venda', type: 'date' },
  { name: 'data_ativacao', label: 'Data da ativação', type: 'date' },
  { name: 'nome_fechou_venda', label: 'Venda fechada com', type: 'closedWith' },
  { name: 'setor_funcao', label: 'Setor/Função' },
  { name: 'qc_feito_por', label: 'QC feito por' },

  { section: 'Produto e valores' },
  { name: 'operadora_id', label: 'Operadora adquirida', type: 'operator', required: true },
  { name: 'servico_id', label: 'Produto', type: 'service', required: true },
  { name: 'quantidade_linhas', label: 'Quantidade de linhas fechadas', type: 'number' },
  { name: 'ddd', label: 'Qual DDD' },
  { name: 'dia_vencimento', label: 'Dia de vencimento', type: 'number', min: 1, max: 31 },
  { name: 'cliente_solicitou_servicos', label: 'Cliente solicitou', type: 'clientRequested', span: true },
  { name: 'valores_unitarios_chips', label: 'Chips, gigas e valores unitários', type: 'chips', span: true },
  { name: 'numeros_ativados', label: 'Números ativados', type: 'activatedNumbers', span: true },
  { name: 'numeros_portados', label: 'Números a serem portados', type: 'portedNumbers', span: true },

  { section: 'Local de instalação/entrega' },
  { name: 'cep', label: 'CEP' },
  { name: 'endereco', label: 'Endereço', type: 'longText' },
  { name: 'numero_endereco', label: 'Número' },
  { name: 'complemento', label: 'Complemento', type: 'longText' },
  { name: 'bairro', label: 'Bairro' },
  { name: 'municipio', label: 'Município' },
  { name: 'uf', label: 'UF', maxLength: 2 },
  { name: 'endereco_real_divergente', label: 'Endereço da Receita não é o endereço real', type: 'realAddressToggle', span: true },
  { name: 'ponto_referencia', label: 'Ponto de referência', type: 'longText', span: true },
  { name: 'tipo_local_cpf', label: 'Venda CPF: casa, hotel, condomínio, shopping...', type: 'longText', span: true },

  { section: 'Aceite' },
  { name: 'horario_aceite_range', label: 'Janela do aceite', type: 'timeRange', nameDe: 'horario_aceite_inicio', nameAte: 'horario_aceite_fim', labelDe: 'De', labelAte: 'Até', span: true },
  { name: 'dia_aceite_range', label: 'Dias para aceite', type: 'dayRange', nameDe: 'dia_aceite_inicio', nameAte: 'dia_aceite_fim', labelDe: 'De', labelAte: 'Até', span: true },
  { name: 'protocolo', label: 'Protocolo do Cliente', span: true },
  { name: 'login', label: 'Login (portal do cliente)' },
  { name: 'senha', label: 'Senha (portal do cliente)' },
  { name: 'numero_cliente_contrato', label: 'Número do cliente no contrato', placeholder: 'Caso não tenha Login e Senha', span: true },
  { name: 'responsaveis_recebimento', type: 'responsaveis', span: true },
  { name: 'promessa_cliente', label: 'O que foi prometido ao cliente', type: 'longText', span: true, maxRows: 5 },
  { name: 'promessa_cumprida', label: 'Cumprimos o prometido?', type: 'promiseStatus', span: true },
  { name: 'observacoes', label: 'Observações da Venda', type: 'longText', span: true, maxRows: 6 },
];

const STATUS_FUNIL_FILTROS = [
  { id: 'aprovacao', label: 'Aprovação' },
  { id: 'ativacao', label: 'Ativação' },
  { id: 'envio', label: 'Envio' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'confirmacao', label: 'Confirmação' },
  { id: 'concluido', label: 'Concluído' },
  { id: 'retorno', label: 'Retorno' },
  { id: '__cancelada', label: 'Canceladas' }
];

const STATUS_CANCELADA_FILTRO = '__cancelada';
const STATUS_FUNIL_FILTROS_LABELS = Object.fromEntries(
  STATUS_FUNIL_FILTROS.map(status => [status.id, status.label])
);

const BUSCA_CAMPO_OPCOES = [
  { value: 'geral', label: 'Busca geral' },
  { value: 'protocolo', label: 'Protocolo' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'tipo_venda', label: 'Tipo de venda' },
  { value: 'produto', label: 'Produto' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'cidade', label: 'Cidade' }
];

/**
 * Normaliza status funil filtros para uso interno consistente.
 */
function normalizarStatusFunilFiltros(etapas = []) {
  const normalizados = etapas
    .map(etapa => ({
      id: etapa.codigo || etapa.id,
      label: STATUS_FUNIL_FILTROS_LABELS[etapa.codigo || etapa.id] || etapa.nome || etapa.name
    }))
    .filter(etapa => etapa.id && etapa.label);

  return [
    ...(normalizados.length > 0
      ? normalizados
      : STATUS_FUNIL_FILTROS.filter(status => !['retorno', STATUS_CANCELADA_FILTRO].includes(status.id))),
    { id: 'retorno', label: 'Retorno' },
    { id: STATUS_CANCELADA_FILTRO, label: 'Canceladas' }
  ];
}

/**
 * Retorna o nome configurado para uma etapa do funil.
 */
function obterNomeEtapaFunil(codigo, etapas = []) {
  if (!codigo) return '';
  if (codigo === 'retorno') return 'Retorno';

  const etapa = etapas.find(item => String(item.codigo || item.id) === String(codigo));
  return etapa?.nome || etapa?.name || String(codigo);
}

/**
 * Monta o resumo visual da etapa atual e das etapas percorridas pela venda.
 */
function obterResumoFunilVenda(venda, etapas = []) {
  const etapaAtual = venda?.status_funil;
  if (!etapaAtual) return null;

  const codigos = (Array.isArray(venda.historico) ? venda.historico : [])
    .map(item => item.status_novo)
    .filter(Boolean);

  if (!codigos.includes(etapaAtual)) codigos.push(etapaAtual);

  const etapasPercorridas = [...new Set(codigos)]
    .map(codigo => ({ codigo, nome: obterNomeEtapaFunil(codigo, etapas) }))
    .filter(etapa => etapa.nome);

  return {
    atual: obterNomeEtapaFunil(etapaAtual, etapas),
    etapasPercorridas
  };
}
/**
 * Converte input date para o formato esperado.
 */
function toInputDate(value) {
  if (!value) return '';

  const texto = value instanceof Date
    ? [
        value.getFullYear(),
        String(value.getMonth() + 1).padStart(2, '0'),
        String(value.getDate()).padStart(2, '0')
      ].join('-')
    : String(value).slice(0, 10);

  return isDataVendaValida(texto) ? texto : '';
}

/**
 * Renderiza normalizar data venda input.
 */
function normalizarDataVendaInput(value) {
  if (!value) return '';

  const texto = String(value).trim();
  const iso = toInputDate(texto);

  if (iso) return iso;

  const match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

  if (!match) return '';

  const [, dia, mes, ano] = match;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  const data = `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;

  return isDataVendaValida(data) ? data : '';
}

/**
 * Gera protocolo data hora a partir dos dados informados.
 */
function gerarProtocoloDataHora(data = new Date()) {
  /**
   * Preenche valores numericos com zero a esquerda.
   */
  const pad = value => String(value).padStart(2, '0');

  return [
    data.getFullYear(),
    pad(data.getMonth() + 1),
    pad(data.getDate()),
    pad(data.getHours()),
    pad(data.getMinutes()),
    pad(data.getSeconds())
  ].join('');
}

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(value) {
  if (!value) return '-';

  const date = toInputDate(value);
  if (!date) return '-';

  const [ano, mes, dia] = date.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : value;
}

/**
 * Formata data hora registro para exibicao ou envio.
 */
function formatarDataHoraRegistro(value) {
  return formatUtcDateTime(value, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }, '-');
}

/**
 * Verifica se data venda valida atende a condicao esperada.
 */
function isDataVendaValida(value) {
  if (!value) return false;

  const texto = String(value).slice(0, 10);
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return false;

  const [, ano, mes, dia] = match;
  const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);

  return Number(ano) >= 1900
    && data.getFullYear() === Number(ano)
    && data.getMonth() + 1 === Number(mes)
    && data.getDate() === Number(dia);
}

/**
 * Formata moeda para exibicao ou envio.
 */
function formatarMoeda(value) {
  if (value === null || value === undefined || value === '') return '-';

  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Renderiza parse valor input.
 */
function parseValorInput(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  return Number(String(valor).replace(/\./g, '').replace(',', '.')) || 0;
}

/**
 * Formata input moeda br para exibicao ou envio.
 */
function formatarInputMoedaBR(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');

  if (!digitos) return '';

  const numero = Number(digitos) / 100;

  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Processa apenas digitos conforme as regras do dominio.
 */
function apenasDigitos(valor, limite) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return limite ? digitos.slice(0, limite) : digitos;
}

/**
 * Formata telefone com ddd para exibicao ou envio.
 */
function formatarTelefoneComDdd(valor, celular = true) {
  const limite = celular ? 11 : 10;
  const digitos = apenasDigitos(valor, limite);

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
 * Formata cpf para exibicao ou envio.
 */
function formatarCpf(valor) {
  const digitos = apenasDigitos(valor, 11);

  if (digitos.length <= 3) return digitos;
  if (digitos.length <= 6) return `${digitos.slice(0, 3)}.${digitos.slice(3)}`;
  if (digitos.length <= 9) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6)}`;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

/**
 * Valida cpf e retorna o resultado esperado.
 */
function validarCpf(valor) {
  const cpf = apenasDigitos(valor, 11);

  if (!cpf) return true;
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  /**
   * Calcula digito com base nos valores informados.
   */
  const calcularDigito = tamanho => {
    let soma = 0;

    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(cpf[i]) * (tamanho + 1 - i);
    }

    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(9) === Number(cpf[9]) && calcularDigito(10) === Number(cpf[10]);
}

/**
 * Obtem erro cpf venda a partir dos dados informados.
 */
function obterErroCpfVenda(form) {
  if (!validarCpf(form.cpf_representante_legal)) {
    return 'CPF RL inválido. Confira os 11 dígitos antes de salvar.';
  }

  if (!validarCpf(form.cpf_administrador)) {
    return 'CPF ADM inválido. Confira os 11 dígitos antes de salvar.';
  }

  return '';
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
 * Formata cep para exibicao ou envio.
 */
function formatarCep(valor) {
  const digitos = apenasDigitos(valor, 8);

  if (digitos.length <= 5) return digitos;
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

/**
 * Formata dia vencimento para exibicao ou envio.
 */
function formatarDiaVencimento(valor) {
  const digitos = apenasDigitos(valor, 2);
  if (!digitos) return '';

  const dia = Math.min(Number(digitos), 31);
  return dia > 0 ? String(dia) : '';
}

/**
 * Formata campo venda para exibicao ou envio.
 */
function formatarCampoVenda(campo, valor) {
  if (campo === 'telefone' || campo === 'telefone_representante_legal' || campo === 'telefone_administrador') return formatarTelefoneComDdd(valor, true);
  if (campo === 'fixo_ddd') return formatarTelefoneComDdd(valor, false);
  if (campo === 'cpf_representante_legal' || campo === 'cpf_administrador') return formatarCpf(valor);
  if (campo === 'cnpj') return formatarCnpj(valor);
  if (campo === 'cep' || campo === 'cep_real') return formatarCep(valor);
  if (campo === 'uf' || campo === 'uf_real') return String(valor || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
  if (campo === 'ddd') return apenasDigitos(valor, 2);
  if (campo === 'gb') return apenasDigitos(valor, 4);
  if (campo === 'quantidade_linhas') return apenasDigitos(valor, 4);
  if (campo === 'dia_vencimento') return formatarDiaVencimento(valor);
  return valor;
}

/**
 * Formata busca por campo para exibicao ou envio.
 */
function formatarBuscaPorCampo(campo, valor) {
  if (campo === 'protocolo') return apenasDigitos(valor);
  if (campo === 'telefone') return formatarTelefoneComDdd(valor, true);
  if (campo === 'cnpj') return formatarCnpj(valor);
  return valor;
}

/**
 * Retorna input mode busca a partir dos dados informados.
 */
function getInputModeBusca(campo) {
  return ['protocolo', 'telefone', 'cnpj'].includes(campo) ? 'numeric' : undefined;
}

/**
 * Retorna max length busca a partir dos dados informados.
 */
function getMaxLengthBusca(campo) {
  if (campo === 'telefone') return 15;
  if (campo === 'cnpj') return 18;
  return undefined;
}

/**
 * Retorna placeholder busca a partir dos dados informados.
 */
function getPlaceholderBusca(campo) {
  const placeholders = {
    geral: 'Buscar por protocolo, nome, telefone, tipo, produto, CNPJ ou cidade',
    protocolo: 'Buscar por protocolo',
    cliente: 'Buscar por nome ou razão social',
    telefone: '(11) 99999-9999',
    tipo_venda: 'Selecione o tipo de venda',
    produto: 'Selecione o produto',
    cnpj: '00.000.000/0000-00',
    cidade: 'Buscar por cidade'
  };

  return placeholders[campo] || placeholders.geral;
}

/**
 * Retorna input mode campo a partir dos dados informados.
 */
function getInputModeCampo(campo) {
  if ([
    'telefone', 'fixo_ddd', 'telefone_representante_legal', 'telefone_administrador',
    'cpf_representante_legal', 'cpf_administrador', 'cnpj', 'cep', 'cep_real', 'ddd', 'gb', 'quantidade_linhas', 'dia_vencimento'
  ].includes(campo)) {
    return 'numeric';
  }

  return undefined;
}

/**
 * Retorna max length campo a partir dos dados informados.
 */
function getMaxLengthCampo(campo, maxLength) {
  const limites = {
    telefone: 15,
    fixo_ddd: 14,
    telefone_representante_legal: 15,
    telefone_administrador: 15,
    cpf_representante_legal: 14,
    cpf_administrador: 14,
    cnpj: 18,
    cep: 9,
    cep_real: 9,
    ddd: 2,
    gb: 4,
    uf: 2,
    uf_real: 2,
    dia_vencimento: 2,
    quantidade_linhas: 4
  };

  return limites[campo] || maxLength;
}

/**
 * Renderiza normalizar itens chips input.
 */
function normalizarItensChipsInput(itens) {
  return Array.isArray(itens) ? itens : parseItensChips(itens);
}

/**
 * Renderiza normalizar ids vendedoras input.
 */
function normalizarIdsVendedorasInput(vendedoras) {
  if (!Array.isArray(vendedoras)) return [];

  return Array.from(new Set(
    vendedoras
      .map(item => {
        if (item && typeof item === 'object') {
          return Number(item.id || item.usuario_id || item.vendedora_id);
        }

        return Number(item);
      })
      .filter(Number.isInteger)
      .filter(id => id > 0)
  ));
}

/**
 * Obtem solicitacao aprovacao atual a partir dos dados informados.
 */
function obterSolicitacaoAprovacaoAtual(venda) {
  if (!Array.isArray(venda?.aprovacaoSolicitacoes)) return null;

  return venda.aprovacaoSolicitacoes.find(item => item.status !== 'obsoleta') || null;
}

/**
 * Calcula total itens chips com base nos valores informados.
 */
function calcularTotalItensChips(itens = []) {
  return normalizarItensChipsInput(itens).reduce((acc, item) => (
    acc + (Number(item.quantidade || 0) * parseValorInput(item.valor_unitario))
  ), 0);
}

/**
 * Resume gigas itens chips para exibicao ou envio.
 */
function resumirGigasItensChips(itens = []) {
  const valores = normalizarItensChipsInput(itens)
    .map(item => String(item.gb || '').trim())
    .filter(Boolean);

  return Array.from(new Set(valores)).join(', ');
}

/**
 * Normaliza tipo linha chip para uso interno consistente.
 */
function normalizarTipoLinhaChip(valor, fallback = 'novo') {
  const texto = normalizarTextoBusca(valor);
  if (texto.includes('porta')) return 'portabilidade';
  if (texto.includes('novo')) return 'novo';
  return fallback;
}

/**
 * Soma quantidade itens chips considerando os dados informados.
 */
function somarQuantidadeItensChips(itens = []) {
  return normalizarItensChipsInput(itens).reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
}

/**
 * Processa limitar itens chips por quantidade linhas conforme as regras do dominio.
 */
function limitarItensChipsPorQuantidadeLinhas(itens = [], limiteQuantidade = 0) {
  const lista = normalizarItensChipsInput(itens);
  const limite = Number(limiteQuantidade || 0);

  if (limite <= 0) return lista;

  let restante = limite;

  return lista.map(item => {
    const quantidadeAtual = Number(item.quantidade || 0);
    const quantidade = Math.min(quantidadeAtual, restante);
    restante = Math.max(restante - quantidade, 0);

    return {
      ...item,
      quantidade: quantidade > 0 ? String(quantidade) : ''
    };
  });
}

/**
 * Soma quantidade portabilidade itens chips considerando os dados informados.
 */
function somarQuantidadePortabilidadeItensChips(itens = []) {
  return normalizarItensChipsInput(itens).reduce((acc, item) => (
    normalizarTipoLinhaChip(item.tipo_linha) === 'portabilidade'
      ? acc + Number(item.quantidade || 0)
      : acc
  ), 0);
}

/**
 * Verifica se chip portabilidade esta presente nos dados informados.
 */
function temChipPortabilidade(itens = []) {
  return somarQuantidadePortabilidadeItensChips(itens) > 0;
}

/**
 * Formata tipo linha chip label para exibicao ou envio.
 */
function formatarTipoLinhaChipLabel(tipo) {
  return normalizarTipoLinhaChip(tipo) === 'portabilidade' ? 'Portabilidade' : 'Novo';
}

/**
 * Resume tipos linha itens chips para exibicao ou envio.
 */
function resumirTiposLinhaItensChips(itens = []) {
  const tipos = normalizarItensChipsInput(itens)
    .map(item => formatarTipoLinhaChipLabel(item.tipo_linha || item.tipo || item.categoria))
    .filter(Boolean);

  return Array.from(new Set(tipos)).join(', ');
}

/**
 * Obtem tipo venda tabela a partir dos dados informados.
 */
function obterTipoVendaTabela(venda = {}) {
  return venda.tipoVenda?.nome
    || resumirTiposLinhaItensChips(venda.valores_unitarios_chips)
    || venda.produto_fechado
    || '-';
}

/**
 * Renderiza obter categoria produto whatsapp.
 */
function obterCategoriaProdutoWhatsapp(venda = {}) {
  const texto = normalizarTextoBusca([
    venda.servico?.nome,
    venda.produto_fechado,
    venda.tipoVenda?.nome
  ].filter(Boolean).join(' '));

  if (texto.includes('internet') || texto.includes('banda larga') || texto.includes('fibra')) return 'Internet';
  if (texto.includes('fixo') || texto.includes('telefone fixo')) return 'Fixo';
  if (texto.includes('movel') || texto.includes('chip') || texto.includes('celular') || texto.includes('linha')) return 'Móvel';

  return formatarNomeServico(venda.servico?.nome) || venda.produto_fechado || '-';
}

/**
 * Obtem vendedoras mensagem a partir dos dados informados.
 */
function obterVendedorasMensagem(venda = {}) {
  const nomes = Array.isArray(venda.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras.map(item => item?.nome).filter(Boolean)
    : [venda.vendedora?.nome].filter(Boolean);

  return nomes.length > 0 ? nomes.join(', ') : '-';
}

/**
 * Obtem resumo chips mensagem a partir dos dados informados.
 */
function obterResumoChipsMensagem(venda = {}) {
  const itens = normalizarItensChipsInput(venda.valores_unitarios_chips)
    .filter(item => Number(item.quantidade || 0) > 0 || item.gb || item.valor_unitario || item.tipo_linha);

  if (itens.length === 0) {
    return [
      `Valor: ${formatarMoeda(venda.valor_total)}`,
      `Quantidade: ${venda.quantidade_linhas || '-'}`,
      `Giga: ${venda.gb || '-'}`,
      `Tipo: ${obterTipoVendaTabela(venda)}`
    ].join(' | ');
  }

  return itens.map(item => {
    const partes = [
      `${item.quantidade || 0} linha(s)`,
      item.gb ? `${item.gb}GB` : '',
      item.valor_unitario ? formatarMoeda(parseValorInput(item.valor_unitario)) : '',
      formatarTipoLinhaChipLabel(item.tipo_linha)
    ].filter(Boolean);

    return partes.join(' - ');
  }).join('; ');
}

/**
 * Obtem documentos faltantes mensagem a partir dos dados informados.
 */
function obterDocumentosFaltantesMensagem(venda = {}) {
  const faltantes = [];

  if (venda.nome_representante_legal && !venda.rg_representante_legal) {
    faltantes.push('RG do representante legal');
  }

  if (venda.nome_administrador && !venda.rg_administrador) {
    faltantes.push('RG do administrador');
  }

  [
    { nome: venda.responsavel_recebimento, rg: venda.rg_responsavel_recebimento },
    { nome: venda.responsavel_recebimento_2, rg: venda.rg_responsavel_recebimento_2 },
    { nome: venda.responsavel_recebimento_3, rg: venda.rg_responsavel_recebimento_3 }
  ].forEach((responsavel, index) => {
    if (responsavel.nome && !responsavel.rg) {
      faltantes.push(`RG do responsável pelo recebimento ${index + 1}`);
    }
  });

  if (venda.cnpj && !venda.razao_social && !venda.cliente?.razao_social) {
    faltantes.push('documento da empresa');
  }

  return faltantes.length > 0 ? faltantes.join(', ') : '[preencher se faltar RG, doc da empresa, fatura...]';
}

/**
 * Monta mensagem whatsapp venda a partir dos dados informados.
 */
function montarMensagemWhatsappVenda(venda = {}) {
  return [
    'Olá! Seguem os dados da venda:',
    '',
    `Operadora: ${venda.operadora?.nome || '-'}`,
    `Razão social: ${venda.cliente?.razao_social || venda.razao_social || '-'}`,
    `CNPJ: ${formatarCnpj(venda.cliente?.cnpj || venda.cnpj || '') || '-'}`,
    `Produto: ${obterCategoriaProdutoWhatsapp(venda)}`,
    `Detalhes da venda: ${obterResumoChipsMensagem(venda)}`,
    `Valor total: ${formatarMoeda(venda.valor_total)}`,
    `Vendedora(s): ${obterVendedorasMensagem(venda)}`,
    `Protocolo: ${venda.protocolo || '-'}`,
    `Data da venda: ${formatarData(venda.data_venda)}`,
    `Falta doc: ${obterDocumentosFaltantesMensagem(venda)}`
  ].join('\n');
}

const DOCUMENTOS_FALTANTES_WHATSAPP = [
  'RG do representante legal',
  'RG do administrador',
  'RG do responsável pelo recebimento',
  'Documento da empresa',
  'Fatura',
  'Contrato social',
  'Comprovante de endereco'
];

/**
 * Obtem documentos faltantes padrao a partir dos dados informados.
 */
export function obterDocumentosFaltantesPadrao(venda = {}) {
  const texto = obterDocumentosFaltantesMensagem(venda);
  if (!texto || texto.startsWith('[')) return [];
  return texto.split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Renderiza formatar resumo venda whatsapp.
 */
function formatarResumoVendaWhatsapp(venda = {}) {
  const itens = normalizarItensChipsInput(venda.valores_unitarios_chips)
    .filter(item => Number(item.quantidade || 0) > 0 || item.valor_unitario || item.gb || item.tipo_linha);
  const tipo = resumirTiposLinhaItensChips(itens) || obterTipoVendaTabela(venda);
  const quantidade = venda.quantidade_linhas || somarQuantidadeItensChips(itens) || '-';

  if (itens.length === 0) {
    const giga = venda.gb ? ` x ${venda.gb}GB` : '';
    return `${tipo} - ${quantidade} linha(s) - 1 x ${formatarMoeda(venda.valor_total)}${giga}`;
  }

  const detalhes = itens.map(item => {
    const quantidadeItem = Number(item.quantidade || 0) || 1;
    const valor = item.valor_unitario ? formatarMoeda(parseValorInput(item.valor_unitario)) : formatarMoeda(venda.valor_total);
    const giga = item.gb || venda.gb;

    return `${quantidadeItem} x ${valor}${giga ? ` x ${giga}GB` : ''}`;
  });

  return `${tipo} - ${quantidade} linha(s) - ${detalhes.join(' - ')}`;
}

/**
 * Monta checklist whatsapp venda a partir dos dados informados.
 */
export function montarChecklistWhatsappVenda(venda = {}, documentosFaltantes = obterDocumentosFaltantesPadrao(venda)) {
  const produto = obterCategoriaProdutoWhatsapp(venda);
  const razaoSocial = venda.cliente?.razao_social || venda.razao_social || '-';
  const documentos = documentosFaltantes.length > 0 ? documentosFaltantes.join(', ') : 'NAO';

  return [
    `OPERADORA : ${venda.operadora?.nome || '-'}`,
    `RAZAO SOCIAL : ${razaoSocial}`,
    `CNPJ : ${formatarCnpj(venda.cliente?.cnpj || venda.cnpj || '') || '-'}`,
    `PRODUTO : ${produto}`,
    `VENDA : ${formatarResumoVendaWhatsapp(venda)}`,
    `VENDEDORA(S) : ${obterVendedorasMensagem(venda)}`,
    `PROTOCOLO : ${venda.protocolo || '-'}`,
    `DATA DA VENDA : ${formatarData(venda.data_venda)}`,
    `FALTA DOC : ${documentos}`
  ].join('\n');
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
 * Converte itens chips para o formato interno esperado.
 */
function parseItensChips(valor, gbPadrao = '', tipoLinhaPadrao = 'novo') {
  if (!valor) return [{ ...ITEM_CHIP_VAZIO }];

  if (Array.isArray(valor)) {
    const itens = valor.map(item => ({
      quantidade: item.quantidade ? String(item.quantidade) : '',
      gb: formatarCampoVenda('gb', item.gb || gbPadrao || ''),
      valor_unitario: item.valor_unitario ? String(item.valor_unitario).replace('.', ',') : '',
      tipo_linha: normalizarTipoLinhaChip(item.tipo_linha || item.tipo || item.categoria, tipoLinhaPadrao),
      vendedora_id: item.vendedora_id ? String(item.vendedora_id) : ''
    }));

    return itens.length > 0 ? itens : [{ ...ITEM_CHIP_VAZIO }];
  }

  if (typeof valor === 'string') {
    try {
      return parseItensChips(JSON.parse(valor), gbPadrao, tipoLinhaPadrao);
    } catch {
      const itens = valor
        .split(/\r?\n/)
        .map(linha => linha.trim())
        .filter(Boolean)
        .map(linha => {
          const match = linha.match(/^(\d+)\s*x\s*([\d.,]+)$/i);

          if (!match) return null;

          return {
            quantidade: match[1],
            gb: formatarCampoVenda('gb', gbPadrao || ''),
            valor_unitario: match[2],
            tipo_linha: tipoLinhaPadrao
          };
        })
        .filter(Boolean);

      return itens.length > 0 ? itens : [{ ...ITEM_CHIP_VAZIO }];
    }
  }

  return [{ ...ITEM_CHIP_VAZIO }];
}

/**
 * Normaliza texto busca para uso interno consistente.
 */
function normalizarTextoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Verifica se tipo portabilidade atende a condicao esperada.
 */
function isTipoPortabilidade(tipoVenda) {
  return normalizarTextoBusca(tipoVenda?.nome).includes('portabilidade');
}

/**
 * Converte numeros portados para o formato interno esperado.
 */
function parseNumerosPortados(valor) {
  if (!valor) return [NUMERO_PORTADO_VAZIO];

  if (Array.isArray(valor)) {
    const numeros = valor
      .map(item => String(item || '').trim())
      .filter(Boolean);

    return numeros.length > 0 ? numeros : [NUMERO_PORTADO_VAZIO];
  }

  if (typeof valor === 'string') {
    try {
      return parseNumerosPortados(JSON.parse(valor));
    } catch {
      const numeros = valor
        .split(/\r?\n|[,;]/)
        .map(item => item.trim())
        .filter(Boolean);

      return numeros.length > 0 ? numeros : [NUMERO_PORTADO_VAZIO];
    }
  }

  return [NUMERO_PORTADO_VAZIO];
}

/**
 * Monta numeros portados a partir dos dados informados.
 */
function montarNumerosPortados(valor) {
  return (Array.isArray(valor) ? valor : parseNumerosPortados(valor))
    .map(item => String(item || '').trim())
    .filter(item => apenasDigitos(item).length > 2)
    .join('\n');
}

const parseNumerosAtivados = parseNumerosPortados;
const montarNumerosAtivados = montarNumerosPortados;

/**
 * Converte cliente solicitou servicos para o formato interno esperado.
 */
function parseClienteSolicitouServicos(valor) {
  if (!valor) return [];

  if (Array.isArray(valor)) {
    const servicos = valor
      .map(item => String(item || '').trim())
      .filter(item => CLIENTE_SOLICITOU_OPCOES.some(opcao => opcao.value === item));

    return servicos.includes('nenhum_servico')
      ? ['nenhum_servico']
      : CLIENTE_SOLICITOU_ACOES.filter(item => servicos.includes(item));
  }

  if (typeof valor === 'string') {
    try {
      return parseClienteSolicitouServicos(JSON.parse(valor));
    } catch {
      return parseClienteSolicitouServicos(valor.split(/\r?\n|[,;]/));
    }
  }

  return [];
}

/**
 * Converte cliente solicitou numeros para o formato interno esperado.
 */
function parseClienteSolicitouNumeros(valor) {
  const vazio = { bloqueio: [], cancelamento: [] };
  if (!valor) return vazio;

  if (typeof valor === 'string') {
    try {
      return parseClienteSolicitouNumeros(JSON.parse(valor));
    } catch {
      return vazio;
    }
  }

  if (typeof valor !== 'object') return vazio;

  return {
    bloqueio: parseNumerosPortados(valor.bloqueio).filter(numero => apenasDigitos(numero).length > 2),
    cancelamento: parseNumerosPortados(valor.cancelamento).filter(numero => apenasDigitos(numero).length > 2)
  };
}

/**
 * Monta cliente solicitou numeros a partir dos dados informados.
 */
function montarClienteSolicitouNumeros(numeros = {}) {
  return {
    bloqueio: (Array.isArray(numeros.bloqueio) ? numeros.bloqueio : parseNumerosPortados(numeros.bloqueio))
      .map(numero => String(numero || '').trim())
      .filter(numero => apenasDigitos(numero).length > 2),
    cancelamento: (Array.isArray(numeros.cancelamento) ? numeros.cancelamento : parseNumerosPortados(numeros.cancelamento))
      .map(numero => String(numero || '').trim())
      .filter(numero => apenasDigitos(numero).length > 2)
  };
}

/**
 * Processa ajustar quantidade numeros solicitados conforme as regras do dominio.
 */
function ajustarQuantidadeNumerosSolicitados(value, quantidade) {
  const total = Math.max(Number(quantidade || 0), 0);
  const atuais = Array.isArray(value) ? value : parseNumerosPortados(value);

  return Array.from({ length: total }, (_, index) => atuais[index] || NUMERO_PORTADO_VAZIO);
}

/**
 * Normaliza venda para uso interno consistente.
 */
function normalizarVenda(venda) {
  // Montar array de vendedoras a partir da relação (junction) ou do campo legado
  const vendedorasIds = Array.isArray(venda.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras.map(v => String(v.id || v))
    : venda.vendedora_id ? [String(venda.vendedora_id)] : [];
  const tipoLinhaPadrao = isTipoPortabilidade(venda.tipoVenda) ? 'portabilidade' : 'novo';

  return {
    ...VENDA_VAZIA,
    ...venda,
    data_venda: toInputDate(venda.data_venda),
    data_ativacao: toInputDate(venda.data_ativacao),
    valor_total: venda.valor_total ?? '',
    valores_unitarios_chips: parseItensChips(venda.valores_unitarios_chips, venda.gb, tipoLinhaPadrao),
    numeros_portados: parseNumerosPortados(venda.numeros_portados),
    numeros_ativados: parseNumerosAtivados(venda.numeros_ativados),
    cliente_solicitou_servicos: parseClienteSolicitouServicos(venda.cliente_solicitou_servicos),
    cliente_solicitou_bloqueio_qtd: venda.cliente_solicitou_bloqueio_qtd ?? '',
    cliente_solicitou_cancelamento_qtd: venda.cliente_solicitou_cancelamento_qtd ?? '',
    cliente_solicitou_numeros: parseClienteSolicitouNumeros(venda.cliente_solicitou_numeros),
    quantidade_linhas: venda.quantidade_linhas ?? '',
    dia_vencimento: venda.dia_vencimento ?? '',
    operadora_id: venda.operadora_id ? String(venda.operadora_id) : '',
    tipo_venda_id: venda.tipo_venda_id ? String(venda.tipo_venda_id) : '',
    servico_id: venda.servico_id ? String(venda.servico_id) : '',
    vendedora_id: venda.vendedora_id ? String(venda.vendedora_id) : '',
    vendedoras: vendedorasIds,
    cliente_id: venda.cliente_id ? String(venda.cliente_id) : ''
  };
}

/**
 * Renderiza itens chips input.
 */
function ItensChipsInput({ value, onChange, vendedoras = [], limiteQuantidade = 0 }) {
  const itens = Array.isArray(value) && value.length > 0 ? value : [{ ...ITEM_CHIP_VAZIO }];
  const total = calcularTotalItensChips(itens);
  const mostrarVendedora = vendedoras.length > 1;
  const limite = Number(limiteQuantidade || 0);
  const quantidadeTotal = somarQuantidadeItensChips(itens);
  const limiteAtingido = limite > 0 && quantidadeTotal >= limite;

  /**
   * Atualiza item com os dados informados.
   */
  function atualizarItem(index, campo, novoValor) {
    let valor = novoValor;

    if (campo === 'quantidade') {
      const outros = itens.reduce((acc, item, itemIndex) => (
        itemIndex === index ? acc : acc + Number(item.quantidade || 0)
      ), 0);
      const maximo = limite > 0 ? Math.max(limite - outros, 0) : 9999;
      const quantidade = Math.min(Number(apenasDigitos(valor, 4) || 0), maximo);
      valor = quantidade > 0 ? String(quantidade) : '';
    }

    onChange(itens.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return { ...item, [campo]: valor };
    }));
  }

  /**
   * Adiciona item ao conjunto atual.
   */
  function adicionarItem() {
    if (limiteAtingido) return;
    onChange([...itens, { ...ITEM_CHIP_VAZIO }]);
  }

  /**
   * Remove item da colecao ou estado atual.
   */
  function removerItem(index) {
    const proximos = itens.filter((_, itemIndex) => itemIndex !== index);
    onChange(proximos.length > 0 ? proximos : [{ ...ITEM_CHIP_VAZIO }]);
  }

  return (
    <div className={`chip-items${mostrarVendedora ? ' chip-items--com-vendedora' : ''}`}>
      <div className="chip-items__head">
        <span>Qtd.</span>
        <span>GB</span>
        <span>Tipo</span>
        <span>Valor unit.</span>
        <span>Subtotal</span>
        {mostrarVendedora && <span>Vendedora</span>}
        <span></span>
      </div>

      {itens.map((item, index) => {
        const subtotal = Number(item.quantidade || 0) * parseValorInput(item.valor_unitario);
        const outros = itens.reduce((acc, chip, itemIndex) => (
          itemIndex === index ? acc : acc + Number(chip.quantidade || 0)
        ), 0);
        const maximoQuantidadeLinha = limite > 0 ? Math.max(limite - outros, 0) : undefined;

        return (
          <div key={index} className="chip-item-row">
            <input
              type="number"
              min="1"
              max={maximoQuantidadeLinha}
              value={item.quantidade}
              onChange={e => atualizarItem(index, 'quantidade', e.target.value)}
              placeholder="3"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={getMaxLengthCampo('gb')}
              value={item.gb}
              onChange={e => atualizarItem(index, 'gb', formatarCampoVenda('gb', e.target.value))}
              placeholder="20"
            />
            <SelectFiltro
              value={item.tipo_linha || 'novo'}
              onChange={val => atualizarItem(index, 'tipo_linha', val)}
              options={TIPOS_LINHA_CHIP}
              placeholder="Novo"
            />
            <input
              type="text"
              inputMode="decimal"
              value={item.valor_unitario}
              onChange={e => atualizarItem(index, 'valor_unitario', formatarInputMoedaBR(e.target.value))}
              placeholder="29,99"
            />
            <div className="chip-item-subtotal">{formatarMoeda(subtotal)}</div>
            {mostrarVendedora && (
              <SelectFiltro
                value={item.vendedora_id || ''}
                onChange={val => atualizarItem(index, 'vendedora_id', val)}
                options={vendedoras.map(v => ({ value: String(v.id), label: v.nome }))}
                placeholder="—"
              />
            )}
            <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => removerItem(index)} title="Remover item">
              <I.Trash size={13} />
            </button>
          </div>
        );
      })}

      <div className="chip-items__footer">
        <button type="button" className="btn btn-sm" onClick={adicionarItem} disabled={limiteAtingido}>
          <I.Plus size={13} /> Adicionar chip
        </button>
        <div className="chip-items__summary">
          {limite > 0 && <span>{quantidadeTotal}/{limite} chips</span>}
          <strong>{formatarMoeda(total)}</strong>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza vendedoras select.
 */
export function VendedorasSelect({ value = [], options = [], onChange }) {
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const [buscaVendedora, setBuscaVendedora] = useState('');
  const buscaVendedoraDeferred = useDeferredValue(buscaVendedora);
  const wrapperRef = useRef(null);
  const buscaInputRef = useRef(null);

  const selecionadas = options.filter(v => value.includes(String(v.id)));
  const disponiveis = options.filter(v => !value.includes(String(v.id)));
  const termoBuscaVendedora = normalizarTextoBusca(buscaVendedoraDeferred);
  const disponiveisFiltradas = termoBuscaVendedora
    ? disponiveis.filter(v => normalizarTextoBusca(v.nome).includes(termoBuscaVendedora))
    : disponiveis;

  useEffect(() => {
    /**
     * Trata o evento de click fora.
     */
    function handleClickFora(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setDropdownAberto(false);
        setBuscaVendedora('');
      }
    }
    document.addEventListener('mousedown', handleClickFora);
    return () => document.removeEventListener('mousedown', handleClickFora);
  }, []);

  useEffect(() => {
    if (dropdownAberto) buscaInputRef.current?.focus();
  }, [dropdownAberto]);

  /**
   * Adiciona  ao conjunto atual.
   */
  function adicionar(vendedora) {
    onChange([...value, String(vendedora.id)]);
    setDropdownAberto(false);
    setBuscaVendedora('');
  }

  /**
   * Remove  da colecao ou estado atual.
   */
  function remover(id) {
    onChange(value.filter(v => v !== String(id)));
  }

  /**
   * Alterna dropdown no estado atual.
   */
  function alternarDropdown() {
    if (dropdownAberto) setBuscaVendedora('');
    setDropdownAberto(prev => !prev);
  }

  return (
    <div className="vendedoras-select" ref={wrapperRef}>
      <div className="vendedoras-chips">
        {selecionadas.map(v => (
          <span key={v.id} className="vendedoras-chip">
            {v.nome}
            <button type="button" onClick={() => remover(v.id)} title="Remover">
              <I.Close size={11} />
            </button>
          </span>
        ))}
        {disponiveis.length > 0 && (
          <button
            type="button"
            className="btn btn-sm vendedoras-add-btn"
            onClick={alternarDropdown}
          >
            <I.Plus size={13} /> Adicionar vendedora
          </button>
        )}
      </div>
      {dropdownAberto && disponiveis.length > 0 && (
        <div className="vendedoras-dropdown">
          <label className="vendedoras-dropdown__search">
            <I.Search size={14} />
            <input
              ref={buscaInputRef}
              type="search"
              value={buscaVendedora}
              onChange={event => setBuscaVendedora(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
              placeholder="Buscar vendedora"
              aria-label="Buscar vendedora"
            />
          </label>
          <div className="vendedoras-dropdown__list">
            {disponiveisFiltradas.map(v => (
              <button key={v.id} type="button" className="vendedoras-dropdown__item" onClick={() => adicionar(v)}>
                {v.nome}
              </button>
            ))}
            {disponiveisFiltradas.length === 0 && (
              <div className="vendedoras-dropdown__empty">Nenhuma vendedora encontrada</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Monta prefixo ddd a partir dos dados informados.
 */
function montarPrefixoDdd(ddd) {
  const digitos = apenasDigitos(ddd, 2);
  return digitos.length === 2 ? `(${digitos}) ` : '';
}

/**
 * Verifica se numero linha tem apenas ddd ou vazio atende a condicao esperada.
 */
function numeroLinhaTemApenasDddOuVazio(valor) {
  return apenasDigitos(valor).length <= 2;
}

/**
 * Processa ajustar quantidade numeros portados conforme as regras do dominio.
 */
function ajustarQuantidadeNumerosPortados(value, quantidade, dddPadrao = '') {
  const total = Math.max(Number(quantidade || 0), 0);
  const prefixoDdd = montarPrefixoDdd(dddPadrao);
  if (total === 0) return [prefixoDdd || NUMERO_PORTADO_VAZIO];

  const atuais = Array.isArray(value) ? value : parseNumerosPortados(value);
  const preenchidos = atuais.length > 0 ? atuais : [NUMERO_PORTADO_VAZIO];

  return Array.from({ length: total }, (_, index) => {
    const atual = preenchidos[index] || NUMERO_PORTADO_VAZIO;
    return numeroLinhaTemApenasDddOuVazio(atual) ? (prefixoDdd || NUMERO_PORTADO_VAZIO) : atual;
  });
}

/**
 * Renderiza numeros linha input.
 */
function NumerosLinhaInput({ value, onChange, quantidadeEsperada = 0, dddPadrao = '', labelAdicionar = 'Adicionar número' }) {
  const numeros = Array.isArray(value) && value.length > 0 ? value : [NUMERO_PORTADO_VAZIO];
  const limite = Math.max(Number(quantidadeEsperada || 0), 0);
  const limiteAtingido = limite > 0 && numeros.length >= limite;
  const numeroVazio = montarPrefixoDdd(dddPadrao) || NUMERO_PORTADO_VAZIO;

  /**
   * Atualiza numero com os dados informados.
   */
  function atualizarNumero(index, novoValor) {
    onChange(numeros.map((numero, numeroIndex) => (
      numeroIndex === index ? novoValor : numero
    )));
  }

  /**
   * Adiciona numero ao conjunto atual.
   */
  function adicionarNumero() {
    if (limiteAtingido) return;
    onChange([...numeros, numeroVazio]);
  }

  /**
   * Remove numero da colecao ou estado atual.
   */
  function removerNumero(index) {
    const proximos = numeros.filter((_, numeroIndex) => numeroIndex !== index);
    onChange(proximos.length > 0 ? proximos : [NUMERO_PORTADO_VAZIO]);
  }

  return (
    <div className="ported-numbers">
      {numeros.map((numero, index) => (
        <div key={index} className="ported-number-row">
          <input
            type="text"
            inputMode="numeric"
            value={numero}
            onChange={event => atualizarNumero(index, formatarTelefoneComDdd(event.target.value, true))}
            placeholder="(11) 99999-9999"
            maxLength={15}
          />
          <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => removerNumero(index)} title="Remover número">
            <I.Trash size={13} />
          </button>
        </div>
      ))}

      <div className="ported-numbers__footer">
        <button type="button" className="btn btn-sm" onClick={adicionarNumero} disabled={limiteAtingido}>
          <I.Plus size={13} /> {labelAdicionar}
        </button>
        {limite > 0 && <span>{numeros.length}/{limite} números</span>}
      </div>
    </div>
  );
}

/**
 * Renderiza numeros portados input.
 */
function NumerosPortadosInput(props) {
  return <NumerosLinhaInput {...props} labelAdicionar="Adicionar número" />;
}

/**
 * Renderiza numeros ativados input.
 */
function NumerosAtivadosInput(props) {
  return <NumerosLinhaInput {...props} labelAdicionar="Adicionar número ativado" />;
}

/**
 * Renderiza cliente solicitou input.
 */
function ClienteSolicitouInput({ form, onToggle, onOpenQuantidades }) {
  const servicos = parseClienteSolicitouServicos(form.cliente_solicitou_servicos);
  const nenhumSelecionado = servicos.includes('nenhum_servico');
  const selecionouAcao = CLIENTE_SOLICITOU_ACOES.some(acao => servicos.includes(acao));
  const numeros = parseClienteSolicitouNumeros(form.cliente_solicitou_numeros);
  const totalNumeros = numeros.bloqueio.length + numeros.cancelamento.length;

  return (
    <div className="cliente-solicitou">
      <div className="cliente-solicitou__options">
        {CLIENTE_SOLICITOU_OPCOES.map(opcao => {
          const marcado = servicos.includes(opcao.value);
          const disabled = nenhumSelecionado && opcao.value !== 'nenhum_servico';

          return (
            <label key={opcao.value} className={`cliente-solicitou-option ${marcado ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={marcado}
                disabled={disabled}
                onChange={() => onToggle(opcao.value)}
              />
              <span>{opcao.label}</span>
            </label>
          );
        })}
      </div>

      {selecionouAcao && (
        <div className="cliente-solicitou__summary">
          <span>Bloqueio: <strong>{Number(form.cliente_solicitou_bloqueio_qtd || 0)}</strong></span>
          <span>Cancelamento: <strong>{Number(form.cliente_solicitou_cancelamento_qtd || 0)}</strong></span>
          <span>Números: <strong>{totalNumeros}</strong></span>
          <button type="button" className="btn btn-sm" onClick={onOpenQuantidades}>
            <I.Edit size={13} /> Quantificar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza cliente solicitou quantidade modal.
 */
function ClienteSolicitouQuantidadeModal({ servicos, quantidades, onChange, onClose, onConfirm }) {
  const bloqueioSelecionado = servicos.includes('bloqueio');
  const cancelamentoSelecionado = servicos.includes('cancelamento');

  return (
    <div className="modal-overlay cliente-solicitou-quantidade-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="modal cliente-solicitou-quantidade-modal" role="dialog" aria-modal="true" aria-labelledby="cliente-solicitou-quantidade-title">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="cliente-solicitou-quantidade-title" className="modal-client">Quantificar chips</div>
              <div className="modal-sub">Informe quantos chips entram em cada operação.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} title="Fechar">
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="cliente-solicitou-quantidade-fields">
          {bloqueioSelecionado && (
            <label className="form-field">
              <span>Chips para bloqueio</span>
              <input type="number" min="1" inputMode="numeric" value={quantidades.bloqueio} onChange={event => onChange('bloqueio', apenasDigitos(event.target.value, 4))} placeholder="0" />
            </label>
          )}

          {cancelamentoSelecionado && (
            <label className="form-field">
              <span>Chips para cancelamento</span>
              <input type="number" min="1" inputMode="numeric" value={quantidades.cancelamento} onChange={event => onChange('cancelamento', apenasDigitos(event.target.value, 4))} placeholder="0" />
            </label>
          )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>Informar números</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza cliente solicitou numeros modal.
 */
function ClienteSolicitouNumerosModal({ servicos, quantidades, numeros, onChange, onClose, onConfirm }) {
  const selecionados = CLIENTE_SOLICITOU_ACOES.filter(acao => servicos.includes(acao));

  /**
   * Atualiza numero com os dados informados.
   */
  function atualizarNumero(tipo, index, valor) {
    onChange({
      ...numeros,
      [tipo]: (numeros[tipo] || []).map((numero, numeroIndex) => (
        numeroIndex === index ? formatarTelefoneComDdd(valor, true) : numero
      ))
    });
  }

  const faltando = selecionados.some(tipo => (
    (numeros[tipo] || []).filter(numero => apenasDigitos(numero).length > 2).length !== Number(quantidades[tipo] || 0)
  ));

  return (
    <div className="modal-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="modal cliente-solicitou-numeros-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Números envolvidos</div>
              <div className="modal-sub">Preencha exatamente os números dos chips informados.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} title="Fechar">
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="cliente-solicitou-numeros">
            {selecionados.map(tipo => (
              <section key={tipo} className="cliente-solicitou-numeros__group">
                <div className="cliente-solicitou-numeros__title">
                  {tipo === 'bloqueio' ? 'Bloqueio' : 'Cancelamento'} ({Number(quantidades[tipo] || 0)})
                </div>
                {(numeros[tipo] || []).map((numero, index) => (
                  <label key={`${tipo}-${index}`} className="cliente-solicitou-numero-row">
                    <span>{index + 1}</span>
                    <input type="text" inputMode="numeric" value={numero} onChange={event => atualizarNumero(tipo, index, event.target.value)} maxLength={15} placeholder="(11) 99999-9999" />
                  </label>
                ))}
              </section>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Voltar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={faltando}>
            Confirmar números
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza responsaveis recebimento input.
 */
function ResponsaveisRecebimentoInput({ form, onChange }) {
  const slots = [
    { nomeKey: 'responsavel_recebimento', rgKey: 'rg_responsavel_recebimento' },
    { nomeKey: 'responsavel_recebimento_2', rgKey: 'rg_responsavel_recebimento_2' },
    { nomeKey: 'responsavel_recebimento_3', rgKey: 'rg_responsavel_recebimento_3' },
  ];
  const preenchidos = slots.reduce((total, slot, index) => (
    form[slot.nomeKey] || form[slot.rgKey] ? index + 1 : total
  ), 1);
  const [linhasVisiveis, setLinhasVisiveis] = useState(Math.max(1, preenchidos));
  const visiveis = slots.slice(0, linhasVisiveis);

  /**
   * Remove linha da colecao ou estado atual.
   */
  function removerLinha(index) {
    const slot = slots[index];
    onChange(slot.nomeKey, '');
    onChange(slot.rgKey, '');
    setLinhasVisiveis(prev => Math.max(1, prev - 1));
  }

  return (
    <div className="responsaveis-list">
      {visiveis.map((slot, index) => (
        <div key={slot.nomeKey} className="responsavel-row">
          <span className="responsavel-row__num">{index + 1}</span>
          <div className="responsavel-row__campos">
            <input
              type="text"
              placeholder="Nome do responsável"
              value={form[slot.nomeKey] || ''}
              onChange={event => onChange(slot.nomeKey, event.target.value)}
            />
            <input
              type="text"
              placeholder="RG"
              value={form[slot.rgKey] || ''}
              onChange={event => onChange(slot.rgKey, event.target.value)}
            />
          </div>
          {linhasVisiveis > 1 && (
            <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => removerLinha(index)} title="Remover responsável">
              <I.Trash size={13} />
            </button>
          )}
        </div>
      ))}

      {linhasVisiveis < slots.length && (
        <button type="button" className="btn btn-sm responsaveis-add-btn" onClick={() => setLinhasVisiveis(prev => Math.min(prev + 1, slots.length))}>
          <I.Plus size={13} /> Adicionar responsável
        </button>
      )}
    </div>
  );
}

/**
 * Renderiza cliente venda select.
 */
function ClienteVendaSelect({ value, clientes, vendasRegistradas = 0, onChange, onCreateClient }) {
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [busca, setBusca] = useState('');
  const buscaDeferred = useDeferredValue(busca);
  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const clienteSelecionado = clientes.find(cliente => String(cliente.id) === String(value));
  const textoClienteSelecionado = clienteSelecionado?.nome || clienteSelecionado?.razao_social || '';
  const textoBusca = buscaDeferred || textoClienteSelecionado;
  const buscaNormalizada = textoBusca.trim().toLowerCase();
  const clientesFiltrados = clientes.filter(cliente => {
    if (!buscaNormalizada) return true;

    return [
      cliente.nome,
      cliente.razao_social,
      cliente.cnpj,
      cliente.email,
      cliente.responsavel_nome
    ].filter(Boolean).some(valor => String(valor).toLowerCase().includes(buscaNormalizada));
  }).slice(0, 8);

  useEffect(() => {
    /**
     * Trata o evento de click fora.
     */
    function handleClickFora(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setAberto(false);
      }
    }

    document.addEventListener('mousedown', handleClickFora);
    return () => document.removeEventListener('mousedown', handleClickFora);
  }, []);

  /**
   * Seleciona cliente e atualiza o estado relacionado.
   */
  function selecionarCliente(cliente) {
    onChange(String(cliente.id));
    setBusca('');
    setAberto(false);
  }

  /**
   * Limpa cliente e restaura o estado inicial.
   */
  function limparCliente() {
    onChange('');
    setBusca('');
    setAberto(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  /**
   * Trata o evento de key down.
   */
  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAberto(true);
      setIndiceAtivo(prev => Math.min(prev + 1, Math.max(clientesFiltrados.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAberto(true);
      setIndiceAtivo(prev => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === 'Enter' && aberto && clientesFiltrados[indiceAtivo]) {
      event.preventDefault();
      selecionarCliente(clientesFiltrados[indiceAtivo]);
      return;
    }

    if (event.key === 'Escape') {
      setAberto(false);
    }
  }

  const mostrarLista = aberto && clientes.length > 0;
  const activeDescendant = mostrarLista && clientesFiltrados[indiceAtivo]
    ? `cliente-option-${clientesFiltrados[indiceAtivo].id}`
    : undefined;

  return (
    <div className="venda-cliente-select" ref={wrapperRef}>
      <div className={`venda-cliente-combobox ${mostrarLista ? 'is-open' : ''}`}>
        <I.Search size={14} />
        <input
          ref={inputRef}
          value={textoBusca}
          onChange={event => {
            setBusca(event.target.value);
            setIndiceAtivo(0);
            setAberto(true);

            if (value) {
              onChange('');
            }
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar cliente por nome, razão social, CNPJ ou e-mail"
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls="cliente-options"
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
        />
        <button
          type="button"
          className="venda-cliente-combobox__toggle"
          onClick={() => setAberto(prev => !prev)}
          title={aberto ? 'Fechar resultados' : 'Abrir resultados'}
        >
          <I.ChevronDown size={14} />
        </button>

        {mostrarLista && (
          <div className="venda-cliente-options" id="cliente-options" role="listbox">
            <div className="venda-cliente-options__list">
              {clientesFiltrados.length > 0 ? (
                clientesFiltrados.map((cliente, index) => {
                  const selecionado = String(cliente.id) === String(value);
                  const ativo = index === indiceAtivo;

                  return (
                    <button
                      key={cliente.id}
                      id={`cliente-option-${cliente.id}`}
                      type="button"
                      className={`venda-cliente-option ${ativo ? 'is-active' : ''} ${selecionado ? 'is-selected' : ''}`}
                      onMouseEnter={() => setIndiceAtivo(index)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => selecionarCliente(cliente)}
                      role="option"
                      aria-selected={selecionado}
                    >
                      <span className="venda-cliente-option__main">
                        <strong>{cliente.nome || 'Cliente sem nome'}</strong>
                        <span>{cliente.razao_social || 'Sem razão social'} - {cliente.cnpj || 'Sem CNPJ'}</span>
                      </span>
                      <span className="venda-cliente-option__meta">
                        <span>{cliente.email || cliente.responsavel_nome || 'Sem contato principal'}</span>
                        <span>{formatarResumoOperadorasCliente(cliente)}</span>
                      </span>
                      {selecionado && <I.Check size={14} />}
                    </button>
                  );
                })
              ) : (
                <div className="venda-cliente-no-results">
                  <span>Nenhum cliente encontrado.</span>
                </div>
              )}
            </div>
            <div className="venda-cliente-options__footer">
              <button type="button" className="btn btn-sm" onMouseDown={event => event.preventDefault()} onClick={onCreateClient}>
                <I.Plus size={13} /> Cadastrar cliente
              </button>
            </div>
          </div>
        )}
      </div>

      {clientes.length === 0 && (
        <div className="venda-cliente-empty">
          <span>Nenhum cliente disponível. Cadastre um cliente ou solicite permissão para visualizar clientes.</span>
          <button type="button" className="btn btn-sm" onClick={onCreateClient}>
            <I.Plus size={13} /> Cadastrar cliente
          </button>
        </div>
      )}

      {clienteSelecionado && (
        <>
        <div className="venda-cliente-card">
          <div>
            <strong>{clienteSelecionado.nome}</strong>
            <span>{clienteSelecionado.razao_social || 'Sem razão social'} - {clienteSelecionado.cnpj || 'Sem CNPJ'}</span>
          </div>
          <div>
            <span>{clienteSelecionado.email || 'Sem e-mail'}</span>
            <span>{formatarResumoOperadorasCliente(clienteSelecionado)}</span>
          </div>
          <button type="button" className="btn btn-icon btn-ghost" onClick={limparCliente} title="Trocar cliente">
            <I.Close size={13} />
          </button>
        </div>
        {vendasRegistradas > 0 && (
          <div className="venda-cliente-repeat-alert">
            <I.AlertTriangle size={13} />
            <span>
              Este cliente já possui {vendasRegistradas} {vendasRegistradas === 1 ? 'venda registrada' : 'vendas registradas'}.
            </span>
          </div>
        )}
        </>
      )}
    </div>
  );
}

/**
 * Formata tamanho arquivo para exibicao ou envio.
 */
function formatarTamanhoArquivo(bytes) {
  const tamanho = Number(bytes || 0);

  if (tamanho >= 1024 * 1024) {
    return `${(tamanho / 1024 / 1024).toFixed(1)} MB`;
  }

  if (tamanho >= 1024) {
    return `${(tamanho / 1024).toFixed(1)} KB`;
  }

  return `${tamanho} B`;
}

/**
 * Retorna label status pacote no formato esperado pelo fluxo.
 */
function labelStatusPacote(status) {
  const labels = {
    pendente: 'Pacote pendente',
    gerando: 'Gerando pacote',
    pronto: 'Pacote pronto',
    erro: 'Erro ao gerar pacote',
    desatualizado: 'Pacote desatualizado',
    inexistente: 'Sem pacote'
  };

  return labels[status] || 'Sem pacote';
}

/**
 * Retorna icon status pacote a partir dos dados informados.
 */
function getIconStatusPacote(status) {
  if (status === 'pronto') return <I.Check size={12} />;
  if (status === 'erro' || status === 'desatualizado') return <I.AlertTriangle size={12} />;
  return <I.Note size={12} />;
}

/**
 * Renderiza arquivos venda tab.
 */
function ArquivosVendaTab({ venda, podeEditar, podeVisualizar, podeAdicionar }) {
  const inputRef = useRef(null);
  const [arquivos, setArquivos] = useState([]);
  const [pacote, setPacote] = useState(null);
  const [categoria, setCategoria] = useState('documento');
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  /**
   * Carrega  e atualiza o estado relacionado.
   */
  async function carregar() {
    if (!venda?.id) return;

    if (!podeVisualizar) {
      setArquivos([]);
      setPacote(null);
      return;
    }

    setCarregando(true);
    setErro('');

    try {
      const data = await listarArquivosVenda(venda.id);
      setArquivos(data.arquivos || []);
      setPacote(data.pacote || null);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar arquivos.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venda?.id, podeVisualizar]);

  useEffect(() => {
    if (!podeVisualizar) return undefined;
    if (!['pendente', 'gerando'].includes(pacote?.status)) return undefined;

    const timer = setInterval(() => {
      carregar();
    }, 2500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacote?.status, venda?.id, podeVisualizar]);

  /**
   * Trata o evento de upload.
   */
  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!podeAdicionar) return;
    if (files.length === 0) return;

    setEnviando(true);
    setErro('');
    setMensagem('');

    try {
      for (const file of files) {
        setProgresso({ nome: file.name, valor: 0 });
        await uploadArquivoVenda(venda.id, file, { categoria }, valor => {
          setProgresso({ nome: file.name, valor });
        });
      }

      setProgresso(null);
      if (podeVisualizar) {
        await carregar();
      } else {
        setArquivos([]);
        setPacote(null);
        setMensagem(files.length === 1
          ? 'Arquivo enviado. Os documentos existentes continuam ocultos para seu perfil.'
          : 'Arquivos enviados. Os documentos existentes continuam ocultos para seu perfil.');
      }
    } catch (error) {
      setErro(error.message || 'Erro ao enviar arquivo.');
    } finally {
      setEnviando(false);
      setProgresso(null);
    }
  }

  /**
   * Trata o evento de excluir.
   */
  async function handleExcluir(arquivo) {
    if (!window.confirm(`Excluir o arquivo "${arquivo.nome_original}" desta venda?`)) return;

    setErro('');

    try {
      await excluirArquivoVenda(venda.id, arquivo.id);
      await carregar();
    } catch (error) {
      setErro(error.message || 'Erro ao excluir arquivo.');
    }
  }

  /**
   * Trata o evento de gerar pacote.
   */
  async function handleGerarPacote() {
    setErro('');

    try {
      const novoPacote = await gerarPacoteArquivosVenda(venda.id);
      setPacote(novoPacote);
    } catch (error) {
      setErro(error.message || 'Erro ao gerar pacote.');
    }
  }

  if (!venda?.id) {
    return (
      <div className="venda-arquivos-empty venda-arquivos-empty--blocked">
        <span className="venda-arquivos-empty__icon">
          <I.Note size={20} />
        </span>
        <strong>Venda ainda não salva</strong>
        <span>Salve a venda antes de anexar arquivos.</span>
      </div>
    );
  }

  const statusPacote = pacote?.status || 'inexistente';
  const totalArquivos = arquivos.length;
  const podeGerenciarPacote = Boolean(podeVisualizar);

  return (
    <div className="venda-arquivos">
      <div className="venda-arquivos-toolbar">
        <div className="venda-arquivos-heading">
          <div className="venda-arquivos-title-row">
            <div className="venda-arquivos-title">Arquivos da venda</div>
            {podeVisualizar && (
              <span className="venda-arquivos-count">
                {totalArquivos} {totalArquivos === 1 ? 'arquivo' : 'arquivos'}
              </span>
            )}
          </div>
          {podeVisualizar ? (
            <div className={`venda-arquivos-package status-${statusPacote}`}>
              {getIconStatusPacote(statusPacote)}
              <span className="venda-arquivos-package__text">
                <span>{labelStatusPacote(statusPacote)}</span>
                {pacote?.total_arquivos ? <span>{pacote.total_arquivos} no ZIP</span> : null}
              </span>
            </div>
          ) : (
            <div className="venda-arquivos-package status-inexistente">
              <I.Eye size={12} />
              <span className="venda-arquivos-package__text">
                <span>Documentos existentes ocultos</span>
              </span>
            </div>
          )}
        </div>

        <div className="venda-arquivos-actions">
          <SelectFiltro
            value={categoria}
            onChange={setCategoria}
            disabled={!podeAdicionar || enviando}
            placeholder="Documento"
            options={[
              { value: 'documento', label: 'Documento' },
              { value: 'contrato', label: 'Contrato' },
              { value: 'comprovante', label: 'Comprovante' },
              { value: 'outro', label: 'Outro' },
            ]}
          />
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={handleUpload}
          />
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={!podeAdicionar || enviando}>
            <I.Plus size={13} />
            {enviando ? 'Enviando...' : 'Enviar arquivos'}
          </button>
          {podeGerenciarPacote && (
            <>
              <button type="button" className="btn" onClick={handleGerarPacote} disabled={!podeEditar || arquivos.length === 0 || pacote?.status === 'gerando'}>
                <I.Note size={13} />
                Gerar ZIP
              </button>
              <button type="button" className="btn" onClick={() => baixarPacoteArquivosVenda(venda.id)} disabled={pacote?.status !== 'pronto'}>
                <I.Download size={13} />
                Baixar ZIP
              </button>
            </>
          )}
        </div>
      </div>

      {progresso && (
        <div className="venda-arquivos-progress">
          <span>{progresso.nome}</span>
          <strong>{progresso.valor}%</strong>
        </div>
      )}

      {erro && <div className="alert-error">{erro}</div>}
      {mensagem && <div className="alert-success">{mensagem}</div>}

      {carregando ? (
        <div className="venda-arquivos-empty">
          <span className="venda-arquivos-empty__icon">
            <I.Note size={20} />
          </span>
          <strong>Carregando arquivos...</strong>
        </div>
      ) : arquivos.length === 0 ? (
        <div className="venda-arquivos-empty venda-arquivos-empty--upload" role={podeAdicionar ? 'button' : undefined} tabIndex={podeAdicionar ? 0 : undefined} onClick={() => podeAdicionar && inputRef.current?.click()} onKeyDown={event => {
          if (!podeAdicionar) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}>
          <span className="venda-arquivos-empty__icon">
            <I.Plus size={20} />
          </span>
          <strong>{podeVisualizar ? 'Nenhum arquivo anexado' : 'Envie novos documentos'}</strong>
          <span>{podeAdicionar
            ? (podeVisualizar
              ? 'Clique para selecionar documentos, contratos ou comprovantes.'
              : 'Documentos antigos ficam ocultos para seu perfil. Clique para anexar novos arquivos.')
            : 'Sem arquivos para exibir.'}</span>
          <em>PDF, JPG, PNG ou WEBP</em>
        </div>
      ) : (
        <div className="venda-arquivos-list">
          {arquivos.map(arquivo => (
            <div key={arquivo.id} className="venda-arquivo-item">
              <div className="venda-arquivo-icon">
                <I.Note size={16} />
              </div>
              <div className="venda-arquivo-main">
                <strong>{arquivo.nome_original}</strong>
                <div className="venda-arquivo-meta">
                  {arquivo.categoria} · {formatarTamanhoArquivo(arquivo.arquivo?.tamanho_bytes)} · {arquivo.criado_por?.nome || 'Usuário'}
                  {arquivo.arquivo?.removido_em ? ' · arquivado no ZIP' : ''}
                </div>
              </div>
              <div className="venda-arquivo-actions">
                <button type="button" className="btn btn-sm" onClick={() => visualizarArquivoVenda(venda.id, arquivo.id)} disabled={Boolean(arquivo.arquivo?.removido_em)}>
                  <I.Eye size={12} />
                  Visualizar
                </button>
                <button type="button" className="btn btn-sm" onClick={() => baixarArquivoVenda(venda.id, arquivo.id, arquivo.nome_original)} disabled={Boolean(arquivo.arquivo?.removido_em)}>
                  <I.Download size={12} />
                  Baixar
                </button>
                {podeEditar && (
                  <button type="button" className="btn btn-sm btn-ghost vendas-trash-delete" onClick={() => handleExcluir(arquivo)}>
                    <I.Trash size={12} />
                    Excluir
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {podeVisualizar && pacote?.status === 'erro' && (
        <div className="alert-error">
          {pacote.erro || 'Não foi possível gerar o pacote.'}
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza marcar problema modal.
 */
function MarcarProblemaModal({ venda, usuarios, onClose, onSave }) {
  const [motivo, setMotivo] = useState('');
  const [modo, setModo] = useState('responsaveis');
  const [destinatarios, setDestinatarios] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  /**
   * Salva  com os dados informados.
   */
  async function salvar() {
    setErro('');
    setSalvando(true);

    try {
      await onSave(venda, {
        motivo,
        modo_destinatario: modo === 'manual' ? 'manual' : 'responsaveis',
        destinatarios
      });
    } catch (error) {
      setErro(error.message || 'Erro ao marcar problema.');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Alterna usuario no estado atual.
   */
  function toggleUsuario(id) {
    setDestinatarios(prev => (
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    ));
  }

  return (
    <div className="modal-overlay venda-problema-modal-overlay" onClick={onClose}>
      <div className="modal venda-problema-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Marcar venda com problema</div>
              <div className="modal-sub">{venda?.cliente?.nome || venda?.nome || `Venda #${venda?.id}`}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          {erro && <div className="alert-error">{erro}</div>}
          <div className="form-field">
            <label>Motivo do problema</label>
            <AutoResizeTextarea value={motivo} onChange={event => setMotivo(event.target.value)} placeholder="Explique por que esta venda está com problema" />
          </div>
          <div className="venda-problema-recipient-mode">
            <label>
              <input type="radio" checked={modo === 'responsaveis'} onChange={() => setModo('responsaveis')} />
              Enviar aos responsáveis da venda
            </label>
            <label>
              <input type="radio" checked={modo === 'manual'} onChange={() => setModo('manual')} />
              Escolher manualmente
            </label>
          </div>
          {modo === 'manual' && (
            <div className="venda-problema-user-list">
              {usuarios.map(usuario => (
                <label key={usuario.id}>
                  <input type="checkbox" checked={destinatarios.includes(usuario.id)} onChange={() => toggleUsuario(usuario.id)} />
                  <span>{usuario.nome}</span>
                  <em>{usuario.email}</em>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-danger" disabled={salvando || !motivo.trim() || (modo === 'manual' && destinatarios.length === 0)} onClick={salvar}>
            {salvando ? 'Enviando...' : 'Marcar problema'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza confirmar lixeira modal.
 */
function ConfirmarLixeiraModal({ venda, deletando, onClose, onConfirm }) {
  if (!venda) return null;

  return (
    <div className="modal-overlay" onClick={event => !deletando && event.target === event.currentTarget && onClose()}>
      <div className="modal trash-confirm-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Enviar venda para a lixeira?</div>
              <div className="modal-sub">{venda.cliente?.nome || venda.nome} - #{venda.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={deletando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="trash-warning">
            <I.AlertTriangle size={20} />
            <div>
              <strong>Esta venda será enviada para a lixeira.</strong>
              <span>Ela ficará disponível para restauração e será permanentemente deletada daqui a 1 mês.</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={deletando}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={deletando}>
            {deletando ? 'Enviando...' : 'Enviar para lixeira'}
          </button>
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

        <div className="modal-body">
          <textarea className="venda-email-preview" value={dados.texto || ''} readOnly />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={copiando}>Fechar</button>
          <button type="button" className="btn btn-primary" onClick={onCopy} disabled={copiando || !dados.texto}>
            {copiando ? 'Copiando...' : 'Copiar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza whatsapp mensagem modal.
 */
export function WhatsappMensagemModal({ dados, copiando, onClose, onChange, onDocsChange, onCopy }) {
  if (!dados) return null;

  const documentosSelecionados = dados.documentosFaltantes || [];
  const semDocumentoFaltante = documentosSelecionados.length === 0;

  /**
   * Alterna documento no estado atual.
   */
  function alternarDocumento(documento) {
    if (documentosSelecionados.includes(documento)) {
      onDocsChange(documentosSelecionados.filter(item => item !== documento));
      return;
    }

    onDocsChange([...documentosSelecionados, documento]);
  }

  return (
    <div className="modal-overlay" onClick={event => !copiando && event.target === event.currentTarget && onClose()}>
      <div className="modal venda-email-modal venda-whatsapp-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Mensagem para WhatsApp</div>
              <div className="modal-sub">{dados.venda?.operadora?.nome || '-'} - {dados.venda?.cliente?.nome || dados.venda?.nome || `Venda #${dados.venda?.id}`}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={copiando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="whatsapp-docs-panel">
            <div className="whatsapp-docs-panel__title">Falta doc</div>
            <div className="whatsapp-docs-options">
              <label className="whatsapp-doc-option">
                <input
                  type="checkbox"
                  checked={semDocumentoFaltante}
                  onChange={() => onDocsChange([])}
                />
                <span>Não falta documento</span>
              </label>
              {DOCUMENTOS_FALTANTES_WHATSAPP.map(documento => (
                <label className="whatsapp-doc-option" key={documento}>
                  <input
                    type="checkbox"
                    checked={documentosSelecionados.includes(documento)}
                    onChange={() => alternarDocumento(documento)}
                  />
                  <span>{documento}</span>
                </label>
              ))}
            </div>
          </div>
          <textarea
            className="venda-email-preview venda-whatsapp-preview"
            value={dados.texto || ''}
            onChange={event => onChange(event.target.value)}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={copiando}>Fechar</button>
          <button type="button" className="btn btn-primary" onClick={onCopy} disabled={copiando || !dados.texto}>
            {copiando ? 'Copiando...' : 'Copiar mensagem'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza vendas page.
 */
function VendasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [vendas, setVendas] = useState([]);
  const [referenciasClientes, setReferenciasClientes] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [vendedoras, setVendedoras] = useState([]);
  const [usuariosProblema, setUsuariosProblema] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [tiposVenda, setTiposVenda] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [statusFunilFiltros, setStatusFunilFiltros] = useState(STATUS_FUNIL_FILTROS);
  const [etapasFunil, setEtapasFunil] = useState([]);
  const [buscaCampo, setBuscaCampo] = useState('geral');
  const [busca, setBusca] = useState('');
  const [vendedoraId, setVendedoraId] = useState('');
  const [operadoraId, setOperadoraId] = useState('');
  const [tipoVendaId, setTipoVendaId] = useState('');
  const [servicoId, setServicoId] = useState('');
  const [statusFunil, setStatusFunil] = useState('');
  const [prioridadeFunil, setPrioridadeFunil] = useState('');
  const [uf, setUf] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [valorMin, setValorMin] = useState('');
  const [valorMax, setValorMax] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [modalVenda, setModalVenda] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalAbaInicial, setModalAbaInicial] = useState('venda');
  const [modalProblemaInicial, setModalProblemaInicial] = useState(null);
  const [modalModoEdicao, setModalModoEdicao] = useState(true);
  const [vendaInicial, setVendaInicial] = useState(null);
  const [vendaCadastroDraft, setVendaCadastroDraft] = useState(null);
  const [vendaParaLixeira, setVendaParaLixeira] = useState(null);
  const [vendaProblema, setVendaProblema] = useState(null);
  const [deletando, setDeletando] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [emailTemplate, setEmailTemplate] = useState(null);
  const [whatsappMensagem, setWhatsappMensagem] = useState(null);
  const [gerandoEmailId, setGerandoEmailId] = useState(null);
  const [baixandoXlsxId, setBaixandoXlsxId] = useState(null);
  const [copiandoEmail, setCopiandoEmail] = useState(false);
  const [copiandoWhatsapp, setCopiandoWhatsapp] = useState(false);
  const [clienteRapidoAberto, setClienteRapidoAberto] = useState(false);
  const [clienteRapidoInicial, setClienteRapidoInicial] = useState(null);
  const [clienteRapidoDraft, setClienteRapidoDraft] = useState(null);
  const [, setResolverClienteRapido] = useState(null);
  const [clientePreenchidoLead] = useState(() => location.state?.clientePreenchido || null);
  const [origemLeadCadastro] = useState(() => location.state?.origemLead || null);
  const [clientesCarregados, setClientesCarregados] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState(20);
  const [totalVendas, setTotalVendas] = useState(0);
  const buscaDeferred = useDeferredValue(busca);
  const buscaDebounced = useDebounce(buscaDeferred, 300);
  const usuarioLogado = getUsuarioLocal();
  const podeCriarVenda = temPermissao(usuarioLogado, 'vendas_criar');
  const podeEditarVenda = temPermissao(usuarioLogado, ['vendas_editar', 'pos_venda']);
  const podeRegistrarReversao = temPermissao(usuarioLogado, 'vendas_permitir_reversoes');
  const podeExcluirReversao = temPermissao(usuarioLogado, 'vendas_excluir_reversoes');
  const podeCompartilharVenda = temPermissao(usuarioLogado, 'compartilhar_venda');
  const podeExcluirVenda = temPermissao(usuarioLogado, 'vendas_excluir');
  const podeVerDocumentosVenda = temPermissao(usuarioLogado, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuarioLogado, 'adicionar_documentos');
  const podeAcessarDocumentosVenda = Boolean(podeVerDocumentosVenda || podeAdicionarDocumentosVenda);
  const podeOperarPosVenda = temPermissao(usuarioLogado, 'pos_venda');
  const podeListarClientes = temPermissao(usuarioLogado, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const podeVerTodasVendas = temPermissao(usuarioLogado, 'vendas_ver_todas');
  const podeFunil = temPermissao(usuarioLogado, 'vendas');

  const filtros = useMemo(() => ({
    busca: buscaCampo === 'geral' ? buscaDebounced : '',
    busca_campo: buscaCampo !== 'geral' ? buscaCampo : '',
    busca_valor: buscaCampo !== 'geral' ? buscaDebounced : '',
    vendedora_id: vendedoraId,
    operadora_id: operadoraId,
    tipo_venda_id: tipoVendaId,
    servico_id: servicoId,
    status_funil: statusFunil,
    prioridade_funil: prioridadeFunil,
    uf,
    municipio,
    data_inicio: dataInicio,
    data_fim: dataFim,
    valor_min: valorMin,
    valor_max: valorMax
  }), [buscaCampo, buscaDebounced, vendedoraId, operadoraId, tipoVendaId, servicoId, statusFunil, prioridadeFunil, uf, municipio, dataInicio, dataFim, valorMin, valorMax]);

  const filtrosAtivos = useMemo(() => {
    const buscaAtiva = buscaCampo === 'geral'
      ? Boolean(filtros.busca)
      : Boolean(filtros.busca_campo && filtros.busca_valor);
    const demaisFiltros = Object.entries(filtros)
      .filter(([chave, valor]) => !['busca', 'busca_campo', 'busca_valor'].includes(chave) && valor !== '')
      .length;

    return demaisFiltros + (buscaAtiva ? 1 : 0);
  }, [buscaCampo, filtros]);

  const filtrosPopupAtivos = [
    operadoraId,
    tipoVendaId,
    servicoId,
    uf,
    municipio,
    dataInicio,
    dataFim,
    valorMin,
    valorMax,
    ...(podeVerTodasVendas ? [vendedoraId] : []),
    ...(podeFunil ? [statusFunil, prioridadeFunil] : [])
  ].filter(v => v !== '').length;

  const vendasPorCliente = useMemo(() => montarMapaReferencias(referenciasClientes, 'total'), [referenciasClientes]);
  const vendasEmAndamentoPorCliente = useMemo(() => montarMapaReferencias(referenciasClientes, 'em_andamento_total'), [referenciasClientes]);
  const etapasFinaisSet = useMemo(
    () => new Set(etapasFunil.filter(e => e.etapa_final).map(e => e.codigo)),
    [etapasFunil]
  );

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
   * Carrega dados estaticos e atualiza o estado relacionado.
   */
  async function carregarDadosEstaticos() {
    try {
      const [referenciasClientesData, clientesData, vendedorasData, operadorasData, tiposVendaData, servicosData, etapasFunilData, usuariosProblemaData] = await Promise.all([
        obterReferenciasClientesVendas(),
        podeListarClientes ? listarClientesSelect() : Promise.resolve([]),
        listarVendedoras(),
        listarOperadoras(),
        listarTiposVenda(),
        listarServicos(),
        listarEtapasFunil(),
        podeOperarPosVenda ? listarDestinatariosProblemaVenda() : Promise.resolve([])
      ]);

      setReferenciasClientes(referenciasClientesData || []);
      setClientes(clientesData);
      setClientesCarregados(true);
      setVendedoras(vendedorasData);
      setOperadoras(operadorasData);
      setTiposVenda(tiposVendaData);
      setServicos(servicosData);
      setStatusFunilFiltros(normalizarStatusFunilFiltros(etapasFunilData));
      setEtapasFunil(etapasFunilData || []);
      setUsuariosProblema(usuariosProblemaData || []);
    } catch (error) {
      setClientesCarregados(true);
      setErro(error.message || 'Erro ao carregar dados.');
    }
  }

  /**
   * Carrega vendas e atualiza o estado relacionado.
   */
  async function carregarVendas(proximosFiltros = filtros, pagina = paginaAtual, porPagina = itensPorPagina) {
    setErro('');
    setCarregando(true);

    try {
      const vendasData = await listarVendas({ ...proximosFiltros, page: pagina, per_page: porPagina });
      setVendas(vendasData.data);
      setTotalVendas(vendasData.total);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar vendas.');
    } finally {
      setCarregando(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    carregarDadosEstaticos();
  }, []);

  useEffect(() => {
    setPaginaAtual(1);
    carregarVendas(filtros, 1);
  }, [filtros]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  useEffect(() => {
    /**
     * Trata o evento de vendas atualizadas.
     */
    function handleVendasAtualizadas() {
      carregarVendas();
    }

    window.addEventListener('pos-venda:vendas-atualizadas', handleVendasAtualizadas);
    return () => window.removeEventListener('pos-venda:vendas-atualizadas', handleVendasAtualizadas);
  }, []);

  /**
   * Abre cliente rapido e prepara o estado necessario.
   */
  function abrirClienteRapido(clienteInicial = null) {
    return new Promise(resolve => {
      setResolverClienteRapido(() => resolve);
      setClienteRapidoInicial(clienteInicial);
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
    setClientes(clientesAtualizados);
    if (!clienteRapidoInicial) {
      setClienteRapidoDraft(null);
    }
    fecharClienteRapido(clienteCriado);
    setSucesso('Cliente cadastrado com sucesso.');
    return clienteCriado;
  }

  async function resolverClienteLead(dadosCliente = {}) {
    const cnpjDigitos = String(dadosCliente.cnpj || '').replace(/\D/g, '');
    if (cnpjDigitos.length !== 14) return null;

    const verificacao = await verificarDocumentoCliente(cnpjDigitos);
    if (verificacao?.existe) {
      if (verificacao.cliente?.excluido) {
        throw new Error('O cliente deste CNPJ esta na lixeira. Restaure-o antes de registrar a venda.');
      }
      return clientes.find(cliente => Number(cliente.id) === Number(verificacao.cliente?.id)) || verificacao.cliente;
    }

    const nome = String(dadosCliente.nome || dadosCliente.razao_social || '').trim();
    if (!nome) return null;

    try {
      const criado = await criarClientePrincipal({
        nome,
        razao_social: dadosCliente.razao_social || nome,
        cnpj: cnpjDigitos,
        responsavel_nome: dadosCliente.responsavel_nome || '',
        responsavel_tipo: dadosCliente.responsavel_tipo || 'rl',
        whatsapp: dadosCliente.whatsapp || dadosCliente.telefone || '',
        email: dadosCliente.email || '',
        operadora_atual_id: dadosCliente.operadora_atual_id || null,
        quantidade_chips: dadosCliente.quantidade_chips || dadosCliente.quantidade_linhas || null,
        valor_pago: dadosCliente.valor_pago || dadosCliente.valor_mensal_estimado || null
      });
      const clientesAtualizados = podeListarClientes ? await listarClientesSelect() : [criado];
      setClientes(clientesAtualizados);
      setSucesso('Cliente cadastrado e vinculado a venda.');
      return criado;
    } catch (error) {
      const clientesAtualizados = podeListarClientes ? await listarClientesSelect() : [];
      const criadoEmParalelo = clientesAtualizados.find(cliente => String(cliente.cnpj || '').replace(/\D/g, '') === cnpjDigitos);
      if (criadoEmParalelo) {
        setClientes(clientesAtualizados);
        return criadoEmParalelo;
      }
      throw error;
    }
  }

  /**
   * Abre nova venda e prepara o estado necessario.
   */
  function abrirNovaVenda(initialValues = null) {
    setModalVenda(null);
    setModalAbaInicial('venda');
    setModalProblemaInicial(null);
    setModalModoEdicao(true);
    setVendaInicial(initialValues);
    setModalAberto(true);
  }

  useEffect(() => {
    /**
     * Trata o evento de nova venda.
     */
    function handleNovaVenda() {
      if (podeCriarVenda) {
        abrirNovaVenda();
      }
    }

    window.addEventListener('pos-venda:nova-venda', handleNovaVenda);
    return () => window.removeEventListener('pos-venda:nova-venda', handleNovaVenda);
  }, [podeCriarVenda]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (searchParams.get('nova') === '1' && podeCriarVenda) {
      abrirNovaVenda(location.state?.vendaPreenchida || null);
      navigate('/vendas', { replace: true, state: null });
    }
  }, [searchParams, podeCriarVenda, location.state, navigate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const vendaId = searchParams.get('venda_id');
    const abaParam = searchParams.get('aba');
    const problemaId = searchParams.get('problema_id');
    const abasPermitidas = ['venda', 'notas', ...(podeAcessarDocumentosVenda ? ['arquivos'] : []), 'problema', 'cancelamento'];
    const aba = abasPermitidas.includes(abaParam) ? abaParam : 'venda';

    if (!vendaId) return;

    buscarVendaPorId(vendaId)
      .then(venda => {
        setModalVenda(venda);
        setModalAbaInicial(aba);
        setModalProblemaInicial(problemaId);
        setModalModoEdicao(false);
        setVendaInicial(null);
        setModalAberto(true);
      })
      .catch(error => setErro(error.message || 'Erro ao abrir venda.'));
  }, [searchParams, navigate, podeAcessarDocumentosVenda]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Limpa rota modal venda e restaura o estado inicial.
   */
  function limparRotaModalVenda() {
    if (searchParams.has('venda_id') || searchParams.has('aba') || searchParams.has('problema_id')) {
      navigate('/vendas', { replace: true });
    }
  }

  /**
   * Abre visualizacao e prepara o estado necessario.
   */
  async function abrirVisualizacao(venda) {
    setErro('');
    try {
      const vendaCompleta = await buscarVendaPorId(venda.id);
      setModalVenda(vendaCompleta);
      setModalAbaInicial('venda');
      setModalProblemaInicial(null);
      setModalModoEdicao(false);
      setVendaInicial(null);
      setModalAberto(true);
    } catch (error) {
      setErro(error.message || 'Erro ao abrir venda.');
    }
  }

  /**
   * Salva venda com os dados informados.
   */
  async function salvarVenda(dados, notasPendentes = [], arquivosPendentes = []) {
    setErro('');
    const editando = Boolean(modalVenda);

    let vendaSalva;
    if (modalVenda) {
      vendaSalva = await atualizarVenda(modalVenda.id, dados);
    } else {
      const origemLeadLinhaId = Number(origemLeadCadastro?.linha_id || 0);
      vendaSalva = await criarVenda({
        ...dados,
        ...(origemLeadLinhaId > 0 ? { origem_lead_linha_id: origemLeadLinhaId } : {})
      });
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
    }

    limparRotaModalVenda();
    setModalAberto(false);
    setModalVenda(null);
    setModalAbaInicial('venda');
    setModalProblemaInicial(null);
    setModalModoEdicao(true);
    setVendaInicial(null);
    if (!editando) {
      setVendaCadastroDraft(null);
    }
    await carregarVendas(filtros, paginaAtual);
    obterReferenciasClientesVendas().then(data => setReferenciasClientes(data || [])).catch(() => {});
    const integracaoDashboard = vendaSalva?.integracao_dashboard;
    if (!editando && integracaoDashboard?.status === 'erro') {
      setErro(`Venda cadastrada, mas não foi enviada ao dashboard: ${integracaoDashboard.mensagem || 'revise os dados e tente novamente.'}`);
    } else {
      setSucesso(editando ? 'Venda atualizada com sucesso.' : 'Venda cadastrada com sucesso.');
    }
    return vendaSalva;
  }

  /** Salva uma reversao sem passar pelo fluxo de edicao comum. */
  async function salvarReversao(dados, observacao, versao) {
    if (!modalVenda?.id) return null;
    setErro('');
    const vendaSalva = await registrarReversaoVenda(modalVenda.id, dados, observacao, versao);

    limparRotaModalVenda();
    setModalAberto(false);
    setModalVenda(null);
    setModalAbaInicial('venda');
    setModalProblemaInicial(null);
    setModalModoEdicao(true);
    setVendaInicial(null);
    await carregarVendas(filtros, paginaAtual);
    obterReferenciasClientesVendas().then(data => setReferenciasClientes(data || [])).catch(() => {});
    setSucesso('Reversão registrada com sucesso.');
    return vendaSalva;
  }

  /** Oculta uma reversao e mantem o modal aberto com os dados atualizados. */
  async function ocultarReversao(reversaoId, motivo) {
    if (!modalVenda?.id) return null;
    setErro('');
    const vendaAtualizada = await excluirReversaoVenda(modalVenda.id, reversaoId, motivo);
    setModalVenda(vendaAtualizada);
    await carregarVendas(filtros, paginaAtual);
    setSucesso('Reversão excluída com sucesso.');
    return vendaAtualizada;
  }

  async function reenviarDashboard(venda) {
    setErro('');
    setSucesso('');
    const integracaoDashboard = await reenviarVendaParaDashboard(venda.id);

    setModalVenda(atual => atual && Number(atual.id) === Number(venda.id)
      ? { ...atual, integracao_dashboard: integracaoDashboard }
      : atual);
    await carregarVendas(filtros, paginaAtual);

    if (integracaoDashboard?.status === 'enviada') {
      setSucesso('Venda enviada ao dashboard com sucesso.');
    } else {
      setErro(`A venda continua sem envio ao dashboard: ${integracaoDashboard?.mensagem || 'revise os dados e tente novamente.'}`);
    }

    return integracaoDashboard;
  }

  /**
   * Envia pos venda para processamento.
   */
  async function enviarPosVenda(venda, dados = {}) {
    setErro('');
    const resultado = await enviarVendaParaPosVenda(venda.id, dados);
    limparRotaModalVenda();
    setModalAberto(false);
    setModalVenda(null);
    setModalAbaInicial('venda');
    setModalProblemaInicial(null);
    setModalModoEdicao(true);
    setVendaInicial(null);
    await carregarVendas(filtros, paginaAtual);
    obterReferenciasClientesVendas().then(data => setReferenciasClientes(data || [])).catch(() => {});
    window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
    setSucesso(resultado?.status === 'pendente'
      ? (resultado.message || 'Solicitação enviada para aprovação do ADM.')
      : 'Venda enviada para o pós-venda.');
  }

  /**
   * Executa a acao de confirmar remocao venda mantendo o estado da tela consistente.
   */
  async function confirmarRemocaoVenda() {
    if (!vendaParaLixeira) return;

    setDeletando(true);
    try {
      await deletarVenda(vendaParaLixeira.id);
      setVendas(prev => prev.filter(item => item.id !== vendaParaLixeira.id));
      obterReferenciasClientesVendas().then(data => setReferenciasClientes(data || [])).catch(() => {});
      setVendaParaLixeira(null);
      setSucesso('Venda enviada para a lixeira.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir venda.');
    } finally {
      setDeletando(false);
    }
  }

  /**
   * Trata o evento de baixar xlsx claro.
   */
  async function handleBaixarXlsxClaro(venda) {
    setErro('');
    setBaixandoXlsxId(venda.id);
    try {
      const nome = venda.razao_social || venda.cliente?.razao_social || venda.cliente?.nome || venda.id;
      await baixarXlsxClaro(venda.id, nome);
    } catch (error) {
      setErro(error.message || 'Erro ao gerar planilha Claro.');
    } finally {
      setBaixandoXlsxId(null);
    }
  }

  /**
   * Exporta vendas no formato esperado.
   */
  async function exportarVendas() {
    setErro('');
    setExportando(true);

    try {
      await exportarVendasExcel(filtros);
      setSucesso('Exportacao de vendas iniciada.');
    } catch (error) {
      setErro(error.message || 'Erro ao exportar vendas.');
    } finally {
      setExportando(false);
    }
  }

  /**
   * Abre email venda e prepara o estado necessario.
   */
  async function abrirEmailVenda(venda) {
    setErro('');
    setSucesso('');
    setGerandoEmailId(venda.id);

    try {
      const resultado = await gerarEmailVenda(venda.id);
      setEmailTemplate({ ...resultado, venda });
    } catch (error) {
      setErro(error.message || 'Erro ao gerar corpo de email.');
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
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(emailTemplate.texto);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = emailTemplate.texto;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setSucesso('Corpo do email copiado.');
      setEmailTemplate(null);
    } catch {
      setErro('Não foi possível copiar o texto automaticamente.');
    } finally {
      setCopiandoEmail(false);
    }
  }

  /**
   * Renderiza abrir mensagem whatsapp.
   */
  function abrirMensagemWhatsapp(venda) {
    setErro('');
    setSucesso('');
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
      setSucesso('Mensagem do WhatsApp copiada.');
      setWhatsappMensagem(null);
    } catch {
      setErro('Não foi possível copiar a mensagem automaticamente.');
    } finally {
      setCopiandoWhatsapp(false);
    }
  }

  /**
   * Limpa filtros e restaura o estado inicial.
   */
  function limparFiltros() {
    setBuscaCampo('geral');
    setBusca('');
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
  }

  /**
   * Executa a acao de alterar busca campo mantendo o estado da tela consistente.
   */
  function alterarBuscaCampo(campo) {
    setBuscaCampo(campo || 'geral');
    setBusca('');
  }

  /**
   * Executa a acao de alterar busca valor mantendo o estado da tela consistente.
   */
  function alterarBuscaValor(valor) {
    setBusca(formatarBuscaPorCampo(buscaCampo, valor));
  }

  const totalColunasVendas = 14 + (podeOperarPosVenda ? 2 : 0) + (podeExcluirVenda ? 1 : 0);
  const larguraColunaContato = 104;

  return (
    <LayoutPrivado>
      {modalAberto && (
        <VendaModal
          key={`${modalVenda?.id || 'nova'}-${modalAbaInicial}-${modalProblemaInicial || ''}`}
          venda={modalVenda}
          initialValues={vendaInicial}
          initialDraft={vendaCadastroDraft}
          clientes={clientes}
          vendas={[]}
          vendedoras={vendedoras}
          operadoras={operadoras}
          tiposVenda={tiposVenda}
          servicos={servicos}
          vendasPorCliente={vendasPorCliente}
          vendasEmAndamentoPorCliente={vendasEmAndamentoPorCliente}
          podeEditarVenda={podeEditarVenda}
          podeRegistrarReversao={podeRegistrarReversao}
          podeExcluirReversao={podeExcluirReversao}
          podeCompartilharVenda={podeCompartilharVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuarioLogado}
          initialTab={modalAbaInicial}
          initialProblemaId={modalProblemaInicial}
          modoEdicao={modalModoEdicao}
          onStartEdit={() => setModalModoEdicao(true)}
          onClose={() => {
            limparRotaModalVenda();
            setModalAberto(false);
            setModalVenda(null);
            setModalAbaInicial('venda');
            setModalProblemaInicial(null);
            setModalModoEdicao(true);
            setVendaInicial(null);
          }}
          onSave={salvarVenda}
          onSaveReversal={salvarReversao}
          onDeleteReversal={ocultarReversao}
          onRetryDashboard={reenviarDashboard}
          onDraftChange={setVendaCadastroDraft}
          onSendToPosVenda={enviarPosVenda}
          onCreateClient={abrirClienteRapido}
          onResolveClient={resolverClienteLead}
          clientePreenchido={clientePreenchidoLead}
          clientesCarregados={clientesCarregados}
        />
      )}

      {clienteRapidoAberto && (
        <ClienteModal
          cliente={clienteRapidoInicial}
          operadoras={operadoras}
          initialDraft={clienteRapidoDraft}
          onClose={() => fecharClienteRapido(null)}
          onSave={salvarClienteRapido}
          onDraftChange={setClienteRapidoDraft}
        />
      )}

      {vendaProblema && (
        <MarcarProblemaModal
          venda={vendaProblema}
          usuarios={usuariosProblema}
          onClose={() => setVendaProblema(null)}
          onSave={async (venda, dados) => {
            await marcarProblemaVenda(venda.id, dados);
            setVendaProblema(null);
            setSucesso('Problema da venda enviado aos responsáveis.');
            window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
            await carregarVendas(filtros, paginaAtual);
          }}
        />
      )}

      <ConfirmarLixeiraModal
        venda={vendaParaLixeira}
        deletando={deletando}
        onClose={() => setVendaParaLixeira(null)}
        onConfirm={confirmarRemocaoVenda}
      />

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

      {filtrosAbertos && (
        <div className="filtros-popup-overlay" onClick={() => setFiltrosAbertos(false)}>
          <div className="filtros-popup" onClick={e => e.stopPropagation()}>
            <div className="filtros-popup__header">
              <span>Filtros</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setFiltrosAbertos(false)}>
                <I.Close size={14} />
              </button>
            </div>
            <div className="filtros-popup__body">
              {podeVerTodasVendas && (
                <div className="filter-field">
                  <label>Vendedor(a)</label>
                  <SelectFiltro
                    value={vendedoraId}
                    onChange={setVendedoraId}
                    placeholder="Todas"
                    options={vendedoras.map(v => ({ value: String(v.id), label: v.nome }))}
                  />
                </div>
              )}
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
              {podeFunil && (
                <div className="filter-field">
                  <label>Status</label>
                  <SelectFiltro
                    value={statusFunil}
                    onChange={setStatusFunil}
                    placeholder="Todos"
                    options={statusFunilFiltros.map(s => ({ value: String(s.id), label: s.label }))}
                  />
                </div>
              )}
              {podeFunil && (
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
              )}
              <div className="filter-field">
                <label>UF</label>
                <SelectFiltro
                  value={uf}
                  onChange={setUf}
                  placeholder="Todos"
                  options={['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'].map(e => ({ value: e, label: e }))}
                />
              </div>
              <div className="filter-field">
                <label>Município</label>
                <input value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder="Buscar por município" />
              </div>
              <div className="filter-field">
                <label>Data inicial</label>
                <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Data final</label>
                <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Valor min.</label>
                <input value={valorMin} onChange={e => setValorMin(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="filter-field">
                <label>Valor max.</label>
                <input value={valorMax} onChange={e => setValorMax(e.target.value)} placeholder="999,99" inputMode="decimal" />
              </div>
            </div>
            <div className="filtros-popup__footer">
              <button type="button" className="btn btn-ghost" onClick={limparFiltros} disabled={filtrosPopupAtivos === 0}>
                <I.Close size={13} /> Limpar filtros
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setFiltrosAbertos(false)}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="vendas-page">
        <div className="vendas-toolbar">
          <div className="vendas-search">
            <SelectFiltro
              value={buscaCampo}
              onChange={alterarBuscaCampo}
              options={BUSCA_CAMPO_OPCOES}
              searchable={false}
              className="vendas-search__campo"
            />
            <div className="search-box vendas-search__valor">
              <I.Search size={14} />
              {buscaCampo === 'tipo_venda' ? (
                <SelectFiltro
                  value={busca}
                  onChange={setBusca}
                  placeholder={getPlaceholderBusca(buscaCampo)}
                  options={tiposVenda.map(tipo => ({ value: String(tipo.id), label: tipo.nome }))}
                />
              ) : buscaCampo === 'produto' ? (
                <SelectFiltro
                  value={busca}
                  onChange={setBusca}
                  placeholder={getPlaceholderBusca(buscaCampo)}
                  options={agruparOpcoesServicos(servicos)}
                />
              ) : (
                <input
                  value={busca}
                  onChange={e => alterarBuscaValor(e.target.value)}
                  placeholder={getPlaceholderBusca(buscaCampo)}
                  inputMode={getInputModeBusca(buscaCampo)}
                  maxLength={getMaxLengthBusca(buscaCampo)}
                />
              )}
            </div>
          </div>

          <button className="btn" type="button" onClick={() => setFiltrosAbertos(true)}>
            <I.Filter size={14} /> Filtros
            {filtrosPopupAtivos > 0 && <span className="filtros-count">{filtrosPopupAtivos}</span>}
          </button>

          <button className="btn" type="button" onClick={exportarVendas} disabled={exportando || totalVendas === 0}>
            <I.Download size={14} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>

          {podeExcluirVenda && (
            <button className="btn btn-danger" type="button" onClick={() => navigate('/vendas/lixeira')}>
              <I.Trash size={14} /> Lixeira
            </button>
          )}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
          {totalVendas} vendas cadastradas
          {filtrosAtivos > 0 ? ` - ${filtrosAtivos} filtro(s) ativo(s)` : ''}
        </div>

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error" style={{ marginBottom: 16 }}>{erro}</div>}

        <div className="list-table" style={{ margin: 0 }}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Operadora</th>
                  <th>Tipo</th>
                  <th>Produto</th>
                  <th>Linhas</th>
                  <th>GB</th>
                  <th>Valor</th>
                  <th>Venc.</th>
                  <th>Venda</th>
                  <th>Última reversão</th>
                  <th>Ativação</th>
                  <th>Base</th>
                  <th>Vendedor(a)</th>
                  <th>Criado em</th>
                  {podeOperarPosVenda && (
                    <th className="vendas-actions-col vendas-email-actions-col" style={{ width: larguraColunaContato, minWidth: larguraColunaContato }}>
                      Automação
                    </th>
                  )}
                  {podeOperarPosVenda && (
                    <th className="vendas-actions-col vendas-delete-actions-col">
                      Problema
                    </th>
                  )}
                  {podeExcluirVenda && (
                    <th className="vendas-actions-col vendas-delete-actions-col">Excluir</th>
                  )}  
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={totalColunasVendas} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Carregando vendas...
                    </td>
                  </tr>
                ) : totalVendas === 0 ? (
                  <tr>
                    <td colSpan={totalColunasVendas} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Nenhuma venda encontrada.
                    </td>
                  </tr>
                ) : (
                  vendas.map(venda => {
                    const solicitacaoAprovacao = obterSolicitacaoAprovacaoAtual(venda);
                    const motivoRecusa = String(solicitacaoAprovacao?.observacao_decisao || '').trim()
                      || 'Motivo não informado pelo ADM.';
                    const vendaCancelada = Boolean(venda.cancelada_em);
                    const resumoFunil = obterResumoFunilVenda(venda, etapasFunil);
                    const avaliacaoPrimeiraLigacao = AVALIACOES_PRIMEIRA_LIGACAO[
                      venda.origemLead?.primeira_ligacao_avaliacao
                    ];

                    return (
                    <tr
                      key={venda.id}
                      className="clickable-row is-tappable"
                      role="button"
                      tabIndex={0}
                      onClick={() => abrirVisualizacao(venda)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          abrirVisualizacao(venda);
                        }
                      }}
                    >
                      <td data-label="Cliente" className="m-primary">
                        <div className="vendas-table-name">
                          <div className="vendas-table-name__title">
                            <strong>{venda.cliente?.nome || venda.nome}</strong>
                            {!venda.enviada_pos_venda_em && (
                              <span className="vendas-pos-venda-pending">
                                <I.AlertTriangle size={11} />
                                Falta enviar ao pós-venda
                              </span>
                            )}
                            {!venda.enviada_pos_venda_em && solicitacaoAprovacao?.status === 'pendente' && (
                              <span className="vendas-pos-venda-pending">
                                <I.Shield size={11} />
                                Aguardando ADM
                              </span>
                            )}
                            {!venda.enviada_pos_venda_em && solicitacaoAprovacao?.status === 'recusada' && (
                              <span
                                className="vendas-cliente-repeat-badge vendas-aprovacao-recusada-badge"
                                tabIndex={0}
                                aria-label={`Recusada pelo ADM. Motivo: ${motivoRecusa}`}
                              >
                                <I.AlertTriangle size={11} />
                                Recusada pelo ADM
                                <span className="vendas-aprovacao-recusada-tooltip" role="tooltip">
                                  <strong>Motivo da recusa</strong>
                                  <span>{motivoRecusa}</span>
                                </span>
                              </span>
                            )}
                            {resumoFunil && (
                              <span
                                className="vendas-etapa-funil-badge"
                                tabIndex={0}
                                title={`Etapa atual: ${resumoFunil.atual}`}
                              >
                                <span className="vendas-etapa-funil-badge__dot" />
                                Etapa: {resumoFunil.atual}
                                <span className="vendas-etapa-funil-tooltip" role="tooltip">
                                  <strong>Etapas j&aacute; percorridas</strong>
                                  <ul>
                                    {resumoFunil.etapasPercorridas.map(etapa => (
                                      <li key={etapa.codigo} className={etapa.codigo === venda.status_funil ? 'is-current' : ''}>
                                        {etapa.nome}
                                      </li>
                                    ))}
                                  </ul>
                                </span>
                              </span>
                            )}
                            {etapasFinaisSet.has(venda.status_funil) && (
                              <span className="vendas-cliente-concluidas-badge">
                                <I.Check size={11} />
                                Concluída
                              </span>
                            )}
                            {vendaCancelada && (
                              <span
                                className="vendas-cancelada-badge"
                                title={venda.motivo_cancelamento ? `Cancelada: ${venda.motivo_cancelamento}` : 'Venda cancelada'}
                              >
                                <I.Close size={11} />
                                Cancelada
                              </span>
                            )}
                            {venda.status_funil === 'retorno' && (
                              <span className="vendas-retorno-badge">
                                <I.AlertTriangle size={11} />
                                Retorno
                              </span>
                            )}
                            {venda.origem_lead_linha_id && (
                              <span
                                className="vendas-primeira-ligacao-badge"
                                title={`Cliente qualificado na primeira liga\u00e7\u00e3o${venda.origemSondador?.nome ? ` por ${venda.origemSondador.nome}` : ''}`}
                              >
                                <I.User size={11} />
                                1&ordf; liga&ccedil;&atilde;o{venda.origemSondador?.nome ? `: ${venda.origemSondador.nome}` : ''}
                              </span>
                            )}
                            {avaliacaoPrimeiraLigacao && (
                              <span
                                className={`vendas-primeira-ligacao-badge vendas-primeira-ligacao-qualidade-badge ${avaliacaoPrimeiraLigacao.classe}`}
                                title={`Qualidade da primeira liga\u00e7\u00e3o: ${avaliacaoPrimeiraLigacao.label}`}
                              >
                                <I.Check size={11} />
                                1&ordf; liga&ccedil;&atilde;o: {avaliacaoPrimeiraLigacao.label}
                              </span>
                            )}
                            {venda.cliente_excluido_permanentemente_em && (
                              <span
                                className="vendas-cliente-excluido-badge"
                                title="O cliente relacionado a esta venda foi excluído permanentemente"
                              >
                                <I.AlertTriangle size={11} />
                                Cliente excluído
                              </span>
                            )}
                            {(venda.possui_doc_na_casa === true || Number(venda.possui_doc_na_casa) === 1) && (
                              <span className="vendas-doc-casa-badge" title="Venda possui documento físico na casa">
                                <I.Folder size={11} />
                                Possui doc na casa
                              </span>
                            )}
                            {Number(venda.total_arquivos) > 0 && (
                              <span className="vendas-doc-sistema-badge" title="Venda possui documentos anexados no sistema">
                                <I.Check size={11} />
                                Possui doc no sistema
                              </span>
                            )}
                            {!(venda.possui_doc_na_casa === true || Number(venda.possui_doc_na_casa) === 1)
                              && !(Number(venda.total_arquivos) > 0) && (
                              <span className="vendas-doc-sem-badge" title="Venda sem documento na casa nem anexado no sistema">
                                <I.AlertTriangle size={11} />
                                Venda sem doc
                              </span>
                            )}
                          </div>
                          <span>
                            {venda.cliente_excluido_permanentemente_nome
                              || venda.cliente?.razao_social
                              || venda.razao_social
                              || venda.telefone
                              || venda.email
                              || '-'}
                            {venda.cliente_excluido_permanentemente_cnpj ? ` - ${venda.cliente_excluido_permanentemente_cnpj}` : ''}
                          </span>
                          <details className="mobile-row-drawer">
                            <summary>Ver detalhes da venda</summary>
                            <dl>
                              <dt>Operadora</dt>
                              <dd>{venda.operadora?.nome || '-'}</dd>
                              <dt>Tipo</dt>
                              <dd>{obterTipoVendaTabela(venda)}</dd>
                              <dt>Produto</dt>
                              <dd>{formatarNomeServico(venda.servico?.nome) || '-'}</dd>
                              <dt>Linhas</dt>
                              <dd>{venda.quantidade_linhas || '-'}</dd>
                              <dt>GB</dt>
                              <dd>{venda.gb || '-'}</dd>
                              <dt>Venc.</dt>
                              <dd>{venda.dia_vencimento || '-'}</dd>
                              <dt>Venda</dt>
                              <dd>{formatarData(venda.data_venda)}</dd>
                              <dt>Última reversão</dt>
                              <dd>{formatarDataHoraRegistro(venda.ultima_reversao_em)}</dd>
                              <dt>Ativacao</dt>
                              <dd>{formatarData(venda.data_ativacao)}</dd>
                              <dt>Base</dt>
                              <dd>{venda.cliente_da_base === true || Number(venda.cliente_da_base) === 1 ? 'Sim' : 'Não'}</dd>
                              <dt>Vendedor(a)</dt>
                              <dd>{obterVendedorasMensagem(venda)}</dd>
                              <dt>Criado em</dt>
                              <dd>{formatarDataHoraRegistro(venda.criado_em || venda.created_at)}</dd>
                            </dl>
                          </details>
                        </div>
                      </td>
                      <td data-label="Operadora" className="m-secondary">{(() => {
                        const nome = venda.operadora?.nome;
                        if (!nome) return <span className="tag">-</span>;
                        const slug = nome.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-');
                        return <span className={`tag operadora-tag operadora-${slug}`}>{nome}</span>;
                      })()}</td>
                      <td data-label="Tipo" data-mobile-hidden="true">{obterTipoVendaTabela(venda)}</td>
                      <td data-label="Produto" data-mobile-hidden="true">{formatarNomeServico(venda.servico?.nome) || '-'}</td>
                      <td data-label="Linhas" data-mobile-hidden="true">{venda.quantidade_linhas || '-'}</td>
                      <td data-label="GB" data-mobile-hidden="true">{venda.gb || '-'}</td>
                      <td data-label="Valor" className="vendas-value m-meta">{formatarMoeda(venda.valor_total)}</td>
                      <td data-label="Venc." data-mobile-hidden="true">{venda.dia_vencimento || '-'}</td>
                      <td data-label="Venda" data-mobile-hidden="true">{formatarData(venda.data_venda)}</td>
                      <td data-label="Última reversão" data-mobile-hidden="true">{formatarDataHoraRegistro(venda.ultima_reversao_em)}</td>
                      <td data-label="Ativacao" data-mobile-hidden="true">{formatarData(venda.data_ativacao)}</td>
                      <td data-label="Base" data-mobile-hidden="true">{venda.cliente_da_base === true || Number(venda.cliente_da_base) === 1 ? 'Sim' : 'Não'}</td>
                      <td data-label="Vendedor(a)" data-mobile-hidden="true"><span className="tag">{obterVendedorasMensagem(venda)}</span></td>
                      <td data-label="Criado em" data-mobile-hidden="true">
                        <div className="vendas-registro">
                          <span className="vendas-registro__data">{formatarDataHoraRegistro(venda.criado_em || venda.created_at)}</span>
                          <span>{venda.criador?.nome || 'Sem registro'}</span>
                        </div>
                      </td>
                      {podeOperarPosVenda && (
                        <td data-label="Automação" className="vendas-actions-col vendas-email-actions-col vendas-mobile-actions m-actions" style={{ width: larguraColunaContato, minWidth: larguraColunaContato }}>
                          <div className="vendas-contact-actions">
                            <button
                              className="btn btn-icon btn-ghost vendas-whatsapp-btn"
                              title="Gerar mensagem para WhatsApp"
                              onClick={(event) => {
                                event.stopPropagation();
                                abrirMensagemWhatsapp(venda);
                              }}
                            >
                              <I.Whatsapp size={13} />
                              <span className="mobile-action-label">WhatsApp</span>
                            </button>
                            <button
                              className="btn btn-icon btn-ghost vendas-email-btn"
                              title="Gerar corpo de email"
                              disabled={gerandoEmailId === venda.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                abrirEmailVenda(venda);
                              }}
                            >
                              <I.Mail size={13} />
                              <span className="mobile-action-label">E-mail</span>
                            </button>
                            {/claro/i.test(venda.operadora?.nome) && (
                            <button
                              className="btn btn-icon btn-ghost vendas-xlsx-btn"
                              title="Baixar planilha Claro"
                              disabled={baixandoXlsxId === venda.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleBaixarXlsxClaro(venda);
                              }}
                            >
                              <I.TableSheet size={13} />
                              <span className="mobile-action-label">Planilha</span>
                            </button>
                            )}
                          </div>
                        </td>
                      )}
                      {podeOperarPosVenda && (
                        <td data-label="Problema" className="vendas-actions-col vendas-delete-actions-col">
                          <button
                            className="btn btn-icon btn-ghost btn-warn-icon"
                            title="Marcar problema"
                            onClick={(event) => {
                              event.stopPropagation();
                              setVendaProblema(venda);
                            }}
                          >
                            <I.AlertTriangle size={13} />
                          </button>
                        </td>
                      )}
                      {podeExcluirVenda && (
                        <td data-label="Excluir" className="vendas-actions-col vendas-delete-actions-col">
                          <button
                            className="btn btn-icon btn-ghost btn-danger-icon"
                            title="Excluir"
                            onClick={(event) => {
                              event.stopPropagation();
                              setVendaParaLixeira(venda);
                            }}
                          >
                            <I.Trash size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Paginacao
            total={totalVendas}
            paginaAtual={paginaAtual}
            itensPorPagina={itensPorPagina}
            onPagina={pagina => { setPaginaAtual(pagina); carregarVendas(filtros, pagina); }}
            onItensPorPagina={n => { setItensPorPagina(n); setPaginaAtual(1); carregarVendas(filtros, 1, n); }}
          />
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default VendasPage;
