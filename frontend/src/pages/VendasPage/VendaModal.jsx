import { useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AutoResizeTextarea from '../../components/AutoResizeTextarea';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import NotasEntidadeTab from '../../components/NotasEntidadeTab';
import * as I from '../../components/Icons';
import VendaProblemaPanel from './VendaProblemaPanel';
import { useFormDraft } from '../../utils/useFormDraft';
import { atualizarEtapa0800, baixarArquivoVenda, baixarPacoteArquivosVenda, blobArquivoVenda, excluirArquivoVenda, gerarPacoteArquivosVenda, listarArquivosVenda, listarEtapasVenda, uploadArquivoVenda, visualizarArquivoVenda } from '../../services/venda.service';
import { sanitizarCnpj, validarDigitosCnpj, sanitizarCpf } from '../../services/cnpj.service';
import { listarEtapasFunil } from '../../services/config.service';
import { temPermissao } from '../../services/auth.service';
import { agruparOpcoesServicos } from '../../utils/servicos';
import { parseUtcDateTime } from '../../utils/datetime';
import {
  aplicarVendaAntigaAoFormulario,
  criarEstadoDataVenda,
  normalizarIndicadorVendaAntiga
} from './venda-data';
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
  rg_representante_legal: '',
  data_nascimento_representante_legal: '',
  telefone_representante_legal: '',
  email_representante_legal: '',
  // Administrador
  nome_administrador: '',
  cpf_administrador: '',
  rg_administrador: '',
  data_nascimento_administrador: '',
  telefone_administrador: '',
  email_administrador: '',
  // Dados da venda
  nome_fechou_venda: '',
  setor_funcao: '',
  produto_fechado: '',
  qc_feito_por: '',
  venda_antiga: false,
  data_venda: '',
  // Produto e valores
  tipo_venda_id: '',
  servico_id: '',
  quantidade_linhas: '',
  ddd: '',
  numeros_ativados: [],
  gb: '',
  valores_unitarios_chips: [{ quantidade: '', gb: '', valor_unitario: '', tipo_linha: 'novo', operadora_atual_id: '', vendedora_id: '' }],
  tipos_servico: ['novo'],
  cliente_da_base: false,
  categoria_campanha: '',
  possui_doc_na_casa: false,
  valor_total: '',
  cliente_solicitou_servicos: [],
  cliente_solicitou_bloqueio_qtd: '',
  cliente_solicitou_cancelamento_qtd: '',
  cliente_solicitou_numeros: { bloqueio: [], cancelamento: [] },
  cliente_solicitou_resolvido: '',
  cliente_solicitou_resolvido_em: '',
  cliente_solicitou_protocolo_atendimento: '',
  cliente_solicitou_observacao: '',
  ponto_referencia: '',
  tipo_local_cpf: '',
  data_ativacao: '',
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
  // Aceite
  horario_aceite_voz: '',
  horario_aceite_inicio: '',
  horario_aceite_fim: '',
  dia_aceite_inicio: '',
  dia_aceite_fim: '',
  horario_aceite_fixo: '',
  dia_aceite_fixo: '',
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
  // Referências
  operadora_id: '',
  operadora_atual_id: '',
  vendedora_id: '',
  vendedoras: []
};

const CAMPOS_ENDERECO_REAL_VENDA = [
  { name: 'cep_real', label: 'CEP' },
  { name: 'endereco_real', label: 'Endereço real', type: 'longText', span: true },
  { name: 'numero_endereco_real', label: 'Número' },
  { name: 'complemento_real', label: 'Complemento', type: 'longText', span: true },
  { name: 'bairro_real', label: 'Bairro' },
  { name: 'municipio_real', label: 'Município' },
  { name: 'uf_real', label: 'UF', maxLength: 2 }
];

const ITEM_CHIP_VAZIO = {
  quantidade: '',
  gb: '',
  valor_unitario: '',
  tipo_linha: 'novo',
  operadora_atual_id: '',
  operadora_id: '',
  vendedora_id: ''
};
const NUMERO_PORTADO_VAZIO = '';

/**
 * Renderiza obter data atual input.
 */
function obterDataAtualInput() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

/**
 * Cria venda vazia com os dados informados.
 */
function criarVendaVazia() {
  return {
    ...VENDA_VAZIA,
    ...criarEstadoDataVenda(),
    numeros_ativados: [],
    valores_unitarios_chips: [{ ...ITEM_CHIP_VAZIO }],
    tipos_servico: ['novo'],
    cliente_solicitou_servicos: [],
    cliente_solicitou_numeros: { bloqueio: [], cancelamento: [] },
    vendedoras: []
  };
}

/** Retorna o último dia aceito para uma venda antiga. */
function obterDataAnteriorInput() {
  const hoje = obterDataAtualInput();
  const data = new Date(`${hoje}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

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

const CLIENTE_SOLICITOU_LABELS = {
  bloqueio: 'Bloqueio',
  cancelamento: 'Cancelamento'
};

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

const CAMPOS_CPF_VENDA = ['cpf_representante_legal', 'cpf_administrador'];
const CAMPOS_RG_VENDA = [
  'rg_representante_legal',
  'rg_administrador',
  'rg_responsavel_recebimento',
  'rg_responsavel_recebimento_2',
  'rg_responsavel_recebimento_3'
];
const LIMITE_CARACTERES_RG = 14;

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

/**
 * Valida numero telefone e retorna o resultado esperado.
 */
function validarNumeroTelefone(valor) {
  const digitos = (valor || '').replace(/\D/g, '');
  if (digitos.length < 10) return { valido: false, motivo: 'Número muito curto' };
  if (digitos.length > 11) return { valido: false, motivo: 'Número muito longo' };
  const ddd = Number(digitos.substring(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return { valido: false, motivo: `DDD ${ddd} inválido` };
  return { valido: true, motivo: '' };
}

const CAMPOS = [
  { section: 'Cliente' },
  { name: 'cliente_id', label: 'Cliente', type: 'client', required: true, span: true },
  { name: 'cnpj', label: 'CNPJ para preencher dados', type: 'cnpj' },
  { name: 'vendedoras', label: 'Vendedoras', type: 'sellers', required: true, span: true },

  { section: 'Dados do cliente' },
  { name: 'nome', label: 'Nome / Fantasia' },
  { name: 'razao_social', label: 'Razão Social' },
  { name: 'telefone', label: 'Telefone Celular' },
  { name: 'fixo_ddd', label: 'Telefone fixo' },
  { section: 'Representante Legal (RL)' },
  { name: 'nome_representante_legal', label: 'Nome RL' },
  { name: 'cpf_representante_legal', label: 'CPF RL' },
  { name: 'rg_representante_legal', label: 'RG RL' },
  { name: 'data_nascimento_representante_legal', label: 'Data de nascimento RL', type: 'date' },
  { name: 'telefone_representante_legal', label: 'Telefone RL' },
  { name: 'email_representante_legal', label: 'Email RL' },

  { section: 'Administrador (ADM)' },
  { name: 'nome_administrador', label: 'Nome ADM' },
  { name: 'cpf_administrador', label: 'CPF ADM' },
  { name: 'rg_administrador', label: 'RG ADM' },
  { name: 'data_nascimento_administrador', label: 'Data de nascimento ADM', type: 'date' },
  { name: 'telefone_administrador', label: 'Telefone ADM' },
  { name: 'email_administrador', label: 'E-mail ADM' },

  { section: 'Dados da venda' },
  { name: 'venda_antiga', label: 'Venda antiga', type: 'oldSale', span: true },
  { name: 'data_ativacao', label: 'Data da ativação', type: 'date' },
  { name: 'nome_fechou_venda', label: 'Venda fechada com', type: 'closedWith' },
  { name: 'setor_funcao', label: 'Setor/Função' },
  { name: 'qc_feito_por', label: 'QC feito por' },

  { section: 'Produto e valores' },
  { name: 'servico_id', label: 'Produto', type: 'service', required: true },
  { name: 'quantidade_linhas', label: 'Quantidade de linhas fechadas', type: 'number' },
  { name: 'ddd', label: 'Qual DDD' },
  { name: 'dia_vencimento', label: 'Dia de vencimento', type: 'number', min: 1, max: 31 },
  { name: 'tipos_servico', label: 'Serviço', type: 'serviceType', span: true },
  { name: 'cliente_da_base', label: 'Classificação do cliente', type: 'clientBase', span: true },
  { name: 'categoria_campanha', label: 'Categoria de campanha', placeholder: 'Ex.: Ação especial', span: true },
  { name: 'cliente_solicitou_servicos', label: 'Cliente solicitou', type: 'clientRequested', span: true, required: true },
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
  { name: 'tipo_local_cpf', label: 'Tipo de local', type: 'tipoLocalCpf', span: true },

  { section: 'Aceite' },
  { name: 'aceite_range', label: 'Disponibilidade para aceite', type: 'aceiteRange', span: true },
  { name: 'protocolo', label: 'Protocolo do Cliente', span: true },
  { name: 'login', label: 'Login (portal do cliente)' },
  { name: 'senha', label: 'Senha (portal do cliente)' },
  { name: 'numero_cliente_contrato', label: 'Número do cliente no contrato', placeholder: 'Caso não tenha Login e Senha', span: true },
  { name: 'responsaveis_recebimento', type: 'responsaveis', span: true },
  { name: 'observacoes', label: 'Observações da Venda', type: 'longText', span: true, maxRows: 6 },
];

const CAMPOS_AGRUPADOS_REVERSAO = {
  venda_antiga: ['venda_antiga', 'data_venda'],
  aceite_range: ['horario_aceite_voz', 'horario_aceite_inicio', 'horario_aceite_fim', 'dia_aceite_inicio', 'dia_aceite_fim', 'dia_aceite_fixo', 'horario_aceite_fixo'],
  responsaveis_recebimento: ['responsavel_recebimento', 'rg_responsavel_recebimento', 'responsavel_recebimento_2', 'rg_responsavel_recebimento_2', 'responsavel_recebimento_3', 'rg_responsavel_recebimento_3'],
  cliente_solicitou_servicos: ['cliente_solicitou_servicos', 'cliente_solicitou_bloqueio_qtd', 'cliente_solicitou_cancelamento_qtd', 'cliente_solicitou_numeros']
};

const LABELS_CAMPOS_REVERSAO = {
  ...Object.fromEntries(CAMPOS.filter(campo => campo.name).map(campo => [campo.name, campo.label || campo.name])),
  data_venda: 'Data da venda',
  horario_aceite_voz: 'Horário do aceite',
  horario_aceite_inicio: 'Início do aceite',
  horario_aceite_fim: 'Fim do aceite',
  dia_aceite_inicio: 'Dia inicial do aceite',
  dia_aceite_fim: 'Dia final do aceite',
  dia_aceite_fixo: 'Dia fixo do aceite',
  horario_aceite_fixo: 'Horário fixo do aceite',
  responsavel_recebimento: 'Responsável pelo recebimento 1',
  rg_responsavel_recebimento: 'RG do responsável 1',
  responsavel_recebimento_2: 'Responsável pelo recebimento 2',
  rg_responsavel_recebimento_2: 'RG do responsável 2',
  responsavel_recebimento_3: 'Responsável pelo recebimento 3',
  rg_responsavel_recebimento_3: 'RG do responsável 3'
};

function formatarValorHistorico(valor, campo, referencias = {}) {
  if (valor === null || valor === undefined || valor === '') return 'Não preenchido';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';

  const listas = {
    cliente_id: referencias.clientes,
    servico_id: referencias.servicos,
    tipo_venda_id: referencias.tiposVenda
  };
  if (listas[campo]) {
    return listas[campo].find(item => Number(item.id) === Number(valor))?.nome || `#${valor}`;
  }
  if (campo === 'vendedoras' && Array.isArray(valor)) {
    return valor.map(id => referencias.vendedoras?.find(item => Number(item.id) === Number(id))?.nome || `#${id}`).join(', ') || 'Não preenchido';
  }
  if (Array.isArray(valor) || (valor && typeof valor === 'object')) {
    return JSON.stringify(valor, null, 2);
  }
  return String(valor);
}

const CAMPOS_HISTORICO_CHIP = [
  {
    chave: 'quantidade',
    label: 'Quantidade',
    formatar: valor => {
      const quantidade = Number(valor || 0);
      if (!quantidade) return 'Não informado';
      return `${quantidade} ${quantidade === 1 ? 'chip' : 'chips'}`;
    }
  },
  {
    chave: 'gb',
    label: 'Internet',
    formatar: valor => {
      const texto = String(valor || '').trim();
      if (!texto) return 'Não informado';
      return /\b(gb|mb|tb)\b/i.test(texto) ? texto : `${texto} GB`;
    }
  },
  {
    chave: 'tipo_linha',
    label: 'Tipo de linha',
    formatar: valor => formatarTipoLinhaChipLabel(valor)
  },
  {
    chave: 'operadora_atual',
    label: 'Operadora atual',
    formatar: valor => valor || 'Não informada'
  },
  {
    chave: 'operadora_destino',
    label: 'Nova operadora',
    formatar: valor => valor || 'Não informada'
  },
  {
    chave: 'valor_unitario',
    label: 'Valor por chip',
    formatar: valor => formatarMoeda(parseValorInput(valor))
  }
];

function normalizarChipsHistorico(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor !== 'string') return [];

  try {
    const itens = JSON.parse(valor);
    return Array.isArray(itens) ? itens : [];
  } catch {
    return [];
  }
}

function obterNomeReferencia(lista = [], id, fallback = '') {
  return fallback
    || lista.find(item => Number(item.id) === Number(id))?.nome
    || (id ? `Operadora #${id}` : '');
}

function prepararChipHistorico(item = {}, referencias = {}) {
  return {
    quantidade: item.quantidade,
    gb: item.gb,
    tipo_linha: item.tipo_linha || item.tipo || item.categoria,
    operadora_atual: obterNomeReferencia(referencias.operadoras, item.operadora_atual_id, item.operadora_atual_nome),
    operadora_destino: obterNomeReferencia(referencias.operadoras, item.operadora_id, item.operadora_nome),
    valor_unitario: item.valor_unitario
  };
}

function camposVisiveisChip(antes = {}, depois = {}) {
  return CAMPOS_HISTORICO_CHIP.filter(campo => (
    (antes?.[campo.chave] !== undefined && antes?.[campo.chave] !== null && antes?.[campo.chave] !== '')
    || (depois?.[campo.chave] !== undefined && depois?.[campo.chave] !== null && depois?.[campo.chave] !== '')
  ));
}

function valorCampoChip(campo, item) {
  return campo.formatar(item?.[campo.chave]);
}

function HistoricoChips({ anterior, novo, referencias }) {
  const chipsAnteriores = normalizarChipsHistorico(anterior).map(item => prepararChipHistorico(item, referencias));
  const chipsNovos = normalizarChipsHistorico(novo).map(item => prepararChipHistorico(item, referencias));
  const totalItens = Math.max(chipsAnteriores.length, chipsNovos.length);

  return (
    <div className="venda-chips-history">
      {Array.from({ length: totalItens }, (_, index) => {
        const antes = chipsAnteriores[index];
        const depois = chipsNovos[index];
        const campos = camposVisiveisChip(antes, depois);
        const alterados = campos.filter(campo => valorCampoChip(campo, antes) !== valorCampoChip(campo, depois));

        return (
          <section className="venda-chips-history-item" key={index}>
            <div className="venda-chips-history-item__title">
              <strong>Linha {index + 1}</strong>
              <span>{!antes ? 'Adicionada' : !depois ? 'Removida' : `${alterados.length} ${alterados.length === 1 ? 'dado alterado' : 'dados alterados'}`}</span>
            </div>

            {alterados.length > 0 && antes && depois && (
              <div className="venda-chips-history-summary" aria-label="Resumo das alterações">
                {alterados.map(campo => (
                  <div key={campo.chave}>
                    <strong>{campo.label}:</strong>
                    <span>{valorCampoChip(campo, antes)}</span>
                    <I.ArrowRight size={13} aria-hidden="true" />
                    <span>{valorCampoChip(campo, depois)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="venda-reversao-values venda-reversao-values--chips">
              {[
                { titulo: 'Antes', item: antes, classe: 'is-before' },
                { titulo: 'Depois', item: depois, classe: 'is-after' }
              ].map(coluna => (
                <div className={coluna.classe} key={coluna.titulo}>
                  <span className="venda-chips-history-column-title">{coluna.titulo}</span>
                  {coluna.item ? (
                    <dl>
                      {campos.map(campo => {
                        const mudou = valorCampoChip(campo, antes) !== valorCampoChip(campo, depois);
                        return (
                          <div className={mudou ? 'is-changed' : ''} key={campo.chave}>
                            <dt>{campo.label}</dt>
                            <dd>{valorCampoChip(campo, coluna.item)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : <p className="venda-chips-history-empty">Esta linha não existia.</p>}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function HistoricoCampoModal({ titulo, eventos, referencias, onClose }) {
  return (
    <div className="modal-overlay venda-reversao-history-overlay" role="dialog" aria-modal="true" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="modal venda-reversao-history-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div><div className="modal-client">Histórico: {titulo}</div><div className="modal-sub">Alterações registradas por reversões.</div></div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} title="Fechar"><I.Close size={14} /></button>
          </div>
        </div>
        <div className="modal-body venda-reversao-history-list">
          {eventos.map(evento => (
            <article className="venda-reversao-history-item" key={`${evento.reversao.id}-${evento.alteracao.campo}`}>
              <div className="venda-reversao-history-head">
                <strong>Reversão {evento.reversao.numero}</strong>
                <span>{formatarDataHora(evento.reversao.created_at)}</span>
              </div>
              <div className="venda-reversao-history-author">{evento.reversao.usuario?.nome || 'Usuário não disponível'} · {LABELS_CAMPOS_REVERSAO[evento.alteracao.campo] || evento.alteracao.campo}</div>
              {evento.alteracao.campo === 'valores_unitarios_chips' ? (
                <HistoricoChips anterior={evento.alteracao.anterior} novo={evento.alteracao.novo} referencias={referencias} />
              ) : (
                <div className="venda-reversao-values">
                  <div><span>Valor anterior</span><pre>{formatarValorHistorico(evento.alteracao.anterior, evento.alteracao.campo, referencias)}</pre></div>
                  <div><span>Novo valor</span><pre>{formatarValorHistorico(evento.alteracao.novo, evento.alteracao.campo, referencias)}</pre></div>
                </div>
              )}
              <p>{evento.reversao.observacao}</p>
            </article>
          ))}
        </div>
        <div className="modal-footer"><button type="button" className="btn" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}

function ExcluirReversaoModal({ reversao, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    const motivoNormalizado = motivo.trim();
    if (!motivoNormalizado || excluindo) return;
    setExcluindo(true);
    setErro('');
    try {
      await onConfirm(reversao.id, motivoNormalizado);
      onClose();
    } catch (error) {
      setErro(error.message || 'Erro ao excluir reversão.');
      setExcluindo(false);
    }
  }

  return (
    <div className="modal-overlay venda-reversao-delete-overlay" role="dialog" aria-modal="true" aria-labelledby="excluir-reversao-title" onClick={event => event.target === event.currentTarget && !excluindo && onClose()}>
      <div className="modal venda-reversao-delete-modal">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="excluir-reversao-title" className="modal-client">Excluir Reversão {reversao.numero}</div>
              <div className="modal-sub">A reversão será ocultada, mas os dados atuais da venda não serão alterados.</div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={onClose} disabled={excluindo}><I.Close size={14} /></button>
          </div>
        </div>
        <div className="modal-body">
          {erro && <div className="alert alert-error">{erro}</div>}
          <div className="form-field">
            <label htmlFor="motivo-exclusao-reversao">Motivo da exclusão <span className="field-required-mark">*</span></label>
            <textarea
              id="motivo-exclusao-reversao"
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Explique por que esta reversão deve ser ocultada"
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={confirmar} disabled={!motivo.trim() || excluindo}>
            {excluindo ? 'Excluindo...' : 'Excluir reversão'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Retorna valor obrigatorio nao preenchido no formato esperado pelo fluxo.
 */
function valorObrigatorioNaoPreenchido(valor) {
  if (Array.isArray(valor)) return valor.length === 0;
  if (valor && typeof valor === 'object') return Object.keys(valor).length === 0;
  return valor === undefined || valor === null || String(valor).trim() === '';
}

/**
 * Obtem erro campos obrigatorios venda a partir dos dados informados.
 */
function obterErroCamposObrigatoriosVenda(form) {
  const camposNaoPreenchidos = CAMPOS
    .filter(campo => campo.required && valorObrigatorioNaoPreenchido(form[campo.name]))
    .map(campo => campo.label);

  if (camposNaoPreenchidos.length === 0) return '';

  return `Preencha os campos obrigatórios: ${camposNaoPreenchidos.join(', ')}.`;
}

/**
 * Normaliza status funil filtros para uso interno consistente.
 */
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
 * Formata data hora para exibicao ou envio.
 */
function formatarDataHora(value) {
  if (!value) return '-';

  const date = parseUtcDateTime(value);
  if (!date) return formatarData(value);

  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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
 * Obtem erro cpf campo a partir dos dados informados.
 */
function obterErroCpfCampo(campo, valor) {
  if (!CAMPOS_CPF_VENDA.includes(campo)) return '';

  const cpf = apenasDigitos(valor, 11);
  if (!cpf) return '';
  if (cpf.length < 11) return 'CPF incompleto.';
  if (!validarCpf(valor)) return 'CPF invalido.';

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
 * Formata rg para exibicao ou envio.
 */
function formatarRg(valor) {
  const limpo = String(valor || '')
    .toUpperCase()
    .replace(/[^A-Z0-9./\s-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, LIMITE_CARACTERES_RG);

  const semPontuacao = limpo.replace(/[./\s-]/g, '');
  if (!/^\d{1,8}X?$/.test(semPontuacao)) return limpo;

  const len = semPontuacao.length;
  if (len <= 2) return semPontuacao;
  if (len <= 5) return `${semPontuacao.slice(0, 2)}.${semPontuacao.slice(2)}`;
  if (len <= 8) return `${semPontuacao.slice(0, 2)}.${semPontuacao.slice(2, 5)}.${semPontuacao.slice(5)}`;
  return `${semPontuacao.slice(0, 2)}.${semPontuacao.slice(2, 5)}.${semPontuacao.slice(5, 8)}-${semPontuacao.slice(8)}`;
}

/**
 * Formata campo venda para exibicao ou envio.
 */
function formatarCampoVenda(campo, valor) {
  if (campo === 'telefone' || campo === 'telefone_representante_legal' || campo === 'telefone_administrador') return formatarTelefoneComDdd(valor, true);
  if (campo === 'fixo_ddd') return formatarTelefoneComDdd(valor, false);
  if (campo === 'cpf_representante_legal' || campo === 'cpf_administrador') return formatarCpf(valor);
  if (CAMPOS_RG_VENDA.includes(campo)) return formatarRg(valor);
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
    rg_representante_legal: LIMITE_CARACTERES_RG,
    rg_administrador: LIMITE_CARACTERES_RG,
    rg_responsavel_recebimento: LIMITE_CARACTERES_RG,
    rg_responsavel_recebimento_2: LIMITE_CARACTERES_RG,
    rg_responsavel_recebimento_3: LIMITE_CARACTERES_RG,
    cnpj: 18,
    // A Receita exibe CEP como "34.007-792" (10 caracteres). A mascara remove
    // o ponto e mantem o valor final no padrao "34007-792" (9 caracteres).
    cep: 10,
    cep_real: 10,
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
 * Processa inferir tipos servico de chips conforme as regras do dominio.
 */
function inferirTiposServicoDeChips(itens = []) {
  const tipos = new Set(
    normalizarItensChipsInput(itens).map(item =>
      normalizarTipoLinhaChip(item.tipo_linha || item.tipo || item.categoria)
    )
  );
  const resultado = [...tipos].filter(Boolean);
  return resultado.length > 0 ? resultado : ['novo'];
}

/**
 * Resume tipos linha itens chips para exibicao ou envio.
 */
/**
 * Obtem tipo venda tabela a partir dos dados informados.
 */
/**
 * Retorna chaves cliente venda a partir dos dados informados.
 */
function getChavesClienteVenda(venda = {}) {
  const chaves = new Set();
  const clienteId = venda.cliente_id || venda.cliente?.id;
  const cnpj = sanitizarCnpj(venda.cnpj || venda.cliente?.cnpj || '');
  const nomes = [
    venda.nome,
    venda.cliente?.nome,
    venda.razao_social,
    venda.cliente?.razao_social
  ];

  if (clienteId) chaves.add(`cliente:${clienteId}`);
  if (cnpj) chaves.add(`cnpj:${cnpj}`);

  if (!clienteId && !cnpj) {
    nomes
      .map(nome => normalizarTextoBusca(nome))
      .filter(Boolean)
      .forEach(nome => chaves.add(`nome:${nome}`));
  }

  return chaves;
}

/**
 * Conta vendas por cliente conforme os dados informados.
 */
function contarVendasPorCliente(vendas = []) {
  return vendas.reduce((acc, venda) => {
    const chaves = getChavesClienteVenda(venda);
    if (chaves.size === 0) return acc;
    chaves.forEach(chave => {
      acc.set(chave, (acc.get(chave) || 0) + 1);
    });
    return acc;
  }, new Map());
}

/**
 * Converte itens chips para o formato interno esperado.
 */
function parseItensChips(valor, gbPadrao = '', tipoLinhaPadrao = 'novo', operadoraAtualPadrao = '', operadoraDestinoPadrao = '') {
  if (!valor) return [{ ...ITEM_CHIP_VAZIO }];

  if (Array.isArray(valor)) {
    const itens = valor.map(item => ({
      quantidade: item.quantidade ? String(item.quantidade) : '',
      gb: formatarCampoVenda('gb', item.gb || gbPadrao || ''),
      valor_unitario: item.valor_unitario ? String(item.valor_unitario).replace('.', ',') : '',
      tipo_linha: normalizarTipoLinhaChip(item.tipo_linha || item.tipo || item.categoria, tipoLinhaPadrao),
      operadora_atual_id: item.operadora_atual_id ? String(item.operadora_atual_id) : String(operadoraAtualPadrao || ''),
      operadora_id: item.operadora_id ? String(item.operadora_id) : String(operadoraDestinoPadrao || ''),
      vendedora_id: item.vendedora_id ? String(item.vendedora_id) : ''
    }));

    return itens.length > 0 ? itens : [{ ...ITEM_CHIP_VAZIO }];
  }

  if (typeof valor === 'string') {
    try {
      return parseItensChips(JSON.parse(valor), gbPadrao, tipoLinhaPadrao, operadoraAtualPadrao, operadoraDestinoPadrao);
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
            tipo_linha: tipoLinhaPadrao,
            operadora_atual_id: String(operadoraAtualPadrao || ''),
            operadora_id: String(operadoraDestinoPadrao || '')
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
 * Monta linhas cliente solicitou a partir dos dados informados.
 */
function montarLinhasClienteSolicitou(form) {
  const servicos = parseClienteSolicitouServicos(form.cliente_solicitou_servicos);
  const numeros = parseClienteSolicitouNumeros(form.cliente_solicitou_numeros);

  return CLIENTE_SOLICITOU_ACOES
    .filter(servico => servicos.includes(servico))
    .flatMap(servico => (numeros[servico] || []).map(numero => ({
      servico,
      numero
    })))
    .filter(item => apenasDigitos(item.numero).length > 2);
}

/**
 * Processa ajustar quantidade numeros solicitados conforme as regras do dominio.
 */
function ajustarQuantidadeNumerosSolicitados(value, quantidade) {
  const total = Math.max(Number(quantidade || 0), 0);
  const atuais = Array.isArray(value) ? value : parseNumerosPortados(value);

  return Array.from({ length: total }, (_, index) => atuais[index] || NUMERO_PORTADO_VAZIO);
}

const TIPO_LOCAL_CPF_OPCOES = ['casa', 'hotel', 'condomínio', 'shopping'];

/**
 * Converte tipo local cpf para o formato interno esperado.
 */
function parseTipoLocalCpf(valor) {
  if (!valor) return { selecionado: '', outros: '' };
  const str = String(valor).trim();
  if (str.startsWith('outros:')) {
    return { selecionado: 'outros', outros: str.slice(7).trim() };
  }
  if (str === 'outros') {
    return { selecionado: 'outros', outros: '' };
  }
  return { selecionado: TIPO_LOCAL_CPF_OPCOES.includes(str) ? str : '', outros: '' };
}

/**
 * Renderiza tipo local cpf input.
 */
function TipoLocalCpfInput({ value, onChange, disabled }) {
  const { selecionado, outros } = parseTipoLocalCpf(value);

  /**
   * Seleciona  e atualiza o estado relacionado.
   */
  function selecionar(opcao) {
    if (disabled) return;
    if (opcao === selecionado) {
      onChange('');
      return;
    }
    onChange(opcao === 'outros' ? (outros ? `outros: ${outros}` : 'outros') : opcao);
  }

  return (
    <div className="tipo-local-cpf">
      <div className="tipo-local-cpf__opcoes">
        {[...TIPO_LOCAL_CPF_OPCOES, 'outros'].map(opcao => (
          <label key={opcao} className={`tipo-local-cpf__opcao${disabled ? ' tipo-local-cpf__opcao--disabled' : ''}`}>
            <input
              type="radio"
              name="tipo_local_cpf"
              checked={selecionado === opcao}
              onChange={() => selecionar(opcao)}
              disabled={disabled}
            />
            {opcao.charAt(0).toUpperCase() + opcao.slice(1)}
          </label>
        ))}
      </div>
      {selecionado === 'outros' && (
        <input
          type="text"
          className="tipo-local-cpf__outros-input"
          value={outros}
          onChange={e => onChange(e.target.value ? `outros: ${e.target.value}` : 'outros')}
          placeholder="Descreva o local..."
          disabled={disabled}
          autoFocus
        />
      )}
    </div>
  );
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
    venda_antiga: normalizarIndicadorVendaAntiga(venda.venda_antiga),
    data_venda: toInputDate(venda.data_venda),
    data_ativacao: toInputDate(venda.data_ativacao),
    valor_total: venda.valor_total ?? '',
    valores_unitarios_chips: parseItensChips(
      venda.valores_unitarios_chips,
      venda.gb,
      tipoLinhaPadrao,
      venda.operadora_atual_id,
      venda.operadora_id
    ),
    tipos_servico: Array.isArray(venda.tipos_servico) && venda.tipos_servico.length > 0
      ? venda.tipos_servico
      : inferirTiposServicoDeChips(parseItensChips(
        venda.valores_unitarios_chips,
        venda.gb,
        tipoLinhaPadrao,
        venda.operadora_atual_id,
        venda.operadora_id
      )),
    cliente_da_base: venda.cliente_da_base === null || venda.cliente_da_base === undefined
      ? null
      : (venda.cliente_da_base === true || Number(venda.cliente_da_base) === 1),
    possui_doc_na_casa: venda.possui_doc_na_casa === true || Number(venda.possui_doc_na_casa) === 1,
    numeros_portados: parseNumerosPortados(venda.numeros_portados),
    numeros_ativados: parseNumerosAtivados(venda.numeros_ativados),
    cliente_solicitou_servicos: parseClienteSolicitouServicos(venda.cliente_solicitou_servicos),
    cliente_solicitou_bloqueio_qtd: venda.cliente_solicitou_bloqueio_qtd ?? '',
    cliente_solicitou_cancelamento_qtd: venda.cliente_solicitou_cancelamento_qtd ?? '',
    cliente_solicitou_numeros: parseClienteSolicitouNumeros(venda.cliente_solicitou_numeros),
    cliente_solicitou_resolvido: venda.cliente_solicitou_resolvido ?? '',
    cliente_solicitou_resolvido_em: toInputDate(venda.cliente_solicitou_resolvido_em),
    cliente_solicitou_protocolo_atendimento: venda.cliente_solicitou_protocolo_atendimento ?? '',
    cliente_solicitou_observacao: venda.cliente_solicitou_observacao ?? '',
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
 * Obtem operadoras cliente a partir dos dados informados.
 */
function obterOperadorasCliente(cliente) {
  return cliente?.operadoras_atuais || cliente?.operadorasAtuais || [];
}

/**
 * Resolve operadora atual cliente a partir do contexto atual.
 */
function resolverOperadoraAtualCliente(cliente, operadoraVendaId) {
  const operadorasCliente = obterOperadorasCliente(cliente);
  const operadoraVenda = operadoraVendaId ? Number(operadoraVendaId) : null;
  const match = operadoraVenda
    ? operadorasCliente.find(item => Number(item.operadora_id || item.operadora?.id) === operadoraVenda)
    : null;

  if (match) return match.operadora_id || match.operadora?.id || '';
  return cliente?.operadora_atual_id || cliente?.operadoraAtual?.id || '';
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
  const titulo = `${nomes.slice(0, 2).join(', ') || 'Sem operadora'}${nomes.length > 2 ? ` +${nomes.length - 2}` : ''}`;
  const chips = operadorasCliente.reduce((total, item) => total + Number(item.quantidade_chips || 0), 0);
  return `${titulo} - ${chips} chips`;
}

/**
 * Monta dados cliente venda a partir dos dados informados.
 */
function montarDadosClienteVenda(cliente, clienteId = '', operadoraVendaId = '') {
  const telefoneWhatsapp = cliente
    ? formatarTelefoneComDdd([cliente.whatsapp_ddd, cliente.whatsapp_numero].filter(Boolean).join(''), true)
    : '';
  const telefoneFixo = cliente
    ? formatarTelefoneComDdd([cliente.fixo_ddd, cliente.fixo_numero].filter(Boolean).join(''), false)
    : '';
  const responsavelTipo = cliente?.responsavel_tipo || '';
  const nomeRl = responsavelTipo === 'rl' ? (cliente.responsavel_nome || '') : '';
  const nomeAdm = responsavelTipo === 'adm' ? (cliente.responsavel_nome || '') : '';
  const emailRl = responsavelTipo === 'rl' ? (cliente.email || '') : '';
  const emailAdm = responsavelTipo === 'adm' ? (cliente.email || '') : '';
  const telefoneRl = responsavelTipo === 'rl' ? telefoneWhatsapp : '';
  const telefoneAdm = responsavelTipo === 'adm' ? telefoneWhatsapp : '';
  const fechouVenda = responsavelTipo === 'rl' ? 'RL' : responsavelTipo === 'adm' ? 'ADM' : '';
  const operadoraAtualId = resolverOperadoraAtualCliente(cliente, operadoraVendaId);

  // Documento do cliente pode ser CPF (11 digitos) ou CNPJ (14). Formata conforme o tamanho.
  const documentoDigitos = cliente?.cnpj ? sanitizarCnpj(cliente.cnpj) : '';
  const documentoEhCpf = documentoDigitos.length === 11;
  const documentoFormatado = cliente?.cnpj
    ? (documentoEhCpf ? formatarCpf(cliente.cnpj) : formatarCnpj(cliente.cnpj))
    : '';
  const cpfDoClienteRl = documentoEhCpf && responsavelTipo === 'rl' ? documentoFormatado : '';
  const cpfDoClienteAdm = documentoEhCpf && responsavelTipo === 'adm' ? documentoFormatado : '';

  return {
    cliente_id: clienteId ? String(clienteId) : '',
    nome: cliente?.nome || '',
    razao_social: cliente?.razao_social || '',
    cnpj: documentoFormatado,
    email: cliente?.email || '',
    telefone: telefoneWhatsapp || '',
    fixo_ddd: telefoneFixo || '',
    nome_representante_legal: nomeRl,
    cpf_representante_legal: cpfDoClienteRl,
    rg_representante_legal: '',
    data_nascimento_representante_legal: '',
    telefone_representante_legal: telefoneRl,
    email_representante_legal: emailRl,
    nome_administrador: nomeAdm,
    cpf_administrador: cpfDoClienteAdm,
    rg_administrador: '',
    data_nascimento_administrador: '',
    telefone_administrador: telefoneAdm,
    email_administrador: emailAdm,
    nome_fechou_venda: fechouVenda,
    operadora_atual_id: operadoraAtualId ? String(operadoraAtualId) : ''
  };
}

/**
 * Renderiza tipos servico input.
 */
function TiposServicoInput({ value, onChange }) {
  const selecionados = Array.isArray(value) && value.length > 0 ? value : ['novo'];
  const opcoes = [
    { value: 'novo', label: 'Novo' },
    { value: 'portabilidade', label: 'Portabilidade' }
  ];

  /**
   * Alterna tipo no estado atual.
   */
  function toggleTipo(tipo) {
    if (selecionados.includes(tipo)) {
      const proximos = selecionados.filter(t => t !== tipo);
      if (proximos.length === 0) return;
      onChange(proximos);
    } else {
      onChange([...selecionados, tipo]);
    }
  }

  return (
    <div className="tipos-servico-input">
      {opcoes.map(opcao => (
        <label
          key={opcao.value}
          className={`tipos-servico-opcao${selecionados.includes(opcao.value) ? ' tipos-servico-opcao--ativo' : ''}`}
        >
          <input
            type="checkbox"
            checked={selecionados.includes(opcao.value)}
            onChange={() => toggleTipo(opcao.value)}
          />
          <span>{opcao.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Renderiza a classificação do cliente em relação à base da operadora.
 */
function ClienteDaBaseInput({ value, onChange, disabled }) {
  const clienteDaBase = value === true || Number(value) === 1;

  return (
    <label className={`tipos-servico-opcao cliente-base-opcao${clienteDaBase ? ' tipos-servico-opcao--ativo' : ''}`}>
      <input type="checkbox" checked={clienteDaBase} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>Cliente da base</span>
      <span className="cliente-base-ajuda" tabIndex={0} aria-label="Entenda a classificação do cliente">
        ?
        <span className="cliente-base-ajuda__tooltip" role="tooltip">
          Cliente da base: já possui o mesmo produto na operadora, seja por portabilidade ou novo. Cliente de fora da base: não possui o mesmo produto.
        </span>
      </span>
    </label>
  );
}
/**
 * Renderiza itens chips input.
 */
function ItensChipsInput({
  value,
  onChange,
  operadoras = [],
  vendedoras = [],
  limiteQuantidade = 0,
  tiposServico = ['novo']
}) {
  const itens = Array.isArray(value) && value.length > 0 ? value : [{ ...ITEM_CHIP_VAZIO }];
  const total = calcularTotalItensChips(itens);
  const mostrarVendedora = vendedoras.length > 1;
  const mostrarTipoLinha = Array.isArray(tiposServico) && tiposServico.length > 1;
  const limite = Number(limiteQuantidade || 0);
  const quantidadeTotal = somarQuantidadeItensChips(itens);
  const limiteAtingido = limite > 0 && quantidadeTotal >= limite;
  const vendedorasUsadas = new Set(
    itens
      .filter(item => Number(item.quantidade || 0) > 0)
      .map(item => String(item.vendedora_id || ''))
      .filter(Boolean)
  );
  const vendedorasSemChips = mostrarVendedora
    ? vendedoras.filter(vendedora => !vendedorasUsadas.has(String(vendedora.id)))
    : [];

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
    const tipo_linha = mostrarTipoLinha ? 'novo' : (tiposServico[0] || 'novo');
    onChange([
      ...itens,
      {
        ...ITEM_CHIP_VAZIO,
        tipo_linha
      }
    ]);
  }

  /**
   * Remove item da colecao ou estado atual.
   */
  function removerItem(index) {
    if (limite > 0) {
      const quantidadeItem = Number(itens[index]?.quantidade || 0);
      const totalSemEste = quantidadeTotal - quantidadeItem;
      if (totalSemEste < limite && itens.length <= 1) return;
    }
    const proximos = itens.filter((_, itemIndex) => itemIndex !== index);
    onChange(proximos.length > 0 ? proximos : [{ ...ITEM_CHIP_VAZIO }]);
  }

  return (
    <div className={`chip-items chip-items--com-operadora${mostrarVendedora ? ' chip-items--com-vendedora' : ''}${!mostrarTipoLinha ? ' chip-items--sem-tipo' : ''}`}>
      <div className="chip-items__head">
        <span>Qtd.</span>
        <span>GB</span>
        {mostrarTipoLinha && <span>Tipo</span>}
        <span>Operadora atual</span>
        <span>Vai para</span>
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
            <label className="chip-item-field chip-item-field--quantidade">
              <span className="chip-item-field__label">Chips</span>
              <input
                type="number"
                min="1"
                max={maximoQuantidadeLinha}
                value={item.quantidade}
                onChange={e => atualizarItem(index, 'quantidade', e.target.value)}
                placeholder="3"
              />
            </label>
            <label className="chip-item-field chip-item-field--gb">
              <span className="chip-item-field__label">GB</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={getMaxLengthCampo('gb')}
                value={item.gb}
                onChange={e => atualizarItem(index, 'gb', formatarCampoVenda('gb', e.target.value))}
                placeholder="20"
              />
            </label>
            {mostrarTipoLinha && (
              <label className="chip-item-field chip-item-field--tipo">
                <span className="chip-item-field__label">Tipo</span>
                <SelectFiltro
                  value={item.tipo_linha || 'novo'}
                  onChange={val => atualizarItem(index, 'tipo_linha', val)}
                  options={TIPOS_LINHA_CHIP}
                  placeholder="Novo"
                />
              </label>
            )}
            <label className="chip-item-field chip-item-field--operadora">
              <span className="chip-item-field__label">Operadora atual</span>
              <SelectFiltro
                value={item.operadora_atual_id || ''}
                onChange={val => atualizarItem(index, 'operadora_atual_id', val)}
                options={operadoras.map(operadora => ({ value: String(operadora.id), label: operadora.nome }))}
                placeholder="Selecione"
              />
            </label>
            <label className="chip-item-field chip-item-field--operadora-destino">
              <span className="chip-item-field__label">Vai para operadora</span>
              <SelectFiltro
                value={item.operadora_id || ''}
                onChange={val => atualizarItem(index, 'operadora_id', val)}
                options={operadoras.map(operadora => ({ value: String(operadora.id), label: operadora.nome }))}
                placeholder="Selecione"
              />
            </label>
            <label className="chip-item-field chip-item-field--valor">
              <span className="chip-item-field__label">Valor unit.</span>
              <input
                type="text"
                inputMode="decimal"
                value={item.valor_unitario}
                onChange={e => atualizarItem(index, 'valor_unitario', formatarInputMoedaBR(e.target.value))}
                placeholder="29,99"
              />
            </label>
            <div className="chip-item-subtotal">{formatarMoeda(subtotal)}</div>
            {mostrarVendedora && (
              <label className="chip-item-field chip-item-field--vendedora">
                <span className="chip-item-field__label">Vendedora</span>
                <SelectFiltro
                  value={item.vendedora_id || ''}
                  onChange={val => atualizarItem(index, 'vendedora_id', val)}
                  options={vendedoras.map(v => ({ value: String(v.id), label: v.nome }))}
                  placeholder="—"
                />
              </label>
            )}
            <button
              type="button"
              className="btn btn-icon btn-ghost btn-danger-icon"
              onClick={() => removerItem(index)}
              title="Remover item"
              disabled={limite > 0 && itens.length === 1 && quantidadeTotal <= limite}
            >
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
      {limite > 0 && quantidadeTotal < limite && (
        <div className="chip-items__aviso-minimo">
          Faltam {limite - quantidadeTotal} chip{limite - quantidadeTotal !== 1 ? 's' : ''} para atingir a quantidade de linhas contratadas
        </div>
      )}
      {vendedorasSemChips.length > 0 && (
        <div className="chip-items__aviso-minimo">
          Falta atribuir chip para: {vendedorasSemChips.map(v => v.nome).join(', ')}
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza vendedoras select.
 */
export function VendedorasSelect({ value = [], options = [], onChange, idProtegido = null, disabled = false }) {
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
    if (disabled) return;
    onChange([...value, String(vendedora.id)]);
    setDropdownAberto(false);
    setBuscaVendedora('');
  }

  /**
   * Remove  da colecao ou estado atual.
   */
  function remover(id) {
    if (disabled) return;
    if (idProtegido !== null && String(id) === String(idProtegido)) return;
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
        {selecionadas.map(v => {
          const protegida = idProtegido !== null && String(v.id) === String(idProtegido);
          return (
            <span key={v.id} className="vendedoras-chip">
              {v.nome}
              {!disabled && !protegida && (
                <button
                  type="button"
                  onClick={() => remover(v.id)}
                  title={`Remover ${v.nome}`}
                  aria-label={`Remover ${v.nome}`}
                >
                  <I.Close size={12} />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && disponiveis.length > 0 && (
          <button
            type="button"
            className="btn btn-sm vendedoras-add-btn"
            onClick={alternarDropdown}
          >
            <I.Plus size={13} /> Adicionar vendedora
          </button>
        )}
      </div>
      {!disabled && dropdownAberto && disponiveis.length > 0 && (
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
      {numeros.map((numero, index) => {
        const naoVazio = !numeroLinhaTemApenasDddOuVazio(numero);
        const validacao = naoVazio ? validarNumeroTelefone(numero) : null;
        const invalido = validacao && !validacao.valido;

        return (
          <div key={index} className="ported-number-row">
            <div className="ported-number-input-wrap">
              <input
                type="text"
                inputMode="numeric"
                value={numero}
                onChange={event => atualizarNumero(index, formatarTelefoneComDdd(event.target.value, true))}
                placeholder="(11) 99999-9999"
                maxLength={15}
                className={invalido ? 'is-invalid' : undefined}
                title={invalido ? validacao.motivo : undefined}
              />
              {invalido && <span className="field-hint field-hint--error">{validacao.motivo}</span>}
            </div>
            <button type="button" className="btn btn-icon btn-ghost btn-danger-icon" onClick={() => removerNumero(index)} title="Remover número">
              <I.Trash size={13} />
            </button>
          </div>
        );
      })}

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
  const numerosBloqueioPreenchiodos = (numeros.bloqueio || []).filter(n => (n || '').replace(/\D/g, '').length > 2);
  const numerosCancelamentoPreeenchidos = (numeros.cancelamento || []).filter(n => (n || '').replace(/\D/g, '').length > 2);
  const totalNumeros = numerosBloqueioPreenchiodos.length + numerosCancelamentoPreeenchidos.length;

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

      {totalNumeros > 0 && (
        <div className="cliente-solicitou__numeros-preview">
          {numerosBloqueioPreenchiodos.length > 0 && (
            <div className="cliente-solicitou__numeros-grupo">
              <span className="cliente-solicitou__numeros-label cliente-solicitou__numeros-label--bloqueio">Bloqueio</span>
              {numerosBloqueioPreenchiodos.map((n, i) => {
                const invalido = !validarNumeroTelefone(n).valido;
                return (
                  <span key={i} title={invalido ? validarNumeroTelefone(n).motivo : undefined} className={`cliente-solicitou__numero-badge cliente-solicitou__numero-badge--bloqueio${invalido ? ' is-invalid-badge' : ''}`}>{n}</span>
                );
              })}
            </div>
          )}
          {numerosCancelamentoPreeenchidos.length > 0 && (
            <div className="cliente-solicitou__numeros-grupo">
              <span className="cliente-solicitou__numeros-label cliente-solicitou__numeros-label--cancelamento">Cancelamento</span>
              {numerosCancelamentoPreeenchidos.map((n, i) => {
                const invalido = !validarNumeroTelefone(n).valido;
                return (
                  <span key={i} title={invalido ? validarNumeroTelefone(n).motivo : undefined} className={`cliente-solicitou__numero-badge cliente-solicitou__numero-badge--cancelamento${invalido ? ' is-invalid-badge' : ''}`}>{n}</span>
                );
              })}
            </div>
          )}
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

  const digitosPreenchidos = selecionados.flatMap(tipo =>
    (numeros[tipo] || []).map(n => apenasDigitos(n)).filter(d => d.length > 2)
  );
  const contagemDigitos = digitosPreenchidos.reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
  const digitosDuplicados = new Set(Object.keys(contagemDigitos).filter(d => contagemDigitos[d] > 1));

  return (
    <div className="modal-overlay">
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
                {(numeros[tipo] || []).map((numero, index) => {
                  const digitos = apenasDigitos(numero);
                  const naoVazio = digitos.length > 2;
                  const validacao = naoVazio ? validarNumeroTelefone(numero) : null;
                  const invalido = validacao && !validacao.valido;
                  const duplicado = naoVazio && !invalido && digitosDuplicados.has(digitos);
                  const erro = invalido ? validacao.motivo : duplicado ? 'Número já adicionado' : null;
                  const classe = `cliente-solicitou-numero-row${invalido ? ' is-invalid' : duplicado ? ' is-duplicate' : ''}`;
                  return (
                    <label key={`${tipo}-${index}`} className={classe}>
                      <span>{index + 1}</span>
                      <div className="cs-numero-wrap">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={numero}
                          onChange={event => atualizarNumero(tipo, index, event.target.value)}
                          maxLength={15}
                          placeholder="(11) 99999-9999"
                        />
                        {erro && <span className="cs-numero-erro">{erro}</span>}
                      </div>
                    </label>
                  );
                })}
              </section>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Voltar</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={faltando || digitosDuplicados.size > 0}>
            Confirmar números
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza cliente solicitou resolucao tab.
 */
function ClienteSolicitouResolucaoTab({ form, onChange, disabled }) {
  const linhas = montarLinhasClienteSolicitou(form);

  return (
    <div className="cliente-solicitou-resolucao">
      <div className="cliente-solicitou-resolucao__table-wrap">
        <table className="cliente-solicitou-resolucao__table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Serviço solicitado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length > 0 ? linhas.map((linha, index) => (
              <tr key={`${linha.servico}-${linha.numero}-${index}`}>
                <td>{linha.numero}</td>
                <td>{CLIENTE_SOLICITOU_LABELS[linha.servico] || linha.servico}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={2}>Nenhum número informado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <fieldset className="venda-readonly-fieldset" disabled={disabled}>
        <div className="vendas-form-grid cliente-solicitou-resolucao__form">
          <div className="form-field">
            <label>Problema foi resolvido</label>
            <SelectFiltro
              value={form.cliente_solicitou_resolvido || ''}
              onChange={val => onChange('cliente_solicitou_resolvido', val)}
              placeholder="Selecione"
              options={[
                { value: 'sim', label: 'Sim' },
                { value: 'nao', label: 'Não' },
              ]}
            />
          </div>

          {form.cliente_solicitou_resolvido === 'sim' && (
            <>
              <div className="form-field">
                <label>Data de resolução</label>
                <input
                  type="date"
                  value={form.cliente_solicitou_resolvido_em || ''}
                  onChange={event => onChange('cliente_solicitou_resolvido_em', event.target.value)}
                />
              </div>
              <div className="form-field span-2">
                <label>Protocolo de atendimento</label>
                <input
                  type="text"
                  value={form.cliente_solicitou_protocolo_atendimento || ''}
                  onChange={event => onChange('cliente_solicitou_protocolo_atendimento', event.target.value)}
                />
              </div>
              <div className="form-field span-2">
                <label>Observação</label>
                <AutoResizeTextarea
                  value={form.cliente_solicitou_observacao || ''}
                  onChange={event => onChange('cliente_solicitou_observacao', event.target.value)}
                  maxRows={5}
                />
              </div>
            </>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Obtem autor cancelamento a partir dos dados informados.
 */
function obterAutorCancelamento(venda, evento) {
  if (evento?.usuario?.nome) return evento.usuario.nome;
  if (evento?.usuario_id) return `Usuario #${evento.usuario_id}`;
  if (venda?.cancelada_por?.nome) return venda.cancelada_por.nome;
  if (venda?.cancelada_por_id) return `Usuario #${venda.cancelada_por_id}`;
  return 'Sistema';
}

/**
 * Monta eventos cancelamento venda a partir dos dados informados.
 */
function montarEventosCancelamentoVenda(venda) {
  const historico = Array.isArray(venda?.historico) ? venda.historico : [];
  const eventos = historico
    .filter(item => item?.acao === 'venda.cancelada')
    .map(item => ({
      id: item.id || `${item.created_at || ''}-${item.observacao || ''}`,
      data: item.created_at || venda?.cancelada_em,
      autor: obterAutorCancelamento(venda, item),
      motivo: item.observacao || item.dados?.motivo_cancelamento || venda?.motivo_cancelamento || ''
    }));

  if (eventos.length === 0 && (venda?.cancelada_em || venda?.motivo_cancelamento)) {
    eventos.push({
      id: 'cancelamento-atual',
      data: venda.cancelada_em,
      autor: obterAutorCancelamento(venda, null),
      motivo: venda.motivo_cancelamento || ''
    });
  }

  return eventos;
}

/**
 * Renderiza venda cancelamento tab.
 */
function VendaCancelamentoTab({ venda }) {
  const eventos = montarEventosCancelamentoVenda(venda);
  const motivoAtual = venda?.motivo_cancelamento || eventos[0]?.motivo || '';

  return (
    <div className="venda-cancelamento">
      <div className="venda-cancelamento__summary">
        <div className="venda-cancelamento__icon">
          <I.AlertTriangle size={18} />
        </div>
        <div>
          <div className="venda-cancelamento__title">Venda cancelada</div>
          <div className="venda-cancelamento__meta">
            {formatarDataHora(venda?.cancelada_em)}
            {venda?.cancelada_por_id ? ` por ${obterAutorCancelamento(venda, null)}` : ''}
          </div>
        </div>
      </div>

      <div className="venda-cancelamento__reason">
        <span>Motivo atual</span>
        <p>{motivoAtual || 'Sem motivo informado.'}</p>
      </div>

      <div className="venda-cancelamento__history">
        <div className="venda-cancelamento__section-title">Historico de cancelamentos</div>
        {eventos.length > 0 ? (
          <div className="venda-cancelamento__list">
            {eventos.map((evento, index) => (
              <div key={evento.id || index} className="venda-cancelamento__item">
                <div className="venda-cancelamento__item-head">
                  <strong>{formatarDataHora(evento.data)}</strong>
                  <span>{evento.autor}</span>
                </div>
                <p>{evento.motivo || 'Sem motivo informado.'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="venda-cancelamento__empty">Nenhum motivo de cancelamento registrado.</div>
        )}
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
  const [tiposResponsaveis, setTiposResponsaveis] = useState({});
  const visiveis = slots.slice(0, linhasVisiveis);
  const opcoesRecebimento = [
    {
      value: 'rl',
      nome: form.nome_representante_legal || '',
      rg: form.rg_representante_legal || ''
    },
    {
      value: 'adm',
      nome: form.nome_administrador || '',
      rg: form.rg_administrador || ''
    }
  ];

  /**
   * Obtem tipo responsavel a partir dos dados informados.
   */
  function obterTipoResponsavel(slot) {
    if (tiposResponsaveis[slot.nomeKey]) return tiposResponsaveis[slot.nomeKey];

    const nome = String(form[slot.nomeKey] || '').trim();
    const rg = String(form[slot.rgKey] || '').trim();
    if (!nome && !rg) return '';

    const encontrado = opcoesRecebimento.find(opcao => (
      (opcao.nome || opcao.rg)
      && nome === String(opcao.nome || '').trim()
      && rg === String(opcao.rg || '').trim()
    ));

    return encontrado?.value || 'outra';
  }

  /**
   * Seleciona tipo e atualiza o estado relacionado.
   */
  function selecionarTipo(slot, tipo) {
    setTiposResponsaveis(prev => ({
      ...prev,
      [slot.nomeKey]: tipo
    }));

    const opcao = opcoesRecebimento.find(item => item.value === tipo);

    if (opcao) {
      onChange(slot.nomeKey, opcao.nome);
      onChange(slot.rgKey, opcao.rg);
      return;
    }

    if (tipo === 'outra' && ['rl', 'adm'].includes(obterTipoResponsavel(slot))) {
      onChange(slot.nomeKey, '');
      onChange(slot.rgKey, '');
    }
  }

  /**
   * Remove linha da colecao ou estado atual.
   */
  function removerLinha(index) {
    const slot = slots[index];
    onChange(slot.nomeKey, '');
    onChange(slot.rgKey, '');
    setTiposResponsaveis(prev => {
      const proximo = { ...prev };
      delete proximo[slot.nomeKey];
      return proximo;
    });
    setLinhasVisiveis(prev => Math.max(1, prev - 1));
  }

  return (
    <div className="responsaveis-list">
      {visiveis.map((slot, index) => (
        <div key={slot.nomeKey} className="responsavel-row">
          <span className="responsavel-row__num">{index + 1}</span>
          <SelectFiltro
            value={obterTipoResponsavel(slot)}
            onChange={val => selecionarTipo(slot, val)}
            placeholder="Selecione"
            options={[
              { value: 'rl', label: 'RL', disabled: !form.nome_representante_legal && !form.rg_representante_legal },
              { value: 'adm', label: 'ADM', disabled: !form.nome_administrador && !form.rg_administrador },
              { value: 'outra', label: 'Outra pessoa' },
            ]}
          />
          <div className="responsavel-row__campos">
            <input
              type="text"
              placeholder="Nome do responsável"
              value={form[slot.nomeKey] || ''}
              onChange={event => onChange(slot.nomeKey, event.target.value)}
              readOnly={['rl', 'adm'].includes(obterTipoResponsavel(slot))}
            />
            <input
              type="text"
              placeholder="RG"
              maxLength={LIMITE_CARACTERES_RG}
              value={form[slot.rgKey] || ''}
              onChange={event => onChange(slot.rgKey, event.target.value)}
              readOnly={['rl', 'adm'].includes(obterTipoResponsavel(slot))}
            />
            {['rl', 'adm'].includes(obterTipoResponsavel(slot)) && (
              <span className="responsavel-row__source">Dados preenchidos pela venda</span>
            )}
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
function ClienteVendaSelect({
  value,
  clientes,
  vendasRegistradas = 0,
  vendasEmAndamento = 0,
  clienteBaseAnterior = false,
  onChange,
  onCreateClient
}) {
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
        {clienteBaseAnterior && (
          <div className="venda-cliente-repeat-alert">
            <I.AlertTriangle size={13} />
            <span>
              Este cliente veio da base anterior e ja é cliente. Confira as vendas existentes antes de prosseguir.
            </span>
          </div>
        )}
        {vendasEmAndamento > 0 && (
          <div className="venda-cliente-repeat-alert venda-cliente-repeat-alert--andamento">
            <I.AlertTriangle size={13} />
            <span>
              Este cliente possui {vendasEmAndamento} {vendasEmAndamento === 1 ? 'venda em andamento' : 'vendas em andamento'}.
            </span>
          </div>
        )}
        {vendasRegistradas - vendasEmAndamento > 0 && (
          <div className="venda-cliente-repeat-alert">
            <I.AlertTriangle size={13} />
            <span>
              {(() => { const n = vendasRegistradas - vendasEmAndamento; return `Este cliente possui ${n} ${n === 1 ? 'venda concluída' : 'vendas concluídas'}.`; })()}
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
/**
 * Miniatura de um comprovante de etapa. Busca o blob autenticado da API.
 */
function EtapaThumb({ vendaId, arquivo, podeExcluir, onExcluir }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let ativo = true;
    let objectUrl = '';

    blobArquivoVenda(vendaId, arquivo.id)
      .then(blob => {
        if (!ativo) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});

    return () => {
      ativo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vendaId, arquivo.id]);

  return (
    <div className="venda-etapa-thumb">
      {url ? (
        <img src={url} alt={arquivo.nome_original} />
      ) : (
        <span className="venda-etapa-thumb__placeholder"><I.Note size={16} /></span>
      )}
      <div className="venda-etapa-thumb__overlay">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => visualizarArquivoVenda(vendaId, arquivo.id)}
          title="Visualizar"
        >
          <I.Eye size={12} />
        </button>
        {podeExcluir && (
          <button
            type="button"
            className="btn btn-sm vendas-trash-delete"
            onClick={() => onExcluir(arquivo)}
            title="Excluir comprovante"
          >
            <I.Trash size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Checklist de conferencia da venda (0800, ABR Telecom e VIVO) exibido na aba Documentos.
 */
function EtapasVendaTab({ venda, podeEditar, podeAdicionar, etapasArquivos = [], onArquivosAlterados = () => {}, onEtapasAtualizadas = () => {} }) {
  const [etapas, setEtapas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState('');
  const [erro, setErro] = useState('');
  const [recolhido, setRecolhido] = useState(true); // começa sempre recolhida para evitar poluição visual
  const inputsRef = useRef({});

  /**
   * Carrega as etapas da venda.
   */
  async function carregarEtapas() {
    if (!venda?.id) return;

    setCarregando(true);

    try {
      const data = await listarEtapasVenda(venda.id);
      setEtapas(data.etapas || []);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar etapas.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!venda?.id) return undefined;
    let ativo = true;

    listarEtapasVenda(venda.id)
      .then(data => {
        if (ativo) setEtapas(data.etapas || []);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar etapas.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => { ativo = false; };
  }, [venda?.id]);

  const visiveis = etapas.filter(etapa => etapa.aplicavel);
  const concluidas = visiveis.filter(etapa => etapa.concluida).length;
  const atual = visiveis.find(etapa => !etapa.concluida) || null;

  /**
   * Registra o resultado da etapa 1 (0800). `null` volta a etapa para pendente.
   */
  async function handleResultado0800(resultado) {
    setErro('');
    setSalvando('0800');

    try {
      const data = await atualizarEtapa0800(venda.id, resultado);
      setEtapas(data.etapas || []);
      onEtapasAtualizadas(data.etapas || []);
    } catch (error) {
      setErro(error.message || 'Erro ao atualizar a etapa.');
    } finally {
      setSalvando('');
    }
  }

  /**
   * Anexa o comprovante de uma etapa (conclui a etapa automaticamente).
   */
  async function handleAnexar(etapa, event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (files.length === 0) return;

    setErro('');
    setSalvando(etapa.chave);

    try {
      for (const file of files) {
        await uploadArquivoVenda(venda.id, file, { categoria: etapa.categoria });
      }

      await onArquivosAlterados();
      await carregarEtapas();
    } catch (error) {
      setErro(error.message || 'Erro ao anexar comprovante.');
    } finally {
      setSalvando('');
    }
  }

  /**
   * Remove um comprovante de etapa (reabre a etapa se for o ultimo).
   */
  async function handleExcluirComprovante(etapa, arquivo) {
    if (!window.confirm(`Excluir o comprovante "${arquivo.nome_original}"? A etapa volta a ficar pendente se for o último.`)) return;

    setErro('');
    setSalvando(etapa.chave);

    try {
      await excluirArquivoVenda(venda.id, arquivo.id);
      await onArquivosAlterados();
      await carregarEtapas();
    } catch (error) {
      setErro(error.message || 'Erro ao excluir comprovante.');
    } finally {
      setSalvando('');
    }
  }

  if (carregando && etapas.length === 0) {
    return (
      <div className="venda-etapas">
        <div className="venda-etapas-title">Etapas de conferência</div>
        <div className="venda-etapas-resumo">Carregando etapas...</div>
      </div>
    );
  }

  return (
    <div className="venda-etapas">
      <button
        type="button"
        className="venda-etapas-header venda-etapas-header--toggle"
        aria-expanded={!recolhido}
        onClick={() => setRecolhido(prev => !prev)}
      >
        <div className="venda-etapas-title">Etapas de conferência</div>
        <div className={`venda-etapas-resumo ${atual ? '' : 'venda-etapas-resumo--ok'}`}>
          {atual
            ? `Etapa ${visiveis.indexOf(atual) + 1} de ${visiveis.length} · ${atual.titulo}`
            : 'Todas as etapas concluídas'}
        </div>
        <I.ChevronDown size={16} className="venda-etapas-chevron" />
      </button>

      <div className="venda-etapas-stepper">
        {visiveis.map((etapa, idx) => {
          const estado = etapa.concluida
            ? 'concluida'
            : (atual && atual.chave === etapa.chave ? 'atual' : 'pendente');

          return (
            <div key={etapa.chave} className={`venda-etapa-step venda-etapa-step--${estado}`}>
              <span className="venda-etapa-step__bullet">
                {etapa.concluida ? <I.Check size={14} /> : idx + 1}
              </span>
              <span className="venda-etapa-step__label">{etapa.titulo}</span>
              {idx < visiveis.length - 1 && <span className="venda-etapa-step__conector" />}
            </div>
          );
        })}
      </div>

      {!recolhido && (
        <>
      {erro && <div className="alert-error">{erro}</div>}

      <div className="venda-etapas-cards">
        {visiveis.map((etapa, idx) => {
          const arquivos = etapasArquivos.filter(item => item.categoria === etapa.categoria);
          const ocupado = salvando === etapa.chave;
          const rotuloResultado = (etapa.opcoes || []).find(opcao => opcao.valor === etapa.resultado)?.rotulo || '';

          return (
            <div
              key={etapa.chave}
              className={`venda-etapa-card ${etapa.concluida ? 'venda-etapa-card--concluida' : ''}`}
            >
              <div className="venda-etapa-card__head">
                <div className="venda-etapa-card__titulo">
                  <span className="venda-etapa-card__numero">Etapa {idx + 1}</span>
                  <strong>{etapa.titulo}</strong>
                </div>
                <span className={`venda-etapa-badge ${etapa.concluida ? 'is-ok' : ''}`}>
                  {etapa.concluida ? 'Concluída' : 'Pendente'}
                </span>
              </div>

              {/* A linha de meta e sempre renderizada nas etapas sem arquivo para o card nao mudar de altura ao trocar a base. */}
              {(!etapa.requer_arquivo || (etapa.concluida && etapa.concluida_por)) && (
                <div className="venda-etapa-card__meta">
                  {etapa.concluida ? (
                    <>
                      {rotuloResultado ? <strong>{rotuloResultado}</strong> : null}
                      {rotuloResultado && etapa.concluida_por ? ' · ' : ''}
                      {etapa.concluida_por ? `Por ${etapa.concluida_por.nome}` : ''}
                      {etapa.concluida_por && etapa.concluida_em ? ` · ${formatarDataHora(etapa.concluida_em)}` : ''}
                    </>
                  ) : 'Nenhum resultado registrado.'}
                </div>
              )}

              {!etapa.requer_arquivo ? (
                <div className="venda-etapa-opcoes">
                  <span className="venda-etapa-opcoes__label">Resultado da verificação:</span>

                  {(etapa.opcoes || []).map(opcao => (
                    <label key={opcao.valor} className="venda-etapa-opcao">
                      <input
                        type="radio"
                        name={`etapa-${etapa.chave}-resultado-${venda.id}`}
                        checked={etapa.resultado === opcao.valor}
                        disabled={!podeAdicionar || ocupado}
                        onChange={() => handleResultado0800(opcao.valor)}
                      />
                      <span>{opcao.rotulo}</span>
                    </label>
                  ))}

                  {podeAdicionar && (
                    <button
                      type="button"
                      className="btn venda-etapa-opcoes__limpar"
                      disabled={ocupado || !etapa.resultado}
                      onClick={() => handleResultado0800(null)}
                    >
                      Limpar seleção
                    </button>
                  )}
                </div>
              ) : (
                <div className="venda-etapa-card__anexos">
                  <input
                    ref={el => { inputsRef.current[etapa.chave] = el; }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={event => handleAnexar(etapa, event)}
                  />

                  {arquivos.length > 0 && (
                    <div className="venda-etapa-thumbs">
                      {arquivos.map(arquivo => (
                        <EtapaThumb
                          key={arquivo.id}
                          vendaId={venda.id}
                          arquivo={arquivo}
                          podeExcluir={podeEditar && !ocupado}
                          onExcluir={item => handleExcluirComprovante(etapa, item)}
                        />
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    className={`btn ${etapa.concluida ? '' : 'btn-primary'}`}
                    disabled={!podeAdicionar || ocupado}
                    onClick={() => inputsRef.current[etapa.chave]?.click()}
                  >
                    <I.Plus size={13} />
                    {ocupado ? 'Enviando...' : 'Anexar comprovante'}
                  </button>
                  <span className="venda-etapa-card__hint">
                    A etapa é concluída ao anexar a imagem (JPG, PNG ou WEBP).
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="venda-etapas-progresso">
        {concluidas} de {visiveis.length} etapas concluídas
      </div>
        </>
      )}
    </div>
  );
}

/**
 * Aba de documentos da venda (etapas de conferencia + arquivos).
 * Exportada porque o modal rapido do funil reutiliza a mesma aba.
 */
export function ArquivosVendaTab({
  venda,
  podeEditar,
  podeVisualizar,
  podeAdicionar,
  pendingArquivos = [],
  onPendingArquivosChange = () => {},
  onEtapasAtualizadas = () => {},
  possuiDocNaCasa = false,
  onPossuiDocNaCasaChange = () => {},
  onArquivosAlterados = () => {}
}) {
  const inputRef = useRef(null);
  const [arquivos, setArquivos] = useState([]);
  const [etapasArquivos, setEtapasArquivos] = useState([]);
  const [pacote, setPacote] = useState(null);
  const [categoria, setCategoria] = useState('documento');
  const [carregando, setCarregando] = useState(true);
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
      setEtapasArquivos([]);
      setPacote(null);
      return;
    }

    setCarregando(true);
    setErro('');

    try {
      const data = await listarArquivosVenda(venda.id);
      setArquivos(data.arquivos || []);
      setEtapasArquivos(data.etapas_arquivos || []);
      setPacote(data.pacote || null);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar arquivos.');
    } finally {
      setCarregando(false);
    }
  }

  const carregarNoIntervalo = useEffectEvent(carregar);

  useEffect(() => {
    if (!venda?.id || !podeVisualizar) return undefined;
    let ativo = true;

    listarArquivosVenda(venda.id)
      .then(data => {
        if (!ativo) return;
        setArquivos(data.arquivos || []);
        setEtapasArquivos(data.etapas_arquivos || []);
        setPacote(data.pacote || null);
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar arquivos.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => { ativo = false; };
  }, [venda?.id, podeVisualizar]);

  useEffect(() => {
    if (!podeVisualizar) return undefined;
    if (!['pendente', 'gerando'].includes(pacote?.status)) return undefined;

    const timer = setInterval(() => {
      carregarNoIntervalo();
    }, 2500);

    return () => clearInterval(timer);
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
      onArquivosAlterados();
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
      onArquivosAlterados();
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
    /**
     * Trata o evento de upload offline.
     */
    function handleUploadOffline(event) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length === 0) return;
      onPendingArquivosChange([
        ...pendingArquivos,
        ...files.map(file => ({ file, categoria }))
      ]);
    }

    /**
     * Remove pendente da colecao ou estado atual.
     */
    function removerPendente(idx) {
      onPendingArquivosChange(pendingArquivos.filter((_, i) => i !== idx));
    }

    return (
      <div className="venda-arquivos">
        <div className="venda-etapas venda-etapas--bloqueada">
          <div className="venda-etapas-title">Etapas de conferência</div>
          <div className="venda-etapas-resumo">
            Salve a venda para liberar as etapas de conferência (0800, ABR Telecom e VIVO).
          </div>
        </div>

        <div className="venda-arquivos-toolbar">
          <div className="venda-arquivos-heading">
            <div className="venda-arquivos-title-row">
              <div className="venda-arquivos-title">Arquivos da venda</div>
              <span className="venda-arquivos-count">
                {pendingArquivos.length} {pendingArquivos.length === 1 ? 'arquivo' : 'arquivos'}
              </span>
            </div>
            <div className="venda-arquivos-package status-inexistente">
              <I.Note size={12} />
              <span className="venda-arquivos-package__text">
                <span>Os arquivos serão enviados ao salvar a venda.</span>
              </span>
            </div>
          </div>

          <div className="venda-arquivos-actions">
            <SelectFiltro
              value={categoria}
              onChange={setCategoria}
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
              onChange={handleUploadOffline}
            />
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              <I.Plus size={13} /> Adicionar arquivos
            </button>
          </div>
        </div>

        {pendingArquivos.length === 0 ? (
          <div
            className="venda-arquivos-empty venda-arquivos-empty--upload"
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
          >
            <span className="venda-arquivos-empty__icon">
              <I.Plus size={20} />
            </span>
            <strong>Nenhum arquivo anexado</strong>
            <span>Clique para selecionar documentos, contratos ou comprovantes.</span>
            <em>PDF, JPG, PNG ou WEBP</em>
          </div>
        ) : (
          <div className="venda-arquivos-list">
            {pendingArquivos.map((item, idx) => (
              <div key={idx} className="venda-arquivo-item">
                <div className="venda-arquivo-icon">
                  <I.Note size={16} />
                </div>
                <div className="venda-arquivo-main">
                  <strong>{item.file.name}</strong>
                  <div className="venda-arquivo-meta">
                    {item.categoria} · {formatarTamanhoArquivo(item.file.size)} · pendente
                  </div>
                </div>
                <div className="venda-arquivo-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost vendas-trash-delete"
                    onClick={() => removerPendente(idx)}
                  >
                    <I.Trash size={12} /> Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const statusPacote = pacote?.status || 'inexistente';
  const totalArquivos = arquivos.length;
  const podeGerenciarPacote = Boolean(podeVisualizar);

  return (
    <div className="venda-arquivos">
      <EtapasVendaTab
        venda={venda}
        podeEditar={podeEditar}
        podeAdicionar={podeAdicionar}
        etapasArquivos={etapasArquivos}
        onArquivosAlterados={carregar}
        onEtapasAtualizadas={onEtapasAtualizadas}
      />

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

      <div className="venda-doc-casa">
        <label className="venda-doc-casa__check">
          <input
            type="checkbox"
            checked={Boolean(possuiDocNaCasa)}
            disabled={!podeEditar}
            onChange={event => onPossuiDocNaCasaChange(event.target.checked)}
          />
          <span>Venda possui doc na casa</span>
        </label>
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
/**
 * Renderiza venda modal.
 */
export function VendaResumoConsultora({ venda }) {
  const chips = Array.isArray(venda?.chips) ? venda.chips : [];
  const vendedoras = Array.isArray(venda?.vendedoras) ? venda.vendedoras : [];

  return (
    <div className="venda-resumo-consultora">
      <div className={`venda-resumo-consultora__status ${venda?.concluida ? 'is-concluida' : 'is-andamento'}`}>
        {venda?.concluida ? <I.Check size={15} /> : <I.History size={15} />}
        <span>{venda?.concluida ? 'Venda concluída' : 'Venda ainda não concluída'}</span>
      </div>

      <dl className="venda-resumo-consultora__dados">
        <div>
          <dt>Razão social</dt>
          <dd>{venda?.razao_social || 'Não informada'}</dd>
        </div>
        <div>
          <dt>CNPJ</dt>
          <dd>{venda?.cnpj ? formatarCnpj(venda.cnpj) : 'Não informado'}</dd>
        </div>
        <div>
          <dt>Data da venda</dt>
          <dd>{formatarData(venda?.data_venda)}</dd>
        </div>
        {vendedoras.length > 1 && (
          <div>
            <dt>Vendedoras</dt>
            <dd>{vendedoras.map(item => item.nome).filter(Boolean).join(', ') || 'Não informadas'}</dd>
          </div>
        )}
      </dl>

      <section className="venda-resumo-consultora__chips" aria-labelledby="resumo-chips-title">
        <div className="venda-resumo-consultora__section-title" id="resumo-chips-title">Chips e valores vendidos</div>
        {chips.length === 0 ? (
          <p className="venda-resumo-consultora__empty">Nenhum chip informado.</p>
        ) : (
          <div
            className={`venda-resumo-consultora__chip-list${chips.length > 4 ? ' has-overflow' : ''}`}
            data-count={chips.length}
          >
            {chips.map((chip, index) => {
              const quantidade = Number(chip.quantidade) || 0;
              const operadoraAtual = String(chip.operadora_atual || '').trim();
              const operadoraDestino = String(chip.operadora_destino || '').trim();
              const operadorasIguais = Boolean(
                operadoraAtual
                && operadoraDestino
                && operadoraAtual.localeCompare(operadoraDestino, 'pt-BR', { sensitivity: 'base' }) === 0
              );

              return (
                <article className="venda-resumo-consultora__chip-card" key={`${chip.operadora_destino || 'chip'}-${index}`}>
                  <div className="venda-resumo-consultora__chip-main">
                    <div className="venda-resumo-consultora__chip-identity">
                      <span className="venda-resumo-consultora__chip-icon"><I.SimCard size={16} aria-hidden="true" /></span>
                      <div>
                        <strong>{chip.quantidade || '—'} {quantidade === 1 ? 'chip' : 'chips'}</strong>
                        <span>{chip.gb ? `${chip.gb} GB` : 'Franquia não informada'}</span>
                      </div>
                    </div>
                    <span className="venda-resumo-consultora__chip-type">
                      {formatarTipoLinhaChipLabel(chip.tipo_linha)}
                    </span>
                  </div>

                  {operadorasIguais ? (
                    <div className="venda-resumo-consultora__chip-operator is-single" aria-label={`Operadora ${operadoraDestino}`}>
                      <span>Operadora</span>
                      <strong>{operadoraDestino}</strong>
                    </div>
                  ) : (
                    <div className="venda-resumo-consultora__chip-operator" aria-label="Rota entre operadoras">
                      <div>
                        <span>De</span>
                        <strong>{operadoraAtual || '—'}</strong>
                      </div>
                      <I.ArrowRight size={16} aria-hidden="true" />
                      <div>
                        <span>Para</span>
                        <strong>{operadoraDestino || '—'}</strong>
                      </div>
                    </div>
                  )}

                  <div className="venda-resumo-consultora__chip-price">
                    <div>
                      <span>Cálculo</span>
                      <strong>{chip.quantidade || '—'} × {formatarMoeda(chip.valor_unitario)}</strong>
                    </div>
                    <div>
                      <span>Subtotal</span>
                      <strong>{formatarMoeda(chip.subtotal)}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <div className="venda-resumo-consultora__total">
          <span>Valor total</span>
          <strong>{formatarMoeda(venda?.valor_total)}</strong>
        </div>
      </section>
    </div>
  );
}

function VendaModal({
  venda,
  initialValues,
  clientes,
  vendas = [],
  vendedoras,
  operadoras,
  tiposVenda,
  servicos,
  vendasPorCliente,
  vendasEmAndamentoPorCliente = new Map(),
  podeRegistrarReversao = false,
  podeExcluirReversao = false,
  podeCompartilharVenda,
  podeVerDocumentosVenda,
  podeAdicionarDocumentosVenda,
  usuarioLogado,
  initialTab = 'venda',
  initialProblemaId = null,
  modoEdicao = true,
  onEtapasAtualizadas = () => {},
  onStartEdit,
  onClose,
  onSave,
  onSaveReversal,
  onDeleteReversal,
  onRetryDashboard,
  onSendToPosVenda,
  sendToPosVendaLabel = 'Enviar para o pós-venda',
  ignorarSolicitacaoLiberacao = false,
  motivoLiberacaoAprovacao = '',
  onCreateClient,
  onResolveClient,
  clientePreenchido = null,
  clientesCarregados = true,
  initialDraft = null,
  onDraftChange
}) {
  const editando = Boolean(venda?.id);
  const draftKey = 'venda_novo';
  
  const [form, setForm] = useState(() => {
    const base = venda ? normalizarVenda(venda) : { ...criarVendaVazia(), ...(initialValues || {}) };

    // Alguns fluxos antigos ainda preenchem apenas o campo legado. Mantem a
    // selecao multipla usada pelo formulario coerente com esse valor inicial.
    if (!venda && base.vendedora_id && (!Array.isArray(base.vendedoras) || base.vendedoras.length === 0)) {
      base.vendedoras = [String(base.vendedora_id)];
    }
    
    // Para novo venda, tenta carregar rascunho salvo, depois initialDraft, depois formulário vazio
    if (!editando) {
      /**
       * Processa saved draft conforme as regras do dominio.
       */
      const savedDraft = (() => {
        try {
          const draft = localStorage.getItem(`form_draft_${draftKey}`);
          return draft ? JSON.parse(draft) : null;
        } catch {
          return null;
        }
      })();
      
      const baseComDraft = initialValues
        ? base
        : { ...base, ...(savedDraft || initialDraft || {}) };
      baseComDraft.venda_antiga = normalizarIndicadorVendaAntiga(baseComDraft.venda_antiga);
      if (!baseComDraft.venda_antiga) baseComDraft.data_venda = '';
      if (!venda && usuarioLogado?.id && vendedoras?.some(v => String(v.id) === String(usuarioLogado.id))) {
        const idStr = String(usuarioLogado.id);
        if (!baseComDraft.vendedoras.includes(idStr)) baseComDraft.vendedoras = [...baseComDraft.vendedoras, idStr];
      }
      return baseComDraft;
    }
    
    // Para edição, apenas normaliza
    if (!venda && usuarioLogado?.id && vendedoras?.some(v => String(v.id) === String(usuarioLogado.id))) {
      const idStr = String(usuarioLogado.id);
      if (!base.vendedoras.includes(idStr)) base.vendedoras = [...base.vendedoras, idStr];
    }
    return base;
  });
  
  // Usar hook para persistência de rascunhos
  const { clearDraft } = useFormDraft(editando ? null : draftKey, form, editando);

  useEffect(() => {
    if (!editando && initialValues) clearDraft();
  }, [clearDraft, editando, initialValues]);
  const [salvando, setSalvando] = useState(false);
  const [modoReversao, setModoReversao] = useState(false);
  const [observacaoReversao, setObservacaoReversao] = useState('');
  const [historicoCampoAberto, setHistoricoCampoAberto] = useState(null);
  const [reversaoParaExcluir, setReversaoParaExcluir] = useState(null);
  const [docsAlterados, setDocsAlterados] = useState(false);
  const [liberacaoAberta, setLiberacaoAberta] = useState(false);
  const [motivoLiberacao, setMotivoLiberacao] = useState('');
  const [erro, setErro] = useState('');
  const [reenviandoDashboard, setReenviandoDashboard] = useState(false);
  const [cepStatus, setCepStatus] = useState('');
  const [cepRealStatus, setCepRealStatus] = useState('');
  const [cnpjStatus, setCnpjStatus] = useState({ tipo: '', mensagem: '' });
  const [tipoBusca, setTipoBusca] = useState(() => sanitizarCnpj(form.cnpj).length === 11 ? 'cpf' : 'cnpj');
  const [documentosPorTipo, setDocumentosPorTipo] = useState(() => {
    const documento = form.cnpj || '';
    return sanitizarCnpj(documento).length === 11
      ? { cnpj: '', cpf: documento }
      : { cnpj: documento, cpf: '' };
  });
  const [aceiteMode, setAceiteMode] = useState(() => (form.dia_aceite_fixo || form.horario_aceite_fixo) ? 'fixo' : 'janela');
  const [clienteSolicitouQuantidadeAberta, setClienteSolicitouQuantidadeAberta] = useState(false);
  const [clienteSolicitouNumerosAberto, setClienteSolicitouNumerosAberto] = useState(false);
  const [clienteSolicitouServicosDraft, setClienteSolicitouServicosDraft] = useState([]);
  const [clienteSolicitouQuantidadesDraft, setClienteSolicitouQuantidadesDraft] = useState({ bloqueio: '', cancelamento: '' });
  const [clienteSolicitouNumerosDraft, setClienteSolicitouNumerosDraft] = useState({ bloqueio: [], cancelamento: [] });
  const [enderecoRealModalAberto, setEnderecoRealModalAberto] = useState(false);
  const [etapasFunilModal, setEtapasFunilModal] = useState([]);
  const podeAcessarDocumentosVendaInicial = Boolean(podeVerDocumentosVenda || podeAdicionarDocumentosVenda);
  const abaInicial = initialTab === 'arquivos' && !podeAcessarDocumentosVendaInicial ? 'venda' : initialTab;
  const [abaAtiva, setAbaAtiva] = useState(abaInicial);
  const [pendingNotas, setPendingNotas] = useState([]);
  const [pendingArquivos, setPendingArquivos] = useState([]);
  const [clienteLeadProcessado, setClienteLeadProcessado] = useState('');

  useEffect(() => {
    let ativo = true;

    listarEtapasFunil()
      .then(etapas => {
        if (ativo) setEtapasFunilModal(Array.isArray(etapas) ? etapas : []);
      })
      .catch(() => {
        if (ativo) setEtapasFunilModal([]);
      });

    return () => {
      ativo = false;
    };
  }, []);
  const modalBodyRef = useRef(null);
  const alturaAbaAnteriorRef = useRef(null);

  useLayoutEffect(() => {
    const body = modalBodyRef.current;
    if (!body) return undefined;
    const novaAltura = body.offsetHeight;
    const anterior = alturaAbaAnteriorRef.current;
    alturaAbaAnteriorRef.current = novaAltura;
    if (anterior == null || anterior === novaAltura) return undefined;
    const flexAnterior = body.style.flex;
    const overflowAnterior = body.style.overflowY;
    body.style.flex = '0 0 auto';
    body.style.overflowY = 'hidden';
    body.style.height = `${anterior}px`;
    void body.offsetHeight;
    body.style.transition = 'height 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    body.style.height = `${novaAltura}px`;
    let finalizado = false;
    /**
     * Processa finalizar conforme as regras do dominio.
     */
    const finalizar = () => {
      if (finalizado) return;
      finalizado = true;
      body.style.transition = '';
      body.style.height = '';
      body.style.flex = flexAnterior;
      body.style.overflowY = overflowAnterior;
      body.removeEventListener('transitionend', onEnd);
    };
    /**
     * Processa on end conforme as regras do dominio.
     */
    const onEnd = (e) => {
      if (e.target !== body || e.propertyName !== 'height') return;
      finalizar();
    };
    body.addEventListener('transitionend', onEnd);
    const fallback = window.setTimeout(finalizar, 500);
    return () => {
      window.clearTimeout(fallback);
      finalizar();
    };
  }, [abaAtiva]);
  const somenteVisualizacao = Boolean(venda) && !modoEdicao && !modoReversao;
  const enviadaPosVenda = Boolean(venda?.enviada_pos_venda_em || form.enviada_pos_venda_em);
  const vendedorasDaVenda = Array.isArray(venda?.vendedoras) && venda.vendedoras.length > 0
    ? venda.vendedoras
    : (venda?.vendedora ? [venda.vendedora] : []);
  const requerLiberacao = vendedorasDaVenda.length > 1;
  const usuarioPosVenda = temPermissao(usuarioLogado, 'pos_venda');
  const usuarioAdmin = usuarioLogado?.role?.nome === 'admin';
  const usuarioEhResponsavelVenda = Boolean(venda && usuarioLogado?.id && (
    Number(venda.criado_por_id) === Number(usuarioLogado.id)
    || Number(venda.vendedora_id) === Number(usuarioLogado.id)
  ));
  const usuarioEstaNaVendaCompartilhada = Boolean(venda && usuarioLogado?.id
    && Array.isArray(venda.vendedoras)
    && venda.vendedoras.some(item => Number(item?.id || item) === Number(usuarioLogado.id)));
  const usuarioPodeAcessarVendaModal = Boolean(
    !venda
    || temPermissao(usuarioLogado, 'vendas_ver_todas')
    || usuarioEhResponsavelVenda
    || (temPermissao(usuarioLogado, 'ver_vendas_compartilhadas') && usuarioEstaNaVendaCompartilhada)
  );
  const podeEditarVendaEfetivo = Boolean(
    (temPermissao(usuarioLogado, 'vendas_editar') && usuarioPodeAcessarVendaModal)
    || (
      temPermissao(usuarioLogado, 'editar_vendas_compartilhadas')
      && usuarioEstaNaVendaCompartilhada
    )
  );
  const podeAdicionarDocumentosVendaEfetivo = Boolean(podeAdicionarDocumentosVenda);
  const podeAcessarDocumentosVenda = Boolean(podeVerDocumentosVenda || podeAdicionarDocumentosVendaEfetivo);
  const vendaBloqueadaParaUsuario = enviadaPosVenda && !usuarioPosVenda && !modoReversao;
  const podeRegistrarReversaoEfetivo = Boolean(venda?.id && podeRegistrarReversao && usuarioPodeAcessarVendaModal);
  const podeExcluirReversaoEfetivo = Boolean(venda?.id && podeExcluirReversao && usuarioPodeAcessarVendaModal);
  const podeCorrigirDataVenda = !editando || usuarioPosVenda || usuarioAdmin;
  const vendaCancelada = Boolean(venda?.cancelada_em || form.cancelada_em);
  const vendaPortabilidade = temChipPortabilidade(form.valores_unitarios_chips);
  const quantidadePortabilidade = somarQuantidadePortabilidadeItensChips(form.valores_unitarios_chips || []);
  const vendedorasOpcoesModal = useMemo(() => {
    const mapa = new Map();
    [...(vendedoras || []), ...((venda?.vendedoras || []))]
      .filter(Boolean)
      .forEach(item => {
        const id = item.id || item.usuario_id || item.vendedora_id;
        if (id) mapa.set(String(id), { ...item, id });
      });
    return Array.from(mapa.values());
  }, [vendedoras, venda]);
  const reversoesVenda = Array.isArray(venda?.reversoes) ? venda.reversoes : [];
  const camposComReversao = new Set(Array.isArray(venda?.campos_com_reversao) ? venda.campos_com_reversao : []);

  function chavesDoCampoReversao(campo) {
    return CAMPOS_AGRUPADOS_REVERSAO[campo] || [campo];
  }

  function eventosDoCampoReversao(campo) {
    const chaves = new Set(chavesDoCampoReversao(campo));
    return reversoesVenda.flatMap(reversao => (
      (reversao.alteracoes || [])
        .filter(alteracao => chaves.has(alteracao.campo))
        .map(alteracao => ({ reversao, alteracao }))
    ));
  }

  function campoPossuiReversao(campo) {
    return chavesDoCampoReversao(campo).some(chave => camposComReversao.has(chave));
  }

  function abrirHistoricoCampo(campo, titulo) {
    setHistoricoCampoAberto({ campo, titulo, eventos: eventosDoCampoReversao(campo) });
  }

  function renderizarLabelCampo(campo, label, obrigatorio = false) {
    const possuiHistorico = campoPossuiReversao(campo);
    return (
      <span className="venda-field-label-row">
        <span>{label}{obrigatorio && <span className="field-required-mark"> *</span>}</span>
        {possuiHistorico && (
          <button
            type="button"
            className="venda-field-history-btn"
            title={`Ver histórico de ${label}`}
            aria-label={`Ver histórico de ${label}`}
            onClick={event => { event.preventDefault(); abrirHistoricoCampo(campo, label); }}
          >
            <I.History size={13} /> Histórico
          </button>
        )}
      </span>
    );
  }
  const usuarioTemOutrasVendedorasDisponiveis = Boolean(usuarioLogado?.id
    && (vendedoras || []).some(vendedora => Number(vendedora.id) !== Number(usuarioLogado.id)));
  const podeCompartilharVendaEfetivo = Boolean(podeCompartilharVenda || usuarioTemOutrasVendedorasDisponiveis);
  const podeAlterarVendedorasVenda = Boolean(podeCompartilharVendaEfetivo && !somenteVisualizacao && !vendaBloqueadaParaUsuario);
  const clientesDisponiveis = useMemo(() => {
    const mapa = new Map();
    [...(clientes || []), ...(venda?.cliente ? [venda.cliente] : [])]
      .filter(Boolean)
      .forEach(cliente => {
        if (cliente.id) mapa.set(String(cliente.id), cliente);
      });
    return Array.from(mapa.values());
  }, [clientes, venda]);
  const codigosEtapasFinais = useMemo(() => {
    const codigos = new Set(
      etapasFunilModal
        .filter(etapa => etapa?.etapa_final || etapa?.etapaFinal)
        .map(etapa => etapa.codigo || etapa.id)
        .filter(Boolean)
    );

    if (codigos.size === 0) codigos.add('concluido');
    return codigos;
  }, [etapasFunilModal]);
  const statusVendaAtual = venda?.status_funil || form.status_funil || '';
  const vendaEmEtapaFinal = Boolean(venda?.id && statusVendaAtual && codigosEtapasFinais.has(statusVendaAtual));
  const vendaAtivada = Boolean(normalizarDataVendaInput(form.data_ativacao));
  const clienteSelecionadoModal = clientesDisponiveis.find(cliente => String(cliente.id) === String(form.cliente_id));
  const chavesClienteSelecionado = useMemo(() => getChavesClienteVenda({
    ...form,
    cliente_id: form.cliente_id || clienteSelecionadoModal?.id || venda?.cliente_id,
    cliente: clienteSelecionadoModal || venda?.cliente
  }), [form, clienteSelecionadoModal, venda?.cliente, venda?.cliente_id]);
  const vendasRegistradasClienteSelecionado = useMemo(() => {
    if (chavesClienteSelecionado.size === 0) return 0;

    if (Array.isArray(vendas) && vendas.length > 0) {
      return vendas.filter(item => {
        if (venda?.id && Number(item.id) === Number(venda.id)) return false;
        const chavesVenda = getChavesClienteVenda(item);
        return Array.from(chavesClienteSelecionado).some(chave => chavesVenda.has(chave));
      }).length;
    }

    const totalVendasClienteSelecionado = Array.from(chavesClienteSelecionado).reduce((maior, chave) => (
      Math.max(maior, vendasPorCliente?.get(chave) || 0)
    ), 0);

    return venda?.id
      ? Math.max(totalVendasClienteSelecionado - 1, 0)
      : totalVendasClienteSelecionado;
  }, [chavesClienteSelecionado, vendas, venda, vendasPorCliente]);
  const clienteBaseAnteriorSelecionado = Boolean(clienteSelecionadoModal?.base_anterior_sistema);
  const vendasEmAndamentoPorClienteDerivado = useMemo(() => {
    if (!Array.isArray(vendas) || vendas.length === 0) return new Map();
    if (!Array.isArray(etapasFunilModal) || etapasFunilModal.length === 0) return new Map();
    const codigosFinais = new Set(
      etapasFunilModal
        .filter(etapa => etapa?.etapa_final || etapa?.etapaFinal)
        .map(etapa => etapa.codigo || etapa.id)
        .filter(Boolean)
    );
    if (codigosFinais.size === 0) codigosFinais.add('concluido');
    const ativas = vendas.filter(v => !codigosFinais.has(v.status_funil));
    return contarVendasPorCliente(ativas);
  }, [vendas, etapasFunilModal]);
  const mapaEmAndamentoEfetivo = vendasEmAndamentoPorClienteDerivado.size > 0
    ? vendasEmAndamentoPorClienteDerivado
    : vendasEmAndamentoPorCliente;
  const totalEmAndamentoClienteSelecionado = chavesClienteSelecionado.size > 0
    ? Array.from(chavesClienteSelecionado).reduce((maior, chave) => (
      Math.max(maior, mapaEmAndamentoEfetivo.get(chave) || 0)
    ), 0)
    : 0;
  const vendaAtualEmAndamento = Boolean(venda?.id && statusVendaAtual && !codigosEtapasFinais.has(statusVendaAtual));
  const vendasEmAndamentoClienteSelecionado = venda?.id && vendaAtualEmAndamento
    ? Math.max(totalEmAndamentoClienteSelecionado - 1, 0)
    : totalEmAndamentoClienteSelecionado;
  const quantidadeLinhasFechadas = Number(form.quantidade_linhas || 0);
  const quantidadeChipsVenda = somarQuantidadeItensChips(form.valores_unitarios_chips || []);
  const quantidadeNumerosAtivados = quantidadeChipsVenda || quantidadeLinhasFechadas;
  const clienteSolicitouServicos = parseClienteSolicitouServicos(form.cliente_solicitou_servicos);
  const temClienteSolicitouAba = CLIENTE_SOLICITOU_ACOES.some(acao => clienteSolicitouServicos.includes(acao));
  const protocoloOriginal = String(venda?.protocolo || '').trim();
  const protocoloAtual = String(form.protocolo || '').trim();
  const protocoloProtegido = Boolean(protocoloOriginal) && !usuarioAdmin;
  const protocoloBloqueado = somenteVisualizacao
    || vendaBloqueadaParaUsuario
    || !usuarioAdmin;
  const podeGerarProtocolo = !somenteVisualizacao
    && !vendaBloqueadaParaUsuario
    && (!protocoloAtual || usuarioAdmin);
  const dicaProtocolo = protocoloProtegido
    ? 'Protocolo já gerado. Apenas ADM pode alterar ou apagar.'
    : !usuarioAdmin && protocoloAtual
      ? 'Protocolo gerado. Apenas ADM pode alterar ou apagar.'
      : '';

  useEffect(() => {
    if (venda || somenteVisualizacao || !onDraftChange) return;
    onDraftChange(form);
  }, [venda, somenteVisualizacao, form, onDraftChange]);

  /**
   * Trata o evento de close.
   */
  function handleClose() {
    if (!venda && !somenteVisualizacao && onDraftChange) {
      onDraftChange(form);
    }

    onClose();
  }

  function iniciarReversao() {
    if (!podeRegistrarReversaoEfetivo) return;
    setErro('');
    setObservacaoReversao('');
    setAbaAtiva('venda');
    setModoReversao(true);
  }

  /**
   * Limpa dados venda e restaura o estado inicial.
   */
  function limparDadosVenda() {
    if (editando || somenteVisualizacao || vendaBloqueadaParaUsuario || salvando) return;

    const formLimpo = criarVendaVazia();
    if (usuarioLogado?.id && vendedorasOpcoesModal?.some(v => String(v.id) === String(usuarioLogado.id))) {
      formLimpo.vendedoras = [String(usuarioLogado.id)];
    }

    clearDraft();
    setForm(formLimpo);
    onDraftChange?.(formLimpo);
    setErro('');
    setCepStatus('');
    setCepRealStatus('');
    setCnpjStatus({ tipo: '', mensagem: '' });
    setTipoBusca('cnpj');
    setDocumentosPorTipo({ cnpj: '', cpf: '' });
    setAceiteMode('janela');
    setClienteSolicitouQuantidadeAberta(false);
    setClienteSolicitouNumerosAberto(false);
    setClienteSolicitouServicosDraft([]);
    setClienteSolicitouQuantidadesDraft({ bloqueio: '', cancelamento: '' });
    setClienteSolicitouNumerosDraft({ bloqueio: [], cancelamento: [] });
    setEnderecoRealModalAberto(false);
  }

  /**
   * Atualiza campo com os dados informados.
   */
  function atualizarCampo(campo, valor) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    const valorFormatado = formatarCampoVenda(campo, valor);

    if (campo === 'cnpj') {
      setDocumentosPorTipo(prev => ({ ...prev, [tipoBusca]: valorFormatado }));
      const cnpj = sanitizarCnpj(valorFormatado);
      const invalido = tipoBusca === 'cnpj' && cnpj.length === 14 && !validarDigitosCnpj(cnpj);
      setCnpjStatus(invalido ? { tipo: 'erro', mensagem: 'CNPJ inválido.' } : { tipo: '', mensagem: '' });
    }

    if (campo === 'cep') {
      setCepStatus(apenasDigitos(valorFormatado, 8).length === 8 ? 'Buscando CEP...' : '');
    }

    if (campo === 'cep_real') {
      setCepRealStatus(apenasDigitos(valorFormatado, 8).length === 8 ? 'Buscando CEP...' : '');
    }

    setForm(prev => {
      const proximo = {
        ...prev,
        [campo]: valorFormatado
      };

      if (campo === 'quantidade_linhas') {
        proximo.valores_unitarios_chips = limitarItensChipsPorQuantidadeLinhas(
          prev.valores_unitarios_chips,
          valorFormatado
        );
      }

      if (campo === 'valores_unitarios_chips') {
        proximo.valores_unitarios_chips = limitarItensChipsPorQuantidadeLinhas(
          valorFormatado,
          prev.quantidade_linhas
        );
      }

      if (campo === 'tipos_servico') {
        const tipos = Array.isArray(valorFormatado) ? valorFormatado : ['novo'];
        if (tipos.length === 1) {
          proximo.valores_unitarios_chips = (prev.valores_unitarios_chips || []).map(chip => ({
            ...chip,
            tipo_linha: tipos[0]
          }));
        }
      }

      return proximo;
    });
  }

  /** Alterna a classificação histórica e descarta a data manual ao desmarcar. */
  function atualizarVendaAntiga(marcada) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario || !podeCorrigirDataVenda) return;
    setForm(prev => aplicarVendaAntigaAoFormulario(prev, marcada));
  }

  /**
   * Atualiza resolucao cliente solicitou com os dados informados.
   */
  function atualizarResolucaoClienteSolicitou(campo, valor) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    setForm(prev => {
      if (campo !== 'cliente_solicitou_resolvido') {
        return {
          ...prev,
          [campo]: valor
        };
      }

      return {
        ...prev,
        cliente_solicitou_resolvido: valor,
        cliente_solicitou_resolvido_em: valor === 'sim' ? prev.cliente_solicitou_resolvido_em : '',
        cliente_solicitou_protocolo_atendimento: valor === 'sim' ? prev.cliente_solicitou_protocolo_atendimento : '',
        cliente_solicitou_observacao: valor === 'sim' ? prev.cliente_solicitou_observacao : ''
      };
    });
  }

  /**
   * Formata mensagem cnpj para exibicao ou envio.
   */
    /**
   * Monta sugestoes cnpj a partir dos dados informados.
   */
    /**
   * Atualiza cliente venda com os dados informados.
   */
  function atualizarClienteVenda(valor, clienteSelecionado = null) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    const clienteSelecionadoValido = clienteSelecionado && String(clienteSelecionado.id) === String(valor)
      ? clienteSelecionado
      : null;
    const c = clienteSelecionadoValido || clientesDisponiveis.find(cliente => String(cliente.id) === String(valor));
    const dadosCliente = montarDadosClienteVenda(c, valor);
    const documentoDigitos = sanitizarCnpj(dadosCliente.cnpj);

    setForm(prev => {
      return {
        ...prev,
        ...dadosCliente
      };
    });

    setTipoBusca(documentoDigitos.length === 11 ? 'cpf' : 'cnpj');
    setDocumentosPorTipo(documentoDigitos.length === 11
      ? { cnpj: '', cpf: dadosCliente.cnpj || '' }
      : { cnpj: dadosCliente.cnpj || '', cpf: '' });
    setCnpjStatus({ tipo: '', mensagem: '' });
    setCepStatus('');
  }

  const cnpjClienteLead = String(clientePreenchido?.cnpj || '').replace(/\D/g, '');
  const chaveClienteLead = clientesCarregados && !editando && cnpjClienteLead.length === 14
    ? `${cnpjClienteLead}:${clientesDisponiveis.length}`
    : '';
  if (!form.cliente_id && chaveClienteLead && clienteLeadProcessado !== chaveClienteLead) {
    setClienteLeadProcessado(chaveClienteLead);
    const clienteExistente = clientesDisponiveis.find(c => String(c.cnpj || '').replace(/\D/g, '') === cnpjClienteLead);
    if (clienteExistente) {
      setForm(prev => ({
        ...prev,
        ...montarDadosClienteVenda(clienteExistente, String(clienteExistente.id))
      }));
    }
    // Quando nao existe na lista, a resolucao/criacao ocorre no submit para nao
    // cadastrar um cliente caso o usuario desista da venda.
  }

  /**
   * Atualiza vendedoras venda com os dados informados.
   */
  function atualizarVendedorasVenda(ids) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario || !podeCompartilharVendaEfetivo) return;

    setForm(prev => ({ ...prev, vendedoras: ids }));
  }

  /**
   * Alterna endereco real no estado atual.
   */
  function alternarEnderecoReal(marcado) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    setForm(prev => ({
      ...prev,
      endereco_real_divergente: marcado
    }));

    if (marcado) {
      setEnderecoRealModalAberto(true);
    }
  }

  /**
   * Abre cliente solicitou quantidades e prepara o estado necessario.
   */
  function abrirClienteSolicitouQuantidades(servicos = clienteSolicitouServicos) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    const selecionados = parseClienteSolicitouServicos(servicos).filter(servico => CLIENTE_SOLICITOU_ACOES.includes(servico));
    if (selecionados.length === 0) return;

    setClienteSolicitouServicosDraft(selecionados);
    setClienteSolicitouQuantidadesDraft({
      bloqueio: selecionados.includes('bloqueio') ? String(form.cliente_solicitou_bloqueio_qtd || '') : '',
      cancelamento: selecionados.includes('cancelamento') ? String(form.cliente_solicitou_cancelamento_qtd || '') : ''
    });
    setClienteSolicitouQuantidadeAberta(true);
  }

  /**
   * Alterna cliente solicitou servico no estado atual.
   */
  function alternarClienteSolicitouServico(servico) {
    if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;

    setForm(prev => {
      const atuais = parseClienteSolicitouServicos(prev.cliente_solicitou_servicos);

      if (servico === 'nenhum_servico') {
        const selecionado = atuais.includes('nenhum_servico');
        return {
          ...prev,
          cliente_solicitou_servicos: selecionado ? [] : ['nenhum_servico'],
          cliente_solicitou_bloqueio_qtd: '',
          cliente_solicitou_cancelamento_qtd: '',
          cliente_solicitou_numeros: { bloqueio: [], cancelamento: [] },
          cliente_solicitou_resolvido: '',
          cliente_solicitou_resolvido_em: '',
          cliente_solicitou_protocolo_atendimento: '',
          cliente_solicitou_observacao: ''
        };
      }

      const semNenhum = atuais.filter(item => item !== 'nenhum_servico');
      const proximos = semNenhum.includes(servico)
        ? semNenhum.filter(item => item !== servico)
        : [...semNenhum, servico];
      const numerosAtuais = parseClienteSolicitouNumeros(prev.cliente_solicitou_numeros);

      return {
        ...prev,
        cliente_solicitou_servicos: proximos,
        cliente_solicitou_bloqueio_qtd: proximos.includes('bloqueio') ? prev.cliente_solicitou_bloqueio_qtd : '',
        cliente_solicitou_cancelamento_qtd: proximos.includes('cancelamento') ? prev.cliente_solicitou_cancelamento_qtd : '',
        cliente_solicitou_numeros: {
          bloqueio: proximos.includes('bloqueio') ? numerosAtuais.bloqueio : [],
          cancelamento: proximos.includes('cancelamento') ? numerosAtuais.cancelamento : []
        },
        cliente_solicitou_resolvido: proximos.length > 0 ? prev.cliente_solicitou_resolvido : '',
        cliente_solicitou_resolvido_em: proximos.length > 0 ? prev.cliente_solicitou_resolvido_em : '',
        cliente_solicitou_protocolo_atendimento: proximos.length > 0 ? prev.cliente_solicitou_protocolo_atendimento : '',
        cliente_solicitou_observacao: proximos.length > 0 ? prev.cliente_solicitou_observacao : ''
      };
    });
  }

  /**
   * Executa a acao de confirmar cliente solicitou quantidades mantendo o estado da tela consistente.
   */
  function confirmarClienteSolicitouQuantidades() {
    const selecionados = parseClienteSolicitouServicos(clienteSolicitouServicosDraft);
    const bloqueioQtd = selecionados.includes('bloqueio') ? Number(clienteSolicitouQuantidadesDraft.bloqueio || 0) : 0;
    const cancelamentoQtd = selecionados.includes('cancelamento') ? Number(clienteSolicitouQuantidadesDraft.cancelamento || 0) : 0;

    if (selecionados.includes('bloqueio') && bloqueioQtd <= 0) {
      setErro('Informe a quantidade de chips para bloqueio.');
      return;
    }

    if (selecionados.includes('cancelamento') && cancelamentoQtd <= 0) {
      setErro('Informe a quantidade de chips para cancelamento.');
      return;
    }

    const numerosAtuais = parseClienteSolicitouNumeros(form.cliente_solicitou_numeros);
    const numerosAjustados = {
      bloqueio: selecionados.includes('bloqueio')
        ? ajustarQuantidadeNumerosSolicitados(numerosAtuais.bloqueio, bloqueioQtd)
        : [],
      cancelamento: selecionados.includes('cancelamento')
        ? ajustarQuantidadeNumerosSolicitados(numerosAtuais.cancelamento, cancelamentoQtd)
        : []
    };

    setForm(prev => ({
      ...prev,
      cliente_solicitou_bloqueio_qtd: bloqueioQtd ? String(bloqueioQtd) : '',
      cliente_solicitou_cancelamento_qtd: cancelamentoQtd ? String(cancelamentoQtd) : '',
      cliente_solicitou_numeros: numerosAjustados
    }));
    setClienteSolicitouNumerosDraft(numerosAjustados);
    setClienteSolicitouQuantidadeAberta(false);
    setClienteSolicitouNumerosAberto(true);
  }

  /**
   * Executa a acao de confirmar cliente solicitou numeros mantendo o estado da tela consistente.
   */
  function confirmarClienteSolicitouNumeros() {
    const numeros = montarClienteSolicitouNumeros(clienteSolicitouNumerosDraft);
    const bloqueioQtd = Number(form.cliente_solicitou_bloqueio_qtd || clienteSolicitouQuantidadesDraft.bloqueio || 0);
    const cancelamentoQtd = Number(form.cliente_solicitou_cancelamento_qtd || clienteSolicitouQuantidadesDraft.cancelamento || 0);

    if (clienteSolicitouServicosDraft.includes('bloqueio') && numeros.bloqueio.length !== bloqueioQtd) return;
    if (clienteSolicitouServicosDraft.includes('cancelamento') && numeros.cancelamento.length !== cancelamentoQtd) return;

    setForm(prev => ({ ...prev, cliente_solicitou_numeros: numeros }));
    setClienteSolicitouNumerosAberto(false);
  }

  /**
   * Executa a acao de alterar tipo busca mantendo o estado da tela consistente.
   */
  function alterarTipoBusca(tipo) {
    if (tipo === tipoBusca) return;

    const documentoAtual = form.cnpj || '';
    const documentoDestino = documentosPorTipo[tipo] || '';

    setTipoBusca(tipo);
    setDocumentosPorTipo(prev => ({ ...prev, [tipoBusca]: documentoAtual }));
    setForm(prev => ({ ...prev, cnpj: documentoDestino }));
    setCnpjStatus({ tipo: '', mensagem: '' });
  }

  /**
   * Executa a acao de alterar aceite mode mantendo o estado da tela consistente.
   */
  function alterarAceiteMode(modo) {
    setAceiteMode(modo);
    if (modo === 'fixo') {
      setForm(prev => ({ ...prev, horario_aceite_inicio: '', horario_aceite_fim: '', dia_aceite_inicio: '', dia_aceite_fim: '' }));
    } else {
      setForm(prev => ({ ...prev, dia_aceite_fixo: '', horario_aceite_fixo: '' }));
    }
  }

  const abaExibida = (abaAtiva === 'arquivos' && !podeAcessarDocumentosVenda)
    || (abaAtiva === 'solicitacao' && !temClienteSolicitouAba)
    || (abaAtiva === 'cancelamento' && !vendaCancelada)
    ? 'venda'
    : abaAtiva;

  useEffect(() => {
    if (somenteVisualizacao) return;

    const cep = apenasDigitos(form.cep, 8);

    if (cep.length !== 8) return;

    let cancelado = false;

    fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then(response => {
        if (!response.ok) throw new Error('Erro ao buscar CEP.');
        return response.json();
      })
      .then(data => {
        if (cancelado) return;

        if (data.erro) {
          setCepStatus('CEP não encontrado.');
          return;
        }

        setForm(prev => ({
          ...prev,
          endereco: data.logradouro || prev.endereco,
          bairro: data.bairro || prev.bairro,
          municipio: data.localidade || prev.municipio,
          uf: data.uf || prev.uf,
          complemento: prev.complemento || data.complemento || ''
        }));
        setCepStatus('Endereço preenchido pelo CEP.');
      })
      .catch(() => {
        if (!cancelado) {
          setCepStatus('Não foi possível buscar o CEP.');
        }
      });

    return () => {
      cancelado = true;
    };
  }, [form.cep, somenteVisualizacao]);

  useEffect(() => {
    if (somenteVisualizacao) return;

    const cep = apenasDigitos(form.cep_real, 8);

    if (cep.length !== 8) return;

    let cancelado = false;

    fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then(response => {
        if (!response.ok) throw new Error('Erro ao buscar CEP.');
        return response.json();
      })
      .then(data => {
        if (cancelado) return;

        if (data.erro) {
          setCepRealStatus('CEP não encontrado.');
          return;
        }

        setForm(prev => ({
          ...prev,
          endereco_real: data.logradouro || prev.endereco_real,
          bairro_real: data.bairro || prev.bairro_real,
          municipio_real: data.localidade || prev.municipio_real,
          uf_real: data.uf || prev.uf_real,
          complemento_real: prev.complemento_real || data.complemento || ''
        }));
        setCepRealStatus('Endereço preenchido pelo CEP.');
      })
      .catch(() => {
        if (!cancelado) {
          setCepRealStatus('Não foi possível buscar o CEP.');
        }
      });

    return () => {
      cancelado = true;
    };
  }, [form.cep_real, somenteVisualizacao]);

  const chaveNumerosDerivados = `${somenteVisualizacao ? 1 : 0}:${vendaPortabilidade ? 1 : 0}:${quantidadePortabilidade}:${vendaAtivada ? 1 : 0}:${quantidadeNumerosAtivados}:${form.ddd}`;
  const [chaveNumerosAplicada, setChaveNumerosAplicada] = useState(chaveNumerosDerivados);
  if (!somenteVisualizacao && chaveNumerosAplicada !== chaveNumerosDerivados) {
    setChaveNumerosAplicada(chaveNumerosDerivados);
    setForm(prev => ({
      ...prev,
      numeros_portados: vendaPortabilidade
        ? ajustarQuantidadeNumerosPortados(prev.numeros_portados, quantidadePortabilidade, prev.ddd)
        : prev.numeros_portados,
      numeros_ativados: vendaAtivada
        ? ajustarQuantidadeNumerosPortados(prev.numeros_ativados, quantidadeNumerosAtivados, prev.ddd)
        : []
    }));
  }

  /**
   * Trata o evento de start edit.
   */
  function handleStartEdit(event) {
    event.preventDefault();
    event.stopPropagation();
    setErro('');
    setSalvando(false);
    onStartEdit();
  }

  /**
   * Trata o evento de submit.
   */
  /**
   * Salva apenas alterações da aba Documentos (flag "doc na casa") sem entrar em edição completa.
   */
  async function handleSalvarDocumentos() {
    setErro('');
    setSalvando(true);
    try {
      await onSave({ possui_doc_na_casa: form.possui_doc_na_casa });
      // onSave (salvarVenda) fecha o modal e recarrega a lista
    } catch (error) {
      setErro(error.message || 'Erro ao salvar.');
      setSalvando(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (somenteVisualizacao || vendaBloqueadaParaUsuario) {
      return;
    }

    if (modoReversao && !observacaoReversao.trim()) {
      setErro('Informe a observação da reversão.');
      setAbaAtiva('venda');
      return;
    }

    setErro('');
    setSalvando(true);

    try {
      const erroCamposObrigatorios = obterErroCamposObrigatoriosVenda(form);

      if (erroCamposObrigatorios) {
        setErro(erroCamposObrigatorios);
        setAbaAtiva('venda');
        setSalvando(false);
        return;
      }

      const dataVendaManual = normalizarDataVendaInput(form.data_venda);
      const classificacaoDataAlterada = !editando
        || Boolean(form.venda_antiga) !== normalizarIndicadorVendaAntiga(venda?.venda_antiga)
        || dataVendaManual !== toInputDate(venda?.data_venda);

      if (form.venda_antiga && classificacaoDataAlterada && !dataVendaManual) {
        setErro('Informe a data da venda antiga.');
        setAbaAtiva('venda');
        setSalvando(false);
        return;
      }

      if (form.venda_antiga && classificacaoDataAlterada && dataVendaManual >= obterDataAtualInput()) {
        setErro('A data da venda antiga deve ser anterior ao dia atual.');
        setAbaAtiva('venda');
        setSalvando(false);
        return;
      }

      let clienteIdResolvido = form.cliente_id;
      if (!clienteIdResolvido && clientePreenchido?.cnpj && typeof onResolveClient === 'function') {
        const clienteResolvido = await onResolveClient({
          ...clientePreenchido,
          nome: form.nome || clientePreenchido.nome,
          razao_social: form.razao_social || clientePreenchido.razao_social,
          cnpj: form.cnpj || clientePreenchido.cnpj,
          telefone: form.telefone || clientePreenchido.telefone,
          email: form.email || clientePreenchido.email,
          operadora_atual_id: form.operadora_atual_id || clientePreenchido.operadora_atual_id,
          quantidade_linhas: form.quantidade_linhas || clientePreenchido.quantidade_linhas
        });
        clienteIdResolvido = clienteResolvido?.id || '';
        if (clienteIdResolvido) atualizarClienteVenda(String(clienteIdResolvido), clienteResolvido);
      }

      if (!clienteIdResolvido) {
        setErro('Selecione ou cadastre o cliente deste CNPJ antes de registrar a venda.');
        setSalvando(false);
        return;
      }

      const vendedorasIds = normalizarIdsVendedorasInput(form.vendedoras);

      if (vendedorasIds.length === 0) {
        setErro('Selecione pelo menos uma vendedora para cadastrar a venda.');
        setSalvando(false);
        return;
      }

      const erroCpf = obterErroCpfVenda(form);

      if (erroCpf) {
        setErro(erroCpf);
        setSalvando(false);
        return;
      }

      if (protocoloProtegido && protocoloAtual !== protocoloOriginal) {
        setErro('Apenas ADM pode alterar ou apagar o protocolo do cliente.');
        setSalvando(false);
        return;
      }

      if (tipoBusca === 'cnpj') {
        const cnpjDigitos = sanitizarCnpj(form.cnpj);
        if (cnpjDigitos.length > 0 && cnpjDigitos.length < 14) {
          setErro('CNPJ incompleto.');
          setSalvando(false);
          return;
        }
        if (cnpjDigitos.length === 14 && !validarDigitosCnpj(cnpjDigitos)) {
          setErro('CNPJ inválido.');
          setSalvando(false);
          return;
        }
      } else {
        const cpfDigitos = sanitizarCpf(form.cnpj);
        if (cpfDigitos.length > 0 && cpfDigitos.length < 11) {
          setErro('CPF incompleto.');
          setSalvando(false);
          return;
        }
        if (cpfDigitos.length === 11 && !validarCpf(cpfDigitos)) {
          setErro('CPF inválido.');
          setSalvando(false);
          return;
        }
      }

      const numerosPortados = montarNumerosPortados(form.numeros_portados);
      const numerosAtivados = montarNumerosAtivados(form.numeros_ativados);
      const quantidadeChips = somarQuantidadeItensChips(form.valores_unitarios_chips || []);
      const vendedorasUsadasNosChips = new Set(
        (form.valores_unitarios_chips || [])
          .filter(item => Number(item.quantidade || 0) > 0)
          .map(item => String(item.vendedora_id || ''))
          .filter(Boolean)
      );
      const vendedorasSemChips = vendedorasIds.length > 1
        ? vendedorasIds.filter(id => !vendedorasUsadasNosChips.has(String(id)))
        : [];

      if (quantidadeLinhasFechadas > 0 && quantidadeChips > quantidadeLinhasFechadas) {
        setErro('A quantidade de chips não pode ser maior que a quantidade de linhas fechadas.');
        setSalvando(false);
        return;
      }

      if (quantidadeLinhasFechadas > 0 && quantidadeChips < quantidadeLinhasFechadas) {
        setErro(`A quantidade de chips (${quantidadeChips}) é menor que a quantidade de linhas contratadas (${quantidadeLinhasFechadas}).`);
        setSalvando(false);
        return;
      }

      if (vendedorasSemChips.length > 0) {
        const nomes = vendedorasSemChips
          .map(id => vendedorasOpcoesModal.find(v => Number(v.id) === Number(id))?.nome)
          .filter(Boolean)
          .join(', ');
        setErro(`Atribua pelo menos um chip para cada vendedora da venda${nomes ? `: ${nomes}` : '.'}`);
        setSalvando(false);
        return;
      }

      if (vendaPortabilidade && !numerosPortados) {
        setErro('Informe pelo menos um número a ser portado.');
        setSalvando(false);
        return;
      }

      const servicosSolicitados = parseClienteSolicitouServicos(form.cliente_solicitou_servicos);

      if (servicosSolicitados.length === 0) {
        setErro('Informe o que o cliente solicitou (Bloqueio, Cancelamento ou Nenhum serviço).');
        setSalvando(false);
        return;
      }
      const solicitouNenhumServico = servicosSolicitados.includes('nenhum_servico');
      const solicitouBloqueio = servicosSolicitados.includes('bloqueio');
      const solicitouCancelamento = servicosSolicitados.includes('cancelamento');
      const bloqueioQtd = solicitouBloqueio ? Number(form.cliente_solicitou_bloqueio_qtd || 0) : 0;
      const cancelamentoQtd = solicitouCancelamento ? Number(form.cliente_solicitou_cancelamento_qtd || 0) : 0;
      const numerosSolicitados = montarClienteSolicitouNumeros(form.cliente_solicitou_numeros);

      if (solicitouBloqueio && bloqueioQtd <= 0) {
        setErro('Informe a quantidade de chips para bloqueio.');
        setSalvando(false);
        return;
      }

      if (solicitouCancelamento && cancelamentoQtd <= 0) {
        setErro('Informe a quantidade de chips para cancelamento.');
        setSalvando(false);
        return;
      }

      if (solicitouBloqueio && numerosSolicitados.bloqueio.length !== bloqueioQtd) {
        setErro('Preencha exatamente a quantidade de números de bloqueio informada.');
        setSalvando(false);
        return;
      }

      if (solicitouCancelamento && numerosSolicitados.cancelamento.length !== cancelamentoQtd) {
        setErro('Preencha exatamente a quantidade de números de cancelamento informada.');
        setSalvando(false);
        return;
      }

      const clienteSolicitouResolvido = ['sim', 'nao'].includes(form.cliente_solicitou_resolvido)
        ? form.cliente_solicitou_resolvido
        : null;

      if (!solicitouNenhumServico && clienteSolicitouResolvido === 'sim') {
        if (!normalizarDataVendaInput(form.cliente_solicitou_resolvido_em)) {
          setErro('Informe a data de resolução da solicitação do cliente.');
          setAbaAtiva('solicitacao');
          setSalvando(false);
          return;
        }

        if (!String(form.cliente_solicitou_protocolo_atendimento || '').trim()) {
          setErro('Informe o protocolo de atendimento da solicitação do cliente.');
          setAbaAtiva('solicitacao');
          setSalvando(false);
          return;
        }

        if (!String(form.cliente_solicitou_observacao || '').trim()) {
          setErro('Informe a observação da solicitação do cliente.');
          setAbaAtiva('solicitacao');
          setSalvando(false);
          return;
        }
      }

      const chipsProcessados = (form.valores_unitarios_chips || [])
        .map(item => ({
          quantidade: Number(item.quantidade || 0),
          gb: String(item.gb || '').trim(),
          tipo_linha: normalizarTipoLinhaChip(item.tipo_linha),
          valor_unitario: parseValorInput(item.valor_unitario),
          ...(item.operadora_atual_id
            ? {
              operadora_atual_id: Number(item.operadora_atual_id),
              operadora_atual_nome: operadoras.find(operadora => Number(operadora.id) === Number(item.operadora_atual_id))?.nome || ''
            }
            : {}),
          ...(item.operadora_id
            ? {
              operadora_id: Number(item.operadora_id),
              operadora_nome: operadoras.find(operadora => Number(operadora.id) === Number(item.operadora_id))?.nome || ''
            }
            : {}),
          ...(item.vendedora_id ? { vendedora_id: Number(item.vendedora_id) } : {})
        }))
        .filter(item => item.quantidade > 0 && item.valor_unitario > 0);

      const dataAtivacaoPayload = vendaEmEtapaFinal
        ? normalizarDataVendaInput(form.data_ativacao) || null
        : undefined;
      // A venda ainda mantém as referências legadas no nível principal. Elas são
      // derivadas do primeiro item que as informa, enquanto cada chip preserva
      // sua própria operadora.
      const operadoraDestinoVenda = chipsProcessados.find(item => item.operadora_id)?.operadora_id || '';
      const operadoraAtualVenda = chipsProcessados.find(item => item.operadora_atual_id)?.operadora_atual_id || '';

      const payload = {
        ...form,
        cliente_id: clienteIdResolvido,
        operadora_id: operadoraDestinoVenda,
        operadora_atual_id: operadoraAtualVenda,
        venda_antiga: Boolean(form.venda_antiga),
        data_venda: form.venda_antiga ? dataVendaManual : null,
        data_ativacao: vendaEmEtapaFinal ? dataAtivacaoPayload : undefined,
        numeros_portados: vendaPortabilidade ? numerosPortados : null,
        numeros_ativados: vendaEmEtapaFinal ? (dataAtivacaoPayload ? numerosAtivados : null) : undefined,
        valores_unitarios_chips: chipsProcessados,
        cliente_solicitou_servicos: solicitouNenhumServico ? ['nenhum_servico'] : servicosSolicitados,
        cliente_solicitou_bloqueio_qtd: solicitouNenhumServico || !solicitouBloqueio ? null : bloqueioQtd,
        cliente_solicitou_cancelamento_qtd: solicitouNenhumServico || !solicitouCancelamento ? null : cancelamentoQtd,
        cliente_solicitou_numeros: solicitouNenhumServico ? { bloqueio: [], cancelamento: [] } : {
          bloqueio: solicitouBloqueio ? numerosSolicitados.bloqueio : [],
          cancelamento: solicitouCancelamento ? numerosSolicitados.cancelamento : []
        },
        cliente_solicitou_resolvido: solicitouNenhumServico ? null : clienteSolicitouResolvido,
        cliente_solicitou_resolvido_em: !solicitouNenhumServico && clienteSolicitouResolvido === 'sim'
          ? normalizarDataVendaInput(form.cliente_solicitou_resolvido_em)
          : null,
        cliente_solicitou_protocolo_atendimento: !solicitouNenhumServico && clienteSolicitouResolvido === 'sim'
          ? String(form.cliente_solicitou_protocolo_atendimento || '').trim()
          : null,
        cliente_solicitou_observacao: !solicitouNenhumServico && clienteSolicitouResolvido === 'sim'
          ? String(form.cliente_solicitou_observacao || '').trim()
          : null,
        vendedoras: vendedorasIds
      };

      payload.valor_total = calcularTotalItensChips(form.valores_unitarios_chips);
      payload.gb = resumirGigasItensChips(payload.valores_unitarios_chips);

      // Limpar rascunho após sucesso
      if (!venda?.id) {
        localStorage.removeItem(`form_draft_${draftKey}`);
      }

      const notasParaCriar = !venda?.id ? pendingNotas : [];
      const arquivosParaCriar = !venda?.id ? pendingArquivos : [];
      if (modoReversao) {
        await onSaveReversal(payload, observacaoReversao.trim(), venda?.updated_at);
      } else {
        await onSave(payload, notasParaCriar, arquivosParaCriar);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao salvar venda.');
      setSalvando(false);
    }
  }

  /**
   * Trata o evento de enviar pos venda.
   */
  async function enviarParaPosVenda(dadosLiberacao = {}) {
    setErro('');
    setSalvando(true);
    try {
      await onSendToPosVenda(venda, dadosLiberacao);
    } catch (error) {
      setErro(error.message || 'Erro ao enviar venda para o pós-venda.');
      setSalvando(false);
    }
  }

  async function handleEnviarPosVenda() {
    if (!venda?.id || salvando || enviadaPosVenda) return;
    if (requerLiberacao && !ignorarSolicitacaoLiberacao) {
      const nomes = vendedorasDaVenda.map(item => item.nome).filter(Boolean);
      setMotivoLiberacao(nomes.length > 0 ? 'Venda compartilhada entre ' + nomes.join(' e ') + '.' : 'Venda compartilhada.');
      setLiberacaoAberta(true);
      return;
    }
    await enviarParaPosVenda();
  }

  async function confirmarLiberacao() {
    if (!motivoLiberacao.trim() || salvando) return;
    setLiberacaoAberta(false);
    await enviarParaPosVenda({ motivo_descricao: motivoLiberacao });
  }

  async function handleReenviarDashboard() {
    if (!venda?.id || !onRetryDashboard || reenviandoDashboard) return;
    setReenviandoDashboard(true);
    setErro('');
    try {
      const resultado = await onRetryDashboard(venda);
      if (resultado?.status === 'erro') {
        setErro(resultado.mensagem || 'Não foi possível enviar a venda ao dashboard.');
      }
    } catch (error) {
      setErro(error.message || 'Não foi possível reenviar a venda ao dashboard.');
    } finally {
      setReenviandoDashboard(false);
    }
  }

  if (venda?.visao_resumida_consultora) {
    const exibindoProblema = initialTab === 'problema';
    return (
      <div className="modal-overlay">
        <section className="modal venda-modal venda-resumo-consultora-modal" role="dialog" aria-modal="true" aria-label={exibindoProblema ? 'Problemas da venda' : 'Resumo da venda'}>
          <div className="modal-header">
            <div className="modal-header-row">
              <div>
                <div className="modal-client">{exibindoProblema ? 'Problemas da venda' : 'Resumo da venda'}</div>
                <div className="modal-sub">
                  {exibindoProblema
                    ? 'Acompanhe e responda às correções solicitadas pelo pós-venda.'
                    : 'Após o envio ao pós-venda, ficam disponíveis apenas as informações comerciais abaixo.'}
                </div>
              </div>
              <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={handleClose}>
                <I.Close size={14} />
              </button>
            </div>
          </div>
          <div className="modal-body venda-resumo-consultora-modal__body">
            <VendaResumoConsultora venda={venda} />
            {exibindoProblema && (
              <div className="venda-resumo-consultora__problemas">
                <VendaProblemaPanel venda={venda} usuario={usuarioLogado} initialProblemaId={initialProblemaId} />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={handleClose}>Fechar</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <form className="modal venda-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div className="modal-client">{venda ? ((somenteVisualizacao || vendaBloqueadaParaUsuario) ? 'Visualizar venda' : 'Editar venda') : 'Nova venda'}</div>
              <div className="modal-sub">
                {vendaBloqueadaParaUsuario
                  ? 'Venda enviada ao pós-venda. Apenas a equipe de pós-venda pode editar.'
                  : somenteVisualizacao
                  ? 'Revise os dados cadastrados antes de editar.'
                  : 'Selecione o cliente e preencha apenas os dados específicos da venda.'}
              </div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={handleClose}>
              <I.Close size={14} />
            </button>
          </div>
        </div>

        {venda?.integracao_dashboard && (
          <div className={venda.integracao_dashboard.status === 'enviada' ? 'alert-success' : 'alert-error'} style={{ margin: '12px 16px 0' }}>
            <strong>Dashboard: {venda.integracao_dashboard.status === 'enviada' ? 'venda enviada.' : 'envio não concluído.'}</strong>
            {venda.integracao_dashboard.status !== 'enviada' && venda.integracao_dashboard.mensagem && (
              <span> {venda.integracao_dashboard.mensagem}</span>
            )}
            {venda.integracao_dashboard.pode_reenviar_manualmente && podeEditarVendaEfetivo && (
              <button type="button" className="btn btn-sm" style={{ marginLeft: 12 }} onClick={handleReenviarDashboard} disabled={reenviandoDashboard}>
                {reenviandoDashboard ? 'Enviando...' : 'Enviar ao dashboard'}
              </button>
            )}
          </div>
        )}

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${abaExibida === 'venda' ? 'active' : ''}`}
            onClick={() => setAbaAtiva('venda')}
          >
            <I.Chart size={14} /> Venda
          </button>
          {temClienteSolicitouAba && (
            <button
              type="button"
              className={`modal-tab ${abaExibida === 'solicitacao' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('solicitacao')}
            >
              <I.Check size={14} /> Pós Venda
            </button>
          )}
          <button
            type="button"
            className={`modal-tab ${abaExibida === 'notas' ? 'active' : ''}`}
            onClick={() => setAbaAtiva('notas')}
          >
            <I.Note size={14} /> Notas{!venda?.id && pendingNotas.length > 0 && ` (${pendingNotas.length})`}
          </button>
          {podeAcessarDocumentosVenda && (
            <button
              type="button"
              className={`modal-tab ${abaExibida === 'arquivos' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('arquivos')}
            >
              <I.Folder size={14} /> Documentos{!venda?.id && pendingArquivos.length > 0 && ` (${pendingArquivos.length})`}
            </button>
          )}
          {vendaCancelada && (
            <button
              type="button"
              className={`modal-tab ${abaExibida === 'cancelamento' ? 'active' : ''}`}
              onClick={() => setAbaAtiva('cancelamento')}
            >
              <I.AlertTriangle size={14} /> Cancelamento
            </button>
          )}
          <button
            type="button"
            className={`modal-tab ${abaExibida === 'problema' ? 'active' : ''}`}
            onClick={() => setAbaAtiva('problema')}
          >
            <I.AlertTriangle size={14} /> Problema
          </button>
        </div>


        {motivoLiberacaoAprovacao && (
          <div className="venda-pos-venda-banner" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            <I.Note size={14} />
            <span><strong>Motivo da liberação:</strong> {motivoLiberacaoAprovacao}</span>
          </div>
        )}

        {erro && (abaExibida === 'venda' || abaExibida === 'solicitacao') && (
          <div className="venda-modal-alert" role="alert" aria-live="assertive">
            <div className="venda-modal-alert__icon">
              <I.AlertTriangle size={16} />
            </div>
            <div className="venda-modal-alert__content">
              <strong>Não foi possível salvar a venda</strong>
              <span>{erro}</span>
            </div>
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              onClick={() => setErro('')}
              title="Fechar aviso"
            >
              <I.Close size={13} />
            </button>
          </div>
        )}

        <div className="modal-body" ref={modalBodyRef}>
          <div className="venda-modal-tabpanel" key={abaExibida}>
          {abaExibida === 'notas' ? (
            <NotasEntidadeTab
              tipo="venda"
              entidadeId={venda?.id}
              pendingNotas={pendingNotas}
              onPendingNotasChange={setPendingNotas}
            />
          ) : abaExibida === 'solicitacao' && temClienteSolicitouAba ? (
            <ClienteSolicitouResolucaoTab
              form={form}
              onChange={atualizarResolucaoClienteSolicitou}
              disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
            />
          ) : abaExibida === 'arquivos' && podeAcessarDocumentosVenda ? (
            <ArquivosVendaTab
              venda={venda}
              podeEditar={podeEditarVendaEfetivo}
              podeVisualizar={podeVerDocumentosVenda}
              podeAdicionar={podeAdicionarDocumentosVendaEfetivo}
              pendingArquivos={pendingArquivos}
              onPendingArquivosChange={setPendingArquivos}
              onEtapasAtualizadas={onEtapasAtualizadas}
              possuiDocNaCasa={form.possui_doc_na_casa}
              onPossuiDocNaCasaChange={valor => {
                setForm(f => ({ ...f, possui_doc_na_casa: valor }));
                setDocsAlterados(true);
              }}
              onArquivosAlterados={() => setDocsAlterados(true)}
            />
          ) : abaExibida === 'cancelamento' && vendaCancelada ? (
            <VendaCancelamentoTab venda={venda || form} />
          ) : abaExibida === 'problema' ? (
            <VendaProblemaPanel venda={venda} usuario={usuarioLogado} initialProblemaId={initialProblemaId} />
          ) : (
          <>
            {enviadaPosVenda && (
              <div className="venda-pos-venda-banner">
                <I.Check size={14} />
                <span>Enviada para o pós-venda</span>
              </div>
            )}
            <fieldset
              className={`venda-readonly-fieldset ${(somenteVisualizacao || vendaBloqueadaParaUsuario) ? 'is-readonly' : ''}`}
              aria-disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
            >
            <div className="vendas-form-grid">
            {CAMPOS.map(campo => {
              if (campo.section) {
                return <div key={campo.section} className="vendas-form-section">{campo.section}</div>;
              }

              if (campo.name === 'numeros_portados' && !vendaPortabilidade) {
                return null;
              }

              if (campo.name === 'data_ativacao' && !vendaEmEtapaFinal) {
                return null;
              }

              if (campo.name === 'numeros_ativados' && (!vendaEmEtapaFinal || !vendaAtivada)) {
                return null;
              }

              if (campo.name === 'tipo_local_cpf' && tipoBusca !== 'cpf') {
                return null;
              }

              const labelCampo = campo.type === 'responsaveis'
                ? 'Responsáveis pelo recebimento'
                : campo.label;
              const erroCpfCampo = obterErroCpfCampo(campo.name, form[campo.name]);
              const hintCpfId = erroCpfCampo ? `venda-${campo.name}-erro` : undefined;

              return (
                <div key={campo.name} className={`form-field ${campo.span ? 'span-2' : ''} ${erroCpfCampo ? 'is-invalid' : ''} ${campoPossuiReversao(campo.name) ? 'has-reversal-history' : ''}`}>
                  {labelCampo && !['realAddressToggle', 'oldSale'].includes(campo.type) && <label>{renderizarLabelCampo(campo.name, labelCampo, campo.required)}</label>}
                  {campo.type === 'client' ? (
                      <ClienteVendaSelect
                        key={form[campo.name] || 'sem-cliente'}
                        value={form[campo.name] ?? ''}
                        clientes={clientesDisponiveis}
                        vendasRegistradas={vendasRegistradasClienteSelecionado}
                        vendasEmAndamento={vendasEmAndamentoClienteSelecionado}
                        clienteBaseAnterior={clienteBaseAnteriorSelecionado}
                        onChange={atualizarClienteVenda}
                        onCreateClient={async () => {
                          const clienteCriado = await onCreateClient?.(clientePreenchido);
                          if (clienteCriado?.id) {
                            atualizarClienteVenda(String(clienteCriado.id), clienteCriado);
                          }
                        }}
                      />
                  ) : campo.type === 'cnpj' ? (
                    <>
                      <div className="doc-tipo-toggle">
                        <button type="button" className={`btn btn-sm${tipoBusca === 'cnpj' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => alterarTipoBusca('cnpj')}>CNPJ</button>
                        <button type="button" className={`btn btn-sm${tipoBusca === 'cpf' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => alterarTipoBusca('cpf')}>CPF</button>
                      </div>
                      {tipoBusca === 'cnpj' ? (
                        <>
                          <div className="cnpj-input-row">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={18}
                              value={form[campo.name] ?? ''}
                              onChange={e => atualizarCampo(campo.name, e.target.value)}
                              placeholder="00.000.000/0000-00"
                            />
                          </div>
                          {cnpjStatus.mensagem && (
                            <span className={`field-hint cnpj-lookup-status ${cnpjStatus.tipo}`}>
                              {cnpjStatus.mensagem}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={14}
                            value={form[campo.name] ?? ''}
                            onChange={e => {
                              if (somenteVisualizacao || vendaBloqueadaParaUsuario) return;
                              const cpfFormatado = formatarCpf(e.target.value);
                              setDocumentosPorTipo(prev => ({ ...prev, cpf: cpfFormatado }));
                              setForm(prev => ({ ...prev, cnpj: cpfFormatado }));
                            }}
                            placeholder="000.000.000-00"
                          />
                          {(() => {
                            const digitos = sanitizarCpf(form[campo.name] || '');
                            if (digitos.length > 0 && digitos.length < 11) return <span className="field-hint field-hint--error">CPF incompleto</span>;
                            if (digitos.length === 11 && !validarCpf(digitos)) return <span className="field-hint field-hint--error">CPF inválido</span>;
                            return null;
                          })()}
                        </>
                      )}
                    </>
                  ) : campo.type === 'sellers' ? (
                    <VendedorasSelect
                      value={form.vendedoras || []}
                      options={vendedorasOpcoesModal}
                      onChange={atualizarVendedorasVenda}
                      idProtegido={!temPermissao(usuarioLogado, 'vendas_atribuir_qualquer_vendedor') && vendedorasOpcoesModal?.some(v => String(v.id) === String(usuarioLogado?.id)) ? usuarioLogado?.id : null}
                      disabled={!podeAlterarVendedorasVenda}
                    />
                  ) : campo.type === 'aceiteRange' ? (
                    <div className="aceite-bloco">
                      <div className="aceite-bloco__toggle">
                        <button type="button" className={`btn btn-sm${aceiteMode === 'janela' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => !somenteVisualizacao && !vendaBloqueadaParaUsuario && alterarAceiteMode('janela')}>Janela</button>
                        <button type="button" className={`btn btn-sm${aceiteMode === 'fixo' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => !somenteVisualizacao && !vendaBloqueadaParaUsuario && alterarAceiteMode('fixo')}>Horário fixo</button>
                      </div>
                      {aceiteMode === 'janela' ? (
                        <div className="aceite-bloco__janela">
                          <div className="aceite-bloco__row">
                            <span className="aceite-bloco__row-label">Dias</span>
                            <div className="aceite-bloco__inputs">
                              <SelectFiltro
                                value={form.dia_aceite_inicio || ''}
                                onChange={val => atualizarCampo('dia_aceite_inicio', val)}
                                placeholder="Selecione"
                                options={DIAS_SEMANA}
                                className="sf--flex1"
                              />
                              <span className="aceite-bloco__sep">até</span>
                              <SelectFiltro
                                value={form.dia_aceite_fim || ''}
                                onChange={val => atualizarCampo('dia_aceite_fim', val)}
                                placeholder="Selecione"
                                options={DIAS_SEMANA}
                                className="sf--flex1"
                              />
                            </div>
                          </div>
                          <div className="aceite-bloco__row">
                            <span className="aceite-bloco__row-label">Horário</span>
                            <div className="aceite-bloco__inputs">
                              <input type="time" value={form.horario_aceite_inicio || ''} onChange={e => atualizarCampo('horario_aceite_inicio', e.target.value)} />
                              <span className="aceite-bloco__sep">até</span>
                              <input type="time" value={form.horario_aceite_fim || ''} onChange={e => atualizarCampo('horario_aceite_fim', e.target.value)} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="aceite-bloco__fixo">
                          <SelectFiltro
                            value={form.dia_aceite_fixo || ''}
                            onChange={val => atualizarCampo('dia_aceite_fixo', val)}
                            placeholder="Selecione o dia"
                            options={DIAS_SEMANA}
                            className="sf--flex15"
                          />
                          <span className="aceite-bloco__sep">às</span>
                          <input type="time" value={form.horario_aceite_fixo || ''} onChange={e => atualizarCampo('horario_aceite_fixo', e.target.value)} />
                        </div>
                      )}
                    </div>
                  ) : campo.type === 'responsaveis' ? (
                    <ResponsaveisRecebimentoInput form={form} onChange={atualizarCampo} />
                  ) : campo.type === 'closedWith' ? (
                    <SelectFiltro
                      value={FECHOU_VENDA_OPCOES.some(opcao => opcao.value === form[campo.name]) ? form[campo.name] : ''}
                      onChange={val => atualizarCampo(campo.name, val)}
                      placeholder="Selecione"
                      options={FECHOU_VENDA_OPCOES}
                    />
                  ) : ['operator', 'saleType', 'service'].includes(campo.type) ? (
                    <SelectFiltro
                      value={form[campo.name] != null ? String(form[campo.name]) : ''}
                      onChange={val => atualizarCampo(campo.name, val)}
                      placeholder="Selecione"
                      options={campo.type === 'service'
                        ? agruparOpcoesServicos(servicos, { valueMode: 'canonical' })
                        : (
                          campo.type === 'operator'
                            ? operadoras
                            : tiposVenda
                        ).map(item => ({ value: String(item.id), label: item.nome }))}
                    />
                  ) : campo.type === 'serviceType' ? (
                    <TiposServicoInput
                      value={form[campo.name]}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                    />
                  ) : campo.type === 'chips' ? (
                    <ItensChipsInput
                      value={form[campo.name]}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                      operadoras={operadoras}
                      vendedoras={vendedorasOpcoesModal.filter(v => (form.vendedoras || []).includes(String(v.id)))}
                      limiteQuantidade={form.quantidade_linhas}
                      tiposServico={form.tipos_servico}
                    />
                  ) : campo.type === 'oldSale' ? (
                    <div className="venda-old-sale-control">
                      {campoPossuiReversao(campo.name) && renderizarLabelCampo(campo.name, campo.label)}
                      <label className="venda-old-sale-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(form.venda_antiga)}
                          onChange={event => atualizarVendaAntiga(event.target.checked)}
                          disabled={!podeCorrigirDataVenda}
                        />
                        <span>Venda antiga</span>
                      </label>
                      {form.venda_antiga ? (
                        <div className="venda-old-sale-date">
                          <label htmlFor="venda-data-antiga">Data da venda <span className="field-required-mark">*</span></label>
                          <input
                            id="venda-data-antiga"
                            type="date"
                            max={obterDataAnteriorInput()}
                            value={form.data_venda || ''}
                            onChange={event => atualizarCampo('data_venda', event.target.value)}
                            disabled={!podeCorrigirDataVenda}
                            required
                          />
                          <span className="field-hint">A data deve ser anterior ao dia atual.</span>
                        </div>
                      ) : (
                        <span className="field-hint">
                          {editando && form.data_venda
                            ? `Data registrada automaticamente: ${formatarData(form.data_venda)}`
                            : 'A data da venda será definida automaticamente ao salvar.'}
                        </span>
                      )}
                    </div>
                  ) : campo.type === 'clientBase' ? (
                    <ClienteDaBaseInput
                      value={form[campo.name]}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                      disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
                    />
                  ) : campo.type === 'clientRequested' ? (
                    <ClienteSolicitouInput
                      form={form}
                      onToggle={alternarClienteSolicitouServico}
                      onOpenQuantidades={() => abrirClienteSolicitouQuantidades()}
                    />
                  ) : campo.type === 'realAddressToggle' ? (
                    <div className="venda-address-toggle">
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(form.endereco_real_divergente)}
                          onChange={e => alternarEnderecoReal(e.target.checked)}
                          disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
                        />
                        {renderizarLabelCampo(campo.name, campo.label)}
                      </label>
                      {form.endereco_real_divergente && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEnderecoRealModalAberto(true)}
                        >
                          Editar endereço real
                        </button>
                      )}
                    </div>
                  ) : campo.type === 'portedNumbers' ? (
                    <NumerosPortadosInput
                      value={form[campo.name]}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                      quantidadeEsperada={quantidadePortabilidade}
                      dddPadrao={form.ddd}
                    />
                  ) : campo.type === 'activatedNumbers' ? (
                    <NumerosAtivadosInput
                      value={form[campo.name]}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                      quantidadeEsperada={quantidadeNumerosAtivados}
                      dddPadrao={form.ddd}
                    />
                  ) : campo.name === 'protocolo' ? (
                    <>
                      <div className="protocolo-input-row">
                        <input
                          type="text"
                          value={form[campo.name] ?? ''}
                          onChange={e => atualizarCampo(campo.name, e.target.value)}
                          readOnly={protocoloBloqueado}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => atualizarCampo('protocolo', gerarProtocoloDataHora())}
                          disabled={!podeGerarProtocolo}
                        >
                          Gerar
                        </button>
                      </div>
                      {dicaProtocolo && <span className="field-hint">{dicaProtocolo}</span>}
                    </>
                  ) : campo.type === 'tipoLocalCpf' ? (
                    <TipoLocalCpfInput
                      value={form[campo.name] ?? ''}
                      onChange={valor => atualizarCampo(campo.name, valor)}
                      disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
                    />
                  ) : campo.type === 'longText' ? (
                    <AutoResizeTextarea
                      value={form[campo.name] ?? ''}
                      onChange={e => atualizarCampo(campo.name, e.target.value)}
                      maxRows={campo.maxRows || 5}
                    />
                  ) : (
                    <input
                      type={campo.type || 'text'}
                      step={campo.step}
                      min={campo.min}
                      max={campo.name === 'data_venda' ? obterDataAtualInput() : campo.max}
                      maxLength={getMaxLengthCampo(campo.name, campo.maxLength)}
                      inputMode={getInputModeCampo(campo.name)}
                      value={form[campo.name] ?? ''}
                      onChange={e => atualizarCampo(campo.name, e.target.value)}
                      placeholder={campo.placeholder}
                      required={campo.required}
                      aria-invalid={erroCpfCampo ? 'true' : undefined}
                      aria-describedby={hintCpfId}
                    />
                  )}
                  {erroCpfCampo && (
                    <span id={hintCpfId} className="field-hint field-hint--error">{erroCpfCampo}</span>
                  )}
                  {campo.name === 'cep' && cepStatus && (
                    <span className="field-hint">{cepStatus}</span>
                  )}
                  {campo.name === 'observacoes' && (
                    <section className="venda-reversoes-observacoes">
                      <div className="venda-reversoes-title">Observações de reversão</div>
                      {reversoesVenda.length === 0 ? (
                        <p className="venda-reversoes-empty">Nenhuma reversão registrada.</p>
                      ) : reversoesVenda.map(reversao => (
                        <article key={reversao.id} className="venda-reversao-observacao">
                          <div className="venda-reversao-observacao-head">
                            {reversao.created_at && <time>{formatarDataHora(reversao.created_at)}</time>}
                            {podeExcluirReversaoEfetivo && (
                              <button
                                type="button"
                                className="btn btn-icon btn-ghost venda-reversao-delete-btn"
                                title={`Excluir Reversão ${reversao.numero}`}
                                aria-label={`Excluir Reversão ${reversao.numero}`}
                                onClick={() => setReversaoParaExcluir(reversao)}
                              >
                                <I.Trash size={13} />
                              </button>
                            )}
                          </div>
                          <strong>Reversão {reversao.numero}</strong>
                          <p>{reversao.observacao}</p>
                        </article>
                      ))}
                      {modoReversao && (
                        <div className="venda-reversao-nova-observacao">
                          <label htmlFor="venda-observacao-reversao">Nova observação de reversão <span className="field-required-mark">*</span></label>
                          <AutoResizeTextarea
                            id="venda-observacao-reversao"
                            value={observacaoReversao}
                            onChange={event => setObservacaoReversao(event.target.value)}
                            maxLength={5000}
                            maxRows={6}
                            placeholder="Explique o motivo e o contexto desta reversão"
                          />
                        </div>
                      )}
                    </section>
                  )}
                </div>
              );
            })}
          </div>
          </fieldset>

          </>
          )}
          </div>
        </div>

        {clienteSolicitouQuantidadeAberta && (
          <ClienteSolicitouQuantidadeModal
            servicos={clienteSolicitouServicosDraft}
            quantidades={clienteSolicitouQuantidadesDraft}
            onChange={(tipo, valor) => setClienteSolicitouQuantidadesDraft(prev => ({ ...prev, [tipo]: valor }))}
            onClose={() => setClienteSolicitouQuantidadeAberta(false)}
            onConfirm={confirmarClienteSolicitouQuantidades}
          />
        )}

        {clienteSolicitouNumerosAberto && (
          <ClienteSolicitouNumerosModal
            servicos={clienteSolicitouServicosDraft}
            quantidades={{
              bloqueio: form.cliente_solicitou_bloqueio_qtd || clienteSolicitouQuantidadesDraft.bloqueio,
              cancelamento: form.cliente_solicitou_cancelamento_qtd || clienteSolicitouQuantidadesDraft.cancelamento
            }}
            numeros={clienteSolicitouNumerosDraft}
            onChange={setClienteSolicitouNumerosDraft}
            onClose={() => {
              setClienteSolicitouNumerosAberto(false);
              setClienteSolicitouQuantidadeAberta(true);
            }}
            onConfirm={confirmarClienteSolicitouNumeros}
          />
        )}

        {enderecoRealModalAberto && (
          <div className="modal-overlay" role="dialog" aria-modal="true" onClick={event => event.target === event.currentTarget && setEnderecoRealModalAberto(false)}>
            <div className="modal venda-address-modal">
              <div className="modal-header">
                <div className="modal-header-row">
                  <div>
                    <div className="modal-client">Endereço real</div>
                    <div className="modal-sub">Fica salvo na venda sem substituir o endereço da Receita.</div>
                  </div>
                  <button
                    className="btn btn-icon btn-ghost"
                    type="button"
                    onClick={() => setEnderecoRealModalAberto(false)}
                    title="Fechar"
                  >
                    <I.Close />
                  </button>
                </div>
              </div>

              <div className="modal-body">
                <div className="vendas-form-grid venda-address-modal__grid">
                  {CAMPOS_ENDERECO_REAL_VENDA.map(campo => (
                    <div key={campo.name} className={`form-field ${campo.span ? 'span-2' : ''} ${campoPossuiReversao(campo.name) ? 'has-reversal-history' : ''}`}>
                      <label>{renderizarLabelCampo(campo.name, campo.label)}</label>
                      {campo.type === 'longText' ? (
                        <AutoResizeTextarea
                          value={form[campo.name] ?? ''}
                          onChange={e => atualizarCampo(campo.name, e.target.value)}
                          maxRows={3}
                          disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
                        />
                      ) : (
                        <input
                          value={form[campo.name] ?? ''}
                          onChange={e => atualizarCampo(campo.name, e.target.value)}
                          maxLength={getMaxLengthCampo(campo.name, campo.maxLength)}
                          inputMode={getInputModeCampo(campo.name)}
                          disabled={somenteVisualizacao || vendaBloqueadaParaUsuario}
                        />
                      )}
                      {campo.name === 'cep_real' && cepRealStatus && (
                        <span className="field-hint">{cepRealStatus}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn btn-primary" type="button" onClick={() => setEnderecoRealModalAberto(false)}>
                  Concluir
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer">
          {abaExibida === 'problema' || abaExibida === 'cancelamento' ? (
            <>
              {podeRegistrarReversaoEfetivo && (
                <button type="button" className="btn venda-reversao-btn" onClick={iniciarReversao}>
                  <I.History size={14} /> Registrar Reversão
                </button>
              )}
              <button type="button" className="btn" onClick={handleClose}>Fechar</button>
            </>
          ) : (somenteVisualizacao || vendaBloqueadaParaUsuario) ? (
            <>
              <button type="button" className="btn" onClick={handleClose}>Fechar</button>
              {podeRegistrarReversaoEfetivo && !podeEditarVendaEfetivo && (
                <button type="button" className="btn venda-reversao-btn" disabled={salvando || docsAlterados} onClick={iniciarReversao}>
                  <I.History size={14} /> Registrar Reversão
                </button>
              )}
              {podeEditarVendaEfetivo && !enviadaPosVenda && (
                <button type="button" className="btn venda-pos-venda-send-btn" disabled={salvando} onClick={handleEnviarPosVenda}>
                  <I.ArrowRight size={14} /> {salvando ? 'Aguarde...' : sendToPosVendaLabel}
                </button>
              )}
              {podeRegistrarReversaoEfetivo && podeEditarVendaEfetivo && (
                <button type="button" className="btn venda-reversao-btn" disabled={salvando || docsAlterados} onClick={iniciarReversao}>
                  <I.History size={14} /> Registrar Reversão
                </button>
              )}
              {podeEditarVendaEfetivo && !vendaBloqueadaParaUsuario && (
                docsAlterados ? (
                  <button type="button" className="btn btn-primary" disabled={salvando} onClick={handleSalvarDocumentos}>
                    {salvando ? 'Salvando...' : 'Salvar venda'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={handleStartEdit}>
                    <I.Edit size={14} /> Editar venda
                  </button>
                )
              )}
            </>
          ) : (
            <>
              {!editando && (
                <button type="button" className="btn btn-ghost" onClick={limparDadosVenda} disabled={salvando}>
                  <I.Trash size={14} /> Limpar Dados
                </button>
              )}
              <button type="button" className="btn" onClick={handleClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={salvando}>
                {salvando ? 'Salvando...' : modoReversao ? 'Salvar reversão' : 'Salvar venda'}
              </button>
            </>
          )}
        </div>
      </form>
      {historicoCampoAberto && (
        <HistoricoCampoModal
          titulo={historicoCampoAberto.titulo}
          eventos={historicoCampoAberto.eventos}
          referencias={{ clientes: clientesDisponiveis, servicos, tiposVenda, vendedoras: vendedorasOpcoesModal, operadoras }}
          onClose={() => setHistoricoCampoAberto(null)}
        />
      )}
      {reversaoParaExcluir && (
        <ExcluirReversaoModal
          reversao={reversaoParaExcluir}
          onClose={() => setReversaoParaExcluir(null)}
          onConfirm={onDeleteReversal}
        />
      )}
      {liberacaoAberta && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header"><div className="modal-header-row"><div><div className="modal-client">Solicitar liberação</div><div className="modal-sub">Uma liberação ADM será solicitada para esta venda compartilhada.</div></div><button type="button" className="btn btn-icon btn-ghost" title="Fechar" onClick={() => setLiberacaoAberta(false)}><I.Close size={14} /></button></div></div>
            <div className="modal-body"><div className="form-field"><label>Motivo da liberação</label><textarea value={motivoLiberacao} onChange={event => setMotivoLiberacao(event.target.value)} rows={5} maxLength={5000} placeholder="Descreva o motivo da liberação" /></div></div>
            <div className="modal-footer"><button type="button" className="btn" onClick={() => setLiberacaoAberta(false)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!motivoLiberacao.trim()} onClick={confirmarLiberacao}>Solicitar liberação</button></div>
          </div>
        </div>
      )}
    </div>
  );
}


export default VendaModal;
