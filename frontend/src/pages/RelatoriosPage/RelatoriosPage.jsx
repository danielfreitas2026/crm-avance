import { useNavigationState } from '../../utils/useNavigationState';
import { Fragment, useEffect, useMemo, useState } from 'react';
import LayoutPrivado from '../../layouts/LayoutPrivado/LayoutPrivado';
import * as I from '../../components/Icons';
import { listarVendedoras, obterRelatoriosVendas } from '../../services/venda.service';
import './RelatoriosPage.css';

const PERIODOS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana_atual', label: 'Semana' },
  { value: 'mes_atual', label: 'Mês atual' },
  { value: 'ultimos_30_dias', label: '30 dias' },
  { value: 'personalizado', label: 'Personalizado' }
];

const OPERATOR_COLORS = {
  Vivo: '#7c3aed',
  TIM: '#2563eb',
  Claro: '#dc2626'
};

// Paleta de reserva para operadoras fora da lista fixa.
const FALLBACK_COLORS = ['#0891b2', '#ea580c', '#16a34a', '#db2777', '#ca8a04', '#4f46e5'];

const EMPTY_REPORT = {
  periodo: { tipo: 'mes_atual', data_inicio: '', data_fim: '' },
  filtros: { vendedora_id: null },
  cards: {
    vendasAndamento: { quantidade: 0, valor: 0 },
    concluidas: { quantidade: 0, valor: 0 },
    perdaRetorno: { quantidade: 0, valor: 0, chips: 0 },
    taxaRetorno: { percentual: 0, chipsRetornados: 0, chipsVendidos: 0 }
  },
  resumoPeriodo: { totalVendas: 0, valorTotal: 0, ticketMedio: 0 },
  comparativo: {
    concluidas: { valor: 0 },
    taxaRetorno: { percentual: 0 },
    vendasAndamento: { quantidade: 0 },
    ticketMedio: 0,
    totalVendas: 0
  },
  serieDiaria: [],
  motivosRetorno: [],
  vendasPorFase: [],
  porOperadora: [],
  rankingVendedores: []
};

// === Helpers ===
/**
 * Formata moeda para exibicao ou envio.
 */
function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Obtem iniciais a partir dos dados informados.
 */
function obterIniciais(nome = '') {
  const iniciais = nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(parte => parte[0])
    .join('')
    .toUpperCase();

  return iniciais || '--';
}

/**
 * Processa nice max conforme as regras do dominio.
 */
function niceMax(v) {
  if (v <= 0) return 10;
  const exp = Math.floor(Math.log10(v));
  const f = v / Math.pow(10, exp);
  let nice;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

/**
 * Formata compact brl para exibicao.
 */
function fmtCompactBRL(v) {
  if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1).replace('.', ',')}M`;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',')}k`;
  return `R$ ${v.toFixed(0)}`;
}

/**
 * Converte isodate para o formato interno esperado.
 */
function parseISODate(iso) {
  if (!iso) return null;
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia);
}

/**
 * Formata dia mes para exibicao.
 */
function fmtDiaMes(iso) {
  const data = parseISODate(iso);
  if (!data) return '';
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

/**
 * Formata range para exibicao.
 */
function fmtRange(inicio, fim) {
  const ini = fmtDiaMes(inicio);
  const end = fmtDiaMes(fim);
  if (!ini && !end) return '';
  return `${ini} — ${end}`;
}

/**
 * Processa delta text conforme as regras do dominio.
 */
function deltaText(curr, prev) {
  if (prev === 0 && curr === 0) return { sign: 0, abs: 0, pct: 0 };
  const abs = curr - prev;
  const pct = prev !== 0 ? (abs / prev) * 100 : (curr > 0 ? 100 : 0);
  return { sign: Math.sign(abs), abs: Math.abs(abs), pct: Math.abs(pct) };
}

/**
 * Retorna operadora cor no formato esperado pelo fluxo.
 */
function operadoraCor(nome, indice) {
  return OPERATOR_COLORS[nome] || FALLBACK_COLORS[indice % FALLBACK_COLORS.length];
}

// === Sparkline (pequeno, inline) ===
/**
 * Processa sparkline conforme as regras do dominio.
 */
function Sparkline({ values, accent = 'var(--text)', w = 80, h = 24 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 1.5 - ((v - min) / range) * (h - 3);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = pts.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" className="spark-inline">
      <polygon points={area} fill={accent} opacity="0.1" />
      <polyline points={line} stroke={accent} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// === Gráfico de linha com média e destaque de pico ===
/**
 * Renderiza line chart com os dados informados.
 */
function LineChart({ data, height = 280, color = '#4f46e5' }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const W = 800;
  const H = height;
  const pad = { top: 32, right: 24, bottom: 36, left: 64 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const values = data.map(d => d.revenue);
  const maxRaw = Math.max(...values, 1);
  const maxV = niceMax(maxRaw * 1.2);
  const total = values.reduce((s, x) => s + x, 0);
  const avg = total / values.length;
  const peakIdx = values.indexOf(maxRaw);

  /**
   * Processa x s conforme as regras do dominio.
   */
  const xS = (i) => pad.left + (i / Math.max(data.length - 1, 1)) * innerW;
  /**
   * Processa y s conforme as regras do dominio.
   */
  const yS = (v) => pad.top + (1 - v / maxV) * innerH;
  const pts = data.map((d, i) => [xS(i), yS(d.revenue)]);
  const linePts = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaPts = `${pad.left},${(pad.top + innerH).toFixed(1)} ${linePts} ${(pad.left + innerW).toFixed(1)},${(pad.top + innerH).toFixed(1)}`;
  const yTicks = 4;
  const xStep = Math.max(1, Math.floor(data.length / 6));
  const peakX = pts[peakIdx][0];
  const peakY = pts[peakIdx][1];
  const avgY = yS(avg);
  const hoveredPoint = hoverIdx !== null ? pts[hoverIdx] : null;
  const hoveredItem = hoverIdx !== null ? data[hoverIdx] : null;
  const hoverTooltipX = hoveredPoint
    ? Math.min(Math.max(hoveredPoint[0] - 64, pad.left), pad.left + innerW - 128)
    : 0;
  const hoverTooltipY = hoveredPoint
    ? Math.max(hoveredPoint[1] - 48, pad.top + 4)
    : 0;
  const hoverGuideY = hoveredPoint
    ? Math.min(hoveredPoint[1] - 8, hoverTooltipY + 30)
    : 0;

  /**
   * Trata o evento de mouse move.
   */
  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = ((event.clientX - rect.left) / rect.width) * W;
    const mouseY = ((event.clientY - rect.top) / rect.height) * H;

    if (
      mouseX < pad.left ||
      mouseX > pad.left + innerW ||
      mouseY < pad.top ||
      mouseY > pad.top + innerH
    ) {
      setHoverIdx(null);
      return;
    }

    const relativeX = (mouseX - pad.left) / innerW;
    const nextIdx = Math.min(
      data.length - 1,
      Math.max(0, Math.round(relativeX * Math.max(data.length - 1, 1)))
    );
    setHoverIdx(nextIdx);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart-line"
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Gridlines Y + rótulos */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = (maxV / yTicks) * i;
        const y = yS(v);
        return (
          <g key={i}>
            <line
              x1={pad.left} y1={y}
              x2={pad.left + innerW} y2={y}
              stroke={i === 0 ? 'var(--border-strong)' : 'var(--border)'}
              strokeDasharray={i === 0 ? '' : '2,3'}
            />
            <text
              x={pad.left - 10} y={y}
              fill="var(--text-3)" fontSize="11"
              textAnchor="end" dominantBaseline="middle"
            >
              {fmtCompactBRL(v)}
            </text>
          </g>
        );
      })}

      {/* Linha de média */}
      {avg > 0 && (
        <g>
          <line
            x1={pad.left} y1={avgY}
            x2={pad.left + innerW} y2={avgY}
            stroke="var(--text-3)" strokeWidth="1"
            strokeDasharray="4,4" opacity="0.7"
          />
          <rect
            x={pad.left + innerW - 86} y={avgY - 9}
            width={84} height={16} rx={3}
            fill="var(--surface)" stroke="var(--border)"
          />
          <text
            x={pad.left + innerW - 80} y={avgY + 1}
            fill="var(--text-2)" fontSize="10.5"
            dominantBaseline="middle"
          >
            <tspan fill="var(--text-3)">Média </tspan>
            <tspan fontFamily="var(--font-mono)" fontWeight="600" fill="var(--text)">{fmtCompactBRL(avg)}</tspan>
          </text>
        </g>
      )}

      {/* Área + linha */}
      <defs>
        <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#chart-area-grad)" />
      <polyline points={linePts} stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />

      {/* Pontos */}
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === peakIdx ? 4.5 : 2.5}
          fill={i === peakIdx ? color : 'var(--surface)'}
          stroke={color} strokeWidth="1.5" />
      ))}

      {/* Destaque do pico */}
      {maxRaw > 0 && (
        <g>
          <line
            x1={peakX} y1={peakY - 8}
            x2={peakX} y2={peakY - 22}
            stroke={color} strokeWidth="1"
          />
          <rect
            x={Math.min(Math.max(peakX - 60, pad.left), pad.left + innerW - 120)}
            y={peakY - 38}
            width="120" height="22" rx="4"
            fill={color}
          />
          <text
            x={Math.min(Math.max(peakX - 60, pad.left), pad.left + innerW - 120) + 60}
            y={peakY - 23}
            fill="white" fontSize="10.5"
            textAnchor="middle" dominantBaseline="middle"
          >
            <tspan opacity="0.75">PICO · </tspan>
            <tspan fontFamily="var(--font-mono)" fontWeight="600">{fmtCompactBRL(maxRaw)}</tspan>
          </text>
        </g>
      )}

      {/* Valor ao passar o mouse */}
      {hoveredPoint && hoveredItem && (
        <g pointerEvents="none">
          <line
            x1={hoveredPoint[0]} y1={hoveredPoint[1] - 8}
            x2={hoveredPoint[0]} y2={hoverGuideY}
            stroke={color} strokeWidth="1"
          />
          <circle
            cx={hoveredPoint[0]} cy={hoveredPoint[1]} r="4.5"
            fill={color}
            stroke="var(--surface)" strokeWidth="2"
          />
          <rect
            x={hoverTooltipX}
            y={hoverTooltipY}
            width="128" height="32" rx="4"
            fill={color}
          />
          <text
            x={hoverTooltipX + 64}
            y={hoverTooltipY + 11}
            fill="white" fontSize="9.5"
            textAnchor="middle" dominantBaseline="middle"
          >
            {hoveredItem.date ? hoveredItem.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
          </text>
          <text
            x={hoverTooltipX + 64}
            y={hoverTooltipY + 23}
            fill="white" fontSize="10.5"
            textAnchor="middle" dominantBaseline="middle"
            fontFamily="var(--font-mono)" fontWeight="600"
          >
            {fmtCompactBRL(hoveredItem.revenue)}
          </text>
        </g>
      )}

      {/* Rótulos do eixo X */}
      {data.map((d, i) => (
        i % xStep === 0 && (
          <text key={i} x={xS(i)} y={H - 12}
            fill="var(--text-3)" fontSize="10.5"
            textAnchor="middle">
            {d.date ? d.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
          </text>
        )
      ))}
    </svg>
  );
}

// === Donut ===
/**
 * Renderiza donut com os dados informados.
 */
function Donut({ slices, size = 170, thickness = 24, center }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut-svg">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
      {slices.map((s, i) => {
        const frac = s.value / total;
        const seg = frac * circ;
        const acc = slices.slice(0, i).reduce((sum, x) => sum + x.value / total, 0);
        return (
          <circle key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${seg.toFixed(2)} ${(circ - seg).toFixed(2)}`}
            strokeDashoffset={(-acc * circ).toFixed(2)}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        );
      })}
      {center && (
        <g>
          <text x={cx} y={cy - 7} textAnchor="middle"
            fontSize="10" fill="var(--text-3)"
            style={{ letterSpacing: '0.08em' }}>
            {center.label}
          </text>
          <text x={cx} y={cy + 11} textAnchor="middle"
            fontSize="18" fontWeight="700"
            fill="var(--text)" fontFamily="var(--font-mono)"
            style={{ letterSpacing: '-0.02em' }}>
            {center.value}
          </text>
          {center.sub && (
            <text x={cx} y={cy + 26} textAnchor="middle"
              fontSize="10" fill="var(--text-3)"
              fontFamily="var(--font-mono)">
              {center.sub}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

// === Delta inline ===
/**
 * Processa delta conforme as regras do dominio.
 */
function Delta({ value, suffix = '%', inverse = false }) {
  const positive = value > 0;
  const negative = value < 0;
  // inverse = subir é ruim (ex.: retornos)
  const goodClass = inverse
    ? (negative ? 'up' : positive ? 'down' : '')
    : (positive ? 'up' : negative ? 'down' : '');
  return (
    <span className={`delta ${goodClass}`}>
      {positive ? '↑' : negative ? '↓' : '—'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

/**
 * Processa empty state conforme as regras do dominio.
 */
function EmptyState({ children, style }) {
  return <div className="empty" style={style}>{children}</div>;
}

/**
 * Renderiza relatorios page.
 */
function RelatoriosPage() {
  const [periodo, setPeriodo] = useNavigationState('RelatoriosPage:periodo', 'mes_atual');
  const [dataInicio, setDataInicio] = useNavigationState('RelatoriosPage:dataInicio', '');
  const [dataFim, setDataFim] = useNavigationState('RelatoriosPage:dataFim', '');
  const [vendedoraId, setVendedoraId] = useNavigationState('RelatoriosPage:vendedoraId', '');
  const [vendedoras, setVendedoras] = useState([]);
  const [relatorio, setRelatorio] = useState(EMPTY_REPORT);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listarVendedoras()
      .then(setVendedoras)
      .catch(error => setErro(error.message || 'Erro ao listar usuários.'));
  }, []);

  useEffect(() => {
    let ativo = true;

    /**
     * Carrega relatorio e atualiza o estado relacionado.
     */
    async function carregarRelatorio() {
      setCarregando(true);
      setErro('');

      try {
        const filtros = {
          periodo,
          vendedora_id: vendedoraId
        };

        if (periodo === 'personalizado') {
          filtros.data_inicio = dataInicio;
          filtros.data_fim = dataFim;
        }

        const data = await obterRelatoriosVendas(filtros);

        if (ativo) {
          setRelatorio({ ...EMPTY_REPORT, ...(data || {}) });
        }
      } catch (error) {
        if (ativo) {
          setErro(error.message || 'Erro ao carregar relatórios.');
          setRelatorio(EMPTY_REPORT);
        }
      } finally {
        if (ativo) {
          setCarregando(false);
        }
      }
    }

    carregarRelatorio();

    return () => {
      ativo = false;
    };
  }, [periodo, dataInicio, dataFim, vendedoraId, refreshKey]);

  const cards = relatorio.cards || EMPTY_REPORT.cards;
  const resumo = relatorio.resumoPeriodo || EMPTY_REPORT.resumoPeriodo;
  const comparativo = relatorio.comparativo || EMPTY_REPORT.comparativo;
  const serie = useMemo(() => relatorio.serieDiaria || [], [relatorio.serieDiaria]);
  const mostrarDatas = periodo === 'personalizado';

  // Série para o gráfico e sparklines
  const chartData = useMemo(
    () => serie
      .filter(d => Number(d.receita || 0) > 0)
      .map(d => ({ date: parseISODate(d.data), revenue: Number(d.receita || 0) })),
    [serie]
  );
  const sparkRevenue = serie.map(d => Number(d.receita || 0));
  const sparkCount = serie.map(d => Number(d.quantidade || 0));
  const sparkReturns = serie.map(d => Number(d.retornos || 0));
  const sparkTicket = serie.map(d => (d.quantidade > 0 ? d.receita / d.quantidade : 0));

  const totalRevSeries = sparkRevenue.reduce((s, x) => s + x, 0);
  const avgRev = serie.length > 0 ? totalRevSeries / serie.length : 0;
  const peakDay = serie.reduce((best, d) => (Number(d.receita || 0) > Number(best?.receita || 0) ? d : best), serie[0] || null);
  const activeDaysCount = serie.filter(d => Number(d.quantidade || 0) > 0).length;

  // Deltas
  const revD = deltaText(cards.concluidas.valor, comparativo.concluidas.valor);
  const ticketD = deltaText(resumo.ticketMedio, comparativo.ticketMedio);
  const returnDelta = cards.taxaRetorno.percentual - comparativo.taxaRetorno.percentual;

  // Operadoras (donut)
  const byOp = useMemo(() => (
    (relatorio.porOperadora || [])
      .filter(o => Number(o.valor || 0) > 0)
      .map((o, i) => ({
        name: o.nome,
        value: Number(o.valor || 0),
        count: Number(o.vendas || 0),
        color: operadoraCor(o.nome, i)
      }))
  ), [relatorio.porOperadora]);
  const totalOpValue = byOp.reduce((s, x) => s + x.value, 0) || 1;
  const leader = byOp[0];

  // Funil cumulativo (derivado das fases, excluindo a etapa de retorno)
  const cumulative = useMemo(() => {
    const fases = (relatorio.vendasPorFase || []).filter(f => f.id !== 'retorno');
    return fases.map((fase, i) => ({
      id: fase.id,
      name: fase.nome,
      count: fases.slice(i).reduce((s, f) => s + Number(f.vendas || 0), 0)
    }));
  }, [relatorio.vendasPorFase]);
  const maxFunnel = cumulative[0]?.count || 1;
  const totalConv = maxFunnel > 0
    ? (cumulative[cumulative.length - 1]?.count / maxFunnel) * 100
    : 0;

  // Etapas anotadas: % do topo + queda em relação à etapa anterior
  const funnelStages = useMemo(() => cumulative.map((st, i) => {
    const prev = i > 0 ? cumulative[i - 1].count : null;
    const drop = prev !== null ? prev - st.count : 0;
    const dropPct = prev && prev > 0 ? (drop / prev) * 100 : 0;
    return {
      ...st,
      index: i,
      pct: (st.count / maxFunnel) * 100,
      prevName: prev !== null ? cumulative[i - 1].name : null,
      drop,
      dropPct
    };
  }), [cumulative, maxFunnel]);

  // Maior gargalo (etapa com a maior queda absoluta)
  const gargaloIdx = useMemo(() => {
    let idx = -1;
    let maior = 0;
    funnelStages.forEach(st => {
      if (st.drop > maior) { maior = st.drop; idx = st.index; }
    });
    return idx;
  }, [funnelStages]);
  const gargalo = gargaloIdx >= 0 ? funnelStages[gargaloIdx] : null;
  const concluidas = cumulative[cumulative.length - 1]?.count ?? 0;
  const ultimoIdx = funnelStages.length - 1;

  // Motivos de retorno
  const reasons = relatorio.motivosRetorno || [];
  const totalReturns = reasons.reduce((s, x) => s + Number(x.quantidade || 0), 0) || 1;

  // Ranking
  const ranking = relatorio.rankingVendedores || [];
  const maxRank = Math.max(...ranking.map(r => Number(r.valor || 0)), 1);
  const totalRank = ranking.reduce((s, x) => s + Number(x.valor || 0), 0) || 1;
  const rankingAtivos = ranking.filter(r => Number(r.vendas || 0) > 0).length;

  return (
    <LayoutPrivado>
      <div className="reports">
        {/* Toolbar */}
        <div className="reports-toolbar">
          <div className="period-block">
            <div className="period-tabs">
              {PERIODOS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className={`period-tab ${periodo === p.value ? 'active' : ''}`}
                  onClick={() => setPeriodo(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {mostrarDatas && (
              <div className="period-custom">
                <input type="date" value={dataInicio} onChange={event => setDataInicio(event.target.value)} />
                <span>—</span>
                <input type="date" value={dataFim} onChange={event => setDataFim(event.target.value)} />
              </div>
            )}
            <div className="period-range">
              <I.Calendar size={12} /> {fmtRange(relatorio.periodo?.data_inicio, relatorio.periodo?.data_fim)}
            </div>
          </div>
          <div className="reports-actions">
            <label className="reports-seller">
              <span className="sr-only">Usuário</span>
              <select value={vendedoraId} onChange={event => setVendedoraId(event.target.value)}>
                <option value="">Todos os usuários</option>
                {vendedoras.map(usuario => (
                  <option key={usuario.id} value={usuario.id}>
                    {usuario.nome || usuario.email}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setRefreshKey(k => k + 1)}
              disabled={carregando}
            >
              <I.Refresh size={12} /> Atualizar
            </button>
          </div>
        </div>

        {erro && <div className="alert-error" style={{ marginBottom: 14 }}>{erro}</div>}

        {/* Insight */}
        <div className="insight-bar">
          <div className="insight-row">
            <I.Chart size={14} />
            <div>
              <strong>{resumo.totalVendas} vendas</strong> registradas no período,
              somando <strong>{formatarMoeda(resumo.valorTotal)}</strong>.
              {leader && (
                <> Operadora líder: <strong>{leader.name}</strong> ({((leader.value / totalOpValue) * 100).toFixed(0)}%).</>
              )}
              {ranking[0] && Number(ranking[0].valor) > 0 && (
                <> Top usuário: <strong>{ranking[0].nome}</strong> ({formatarMoeda(ranking[0].valor)}).</>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-grid">
          <div className="kpi-card kpi-revenue">
            <div className="kpi-head">
              <div>
                <div className="kpi-label">Receita concluída</div>
                <div className="kpi-sublabel">vendas em "Concluído"</div>
              </div>
              <Sparkline values={sparkRevenue} accent="#10b981" />
            </div>
            <div className="kpi-value">{formatarMoeda(cards.concluidas.valor)}</div>
            <div className="kpi-foot">
              <Delta value={revD.sign * revD.pct} />
              <span className="abs">
                {revD.sign > 0 ? '+' : revD.sign < 0 ? '−' : ''}{fmtCompactBRL(revD.abs)} vs. anterior
              </span>
            </div>
          </div>

          <div className="kpi-card kpi-active">
            <div className="kpi-head">
              <div>
                <div className="kpi-label">Em andamento</div>
                <div className="kpi-sublabel">vendas no pipeline</div>
              </div>
              <Sparkline values={sparkCount} accent="#4f46e5" />
            </div>
            <div className="kpi-value">{cards.vendasAndamento.quantidade}</div>
            <div className="kpi-foot">
              <span className="pipeline-val">{formatarMoeda(cards.vendasAndamento.valor)}</span>
              <span className="abs">em valor a faturar</span>
            </div>
          </div>

          <div className="kpi-card kpi-return">
            <div className="kpi-head">
              <div>
                <div className="kpi-label">Taxa de retorno</div>
                <div className="kpi-sublabel">% chips devolvidos</div>
              </div>
              <Sparkline values={sparkReturns} accent="#dc2626" />
            </div>
            <div className="kpi-value">{Number(cards.taxaRetorno.percentual || 0).toFixed(1)}%</div>
            <div className="kpi-foot">
              <Delta value={returnDelta} suffix=" p.p." inverse />
              <span className="abs">
                {cards.perdaRetorno.chips} {cards.perdaRetorno.chips === 1 ? 'chip retornou' : 'chips retornaram'}
              </span>
            </div>
          </div>

          <div className="kpi-card kpi-ticket">
            <div className="kpi-head">
              <div>
                <div className="kpi-label">Ticket médio</div>
                <div className="kpi-sublabel">valor médio por venda</div>
              </div>
              <Sparkline values={sparkTicket} accent="#7c3aed" />
            </div>
            <div className="kpi-value">{formatarMoeda(resumo.ticketMedio)}</div>
            <div className="kpi-foot">
              <Delta value={ticketD.sign * ticketD.pct} />
              <span className="abs">{resumo.totalVendas} vendas analisadas</span>
            </div>
          </div>
        </div>

        {/* Linha 1: receita diária + operadoras */}
        <div className="reports-row r-2">
          <div className="panel report-panel">
            <div className="panel-header">
              <div className="title-block">
                <h3>Receita diária</h3>
                <div className="sub">R$ por dia · {serie.length} dias</div>
              </div>
              <div className="chart-summary">
                <div className="cs-item">
                  <span className="cs-label">Total</span>
                  <span className="cs-val">{fmtCompactBRL(totalRevSeries)}</span>
                </div>
                <div className="cs-sep"></div>
                <div className="cs-item">
                  <span className="cs-label">Média/dia</span>
                  <span className="cs-val">{fmtCompactBRL(avgRev)}</span>
                </div>
                <div className="cs-sep"></div>
                <div className="cs-item">
                  <span className="cs-label">Pico</span>
                  <span className="cs-val">{fmtCompactBRL(Number(peakDay?.receita || 0))}</span>
                  <span className="cs-sublabel">{fmtDiaMes(peakDay?.data)}</span>
                </div>
                <div className="cs-sep"></div>
                <div className="cs-item">
                  <span className="cs-label">Dias ativos</span>
                  <span className="cs-val">{activeDaysCount}/{serie.length}</span>
                </div>
              </div>
            </div>
            <div className="panel-body" style={{ padding: '4px 12px 8px' }}>
              {chartData.length > 0 ? (
                <LineChart data={chartData} height={280} />
              ) : (
                <EmptyState style={{ padding: '40px 8px' }}>Sem dados suficientes no período.</EmptyState>
              )}
            </div>
          </div>

          <div className="panel report-panel">
            <div className="panel-header">
              <div className="title-block">
                <h3>Por operadora</h3>
                <div className="sub">Receita total no período</div>
              </div>
            </div>
            <div className="panel-body">
              {byOp.length === 0 ? (
                <EmptyState style={{ padding: '24px 8px' }}>Nenhuma venda no período.</EmptyState>
              ) : (
                <div className="donut-wrap">
                  <Donut
                    slices={byOp}
                    center={{
                      value: fmtCompactBRL(totalOpValue),
                      label: 'RECEITA',
                      sub: `${resumo.totalVendas} vendas`
                    }}
                  />
                  <div className="donut-legend">
                    {byOp.map(o => {
                      const pct = (o.value / totalOpValue) * 100;
                      return (
                        <div key={o.name} className="leg-row">
                          <div className="leg-head">
                            <span className="swatch" style={{ background: o.color }}></span>
                            <span className="name">{o.name}</span>
                            <span className="pct">{pct.toFixed(0)}%</span>
                          </div>
                          <div className="leg-track">
                            <div className="leg-fill" style={{ width: `${pct}%`, background: o.color }}></div>
                          </div>
                          <div className="leg-meta">
                            <span>{formatarMoeda(o.value)}</span>
                            <span>{o.count} {o.count === 1 ? 'venda' : 'vendas'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Linha 2: funil + motivos de retorno */}
        <div className="reports-row r-2">
          <div className="panel report-panel">
            <div className="panel-header">
              <div className="title-block">
                <h3>Funil de conversão</h3>
                <div className="sub">Quantas vendas alcançaram cada etapa</div>
              </div>
            </div>
            <div className="panel-body">
              {cumulative.length === 0 ? (
                <EmptyState style={{ padding: '24px 8px' }}>Nenhuma fase encontrada no período.</EmptyState>
              ) : (
                <>
                  <div className="funnel-insight">
                    <div className="fi-headline">
                      <strong>{concluidas}</strong> de <strong>{maxFunnel}</strong> chegaram ao fim
                      <span className="fi-pct">{totalConv.toFixed(0)}%</span>
                    </div>
                    <div className={`fi-detail${gargalo ? '' : ' ok'}`}>
                      {gargalo ? (
                        <>
                          Maior perda:{' '}
                          <strong>{gargalo.prevName} → {gargalo.name}</strong>{' '}
                          <span className="fi-drop">−{gargalo.drop} ({gargalo.dropPct.toFixed(0)}%)</span>
                        </>
                      ) : (
                        <>Nenhuma perda entre etapas — todas as vendas avançaram.</>
                      )}
                    </div>
                    <div className="fi-legend">
                      A barra mostra quantas vendas <strong>alcançaram</strong> cada etapa (de {maxFunnel}).
                    </div>
                  </div>
                  <div className="funnel-chart">
                    {funnelStages.map(st => {
                      const temPerda = st.drop > 0;
                      const ehFinal = st.index === ultimoIdx;
                      const classes = ['fn2-stage'];
                      if (st.index === gargaloIdx) classes.push('bottleneck');
                      if (ehFinal) classes.push('final');
                      return (
                        <Fragment key={st.id}>
                          {temPerda && (
                            <div className="fn2-drop">
                              <span className="fn2-drop-arrow">↓</span>
                              <span>
                                <strong>{st.drop}</strong> {st.drop === 1 ? 'venda saiu' : 'vendas saíram'}
                              </span>
                              <span className="fn2-drop-pct">{st.dropPct.toFixed(0)}%</span>
                            </div>
                          )}
                          <div className={classes.join(' ')}>
                            <span className="fn2-num">{st.index + 1}</span>
                            <div className="fn2-body">
                              <div className="fn2-top">
                                <span className="fn2-name" title={st.name}>{st.name}</span>
                                <span className="fn2-meta" title={`${st.pct.toFixed(0)}% das vendas chegaram a esta etapa`}>
                                  <strong>{st.count}</strong> de {maxFunnel} vendas
                                </span>
                              </div>
                              <div className="fn2-track">
                                <div className="fn2-fill" style={{ width: `${Math.max(st.pct, 3)}%` }} />
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel report-panel">
            <div className="panel-header">
              <div className="title-block">
                <h3>Motivos de retorno</h3>
                <div className="sub">{reasons.length > 0 ? `${totalReturns} ${totalReturns === 1 ? 'retorno registrado' : 'retornos registrados'}` : 'sem retornos'}</div>
              </div>
            </div>
            <div className="panel-body">
              {reasons.length === 0 ? (
                <EmptyState style={{ padding: '24px 8px' }}>Nenhum retorno no período</EmptyState>
              ) : (
                <div className="reasons-list">
                  {reasons.map((r, idx) => {
                    const pct = (Number(r.quantidade) / totalReturns) * 100;
                    return (
                      <div key={r.motivo} className="reason-row">
                        <div className="rr-head">
                          <span className="rr-rank">#{idx + 1}</span>
                          <span className="label">{r.motivo}</span>
                          <span className="rr-pct">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="rr-foot">
                          <div className="bar-track">
                            <div className="bar-fill" style={{ width: `${pct}%` }}></div>
                          </div>
                          <span className="count">{r.quantidade} {Number(r.quantidade) === 1 ? 'chip' : 'chips'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Ranking */}
        <div className="panel report-panel">
          <div className="panel-header">
            <div className="title-block">
              <h3>Ranking de usuários</h3>
              <div className="sub">Ordenado por receita no período · {rankingAtivos} ativos</div>
            </div>
          </div>
          <div className="panel-body" style={{ padding: '4px 18px 14px' }}>
            {ranking.length === 0 ? (
              <EmptyState style={{ padding: '24px 8px' }}>Nenhum desempenho encontrado.</EmptyState>
            ) : (
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Usuário</th>
                    <th></th>
                    <th style={{ textAlign: 'right' }}>Receita</th>
                    <th style={{ textAlign: 'right' }}>% do total</th>
                    <th style={{ textAlign: 'right' }}>Vendas</th>
                    <th style={{ textAlign: 'right' }}>Retornos</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => {
                    const share = (Number(r.valor || 0) / totalRank) * 100;
                    const retornos = Number(r.retornos || 0);
                    return (
                      <tr key={r.id || r.nome}>
                        <td>
                          <span className={`rank-medal ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                            {i + 1}
                          </span>
                        </td>
                        <td>
                          <div className="seller-cell">
                            <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                              {obterIniciais(r.nome)}
                            </span>
                            <span className="name">{r.nome}</span>
                          </div>
                        </td>
                        <td className="bar-cell">
                          <div className="bar-track">
                            <div
                              className={`bar-fill ${i > 2 ? 'muted' : ''}`}
                              style={{ width: `${(Number(r.valor || 0) / maxRank) * 100}%` }}
                            ></div>
                          </div>
                        </td>
                        <td className="val-cell">{formatarMoeda(r.valor)}</td>
                        <td className="count-cell">{share.toFixed(0)}%</td>
                        <td className="count-cell">{r.vendas}</td>
                        <td className={`count-cell ${retornos > 0 ? 'danger' : ''}`}>
                          {retornos}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </LayoutPrivado>
  );
}

export default RelatoriosPage;
