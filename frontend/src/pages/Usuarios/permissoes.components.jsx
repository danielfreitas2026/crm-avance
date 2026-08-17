import { useEffect, useRef, useState } from 'react';
import * as I from '../../components/Icons';
import { getChavesGrupo } from './permissoes';

export function CopiarPermissoesSelect({ value, onChange, options, placeholder = 'Selecione um usuário' }) {
  const [aberto, setAberto] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    function handleClickFora(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setAberto(false);
    }
    function handleEsc(event) {
      if (event.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', handleClickFora);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickFora);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [aberto]);

  const selecionado = options.find(opt => String(opt.value) === String(value));
  return (
    <div className={`permissions-copy__select${aberto ? ' is-open' : ''}`} ref={wrapperRef}>
      <button
        type="button"
        className="permissions-copy__trigger"
        onClick={() => setAberto(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
      >
        <span className={`permissions-copy__trigger-label${selecionado ? '' : ' is-placeholder'}`}>
          {selecionado ? selecionado.label : placeholder}
        </span>
        <I.ChevronDown size={14} />
      </button>
      {aberto && (
        <ul className="permissions-copy__menu" role="listbox">
          <li
            role="option"
            aria-selected={!value}
            className={`permissions-copy__option is-placeholder${!value ? ' is-active' : ''}`}
            onClick={() => { onChange(''); setAberto(false); }}
          >
            {placeholder}
          </li>
          {options.map(opt => (
            <li
              key={opt.value}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              className={`permissions-copy__option${String(opt.value) === String(value) ? ' is-active' : ''}`}
              onClick={() => { onChange(opt.value); setAberto(false); }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PermissaoCard({ item, selecionado, exclusivo, grupoExclusivo, onToggle }) {
  return (
    <label className={`permissions-option ${selecionado ? 'is-active' : ''} ${exclusivo ? 'permissions-option--exclusive' : ''}`}>
      <input
        type="checkbox"
        checked={selecionado}
        onChange={() => onToggle(item.chave, exclusivo ? { grupoExclusivo } : undefined)}
      />
      <span>
        <strong>{item.nome}</strong>
        <small>{item.descricao || 'Permissão do sistema.'}</small>
      </span>
    </label>
  );
}

function SeletorBlocoPermissoes({ titulo, total, selecionadas, onToggle }) {
  const checkboxRef = useRef(null);
  const todasSelecionadas = total > 0 && selecionadas === total;
  const parcial = selecionadas > 0 && selecionadas < total;

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = parcial;
  }, [parcial]);

  return (
    <label className={`permissions-block-toggle ${todasSelecionadas ? 'is-active' : ''}`}>
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={todasSelecionadas}
        onChange={() => onToggle(!todasSelecionadas)}
      />
      <span>
        <strong>{titulo}</strong>
        <small>{selecionadas}/{total}</small>
      </span>
    </label>
  );
}

export function PermissaoGrupo({ grupo, selecionadas, onToggle, onToggleBloco }) {
  const chaves = getChavesGrupo(grupo);
  const selecionadasNoGrupo = chaves.filter(chave => selecionadas.includes(chave)).length;
  const ativo = selecionadasNoGrupo > 0;

  return (
    <section className={`permissions-group permissions-group--semantic ${ativo ? 'is-active' : ''}`}>
      <div className="permissions-group__header">
        <div>
          <h4>{grupo.titulo}</h4>
          <p>{grupo.descricao}</p>
        </div>
        <span className={`pill ${ativo ? 'success' : 'danger'}`}>
          <span className="pill-dot"></span>
          {selecionadasNoGrupo}/{chaves.length}
        </span>
      </div>

      <div className="permissions-sections">
        {grupo.secoes.map(secao => {
          const grupoExclusivo = secao.itens.map(item => item.chave);
          const chavesSecao = secao.itens.map(item => item.chave);
          const selecionadasNaSecao = chavesSecao.filter(chave => selecionadas.includes(chave)).length;
          return (
            <div key={secao.titulo} className="permissions-section">
              <div className="permissions-section__header">
                <div className="permissions-section__title">{secao.titulo}</div>
                {!secao.exclusivo && onToggleBloco && (
                  <SeletorBlocoPermissoes
                    titulo="Selecionar bloco"
                    total={chavesSecao.length}
                    selecionadas={selecionadasNaSecao}
                    onToggle={selecionar => onToggleBloco(chavesSecao, selecionar)}
                  />
                )}
              </div>
              <div className={`permissions-options ${secao.exclusivo ? 'permissions-options--exclusive' : ''}`}>
                {secao.itens.map(item => (
                  <PermissaoCard
                    key={item.chave}
                    item={item}
                    selecionado={selecionadas.includes(item.chave)}
                    exclusivo={secao.exclusivo}
                    grupoExclusivo={grupoExclusivo}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
