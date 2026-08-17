import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Paginacao.css';

const OPCOES_POR_PAGINA = [20, 50, 100];

// Sempre retorna exatamente 7 slots — sem layout shift ao navegar.
// Slots são números ou as strings fixas 'ellipsis-start' / 'ellipsis-end'.
/**
 * Gera paginas a partir dos dados informados.
 */
function gerarPaginas(total, atual) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  if (atual <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis-end', total];
  }
  if (atual >= total - 3) {
    return [1, 'ellipsis-start', total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, 'ellipsis-start', atual - 1, atual, atual + 1, 'ellipsis-end', total];
}

/**
 * Processa seletor itens por pagina conforme as regras do dominio.
 */
function SeletorItensPorPagina({ id, value, onChange }) {
  const [aberto, setAberto] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  /**
   * Calcula posicao com base nos valores informados.
   */
  function calcularPosicao() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || OPCOES_POR_PAGINA.length * 33;
    setMenuPos({
      top: Math.max(8, rect.top - menuHeight - 4),
      left: rect.left,
      width: Math.max(rect.width, 72)
    });
  }

  useLayoutEffect(() => {
    if (aberto) calcularPosicao();
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;

    /**
     * Fecha fora e limpa o estado relacionado.
     */
    function fecharFora(event) {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setAberto(false);
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
  function selecionar(n) {
    onChange(n);
    setAberto(false);
    triggerRef.current?.focus();
  }

  /**
   * Trata o evento de key down.
   */
  function handleKeyDown(event) {
    if (event.key === 'Escape') setAberto(false);
  }

  return (
    <div className={`paginacao-select${aberto ? ' paginacao-select--open' : ''}`} onKeyDown={handleKeyDown}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="paginacao-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => setAberto(v => !v)}
      >
        <span>{value}</span>
        <svg className="paginacao-select__chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {aberto && createPortal(
        <div
          ref={menuRef}
          className="paginacao-select__menu"
          role="listbox"
          aria-labelledby={id}
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
          {OPCOES_POR_PAGINA.map(n => {
            const ativo = Number(value) === n;
            return (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={ativo}
                className={`paginacao-select__opcao${ativo ? ' paginacao-select__opcao--ativa' : ''}`}
                onClick={() => selecionar(n)}
              >
                <span>{n}</span>
                {ativo && (
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * Processa paginacao conforme as regras do dominio.
 */
function Paginacao({ total, paginaAtual, itensPorPagina, onPagina, onItensPorPagina }) {
  const uid = useId();
  const totalPaginas = Math.ceil(total / itensPorPagina);
  if (total === 0) return null;

  const inicio = (paginaAtual - 1) * itensPorPagina + 1;
  const fim = Math.min(paginaAtual * itensPorPagina, total);
  const paginas = gerarPaginas(totalPaginas, paginaAtual);

  return (
    <div className="paginacao">
      <span className="paginacao__info">
        {inicio}–{fim} de {total}
      </span>

      <div className="paginacao__nav-group">
        <button
          type="button"
          className="paginacao__nav"
          disabled={paginaAtual === 1}
          onClick={() => onPagina(paginaAtual - 1)}
          aria-label="Página anterior"
        >
          ‹
        </button>

        <div className="paginacao__grupo">
          {paginas.map(p =>
            typeof p === 'string' ? (
              <span key={p} className="paginacao__ellipsis">···</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`paginacao__btn${p === paginaAtual ? ' paginacao__btn--ativo' : ''}`}
                aria-current={p === paginaAtual ? 'page' : undefined}
                onClick={() => onPagina(p)}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          className="paginacao__nav"
          disabled={paginaAtual === totalPaginas}
          onClick={() => onPagina(paginaAtual + 1)}
          aria-label="Próxima página"
        >
          ›
        </button>
      </div>

      <div className="paginacao__por-pagina">
        <label htmlFor={`${uid}-pp`}>Por página</label>
        <SeletorItensPorPagina
          id={`${uid}-pp`}
          value={itensPorPagina}
          onChange={onItensPorPagina}
        />
      </div>
    </div>
  );
}

export default Paginacao;
