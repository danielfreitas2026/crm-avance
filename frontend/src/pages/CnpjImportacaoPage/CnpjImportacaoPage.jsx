import { useEffect, useMemo, useRef, useState } from 'react';
import * as I from '../../components/Icons';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  adicionarLeadsCnpj,
  adicionarGooglePlacesKey,
  atualizarGooglePlacesKey,
  consultarPlanilhaCnpjStream,
  excluirBuscaRealizadaCnpj,
  exportarResultadoCnpj,
  limparBuscasRealizadasCnpj,
  listarBuscasRealizadasCnpj,
  reconsultarBuscasRealizadasCnpj,
  listarGooglePlacesKeys,
  removerGooglePlacesKey,
  previewPlanilhaCnpj
} from '../../services/cnpj.service';
import '../Clientes/Clientes.css';
import './CnpjImportacaoPage.css';

const COLUNAS_TABELA = [
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'razao_social', label: 'Razao social' },
  { key: 'nome_fantasia', label: 'Nome fantasia' },
  { key: 'situacao_cadastral', label: 'Situacao' },
  { key: 'email', label: 'E-mail' },
  { key: 'telefone_receita', label: 'Tel. Receita' },
  { key: 'telefone_google_places', label: 'Tel. Google' },
  { key: 'google_status', label: 'Google status' },
  { key: 'google_detalhe', label: 'Google detalhe' },
  { key: 'google_resultados', label: 'Resultados Google' },
  { key: 'avisos', label: 'Avisos' },
  { key: 'cep', label: 'CEP' },
  { key: 'endereco', label: 'Endereco' },
  { key: 'numero', label: 'Numero' },
  { key: 'bairro', label: 'Bairro' },
  { key: 'municipio', label: 'Municipio' },
  { key: 'uf', label: 'UF' },
  { key: 'fontes', label: 'Fontes' }
];

const COLUNAS_MOBILE_RESUMO = new Set(['cnpj', 'razao_social', 'nome_fantasia', 'situacao_cadastral']);
const COLUNAS_MOBILE_DETALHES = COLUNAS_TABELA.filter(coluna => !COLUNAS_MOBILE_RESUMO.has(coluna.key));
const COLUNAS_TELEFONE_POR_FONTE = [
  'telefone_receita',
  'telefone_google_places'
];

function obterResultadosGoogle(linha) {
  const google = linha?.google_places || {};
  const resultados = Array.isArray(google.empresas)
    ? google.empresas
    : Array.isArray(google.candidatos)
      ? google.candidatos
      : google.place
        ? [google.place]
        : [];
  const vistos = new Set();

  return resultados.filter(item => {
    const chave = item?.id || `${item?.nome || ''}:${item?.endereco || ''}:${item?.telefone || ''}`;
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function resumirResultadoGoogle(item, index) {
  const partes = [
    `${index + 1}. ${item?.nome || 'Sem nome'}`,
    item?.telefone,
    item?.endereco,
    Number.isFinite(Number(item?.score)) ? `score ${item.score}` : ''
  ].filter(Boolean);

  return partes.join(' - ');
}

function valorCelula(linha, coluna) {
  if (coluna.key === 'google_resultados') {
    const resultados = obterResultadosGoogle(linha);
    return resultados.length ? resultados.map(resumirResultadoGoogle).join(' | ') : '-';
  }

  const valor = linha[coluna.key];
  if (Array.isArray(valor)) return valor.join(', ');
  return valor || '-';
}
function normalizarTelefoneComparacao(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function obterResumoDivergenciaTelefone(linha) {
  const telefones = COLUNAS_TELEFONE_POR_FONTE
    .map(campo => ({
      campo,
      valor: linha?.[campo],
      normalizado: normalizarTelefoneComparacao(linha?.[campo])
    }))
    .filter(item => item.normalizado);
  const distintos = [...new Set(telefones.map(item => item.normalizado))];

  if (distintos.length <= 1) {
    return { divergente: false, referencia: distintos[0] || '' };
  }

  const telefonePrincipal = normalizarTelefoneComparacao(linha?.telefone);
  if (telefonePrincipal && distintos.includes(telefonePrincipal)) {
    return { divergente: true, referencia: telefonePrincipal };
  }

  const contagem = telefones.reduce((acc, item) => ({
    ...acc,
    [item.normalizado]: (acc[item.normalizado] || 0) + 1
  }), {});
  const maioria = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0];
  const referencia = maioria?.[1] > 1 ? maioria[0] : '';

  return { divergente: true, referencia };
}

function telefoneFonteDivergente(linha, coluna) {
  if (!COLUNAS_TELEFONE_POR_FONTE.includes(coluna.key)) return false;

  const valorNormalizado = normalizarTelefoneComparacao(linha?.[coluna.key]);
  if (!valorNormalizado) return false;

  const resumo = obterResumoDivergenciaTelefone(linha);
  return resumo.divergente && (!resumo.referencia || valorNormalizado !== resumo.referencia);
}

function renderValorCelula(linha, coluna) {
  const valor = valorCelula(linha, coluna);

  if (coluna.key === 'google_resultados') {
    const resultados = obterResultadosGoogle(linha);
    if (resultados.length === 0) return valor;

    return (
      <div className="cnpj-import-google-results">
        <strong>{resultados.length} resultado(s)</strong>
        {resultados.slice(0, 5).map((item, index) => (
          <span key={item.id || `${item.nome}:${item.endereco}:${index}`}>
            {resumirResultadoGoogle(item, index)}
          </span>
        ))}
      </div>
    );
  }

  if (!telefoneFonteDivergente(linha, coluna)) return valor;

  return (
    <span className="cnpj-import-value--divergent" title="Telefone divergente entre as APIs consultadas">
      {valor}
    </span>
  );
}

function statusLinha(linha) {
  if (linha.status === 'erro') return { label: 'Erro', className: 'tag-danger' };
  if (linha.busca_realizada) return { label: 'Ja buscado', className: 'tag-info' };
  if (linha.cache) return { label: 'Cache', className: 'tag-info' };
  return { label: 'OK', className: 'tag-success' };
}

function normalizarTextoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function obterDataLinha(linha) {
  const valor = linha?.ja_buscado_em || linha?.consultado_em || linha?.buscado_em || linha?.created_at || '';
  if (!valor) return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);

  const texto = String(valor);
  const match = texto.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? '' : data.toISOString().slice(0, 10);
}

function obterTimestampLinha(linha) {
  const valor = linha?.ja_buscado_em || linha?.consultado_em || linha?.buscado_em || linha?.created_at || '';
  if (!valor) return 0;

  const data = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T'));
  return Number.isNaN(data.getTime()) ? 0 : data.getTime();
}

function chaveResultadoLinha(linha) {
  if (linha?.busca_por_texto) {
    const placeId = linha?.google_places?.place?.id || linha?.google_places?.place?.nome || linha?.google_detalhe || linha?.nome_fantasia || '';
    return `texto:${linha?.row_index || ''}:${placeId}`;
  }

  const cnpj = String(linha?.cnpj_digitos || linha?.cnpj || '').replace(/\D/g, '');
  if (cnpj) return `cnpj:${cnpj}`;

  const placeId = linha?.google_places?.place?.id || linha?.google_places?.place?.nome || linha?.google_detalhe || linha?.nome_fantasia || '';
  return `linha:${linha?.row_index || ''}:${placeId}`;
}
function textoBuscaLinha(linha) {
  const valores = [
    linha.status,
    linha.message,
    linha.cnpj,
    linha.cnpj_digitos,
    linha.adicionado ? 'adicionado ja adicionado' : 'nao adicionado',
    ...COLUNAS_TABELA.map(coluna => valorCelula(linha, coluna)),
    ...obterResultadosGoogle(linha).map((item, index) => resumirResultadoGoogle(item, index))
  ];

  return normalizarTextoBusca(valores.join(' '));
}

function linhaPodeAdicionar(linha) {
  const cnpj = String(linha?.cnpj_digitos || linha?.cnpj || '').replace(/\D/g, '');
  return linha.status === 'encontrado' && !linha.adicionado && cnpj.length === 14;
}

function linhaTemTelefone(linha) {
  return [
    linha?.telefone_receita,
    linha?.telefone_google_places,
    linha?.telefone
  ].some(valor => String(valor || '').trim());
}

function esperarCancelavel(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Busca cancelada.', 'AbortError'));
    }, { once: true });
  });
}

function ConfirmarExclusaoResultadosModal({ confirmacao, total, excluindo, onClose, onConfirm }) {
  if (!confirmacao) return null;

  const ehLimpeza = confirmacao.tipo === 'todos';
  const cnpj = confirmacao.linha?.cnpj || confirmacao.linha?.cnpj_digitos || '';

  return (
    <div className="modal-overlay" onClick={event => !excluindo && event.target === event.currentTarget && onClose()}>
      <div className="modal cnpj-import-delete-modal" role="dialog" aria-modal="true" aria-labelledby="cnpj-import-delete-title">
        <div className="modal-header">
          <div className="modal-header-row">
            <div>
              <div id="cnpj-import-delete-title" className="modal-client">
                {ehLimpeza ? 'Limpar resultados?' : 'Excluir resultado?'}
              </div>
              <div className="modal-sub">
                {ehLimpeza ? `${total} resultado(s) de CNPJ` : cnpj}
              </div>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={excluindo} title="Fechar">
              <I.Close size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="cnpj-import-delete-warning">
            <div className="cnpj-import-delete-icon">
              <I.AlertTriangle size={22} />
            </div>
            <div>
              <strong>
                {ehLimpeza
                  ? 'Essa acao exclui todos os resultados salvos da consulta de CNPJ.'
                  : 'Essa acao exclui o resultado salvo para este CNPJ.'}
              </strong>
              <p>
                {ehLimpeza
                  ? 'A tabela ficara vazia e esses CNPJs poderao ser consultados novamente em uma nova busca.'
                  : 'O item deixara de aparecer na tabela e podera ser consultado novamente em uma nova busca.'}
              </p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={excluindo}>
            <I.Trash size={13} /> {excluindo ? 'Excluindo...' : ehLimpeza ? 'Limpar resultados' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renderiza pagina de importacao e consulta de CNPJ por planilha.
 */
function CnpjImportacaoPage() {
  const usuario = getUsuarioLocal();
  const podeCriarLead = temPermissao(usuario, 'clientes_secretos_criar');
  const [arquivo, setArquivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [abaSelecionada, setAbaSelecionada] = useState('');
  const [colunaBusca, setColunaBusca] = useState('');
  const [colunaCnpjTexto, setColunaCnpjTexto] = useState('');
  const [tipoBuscaPlanilha, setTipoBuscaPlanilha] = useState('cnpj');
  const [modoBuscaTelefone, setModoBuscaTelefone] = useState('sem_telefone');
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const [excluindoCnpj, setExcluindoCnpj] = useState('');
  const [limpandoResultados, setLimpandoResultados] = useState(false);
  const [reconsultandoCnpjs, setReconsultandoCnpjs] = useState([]);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [buscaTexto, setBuscaTexto] = useState('');
  const [filtroAdicionado, setFiltroAdicionado] = useState('todos');
  const [ordenacao, setOrdenacao] = useState('recentes');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [googleKeys, setGoogleKeys] = useState([]);
  const [googleKeysModalAberto, setGoogleKeysModalAberto] = useState(false);
  const [googleKeyDrafts, setGoogleKeyDrafts] = useState({});
  const [googleKeyVisiveis, setGoogleKeyVisiveis] = useState({});
  const [novaGoogleKeyVisivel, setNovaGoogleKeyVisivel] = useState(false);
  const [carregandoGoogleKeys, setCarregandoGoogleKeys] = useState(false);
  const [salvandoGoogleKey, setSalvandoGoogleKey] = useState(false);
  const [novaGoogleKey, setNovaGoogleKey] = useState({ nome: '', apiKey: '' });
  const cancelControllerRef = useRef(null);

  const colunas = preview?.colunas || [];
  const abasPlanilha = preview?.abas || [];
  const linhas = useMemo(() => resultado?.linhas || [], [resultado]);
  const linhasFiltradas = useMemo(() => {
    const termo = normalizarTextoBusca(buscaTexto);
    const filtradas = linhas.filter(linha => {
      if (filtroAdicionado === 'adicionados' && !linha.adicionado) return false;
      if (filtroAdicionado === 'nao_adicionados' && linha.adicionado) return false;

      const dataLinha = obterDataLinha(linha);
      if (dataInicio && (!dataLinha || dataLinha < dataInicio)) return false;
      if (dataFim && (!dataLinha || dataLinha > dataFim)) return false;
      if (termo && !textoBuscaLinha(linha).includes(termo)) return false;

      return true;
    });

    return [...filtradas].sort((a, b) => {
      const direcao = ordenacao === 'antigos' ? 1 : -1;
      return direcao * (
        obterTimestampLinha(a) - obterTimestampLinha(b)
        || Number(a.row_index || 0) - Number(b.row_index || 0)
        || String(a.cnpj_digitos || '').localeCompare(String(b.cnpj_digitos || ''))
      );
    });
  }, [buscaTexto, dataFim, dataInicio, filtroAdicionado, linhas, ordenacao]);
  const linhasAdicionaveis = useMemo(() => (
    linhasFiltradas.filter(linha => linhaPodeAdicionar(linha) && linhaTemTelefone(linha))
  ), [linhasFiltradas]);
  const reconsultandoSet = useMemo(() => new Set(reconsultandoCnpjs), [reconsultandoCnpjs]);
  const totalEncontrados = linhasFiltradas.filter(linha => linha.status === 'encontrado').length;
  const totalErros = linhasFiltradas.filter(linha => linha.status === 'erro').length;
  const filtrosAtivos = Boolean(buscaTexto || filtroAdicionado !== 'todos' || ordenacao !== 'recentes' || dataInicio || dataFim);
  const podeBuscar = Boolean(arquivo && colunaBusca && !carregando);
  const totalCnpjs = Number(resultado?.total_cnpjs || 0);
  const totalConsultadosAcumulado = linhas.length;
  const buscaPorTexto = tipoBuscaPlanilha === 'texto';

  useEffect(() => {
    carregarGoogleKeys();
    carregarBuscasRealizadas();
  }, []);

  async function carregarGoogleKeys() {
    setCarregandoGoogleKeys(true);
    try {
      const data = await listarGooglePlacesKeys();
      const chaves = data?.chaves || [];
      setGoogleKeys(chaves);
      setGoogleKeyDrafts(Object.fromEntries(chaves.map(chave => [
        chave.id,
        { nome: chave.nome || '', apiKey: chave.api_key || '' }
      ])));
    } catch (error) {
      setErro(error.message || 'Erro ao carregar chaves do Google Places.');
    } finally {
      setCarregandoGoogleKeys(false);
    }
  }

  async function carregarBuscasRealizadas() {
    try {
      const data = await listarBuscasRealizadasCnpj();
      setResultado(data?.linhas ? data : null);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar consultas de CNPJ salvas.');
    }
  }

  async function abrirModalGoogleKeys() {
    setGoogleKeysModalAberto(true);
    await carregarGoogleKeys();
  }

  async function salvarGoogleKey(event) {
    event.preventDefault();
    if (salvandoGoogleKey || !novaGoogleKey.apiKey.trim()) return;

    setSalvandoGoogleKey(true);
    setErro('');
    setSucesso('');

    try {
      await adicionarGooglePlacesKey(novaGoogleKey);
      setNovaGoogleKey({ nome: '', apiKey: '' });
      await carregarGoogleKeys();
      setSucesso('Chave do Google Places adicionada.');
    } catch (error) {
      setErro(error.message || 'Erro ao adicionar chave do Google Places.');
    } finally {
      setSalvandoGoogleKey(false);
    }
  }

  function atualizarDraftGoogleKey(id, campo, valor) {
    setGoogleKeyDrafts(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [campo]: valor
      }
    }));
  }

  async function salvarGoogleKeyExistente(id) {
    if (!id || salvandoGoogleKey) return;

    const draft = googleKeyDrafts[id] || {};
    if (!String(draft.apiKey || '').trim()) {
      setErro('Informe a chave da API do Google Places.');
      return;
    }

    setSalvandoGoogleKey(true);
    setErro('');
    setSucesso('');

    try {
      await atualizarGooglePlacesKey(id, {
        nome: draft.nome,
        apiKey: draft.apiKey
      });
      await carregarGoogleKeys();
      setSucesso('Chave do Google Places atualizada.');
    } catch (error) {
      setErro(error.message || 'Erro ao editar chave do Google Places.');
    } finally {
      setSalvandoGoogleKey(false);
    }
  }

  async function excluirGoogleKey(id) {
    if (!id || carregando || salvandoGoogleKey) return;

    setErro('');
    setSucesso('');

    try {
      await removerGooglePlacesKey(id);
      await carregarGoogleKeys();
      setSucesso('Chave do Google Places removida.');
    } catch (error) {
      setErro(error.message || 'Erro ao remover chave do Google Places.');
    }
  }

  function statusGoogleKey(chave) {
    if (!chave.ativo) return 'Inativa';
    if (chave.esgotada) return 'Esgotada hoje';
    return 'Disponivel';
  }

  function classeStatusGoogleKey(chave) {
    if (!chave.ativo) return 'tag';
    if (chave.esgotada) return 'tag tag-danger';
    return 'tag tag-success';
  }

  async function carregarPreview(file, aba = '') {
    setArquivo(file || null);
    setPreview(null);
    setAbaSelecionada(aba || '');
    setColunaBusca('');
    setColunaCnpjTexto('');
    setTipoBuscaPlanilha('cnpj');
    setErro('');
    setSucesso('');
    setProgresso(null);
    cancelControllerRef.current?.abort();
    cancelControllerRef.current = null;

    if (!file) return;

    setCarregando(true);
    try {
      const data = await previewPlanilhaCnpj(file, aba ? { aba } : null);
      const tipoSugerido = data.sugestoes?.tipo_busca || (data.sugestoes?.cnpj ? 'cnpj' : 'texto');
      setPreview(data);
      setAbaSelecionada(data.aba || aba || '');
      setColunaBusca(data.sugestoes?.busca || data.sugestoes?.cnpj || '');
      setColunaCnpjTexto(data.sugestoes?.cnpj || '');
      setTipoBuscaPlanilha(tipoSugerido);
      if (tipoSugerido === 'texto') setModoBuscaTelefone('somente_google');
    } catch (error) {
      setErro(error.message || 'Erro ao ler planilha.');
    } finally {
      setCarregando(false);
    }
  }

  async function consultarLoteStream(inicio, acumular, requisicoesBase, signal, preservarLinhasIniciais = false) {
    let fimLote = null;

      await consultarPlanilhaCnpjStream(arquivo, {
        colunaBusca,
        colunaCnpjTexto: buscaPorTexto ? colunaCnpjTexto : '',
        tipoBusca: tipoBuscaPlanilha,
        aba: preview?.aba || abaSelecionada,
        inicio,
        limite: preview?.limite_linhas,
        buscaTelefone: buscaPorTexto ? 'somente_google' : modoBuscaTelefone
      }, evento => {
        if (evento.tipo === 'inicio') {
          setResultado(prev => {
            const linhasAnteriores = (acumular || preservarLinhasIniciais) ? (prev?.linhas || []) : [];
            const requisicoesAnteriores = acumular ? Number(prev?.requisicoes_externas || 0) : 0;
            return {
              ...evento,
              total_consultados: linhasAnteriores.length,
              requisicoes_externas: requisicoesAnteriores,
              linhas: linhasAnteriores
            };
          });
          setProgresso({
            atual: 0,
            total_lote: evento.total_lote || 0,
            cnpj: '',
            inicio: evento.inicio || 0,
            total_cnpjs: evento.total_cnpjs || 0
          });
          return;
        }

        if (evento.tipo === 'progresso') {
          setProgresso(prev => ({
            ...(prev || {}),
            atual: evento.atual || 0,
            total_lote: evento.total_lote || prev?.total_lote || 0,
            cnpj: evento.cnpj || ''
          }));
          return;
        }

        if (evento.tipo === 'linha') {
          setResultado(prev => {
            const linhasAtuais = prev?.linhas || [];
            const chaveLinhaAtualizada = chaveResultadoLinha(evento.linha);
            const indiceExistente = linhasAtuais.findIndex(linha => chaveResultadoLinha(linha) === chaveLinhaAtualizada);
            const linhaAtualizada = indiceExistente >= 0
              ? {
                  ...evento.linha,
                  adicionado: linhasAtuais[indiceExistente].adicionado || evento.linha?.adicionado,
                  lead_id: evento.linha?.lead_id || linhasAtuais[indiceExistente].lead_id
                }
              : evento.linha;
            const proximasLinhas = indiceExistente >= 0
              ? linhasAtuais.map((linha, index) => (index === indiceExistente ? linhaAtualizada : linha))
              : [...linhasAtuais, linhaAtualizada];
            return {
              ...(prev || {}),
              requisicoes_externas: requisicoesBase + Number(evento.requisicoes_externas || 0),
              total_ja_buscados: Number(evento.total_ja_buscados || prev?.total_ja_buscados || 0),
              total_consultados: proximasLinhas.length,
              linhas: proximasLinhas
            };
          });
          return;
        }

        if (evento.tipo === 'fim') {
          fimLote = evento;
          setResultado(prev => ({
            ...(prev || {}),
            ...evento,
            requisicoes_externas: requisicoesBase + Number(evento.requisicoes_externas || 0),
            linhas: prev?.linhas || []
          }));

          const fim = inicio + Number(evento.total_consultados || 0);
          setSucesso(`Lote consultado: ${inicio + 1}-${fim} de ${evento.total_cnpjs || fim} CNPJ(s).`);
          setProgresso(null);
          return;
        }

        if (evento.tipo === 'erro') {
          throw new Error(evento.message || 'Erro ao consultar CNPJs.');
        }
      }, { signal });

    return fimLote;
  }

  async function buscarTodosLotes() {
    if (!podeBuscar) return;

    cancelControllerRef.current?.abort();
    const controller = new AbortController();
    cancelControllerRef.current = controller;

    setCarregando(true);
    setErro('');
    setSucesso('');
    setProgresso(null);

    
    const buscaAtualPorTexto = buscaPorTexto;
    let inicio = 0;
    let acumular = false;
    let requisicoesBase = 0;
    let preservarLinhasIniciais = !buscaAtualPorTexto && Boolean(resultado?.linhas?.length);

    try {
      while (!controller.signal.aborted) {
        const fim = await consultarLoteStream(inicio, acumular, requisicoesBase, controller.signal, preservarLinhasIniciais);
        preservarLinhasIniciais = false;

        if (!fim) break;

        requisicoesBase += Number(fim.requisicoes_externas || 0);

        if (!fim.tem_proximo_lote || fim.proximo_inicio === null || fim.proximo_inicio === undefined) {
          setSucesso(`Busca concluida: ${fim.total_cnpjs || inicio + Number(fim.total_consultados || 0)} ${buscaAtualPorTexto ? 'item(ns)' : 'CNPJ(s)'} processado(s).`);
          break;
        }

        setProgresso({
          atual: fim.total_consultados || 0,
          total_lote: fim.total_consultados || 0,
          cnpj: '',
          mensagem: 'Aguardando intervalo para o proximo lote...'
        });
        await esperarCancelavel(Number(fim.intervalo_ms || 0), controller.signal);
        inicio = fim.proximo_inicio;
        acumular = true;
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setSucesso('Busca cancelada. Os resultados ja encontrados foram mantidos.');
      } else {
        setErro(error.message || 'Erro ao consultar CNPJs.');
      }
    } finally {
      if (cancelControllerRef.current === controller) {
        cancelControllerRef.current = null;
      }
      setProgresso(null);
      setCarregando(false);
      if (!buscaAtualPorTexto) {
        await carregarBuscasRealizadas();
      }
    }
  }

  function cancelarBusca() {
    cancelControllerRef.current?.abort();
  }

  function limparFiltros() {
    setBuscaTexto('');
    setFiltroAdicionado('todos');
    setOrdenacao('recentes');
    setDataInicio('');
    setDataFim('');
  }

  async function buscarEmpresas(event) {
    event.preventDefault();
    await buscarTodosLotes();
  }

  function marcarLeadsCriados(resposta) {
    const criados = new Set((resposta.leads || []).map(item => item.cnpj_digitos));
    if (criados.size === 0) return;

    setResultado(prev => ({
      ...prev,
      linhas: (prev?.linhas || []).map(linha => (
        criados.has(linha.cnpj_digitos)
          ? { ...linha, adicionado: true, lead_id: [...(resposta.leads || [])].find(item => item.cnpj_digitos === linha.cnpj_digitos)?.id || linha.lead_id }
          : linha
      ))
    }));
  }

  async function adicionarLinhas(linhasSelecionadas) {
    if (!podeCriarLead || linhasSelecionadas.length === 0 || adicionando) return;

    setAdicionando(true);
    setErro('');
    setSucesso('');

    try {
      const data = await adicionarLeadsCnpj(linhasSelecionadas);
      marcarLeadsCriados(data);
      const partes = [`${data.criados || 0} lead(s) criado(s)`];
      if (data.ignorados) partes.push(`${data.ignorados} ignorado(s)`);
      if (data.erros?.length) partes.push(`${data.erros.length} erro(s)`);
      setSucesso(partes.join(', ') + '.');
      if (data.erros?.length) {
        setErro(data.erros.slice(0, 3).map(item => `${item.cnpj}: ${item.message}`).join(' | '));
      }
    } catch (error) {
      setErro(error.message || 'Erro ao adicionar leads.');
    } finally {
      setAdicionando(false);
    }
  }

  async function excluirResultado(linha) {
    const cnpj = String(linha?.cnpj_digitos || linha?.cnpj || '').replace(/\D/g, '');
    if (!cnpj || excluindoCnpj || limpandoResultados) return;

    setExcluindoCnpj(cnpj);
    setErro('');
    setSucesso('');

    try {
      await excluirBuscaRealizadaCnpj(cnpj);
      setResultado(prev => {
        const proximasLinhas = (prev?.linhas || []).filter(item => String(item.cnpj_digitos || item.cnpj || '').replace(/\D/g, '') !== cnpj);
        return prev ? {
          ...prev,
          total_cnpjs: proximasLinhas.length,
          total_consultados: proximasLinhas.length,
          total_ja_buscados: proximasLinhas.filter(item => item.busca_realizada).length,
          linhas: proximasLinhas
        } : prev;
      });
      setSucesso('Resultado excluido.');
      setConfirmacaoExclusao(null);
      await carregarBuscasRealizadas();
    } catch (error) {
      setErro(error.message || 'Erro ao excluir resultado.');
    } finally {
      setExcluindoCnpj('');
    }
  }

  async function reconsultarResultados(linhasSelecionadas = linhasFiltradas) {
    const cnpjs = [...new Set((linhasSelecionadas || [])
      .map(linha => String(linha?.cnpj_digitos || linha?.cnpj || '').replace(/\D/g, ''))
      .filter(cnpj => cnpj.length === 14))];

    if (cnpjs.length === 0 || carregando || limpandoResultados || reconsultandoCnpjs.length > 0) return;

    setReconsultandoCnpjs(cnpjs);
    setErro('');
    setSucesso('');

    try {
      const data = await reconsultarBuscasRealizadasCnpj(cnpjs, { buscaTelefone: buscaPorTexto ? 'somente_google' : modoBuscaTelefone });
      await carregarBuscasRealizadas();
      const totalErrosReconsulta = (data?.linhas || []).filter(linha => linha.status === 'erro').length;
      const partes = [`${data?.total_consultados || cnpjs.length} CNPJ(s) buscado(s) novamente`];
      if (data?.requisicoes_externas) partes.push(`${data.requisicoes_externas} consulta(s) externa(s)`);
      if (totalErrosReconsulta) partes.push(`${totalErrosReconsulta} com erro`);
      setSucesso(`${partes.join(', ')}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao buscar CNPJs novamente.');
    } finally {
      setReconsultandoCnpjs([]);
    }
  }
  async function limparResultados() {
    if (linhas.length === 0 || limpandoResultados) return;

    setLimpandoResultados(true);
    setErro('');
    setSucesso('');

    try {
      const data = await limparBuscasRealizadasCnpj();
      setResultado(prev => prev ? {
        ...prev,
        total_cnpjs: 0,
        total_consultados: 0,
        total_ja_buscados: 0,
        linhas: []
      } : null);
      setSucesso(`${data?.excluidos || 0} resultado(s) excluido(s).`);
      setConfirmacaoExclusao(null);
    } catch (error) {
      setErro(error.message || 'Erro ao limpar resultados.');
    } finally {
      setLimpandoResultados(false);
    }
  }

  async function exportarResultado() {
    if (linhasFiltradas.length === 0 || exportando) return;

    setExportando(true);
    setErro('');
    setSucesso('');

    try {
      await exportarResultadoCnpj(linhasFiltradas, preview?.arquivo || 'consulta-cnpj', { arquivo, aba: preview?.aba || abaSelecionada });
      setSucesso(arquivo ? 'Planilha original exportada com a coluna de telefone encontrado.' : 'Resultado exportado em Excel.');
    } catch (error) {
      setErro(error.message || 'Erro ao exportar resultado.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <LayoutPrivado>
      <div className="cnpj-import-page">
        <form className="panel cnpj-import-panel" onSubmit={buscarEmpresas}>
          <div className="panel-header">
            <div>
              <h2>Consulta de empresas por CNPJ</h2>
              <p>Importe uma planilha, escolha a coluna de CNPJ e consulte Open CNPJ, CNPJ.ws e Minha Receita.</p>
            </div>
            <div className="cnpj-import-actions">
              <button
                type="button"
                className="btn"
                onClick={abrirModalGoogleKeys}
                disabled={carregandoGoogleKeys}
              >
                <I.Settings size={14} />
                Chaves Google
              </button>
              {resultado && podeCriarLead && (
                <>
                <button
                  type="button"
                  className="btn"
                  onClick={exportarResultado}
                  disabled={exportando || linhasFiltradas.length === 0}
                >
                  <I.Download size={14} />
                  {exportando ? 'Exportando...' : 'Baixar Excel'}
                </button>
                {carregando && (
                  <button
                    type="button"
                    className="btn"
                    onClick={cancelarBusca}
                  >
                    <I.Close size={14} />
                    Cancelar busca
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => adicionarLinhas(linhasAdicionaveis)}
                  disabled={carregando || adicionando || linhasAdicionaveis.length === 0}
                >
                  <I.Plus size={14} />
                  {adicionando ? 'Adicionando...' : 'Adicionar todos exibidos'}
                </button>
                </>
              )}
            </div>
          </div>

          <div className="cnpj-import-controls">
            <div className="form-field">
              <label>Arquivo .xlsx</label>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={event => carregarPreview(event.target.files?.[0])}
                disabled={carregando || adicionando}
              />
            </div>

            {abasPlanilha.length > 1 && (
              <div className="form-field">
                <label>Aba da planilha</label>
                <select
                  value={abaSelecionada}
                  onChange={event => carregarPreview(arquivo, event.target.value)}
                  disabled={!arquivo || carregando || adicionando}
                  required
                >
                  {abasPlanilha.map(aba => (
                    <option key={`${aba.nome}:${aba.index}`} value={aba.nome}>
                      {aba.nome} ({aba.total_linhas} linhas)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field">
              <label>Coluna de busca</label>
              <select
                value={colunaBusca}
                onChange={event => setColunaBusca(event.target.value)}
                disabled={!preview || carregando || adicionando}
                required
              >
                <option value="">Selecione</option>
                {colunas.map(coluna => (
                  <option key={`${coluna.nome}:${coluna.index}`} value={coluna.nome}>{coluna.nome}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Tipo da busca</label>
              <select
                value={tipoBuscaPlanilha}
                onChange={event => {
                  const proximoTipo = event.target.value;
                  setTipoBuscaPlanilha(proximoTipo);
                  if (proximoTipo === 'texto') setModoBuscaTelefone('somente_google');
                }}
                disabled={!preview || carregando || adicionando}
              >
                <option value="cnpj">CNPJ</option>
                <option value="texto">Texto / nome</option>
              </select>
            </div>
            {buscaPorTexto && (
              <div className="form-field">
                <label>Coluna do CNPJ</label>
                <select
                  value={colunaCnpjTexto}
                  onChange={event => setColunaCnpjTexto(event.target.value)}
                  disabled={!preview || carregando || adicionando}
                >
                  <option value="">Nao informar</option>
                  {colunas.map(coluna => (
                    <option key={`cnpj-texto-${coluna.nome}:${coluna.index}`} value={coluna.nome}>{coluna.nome}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field">
              <label>Telefone extra</label>
              <select
                value={buscaPorTexto ? 'somente_google' : modoBuscaTelefone}
                onChange={event => setModoBuscaTelefone(event.target.value)}
                disabled={buscaPorTexto || carregando || adicionando}
              >
                <option value="sem_telefone">Google rotativo se faltar telefone</option>
                <option value="somente_google">Buscar telefone somente no Google</option>
                <option value="nao">Nao usar busca extra</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={!podeBuscar || adicionando}>
              <I.Search size={14} />
              {carregando ? 'Buscando...' : 'Buscar tudo'}
            </button>
            {carregando && (
              <button type="button" className="btn" onClick={cancelarBusca}>
                <I.Close size={14} />
                Cancelar
              </button>
            )}
          </div>
          {preview && (
            <div className="cliente-import-summary">
              <span>Aba: <strong>{preview.aba}</strong></span>
              <span>Linhas: <strong>{preview.total_linhas}</strong></span>
              <span>Colunas: <strong>{colunas.length}</strong></span>
              <span>Limite por busca: <strong>{preview.limite_linhas}</strong></span>
            </div>
          )}

          {progresso && (
            <div className="cnpj-import-progress">
              <div className="cnpj-import-progress__bar">
                <span
                  style={{
                    width: `${progresso.total_lote ? Math.min(100, Math.round((progresso.atual / progresso.total_lote) * 100)) : 0}%`
                  }}
                />
              </div>
              <strong>{progresso.atual || 0}/{progresso.total_lote || 0}</strong>
              <span>{progresso.mensagem || (progresso.cnpj ? `Consultando ${progresso.cnpj}` : 'Preparando consulta...')}</span>
            </div>
          )}

          {preview && (
            <div className="cnpj-import-samples">
              {(preview.amostras || []).map(amostra => (
                <span key={amostra.row_index}>
                  Linha {amostra.row_index}: <strong>{amostra.dados?.[colunaBusca] || '-'}</strong> <small>({tipoBuscaPlanilha === 'cnpj' ? 'CNPJ' : 'Texto'})</small>
                </span>
              ))}
            </div>
          )}

          {erro && <div className="alert-error">{erro}</div>}
          {sucesso && <div className="alert-success">{sucesso}</div>}
        </form>

        {googleKeysModalAberto && (
          <div className="modal-overlay" role="dialog" aria-modal="true" onClick={event => event.target === event.currentTarget && setGoogleKeysModalAberto(false)}>
            <div className="modal cnpj-import-keys-modal">
              <div className="modal-header">
                <div className="modal-header-row">
                  <div>
                    <div className="modal-client">Chaves Google Places</div>
                    <div className="modal-sub">{googleKeys.length} chave(s) cadastrada(s) para rotacao de busca extra.</div>
                  </div>
                  <button type="button" className="btn btn-icon btn-ghost" onClick={() => setGoogleKeysModalAberto(false)} disabled={salvandoGoogleKey}>
                    <I.Close size={14} />
                  </button>
                </div>
              </div>

              <div className="modal-body">
                <form className="cnpj-import-key-add" onSubmit={salvarGoogleKey}>
                  <div className="form-field">
                    <label>Nome</label>
                    <input
                      type="text"
                      value={novaGoogleKey.nome}
                      onChange={event => setNovaGoogleKey(prev => ({ ...prev, nome: event.target.value }))}
                      placeholder="Conta 1"
                      disabled={salvandoGoogleKey}
                    />
                  </div>
                  <div className="form-field">
                    <label>API key</label>
                    <div className="cnpj-import-secret-field">
                      <input
                        type={novaGoogleKeyVisivel ? 'text' : 'password'}
                        value={novaGoogleKey.apiKey}
                        onChange={event => setNovaGoogleKey(prev => ({ ...prev, apiKey: event.target.value }))}
                        placeholder="AIza..."
                        disabled={salvandoGoogleKey}
                      />
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost"
                        onClick={() => setNovaGoogleKeyVisivel(prev => !prev)}
                        title={novaGoogleKeyVisivel ? 'Ocultar chave' : 'Mostrar chave'}
                      >
                        {novaGoogleKeyVisivel ? <I.EyeOff size={14} /> : <I.Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={salvandoGoogleKey || !novaGoogleKey.apiKey.trim()}>
                    <I.Plus size={14} />
                    {salvandoGoogleKey ? 'Salvando...' : 'Adicionar'}
                  </button>
                </form>

                <div className="cnpj-import-key-list">
                  {googleKeys.length === 0 ? (
                    <div className="cnpj-import-key-empty">
                      {carregandoGoogleKeys ? 'Carregando chaves...' : 'Nenhuma chave cadastrada.'}
                    </div>
                  ) : googleKeys.map(chave => {
                    const draft = googleKeyDrafts[chave.id] || { nome: chave.nome || '', apiKey: chave.api_key || '' };
                    const visivel = Boolean(googleKeyVisiveis[chave.id]);

                    return (
                      <div className="cnpj-import-key-row" key={chave.id} title={chave.ultimo_erro || ''}>
                        <div className="form-field">
                          <label>Nome</label>
                          <input
                            type="text"
                            value={draft.nome}
                            onChange={event => atualizarDraftGoogleKey(chave.id, 'nome', event.target.value)}
                            disabled={salvandoGoogleKey}
                          />
                        </div>
                        <div className="form-field">
                          <label>API key</label>
                          <div className="cnpj-import-secret-field">
                            <input
                              type={visivel ? 'text' : 'password'}
                              value={draft.apiKey}
                              onChange={event => atualizarDraftGoogleKey(chave.id, 'apiKey', event.target.value)}
                              disabled={salvandoGoogleKey}
                            />
                            <button
                              type="button"
                              className="btn btn-icon btn-ghost"
                              onClick={() => setGoogleKeyVisiveis(prev => ({ ...prev, [chave.id]: !prev[chave.id] }))}
                              title={visivel ? 'Ocultar chave' : 'Mostrar chave'}
                            >
                              {visivel ? <I.EyeOff size={14} /> : <I.Eye size={14} />}
                            </button>
                          </div>
                        </div>
                        <div className="cnpj-import-key-meta">
                          <span className={classeStatusGoogleKey(chave)}>{statusGoogleKey(chave)}</span>
                          {chave.esgotada_ate && <small>Volta em {new Date(chave.esgotada_ate).toLocaleString('pt-BR')}</small>}
                        </div>
                        <div className="cnpj-import-key-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => salvarGoogleKeyExistente(chave.id)}
                            disabled={salvandoGoogleKey || !String(draft.apiKey || '').trim()}
                          >
                            <I.Check size={13} />
                            Salvar
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => excluirGoogleKey(chave.id)}
                            disabled={carregando || salvandoGoogleKey}
                          >
                            <I.Trash size={13} />
                            Remover
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn" onClick={carregarGoogleKeys} disabled={carregandoGoogleKeys || salvandoGoogleKey}>
                  <I.Refresh size={14} />
                  Atualizar
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setGoogleKeysModalAberto(false)} disabled={salvandoGoogleKey}>
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {resultado && (
          <div className="panel cnpj-import-results">
            <div className="panel-header">
              <div>
                <h2>Dados retornados</h2>
                <p>
                  {totalEncontrados} encontrado(s), {totalErros} com erro, {resultado.requisicoes_externas || 0} consulta(s) externa(s).
                  {linhasFiltradas.length !== linhas.length && ` ${linhasFiltradas.length} de ${linhas.length} resultado(s) exibido(s).`}
                </p>
                {totalCnpjs > 0 && (
                  <p>{totalConsultadosAcumulado} de {totalCnpjs} CNPJ(s) consultado(s) nesta planilha.</p>
                )}
              </div>
              {carregando && (
                <div className="cnpj-import-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={exportarResultado}
                    disabled={exportando || linhasFiltradas.length === 0}
                  >
                    <I.Download size={14} />
                    {exportando ? 'Exportando...' : 'Baixar Excel'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={cancelarBusca}
                  >
                    <I.Close size={14} />
                    Cancelar busca
                  </button>
                </div>
              )}
              {!carregando && linhas.length > 0 && (
                <div className="cnpj-import-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={exportarResultado}
                    disabled={exportando || limpandoResultados || linhasFiltradas.length === 0}
                  >
                    <I.Download size={14} />
                    {exportando ? 'Exportando...' : 'Baixar Excel'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => reconsultarResultados(linhasFiltradas)}
                    disabled={adicionando || exportando || limpandoResultados || reconsultandoCnpjs.length > 0 || linhasFiltradas.length === 0}
                  >
                    <I.Refresh size={14} />
                    {reconsultandoCnpjs.length > 0 ? 'Buscando...' : 'Buscar novamente exibidos'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger-icon"
                    onClick={() => setConfirmacaoExclusao({ tipo: 'todos' })}
                    disabled={limpandoResultados || adicionando || exportando || reconsultandoCnpjs.length > 0}
                  >
                    <I.Trash size={14} />
                    {limpandoResultados ? 'Limpando...' : 'Limpar resultados'}
                  </button>
                </div>
              )}
            </div>

            <div className="cnpj-import-filters">
              <div className="search-box">
                <I.Search size={14} />
                <input
                  value={buscaTexto}
                  onChange={event => setBuscaTexto(event.target.value)}
                  placeholder="Buscar em todos os resultados"
                />
              </div>

              <div className="form-field">
                <label>Ordenar</label>
                <select value={ordenacao} onChange={event => setOrdenacao(event.target.value)}>
                  <option value="recentes">Mais recente primeiro</option>
                  <option value="antigos">Mais antigo primeiro</option>
                </select>
              </div>

              <div className="form-field">
                <label>Adicao</label>
                <select value={filtroAdicionado} onChange={event => setFiltroAdicionado(event.target.value)}>
                  <option value="todos">Todos</option>
                  <option value="adicionados">Adicionados</option>
                  <option value="nao_adicionados">Nao adicionados</option>
                </select>
              </div>

              <div className="form-field">
                <label>De</label>
                <input type="date" value={dataInicio} onChange={event => setDataInicio(event.target.value)} />
              </div>

              <div className="form-field">
                <label>Ate</label>
                <input type="date" value={dataFim} onChange={event => setDataFim(event.target.value)} />
              </div>

              <button type="button" className="btn" onClick={limparFiltros} disabled={!filtrosAtivos}>
                <I.Filter size={14} />
                Limpar filtros
              </button>
            </div>

            <div className="list-table cnpj-import-table">
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      {COLUNAS_TABELA.map(coluna => <th key={coluna.key}>{coluna.label}</th>)}
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFiltradas.length === 0 ? (
                      <tr>
                        <td colSpan={COLUNAS_TABELA.length + 2}>
                          {linhas.length === 0 ? 'Nenhum resultado exibido.' : 'Nenhum resultado encontrado para os filtros.'}
                        </td>
                      </tr>
                    ) : linhasFiltradas.map(linha => (
                      <tr key={`${linha.row_index}:${linha.cnpj_digitos}`}>
                        <td data-label="Status" className="m-primary" title={linha.message || undefined}>
                          <div className="cnpj-import-primary">
                            <div className="cnpj-import-primary__title">
                              <span className={`tag ${statusLinha(linha).className}`}>
                                {statusLinha(linha).label}
                              </span>
                              <strong>{valorCelula(linha, { key: 'cnpj' })}</strong>
                            </div>
                            {linha.message && <small>{linha.message}</small>}
                            <span>{valorCelula(linha, { key: 'razao_social' })}</span>
                            <span>{valorCelula(linha, { key: 'nome_fantasia' })}</span>
                            <details className="cnpj-import-mobile-drawer">
                              <summary>Ver detalhes</summary>
                              <dl>
                                <dt>Situacao</dt>
                                <dd>{valorCelula(linha, { key: 'situacao_cadastral' })}</dd>
                                {COLUNAS_MOBILE_DETALHES.flatMap(coluna => [
                                  <dt key={`${coluna.key}-label`}>{coluna.label}</dt>,
                                  <dd key={`${coluna.key}-value`}>{renderValorCelula(linha, coluna)}</dd>
                                ])}
                              </dl>
                            </details>
                          </div>
                        </td>
                        {COLUNAS_TABELA.map(coluna => (
                          <td key={coluna.key} title={valorCelula(linha, coluna)}>
                            {renderValorCelula(linha, coluna)}
                          </td>
                        ))}
                        <td data-label="Acoes" className="m-actions">
                          <div className="cnpj-import-row-actions">
                            {linha.adicionado ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled
                                title="Lead ja adicionado na qualificacao"
                              >
                                <I.Check size={13} />
                                J&aacute; adicionado
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => adicionarLinhas([linha])}
                                disabled={!podeCriarLead || !linhaPodeAdicionar(linha) || adicionando || limpandoResultados || reconsultandoCnpjs.length > 0}
                                title={podeCriarLead ? 'Adicionar lead' : 'Sem permissao para cadastrar leads'}
                              >
                                <I.Plus size={13} />
                                Adicionar
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => reconsultarResultados([linha])}
                              disabled={carregando || limpandoResultados || adicionando || reconsultandoCnpjs.length > 0}
                              title="Buscar este CNPJ novamente"
                            >
                              <I.Refresh size={13} />
                              {reconsultandoSet.has(String(linha.cnpj_digitos || linha.cnpj || '').replace(/\D/g, '')) ? 'Buscando...' : 'Buscar novamente'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost btn-danger-icon"
                              onClick={() => setConfirmacaoExclusao({ tipo: 'linha', linha })}
                              disabled={carregando || limpandoResultados || reconsultandoCnpjs.length > 0 || excluindoCnpj === String(linha.cnpj_digitos || linha.cnpj || '').replace(/\D/g, '')}
                              title="Excluir resultado"
                            >
                              <I.Trash size={13} />
                              {excluindoCnpj === String(linha.cnpj_digitos || linha.cnpj || '').replace(/\D/g, '') ? 'Excluindo...' : 'Excluir'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        <ConfirmarExclusaoResultadosModal
          confirmacao={confirmacaoExclusao}
          total={linhas.length}
          excluindo={Boolean(excluindoCnpj) || limpandoResultados}
          onClose={() => setConfirmacaoExclusao(null)}
          onConfirm={() => (
            confirmacaoExclusao?.tipo === 'todos'
              ? limparResultados()
              : excluirResultado(confirmacaoExclusao?.linha)
          )}
        />
      </div>
    </LayoutPrivado>
  );
}

export default CnpjImportacaoPage;
