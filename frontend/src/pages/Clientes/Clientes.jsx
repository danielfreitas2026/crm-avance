import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useDebounce } from '../../utils/useDebounce';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as I from '../../components/Icons';
import Paginacao from '../../components/Paginacao/Paginacao';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import ClienteModal from './ClienteModal';
import VendaModal from '../VendasPage/VendaModal';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  excluirCliente,
  exportarClientesExcel,
  importarBaseAnterior,
  limparClientesBaseAnterior,
  listarClientes,
  listarClientesSelect,
  previewImportacaoBaseAnterior
} from '../../services/cliente.service';
import { listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import {
  atualizarVenda,
  buscarVendaPorId,
  contarVendasConcluidasPorCliente,
  enviarVendaParaPosVenda,
  importarVendasEmpresas,
  listarVendedoras,
  obterReferenciasClientesVendas,
  previewImportacaoVendasEmpresas
} from '../../services/venda.service';
import { formatUtcDateTime, getUtcDateTimeTimestamp, parseUtcDateTime } from '../../utils/datetime';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import './Clientes.css';

const BUSCA_CLIENTES_CAMPO_OPCOES = [
  { value: 'geral', label: 'Busca geral' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'documento', label: 'CNPJ/CPF' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'responsavel', label: 'Responsável' }
];

/**
 * Extrai apenas digitos de um valor textual, com limite opcional.
 *
 * @param {unknown} valor - Valor bruto digitado ou retornado pela API.
 * @param {number} [limite] - Quantidade maxima de digitos.
 * @returns {string} Digitos normalizados.
 */
function apenasDigitos(valor, limite) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return limite ? digitos.slice(0, limite) : digitos;
}

/**
 * Formata DDD e numero em telefone brasileiro para exibicao.
 *
 * @param {unknown} ddd - DDD do contato.
 * @param {unknown} numero - Numero do contato.
 * @returns {string} Telefone formatado ou vazio.
 */
function formatarTelefone(ddd, numero) {
  const dddDigits = String(ddd || '').replace(/\D/g, '');
  const numeroDigits = String(numero || '').replace(/\D/g, '');

  if (!dddDigits && !numeroDigits) return '';

  let numeroFormatado = numeroDigits;
  if (numeroDigits.length === 9) {
    numeroFormatado = `${numeroDigits.slice(0, 5)}-${numeroDigits.slice(5)}`;
  } else if (numeroDigits.length === 8) {
    numeroFormatado = `${numeroDigits.slice(0, 4)}-${numeroDigits.slice(4)}`;
  }

  if (!dddDigits) return numeroFormatado;
  if (!numeroFormatado) return `(${dddDigits})`;
  return `(${dddDigits}) ${numeroFormatado}`;
}

/**
 * Aplica mascara progressiva de telefone no campo de busca.
 *
 * @param {unknown} valor - Texto digitado.
 * @returns {string} Telefone parcialmente formatado.
 */
function formatarTelefoneBusca(valor) {
  const digitos = apenasDigitos(valor, 11);

  if (digitos.length <= 2) {
    return digitos ? `(${digitos}` : '';
  }

  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);

  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  if (numero.length <= 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}

/**
 * Aplica mascara progressiva de CPF no campo de busca.
 *
 * @param {unknown} valor - Texto digitado.
 * @returns {string} CPF parcialmente formatado.
 */
function formatarCpfBusca(valor) {
  const digitos = apenasDigitos(valor, 11);

  if (digitos.length <= 3) return digitos;
  if (digitos.length <= 6) return `${digitos.slice(0, 3)}.${digitos.slice(3)}`;
  if (digitos.length <= 9) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6)}`;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

/**
 * Aplica mascara progressiva de CNPJ no campo de busca.
 *
 * @param {unknown} valor - Texto digitado.
 * @returns {string} CNPJ parcialmente formatado.
 */
function formatarCnpjBusca(valor) {
  const digitos = apenasDigitos(valor, 14);

  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  if (digitos.length <= 8) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  if (digitos.length <= 12) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

/**
 * Escolhe mascara de CPF ou CNPJ conforme a quantidade de digitos.
 *
 * @param {unknown} valor - Texto digitado.
 * @returns {string} Documento formatado para busca.
 */
function formatarDocumentoBusca(valor) {
  const digitos = apenasDigitos(valor, 14);
  return digitos.length > 11 ? formatarCnpjBusca(digitos) : formatarCpfBusca(digitos);
}

/**
 * Formata o valor de busca conforme o campo selecionado.
 *
 * @param {string} campo - Campo de busca selecionado.
 * @param {string} valor - Valor digitado.
 * @returns {string} Valor formatado para o input.
 */
function formatarBuscaClientesPorCampo(campo, valor) {
  if (campo === 'telefone') return formatarTelefoneBusca(valor);
  if (campo === 'documento') return formatarDocumentoBusca(valor);
  return valor;
}

/**
 * Define o inputMode adequado para o campo de busca.
 *
 * @param {string} campo - Campo de busca selecionado.
 * @returns {string|undefined} Modo de teclado sugerido.
 */
function getInputModeBuscaClientes(campo) {
  return ['telefone', 'documento'].includes(campo) ? 'numeric' : undefined;
}

/**
 * Define o tamanho maximo do campo de busca conforme a mascara.
 *
 * @param {string} campo - Campo de busca selecionado.
 * @returns {number|undefined} Tamanho maximo do input.
 */
function getMaxLengthBuscaClientes(campo) {
  if (campo === 'telefone') return 15;
  if (campo === 'documento') return 18;
  return undefined;
}

/**
 * Retorna o placeholder especifico do campo de busca escolhido.
 *
 * @param {string} campo - Campo de busca selecionado.
 * @returns {string} Placeholder do input.
 */
function getPlaceholderBuscaClientes(campo) {
  const placeholders = {
    geral: 'Buscar por nome, CNPJ/CPF, telefone, e-mail ou responsável',
    cliente: 'Buscar por nome ou razão social',
    documento: 'CNPJ ou CPF',
    telefone: '(11) 99999-9999',
    email: 'Buscar por e-mail',
    responsavel: 'Buscar por responsável'
  };

  return placeholders[campo] || placeholders.geral;
}

/**
 * Monta os telefones formatados do cliente.
 *
 * @param {Record<string, unknown>} cliente - Cliente retornado pela API.
 * @returns {{ whatsapp: string, fixo: string }} Contatos formatados.
 */
function formatarContato(cliente) {
  const whatsapp = formatarTelefone(cliente.whatsapp_ddd, cliente.whatsapp_numero);
  const fixo = formatarTelefone(cliente.fixo_ddd, cliente.fixo_numero);

  return { whatsapp, fixo };
}

/**
 * Converte aviso de fidelidade em rotulo e classe visual.
 *
 * @param {Object|null} aviso - Aviso de fidelidade da API.
 * @returns {{ label: string, className: string }} Estado visual da fidelidade.
 */
function formatarFidelidade(aviso) {
  if (!aviso || aviso.dias_restantes === null || aviso.dias_restantes === undefined) {
    return { label: 'Sem fidelidade', className: '' };
  }

  if (aviso.dias_restantes < 0) {
    return { label: 'Vencida', className: 'danger' };
  }

  if (aviso.deve_avisar) {
    return {
      label: aviso.dias_restantes === 0 ? 'Vence hoje' : `${aviso.dias_restantes} dias`,
      className: 'warn'
    };
  }

  return { label: `${aviso.dias_restantes} dias`, className: 'success' };
}

/**
 * Formata valores monetarios de clientes para exibicao em BRL.
 *
 * @param {unknown} valor - Valor numerico ou textual.
 * @returns {string} Valor em moeda ou '-'.
 */
function formatarMoeda(valor) {
  if (valor === undefined || valor === null || valor === '') return '-';

  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Retorna a lista de operadoras atuais em qualquer formato aceito pelo frontend.
 *
 * @param {Record<string, unknown>} cliente - Cliente retornado pela API.
 * @returns {Array} Operadoras vinculadas ao cliente.
 */
function obterOperadorasCliente(cliente) {
  return cliente?.operadoras_atuais || cliente?.operadorasAtuais || [];
}

/**
 * Gera uma slug CSS a partir do nome da operadora.
 *
 * @param {unknown} nome - Nome da operadora.
 * @returns {string} Slug normalizada.
 */
function slugOperadora(nome) {
  return String(nome).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-');
}

/**
 * Resume as operadoras do cliente para coluna da tabela e tooltip.
 *
 * @param {Record<string, unknown>} cliente - Cliente retornado pela API.
 * @returns {{ titulo: string, nomes: string[], detalhe: string }} Resumo de exibicao.
 */
function formatarResumoOperadoras(cliente) {
  const operadorasCliente = obterOperadorasCliente(cliente);
  if (operadorasCliente.length === 0) {
    const unico = cliente.operadoraAtual?.nome;
    return {
      titulo: unico || '-',
      nomes: unico ? [unico] : [],
      detalhe: ''
    };
  }

  const nomes = operadorasCliente
    .map(item => item.operadora?.nome)
    .filter(Boolean);
  const principais = nomes.slice(0, 2).join(', ');
  const restante = Math.max(nomes.length - 2, 0);

  return {
    titulo: `${principais || '-'}${restante > 0 ? ` +${restante}` : ''}`,
    nomes,
    detalhe: operadorasCliente
      .map(item => {
        const partes = [
          item.operadora?.nome || 'Operadora',
          `${item.quantidade_chips ?? 0} chips`,
          formatarMoeda(item.valor_pago)
        ];
        if (item.fidelidade_fim) partes.push(`fid. ${String(item.fidelidade_fim).slice(0, 10).split('-').reverse().join('/')}`);
        return partes.join(' - ');
      })
      .join('\n')
  };
}

/**
 * Formata data hora nota para exibicao ou envio.
 */
function formatarDataHoraNota(valor) {
  return formatUtcDateTime(valor, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Formata data hora registro para exibicao ou envio.
 */
function formatarDataHoraRegistro(valor) {
  return formatarDataHoraNota(valor) || '-';
}

/**
 * Retorna inicio do dia no formato esperado pelo fluxo.
 */
function inicioDoDia(data) {
  const dia = new Date(data);
  dia.setHours(0, 0, 0, 0);
  return dia;
}

/**
 * Processa diferenca dias calendario conforme as regras do dominio.
 */
function diferencaDiasCalendario(dataReferencia) {
  const data = parseUtcDateTime(dataReferencia);
  if (!data) return null;

  const hoje = inicioDoDia(new Date());
  const diaRetorno = inicioDoDia(data);
  return Math.round((diaRetorno.getTime() - hoje.getTime()) / 86400000);
}

/**
 * Retorna retorno nota status a partir dos dados informados.
 */
function getRetornoNotaStatus(cliente) {
  const resumo = cliente.notas_resumo || {};
  const proximoRetorno = resumo.proximo_retorno_agendado_para;

  if (Number(resumo.notas_com_retorno_total || 0) > 0) {
    const diasAteRetorno = diferencaDiasCalendario(proximoRetorno);
    const dataFormatada = formatarDataHoraNota(proximoRetorno) || 'este cliente';

    if (diasAteRetorno !== null && diasAteRetorno < 0) {
      return {
        className: 'danger',
        title: `Retorno vencido em ${dataFormatada}`
      };
    }

    if (diasAteRetorno !== null && diasAteRetorno <= 1) {
      return {
        className: 'warn',
        title: `Retorno marcado para ${dataFormatada}`
      };
    }

    return {
      className: 'success',
      title: `Retorno marcado para ${dataFormatada}`
    };
  }

  if (cliente.aviso_fidelidade?.dias_restantes < 0) {
    return {
      className: 'danger',
      title: 'Fidelidade vencida sem retorno marcado'
    };
  }

  return {
    className: 'muted',
    title: 'Sem retorno marcado'
  };
}

/**
 * Renderiza confirmar lixeira modal.
 */
function ConfirmarLixeiraModal({ cliente, excluindo, onClose, onConfirm }) {
  if (!cliente) return null;

  return (
    <div className="modal-overlay" onClick={event => !excluindo && event.target === event.currentTarget && onClose()}>
      <div className="modal trash-confirm-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Enviar cliente para a lixeira?</div>
              <div className="modal-sub">{cliente.nome} - #{cliente.id}</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={excluindo}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="trash-warning">
            <I.AlertTriangle size={20} />
            <div>
              <strong>Este cliente será enviado para a lixeira.</strong>
              <span>Ele ficará disponível para restauração e será permanentemente deletado daqui a 1 mês.</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={excluindo}>
            {excluindo ? 'Enviando...' : 'Enviar para lixeira'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza confirmar limpeza base modal.
 */
function ConfirmarLimpezaBaseModal({ aberto, limpando, onClose, onConfirm }) {
  if (!aberto) return null;

  return (
    <div className="modal-overlay" onClick={event => !limpando && event.target === event.currentTarget && onClose()}>
      <div className="modal trash-confirm-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Apagar base anterior?</div>
              <div className="modal-sub">Clientes da base anterior e vendas vinculadas serao apagados.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={limpando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="trash-warning">
            <I.AlertTriangle size={20} />
            <div>
              <strong>Esta acao apaga permanentemente os clientes da base anterior e todas as vendas relacionadas.</strong>
              <span>Use apenas quando precisar desfazer uma importacao da planilha.</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={limpando}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={limpando}>
            {limpando ? 'Apagando...' : 'Apagar base e vendas'}
          </button>
        </div>
      </div>
    </div>
  );
}

const CAMPOS_IMPORTACAO_BASE = [
  { name: 'cnpj', label: 'CNPJ', required: true },
  { name: 'nome', label: 'Nome' },
  { name: 'razao_social', label: 'Razao social' },
  { name: 'responsavel_nome', label: 'Responsavel' },
  { name: 'email', label: 'E-mail' },
  { name: 'whatsapp', label: 'WhatsApp' },
  { name: 'fixo', label: 'Fixo' },
  { name: 'quantidade_chips', label: 'Quantidade de chips' },
  { name: 'valor_pago', label: 'Valor pago' },
  { name: 'operadora_atual', label: 'Operadora atual' }
];

/**
 * Renderiza importar base anterior modal.
 */
function ImportarBaseAnteriorModal({ onClose, onImported }) {
  const [arquivo, setArquivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapeamento, setMapeamento] = useState({});
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const colunas = preview?.colunas || [];
  const podeImportar = Boolean(arquivo && preview && mapeamento.cnpj && !carregando);

  /**
   * Carrega preview e atualiza o estado relacionado.
   */
  async function carregarPreview(file) {
    setArquivo(file || null);
    setPreview(null);
    setResultado(null);
    setMapeamento({});
    setErro('');

    if (!file) return;

    setCarregando(true);
    try {
      const data = await previewImportacaoBaseAnterior(file);
      setPreview(data);
      setMapeamento(data.sugestoes || {});
    } catch (error) {
      setErro(error.message || 'Erro ao ler planilha.');
    } finally {
      setCarregando(false);
    }
  }

  /**
   * Processa executar importacao conforme as regras do dominio.
   */
  async function executarImportacao(event) {
    event.preventDefault();
    if (!podeImportar) return;

    setCarregando(true);
    setErro('');
    setResultado(null);

    try {
      const data = await importarBaseAnterior(arquivo, mapeamento);
      setResultado(data);
      await onImported(data);
    } catch (error) {
      setErro(error.message || 'Erro ao importar planilha.');
    } finally {
      setCarregando(false);
    }
  }

  /**
   * Atualiza mapeamento com os dados informados.
   */
  function atualizarMapeamento(campo, coluna) {
    setMapeamento(prev => ({ ...prev, [campo]: coluna }));
  }

  return (
    <div className="modal-overlay" onClick={event => event.target === event.currentTarget && !carregando && onClose()}>
      <form className="modal cliente-import-modal" onSubmit={executarImportacao}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Importar base anterior</div>
              <div className="modal-sub">Selecione o Excel e relacione cada coluna aos campos do cliente.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={carregando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label>Arquivo .xlsx</label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={event => carregarPreview(event.target.files?.[0])}
              disabled={carregando}
            />
          </div>

          {preview && (
            <>
              <div className="cliente-import-summary">
                <span>Aba: <strong>{preview.aba}</strong></span>
                <span>Linhas: <strong>{preview.total_linhas}</strong></span>
                <span>Colunas: <strong>{colunas.length}</strong></span>
              </div>

              <div className="cliente-import-map">
                <div className="cliente-import-map__head">
                  <span>Campo do cliente</span>
                  <span>Coluna do Excel</span>
                  <span>Amostras</span>
                </div>
                {CAMPOS_IMPORTACAO_BASE.map(campo => {
                  const colunaSelecionada = mapeamento[campo.name] || '';
                  const amostras = (preview.amostras || [])
                    .map(item => item.dados?.[colunaSelecionada])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(' | ');

                  return (
                    <div className="cliente-import-map__row" key={campo.name}>
                      <label>
                        {campo.label}
                        {campo.required && <span className="required-mark">*</span>}
                      </label>
                      <select
                        value={colunaSelecionada}
                        onChange={event => atualizarMapeamento(campo.name, event.target.value)}
                        required={campo.required}
                        disabled={carregando}
                      >
                        <option value="">Não importar</option>
                        {colunas.map(coluna => (
                          <option key={`${campo.name}:${coluna.index}`} value={coluna.nome}>{coluna.nome}</option>
                        ))}
                      </select>
                      <span title={amostras}>{amostras || '-'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {resultado && (
            <div className="cliente-import-result">
              <span>Linhas lidas: <strong>{resultado.linhas_lidas}</strong></span>
              <span>CNPJs unicos: <strong>{resultado.cnpjs_unicos}</strong></span>
              <span>Criados: <strong>{resultado.criados}</strong></span>
              <span>Atualizados: <strong>{resultado.atualizados}</strong></span>
              <span>Ignorados: <strong>{resultado.linhas_ignoradas}</strong></span>
              {resultado.operadoras_nao_encontradas?.length > 0 && (
                <span>Operadoras nao encontradas: <strong>{resultado.operadoras_nao_encontradas.join(', ')}</strong></span>
              )}
              {resultado.erros?.length > 0 && (
                <span>Erros: <strong>{resultado.erros.slice(0, 3).map(item => `linha ${item.row_index}`).join(', ')}</strong></span>
              )}
            </div>
          )}

          {erro && <div className="alert-error" style={{ marginTop: 16 }}>{erro}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={carregando}>Fechar</button>
          <button type="submit" className="btn btn-primary" disabled={!podeImportar}>
            {carregando ? 'Processando...' : 'Importar clientes'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Processa lista avisos importacao conforme as regras do dominio.
 */
function ListaAvisosImportacao({ titulo, itens }) {
  if (!itens?.length) return null;

  return (
    <span title={itens.join(', ')}>
      {titulo}: <strong>{itens.slice(0, 5).join(', ')}{itens.length > 5 ? ` +${itens.length - 5}` : ''}</strong>
    </span>
  );
}

/**
 * Renderiza importar vendas empresas modal.
 */
function ImportarVendasEmpresasModal({ onClose, onImported }) {
  const [arquivo, setArquivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapeamento, setMapeamento] = useState({});
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const camposMapeamento = preview?.campos_mapeamento || [];
  const colunas = preview?.colunas || [];
  const camposObrigatoriosOk = camposMapeamento
    .filter(campo => campo.required)
    .every(campo => mapeamento[campo.name]);
  const podeImportar = Boolean(arquivo && preview && camposObrigatoriosOk && !carregando);
  const avisos = preview?.avisos || resultado?.avisos || {};
  const amostras = preview?.amostras || [];

  /**
   * Carrega preview e atualiza o estado relacionado.
   */
  async function carregarPreview(file) {
    setArquivo(file || null);
    setPreview(null);
    setMapeamento({});
    setResultado(null);
    setErro('');

    if (!file) return;

    setCarregando(true);
    try {
      const data = await previewImportacaoVendasEmpresas(file);
      setPreview(data);
      setMapeamento(data.mapeamento || data.sugestoes || {});
    } catch (error) {
      setErro(error.message || 'Erro ao ler planilha.');
    } finally {
      setCarregando(false);
    }
  }

  /**
   * Atualiza mapeamento com os dados informados.
   */
  async function atualizarMapeamento(campo, coluna) {
    const proximo = { ...mapeamento, [campo]: coluna };
    setMapeamento(proximo);

    if (!arquivo) return;

    setCarregando(true);
    setErro('');
    try {
      const data = await previewImportacaoVendasEmpresas(arquivo, proximo);
      setPreview(data);
      setMapeamento(data.mapeamento || proximo);
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar mapeamento.');
    } finally {
      setCarregando(false);
    }
  }

  /**
   * Processa executar importacao conforme as regras do dominio.
   */
  async function executarImportacao(event) {
    event.preventDefault();
    if (!podeImportar) return;

    setCarregando(true);
    setErro('');
    setResultado(null);

    try {
      const data = await importarVendasEmpresas(arquivo, mapeamento);
      setResultado(data);
      await onImported(data);
    } catch (error) {
      setErro(error.message || 'Erro ao importar vendas.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={event => event.target === event.currentTarget && !carregando && onClose()}>
      <form className="modal cliente-import-modal" onSubmit={executarImportacao}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">Importar planilha</div>
              <div className="modal-sub">Cria ou atualiza clientes e registra as vendas da planilha de controle.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={carregando}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label>Arquivo .xlsx</label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={event => carregarPreview(event.target.files?.[0])}
              disabled={carregando}
            />
          </div>

          {preview && (
            <>
              <div className="cliente-import-summary">
                <span>Aba: <strong>{preview.aba}</strong></span>
                <span>Linhas validas: <strong>{preview.linhas_validas}</strong></span>
                <span>CNPJs unicos: <strong>{preview.cnpjs_unicos}</strong></span>
                <span>Vendas detectadas: <strong>{preview.vendas_detectadas}</strong></span>
                <span>Para criar: <strong>{preview.vendas_para_criar}</strong></span>
                <span>Ja importadas: <strong>{preview.vendas_ja_importadas}</strong></span>
                <ListaAvisosImportacao titulo="Consultores nao encontrados" itens={avisos.consultores_nao_encontrados} />
                <ListaAvisosImportacao titulo="Operadoras nao encontradas" itens={avisos.operadoras_nao_encontradas} />
                <ListaAvisosImportacao titulo="Produtos a cadastrar" itens={avisos.produtos_a_cadastrar} />
              </div>

              <div className="cliente-import-map">
                <div className="cliente-import-map__head">
                  <span>Campo do sistema</span>
                  <span>Coluna da planilha</span>
                  <span>Status</span>
                </div>
                {camposMapeamento.map(campo => (
                  <div className="cliente-import-map__row" key={campo.name}>
                    <label>
                      {campo.label}
                      {campo.required && <span className="required-mark">*</span>}
                    </label>
                    <select
                      value={mapeamento[campo.name] || ''}
                      onChange={event => atualizarMapeamento(campo.name, event.target.value)}
                      required={campo.required}
                      disabled={carregando}
                    >
                      <option value="">Nao importar</option>
                      {colunas.map(coluna => (
                        <option key={`${campo.name}:${coluna.index}`} value={coluna.nome}>{coluna.nome}</option>
                      ))}
                    </select>
                    <span>{mapeamento[campo.name] ? 'Mapeado' : (campo.required ? 'Obrigatorio' : 'Opcional')}</span>
                  </div>
                ))}
              </div>

              {amostras.length > 0 && (
                <div className="cliente-import-map cliente-import-map--vendas">
                  <div className="cliente-import-map__head">
                    <span>Cliente</span>
                    <span>Venda</span>
                    <span>Resumo</span>
                  </div>
                  {amostras.map(amostra => (
                    <div className="cliente-import-map__row" key={amostra.linhas.join('-')}>
                      <label title={`${amostra.cliente} - ${amostra.cnpj}`}>{amostra.cliente}</label>
                      <span title={`${amostra.data_venda || '-'} - ${amostra.produto || '-'}`}>
                        {amostra.data_venda || '-'} - {amostra.produto || '-'}
                      </span>
                      <span title={amostra.status || '-'}>
                        {amostra.chips} chip(s), {formatarMoeda(amostra.valor_total)} - {amostra.status || '-'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {resultado && (
            <div className="cliente-import-result">
              <span>Clientes criados: <strong>{resultado.clientes_criados}</strong></span>
              <span>Clientes atualizados: <strong>{resultado.clientes_atualizados}</strong></span>
              <span>Vendas criadas: <strong>{resultado.vendas_criadas}</strong></span>
              <span>Duplicadas ignoradas: <strong>{resultado.vendas_ignoradas_duplicadas}</strong></span>
              <span>Linhas ignoradas: <strong>{resultado.linhas_ignoradas}</strong></span>
              {resultado.produtos_cadastrados?.length > 0 && (
                <span>Produtos cadastrados: <strong>{resultado.produtos_cadastrados.join(', ')}</strong></span>
              )}
              {resultado.erros?.length > 0 && (
                <span>Erros: <strong>{resultado.erros.slice(0, 3).map(item => `linha ${item.row_index}`).join(', ')}</strong></span>
              )}
            </div>
          )}

          {erro && <div className="alert-error" style={{ marginTop: 16 }}>{erro}</div>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={carregando}>Fechar</button>
          <button type="submit" className="btn btn-primary" disabled={!podeImportar}>
            {carregando ? 'Processando...' : 'Importar clientes e vendas'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Tela principal de clientes: listagem, filtros, importacao, exportacao e acoes de venda.
 *
 * @returns {ReactElement} Pagina de clientes.
 */
function Clientes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const usuario = getUsuarioLocal();
  const clienteIdParam = searchParams.get('cliente_id') || '';
  const fidelidadeParam = searchParams.get('fidelidade') || '';
  const retornoParam = searchParams.get('retorno') || '';
  const novoClienteParam = searchParams.get('novo') === '1';
  const highlightClienteId = searchParams.get('highlight') || clienteIdParam;

  const podeCriar = temPermissao(usuario, 'clientes_criar');
  const podeImportarPlanilhas = temPermissao(usuario, 'clientes_importar_planilhas');
  const podeEditar = temPermissao(usuario, 'clientes_editar');
  const podeGerenciarConsultoras = temPermissao(usuario, 'clientes_atribuir_vendedora');
  const podeExcluir = temPermissao(usuario, 'clientes_excluir');
    const podeListarClientes = temPermissao(usuario, ['clientes_ver_proprios', 'clientes_ver_todos']);
  const podeEditarVenda = temPermissao(usuario, ['vendas_editar', 'pos_venda']);
  const podeCompartilharVenda = temPermissao(usuario, 'compartilhar_venda');
  const podeVerDocumentosVenda = temPermissao(usuario, 'vendas_documentos');
  const podeAdicionarDocumentosVenda = temPermissao(usuario, 'adicionar_documentos');
  const podeListarVendas = temPermissao(usuario, ['vendas_ver_proprias', 'vendas_ver_todas']);

  const [clientes, setClientes] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [clientesVenda, setClientesVenda] = useState([]);
  const [vendedorasVenda, setVendedorasVenda] = useState([]);
  const [referenciasClientesVenda, setReferenciasClientesVenda] = useState([]);
  const [tiposVenda, setTiposVenda] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [dadosVendaModalCarregados, setDadosVendaModalCarregados] = useState(false);
  const [vendasConcluidasContagem, setVendasConcluidasContagem] = useState({});
  const [buscaCampo, setBuscaCampo] = useState('geral');
  const [busca, setBusca] = useState('');
  const [operadoraId, setOperadoraId] = useState('');
  const [responsavelTipo, setResponsavelTipo] = useState('');
  const [fidelidade, setFidelidade] = useState(fidelidadeParam);
  const [retorno, setRetorno] = useState(retornoParam);
  const [baseAnterior, setBaseAnterior] = useState('');
  const [chipsMin, setChipsMin] = useState('');
  const [chipsMax, setChipsMax] = useState('');
  const [clienteIdFiltro, setClienteIdFiltro] = useState(clienteIdParam);
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [clienteModal, setClienteModal] = useState(null);
  const [clienteModalAba, setClienteModalAba] = useState('cliente');
  const [clienteModalSomenteNotas, setClienteModalSomenteNotas] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [vendaModal, setVendaModal] = useState(null);
  const [vendaModalModoEdicao, setVendaModalModoEdicao] = useState(false);
  const [carregandoVendaModal, setCarregandoVendaModal] = useState(false);
  const [clienteCadastroDraft, setClienteCadastroDraft] = useState(null);
  const [importModalAberto, setImportModalAberto] = useState(false);
  const mostrarImportacaoSomenteClientes = importModalAberto && searchParams.get('modo_importacao') === 'clientes';
  const [limparBaseModalAberto, setLimparBaseModalAberto] = useState(false);
  const [clienteParaLixeira, setClienteParaLixeira] = useState(null);
  const [excluindo, setExcluindo] = useState(false);
  const [limpandoBase, setLimpandoBase] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina, setItensPorPagina] = useState(20);
  const [totalClientes, setTotalClientes] = useState(0);

  const buscaDeferred = useDeferredValue(busca);
  const buscaDebounced = useDebounce(buscaDeferred, 300);

  const filtros = useMemo(() => ({
    busca: buscaCampo === 'geral' ? buscaDebounced : '',
    busca_campo: buscaCampo !== 'geral' ? buscaCampo : '',
    busca_valor: buscaCampo !== 'geral' ? buscaDebounced : '',
    operadora_atual_id: operadoraId,
    responsavel_tipo: responsavelTipo,
    fidelidade,
    retorno,
    base_anterior_sistema: baseAnterior,
    chips_min: chipsMin,
    chips_max: chipsMax,
    cliente_id: clienteIdFiltro
  }), [buscaCampo, buscaDebounced, operadoraId, responsavelTipo, fidelidade, retorno, baseAnterior, chipsMin, chipsMax, clienteIdFiltro]);

  const filtrosAtivos = useMemo(() => {
    const buscaAtiva = buscaCampo === 'geral'
      ? Boolean(filtros.busca)
      : Boolean(filtros.busca_campo && filtros.busca_valor);
    const demaisFiltros = Object.entries(filtros)
      .filter(([chave, valor]) => !['busca', 'busca_campo', 'busca_valor'].includes(chave) && valor !== '')
      .length;

    return demaisFiltros + (buscaAtiva ? 1 : 0);
  }, [buscaCampo, filtros]);

  const filtrosPopupAtivos = useMemo(() => (
    [operadoraId, responsavelTipo, fidelidade, retorno, baseAnterior, chipsMin, chipsMax]
      .filter(v => v !== '').length
  ), [operadoraId, responsavelTipo, fidelidade, retorno, baseAnterior, chipsMin, chipsMax]);

  const vendasPorClienteModal = useMemo(() => {
    const mapa = new Map();
    referenciasClientesVenda.forEach(item => {
      if (item?.chave) mapa.set(item.chave, Number(item.total || 0));
    });
    return mapa;
  }, [referenciasClientesVenda]);

  const vendasEmAndamentoPorClienteModal = useMemo(() => {
    const mapa = new Map();
    referenciasClientesVenda.forEach(item => {
      if (item?.chave) mapa.set(item.chave, Number(item.em_andamento_total || 0));
    });
    return mapa;
  }, [referenciasClientesVenda]);

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
   * Carrega clientes e atualiza o estado relacionado.
   */
  async function carregarClientes(proximosFiltros = filtros, pagina = paginaAtual, porPagina = itensPorPagina) {
    setErro('');
    setCarregando(true);

    try {
      const dados = await listarClientes({ ...proximosFiltros, page: pagina, per_page: porPagina });
      const totalPaginas = Math.max(1, Math.ceil(dados.total / porPagina));
      if (pagina > totalPaginas) {
        const novosDados = await listarClientes({ ...proximosFiltros, page: totalPaginas, per_page: porPagina });
        setClientes(novosDados.data);
        setTotalClientes(novosDados.total);
        setPaginaAtual(totalPaginas);
      } else {
        setClientes(dados.data);
        setTotalClientes(dados.total);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao carregar clientes.');
    } finally {
      setCarregando(false);
    }
  }

  /**
   * Renderiza carregar dados venda modal.
   */
  async function carregarDadosVendaModal() {
    if (dadosVendaModalCarregados) return;

    const [clientesData, vendedorasData, referenciasData, tiposVendaData, servicosData] = await Promise.all([
      podeListarClientes ? listarClientesSelect() : Promise.resolve([]),
      listarVendedoras(),
      obterReferenciasClientesVendas(),
      listarTiposVenda(),
      listarServicos()
    ]);

    setClientesVenda(clientesData || []);
    setVendedorasVenda(vendedorasData || []);
    setReferenciasClientesVenda(referenciasData || []);
    setTiposVenda(tiposVendaData || []);
    setServicos(servicosData || []);
    setDadosVendaModalCarregados(true);
  }

  useEffect(() => {
    let ativo = true;
    Promise.all([
      listarOperadoras(),
      contarVendasConcluidasPorCliente(),
      podeGerenciarConsultoras ? listarVendedoras() : Promise.resolve([])
    ])
      .then(([operadorasData, contagemData, consultorasData]) => {
        if (!ativo) return;
        setOperadoras(operadorasData);
        setVendasConcluidasContagem(contagemData || {});
        if (podeGerenciarConsultoras) setVendedorasVenda(consultorasData || []);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar dados.');
      });
    return () => { ativo = false; };
  }, [podeGerenciarConsultoras]);

  const chaveParametros = `${clienteIdParam}:${fidelidadeParam}:${retornoParam}`;
  const [parametrosAplicados, setParametrosAplicados] = useState(chaveParametros);
  if (parametrosAplicados !== chaveParametros) {
    setParametrosAplicados(chaveParametros);
    setClienteIdFiltro(clienteIdParam);
    setFidelidade(fidelidadeParam);
    setRetorno(retornoParam);
  }

  const [novoClienteProcessado, setNovoClienteProcessado] = useState(false);
  if (novoClienteParam && !novoClienteProcessado) {
    setNovoClienteProcessado(true);
    if (podeCriar) {
      setClienteModal(null);
      setClienteModalAba('cliente');
      setClienteModalSomenteNotas(false);
      setModalAberto(true);
    } else {
      setErro('Você não tem permissão para cadastrar clientes.');
    }
  } else if (!novoClienteParam && novoClienteProcessado) {
    setNovoClienteProcessado(false);
  }

  useEffect(() => {
    if (!novoClienteParam) return;
    const proximosParams = new URLSearchParams(searchParams);
    proximosParams.delete('novo');
    setSearchParams(proximosParams, { replace: true });
  }, [novoClienteParam, searchParams, setSearchParams]);

  const [filtrosAplicados, setFiltrosAplicados] = useState(filtros);
  if (filtrosAplicados !== filtros) {
    setFiltrosAplicados(filtros);
    setPaginaAtual(1);
    setCarregando(true);
  }

  useEffect(() => {
    let ativo = true;
    listarClientes({ ...filtros, page: 1, per_page: itensPorPagina })
      .then(dados => {
        if (!ativo) return;
        setClientes(dados.data);
        setTotalClientes(dados.total);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar clientes.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => { ativo = false; };
  }, [filtros, itensPorPagina]);

  useEffect(() => {
    /**
     * Trata o evento de notas atualizar.
     */
    function handleNotasAtualizar({ detail }) {
      const { clienteId, notas } = detail;
      setClientes(prev => prev.map(c => {
        if (Number(c.id) !== Number(clienteId)) return c;
        const comRetorno = notas.filter(n => n.retorno_agendado_para);
        const agendadas = comRetorno
          .map(n => n.retorno_agendado_para)
          .sort((a, b) => getUtcDateTimeTimestamp(a, Number.MAX_SAFE_INTEGER) - getUtcDateTimeTimestamp(b, Number.MAX_SAFE_INTEGER));
        const agora = Date.now();
        const vencidas = agendadas.filter(d => getUtcDateTimeTimestamp(d, Number.MAX_SAFE_INTEGER) <= agora);
        return {
          ...c,
          notas_resumo: {
            notas_total: notas.length,
            notas_com_retorno_total: comRetorno.length,
            notas_retorno_vencido_total: vencidas.length,
            proximo_retorno_agendado_para: agendadas[0] || null,
            proximo_retorno_vencido_para: vencidas[0] || null
          }
        };
      }));
    }

    window.addEventListener('pos-venda:notas-cliente-atualizar', handleNotasAtualizar);
    return () => window.removeEventListener('pos-venda:notas-cliente-atualizar', handleNotasAtualizar);
  }, []);

  const clientesComAviso = useMemo(() => (
    clientes.filter(cliente => cliente.aviso_fidelidade?.deve_avisar).length
  ), [clientes]);

  const vendasConcluidasPorCliente = useMemo(() => {
    const mapa = new Map();
    Object.entries(vendasConcluidasContagem).forEach(([id, total]) => {
      mapa.set(`cliente:${id}`, total);
    });
    return mapa;
  }, [vendasConcluidasContagem]);

  /**
   * Trata o evento de buscar.
   */
  async function handleBuscar(event) {
    event.preventDefault();
    await carregarClientes(filtros);
  }

  /**
   * Exporta clientes no formato esperado.
   */
  async function exportarClientes() {
    setErro('');
    setExportando(true);

    try {
      await exportarClientesExcel(filtros);
      setSucesso('Exportacao de clientes iniciada.');
    } catch (error) {
      setErro(error.message || 'Erro ao exportar clientes.');
    } finally {
      setExportando(false);
    }
  }

  /**
   * Limpa filtros e restaura o estado inicial.
   */
  function limparFiltros() {
    setBuscaCampo('geral');
    setBusca('');
    setOperadoraId('');
    setResponsavelTipo('');
    setFidelidade('');
    setRetorno('');
    setBaseAnterior('');
    setChipsMin('');
    setChipsMax('');
    setClienteIdFiltro('');
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
    setBusca(formatarBuscaClientesPorCampo(buscaCampo, valor));
  }

  /**
   * Abre novo cliente e prepara o estado necessario.
   */
  function abrirNovoCliente() {
    setClienteModal(null);
    setClienteModalAba('cliente');
    setClienteModalSomenteNotas(false);
    setModalAberto(true);
  }

  /**
   * Abre edicao cliente e prepara o estado necessario.
   */
  function abrirEdicaoCliente(cliente) {
    if (!podeEditar && !podeGerenciarConsultoras) return;
    setClienteModal(cliente);
    setClienteModalAba('cliente');
    setClienteModalSomenteNotas(false);
    setModalAberto(true);
  }

  /**
   * Abre notas cliente e prepara o estado necessario.
   */
  function abrirNotasCliente(cliente) {
    setClienteModal(cliente);
    setClienteModalAba('notas');
    setClienteModalSomenteNotas(true);
    setModalAberto(true);
  }

  /**
   * Salva cliente com os dados informados.
   */
  async function salvarCliente() {
    setErro('');
    const editando = Boolean(clienteModal);
    setModalAberto(false);
    setClienteModal(null);
    setClienteModalAba('cliente');
    setClienteModalSomenteNotas(false);
    if (!editando) {
      setClienteCadastroDraft(null);
    }
    await carregarClientes(filtros);
    setSucesso(editando ? 'Cliente atualizado com sucesso.' : 'Cliente cadastrado com sucesso.');
  }

  /**
   * Abre venda do cliente e prepara o estado necessario.
   */
  async function abrirVendaDoCliente(vendaResumo) {
    if (!vendaResumo?.id || carregandoVendaModal) return;

    setErro('');
    setCarregandoVendaModal(true);

    try {
      await carregarDadosVendaModal();
      const venda = await buscarVendaPorId(vendaResumo.id);
      setModalAberto(false);
      setClienteModalAba('cliente');
      setClienteModalSomenteNotas(false);
      setVendaModal(venda || vendaResumo);
      setVendaModalModoEdicao(false);
    } catch (error) {
      setErro(error.message || 'Erro ao abrir venda.');
    } finally {
      setCarregandoVendaModal(false);
    }
  }

  /**
   * Renderiza salvar venda modal.
   */
  async function salvarVendaModal(dados) {
    if (!vendaModal?.id) return;

    setErro('');

    try {
      await atualizarVenda(vendaModal.id, dados);
      const atualizada = await buscarVendaPorId(vendaModal.id);
      setVendaModal(atualizada);
      setVendaModalModoEdicao(false);
      await Promise.all([
        carregarClientes(filtros, paginaAtual),
        contarVendasConcluidasPorCliente().then(data => setVendasConcluidasContagem(data || {})),
        obterReferenciasClientesVendas().then(data => setReferenciasClientesVenda(data || []))
      ]);
      setSucesso('Venda atualizada com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao salvar venda.');
      throw error;
    }
  }

  /**
   * Renderiza enviar pos venda modal.
   */
  async function enviarPosVendaModal(venda) {
    if (!venda?.id) return;

    setErro('');

    try {
      const resultado = await enviarVendaParaPosVenda(venda.id);
      const atualizada = await buscarVendaPorId(venda.id);
      setVendaModal(atualizada);
      setVendaModalModoEdicao(false);
      window.dispatchEvent(new CustomEvent('pos-venda:notificacoes-atualizar'));
      setSucesso(resultado?.status === 'pendente'
        ? (resultado.message || 'Solicitacao enviada para aprovacao do ADM.')
        : 'Venda enviada para o pos-venda.');
    } catch (error) {
      setErro(error.message || 'Erro ao enviar venda para o pos-venda.');
      throw error;
    }
  }

  /**
   * Executa a acao de finalizar importacao base anterior mantendo o estado da tela consistente.
   */
  async function finalizarImportacaoBaseAnterior(resultado) {
    setImportModalAberto(false);
    await carregarClientes(filtros);
    setSucesso(`Importacao concluida: ${resultado.criados || 0} criado(s) e ${resultado.atualizados || 0} atualizado(s).`);
  }

  /**
   * Executa a acao de finalizar importacao vendas empresas mantendo o estado da tela consistente.
   */
  async function finalizarImportacaoVendasEmpresas(resultado) {
    setImportModalAberto(false);
    await Promise.all([
      carregarClientes(filtros),
      contarVendasConcluidasPorCliente().then(data => setVendasConcluidasContagem(data || {}))
    ]);
    setSucesso(`Importacao concluida: ${resultado.vendas_criadas || 0} venda(s), ${resultado.clientes_criados || 0} cliente(s) novo(s) e ${resultado.clientes_atualizados || 0} atualizado(s).`);
  }

  /**
   * Executa a acao de confirmar exclusao cliente mantendo o estado da tela consistente.
   */
  async function confirmarExclusaoCliente() {
    if (!clienteParaLixeira) return;

    setExcluindo(true);
    try {
      await excluirCliente(clienteParaLixeira.id);
      setClientes(prev => prev.filter(item => item.id !== clienteParaLixeira.id));
      setClienteParaLixeira(null);
      setSucesso('Cliente enviado para a lixeira.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir cliente.');
    } finally {
      setExcluindo(false);
    }
  }

  /**
   * Executa a acao de confirmar limpeza base anterior mantendo o estado da tela consistente.
   */
  async function confirmarLimpezaBaseAnterior() {
    setLimpandoBase(true);
    setErro('');

    try {
      const resultado = await limparClientesBaseAnterior({ excluirVendasRelacionadas: true });
      setLimparBaseModalAberto(false);
      await Promise.all([
        carregarClientes(filtros),
        contarVendasConcluidasPorCliente().then(data => setVendasConcluidasContagem(data || {}))
      ]);
      setSucesso(`${resultado.excluidos || 0} cliente(s) e ${resultado.vendas_excluidas || 0} venda(s) da base anterior apagado(s).`);
    } catch (error) {
      setErro(error.message || 'Erro ao apagar base anterior.');
    } finally {
      setLimpandoBase(false);
    }
  }

  return (
    <LayoutPrivado>
      {modalAberto && (
        <ClienteModal
          cliente={clienteModal}
          operadoras={operadoras}
          initialTab={clienteModalAba}
          initialDraft={clienteCadastroDraft}
          notesOnly={clienteModalSomenteNotas}
          onClose={() => {
            setModalAberto(false);
            setClienteModalAba('cliente');
            setClienteModalSomenteNotas(false);
          }}
          onSave={salvarCliente}
          onDraftChange={setClienteCadastroDraft}
          onOpenVenda={podeListarVendas ? abrirVendaDoCliente : null}
          podeGerenciarConsultoras={podeGerenciarConsultoras}
          consultorasDisponiveis={vendedorasVenda}
          somenteConsultoras={!podeEditar && podeGerenciarConsultoras}
        />
      )}

      {vendaModal && (
        <VendaModal
          venda={vendaModal}
          clientes={clientesVenda}
          vendas={[]}
          vendedoras={vendedorasVenda}
          operadoras={operadoras}
          tiposVenda={tiposVenda}
          servicos={servicos}
          vendasPorCliente={vendasPorClienteModal}
          vendasEmAndamentoPorCliente={vendasEmAndamentoPorClienteModal}
          podeEditarVenda={podeEditarVenda}
          podeCompartilharVenda={podeCompartilharVenda}
          podeVerDocumentosVenda={podeVerDocumentosVenda}
          podeAdicionarDocumentosVenda={podeAdicionarDocumentosVenda}
          usuarioLogado={usuario}
          initialTab="venda"
          modoEdicao={vendaModalModoEdicao}
          onStartEdit={() => setVendaModalModoEdicao(true)}
          onClose={() => {
            setVendaModal(null);
            setVendaModalModoEdicao(false);
          }}
          onSave={salvarVendaModal}
          onSendToPosVenda={enviarPosVendaModal}
        />
      )}

      {mostrarImportacaoSomenteClientes && podeImportarPlanilhas && (
        <ImportarBaseAnteriorModal
          onClose={() => setImportModalAberto(false)}
          onImported={finalizarImportacaoBaseAnterior}
        />
      )}

      {importModalAberto && !mostrarImportacaoSomenteClientes && podeImportarPlanilhas && (
        <ImportarVendasEmpresasModal
          onClose={() => setImportModalAberto(false)}
          onImported={finalizarImportacaoVendasEmpresas}
        />
      )}

      <ConfirmarLixeiraModal
        cliente={clienteParaLixeira}
        excluindo={excluindo}
        onClose={() => setClienteParaLixeira(null)}
        onConfirm={confirmarExclusaoCliente}
      />

      <ConfirmarLimpezaBaseModal
        aberto={limparBaseModalAberto}
        limpando={limpandoBase}
        onClose={() => setLimparBaseModalAberto(false)}
        onConfirm={confirmarLimpezaBaseAnterior}
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
                <label>Responsável</label>
                <SelectFiltro
                  value={responsavelTipo}
                  onChange={setResponsavelTipo}
                  placeholder="Todos"
                  options={[
                    { value: 'rl', label: 'RL' },
                    { value: 'adm', label: 'ADM' },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>Fidelidade</label>
                <SelectFiltro
                  value={fidelidade}
                  onChange={setFidelidade}
                  placeholder="Todas"
                  options={[
                    { value: 'ativa', label: 'Ativa' },
                    { value: 'alerta', label: 'Com alerta' },
                    { value: 'vencida', label: 'Vencida' },
                    { value: 'sem', label: 'Sem fidelidade' },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>Base anterior</label>
                <SelectFiltro
                  value={baseAnterior}
                  onChange={setBaseAnterior}
                  placeholder="Todos"
                  options={[
                    { value: 'true', label: 'Somente base anterior' },
                    { value: 'false', label: 'Sem marcador' },
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>Chips min.</label>
                <input type="number" min="0" value={chipsMin} onChange={e => setChipsMin(e.target.value)} />
              </div>
              <div className="filter-field">
                <label>Chips max.</label>
                <input type="number" min="0" value={chipsMax} onChange={e => setChipsMax(e.target.value)} />
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

      <div className="clientes-page">
        <div className="clientes-toolbar">
          <div className="clientes-toolbar__meta">
            {totalClientes} clientes cadastrados
            {clientesComAviso > 0 ? ` - ${clientesComAviso} aviso(s) de fidelidade` : ''}
            {filtrosAtivos > 0 ? ` - ${filtrosAtivos} filtro(s) ativo(s)` : ''}
          </div>

          <div className="clientes-toolbar__actions">
            <form className="clientes-busca" onSubmit={handleBuscar}>
              <SelectFiltro
                value={buscaCampo}
                onChange={alterarBuscaCampo}
                options={BUSCA_CLIENTES_CAMPO_OPCOES}
                searchable={false}
                className="clientes-busca__campo"
              />
              <div className="search-box clientes-busca__valor">
                <I.Search size={14} />
                <input
                  value={busca}
                  onChange={event => alterarBuscaValor(event.target.value)}
                  placeholder={getPlaceholderBuscaClientes(buscaCampo)}
                  inputMode={getInputModeBuscaClientes(buscaCampo)}
                  maxLength={getMaxLengthBuscaClientes(buscaCampo)}
                />
              </div>
            </form>

            <button className="btn" type="button" onClick={() => setFiltrosAbertos(true)}>
              <I.Filter size={14} /> Filtros
              {filtrosPopupAtivos > 0 && <span className="filtros-count">{filtrosPopupAtivos}</span>}
            </button>

            {podeImportarPlanilhas && (
              <>
                <button className="btn" type="button" onClick={() => setImportModalAberto(true)}>
                  <I.Upload size={14} /> Importar Excel
                </button>
                
                <button className="btn" type="button" onClick={exportarClientes} disabled={exportando || totalClientes === 0}>
                  <I.Download size={14} /> {exportando ? 'Exportando...' : 'Exportar Excel'}
                </button>
              </>
            )}

           

            {podeCriar && (
              <>
                {/* {podeLimparBaseAnterior && (
                  <button className="btn btn-danger" type="button" onClick={() => setLimparBaseModalAberto(true)}>
                    <I.Trash size={14} /> Apagar base anterior
                  </button>
                )} */}
                <button className="btn btn-primary" type="button" onClick={abrirNovoCliente}>
                  <I.Plus size={14} /> Novo cliente
                </button>
              </>
            )}

            {podeExcluir && (
              <button className="btn btn-danger" type="button" onClick={() => navigate('/clientes/lixeira')}>
                <I.Trash size={14} /> Lixeira
              </button>
            )}
          </div>
        </div>

        {sucesso && <div className="alert-success alert-timed alert-timed--success" style={{ marginBottom: 16 }}>{sucesso}</div>}
        {erro && <div className="alert-error alert-timed alert-timed--error">{erro}</div>}

        <div className="list-table" style={{ margin: 0 }}>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Responsavel</th>
                  <th>Contato</th>
                  <th>Operadora</th>
                  <th>Registrado por</th>
                  <th>Criado em</th>
                  <th>Valor pago</th>
                  <th>Chips</th>
                  <th>Fidelidade</th>
                  <th>Notas</th>
                  {podeExcluir && <th>Excluir</th>}
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={podeExcluir ? 11 : 10} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Carregando clientes...
                    </td>
                  </tr>
                ) : clientes.length === 0 ? (
                  <tr>
                    <td colSpan={podeExcluir ? 11 : 10} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                ) : (
                  clientes.map(cliente => {
                    const contato = formatarContato(cliente);
                    const fidelidade = formatarFidelidade(cliente.aviso_fidelidade);
                    const retornoNota = getRetornoNotaStatus(cliente);
                    const resumoOperadoras = formatarResumoOperadoras(cliente);

                    return (
                      <tr
                        key={cliente.id}
                        className={[
                          (podeEditar || podeGerenciarConsultoras) ? 'clickable-row is-tappable' : '',
                          String(cliente.id) === String(highlightClienteId) ? 'cliente-row-highlight' : ''
                        ].filter(Boolean).join(' ')}
                        role={podeEditar || podeGerenciarConsultoras ? 'button' : undefined}
                        tabIndex={podeEditar || podeGerenciarConsultoras ? 0 : undefined}
                        onClick={() => abrirEdicaoCliente(cliente)}
                        onKeyDown={(event) => {
                          if (!podeEditar && !podeGerenciarConsultoras) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            abrirEdicaoCliente(cliente);
                          }
                        }}
                      >
                        <td data-label="Cliente" className="m-primary">
                          <div className="cliente-primary">
                            <div className="cliente-primary__title">
                              <strong>{cliente.nome}</strong>
                            </div>
                            <div className="cliente-primary__badges">
                              {cliente.base_anterior_sistema ? (
                                <span className="tag clientes-base-tag">Já é cliente</span>
                              ) : null}
                              {(() => {
                                const n = vendasConcluidasPorCliente.get(`cliente:${cliente.id}`) || 0;
                                if (!n) return null;
                                return (
                                  <span className="clientes-concluidas-badge">
                                    <I.Check size={11} />
                                    {n} {n === 1 ? 'venda concluída' : 'vendas concluídas'}
                                  </span>
                                );
                              })()}
                            </div>
                            <span className="cliente-primary__document">{cliente.razao_social || 'Sem razão social'} - {cliente.cnpj || 'Sem CNPJ'}</span>
                            <details className="cliente-mobile-drawer" onClick={event => event.stopPropagation()}>
                              <summary>Ver detalhes</summary>
                              <dl>
                                <dt>Responsavel</dt>
                                <dd>{cliente.responsavel_tipo === 'adm' ? 'ADM' : 'RL'} {cliente.responsavel_nome || '-'}</dd>
                                <dt>Contato</dt>
                                <dd>{cliente.email || '-'} / {contato.whatsapp || contato.fixo || '-'}</dd>
                                <dt>Operadora</dt>
                                <dd title={resumoOperadoras.detalhe}>{resumoOperadoras.titulo}</dd>
                                <dt>Registrado por</dt>
                                <dd>{cliente.criador?.nome || 'Sem registro'}</dd>
                                <dt>Criado em</dt>
                                <dd>{formatarDataHoraRegistro(cliente.created_at)}</dd>
                                <dt>Valor pago</dt>
                                <dd>{formatarMoeda(cliente.valor_pago)}</dd>
                                <dt>Chips</dt>
                                <dd>{cliente.quantidade_chips ?? '-'}</dd>
                                <dt>Notas</dt>
                                <dd>
                                  <button
                                    type="button"
                                    className={`cliente-note-status-btn ${retornoNota.className}`}
                                    title={retornoNota.title}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      abrirNotasCliente(cliente);
                                    }}
                                  >
                                    <I.Note size={13} />
                                    Abrir nota
                                  </button>
                                </dd>
                                {podeExcluir && (
                                  <>
                                    <dt>Ações</dt>
                                    <dd>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-ghost btn-danger-icon cliente-mobile-delete-btn"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setClienteParaLixeira(cliente);
                                        }}
                                      >
                                        <I.Trash size={13} />
                                        Excluir
                                      </button>
                                    </dd>
                                  </>
                                )}
                              </dl>
                            </details>
                          </div>
                        </td>
                        <td data-label="Responsavel" data-mobile-hidden="true">
                          <span className="tag">{cliente.responsavel_tipo === 'adm' ? 'ADM' : 'RL'}</span>{' '}
                          {cliente.responsavel_nome || '-'}
                        </td>
                        <td data-label="Contato" className="m-secondary">
                          <div className="cliente-contact">
                            <span>{cliente.email || '-'}</span>
                            <span>{contato.whatsapp || contato.fixo || '-'}</span>
                          </div>
                        </td>
                        <td data-label="Operadora" data-mobile-hidden="true">
                          <span title={resumoOperadoras.detalhe} className="cliente-operadoras-summary">
                            {resumoOperadoras.nomes.length > 0 ? (
                              <span className="cliente-operadoras-tags">
                                {resumoOperadoras.nomes.slice(0, 2).map((nome, idx) => (
                                  <span key={`${nome}-${idx}`} className={`tag operadora-tag operadora-${slugOperadora(nome)}`}>{nome}</span>
                                ))}
                                {resumoOperadoras.nomes.length > 2 && (
                                  <span className="tag">+{resumoOperadoras.nomes.length - 2}</span>
                                )}
                              </span>
                            ) : (
                              <strong>-</strong>
                            )}
                            {obterOperadorasCliente(cliente).length > 1 && <small>{obterOperadorasCliente(cliente).length} operadoras</small>}
                          </span>
                        </td>
                        <td data-label="Registrado por" data-mobile-hidden="true">
                          <span className="tag">{cliente.criador?.nome || 'Sem registro'}</span>
                        </td>
                        <td data-label="Criado em" data-mobile-hidden="true">{formatarDataHoraRegistro(cliente.created_at)}</td>
                        <td data-label="Valor pago" data-mobile-hidden="true">{formatarMoeda(cliente.valor_pago)}</td>
                        <td data-label="Chips" data-mobile-hidden="true">{cliente.quantidade_chips ?? '-'}</td>
                        <td data-label="Fidelidade" className="m-meta">
                          <span className={`pill ${fidelidade.className}`}>
                            <span className="pill-dot"></span>
                            {fidelidade.label}
                          </span>
                        </td>
                        <td data-label="Notas">
                          <button
                            type="button"
                            className={`cliente-note-status-btn ${retornoNota.className}`}
                            title={retornoNota.title}
                            onClick={(event) => {
                              event.stopPropagation();
                              abrirNotasCliente(cliente);
                            }}
                          >
                            <I.Note size={13} />
                            Nota
                          </button>
                        </td>
                        {podeExcluir && (
                          <td data-label="Excluir">
                            <div className="clientes-actions">
                              <button
                                className="btn btn-icon btn-ghost btn-danger-icon"
                                title="Excluir"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setClienteParaLixeira(cliente);
                                }}
                              >
                                <I.Trash size={13} />
                              </button>
                            </div>
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
            total={totalClientes}
            paginaAtual={paginaAtual}
            itensPorPagina={itensPorPagina}
            onPagina={pagina => { setPaginaAtual(pagina); carregarClientes(filtros, pagina); }}
            onItensPorPagina={n => { setCarregando(true); setItensPorPagina(n); setPaginaAtual(1); }}
          />
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default Clientes;
