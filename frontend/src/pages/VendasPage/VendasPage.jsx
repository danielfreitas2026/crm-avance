import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useDebounce } from '../../utils/useDebounce';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Paginacao from '../../components/Paginacao/Paginacao';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import ClienteModal from '../Clientes/ClienteModal';
import VendaModal from './VendaModal';
import { atualizarVenda, baixarXlsxClaro, buscarVendaPorId, criarVenda, deletarVenda, enviarVendaParaPosVenda, excluirReversaoVenda, exportarVendasExcel, gerarEmailVenda, listarDestinatariosProblemaVenda, obterReferenciasClientesVendas, listarVendas, listarVendedoras, marcarProblemaVenda, registrarReversaoVenda, reenviarVendaParaDashboard, uploadArquivoVenda } from '../../services/venda.service';
import { criarNotaEntidade } from '../../services/nota.service';
import { listarEtapasFunil, listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import { criarCliente as criarClientePrincipal, listarClientesSelect, verificarDocumentoCliente } from '../../services/cliente.service';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import { formatUtcDateTime } from '../../utils/datetime';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import { agruparOpcoesServicos, formatarNomeServico } from '../../utils/servicos';
import {
  DOCUMENTOS_FALTANTES_WHATSAPP,
  montarChecklistWhatsappVenda,
  obterDocumentosFaltantesPadrao
} from './vendasWhatsapp';
import './VendasPage.css';

const AVALIACOES_PRIMEIRA_LIGACAO = {
  bom: { label: 'Bom', classe: 'is-bom' },
  mais_ou_menos: { label: 'Mais ou menos', classe: 'is-mais-ou-menos' },
  ruim: { label: 'Ruim', classe: 'is-ruim' }
};

/**
 * Obtem operadoras cliente a partir dos dados informados.
 */
/**
 * Formata resumo operadoras cliente para exibicao ou envio.
 */
const ITEM_CHIP_VAZIO = { quantidade: '', gb: '', valor_unitario: '', tipo_linha: 'novo', vendedora_id: '' };
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
/**
 * Gera protocolo data hora a partir dos dados informados.
 */
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
/**
 * Formata input moeda br para exibicao ou envio.
 */
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
/**
 * Obtem erro cpf venda a partir dos dados informados.
 */
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
/**
 * Retorna max length campo a partir dos dados informados.
 */
/**
 * Renderiza normalizar itens chips input.
 */
function normalizarItensChipsInput(itens) {
  return Array.isArray(itens) ? itens : parseItensChips(itens);
}

/**
 * Renderiza normalizar ids vendedoras input.
 */
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
/**
 * Resume gigas itens chips para exibicao ou envio.
 */
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
/**
 * Processa limitar itens chips por quantidade linhas conforme as regras do dominio.
 */
/**
 * Soma quantidade portabilidade itens chips considerando os dados informados.
 */
/**
 * Verifica se chip portabilidade esta presente nos dados informados.
 */
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
/**
 * Obtem documentos faltantes mensagem a partir dos dados informados.
 */
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
/**
 * Converte numeros portados para o formato interno esperado.
 */
/**
 * Monta numeros portados a partir dos dados informados.
 */
/**
 * Converte cliente solicitou servicos para o formato interno esperado.
 */
/**
 * Converte cliente solicitou numeros para o formato interno esperado.
 */
/**
 * Monta cliente solicitou numeros a partir dos dados informados.
 */
/**
 * Processa ajustar quantidade numeros solicitados conforme as regras do dominio.
 */
/**
 * Normaliza venda para uso interno consistente.
 */
/**
 * Renderiza itens chips input.
 */
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
/**
 * Verifica se numero linha tem apenas ddd ou vazio atende a condicao esperada.
 */
/**
 * Processa ajustar quantidade numeros portados conforme as regras do dominio.
 */
/**
 * Renderiza numeros linha input.
 */
/**
 * Renderiza numeros portados input.
 */
/**
 * Renderiza numeros ativados input.
 */
/**
 * Renderiza cliente solicitou input.
 */
/**
 * Renderiza cliente solicitou quantidade modal.
 */
/**
 * Renderiza cliente solicitou numeros modal.
 */
/**
 * Renderiza responsaveis recebimento input.
 */
/**
 * Renderiza cliente venda select.
 */
/**
 * Formata tamanho arquivo para exibicao ou envio.
 */
/**
 * Retorna label status pacote no formato esperado pelo fluxo.
 */
/**
 * Retorna icon status pacote a partir dos dados informados.
 */
/**
 * Renderiza arquivos venda tab.
 */
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

  useEffect(() => {
    let ativo = true;
    Promise.all([
      obterReferenciasClientesVendas(),
      podeListarClientes ? listarClientesSelect() : Promise.resolve([]),
      listarVendedoras(),
      listarOperadoras(),
      listarTiposVenda(),
      listarServicos(),
      listarEtapasFunil(),
      podeOperarPosVenda ? listarDestinatariosProblemaVenda() : Promise.resolve([])
    ])
      .then(([referenciasClientesData, clientesData, vendedorasData, operadorasData, tiposVendaData, servicosData, etapasFunilData, usuariosProblemaData]) => {
        if (!ativo) return;
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
      })
      .catch(error => {
        if (!ativo) return;
        setClientesCarregados(true);
        setErro(error.message || 'Erro ao carregar dados.');
      });
    return () => { ativo = false; };
  }, [podeListarClientes, podeOperarPosVenda]);

  const [filtrosAplicados, setFiltrosAplicados] = useState(filtros);
  if (filtrosAplicados !== filtros) {
    setFiltrosAplicados(filtros);
    setPaginaAtual(1);
    setCarregando(true);
  }

  useEffect(() => {
    let ativo = true;
    listarVendas({ ...filtros, page: 1, per_page: itensPorPagina })
      .then(vendasData => {
        if (!ativo) return;
        setVendas(vendasData.data);
        setTotalVendas(vendasData.total);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar vendas.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  }, [filtros, itensPorPagina]);

  const recarregarVendas = useEffectEvent(() => carregarVendas());

  useEffect(() => {
    /**
     * Trata o evento de vendas atualizadas.
     */
    function handleVendasAtualizadas() {
      recarregarVendas();
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

  const [novaVendaProcessada, setNovaVendaProcessada] = useState(false);
  const deveAbrirNovaVenda = searchParams.get('nova') === '1' && podeCriarVenda;
  if (deveAbrirNovaVenda && !novaVendaProcessada) {
    setNovaVendaProcessada(true);
    abrirNovaVenda(location.state?.vendaPreenchida || null);
  } else if (!deveAbrirNovaVenda && novaVendaProcessada) {
    setNovaVendaProcessada(false);
  }

  useEffect(() => {
    if (deveAbrirNovaVenda) navigate('/vendas', { replace: true, state: null });
  }, [deveAbrirNovaVenda, navigate]);

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
            onItensPorPagina={n => { setCarregando(true); setItensPorPagina(n); setPaginaAtual(1); }}
          />
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default VendasPage;
