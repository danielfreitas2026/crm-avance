import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../services/auth.service', () => ({ temPermissao: (_usuario, permissao) => permissao !== 'campanhas_visualizar' }));
vi.mock('../../services/campanha.service', () => ({ getCampanhas: vi.fn(), getProgresso: vi.fn() }));

describe('menu administrativo sem gerenciador de senhas', () => {
  afterEach(cleanup);
  it.each([{ ativo: true, role: { nome: 'usuario' } }, { ativo: false, role: { nome: 'admin' } }, { ativo: true, role: { nome: 'admin' } }])('não oferece consulta de senhas: %j', usuario => {
    render(<Sidebar usuario={usuario} setPage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Gerenciador de senhas' })).not.toBeInTheDocument();
  });
  it('preserva a navegação para o cadastro de usuários', () => {
    const setPage = vi.fn();
    render(<Sidebar usuario={{ nome: 'Admin', ativo: true, role: { nome: 'admin' } }} setPage={setPage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Usuários' }));
    expect(setPage).toHaveBeenCalledWith('usuarios');
  });
});
