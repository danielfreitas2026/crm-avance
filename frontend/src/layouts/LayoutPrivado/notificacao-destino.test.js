import { describe, expect, it } from 'vitest';
import { montarDestinoNotificacao, resolverDestinoNotificacao } from './notificacao-destino';

describe('destinos das notificacoes', () => {
  it.each([
    ['aprovação', { id: 1, tipo: 'venda_aprovacao_pendente', dados: { solicitacao_id: 44 } }, '/vendas/aprovacoes?notificacao_id=1&solicitacao_id=44'],
    ['funil', { id: 2, tipo: 'venda_parada_funil', entidade: 'vendas', entidade_id: 55 }, '/funil?notificacao_id=2&venda_id=55'],
    ['problema', { id: 3, tipo: 'venda_problema_aberto', entidade_id: 66, dados: { venda_id: 66, problema_id: 7 } }, '/vendas?notificacao_id=3&venda_id=66&aba=problema&problema_id=7'],
    ['nota de venda', { id: 4, tipo: 'nota_retorno_due', entidade: 'vendas', entidade_id: 77 }, '/vendas?notificacao_id=4&venda_id=77&aba=notas'],
    ['nota de cliente', { id: 5, tipo: 'nota_retorno_pre', entidade: 'clientes', entidade_id: 88 }, '/clientes?notificacao_id=5&cliente_id=88&aba=notas'],
    ['nota de lead', { id: 6, tipo: 'nota_retorno_pre', entidade: 'clientes-secretos', entidade_id: 99, dados: { entidade_tipo: 'lead' } }, '/clientes-secretos?notificacao_id=6&cliente_id=99&aba=notas'],
    ['retorno', { id: 7, tipo: 'venda_retorno_registrado', dados: { venda_id: 101 } }, '/retornos?notificacao_id=7&venda_id=101'],
    ['fidelidade', { id: 8, tipo: 'cliente_fidelidade', entidade: 'clientes', entidade_id: 102 }, '/clientes?notificacao_id=8&cliente_id=102&aba=cliente'],
    ['futuro cliente', { id: 9, tipo: 'futuro_cliente_retorno_due', entidade: 'lead_linhas', entidade_id: 103 }, '/futuros-clientes?notificacao_id=9&aba=meus&linha_id=103'],
    ['lead', { id: 10, tipo: 'lead_retorno_due', entidade: 'lead_linhas', entidade_id: 104 }, '/futuros-clientes?notificacao_id=10&aba=mailings&linha_id=104'],
    ['encaminhamento', { id: 11, tipo: 'futuro_cliente_distribuido', entidade: 'lead_linhas', entidade_id: 105 }, '/futuros-clientes?notificacao_id=11&aba=recebidos&linha_id=105'],
    ['retorno de mailing', { id: 12, tipo: 'futuro_cliente_retorno_due', entidade: 'lead_linhas', entidade_id: 106, dados: { fluxo: 'mailing' } }, '/futuros-clientes?notificacao_id=12&aba=mailings&linha_id=106']
  ])('monta deep link exato para %s', (_nome, notificacao, rota) => {
    expect(montarDestinoNotificacao(notificacao).rota).toBe(rota);
  });

  it('recusa destino sem identificador e explica falta de permissao', () => {
    expect(montarDestinoNotificacao({ id: 1, tipo: 'venda_parada_funil' }).rota).toBeNull();

    const resultado = resolverDestinoNotificacao(
      { id: 2, tipo: 'venda_parada_funil', entidade: 'vendas', entidade_id: 10 },
      { role: { nome: 'usuario' }, permissoes: {} }
    );
    expect(resultado.podeAbrir).toBe(false);
    expect(resultado.motivo).toMatch(/precisa de acesso ao Funil de Vendas/i);
  });

  it('abre retorno de mailing no controle global para usuario administrativo', () => {
    const notificacao = {
      id: 12,
      tipo: 'lead_retorno_due',
      entidade: 'lead_linhas',
      entidade_id: 104
    };
    const admin = { role: { nome: 'admin' } };

    expect(resolverDestinoNotificacao(notificacao, admin)).toMatchObject({
      podeAbrir: true,
      rota: '/clientes-secretos?notificacao_id=12&linha_id=104'
    });
    expect(resolverDestinoNotificacao(notificacao, {
      role: { nome: 'usuario' },
      permissoes: { futuros_clientes_ver: true }
    })).toMatchObject({
      podeAbrir: true,
      rota: '/futuros-clientes?notificacao_id=12&aba=mailings&linha_id=104'
    });
  });
});
