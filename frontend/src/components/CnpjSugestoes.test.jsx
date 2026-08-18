import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CnpjSugestoes from './CnpjSugestoes';
import { formatarMensagemResumoCnpj } from './cnpjSugestoes.utils';

const dados = {
  fontesComSucesso: ['receita', 'brasilapi'],
  fontesPorCampo: {
    razaoSocial: {
      fonte: 'receita',
      atualizadoEm: '2026-05-18',
      confianca: 'alta',
    },
    telefone: {
      fonte: 'brasilapi',
      atualizadoEm: '2026-05-17',
      confianca: 'baixa',
      divergente: true,
    },
  },
  alertas: [
    { tipo: 'divergencia', campo: 'telefone', mensagem: 'Telefone divergente entre fontes.' },
  ],
};

describe('CnpjSugestoes', () => {
  it('nao renderiza quando nao ha dados ou sugestoes preenchidas', () => {
    const { container, rerender } = render(
      <CnpjSugestoes dados={null} sugestoes={{ razaoSocial: 'Empresa' }} />
    );

    expect(container).toBeEmptyDOMElement();

    rerender(<CnpjSugestoes dados={dados} sugestoes={{ razaoSocial: '' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('monta resumo com origem, data, alertas e cache', () => {
    expect(formatarMensagemResumoCnpj({ ...dados, cache: true })).toContain('2 fontes');
    expect(formatarMensagemResumoCnpj({ ...dados, cache: true })).toContain('1 alerta(s)');
    expect(formatarMensagemResumoCnpj({ ...dados, cache: true })).toContain('Resposta do cache');
  });

  it('renderiza campos sugeridos com metadados e alertas', () => {
    render(
      <CnpjSugestoes
        dados={dados}
        sugestoes={{ razaoSocial: 'Empresa Teste LTDA', telefone: '(11) 99999-0000' }}
        labels={{ razaoSocial: 'Razao social', telefone: 'Telefone' }}
        onAceitar={vi.fn()}
        onRecusar={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /conferir dados do cnpj/i })).toBeInTheDocument();
    expect(screen.getByText('Telefone divergente entre fontes.')).toBeInTheDocument();
    expect(screen.getByText('Razao social')).toBeInTheDocument();
    expect(screen.getByText('Empresa Teste LTDA')).toBeInTheDocument();
    expect(screen.getByText(/\(11\) 99999-0000/)).toBeInTheDocument();
    expect(screen.getAllByText(/divergente/i)).toHaveLength(2);
  });

  it('chama callbacks ao aceitar, negar e ignorar todos', async () => {
    const user = userEvent.setup();
    const onAceitar = vi.fn();
    const onRecusar = vi.fn();

    render(
      <CnpjSugestoes
        dados={dados}
        sugestoes={{ razaoSocial: 'Empresa Teste LTDA', telefone: '(11) 99999-0000' }}
        labels={{ razaoSocial: 'Razao social', telefone: 'Telefone' }}
        onAceitar={onAceitar}
        onRecusar={onRecusar}
      />
    );

    await user.click(screen.getAllByRole('button', { name: /aceitar/i })[0]);
    await user.click(screen.getAllByRole('button', { name: /negar/i })[1]);
    await user.click(screen.getByRole('button', { name: /ignorar todos/i }));

    expect(onAceitar).toHaveBeenCalledWith('razaoSocial');
    expect(onRecusar).toHaveBeenCalledWith('telefone');
    expect(onRecusar).toHaveBeenCalledWith('razaoSocial');
    expect(onRecusar).toHaveBeenCalledTimes(3);
  });
});
