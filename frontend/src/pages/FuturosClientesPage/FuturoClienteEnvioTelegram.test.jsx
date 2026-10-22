import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FuturoClienteDetalheModal } from './FuturosClientesPage';
import * as leadPlanilhaService from '../../services/lead-planilha.service';
import * as configService from '../../services/config.service';

const linha = {
  id: 10, futuro_cliente: true, futuro_cliente_destino: 'distribuicao',
  status_operacional: 'qualificado', dados_json: {}, envio: { nome: 'Mailing teste' },
  distribuicao: { id: 20, status: 'recusado' }
};

function historico(situacao = 'sem_confirmacao', ultimo_envio_em = null, linha_id = 10) {
  return { linha_id, envio_telegram: { situacao, ultimo_envio_em }, eventos: [] };
}

function abrir(props = {}) {
  return render(<FuturoClienteDetalheModal
    linha={linha} onClose={vi.fn()} onAtualizado={vi.fn()} onRegistrarVenda={vi.fn()}
    exibirHistorico {...props}
  />);
}

describe('indicador de envio ao Telegram na visão Todos', () => {
  beforeEach(() => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7, permissoes: { futuros_clientes_ver_todos: true }
    }));
    vi.spyOn(configService, 'listarOperadoras').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('usuario');
  });

  it('mostra a confirmação mesmo após devolução e formata a data no fuso de São Paulo', async () => {
    const buscar = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockResolvedValue(historico('enviado', '2026-08-21T01:30:00.000Z'));
    const tela = abrir();
    expect(await screen.findByText('Já enviado ao Telegram')).toBeVisible();
    const indicador = screen.getByRole('status', { name: 'Envio ao Telegram' });
    expect(indicador).toHaveTextContent('Último envio confirmado em 20/08/2026 às 22:30');
    expect(indicador.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    tela.rerender(<FuturoClienteDetalheModal linha={{ ...linha, distribuicao: { status: 'expirado_sem_aceite' } }}
      onClose={vi.fn()} onAtualizado={vi.fn()} onRegistrarVenda={vi.fn()} exibirHistorico />);
    expect(screen.getByText('Já enviado ao Telegram')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }));
    expect(screen.getByText('Já enviado ao Telegram')).toBeVisible();
    expect(await screen.findByText('Nenhum evento comercial encontrado.')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Dados atuais' }));
    expect(screen.getByText('Já enviado ao Telegram')).toBeVisible();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem_confirmacao', 'Sem envio confirmado'],
    ['historico_incompleto', 'Histórico de envio incompleto']
  ])('mostra %s sem deduzir confirmação pelo destino distribuição', async (situacao, texto) => {
    vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente').mockResolvedValue(historico(situacao));
    abrir();
    expect(await screen.findByText(texto)).toBeVisible();
    expect(screen.queryByText('Já enviado ao Telegram')).not.toBeInTheDocument();
    expect(screen.queryByText(/Último envio confirmado/)).not.toBeInTheDocument();
  });

  it('mostra carregamento sem bloquear o formulário', async () => {
    let concluir;
    vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockReturnValue(new Promise(resolve => { concluir = resolve; }));
    abrir();
    expect(screen.getByText('Consultando envio ao Telegram…')).toBeVisible();
    expect(screen.getByLabelText('CNPJ')).toBeEnabled();
    await act(async () => concluir(historico()));
    expect(screen.getByText('Sem envio confirmado')).toBeVisible();
  });

  it('permite tentar novamente após falha e mantém o formulário utilizável', async () => {
    const buscar = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockRejectedValueOnce(new Error('Falha temporária'))
      .mockResolvedValueOnce(historico('enviado', '2026-08-20T15:30:00.000Z'));
    abrir();
    expect(await screen.findByText('Não foi possível consultar o envio')).toBeVisible();
    expect(screen.queryByText('Sem envio confirmado')).not.toBeInTheDocument();
    expect(screen.getByLabelText('CNPJ')).toBeEnabled();
    const indicador = screen.getByRole('status', { name: 'Envio ao Telegram' });
    fireEvent.click(within(indicador).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Já enviado ao Telegram')).toBeVisible();
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('não consulta nem mostra o indicador fora da visão Todos', () => {
    const buscar = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente');
    abrir({ exibirHistorico: false });
    expect(screen.queryByRole('status', { name: 'Envio ao Telegram' })).not.toBeInTheDocument();
    expect(buscar).not.toHaveBeenCalled();
  });

  it('limpa o resultado anterior ao trocar de cliente e descarta respostas atrasadas', async () => {
    let concluirAnterior;
    vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockResolvedValueOnce(historico('enviado', '2026-08-20T15:30:00.000Z'))
      .mockReturnValueOnce(new Promise(resolve => { concluirAnterior = resolve; }))
      .mockResolvedValueOnce(historico('sem_confirmacao', null, 12));
    const tela = abrir();
    expect(await screen.findByText('Já enviado ao Telegram')).toBeVisible();
    const props = { onClose: vi.fn(), onAtualizado: vi.fn(), onRegistrarVenda: vi.fn(), exibirHistorico: true };
    tela.rerender(<FuturoClienteDetalheModal {...props} linha={{ ...linha, id: 11 }} />);
    expect(screen.getByText('Consultando envio ao Telegram…')).toBeVisible();
    expect(screen.queryByText('Já enviado ao Telegram')).not.toBeInTheDocument();
    tela.rerender(<FuturoClienteDetalheModal {...props} linha={{ ...linha, id: 12 }} />);
    expect(await screen.findByText('Sem envio confirmado')).toBeVisible();
    await act(async () => concluirAnterior(historico('enviado', '2026-08-22T15:30:00.000Z', 11)));
    expect(screen.getByText('Sem envio confirmado')).toBeVisible();
    expect(screen.queryByText('Já enviado ao Telegram')).not.toBeInTheDocument();
  });

  it('consulta novamente a confirmação após reenviar ao Telegram', async () => {
    const buscar = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockResolvedValueOnce(historico('enviado', '2026-08-20T15:30:00.000Z'))
      .mockResolvedValueOnce(historico('enviado', '2026-08-21T16:45:00.000Z'));
    const enviar = vi.spyOn(leadPlanilhaService, 'enviarFuturoClienteParaDistribuicao').mockResolvedValue({ linha });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDistribuido = vi.fn();
    abrir({ permitirReenvioTelegram: true, onDistribuido });
    expect(await screen.findByText(/Último envio confirmado em 20\/08\/2026 às 12:30/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retornar ao Telegram' }));
    expect(await screen.findByText(/Último envio confirmado em 21\/08\/2026 às 13:45/)).toBeVisible();
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(enviar).toHaveBeenCalledWith(10);
    expect(onDistribuido).toHaveBeenCalledWith(linha, true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retornar ao Telegram' })).toBeEnabled());
  });
});
