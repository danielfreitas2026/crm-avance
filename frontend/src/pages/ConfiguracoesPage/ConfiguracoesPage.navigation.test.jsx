import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfiguracoesPage from './ConfiguracoesPage';

const auth = vi.hoisted(() => ({ permissoes: ['crud_operadoras', 'crud_servicos'] }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 7 }),
  temPermissao: (_usuario, permissao) => auth.permissoes.includes(permissao)
}));
vi.mock('../../services/config.service', async original => {
  const actual = await original();
  return Object.fromEntries(Object.entries(actual).map(([key, value]) => [key,
    typeof value === 'function' ? vi.fn().mockResolvedValue([]) : value]));
});

describe('navegação das configurações', () => {
  beforeEach(() => {
    localStorage.setItem('usuario', '{"id":7}');
    auth.permissoes = ['crud_operadoras', 'crud_servicos'];
  });

  it('retoma a aba Serviços ao atualizar ou retornar à seção', async () => {
    const user = userEvent.setup();
    const first = render(<ConfiguracoesPage />);
    await user.click(await screen.findByRole('button', { name: 'Serviços', exact: true }));
    expect(screen.getByRole('button', { name: 'Serviços', exact: true })).toHaveClass('active');
    first.unmount();
    render(<ConfiguracoesPage />);
    expect(screen.getByRole('button', { name: 'Serviços', exact: true })).toHaveClass('active');
  });

  it('abandona a aba restaurada quando o perfil perde a permissão correspondente', async () => {
    sessionStorage.setItem('crm:navegacao:v1:7:ConfiguracoesPage:aba', '"servicos"');
    render(<ConfiguracoesPage />);
    expect(screen.getByRole('button', { name: 'Serviços', exact: true })).toHaveClass('active');
    auth.permissoes = ['crud_operadoras'];
    await act(async () => window.dispatchEvent(new CustomEvent('auth:usuario-atualizado', { detail: { id: 7 } })));
    expect(screen.queryByRole('button', { name: 'Serviços', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operadoras', exact: true })).toHaveClass('active');
  });
});
