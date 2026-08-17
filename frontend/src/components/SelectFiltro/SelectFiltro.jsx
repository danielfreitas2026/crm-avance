import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SelectFiltro.css';

/**
 * Renderiza um select customizado com busca, portal e navegacao por teclado.
 */
export default function SelectFiltro({
  value,
  onChange,
  options = [],
  placeholder = 'Todos',
  className = '',
  disabled = false,
  searchable = true,
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const buscaDeferred = useDeferredValue(busca);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const buscaRef = useRef(null);
  const destaqueRef = useRef(null);

  const selecionada = options.find(op => String(op.value) === String(value));
  const labelAtual = selecionada ? selecionada.label : null;
  const termoBusca = normalizarBusca(buscaDeferred);
  const opcoesFiltradas = termoBusca
    ? options.filter(op => normalizarBusca(op.label).includes(termoBusca))
    : options;

  // Lista plana navegável por teclado: placeholder (limpar) + opções filtradas.
  const itensNavegaveis = [
    { value: '', disabled: false },
    ...opcoesFiltradas.map(op => ({ value: String(op.value), disabled: !!op.disabled })),
  ];

  /**
   * Processa proximo selecionavel conforme as regras do dominio.
   */
  function proximoSelecionavel(de, dir) {
    const n = itensNavegaveis.length;
    if (n === 0) return -1;
    let i = de;
    for (let passo = 0; passo < n; passo++) {
      i = (i + dir + n) % n;
      if (!itensNavegaveis[i].disabled) return i;
    }
    return -1;
  }

  /**
   * Calcula posicao com base nos valores informados.
   */
  function calcularPosicao() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  useLayoutEffect(() => {
    if (aberto) calcularPosicao();
  }, [aberto]);

  useEffect(() => {
    if (aberto && searchable) buscaRef.current?.focus();
  }, [aberto, searchable]);

  // Mantém a opção destacada visível durante a navegação.
  useEffect(() => {
    if (aberto) destaqueRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [destaque, aberto]);

  useEffect(() => {
    if (!aberto) return;

    /**
     * Fecha fora e limpa o estado relacionado.
     */
    function fecharFora(e) {
      if (
        !triggerRef.current?.contains(e.target) &&
        !menuRef.current?.contains(e.target)
      ) {
        setAberto(false);
        setBusca('');
      }
    }

    document.addEventListener('mousedown', fecharFora);
    window.addEventListener('resize', calcularPosicao);
    window.addEventListener('scroll', calcularPosicao, true);

    return () => {
      document.removeEventListener('mousedown', fecharFora);
      window.removeEventListener('resize', calcularPosicao);
      window.removeEventListener('scroll', calcularPosicao, true);
    };
  }, [aberto]);

  /**
   * Seleciona  e atualiza o estado relacionado.
   */
  function selecionar(val) {
    onChange(val);
    setAberto(false);
    setBusca('');
  }

  function alterarBusca(novaBusca) {
    const termo = normalizarBusca(novaBusca);
    const possuiResultado = termo && options.some(op => normalizarBusca(op.label).includes(termo));
    setBusca(novaBusca);
    setDestaque(possuiResultado ? 1 : 0);
  }

  /**
   * Trata o evento de key down.
   */
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setAberto(false);
      setBusca('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestaque(d => proximoSelecionavel(d, 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestaque(d => proximoSelecionavel(d, -1));
      return;
    }
    if (e.key === 'Enter') {
      const item = itensNavegaveis[destaque];
      if (item && !item.disabled) {
        e.preventDefault();
        selecionar(item.value);
      }
    }
  }

  /**
   * Alterna menu no estado atual.
   */
  function alternarMenu() {
    if (aberto) setBusca('');
    setDestaque(0);
    setAberto(v => !v);
  }

  const wrapperClass = [`sf`, aberto ? 'sf--open' : '', className].filter(Boolean).join(' ');

  return (
    <div className={wrapperClass} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="sf__trigger"
        ref={triggerRef}
        disabled={disabled}
        onClick={alternarMenu}
      >
        <span className={`sf__valor ${!labelAtual ? 'sf__valor--vazio' : ''}`}>
          {labelAtual ?? placeholder}
        </span>
        <svg className="sf__chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {aberto && createPortal(
        <div
          className="sf__menu"
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
          {searchable && options.length > 0 && (
            <label className="sf__busca">
              <SearchIcon />
              <input
                ref={buscaRef}
                type="search"
                value={busca}
                onChange={e => alterarBusca(e.target.value)}
                placeholder="Buscar"
                aria-label="Buscar filtro"
              />
            </label>
          )}
          <button
            type="button"
            className={`sf__opcao ${!value ? 'sf__opcao--ativa' : ''} ${destaque === 0 ? 'sf__opcao--destaque' : ''}`}
            ref={destaque === 0 ? destaqueRef : null}
            onClick={() => selecionar('')}
            onMouseEnter={() => setDestaque(0)}
          >
            <span>{placeholder}</span>
            {!value && <CheckIcon />}
          </button>
          <div className="sf__opcoes">
            {opcoesFiltradas.map((op, i) => {
              const ativa = String(value) === String(op.value);
              const idx = i + 1;
              const destacada = idx === destaque;
              return (
                <button
                  key={op.value}
                  type="button"
                  className={`sf__opcao ${ativa ? 'sf__opcao--ativa' : ''} ${destacada ? 'sf__opcao--destaque' : ''} ${op.disabled ? 'sf__opcao--disabled' : ''}`}
                  ref={destacada ? destaqueRef : null}
                  onClick={() => !op.disabled && selecionar(String(op.value))}
                  onMouseEnter={() => !op.disabled && setDestaque(idx)}
                  aria-disabled={op.disabled ? 'true' : undefined}
                >
                  <span>{op.label}</span>
                  {ativa && <CheckIcon />}
                </button>
              );
            })}
            {opcoesFiltradas.length === 0 && (
              <div className="sf__vazio">Nenhuma opção encontrada</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Normaliza busca para uso interno consistente.
 */
function normalizarBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Renderiza search icon.
 */
function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Renderiza check icon.
 */
function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
