import { describe, expect, it } from 'vitest';
import {
  getPermissoesDeclaradas,
  getPermissoesBloqueadasAdmin,
  getPermissoesSelecionadasUsuario,
  montarPermissoesAdminParaSalvar,
  normalizarPermissoesSelecionadasAdmin
} from './permissoes';

describe('catalogo de permissoes de vendas', () => {
  it('mantém as chaves existentes descrevendo o controle por navegador e a dispensa', () => {
    expect(getPermissoesDeclaradas()).toEqual(expect.arrayContaining([
      expect.objectContaining({ chave: 'configurar_acesso_rede', nome: 'Configurar acesso por dispositivos' }),
      expect.objectContaining({ chave: 'acesso_rede_sem_codigo', nome: 'Acessar sem código em qualquer navegador' })
    ]));
  });
  it('dispensa administradores do código de rede e impede desmarcar ou persistir uma negação', () => {
    const disponiveis = [{ chave: 'acesso_rede_sem_codigo' }, { chave: 'configurar_acesso_rede' }];
    expect(getPermissoesSelecionadasUsuario({ role: { nome: 'admin' }, permissoes: { acesso_rede_sem_codigo: false } }, disponiveis)).toEqual(['acesso_rede_sem_codigo']);
    expect(getPermissoesBloqueadasAdmin().has('acesso_rede_sem_codigo')).toBe(true);
    expect(normalizarPermissoesSelecionadasAdmin([], disponiveis)).toEqual(['acesso_rede_sem_codigo']);
    expect(montarPermissoesAdminParaSalvar([], disponiveis)).toEqual({ configurar_acesso_rede: false });
  });
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
