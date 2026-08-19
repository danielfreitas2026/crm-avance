import { describe, expect, it } from 'vitest';
import { ordenarMailingsMaisRecentes } from './mailing-order';

describe('ordenarMailingsMaisRecentes', () => {
  it('exibe primeiro o mailing com o envio mais recente sem alterar a lista original', () => {
    const mailings = [
      { envio_id: 18, envio_nome: 'Envio 21/07/2026' },
      { envio_id: 24, envio_nome: 'Envio 07/08/2026' },
      { envio_id: 20, envio_nome: 'Envio 28/07/2026' }
    ];

    const ordenados = ordenarMailingsMaisRecentes(mailings);

    expect(ordenados.map(item => item.envio_id)).toEqual([24, 20, 18]);
    expect(mailings.map(item => item.envio_id)).toEqual([18, 24, 20]);
  });
});
