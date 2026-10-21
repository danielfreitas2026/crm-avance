import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientesAntigosPage from './ClientesAntigosPage';
import { buscarClienteAntigo, listarHistoricoClientesAntigos } from '../../services/cliente-antigo.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({ getUsuarioLocal: () => ({ id: 7 }), temPermissao: () => true }));
vi.mock('../../services/cliente-antigo.service', async original => ({
  ...(await original()), buscarClienteAntigo: vi.fn(), listarHistoricoClientesAntigos: vi.fn()
}));

describe('navegação em clientes antigos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('usuario', '{"id":7}');
    buscarClienteAntigo.mockResolvedValue({ resultados: [], vendas_clientes: [], total: 0, encontrado: false });
    listarHistoricoClientesAntigos.mockResolvedValue({ data: [], total: 100 });
  });
  it('refaz somente a consulta aplicada com sua página, preservando o texto de busca', async () => {
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:termoInput', '"Empresa digitada"');
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:consulta', '"Empresa consultada"');
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:paginaBusca', '3');
    render(<ClientesAntigosPage />);
    expect(screen.getByPlaceholderText('CNPJ, CPF, telefone, razao social, responsavel...')).toHaveValue('Empresa digitada');
    await waitFor(() => expect(buscarClienteAntigo).toHaveBeenCalledExactlyOnceWith('Empresa consultada', { page: 3, per_page: 20 }));
  });
  it('retoma a aba Histórico de buscas e sua paginação', async () => {
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:aba', '"historico"');
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:pagina', '4');
    sessionStorage.setItem('crm:navegacao:v1:7:ClientesAntigosPage:buscaHistorico', '"Empresa"');
    render(<ClientesAntigosPage />);
    await waitFor(() => expect(listarHistoricoClientesAntigos).toHaveBeenCalledWith({ page: 4, per_page: 20, busca: 'Empresa' }));
    expect(buscarClienteAntigo).not.toHaveBeenCalled();
  });
});
