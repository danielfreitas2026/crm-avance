import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

import { apiGet, apiPost, apiPut } from './api';
import { atualizarPerfil, buscarPerfil, getUsuarioLocal, login, logout, temPermissao } from './auth.service';

describe('auth.service', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('faz login e persiste token e usuario localmente', async () => {
    apiPost.mockResolvedValueOnce({ token: 'token-1', usuario: { id: 7, nome: 'Ana' } });

    await expect(login('ana@test.com', '123')).resolves.toEqual({ token: 'token-1', usuario: { id: 7, nome: 'Ana' } });

    expect(apiPost).toHaveBeenCalledWith('/auth/login', { email: 'ana@test.com', senha: '123' });
    expect(localStorage.getItem('token')).toBe('token-1');
    expect(getUsuarioLocal()).toEqual({ id: 7, nome: 'Ana' });
  });

  it('busca e atualiza perfil usando os endpoints esperados', async () => {
    apiGet.mockResolvedValueOnce({ id: 1 });
    apiPut.mockResolvedValueOnce({ id: 1, nome: 'Novo Nome' });

    await expect(buscarPerfil()).resolves.toEqual({ id: 1 });
    await expect(atualizarPerfil({ nome: 'Novo Nome' })).resolves.toEqual({ id: 1, nome: 'Novo Nome' });

    expect(apiGet).toHaveBeenCalledWith('/auth/me');
    expect(apiPut).toHaveBeenCalledWith('/auth/me', { nome: 'Novo Nome' });
    expect(getUsuarioLocal()).toEqual({ id: 1, nome: 'Novo Nome' });
  });

  it('resolve permissoes de admin, usuario, role e listas', () => {
    expect(temPermissao({ role: { nome: 'admin' } }, 'qualquer')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { gerenciar_permissoes: false } }, 'gerenciar_permissoes')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { notificacoes_receber_email: false } }, 'notificacoes_receber_email')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { clientes_excluir: false } }, 'clientes_excluir')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' } }, 'clientes_secretos_ver_todos')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' } }, 'clientes_antigos_ver_historico')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' } }, 'vendas_excluir_reversoes')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' } }, 'configurar_horario_acesso')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' } }, 'funil_automacoes')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' } }, 'vendas_alterar_data')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { clientes_secretos_ver_todos: true } }, 'clientes_secretos_ver_todos')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { clientes_antigos_ver_historico: true } }, 'clientes_antigos_ver_historico')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { vendas_excluir_reversoes: true } }, 'vendas_excluir_reversoes')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { configurar_horario_acesso: true } }, 'configurar_horario_acesso')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { funil_automacoes: true } }, 'funil_automacoes')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { vendas_alterar_data: true } }, 'vendas_alterar_data')).toBe(true);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: '"{\\"clientes_excluir\\":false}"' }, 'clientes_excluir')).toBe(false);
    expect(temPermissao({ role: { nome: 'admin' }, permissoes: { gerenciar_permissoes: false } }, 'clientes.ver')).toBe(true);
    expect(temPermissao({ permissoes: ['clientes.ver'] }, 'clientes.ver')).toBe(true);
    expect(temPermissao({ role: { permissoes: '{"vendas.ver":true}' } }, 'vendas.ver')).toBe(true);
    expect(temPermissao({ permissoes: { a: false, b: true } }, ['a', 'b'])).toBe(true);
    expect(temPermissao({ permissoes: { a: false } }, 'b')).toBe(false);
    expect(temPermissao(null, '')).toBe(true);
  });

  it('ignora negacoes de vendas para admin e remove a limitacao temporal', () => {
    const admin = {
      role: { nome: 'admin' },
      permissoes: {
        vendas_ver_todas: false,
        vendas_editar: false,
        vendas_excluir: false,
        pos_venda: false,
        vendas_limitar_ultimos_6_meses: true,
        clientes_excluir: false
      }
    };

    expect(temPermissao(admin, 'vendas_ver_todas')).toBe(true);
    expect(temPermissao(admin, 'vendas_editar')).toBe(true);
    expect(temPermissao(admin, 'vendas_excluir')).toBe(true);
    expect(temPermissao(admin, 'pos_venda')).toBe(true);
    expect(temPermissao(admin, 'vendas_limitar_ultimos_6_meses')).toBe(false);
    expect(temPermissao(admin, 'clientes_excluir')).toBe(false);
  });

  it('limpa dados locais no logout', () => {
    localStorage.setItem('token', 'token-1');
    localStorage.setItem('usuario', '{"id":1}');

    logout();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
  });
});
