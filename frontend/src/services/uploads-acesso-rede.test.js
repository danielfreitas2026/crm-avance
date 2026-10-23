import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadArquivoVenda } from './venda.service';
import { uploadLeadPlanilha, importarLeadPlanilhaExcel, importarBaseAntigaMailing } from './lead-planilha.service';

describe('bloqueio de rede nos uploads com progresso', () => {
  let enviados;
  beforeEach(() => {
    enviados = 0;
    localStorage.setItem('token', 'sessao-externa');
    sessionStorage.clear();
    window.history.replaceState({}, '', '/verificar-acesso');
    vi.stubGlobal('XMLHttpRequest', class {
      status = 403;
      responseText = JSON.stringify({ code: 'NETWORK_ACCESS_REQUIRED', message: 'Rede externa', solicitacao_id: 'id-upload', expira_em: '2026-10-21T15:00:00Z' });
      responseURL = 'http://localhost/api/upload';
      upload = { addEventListener() {} };
      eventos = {};
      open() {}
      setRequestHeader() {}
      addEventListener(evento, callback) { this.eventos[evento] = callback; }
      send() { expect(this.withCredentials).toBe(true); enviados++; this.eventos.load(); }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
  it.each([
    ['documento de venda', file => uploadArquivoVenda(1, file)],
    ['planilha', uploadLeadPlanilha],
    ['planilha Excel', importarLeadPlanilhaExcel],
    ['base antiga', importarBaseAntigaMailing]
  ])('preserva a solicitação no upload de %s sem reenviar o arquivo', async (_nome, upload) => {
    await expect(upload(new File(['conteudo'], 'arquivo.xlsx'))).rejects.toThrow('Rede externa');
    expect(JSON.parse(sessionStorage.getItem('acesso_rede_pendente')).solicitacao_id).toBe('id-upload');
    expect(enviados).toBe(1);
  });
});
