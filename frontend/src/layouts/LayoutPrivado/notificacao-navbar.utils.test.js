import { describe, expect, it } from 'vitest';

import {
  filtrarExclusoesPendentesNavbar,
  restaurarNotificacaoNavbar
} from './notificacao-navbar.utils';

describe('estado das notificacoes da navbar', () => {
  it('mantem todos os alertas quando nao ha exclusao pendente', () => {
    const notificacoes = Array.from({ length: 6 }, (_, indice) => ({ id: indice + 1 }));

    expect(filtrarExclusoesPendentesNavbar(notificacoes, new Set())).toHaveLength(6);
  });

  it('impede que o polling restaure uma exclusao ainda pendente', () => {
    const notificacoes = [{ id: 1 }, { id: 2 }, { id: 3 }];

    expect(filtrarExclusoesPendentesNavbar(notificacoes, new Set(['2'])))
      .toEqual([{ id: 1 }, { id: 3 }]);
  });

  it('restaura o alerta na ordem original quando a exclusao falha', () => {
    const notificacao = { id: 2, created_at: '2026-08-18T11:00:00Z' };
    const atuais = [
      { id: 1, created_at: '2026-08-18T10:00:00Z' },
      { id: 3, created_at: '2026-08-18T12:00:00Z' }
    ];

    expect(restaurarNotificacaoNavbar(atuais, notificacao).map(item => item.id))
      .toEqual([1, 2, 3]);
    expect(restaurarNotificacaoNavbar([notificacao], notificacao)).toEqual([notificacao]);
  });
});
