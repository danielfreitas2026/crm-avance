import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

const api = vi.hoisted(() => ({
  getCampanhas: vi.fn(),
  getProgresso: vi.fn()
}));

vi.mock('../../services/campanha.service', () => api);
vi.mock('../../services/auth.service', () => ({
  temPermissao: (_usuario, permissao) => permissao === 'campanhas_visualizar'
}));

describe('Sidebar - campanhas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCampanhas.mockResolvedValue([
      { id: 1, is_gift: true, desc: 'Campanha atual', estado_periodo: 'ativa', participante_ids: [7], target: 10 },
      { id: 2, is_gift: true, desc: 'Campanha arquivada', estado_periodo: 'encerrada', participante_ids: [7], target: 10 }
    ]);
    api.getProgresso.mockResolvedValue({
      campanhas_visiveis: [1, 2],
      estados_campanhas: { 1: 'ativa', 2: 'encerrada' },
      campanhas: { 1: { current: 4, target: 10 }, 2: { current: 10, target: 10 } },
      resgatadas: []
    });
  });

  it('mantem somente campanhas atuais no resumo operacional', async () => {
    render(<Sidebar usuario={{ id: 7 }} setPage={vi.fn()} onLogout={vi.fn()} onPerfilClick={vi.fn()} />);

    expect(await screen.findByText('Campanha atual')).toBeInTheDocument();
    expect(screen.queryByText('Campanha arquivada')).not.toBeInTheDocument();
  });
});
