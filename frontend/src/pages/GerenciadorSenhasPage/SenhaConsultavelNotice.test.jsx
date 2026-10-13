import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CadastroUsuario from '../CadastroUsuario/CadastroUsuario';
import EditarUsuarioPage from '../EditarUsuarioPage/EditarUsuarioPage';
import EditarPerfilPage from '../EditarPerfilPage/EditarPerfilPage';

const usuario = vi.hoisted(() => ({
  id: 2, nome: 'Ana', email: 'ana@teste.local', role_id: 2, role: { nome: 'usuario' }, ativo: true, permissoes: []
}));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => usuario,
  temPermissao: () => false,
  buscarPerfil: vi.fn().mockResolvedValue(usuario),
  atualizarPerfil: vi.fn()
}));
vi.mock('../../services/usuario.service', () => ({
  criarUsuario: vi.fn(),
  atualizarUsuario: vi.fn(),
  listarUsuarios: vi.fn().mockResolvedValue([]),
  listarPermissoes: vi.fn().mockResolvedValue([]),
  buscarUsuarioPorId: vi.fn().mockResolvedValue(usuario)
}));

describe('aviso sobre consulta administrativa das senhas', () => {
  afterEach(cleanup);
  it.each([
    ['cadastro', CadastroUsuario],
    ['edição administrativa', EditarUsuarioPage],
    ['perfil', EditarPerfilPage]
  ])('informa no formulário de %s', async (_nome, Componente) => {
    render(<MemoryRouter initialEntries={['/usuarios/2/editar']}><Routes>
      <Route path="/usuarios/:id/editar" element={<Componente />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText(/Administradores poderão consultar.*senha no gerenciador/)).toBeInTheDocument();
  });
});
