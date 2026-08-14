const PERMISSOES = [
  {
    chave: 'vendas',
    nome: 'Vendas',
    descricao: 'Permite acessar o módulo de vendas. As ações dependem das subpermissões.'
  },
  {
    chave: 'vendas_ver_proprias',
    nome: 'Vendas: ver próprias',
    descricao: 'Permite ver vendas criadas pelo usuário ou vinculadas a ele como vendedora.'
  },
  {
    chave: 'vendas_ver_todas',
    nome: 'Vendas: ver todas',
    descricao: 'Permite ver todas as vendas cadastradas.'
  },
  {
    chave: 'vendas_limitar_ultimos_6_meses',
    nome: 'Vendas: limitar aos ultimos 6 meses',
    descricao: 'Limita a listagem, busca e exportacao de vendas as vendas dos ultimos 6 meses.'
  },
  {
    chave: 'vendas_criar',
    nome: 'Vendas: criar',
    descricao: 'Permite registrar novas vendas.'
  },
  {
    chave: 'vendas_auto_pos_venda',
    nome: 'Vendas: enviar automaticamente ao pos-venda',
    descricao: 'Envia automaticamente ao pos-venda as vendas registradas pelo usuario, sem exigir liberacao ADM.'
  },
  {
    chave: 'vendas_editar',
    nome: 'Vendas: editar',
    descricao: 'Permite editar vendas que o usuário pode acessar.'
  },
  {
    chave: 'vendas_permitir_reversoes',
    nome: 'Vendas: permitir reversões',
    descricao: 'Permite registrar alterações auditadas em vendas acessíveis.'
  },
  {
    chave: 'vendas_excluir_reversoes',
    nome: 'Vendas: excluir reversões',
    descricao: 'Permite ocultar reversões de vendas acessíveis, mediante justificativa auditada.'
  },
  {
    chave: 'compartilhar_venda',
    nome: 'Vendas: compartilhar',
    descricao: 'Permite vincular outras vendedoras a uma venda.'
  },
  {
    chave: 'vendas_atribuir_qualquer_vendedor',
    nome: 'Vendas: atribuir qualquer vendedor',
    descricao: 'Permite registrar vendas no nome de qualquer vendedor, podendo não se incluir na venda.'
  },
  {
    chave: 'ver_vendas_compartilhadas',
    nome: 'Vendas: ver compartilhadas',
    descricao: 'Permite ver vendas compartilhadas em que o usuário está vinculado como vendedor.'
  },
  {
    chave: 'editar_vendas_compartilhadas',
    nome: 'Vendas: editar compartilhadas',
    descricao: 'Permite editar vendas compartilhadas em que o usuário está vinculado como vendedor.'
  },
  {
    chave: 'vendas_excluir',
    nome: 'Vendas: excluir',
    descricao: 'Permite excluir vendas que o usuário pode acessar.'
  },
  {
    chave: 'vendas_documentos',
    nome: 'Vendas: visualizar documentos',
    descricao: 'Permite visualizar, baixar e listar documentos da venda.'
  },
  {
    chave: 'adicionar_documentos',
    nome: 'Vendas: adicionar documentos',
    descricao: 'Permite anexar novos documentos em vendas.'
  },
  {
    chave: 'vendas_aprovacoes_visualizar',
    nome: 'Vendas: visualizar aprovações',
    descricao: 'Permite acessar a página de solicitações de liberação de vendas especiais.'
  },
  {
    chave: 'vendas_aprovacoes_decidir',
    nome: 'Vendas: aprovar solicitações',
    descricao: 'Permite aprovar ou recusar solicitações de liberação de vendas especiais.'
  },
  {
    chave: 'pos_venda',
    nome: 'Pós-venda',
    descricao: 'Permite editar vendas já enviadas ao pós-venda e operar o funil.'
  },
  {
    chave: 'funil_vendas',
    nome: 'Funil de vendas',
    descricao: 'Permite acessar a página do funil de vendas.'
  },
  {
    chave: 'crud_funil_etapas',
    nome: 'Funil: gerenciar etapas',
    descricao: 'Permite criar, editar, listar e desativar etapas do funil de vendas.'
  },
  {
    chave: 'dashboard_resumo_vendas',
    nome: 'Início: resumo de vendas',
    descricao: 'Permite visualizar os cards de resumo de vendas na página inicial.'
  },
  {
    chave: 'campanhas_visualizar',
    nome: 'Campanhas: visualizar',
    descricao: 'Permite visualizar a seção de campanhas e recompensas na página inicial.'
  },
  {
    chave: 'campanhas_ver_usuarios',
    nome: 'Campanhas: ver por usuário',
    descricao: 'Permite acompanhar no dashboard quais usuários bateram ou não as campanhas.'
  },
  {
    chave: 'relatorios_visualizar',
    nome: 'Relatórios: visualizar',
    descricao: 'Permite acessar a página de relatórios comerciais.'
  },
  {
    chave: 'crud_usuarios',
    nome: 'Cadastro de usuários',
    descricao: 'Permite acessar o módulo de usuários. As ações dependem das subpermissões.'
  },
  {
    chave: 'usuarios_listar',
    nome: 'Usuários: listar',
    descricao: 'Permite visualizar usuários cadastrados.'
  },
  {
    chave: 'usuarios_criar',
    nome: 'Usuários: criar',
    descricao: 'Permite criar novos usuários.'
  },
  {
    chave: 'usuarios_editar',
    nome: 'Usuários: editar',
    descricao: 'Permite editar dados de usuários.'
  },
  {
    chave: 'usuarios_excluir',
    nome: 'Usuários: excluir',
    descricao: 'Permite excluir usuários comuns.'
  },
  {
    chave: 'gerenciar_permissoes',
    nome: 'Gerenciar permissões',
    descricao: 'Permite atribuir e remover permissões dos usuários.'
  },
  {
    chave: 'crud_operadoras',
    nome: 'Cadastro de operadoras',
    descricao: 'Permite criar, editar, listar e desativar operadoras.'
  },
  {
    chave: 'crud_links',
    nome: 'Cadastro de links',
    descricao: 'Permite criar, editar, listar e desativar links externos.'
  },
  {
    chave: 'crud_tipos_venda',
    nome: 'Cadastro de tipos de venda',
    descricao: 'Permite criar, editar, listar e desativar tipos de venda.'
  },
  {
    chave: 'crud_servicos',
    nome: 'Cadastro de serviços',
    descricao: 'Permite criar, editar, listar e desativar serviços.'
  },
  {
    chave: 'historico_visualizar',
    nome: 'Histórico: visualizar',
    descricao: 'Permite visualizar a página de histórico do sistema.'
  },
  {
    chave: 'clientes_ver_proprios',
    nome: 'Clientes: ver próprios',
    descricao: 'Permite visualizar clientes cadastrados pelo próprio usuário.'
  },
  {
    chave: 'clientes_ver_todos',
    nome: 'Clientes: ver todos',
    descricao: 'Permite visualizar todos os clientes cadastrados.'
  },
  {
    chave: 'clientes_criar',
    nome: 'Clientes: criar',
    descricao: 'Permite cadastrar novos clientes.'
  },
  {
    chave: 'clientes_editar',
    nome: 'Clientes: editar',
    descricao: 'Permite editar clientes acessíveis pelo usuário.'
  },
  {
    chave: 'clientes_atribuir_vendedora',
    nome: 'Clientes: atribuir vendedora',
    descricao: 'Permite definir qual usuario sera o dono do cliente para acesso e registro de vendas.'
  },
  {
    chave: 'clientes_excluir',
    nome: 'Clientes: excluir',
    descricao: 'Permite excluir clientes acessíveis pelo usuário.'
  },
  {
    chave: 'clientes_secretos_ver',
    nome: 'Clientes próprios: visualizar',
    descricao: 'Permite acessar e visualizar os clientes próprios cadastrados pelo proprio usuario.'
  },
  {
    chave: 'clientes_secretos_ver_todos',
    nome: 'Clientes próprios: visualizar todos',
    descricao: 'Permite acessar e visualizar clientes próprios cadastrados por outros usuarios.'
  },
  {
    chave: 'clientes_secretos_criar',
    nome: 'Clientes próprios: criar',
    descricao: 'Permite cadastrar novos clientes próprios.'
  },
  {
    chave: 'clientes_secretos_editar',
    nome: 'Clientes próprios: editar',
    descricao: 'Permite editar clientes próprios cadastrados pelo proprio usuario.'
  },
  {
    chave: 'clientes_secretos_excluir',
    nome: 'Clientes próprios: excluir',
    descricao: 'Permite excluir clientes próprios cadastrados pelo proprio usuario.'
  },
  {
    chave: 'clientes_antigos_buscar',
    nome: 'Clientes antigos: buscar',
    descricao: 'Permite acessar a busca de clientes antigos e consultar vendas antigas por CNPJ, CPF ou razao social.'
  },
  {
    chave: 'clientes_antigos_ver_historico',
    nome: 'Clientes antigos: ver historico',
    descricao: 'Permite visualizar o historico de buscas de clientes antigos de todos os usuarios.'
  },
  {
    chave: 'clientes_antigos_editar',
    nome: 'Clientes antigos: editar',
    descricao: 'Permite editar vendas antigas encontradas na tela de busca.'
  },
  {
    chave: 'clientes_antigos_gerenciar'
    nome: 'Clientes antigos: gerenciar base',
    descricao: 'Permite fazer upload das planilhas de vendas antigas na aba de configuracoes.'
  },
  {
    chave: 'notificacoes_visualizar',
    nome: 'Notificações: visualizar',
    descricao: 'Permite visualizar as próprias notificações do sistema.'
  },
  {
    chave: 'notificacoes_receber_todas',
    nome: 'Notificações: receber todas',
    descricao: 'Permite receber todas as notificações geradas pelo sistema.'
  },
  {
    chave: 'notificacoes_receber_email',
    nome: 'Notificacoes: receber por email',
    descricao: 'Permite receber por email as notificacoes destinadas ao usuario.'
  },
  {
    chave: 'vendas_fechamento_mensal',
    nome: 'Vendas: fechamento mensal',
    descricao: 'Permite acessar a página de fechamento mensal de vendas e gerenciar planos com taxa de comissão.'
  },
  {
    chave: 'vendas_cruzar',
    nome: 'Vendas: cruzar vendas',
    descricao: 'Permite acessar a tela de cruzamento de vendas e gerar a planilha final.'
  },
  {
    chave: 'gerenciar_leads',
    nome: 'Gerenciar mailing',
    descricao: 'Permite importar planilhas, filtrar e distribuir mailing entre vendedores.'
  },
  {
    chave: 'futuros_clientes_ver',
    nome: 'Futuros clientes: visualizar',
    descricao: 'Permite acessar a página de futuros clientes e ver mailing marcados como futuro cliente.'
  },
  {
    chave: 'futuros_clientes_registrar',
    nome: 'Futuros clientes: registrar',
    descricao: 'Permite marcar um lead recebido como futuro cliente com notas e data de retorno.'
  },
  {
    chave: 'futuros_clientes_buscar_telefone_google',
    nome: 'Futuros clientes: buscar telefone no Google',
    descricao: 'Permite buscar no Google o telefone de leads cuja primeira chamada não foi atendida.'
  },
  {
    chave: 'chat_usar',
    nome: 'Chat: usar',
    descricao: 'Permite acessar o chat interno e enviar mensagens a outros usuÃ¡rios.'
  },
  {
    chave: 'chat_visualizar_todas',
    nome: 'Chat: visualizar todas',
    descricao: 'Permite acessar a aba de chat e visualizar todas as conversas internas do sistema.'
  }
];

exports.seed = async function (knex) {
  for (const permissao of PERMISSOES) {
    const existente = await knex('permissoes')
      .where('chave', permissao.chave)
      .first();

    if (existente) {
      await knex('permissoes')
        .where('id', existente.id)
        .update({
          nome: permissao.nome,
          descricao: permissao.descricao,
          ativo: true
        });
    } else {
      await knex('permissoes').insert({
        ...permissao,
        ativo: true
      });
    }
  }
};
