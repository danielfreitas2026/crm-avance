import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

vi.mock('../../services/auth.service', () => ({ temPermissao: (_usuario, permissao) => permissao !== 'campanhas_visualizar' }));
vi.mock('../../services/campanha.service', () => ({ getCampanhas: vi.fn(), getProgresso: vi.fn() }));

describe('menu do gerenciador de senhas', () => {
  afterEach(cleanup);
  it.each([{ ativo: true, role: { nome: 'usuario' } }, { ativo: false, role: { nome: 'admin' } }])('oculta mesmo quando existem permissões de usuários: %j', usuario => {
    render(<Sidebar usuario={usuario} setPage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Gerenciador de senhas' })).not.toBeInTheDocument();
  });
  it('permite administrador ativo e seleciona a página de senhas', () => {
    const setPage = vi.fn();
    render(<Sidebar usuario={{ nome: 'Admin', ativo: true, role: { nome: 'admin' } }} setPage={setPage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerenciador de senhas' }));
    expect(setPage).toHaveBeenCalledWith('senhas');
  });
});
