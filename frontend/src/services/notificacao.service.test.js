import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiRequest: vi.fn()
}));

import { apiDelete, apiGet, apiRequest } from './api';
import {
  excluirNotificacao,
  listarNotificacoes,
  marcarPopupNotificacaoVisto
} from './notificacao.service';

describe('notificacao.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('solicita o escopo completo do Dashboard', async () => {
    await listarNotificacoes({ escopo: 'dashboard' });
    expect(apiGet).toHaveBeenCalledWith('/notificacoes?escopo=dashboard');
  });

  it('mantem os contratos de abertura e exclusao da navbar', async () => {
    await marcarPopupNotificacaoVisto(12);
    await excluirNotificacao(12);
    expect(apiRequest).toHaveBeenCalledWith('/notificacoes/12/popup-visto', { method: 'PATCH' });
    expect(apiDelete).toHaveBeenCalledWith('/notificacoes/12');
  });
});
