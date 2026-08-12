import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiBlob: vi.fn(),
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiRequest: vi.fn(),
}));

import { apiBlob, apiDelete, apiGet, apiPost, apiPut, apiRequest } from './api';
import * as campanha from './campanha.service';
import * as clienteAntigo from './cliente-antigo.service';
import * as config from './config.service';
import * as fechamento from './fechamento.service';
import * as mensagem from './mensagem.service';
import * as notificacao from './notificacao.service';
import * as nota from './nota.service';
import * as usuario from './usuario.service';

describe('servicos administrativos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ ok: true });
    apiPost.mockResolvedValue({ ok: true });
    apiPut.mockResolvedValue({ ok: true });
    apiDelete.mockResolvedValue({ ok: true });
    apiRequest.mockResolvedValue({ ok: true });
    apiBlob.mockResolvedValue(new Blob(['arquivo']));
  });

  it('encaminha operacoes de campanhas para os endpoints corretos', async () => {
    await campanha.getCampanhas();
    await campanha.updateCampanhas([{ id: 1 }]);
    await campanha.createCampanha({ nome: 'Meta' });
    await campanha.deleteCampanha(3);
    await campanha.getProgresso();
    await campanha.getProgressoUsuarios();
    await campanha.resgatarCampanha(4);

    expect(apiGet).toHaveBeenCalledWith('/campanhas');
    expect(apiPut).toHaveBeenCalledWith('/campanhas', { campanhas: [{ id: 1 }] });
    expect(apiPost).toHaveBeenCalledWith('/campanhas', { nome: 'Meta' });
    expect(apiDelete).toHaveBeenCalledWith('/campanhas/3');
    expect(apiGet).toHaveBeenCalledWith('/campanhas/progresso');
    expect(apiGet).toHaveBeenCalledWith('/campanhas/progresso/usuarios');
    expect(apiPost).toHaveBeenCalledWith('/campanhas/4/resgatar', {});
  });

  it('normaliza filtros de clientes antigos e preserva dados de importacao', async () => {
    const arquivo = new File(['conteudo'], 'clientes.xlsx');
    await clienteAntigo.buscarClienteAntigo('  Empresa ', { page: 2, per_page: 25 });
    await clienteAntigo.listarHistoricoClientesAntigos({ busca: '12.345.678/0001-90', ativo: true, vazio: '' });
    await clienteAntigo.atualizarClienteAntigo(8, { telefone: '11999999999' });
    await clienteAntigo.excluirClienteAntigo(8);
    await clienteAntigo.previewPlanilhaClientesAntigos(arquivo);
    await clienteAntigo.importarPlanilhaClientesAntigos(arquivo, { cnpj: 'A' }, ['Dados']);

    expect(apiGet).toHaveBeenCalledWith('/clientes-antigos/buscar?termo=Empresa&page=2&per_page=25');
    expect(apiGet).toHaveBeenCalledWith('/clientes-antigos/historico?busca=12345678000190&ativo=true');
    expect(apiRequest).toHaveBeenCalledWith('/clientes-antigos/8', { method: 'PATCH', body: JSON.stringify({ telefone: '11999999999' }) });
    expect(apiDelete).toHaveBeenCalledWith('/clientes-antigos/8');
    expect(apiRequest.mock.calls[2][0]).toBe('/clientes-antigos/planilha/importar');
    expect(apiRequest.mock.calls[2][1].body.get('mapeamento')).toBe('{"cnpj":"A"}');
    expect(apiRequest.mock.calls[2][1].body.get('abas')).toBe('["Dados"]');
  });

  it('monta endpoints de configuracao e CRUD administrativo', async () => {
    await config.listarOperadoras();
    await config.listarTiposProduto();
    await config.listarServicosAdmin();
    await config.criarOperadora({ nome: 'Claro' });
    await config.atualizarTipoVenda(2, { nome: 'Nova' });
    await config.excluirRegraComissao(3);
    await config.reordenarEtapasFunil([{ id: 1, ordem: 2 }]);
    await config.atualizarAparenciaNotificacao(1, { cor: '#fff' });

    expect(apiGet).toHaveBeenCalledWith('/config/operadoras');
    expect(apiGet).toHaveBeenCalledWith('/config/tipos-produto');
    expect(apiGet).toHaveBeenCalledWith('/config/admin/servicos');
    expect(apiPost).toHaveBeenCalledWith('/config/admin/operadoras', { nome: 'Claro' });
    expect(apiPut).toHaveBeenCalledWith('/config/admin/tipos-venda/2', { nome: 'Nova' });
    expect(apiDelete).toHaveBeenCalledWith('/config/admin/regras-comissao/3');
    expect(apiPut).toHaveBeenCalledWith('/config/admin/funil-etapas/reorder', { ordens: [{ id: 1, ordem: 2 }] });
    expect(apiPut).toHaveBeenCalledWith('/config/admin/notificacao-aparencias/1', { cor: '#fff' });
  });

  it('serializa filtros e acoes de fechamento, notificacoes e mensagens', async () => {
    const createObjectURL = vi.fn(() => 'blob:arquivo');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await fechamento.getResumo({ data_inicio: '2026-01-01', ignorar: '' });
    await fechamento.getDossieVenda(9, { pagina: 2 });
    await fechamento.exportarVendasPeriodo({ data_inicio: '2026-01-01', data_fim: '2026-01-31' });
    await notificacao.listarNotificacoes({ lida: false, vazio: null });
    await notificacao.marcarNotificacaoLida(2);
    await mensagem.listarMensagens(7, { page: 3 });
    await mensagem.enviarMensagem(7, 'Oi', { arquivo_id: 1, nome_original: 'a.pdf' });
    await mensagem.enviarMensagensEmLote([7, 8], 'Olá', { arquivo_id: 1, nome_original: 'a.pdf' });
    await mensagem.marcarConversaLida(7);
    await nota.criarNotaEntidade('vendas', 9, { texto: 'ok' });

    expect(apiGet).toHaveBeenCalledWith('/fechamento/resumo?data_inicio=2026-01-01');
    expect(apiGet).toHaveBeenCalledWith('/fechamento/vendas/9/dossie?pagina=2');
    expect(apiGet).toHaveBeenCalledWith('/notificacoes?lida=false');
    expect(apiRequest).toHaveBeenCalledWith('/notificacoes/2/lida', { method: 'PATCH' });
    expect(apiGet).toHaveBeenCalledWith('/mensagens/conversas/7?page=3');
    expect(apiPost).toHaveBeenCalledWith('/mensagens', { destinatario_id: 7, conteudo: 'Oi', arquivo_id: 1, nome_arquivo: 'a.pdf' });
    expect(apiPost).toHaveBeenCalledWith('/mensagens/lote', { destinatario_ids: [7, 8], conteudo: 'Olá', arquivo_id: 1, nome_arquivo: 'a.pdf' });
    expect(apiRequest).toHaveBeenCalledWith('/mensagens/conversas/7/lida', { method: 'PATCH' });
    expect(apiPost).toHaveBeenCalledWith('/notas/vendas/9', { texto: 'ok' });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:arquivo');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('encaminha operacoes de usuarios', async () => {
    await usuario.listarUsuarios();
    await usuario.buscarUsuarioPorId(2);
    await usuario.listarPermissoes();
    await usuario.criarUsuario({ nome: 'Ana', email: 'ana@teste.com', senha: '123', role_id: 2, permissoes: ['x'] });
    await usuario.atualizarUsuario(2, { nome: 'Nova' });
    await usuario.deletarUsuario(2);

    expect(apiGet).toHaveBeenCalledWith('/usuarios');
    expect(apiGet).toHaveBeenCalledWith('/usuarios/2');
    expect(apiGet).toHaveBeenCalledWith('/permissoes');
    expect(apiPost).toHaveBeenCalledWith('/usuarios', { nome: 'Ana', email: 'ana@teste.com', senha: '123', role_id: 2, permissoes: ['x'] });
    expect(apiPut).toHaveBeenCalledWith('/usuarios/2', { nome: 'Nova' });
    expect(apiDelete).toHaveBeenCalledWith('/usuarios/2');
  });
});
