import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AdminRoute from './AdminRoute';
import { logout } from '../services/auth.service';

function renderizar() {
  return render(<MemoryRouter initialEntries={['/admin/senhas']}><Routes>
    <Route path="/" element={<p>Início</p>} />
    <Route path="/admin/senhas" element={<AdminRoute><p>Cofre administrativo</p></AdminRoute>} />
  </Routes></MemoryRouter>);
}

describe('rota do gerenciador', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); localStorage.clear(); });
  it.each([
    null,
    { ativo: true, role: { nome: 'usuario' }, permissoes: ['crud_usuarios', 'usuarios_editar'] },
    { ativo: false, role: { nome: 'admin' } }
  ])('bloqueia acesso sem administrador ativo: %j', usuario => {
    if (usuario) localStorage.setItem('usuario', JSON.stringify(usuario));
    renderizar();
    expect(screen.getByText('Início')).toBeInTheDocument();
    expect(screen.queryByText('Cofre administrativo')).not.toBeInTheDocument();
  });
  it.each([true, 1])('permite administrador ativo %s sem permissão CRUD', ativo => {
    localStorage.setItem('usuario', JSON.stringify({ ativo, role: { nome: 'admin' }, permissoes: { usuarios_listar: false } }));
    renderizar();
    expect(screen.getByText('Cofre administrativo')).toBeInTheDocument();
  });
  it('remove página quando o perfil atualizado perde a função administrativa', () => {
    localStorage.setItem('usuario', JSON.stringify({ ativo: true, role: { nome: 'admin' } }));
    renderizar();
    act(() => {
      localStorage.setItem('usuario', JSON.stringify({ ativo: true, role: { nome: 'usuario' } }));
      window.dispatchEvent(new Event('auth:usuario-atualizado'));
    });
    expect(screen.queryByText('Cofre administrativo')).not.toBeInTheDocument();
  });
  it('logout remove a página através do evento de encerramento da sessão', () => {
    localStorage.setItem('usuario', JSON.stringify({ ativo: true, role: { nome: 'admin' } }));
    localStorage.setItem('token', 'token-teste');
    renderizar();
    act(() => logout());
    expect(screen.queryByText('Cofre administrativo')).not.toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });
});
