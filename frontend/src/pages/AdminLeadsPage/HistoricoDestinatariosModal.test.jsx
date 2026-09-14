import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoricoDestinatariosModal } from './AdminLeadsPage';

const PLANILHA = { id: 1, nome: 'Agosto 24' };

describe('HistoricoDestinatariosModal', () => {
  it('mostra resumo, pessoa, lotes, etapas e situações', () => {
    render(<HistoricoDestinatariosModal
      planilha={PLANILHA}
      carregando={false}
      erro=""
      onClose={vi.fn()}
      historico={{
        resumo: { pessoas: 1, atribuicoes: 10, clientes_unicos: 8, atualmente_atribuidos: 4 },
        cobertura_historica: { aviso: 'Registros legados podem estar incompletos.' },
        pessoas: [{
          usuario_id: 9,
          usuario_nome: 'Consultora Teste',
          total_recebido: 10,
          clientes_unicos: 8,
          quantidade_atual: 4,
          envios: [
            { envio_id: 30, envio_nome: 'Envio inicial', etapa: 'sondagem', enviado_em: '2026-08-01T12:00:00Z', quantidade_recebida: 6, quantidade_atual: 0, situacao: 'encerrado' },
            { envio_id: 31, envio_nome: 'Envio de venda', etapa: 'venda', enviado_em: '2026-08-02T12:00:00Z', quantidade_recebida: 4, quantidade_atual: 4, situacao: 'atual' }
          ]
        }]
      }}
    />);

    expect(screen.getByText('Consultora Teste')).toBeVisible();
    expect(screen.getByText('Quem já recebeu este mailing')).toBeVisible();
    expect(screen.getByText('Pessoas que receberam')).toBeVisible();
    expect(screen.getByText('Total de entregas')).toBeVisible();
    expect(screen.getByText('Sem duplicar os reenvios')).toBeVisible();
    expect(screen.getByText('Como interpretar')).toBeVisible();
    expect(screen.getByText('Lote de envio e data')).toBeVisible();
    expect(screen.getByText('Ainda possui')).toBeVisible();
    expect(screen.getByText('Envio inicial')).toBeVisible();
    expect(screen.getByText('Envio de venda')).toBeVisible();
    expect(screen.getByText('Sondagem')).toBeVisible();
    expect(screen.getByText('Venda')).toBeVisible();
    expect(screen.getByText('Encerrado')).toBeVisible();
    expect(screen.getByText('Atual')).toBeVisible();
    expect(screen.getByText(/O histórico é completo desde 11\/07\/2026/)).toBeVisible();

    const tituloEtapa = screen.getByText('Etapa');
    const valorEtapa = screen.getByText('Sondagem');
    expect(tituloEtapa).toHaveClass('leads-history-send__compact');
    expect(valorEtapa).toHaveClass('leads-history-send__compact');
  });

  it('mostra os estados de carregamento, erro e histórico vazio', () => {
    const { rerender } = render(<HistoricoDestinatariosModal planilha={PLANILHA} carregando historico={null} erro="" onClose={vi.fn()} />);
    expect(screen.getByText('Carregando histórico...')).toBeVisible();

    rerender(<HistoricoDestinatariosModal planilha={PLANILHA} carregando={false} historico={null} erro="Falha controlada" onClose={vi.fn()} />);
    expect(screen.getByText('Falha controlada')).toBeVisible();

    rerender(<HistoricoDestinatariosModal
      planilha={PLANILHA}
      carregando={false}
      erro=""
      onClose={vi.fn()}
      historico={{ resumo: {}, pessoas: [] }}
    />);
    expect(screen.getByText('Esta planilha ainda não foi enviada para ninguém.')).toBeVisible();
  });
});
