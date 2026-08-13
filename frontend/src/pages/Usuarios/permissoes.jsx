/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef } from 'react';
import * as I from '../../components/Icons';

export const PERMISSAO_POS_VENDA = {
  chave: 'pos_venda',
  nome: 'Pós-venda',
  descricao: 'Permite editar vendas enviadas ao pós-venda e movimentar vendas no funil.'
};
export const PERMISSAO_GERENCIAR_PERMISSOES = 'gerenciar_permissoes';
export const PERMISSOES_ADMIN_EXPLICITAS = new Set([
  'clientes_secretos_ver_todos',
  'clientes_antigos_ver_historico'
]);

/**
 * Garante permissao pos venda antes de continuar o fluxo.
 */
export function garantirPermissaoPosVenda(permissoes = []) {
  if (permissoes.some(permissao => permissao.chave === PERMISSAO_POS_VENDA.chave)) {
    return permissoes;
  }

  return [...permissoes, PERMISSAO_POS_VENDA];
}

export const GRUPOS_PERMISSOES = [
  {
    id: 'vendas',
    titulo: 'Vendas',
    descricao: 'Acesso ao cadastro de vendas, documentos, pós-venda, aprovações e fechamento mensal.',
    secoes: [
      {
        titulo: 'Base de acesso',
        itens: [
          {
            chave: 'vendas',
            nome: 'Abrir módulo de vendas',
            descricao: 'Permite acessar a tela de cadastro e listagem de vendas.'
          }
        ]
      },
      {
        titulo: 'Visualização',
        exclusivo: true,
        itens: [
          {
            chave: 'vendas_ver_proprias',
            nome: 'Ver próprias',
            descricao: 'Mostra vendas criadas pelo usuário ou vinculadas a ele.'
          },
          {
            chave: 'vendas_ver_todas',
            nome: 'Ver todas',
            descricao: 'Mostra todas as vendas cadastradas.'
          }
        ]
      },
      {
        titulo: 'Limitacoes',
        itens: [
          {
            chave: 'vendas_limitar_ultimos_6_meses',
            nome: 'Ultimos 6 meses',
            descricao: 'Limita a listagem, busca e exportacao de vendas as vendas dos ultimos 6 meses.'
          }
        ]
      },
      {
        titulo: 'Cadastro e manutenção',
        itens: [
          {
            chave: 'vendas_criar',
            nome: 'Criar vendas',
            descricao: 'Permite registrar novas vendas.'
          },
          {
            chave: 'vendas_auto_pos_venda',
            nome: 'Enviar automaticamente',
            descricao: 'Vendas registradas pelo usuario entram direto no pos-venda sem liberacao ADM.'
          },
          {
            chave: 'vendas_editar',
            nome: 'Editar vendas',
            descricao: 'Permite editar vendas acessíveis.'
          },
          {
            chave: 'vendas_permitir_reversoes',
            nome: 'Permitir reversões',
            descricao: 'Permite registrar alterações auditadas, com observação e histórico por campo.'
          },
          {
            chave: 'compartilhar_venda',
            nome: 'Compartilhar vendas',
            descricao: 'Permite vincular outras vendedoras a uma venda (o usuário deve permanecer na venda).'
          },
          {
            chave: 'vendas_atribuir_qualquer_vendedor',
            nome: 'Atribuir qualquer vendedor',
            descricao: 'Permite registrar vendas no nome de qualquer vendedor, podendo não se incluir na venda.'
          },
          {
            chave: 'vendas_excluir',
            nome: 'Excluir vendas',
            descricao: 'Permite enviar vendas para a lixeira e excluir definitivamente.'
          },
          {
            chave: 'vendas_cancelar',
            nome: 'Cancelar vendas',
            descricao: 'Permite marcar uma venda como cancelada no funil (mantem a venda visivel, sem excluir).'
          },
          {
            chave: 'vendas_reverter_cancelamento',
            nome: 'Reverter cancelamento',
            descricao: 'Permite reverter o cancelamento de uma venda, devolvendo-a ao estado normal.'
          },
          {
            chave: 'vendas_documentos',
            nome: 'Visualizar documentos',
            descricao: 'Libera listagem, visualizacao e downloads de documentos da venda.'
          },
          {
            chave: 'adicionar_documentos',
            nome: 'Adicionar documentos',
            descricao: 'Permite anexar novos documentos na venda.'
          }
        ]
      },
      {
        titulo: 'Vendas compartilhadas',
        itens: [
          {
            chave: 'ver_vendas_compartilhadas',
            nome: 'Ver compartilhadas',
            descricao: 'Mostra apenas vendas compartilhadas em que o usuário está como vendedor.'
          },
          {
            chave: 'editar_vendas_compartilhadas',
            nome: 'Editar compartilhadas',
            descricao: 'Permite editar vendas compartilhadas em que o usuário está como vendedor.'
          }
        ]
      },
      {
        titulo: 'Pos-venda e operacao',
        itens: [
          {
            chave: 'pos_venda',
            nome: 'Pós-venda',
            descricao: 'Permite editar vendas enviadas ao pós-venda e movimentar vendas no funil.'
          },
          {
            chave: 'vendas_marcar_problema',
            nome: 'Marcar problema',
            descricao: 'Permite abrir solicitações urgentes de problema em vendas.'
          },
          {
            chave: 'vendas_fechamento_mensal',
            nome: 'Fechamento mensal',
            descricao: 'Permite acessar o fechamento mensal de vendas e comissões.'
          },
          {
            chave: 'vendas_cruzar',
            nome: 'Cruzar vendas',
            descricao: 'Permite acessar a tela de cruzamento de vendas e gerar a planilha final.'
          }
        ]
      },
      {
        titulo: 'Aprovações ADM',
        itens: [
          {
            chave: 'vendas_aprovacoes_visualizar',
            nome: 'Visualizar aprovações',
            descricao: 'Permite acessar solicitações de liberação ADM.'
          },
          {
            chave: 'vendas_aprovacoes_decidir',
            nome: 'Aprovar solicitações',
            descricao: 'Permite aprovar ou recusar liberações de vendas especiais.'
          }
        ]
      }
    ]
  },
  {
    id: 'clientes',
    titulo: 'Clientes',
    descricao: 'Controle quem pode ver, cadastrar, alterar e remover clientes.',
    secoes: [
      {
        titulo: 'Visualização',
        exclusivo: true,
        itens: [
          {
            chave: 'clientes_ver_proprios',
            nome: 'Ver próprios',
            descricao: 'Permite visualizar clientes cadastrados pelo próprio usuário.'
          },
          {
            chave: 'clientes_ver_todos',
            nome: 'Ver todos',
            descricao: 'Permite visualizar todos os clientes cadastrados.'
          }
        ]
      },
      {
        titulo: 'Ações',
        itens: [
          {
            chave: 'clientes_criar',
            nome: 'Criar clientes',
            descricao: 'Permite cadastrar novos clientes.'
          },
          {
            chave: 'clientes_importar_planilhas',
            nome: 'Importar planilhas',
            descricao: 'Permite visualizar e executar a importacao de planilhas na tela de clientes.'
          },
          {
            chave: 'clientes_editar',
            nome: 'Editar clientes',
            descricao: 'Permite editar clientes acessíveis.'
          },
          {
            chave: 'clientes_atribuir_vendedora',
            nome: 'Atribuir vendedora',
            descricao: 'Permite transferir o dono do cliente para uma vendedora.'
          },
          {
            chave: 'clientes_excluir',
            nome: 'Excluir clientes',
            descricao: 'Permite enviar clientes para a lixeira e excluir definitivamente.'
          }
        ]
      },
      {
        titulo: 'Qualificação de Leads',
        itens: [
          {
            chave: 'clientes_secretos_ver',
            nome: 'Visualizar leads próprios',
            descricao: 'Permite acessar a lista de leads do proprio usuario.'
          },
          {
            chave: 'clientes_secretos_ver_todos',
            nome: 'Visualizar todos',
            descricao: 'Permite visualizar leads cadastrados por outros usuarios.'
          },
          {
            chave: 'clientes_secretos_criar',
            nome: 'Criar leads',
            descricao: 'Permite cadastrar novos leads.'
          },
          {
            chave: 'clientes_secretos_editar',
            nome: 'Editar leads',
            descricao: 'Permite editar leads cadastrados pelo proprio usuario.'
          },
          {
            chave: 'clientes_secretos_excluir',
            nome: 'Excluir leads',
            descricao: 'Permite excluir leads cadastrados pelo proprio usuario.'
          }
        ]
      }
    ]
  },
  {
    id: 'funil',
    titulo: 'Funil',
    descricao: 'Permissões relacionadas ao quadro operacional e às etapas do funil.',
    secoes: [
      {
        titulo: 'Acesso e configuração',
        itens: [
          {
            chave: 'funil_vendas',
            nome: 'Visualizar funil',
            descricao: 'Permite acessar a página do funil de vendas.'
          },
          {
            chave: 'crud_funil_etapas',
            nome: 'Gerenciar etapas',
            descricao: 'Permite criar, editar e desativar colunas do funil.'
          }
        ]
      }
    ]
  },
  {
    id: 'leads',
    titulo: 'Mailing',
    descricao: 'Controle a importação, organização e distribuição de planilhas de mailing.',
    secoes: [
      {
        titulo: 'Planilhas',
        itens: [
          {
            chave: 'gerenciar_leads',
            nome: 'Gerenciar mailing',
            descricao: 'Permite importar planilhas, filtrar e distribuir mailing entre vendedores.'
          }
        ]
      }
    ]
  },
  {
    id: 'configuracoes',
    titulo: 'Configurações',
    descricao: 'Cadastros que alimentam vendas, comissões e links usados na operação.',
    secoes: [
      {
        titulo: 'Cadastros comerciais',
        itens: [
          {
            chave: 'crud_operadoras',
            nome: 'Operadoras',
            descricao: 'Permite criar, editar, listar e desativar operadoras.'
          },
          {
            chave: 'crud_tipos_venda',
            nome: 'Tipos de venda',
            descricao: 'Permite criar, editar, listar e desativar tipos de venda.'
          },
          {
            chave: 'crud_servicos',
            nome: 'Serviços',
            descricao: 'Permite criar, editar, listar e desativar serviços.'
          }
        ]
      },
      {
        titulo: 'Apoio e comissões',
        itens: [
          {
            chave: 'crud_regras_comissao',
            nome: 'Regras de comissão',
            descricao: 'Permite criar, editar e remover faixas de comissão.'
          },
          {
            chave: 'crud_links',
            nome: 'Links externos',
            descricao: 'Permite criar, editar, listar e desativar links externos.'
          }
        ]
      }
    ]
  },
  {
    id: 'clientes_antigos',
    titulo: 'Clientes antigos',
    descricao: 'Ferramenta de busca de vendas antigas (fora da fidelidade) por CNPJ para revenda.',
    secoes: [
      {
        titulo: 'Busca e histórico',
        itens: [
          {
            chave: 'clientes_antigos_buscar',
            nome: 'Buscar clientes antigos',
            descricao: 'Permite acessar a busca e consultar vendas antigas por CNPJ.'
          },
          {
            chave: 'clientes_antigos_ver_historico',
            nome: 'Ver histórico de buscas',
            descricao: 'Permite visualizar o histórico de buscas de clientes antigos de todos os usuários.'
          }
        ]
      },
      {
        titulo: 'Gestão da base',
        itens: [
          {
            chave: 'clientes_antigos_editar',
            nome: 'Editar registros',
            descricao: 'Permite corrigir vendas antigas encontradas na tela de busca.'
          },
          {
            chave: 'clientes_antigos_gerenciar',
            nome: 'Gerenciar base (upload)',
            descricao: 'Permite subir planilhas de vendas antigas na aba de configurações.'
          }
        ]
      }
    ]
  },
  {
    id: 'indicadores',
    titulo: 'Indicadores e histórico',
    descricao: 'Libera painéis, relatórios, histórico de movimentações e notificações.',
    secoes: [
      {
        titulo: 'Dashboard',
        itens: [
          {
            chave: 'dashboard_resumo_vendas',
            nome: 'Resumo de vendas',
            descricao: 'Mostra os cards Vendas no dia, Valor vendido hoje, Concluídas hoje e Em pipeline.'
          },
          {
            chave: 'campanhas_visualizar',
            nome: 'Visualizar campanhas',
            descricao: 'Mostra a seção de campanhas e recompensas na tela inicial.'
          },
          {
            chave: 'campanhas_ver_usuarios',
            nome: 'Campanhas por usuário',
            descricao: 'Mostra no dashboard quem bateu ou ainda não bateu cada campanha.'
          }
        ]
      },
      {
        titulo: 'Análise e auditoria',
        itens: [
          {
            chave: 'relatorios_visualizar',
            nome: 'Relatórios',
            descricao: 'Permite acessar a página de relatórios comerciais.'
          },
          {
            chave: 'historico_visualizar',
            nome: 'Histórico',
            descricao: 'Permite visualizar a página de histórico do sistema.'
          }
        ]
      },
      {
        titulo: 'Notificações',
        itens: [
          {
            chave: 'notificacoes_visualizar',
            nome: 'Visualizar notificações',
            descricao: 'Permite abrir o sininho e ver notificações destinadas ao usuário.'
          },
          {
            chave: 'notificacoes_receber_todas',
            nome: 'Receber todas',
            descricao: 'Inclui o usuário como destinatário dos avisos gerais do sistema.'
          },
          {
            chave: 'notificacoes_receber_email',
            nome: 'Receber por email',
            descricao: 'Envia por email as notificacoes destinadas ao usuario.'
          },
          {
            chave: 'notificacoes_vendas_paradas',
            nome: 'Vendas paradas',
            descricao: 'Permite receber e visualizar alertas de vendas paradas há mais de 5 dias no funil.'
          },
          {
            chave: 'notificacoes_venda_cancelada',
            nome: 'Venda cancelada',
            descricao: 'Permite receber a notificacao no sininho e popup quando uma venda for cancelada.'
          }
        ]
      }
    ]
  },
  {
    id: 'comunicacao',
    titulo: 'Comunicação',
    descricao: 'Acesso ao chat interno entre usuários.',
    secoes: [
      {
        titulo: 'Chat',
        itens: [
          {
            chave: 'chat_usar',
            nome: 'Usar chat',
            descricao: 'Permite acessar o chat interno e conversar com outros usuários.'
          },
          {
            chave: 'chat_visualizar_todas',
            nome: 'Visualizar todas',
            descricao: 'Permite acessar a aba de chat e visualizar todas as conversas internas do sistema.'
          }
        ]
      }
    ]
  },
  {
    id: 'usuarios',
    titulo: 'Usuários e permissões',
    descricao: 'Controle o acesso ao cadastro de usuários e à gestão de permissões.',
    secoes: [
      {
        titulo: 'Base de acesso',
        itens: [
          {
            chave: 'crud_usuarios',
            nome: 'Abrir usuários',
            descricao: 'Permite acessar a área de cadastro de usuários.'
          },
          {
            chave: 'usuarios_listar',
            nome: 'Listar usuários',
            descricao: 'Permite visualizar usuários cadastrados.'
          }
        ]
      },
      {
        titulo: 'Ações de cadastro',
        itens: [
          {
            chave: 'usuarios_criar',
            nome: 'Criar usuários',
            descricao: 'Permite criar novos usuários.'
          },
          {
            chave: 'usuarios_editar',
            nome: 'Editar usuários',
            descricao: 'Permite editar dados de usuários.'
          },
          {
            chave: 'usuarios_excluir',
            nome: 'Excluir usuários',
            descricao: 'Permite excluir usuários comuns.'
          }
        ]
      },
      {
        titulo: 'Permissões',
        itens: [
          {
            chave: 'gerenciar_permissoes',
            nome: 'Gerenciar permissões',
            descricao: 'Permite atribuir ou remover permissões.'
          }
        ]
      }
    ]
  }
];

/**
 * Retorna chaves grupo a partir dos dados informados.
 */
export function getChavesGrupo(grupo) {
  return Array.from(new Set(grupo.secoes.flatMap(secao => secao.itens.map(item => item.chave))));
}

/**
 * Retorna permissoes declaradas a partir dos dados informados.
 */
export function getPermissoesDeclaradas() {
  return GRUPOS_PERMISSOES.flatMap(grupo => (
    grupo.secoes.flatMap(secao => (
      secao.itens.map(item => ({
        chave: item.chave,
        nome: item.nome,
        descricao: item.descricao
      }))
    ))
  ));
}

/**
 * Monta grupos permissoes a partir dos dados informados.
 */
export function montarGruposPermissoes(permissoes = []) {
  const permissoesPorChave = [...permissoes, ...getPermissoesDeclaradas()].reduce((acc, permissao) => {
    acc[permissao.chave] = permissao;
    return acc;
  }, {});

  const gruposSemanticos = GRUPOS_PERMISSOES.map(grupo => ({
    ...grupo,
    secoes: grupo.secoes
      .map(secao => ({
        ...secao,
        itens: secao.itens
          .filter(item => permissoesPorChave[item.chave])
          .map(item => ({
            ...item,
            nome: item.nome || permissoesPorChave[item.chave]?.nome,
            descricao: item.descricao || permissoesPorChave[item.chave]?.descricao
          }))
      }))
      .filter(secao => secao.itens.length > 0)
  })).filter(grupo => grupo.secoes.length > 0);

  const permissoesAgrupadas = new Set(gruposSemanticos.flatMap(getChavesGrupo));
  const permissoesRestantes = permissoes
    .filter(permissao => !permissoesAgrupadas.has(permissao.chave))
    .map(permissao => ({
      chave: permissao.chave,
      nome: permissao.nome,
      descricao: permissao.descricao
    }));

  return permissoesRestantes.length > 0
    ? [
        ...gruposSemanticos,
        {
          id: 'outras',
          titulo: 'Outras permissões',
          descricao: 'Permissões adicionais ainda sem grupo próprio.',
          secoes: [
            {
              titulo: 'Permissões',
              itens: permissoesRestantes
            }
          ]
        }
      ]
    : gruposSemanticos;
}

/**
 * Renderiza copiar permissoes select.
 */
export function CopiarPermissoesSelect({ value, onChange, options, placeholder = 'Selecione um usuário' }) {
  const [aberto, setAberto] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    /**
     * Trata o evento de click fora.
     */
    function handleClickFora(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setAberto(false);
      }
    }
    /**
     * Trata o evento de esc.
     */
    function handleEsc(event) {
      if (event.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', handleClickFora);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickFora);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [aberto]);

  const selecionado = options.find(opt => String(opt.value) === String(value));

  return (
    <div className={`permissions-copy__select${aberto ? ' is-open' : ''}`} ref={wrapperRef}>
      <button
        type="button"
        className="permissions-copy__trigger"
        onClick={() => setAberto(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
      >
        <span className={`permissions-copy__trigger-label${selecionado ? '' : ' is-placeholder'}`}>
          {selecionado ? selecionado.label : placeholder}
        </span>
        <I.ChevronDown size={14} />
      </button>
      {aberto && (
        <ul className="permissions-copy__menu" role="listbox">
          <li
            role="option"
            aria-selected={!value}
            className={`permissions-copy__option is-placeholder${!value ? ' is-active' : ''}`}
            onClick={() => { onChange(''); setAberto(false); }}
          >
            {placeholder}
          </li>
          {options.map(opt => (
            <li
              key={opt.value}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              className={`permissions-copy__option${String(opt.value) === String(value) ? ' is-active' : ''}`}
              onClick={() => { onChange(opt.value); setAberto(false); }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Converte permissoes usuario para o formato interno esperado.
 */
export function parsePermissoesUsuario(permissoes) {
  if (!permissoes) return [];
  if (Array.isArray(permissoes)) return permissoes;
  if (typeof permissoes === 'string') {
    try { return parsePermissoesUsuario(JSON.parse(permissoes)); } catch { return []; }
  }
  return Object.entries(permissoes).filter(([, v]) => v).map(([k]) => k);
}

/**
 * Normaliza permissoes usuario para uso interno consistente.
 */
export function normalizarPermissoesUsuario(permissoes) {
  if (!permissoes) return {};
  if (typeof permissoes === 'string') {
    try { return normalizarPermissoesUsuario(JSON.parse(permissoes)); } catch { return {}; }
  }
  if (Array.isArray(permissoes)) {
    return permissoes.reduce((acc, permissao) => {
      acc[permissao] = true;
      return acc;
    }, {});
  }
  return permissoes;
}

/**
 * Retorna permissoes selecionadas usuario a partir dos dados informados.
 */
export function getPermissoesSelecionadasUsuario(usuario, permissoesDisponiveis = []) {
  if (usuario?.role?.nome !== 'admin') {
    return parsePermissoesUsuario(usuario?.permissoes);
  }

  const permissoesUsuario = normalizarPermissoesUsuario(usuario?.permissoes);
  const todasChaves = permissoesDisponiveis.map(permissao => permissao.chave);

  return todasChaves.filter(chave => (
    PERMISSOES_ADMIN_EXPLICITAS.has(chave)
      ? permissoesUsuario[chave] === true
      : permissoesUsuario[chave] !== false
  ));
}

/**
 * Monta permissoes admin para salvar a partir dos dados informados.
 */
export function montarPermissoesAdminParaSalvar(selecionadas = [], permissoesDisponiveis = []) {
  return permissoesDisponiveis.map(permissao => permissao.chave).reduce((acc, chave) => {
    if (PERMISSOES_ADMIN_EXPLICITAS.has(chave)) {
      acc[chave] = selecionadas.includes(chave);
    } else if (!selecionadas.includes(chave)) {
      acc[chave] = false;
    }

    return acc;
  }, {});
}

/**
 * Retorna permissoes copiaveis a partir dos dados informados.
 */
export function getPermissoesCopiaveis(usuarioOrigem, permissoesDisponiveis) {
  return getPermissoesSelecionadasUsuario(usuarioOrigem, permissoesDisponiveis);
}

/**
 * Renderiza permissao card.
 */
export function PermissaoCard({ item, selecionado, exclusivo, grupoExclusivo, onToggle }) {
  return (
    <label
      className={`permissions-option ${selecionado ? 'is-active' : ''} ${exclusivo ? 'permissions-option--exclusive' : ''}`}
    >
      <input
        type="checkbox"
        checked={selecionado}
        onChange={() => onToggle(item.chave, exclusivo ? { grupoExclusivo } : undefined)}
      />
      <span>
        <strong>{item.nome}</strong>
        <small>{item.descricao || 'Permissão do sistema.'}</small>
      </span>
    </label>
  );
}

/**
 * Processa seletor bloco permissoes conforme as regras do dominio.
 */
function SeletorBlocoPermissoes({ titulo, total, selecionadas, onToggle }) {
  const checkboxRef = useRef(null);
  const todasSelecionadas = total > 0 && selecionadas === total;
  const parcial = selecionadas > 0 && selecionadas < total;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = parcial;
    }
  }, [parcial]);

  return (
    <label className={`permissions-block-toggle ${todasSelecionadas ? 'is-active' : ''}`}>
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={todasSelecionadas}
        onChange={() => onToggle(!todasSelecionadas)}
      />
      <span>
        <strong>{titulo}</strong>
        <small>{selecionadas}/{total}</small>
      </span>
    </label>
  );
}

/**
 * Processa permissao grupo conforme as regras do dominio.
 */
export function PermissaoGrupo({ grupo, selecionadas, onToggle, onToggleBloco }) {
  const chaves = getChavesGrupo(grupo);
  const selecionadasNoGrupo = chaves.filter(chave => selecionadas.includes(chave)).length;
  const ativo = selecionadasNoGrupo > 0;

  return (
    <section className={`permissions-group permissions-group--semantic ${ativo ? 'is-active' : ''}`}>
      <div className="permissions-group__header">
        <div>
          <h4>{grupo.titulo}</h4>
          <p>{grupo.descricao}</p>
        </div>

        <span className={`pill ${ativo ? 'success' : 'danger'}`}>
          <span className="pill-dot"></span>
          {selecionadasNoGrupo}/{chaves.length}
        </span>
      </div>

      <div className="permissions-sections">
        {grupo.secoes.map(secao => {
          const grupoExclusivo = secao.itens.map(item => item.chave);
          const chavesSecao = secao.itens.map(item => item.chave);
          const selecionadasNaSecao = chavesSecao.filter(chave => selecionadas.includes(chave)).length;

          return (
            <div key={secao.titulo} className="permissions-section">
              <div className="permissions-section__header">
                <div className="permissions-section__title">{secao.titulo}</div>
                {!secao.exclusivo && onToggleBloco && (
                  <SeletorBlocoPermissoes
                    titulo="Selecionar bloco"
                    total={chavesSecao.length}
                    selecionadas={selecionadasNaSecao}
                    onToggle={(selecionar) => onToggleBloco(chavesSecao, selecionar)}
                  />
                )}
              </div>
              <div className={`permissions-options ${secao.exclusivo ? 'permissions-options--exclusive' : ''}`}>
                {secao.itens.map(item => (
                  <PermissaoCard
                    key={item.chave}
                    item={item}
                    selecionado={selecionadas.includes(item.chave)}
                    exclusivo={secao.exclusivo}
                    grupoExclusivo={grupoExclusivo}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
