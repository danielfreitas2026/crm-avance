import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', () => ({
  buscarHorarioAcesso: vi.fn(),
  atualizarHorarioAcesso: vi.fn()
}));

import { atualizarHorarioAcesso, buscarHorarioAcesso } from '../../services/config.service';
import HorarioAcessoConfig from './HorarioAcessoConfig';

const configuracao = {
  ativo: false,
  fuso_horario: 'America/Sao_Paulo',
  dias: Array.from({ length: 7 }, (_, dia_semana) => ({ dia_semana, ativo: dia_semana === 1, abertura: '08:00', fechamento: '18:00' })),
  usuario_ids: [],
  usuarios: [{ id: 2, nome: 'Ana Silva', email: 'ana@teste.com', role_nome: 'admin' }]
};

describe('HorarioAcessoConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buscarHorarioAcesso.mockResolvedValue(configuracao);
    atualizarHorarioAcesso.mockImplementation(async dados => ({ ...configuracao, ...dados }));
  });

  it('configura a trava e seleciona usuário autorizado', async () => {
    const user = userEvent.setup();
    render(<HorarioAcessoConfig />);

    expect(await screen.findByText('Controle de horário')).toBeInTheDocument();
    await user.click(screen.getByText('Trava desativada'));
    await user.click(screen.getByText('Ana Silva'));
    expect(screen.getByText('Existem alterações não salvas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar horário de acesso' }));

    expect(atualizarHorarioAcesso).toHaveBeenCalledWith(expect.objectContaining({
      ativo: true,
      usuario_ids: [2],
      dias: expect.arrayContaining([expect.objectContaining({ dia_semana: 1, abertura: '08:00', fechamento: '18:00' })])
    }));
    expect(await screen.findByText('Horário de acesso atualizado com sucesso.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Configurações salvas');
    expect(screen.getByRole('button', { name: 'Configurações salvas' })).toBeDisabled();
  });
});
