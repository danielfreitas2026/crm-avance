import { describe, expect, it } from 'vitest';
import { getAutorHistorico } from './origemHistorico';

describe('origem do histórico', () => {
  it('identifica explicitamente a automação do Gmail em dados objeto ou JSON', () => {
    expect(getAutorHistorico({
      dados: { origem_movimentacao: 'automacao_gmail' }
    })).toBe('Automação Gmail');
    expect(getAutorHistorico({
      dados: JSON.stringify({ origem_movimentacao: 'automacao_gmail' })
    })).toBe('Automação Gmail');
  });

  it('preserva a identificação de alterações manuais e eventos de sistema', () => {
    expect(getAutorHistorico({ usuario: { nome: 'Maria' }, usuario_id: 7 })).toBe('Maria');
    expect(getAutorHistorico({ usuario_id: 7 })).toBe('Usuário #7');
    expect(getAutorHistorico({ dados: '{}' })).toBe('Sistema');
  });
});
