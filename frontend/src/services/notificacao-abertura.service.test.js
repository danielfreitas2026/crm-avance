import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./notificacao.service', () => ({
  marcarPopupNotificacaoVisto: vi.fn()
}));

import { marcarPopupNotificacaoVisto } from './notificacao.service';
import {
  aberturaNotificacaoPendente,
  confirmarAberturaNotificacao,
  falharAberturaNotificacao,
  getNotificacaoIdParam,
  iniciarAberturaNotificacao
} from './notificacao-abertura.service';

describe('abertura de notificacao da navbar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mantem o item pendente durante a confirmacao e libera depois do sucesso', async () => {
    let resolver;
    marcarPopupNotificacaoVisto.mockReturnValue(new Promise(resolve => { resolver = resolve; }));
    iniciarAberturaNotificacao(15);
    const confirmacao = confirmarAberturaNotificacao(15);

    expect(aberturaNotificacaoPendente(15)).toBe(true);
    resolver({});
    await confirmacao;
    expect(aberturaNotificacaoPendente(15)).toBe(false);
  });

  it('libera o item para reaparecer quando o destino falha', () => {
    iniciarAberturaNotificacao(16);
    falharAberturaNotificacao(16);
    expect(aberturaNotificacaoPendente(16)).toBe(false);
  });

  it('aceita apenas ids validos na query', () => {
    expect(getNotificacaoIdParam(new URLSearchParams('notificacao_id=17'))).toBe(17);
    expect(getNotificacaoIdParam(new URLSearchParams('notificacao_id=x'))).toBeNull();
  });
});
