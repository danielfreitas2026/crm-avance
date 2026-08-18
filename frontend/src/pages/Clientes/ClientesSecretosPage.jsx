import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as I from '../../components/Icons';
import SelectFiltro from '../../components/SelectFiltro/SelectFiltro';
import ClienteModal from './ClienteModal';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  atualizarClienteSecreto,
  criarClienteSecreto,
  excluirClienteSecreto,
  listarClientesSecretos,
  verificarDocumentoClienteSecreto
} from '../../services/cliente.service';
import { listarOperadoras } from '../../services/config.service';
import {
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam
} from '../../services/notificacao-abertura.service';
import { useDebounce } from '../../utils/useDebounce';
import './Clientes.css';

const BUSCA_CLIENTES_CAMPO_OPCOES = [
  { value: 'geral', label: 'Busca geral' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'documento', label: 'CNPJ/CPF' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'responsavel', label: 'Responsavel' }
];

function apenasDigitos(valor, limite) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return limite ? digitos.slice(0, limite) : digitos;
}

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

function formatarTelefoneBusca(valor) {
  const digitos = apenasDigitos(valor, 11);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : '';
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  if (numero.length <= 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}

function formatarCpfBusca(valor) {
  const digitos = apenasDigitos(valor, 11);
  if (digitos.length <= 3) return digitos;
  if (digitos.length <= 6) return `${digitos.slice(0, 3)}.${digitos.slice(3)}`;
  if (digitos.length <= 9) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6)}`;
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function formatarCnpjBusca(valor) {
  const digitos = apenasDigitos(valor, 14);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 5) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  if (digitos.length <= 8) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5)}`;
  if (digitos.length <= 12) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function formatarDocumentoBusca(valor) {
  const digitos = apenasDigitos(valor, 14);
  return digitos.length > 11 ? formatarCnpjBusca(digitos) : formatarCpfBusca(digitos);
}

function formatarBuscaClientesPorCampo(campo, valor) {
  if (campo === 'telefone') return formatarTelefoneBusca(valor);
  if (campo === 'documento') return formatarDocumentoBusca(valor);
  return valor;
}

function getInputModeBuscaClientes(campo) {
  return ['telefone', 'documento'].includes(campo) ? 'numeric' : undefined;
}

function getMaxLengthBuscaClientes(campo) {
  if (campo === 'telefone') return 15;
  if (campo === 'documento') return 18;
  return undefined;
}

function getPlaceholderBuscaClientes(campo) {
  const placeholders = {
    geral: 'Buscar por nome, CNPJ/CPF, telefone, e-mail ou responsavel',
    cliente: 'Buscar por nome ou razao social',
    documento: 'CNPJ ou CPF',
    telefone: '(11) 99999-9999',
    email: 'Buscar por e-mail',
    responsavel: 'Buscar por responsavel'
  };

  return placeholders[campo] || placeholders.geral;
}

function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatarTelefoneOrigem(valor) {
  const digitos = apenasDigitos(valor, 11);
  if (!digitos) return '';
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (!ddd) return numero;
  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  if (numero.length <= 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}

function formatarContato(cliente) {
  const receita = formatarTelefoneOrigem(cliente.telefone_receita);
  const google = formatarTelefoneOrigem(cliente.telefone_google);
  const whatsapp = formatarTelefone(cliente.whatsapp_ddd, cliente.whatsapp_numero);
  const fixo = formatarTelefone(cliente.fixo_ddd, cliente.fixo_numero);
  const principal = receita || google || whatsapp || fixo;
  const todos = [receita, google, whatsapp, fixo].filter(Boolean);
  return { receita, google, whatsapp, fixo, principal, todos };
}

function formatarMoeda(valor) {
  if (valor === undefined || valor === null || valor === '') return '-';
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatarData(valor) {
  if (!valor) return '-';
  const texto = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return '-';
  return texto.split('-').reverse().join('/');
}

function diferencaDias(dataReferencia) {
  if (!dataReferencia) return null;
  const data = new Date(`${String(dataReferencia).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(data.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((data.getTime() - hoje.getTime()) / 86400000);
}

function formatarFidelidade(cliente) {
  const dias = diferencaDias(cliente.fidelidade_fim);
  if (dias === null) return { label: 'Sem fidelidade', className: '' };
  if (dias < 0) return { label: 'Vencida', className: 'danger' };
  if (dias <= 30) return { label: dias === 0 ? 'Vence hoje' : `${dias} dias`, className: 'warn' };
  return { label: `${dias} dias`, className: 'success' };
}

function obterOperadorasCliente(cliente) {
  return cliente?.operadoras_atuais || cliente?.operadorasAtuais || [];
}

function slugOperadora(nome) {
  return String(nome).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-');
}

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

  const nomes = operadorasCliente.map(item => item.operadora?.nome).filter(Boolean);
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
        if (item.fidelidade_fim) partes.push(`fid. ${formatarData(item.fidelidade_fim)}`);
        return partes.join(' - ');
      })
      .join('\n')
  };
}

function clienteCasaComBusca(cliente, campo, termo) {
  const busca = normalizarBusca(termo);
  if (!busca) return true;

  const contato = formatarContato(cliente);
  const digitosBusca = apenasDigitos(termo);
  const campos = {
    cliente: [cliente.nome, cliente.razao_social],
    documento: [cliente.cnpj, cliente.cnpj_digitos],
    telefone: [contato.receita, contato.google, contato.whatsapp, contato.fixo, cliente.telefone_receita, cliente.telefone_google, `${cliente.whatsapp_ddd || ''}${cliente.whatsapp_numero || ''}`, `${cliente.fixo_ddd || ''}${cliente.fixo_numero || ''}`],
    email: [cliente.email],
    responsavel: [cliente.responsavel_nome, cliente.responsavel_tipo],
    geral: [
      cliente.nome,
      cliente.razao_social,
      cliente.cnpj,
      cliente.cnpj_digitos,
      cliente.email,
      cliente.responsavel_nome,
      contato.receita,
      contato.google,
      contato.whatsapp,
      contato.fixo
    ]
  };

  return (campos[campo] || campos.geral).some(valor => {
    const texto = String(valor || '');
    const textoNormalizado = normalizarBusca(texto);
    const textoDigitos = apenasDigitos(texto);
    return textoNormalizado.includes(busca) || (digitosBusca && textoDigitos.includes(digitosBusca));
  });
}

function ClientesSecretosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const usuario = getUsuarioLocal();
  const usuarioId = Number(usuario?.id);
  const podeCriar = temPermissao(usuario, 'clientes_secretos_criar');
  const podeEditar = temPermissao(usuario, 'clientes_secretos_editar');
  const podeExcluir = temPermissao(usuario, 'clientes_secretos_excluir');
  const [clientes, setClientes] = useState([]);
  const [operadoras, setOperadoras] = useState([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [clienteModal, setClienteModal] = useState(null);
  const [clienteModalSomenteNotas, setClienteModalSomenteNotas] = useState(false);
  const [clienteCadastroDraft, setClienteCadastroDraft] = useState(null);
  const [buscaCampo, setBuscaCampo] = useState('geral');
  const [busca, setBusca] = useState('');
  const [responsavelTipo, setResponsavelTipo] = useState('');
  const [fidelidade, setFidelidade] = useState('');
  const [chipsMin, setChipsMin] = useState('');
  const [chipsMax, setChipsMax] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);
  const aberturaNotificacaoProcessadaRef = useRef('');

  const buscaDeferred = useDeferredValue(busca);
  const buscaDebounced = useDebounce(buscaDeferred, 300);

  const filtrosPopupAtivos = useMemo(() => (
    [responsavelTipo, fidelidade, chipsMin, chipsMax].filter(v => v !== '').length
  ), [responsavelTipo, fidelidade, chipsMin, chipsMax]);

  const clientesFiltrados = useMemo(() => (
    clientes.filter(cliente => {
      if (!clienteCasaComBusca(cliente, buscaCampo, buscaDebounced)) return false;
      if (responsavelTipo && cliente.responsavel_tipo !== responsavelTipo) return false;
      if (chipsMin !== '' && Number(cliente.quantidade_chips || 0) < Number(chipsMin)) return false;
      if (chipsMax !== '' && Number(cliente.quantidade_chips || 0) > Number(chipsMax)) return false;

      if (fidelidade) {
        const estado = formatarFidelidade(cliente);
        if (fidelidade === 'sem' && estado.label !== 'Sem fidelidade') return false;
        if (fidelidade === 'vencida' && estado.className !== 'danger') return false;
        if (fidelidade === 'alerta' && estado.className !== 'warn') return false;
        if (fidelidade === 'ativa' && !['warn', 'success'].includes(estado.className)) return false;
      }

      return true;
    })
  ), [clientes, buscaCampo, buscaDebounced, responsavelTipo, fidelidade, chipsMin, chipsMax]);

  const filtrosAtivos = useMemo(() => (
    filtrosPopupAtivos + (buscaDebounced ? 1 : 0)
  ), [filtrosPopupAtivos, buscaDebounced]);

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

  async function carregar() {
    setErro('');
    setCarregando(true);
    try {
      const [clientesData, operadorasData] = await Promise.all([
        listarClientesSecretos(),
        listarOperadoras()
      ]);
      setClientes(Array.isArray(clientesData) ? clientesData : []);
      setOperadoras(Array.isArray(operadorasData) ? operadorasData : []);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar leads.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;

    Promise.all([listarClientesSecretos(), listarOperadoras()])
      .then(([clientesData, operadorasData]) => {
        if (!ativo) return;
        setClientes(Array.isArray(clientesData) ? clientesData : []);
        setOperadoras(Array.isArray(operadorasData) ? operadorasData : []);
        setErro('');
      })
      .catch(error => {
        if (ativo) setErro(error.message || 'Erro ao carregar leads.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    const clienteId = searchParams.get('cliente_id');
    const notificacaoId = getNotificacaoIdParam(searchParams);
    if (carregando || !clienteId || !notificacaoId) return;
    const chaveAbertura = `${clienteId}:${notificacaoId}`;
    if (aberturaNotificacaoProcessadaRef.current === chaveAbertura) return;
    aberturaNotificacaoProcessadaRef.current = chaveAbertura;
    const cliente = clientes.find(item => String(item.id) === String(clienteId));
    if (!cliente) {
      falharAberturaNotificacao(notificacaoId);
      queueMicrotask(() => setErro('O lead desta notificação não está mais disponível.'));
      return;
    }

    queueMicrotask(() => {
      setClienteModal(cliente);
      setClienteModalSomenteNotas(searchParams.get('aba') === 'notas');
      setModalAberto(true);
      void confirmarAberturaNotificacao(notificacaoId).catch(error => {
        console.error('Erro ao confirmar abertura da notificacao:', error);
      });
    });
  }, [carregando, clientes, searchParams]);

  function alterarBuscaCampo(campo) {
    setBuscaCampo(campo || 'geral');
    setBusca('');
  }

  function alterarBuscaValor(valor) {
    setBusca(formatarBuscaClientesPorCampo(buscaCampo, valor));
  }

  function limparFiltros() {
    setResponsavelTipo('');
    setFidelidade('');
    setChipsMin('');
    setChipsMax('');
  }

  function podeGerenciarCliente(cliente) {
    return Number(cliente?.criado_por_id) === usuarioId;
  }

  function podeEditarCliente(cliente) {
    return podeEditar && podeGerenciarCliente(cliente);
  }

  function podeExcluirCliente(cliente) {
    return podeExcluir && podeGerenciarCliente(cliente);
  }

  function abrirNovoLead() {
    if (!podeCriar) return;
    setClienteModal(null);
    setClienteModalSomenteNotas(false);
    setModalAberto(true);
  }

  function abrirCliente(cliente) {
    if (!podeEditarCliente(cliente)) return;
    setClienteModal(cliente);
    setClienteModalSomenteNotas(false);
    setModalAberto(true);
  }

  async function salvarLead() {
    const editando = Boolean(clienteModal);
    setModalAberto(false);
    setClienteModal(null);
    if (!editando) {
      setClienteCadastroDraft(null);
    }
    await carregar();
    setSucesso(editando ? 'Lead atualizado com sucesso.' : 'Lead cadastrado com sucesso.');
  }

  async function excluir(cliente) {
    if (!podeExcluirCliente(cliente)) return;
    if (!window.confirm(`Excluir o lead ${cliente.nome}?`)) return;
    setExcluindoId(cliente.id);
    setErro('');
    setSucesso('');
    try {
      await excluirClienteSecreto(cliente.id);
      setClientes(prev => prev.filter(item => item.id !== cliente.id));
      setSucesso('Lead excluído com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir lead.');
    } finally {
      setExcluindoId(null);
    }
  }

  const colSpan = podeExcluir ? 10 : 9;

  return (
    <LayoutPrivado>
      {modalAberto && (
        <ClienteModal
          cliente={clienteModal}
          operadoras={operadoras}
          entidade="lead"
          draftKey="cliente_secreto_novo"
          criarFn={criarClienteSecreto}
          atualizarFn={atualizarClienteSecreto}
          verificarDocumentoFn={verificarDocumentoClienteSecreto}
          initialDraft={clienteCadastroDraft}
          initialTab={clienteModalSomenteNotas ? 'notas' : 'cliente'}
          notesOnly={clienteModalSomenteNotas}
          onDraftChange={setClienteCadastroDraft}
          onClose={() => {
            setModalAberto(false);
            setClienteModal(null);
            setClienteModalSomenteNotas(false);
            if (searchParams.has('notificacao_id')) setSearchParams({}, { replace: true });
          }}
          onSave={salvarLead}
        />
      )}

      {filtrosAbertos && (
        <div className="filtros-popup-overlay" onClick={() => setFiltrosAbertos(false)}>
          <div className="filtros-popup" onClick={event => event.stopPropagation()}>
            <div className="filtros-popup__header">
              <span>Filtros</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setFiltrosAbertos(false)}>
                <I.Close size={14} />
              </button>
            </div>
            <div className="filtros-popup__body">
              <div className="filter-field">
                <label>Responsavel</label>
                <SelectFiltro
                  value={responsavelTipo}
                  onChange={setResponsavelTipo}
                  placeholder="Todos"
                  searchable={false}
                  options={[
                    { value: 'rl', label: 'RL' },
                    { value: 'adm', label: 'ADM' }
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>Fidelidade</label>
                <SelectFiltro
                  value={fidelidade}
                  onChange={setFidelidade}
                  placeholder="Todas"
                  searchable={false}
                  options={[
                    { value: 'ativa', label: 'Ativa' },
                    { value: 'alerta', label: 'Com alerta' },
                    { value: 'vencida', label: 'Vencida' },
                    { value: 'sem', label: 'Sem fidelidade' }
                  ]}
                />
              </div>
              <div className="filter-field">
                <label>Chips min.</label>
                <input type="number" min="0" value={chipsMin} onChange={event => setChipsMin(event.target.value)} />
              </div>
              <div className="filter-field">
                <label>Chips max.</label>
                <input type="number" min="0" value={chipsMax} onChange={event => setChipsMax(event.target.value)} />
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
            {clientesFiltrados.length} de {clientes.length} leads
            {filtrosAtivos > 0 ? ` - ${filtrosAtivos} filtro(s) ativo(s)` : ''}
          </div>

          <div className="clientes-toolbar__actions">
            <form className="clientes-busca" onSubmit={event => event.preventDefault()}>
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

            {podeCriar && (
              <button type="button" className="btn btn-primary" onClick={abrirNovoLead}>
                <I.Plus size={14} /> Novo lead
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
                  {podeExcluir && <th>Excluir</th>}
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr>
                    <td colSpan={colSpan} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Carregando leads...
                    </td>
                  </tr>
                ) : clientesFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="muted" style={{ textAlign: 'center', padding: 40 }}>
                      Nenhum lead encontrado.
                    </td>
                  </tr>
                ) : (
                  clientesFiltrados.map(cliente => {
                    const contato = formatarContato(cliente);
                    const fidelidadeResumo = formatarFidelidade(cliente);
                    const resumoOperadoras = formatarResumoOperadoras(cliente);
                    const podeEditarEsteCliente = podeEditarCliente(cliente);
                    const podeExcluirEsteCliente = podeExcluirCliente(cliente);

                    return (
                      <tr
                        key={cliente.id}
                        className={podeEditarEsteCliente ? 'clickable-row is-tappable' : ''}
                        role={podeEditarEsteCliente ? 'button' : undefined}
                        tabIndex={podeEditarEsteCliente ? 0 : undefined}
                        onClick={() => abrirCliente(cliente)}
                        onKeyDown={(event) => {
                          if (!podeEditarEsteCliente) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            abrirCliente(cliente);
                          }
                        }}
                      >
                        <td data-label="Cliente" className="m-primary">
                          <div className="cliente-primary">
                            <div className="cliente-primary__title">
                              <strong>{cliente.nome}</strong>
                            </div>
                            <div className="cliente-primary__badges">
                              <span className="tag clientes-base-tag">Lead</span>
                            </div>
                            <span className="cliente-primary__document">{cliente.razao_social || 'Sem razao social'} - {cliente.cnpj || 'Sem CNPJ'}</span>
                            <details className="cliente-mobile-drawer" onClick={event => event.stopPropagation()}>
                              <summary>Ver detalhes</summary>
                              <dl>
                                <dt>Responsavel</dt>
                                <dd>{cliente.responsavel_tipo === 'adm' ? 'ADM' : 'RL'} {cliente.responsavel_nome || '-'}</dd>
                                <dt>Contato</dt>
                                <dd>{cliente.email || '-'} / {contato.principal || '-'}</dd>
                                <dt>Operadora</dt>
                                <dd title={resumoOperadoras.detalhe}>{resumoOperadoras.titulo}</dd>
                                <dt>Registrado por</dt>
                                <dd>{cliente.criador?.nome || 'Voce'}</dd>
                                <dt>Criado em</dt>
                                <dd>{formatarData(cliente.created_at)}</dd>
                                <dt>Valor pago</dt>
                                <dd>{formatarMoeda(cliente.valor_pago)}</dd>
                                <dt>Chips</dt>
                                <dd>{cliente.quantidade_chips ?? '-'}</dd>
                                {podeExcluirEsteCliente && (
                                  <>
                                    <dt>Ações</dt>
                                    <dd>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-ghost btn-danger-icon cliente-mobile-delete-btn"
                                        disabled={excluindoId === cliente.id}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          excluir(cliente);
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
                            <span title={contato.todos.join(' / ')}>{contato.principal || '-'}</span>
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
                          <span className="tag">{cliente.criador?.nome || 'Voce'}</span>
                        </td>
                        <td data-label="Criado em" data-mobile-hidden="true">{formatarData(cliente.created_at)}</td>
                        <td data-label="Valor pago" data-mobile-hidden="true">{formatarMoeda(cliente.valor_pago)}</td>
                        <td data-label="Chips" data-mobile-hidden="true">{cliente.quantidade_chips ?? '-'}</td>
                        <td data-label="Fidelidade" className="m-meta">
                          <span className={`pill ${fidelidadeResumo.className}`}>
                            <span className="pill-dot"></span>
                            {fidelidadeResumo.label}
                          </span>
                        </td>
                        {podeExcluir && (
                          <td data-label="Excluir">
                            {podeExcluirEsteCliente && (
                              <div className="clientes-actions">
                                <button
                                  type="button"
                                  className="btn btn-icon btn-ghost btn-danger-icon"
                                  title="Excluir"
                                  disabled={excluindoId === cliente.id}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    excluir(cliente);
                                  }}
                                >
                                  <I.Trash size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default ClientesSecretosPage;
