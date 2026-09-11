import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listarArquivosVenda: vi.fn(),
  excluirArquivoVenda: vi.fn(),
  uploadArquivoVenda: vi.fn()
}));

vi.mock('../../services/venda.service', async importOriginal => ({
  ...(await importOriginal()),
  listarArquivosVenda: api.listarArquivosVenda,
  excluirArquivoVenda: api.excluirArquivoVenda,
  uploadArquivoVenda: api.uploadArquivoVenda
}));

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

import { ArquivosVendaTab } from './VendaModal';

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function resposta(nome) {
  return {
    arquivos: [{
      id: nome,
      nome_original: nome,
      categoria: 'documento',
      arquivo: { tamanho_bytes: 10 },
      criado_por: { nome: 'Teste' }
    }],
    etapas_arquivos: [],
    pacote: null
  };
}

describe('VendaModal - arquivos', () => {
  it('não deixa a resposta da venda anterior sobrescrever a venda atual', async () => {
    const antiga = deferred();
    const recente = deferred();
    api.listarArquivosVenda
      .mockReturnValueOnce(antiga.promise)
      .mockReturnValueOnce(recente.promise);

    const { rerender } = render(
      <ArquivosVendaTab venda={{ id: 1 }} podeVisualizar podeAdicionar podeEditar />
    );
    await waitFor(() => expect(api.listarArquivosVenda).toHaveBeenCalledWith(1));

    rerender(<ArquivosVendaTab venda={{ id: 2 }} podeVisualizar podeAdicionar podeEditar />);
    await waitFor(() => expect(api.listarArquivosVenda).toHaveBeenCalledWith(2));

    await act(async () => {
      recente.resolve(resposta('arquivo-recente.pdf'));
    });
    expect(await screen.findByText('arquivo-recente.pdf')).toBeInTheDocument();

    await act(async () => {
      antiga.resolve(resposta('arquivo-antigo.pdf'));
    });

    expect(screen.queryByText('arquivo-antigo.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('arquivo-recente.pdf')).toBeInTheDocument();
  });

  it('avisa a tela imediatamente depois de persistir um arquivo', async () => {
    const onArquivosAlterados = vi.fn();
    api.listarArquivosVenda.mockResolvedValue({ arquivos: [], etapas_arquivos: [], pacote: null });
    api.uploadArquivoVenda.mockResolvedValue({ id: 10 });

    const { container } = render(
      <ArquivosVendaTab
        venda={{ id: 7 }}
        podeVisualizar
        podeAdicionar
        podeEditar
        onArquivosAlterados={onArquivosAlterados}
      />
    );
    await screen.findByText('Nenhum arquivo anexado');

    const arquivo = new File(['documento'], 'documento.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [arquivo] } });

    await waitFor(() => expect(api.uploadArquivoVenda).toHaveBeenCalledWith(
      7,
      arquivo,
      { categoria: 'documento' },
      expect.any(Function)
    ));
    await waitFor(() => expect(onArquivosAlterados).toHaveBeenCalledTimes(1));
  });

  it('avisa a tela imediatamente depois de excluir um arquivo', async () => {
    const onArquivosAlterados = vi.fn();
    api.listarArquivosVenda.mockResolvedValue(resposta('contrato.pdf'));
    api.excluirArquivoVenda.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ArquivosVendaTab
        venda={{ id: 8 }}
        podeVisualizar
        podeAdicionar
        podeEditar
        onArquivosAlterados={onArquivosAlterados}
      />
    );
    await screen.findByText('contrato.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.excluirArquivoVenda).toHaveBeenCalledWith(8, 'contrato.pdf'));
    await waitFor(() => expect(onArquivosAlterados).toHaveBeenCalledTimes(1));
  });
});
