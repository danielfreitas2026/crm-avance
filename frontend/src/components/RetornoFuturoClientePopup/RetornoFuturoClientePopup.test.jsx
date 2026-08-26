import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RetornoFuturoClientePopup from './RetornoFuturoClientePopup';
import { ordenarPopupsRetornoFuturo } from './retorno-futuro-popup.utils';

function criarNotificacao(id = 12, retorno = '2026-08-26T18:15:00.000Z') {
  return {
    id,
    titulo: 'Retorno de futuro cliente em breve',
    popup_retorno_futuro_disponivel: true,
    dados: {
      titulo_nota: `Empresa ${id}`,
      retorno_agendado_para: retorno
    }
  };
}

function Cenario({ notificacao = criarNotificacao(), onConfirmar = vi.fn().mockResolvedValue() }) {
  const [aberto, setAberto] = useState(true);

  async function confirmar(item) {
    await onConfirmar(item);
    setAberto(false);
  }

  return (
    <>
      <div role="dialog" aria-label="Modal atual">Conteudo ainda em edicao</div>
      {aberto && (
        <RetornoFuturoClientePopup
          notificacao={notificacao}
          atendimentoUrl="/futuros-clientes?aba=meus&linha_id=44"
          onConfirmar={confirmar}
        />
      )}
    </>
  );
}

describe('RetornoFuturoClientePopup', () => {
  it('fecha somente o aviso ao confirmar e preserva o modal atual', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn().mockResolvedValue();
    render(<Cenario onConfirmar={onConfirmar} />);

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Entendi' }));

    await waitFor(() => expect(screen.queryByText('Hora de retornar para Empresa 12')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Modal atual' })).toBeInTheDocument();
    expect(onConfirmar).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
  });

  it('trata Escape como confirmacao sem acionar o modal que esta abaixo', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn().mockResolvedValue();
    const fecharModalAtual = vi.fn();
    document.addEventListener('keydown', fecharModalAtual);
    render(<Cenario onConfirmar={onConfirmar} />);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledOnce());
    expect(fecharModalAtual).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Modal atual' })).toBeInTheDocument();
    document.removeEventListener('keydown', fecharModalAtual);
  });

  it('abre o atendimento em nova aba e confirma o aviso', async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn().mockResolvedValue();
    render(<Cenario onConfirmar={onConfirmar} />);

    const link = screen.getByRole('link', { name: /Atender agora/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('href', '/futuros-clientes?aba=meus&linha_id=44');
    link.addEventListener('click', event => event.preventDefault(), { once: true });
    await user.click(link);

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: 'Modal atual' })).toBeInTheDocument();
  });

  it('mantem o popup aberto para nova tentativa quando a confirmacao falha', async () => {
    const user = userEvent.setup();
    render(<Cenario onConfirmar={vi.fn().mockRejectedValue(new Error('Falha temporaria'))} />);

    await user.click(screen.getByRole('button', { name: 'Entendi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha temporaria');
    expect(screen.getByText('Hora de retornar para Empresa 12')).toBeInTheDocument();
  });

  it('ordena somente popups liberados pelo retorno mais proximo', () => {
    const posterior = criarNotificacao(2, '2026-08-26T19:00:00.000Z');
    const anterior = criarNotificacao(1, '2026-08-26T18:00:00.000Z');
    const indisponivel = { ...criarNotificacao(3), popup_retorno_futuro_disponivel: false };

    expect(ordenarPopupsRetornoFuturo([posterior, indisponivel, anterior]).map(item => item.id))
      .toEqual([1, 2]);
  });
});
