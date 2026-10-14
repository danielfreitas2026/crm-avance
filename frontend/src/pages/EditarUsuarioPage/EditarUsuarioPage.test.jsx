import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditarUsuarioPage from './EditarUsuarioPage';
import * as usuarios from '../../services/usuario.service';
import { getUsuarioLocal } from '../../services/auth.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../services/usuario.service', () => ({
  buscarUsuarioPorId: vi.fn(), listarPermissoes: vi.fn(), atualizarUsuario: vi.fn(), visualizarSenhaUsuario: vi.fn()
}));
vi.mock('../../services/auth.service', async importOriginal => ({
  ...await importOriginal(), getUsuarioLocal: vi.fn()
}));

function abrir() {
  return render(<MemoryRouter initialEntries={['/usuarios/2']}>
    <Routes><Route path="/usuarios/:id" element={<EditarUsuarioPage />} /></Routes>
  </MemoryRouter>);
}

describe('Senha atual na edição de usuários', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUsuarioLocal.mockReturnValue({ id: 7, role: { nome: 'usuario' }, permissoes: ['usuarios_editar'] });
    usuarios.buscarUsuarioPorId.mockResolvedValue({ id: 2, nome: 'Ana', email: 'ana@teste.com', role_id: 2, ativo: true });
    usuarios.listarPermissoes.mockResolvedValue([]);
    usuarios.visualizarSenhaUsuario.mockResolvedValue({ senha: 'atual' });
    usuarios.atualizarUsuario.mockResolvedValue({ id: 2 });
  });

  it('mantém nova senha separada, limpa a consulta ao salvar e não envia a senha revelada', async () => {
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Visualizar senha atual' }));
    expect(await screen.findByLabelText('Senha atual')).toHaveValue('atual');
    fireEvent.change(screen.getByPlaceholderText('Deixe em branco para manter a senha atual'), { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(usuarios.atualizarUsuario).toHaveBeenCalledWith('2', {
      nome: 'Ana', email: 'ana@teste.com', ativo: true, role_id: 2, senha: 'nova'
    }));
    await waitFor(() => expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('Deixe em branco para manter a senha atual')).toHaveValue('');
  });

  it.each([
    { role: { nome: 'usuario' }, permissoes: ['usuarios_listar'], alvoAdmin: false },
    { role: { nome: 'usuario' }, permissoes: ['usuarios_editar'], alvoAdmin: true }
  ])('não oferece consulta sem autorização para o alvo', async ({ role, permissoes, alvoAdmin }) => {
    getUsuarioLocal.mockReturnValue({ id: 7, role, permissoes });
    if (alvoAdmin) usuarios.buscarUsuarioPorId.mockResolvedValue({ id: 2, nome: 'Admin', role_id: 1, ativo: true });
    abrir();
    await screen.findByRole('heading', { name: 'Editar usuário' });
    expect(screen.queryByRole('button', { name: 'Visualizar senha atual' })).not.toBeInTheDocument();
    expect(usuarios.visualizarSenhaUsuario).not.toHaveBeenCalled();
  });

  it('oferece consulta a administrador editando administrador', async () => {
    getUsuarioLocal.mockReturnValue({ id: 7, role: { nome: 'admin' }, permissoes: {} });
    usuarios.buscarUsuarioPorId.mockResolvedValue({ id: 2, nome: 'Admin', role_id: 1, ativo: true });
    abrir();
    expect(await screen.findByRole('button', { name: 'Visualizar senha atual' })).toBeEnabled();
    expect(usuarios.visualizarSenhaUsuario).not.toHaveBeenCalled();
  });
});
