import { describe, expect, it } from 'vitest';
import {
  getPermissoesDeclaradas,
  getPermissoesBloqueadasAdmin,
  getPermissoesSelecionadasUsuario,
  montarPermissoesAdminParaSalvar,
  normalizarPermissoesSelecionadasAdmin
} from './permissoes';

describe('catalogo de permissoes de vendas', () => {
  it('declara o acesso completo de vendas enviadas como permissao configuravel', () => {
    expect(getPermissoesDeclaradas()).toContainEqual({
      chave: 'vendas_ver_completa_apos_envio',
      nome: 'Ver venda completa após envio',
      descricao: 'Libera formulário, notas, documentos, reversões e exportações detalhadas após o envio ao pós-venda.'
    });
  });

  it('declara a alteração da data da venda como permissão configurável', () => {
    expect(getPermissoesDeclaradas()).toContainEqual({
      chave: 'vendas_alterar_data',
      nome: 'Alterar data da venda',
      descricao: 'Permite alterar a data e a classificação de venda antiga em vendas existentes.'
    });
  });
});

const permissoes = [
  { chave: 'vendas_ver_todas' },
  { chave: 'vendas_editar' },
  { chave: 'vendas_excluir_reversoes' },
  { chave: 'vendas_limitar_ultimos_6_meses' },
  { chave: 'clientes_excluir' }
];

describe('permissoes obrigatorias de vendas para ADM', () => {
  it('exibe operacoes de vendas ativas e a limitacao temporal desativada', () => {
    const selecionadas = getPermissoesSelecionadasUsuario({
      role: { nome: 'admin' },
      permissoes: {
        vendas_ver_todas: false,
        vendas_editar: false,
        vendas_excluir_reversoes: false,
        vendas_limitar_ultimos_6_meses: true,
        clientes_excluir: false
      }
    }, permissoes);

    expect(selecionadas).toEqual([
      'vendas_ver_todas',
      'vendas_editar',
      'vendas_excluir_reversoes'
    ]);
  });

  it('nao persiste configuracoes contraditorias para o dominio de vendas', () => {
    expect(montarPermissoesAdminParaSalvar([], permissoes)).toEqual({
      clientes_excluir: false
    });
  });

  it('mantem as permissoes obrigatorias ao copiar configuracoes', () => {
    expect(normalizarPermissoesSelecionadasAdmin([
      'vendas_limitar_ultimos_6_meses',
      'clientes_excluir'
    ], permissoes)).toEqual([
      'clientes_excluir',
      'vendas_ver_todas',
      'vendas_editar',
      'vendas_excluir_reversoes'
    ]);

    const bloqueadas = getPermissoesBloqueadasAdmin();
    expect(bloqueadas.has('vendas_ver_todas')).toBe(true);
    expect(bloqueadas.has('vendas_limitar_ultimos_6_meses')).toBe(true);
    expect(bloqueadas.has('clientes_excluir')).toBe(false);
  });
});
