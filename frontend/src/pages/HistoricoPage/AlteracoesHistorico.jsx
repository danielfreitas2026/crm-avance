import { formatarCampoHistorico, obterAlteracoesHistorico } from './alteracoes-historico';

function formatarValor(valor, campo, stageNamesMap) {
  if (valor === null || valor === undefined || valor === '') return 'Não informado';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (campo === 'status_funil' && stageNamesMap[valor]) return stageNamesMap[valor];
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.split('-').reverse().join('/');
  if (typeof valor === 'object') return JSON.stringify(valor, null, 2);
  return String(valor);
}

export default function AlteracoesHistorico({ dados, stageNamesMap = {} }) {
  const { linhas, legado } = obterAlteracoesHistorico(dados);
  if (!linhas.length && !Array.isArray(dados?.alteracoes_detalhadas)) return null;
  return (
    <section className="history-data-block history-data-block--highlight" aria-label="Detalhes das alterações">
      <h5>{legado ? 'Dados registrados na edição' : 'Alterações realizadas'}</h5>
      {legado && <p className="history-change-note">Registro antigo: os dados enviados podem incluir campos que não mudaram. Valores anteriores ausentes não foram registrados.</p>}
      {!linhas.length ? <p>Nenhum dado foi alterado nesta edição.</p> : (
        <div className="history-change-list">
          {linhas.map((item, index) => (
            <div className="history-change-row" key={`${item.campo}-${index}`}>
              <span className="history-change-field">{formatarCampoHistorico(item.campo)}</span>
              {item.protegido ? <span className="history-change-new">{legado ? 'Dado protegido; valores ocultos.' : 'Dado protegido alterado; valores ocultos.'}</span> : (
                <div className="history-change-comparison">
                  <div><span className="history-change-caption">Valor anterior</span><span className="history-change-old">{item.anterior_registrado ? formatarValor(item.anterior, item.campo, stageNamesMap) : 'Valor anterior não registrado'}</span></div>
                  <div><span className="history-change-caption">Novo valor{legado && !item.anterior_registrado ? ' enviado' : ''}</span><span className="history-change-new">{formatarValor(item.novo, item.campo, stageNamesMap)}</span></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
