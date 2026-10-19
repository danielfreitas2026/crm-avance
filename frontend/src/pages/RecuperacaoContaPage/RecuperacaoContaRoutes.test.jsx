import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppRoutes from '../../routes/AppRoutes';

describe('rotas públicas de recuperação', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it.each([
    ['/esqueci-minha-senha', 'Recuperar acesso'],
    ['/confirmar-email-recuperacao', 'Confirmar e-mail de recuperação'],
    ['/redefinir-senha', 'Redefinir senha']
  ])('abre %s sem sessão', (path, titulo) => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: titulo })).toBeInTheDocument();
  });

  it('login oferece recuperação e mudança entre rotas não mantém resultado da confirmação', async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Confirmado.' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    try {
      render(<MemoryRouter initialEntries={[`/confirmar-email-recuperacao#token=${'a'.repeat(64)}`]}><AppRoutes /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Confirmado.');
      fireEvent.click(screen.getByRole('link', { name: 'Voltar ao login' }));
      fireEvent.click(screen.getByRole('link', { name: 'Esqueci minha senha' }));
      expect(screen.getByRole('button', { name: 'Enviar instruções' })).toBeInTheDocument();
      expect(screen.queryByText('Confirmado.')).not.toBeInTheDocument();
    } finally { globalThis.fetch = fetchOriginal; }
  });
});
