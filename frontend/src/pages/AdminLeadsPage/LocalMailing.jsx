import { useEffect, useRef, useState } from 'react';
import { Close } from '../../components/Icons';
import { listarLocaisMailing, preencherLocalMailing } from '../../services/lead-planilha.service';
import './LocalMailing.css';

export function LocalMailingModal({ planilha, onClose, onIniciado }) {
  const [campos, setCampos] = useState(planilha.local_config?.campos || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const modalRef = useRef(null);
  useEffect(() => {
    const anterior = document.activeElement;
    const modal = modalRef.current;
    modal.showModal();
    modal.querySelector('button')?.focus();
    return () => { modal.close(); anterior?.focus(); };
  }, []);

  async function iniciar(event) {
    event.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      onIniciado(await preencherLocalMailing(planilha.id, campos));
      onClose();
    } catch (error) {
      setErro(error.message || 'Erro ao iniciar o preenchimento.');
    } finally {
      setSalvando(false);
    }
  }

  return (
      <dialog ref={modalRef} aria-modal="true" aria-labelledby="local-mailing-titulo" className="modal local-mailing-modal"
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
        onCancel={event => { event.preventDefault(); if (!salvando) onClose(); }}>
        <form onSubmit={iniciar}>
          <div className="modal-header modal-header-row">
            <div className="local-mailing-heading">
              <h2 id="local-mailing-titulo">Preencher Local por DDD</h2>
              <p className="local-mailing-planilha">{planilha.nome}</p>
            </div>
            <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} disabled={salvando} aria-label="Fechar localização"><Close size={18} aria-hidden="true" /></button>
          </div>
          <div className="modal-body">
            <p id="local-mailing-instrucao" className="local-mailing-instrucao">Selecione os campos que contêm telefones completos.</p>
            <fieldset className="local-mailing-campos" disabled={salvando} aria-describedby="local-mailing-instrucao">
              <legend>
                <span>Campos de telefone</span>
                <span className="local-mailing-contador" role="status">{campos.length} {campos.length === 1 ? 'selecionado' : 'selecionados'}</span>
              </legend>
              <div className="local-mailing-opcoes">
                {(planilha.colunas || []).filter(campo => campo !== planilha.local_config?.coluna && !campo.endsWith(' (atualizado)')).map(campo => (
                  <label key={campo}>
                    <input type="checkbox" checked={campos.includes(campo)} onChange={event => setCampos(atuais => event.target.checked ? [...atuais, campo] : atuais.filter(item => item !== campo))} />
                    <span>{campo}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="local-mailing-info">
              <p>O DDD indica a área do telefone e pode abranger várias cidades.</p>
              <p>As áreas encontradas em cada linha serão reunidas, sem repetição. Os dados importados serão preservados.</p>
            </div>
            {planilha.local_config && <p className="local-mailing-aviso">Ao repetir, o Local será recalculado em todas as linhas.</p>}
            {erro && <div role="alert" className="alert-error">{erro}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={salvando}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={salvando || !campos.length}>{salvando ? 'Iniciando…' : 'Preencher Local'}</button>
          </div>
        </form>
      </dialog>
  );
}

export function LocalMailingFiltro({ valor, onChange }) {
  const [locais, setLocais] = useState(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function carregar() {
    setCarregando(true);
    setErro('');
    try { setLocais(await listarLocaisMailing()); }
    catch (error) { setErro(error.message || 'Erro ao carregar áreas.'); }
    finally { setCarregando(false); }
  }

  const quantidade = valor.ddds.length + Number(valor.naoIdentificado);
  const normalizar = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return (
    <details className="local-mailing-filtro" onToggle={event => { if (event.currentTarget.open && locais === null && !carregando) carregar(); }}>
      <summary>Local/DDD{quantidade > 0 ? ` (${quantidade})` : ''}</summary>
      <div className="local-mailing-filtro-painel">
        <input aria-label="Buscar área ou DDD" placeholder="Buscar área, UF ou DDD" value={busca} onChange={event => setBusca(event.target.value)} />
        <fieldset className="local-mailing-campos">
          <legend>Áreas do telefone</legend>
          <label><input type="checkbox" checked={valor.naoIdentificado} onChange={event => onChange({ ...valor, naoIdentificado: event.target.checked })} />Não identificado</label>
          {(locais || []).filter(local => normalizar(local.label).includes(normalizar(busca))).map(local => (
            <label key={local.ddd}><input type="checkbox" checked={valor.ddds.includes(local.ddd)} onChange={event => onChange({ ...valor, ddds: event.target.checked ? [...valor.ddds, local.ddd] : valor.ddds.filter(ddd => ddd !== local.ddd) })} />{local.label}</label>
          ))}
        </fieldset>
        {carregando && <p role="status">Carregando áreas…</p>}
        {erro && <div role="alert">{erro}<button type="button" className="btn" onClick={carregar}>Tentar novamente</button></div>}
        <button className="btn" type="button" disabled={!quantidade} onClick={() => onChange({ ddds: [], naoIdentificado: false })}>Limpar Local/DDD</button>
      </div>
    </details>
  );
}
