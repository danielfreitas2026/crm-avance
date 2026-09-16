import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppRoutes from '../../routes/AppRoutes';

function renderRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

describe('Páginas públicas da integração Gmail', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it.each([
    ['/integracao-gmail', 'Integração Gmail do Pós-venda Avance VIP', 'Integração Gmail | Pós-venda Avance VIP'],
    ['/privacidade', 'Política de Privacidade', 'Política de Privacidade | Pós-venda Avance VIP'],
    ['/termos', 'Termos de Uso', 'Termos de Uso | Pós-venda Avance VIP']
  ])('abre %s sem autenticação e atualiza os metadados', async (path, heading, title) => {
    localStorage.clear();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderRoute(path);

    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acessar o CRM' })).toHaveAttribute('href', '/login');
    await waitFor(() => expect(document.title).toBe(title));
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('oferece no login links permanentes para todas as páginas públicas', () => {
    renderRoute('/login');

    expect(screen.getByRole('link', { name: 'Integração Gmail' })).toHaveAttribute('href', '/integracao-gmail');
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(screen.getByRole('link', { name: 'Termos' })).toHaveAttribute('href', '/termos');
  });

  it('declara o tratamento do Gmail, a retenção e o compartilhamento com Telegram', () => {
    renderRoute('/privacidade');

    expect(screen.getByText(/corpo textual original é removido do CRM após 12 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/alertas internos enviados pelo Telegram podem conter/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy'
    );
  });
});
