const { Model } = require('objection');

/**
 * Modelo Objection para vendas registradas.
 */
class Venda extends Model {
  static get tableName() {
    return 'vendas';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['nome', 'vendedora_id'],
      properties: {
        id: { type: 'integer' },
        nome: { type: 'string', minLength: 1, maxLength: 240 },
        telefone: { type: ['string', 'null'], maxLength: 40 },
        email: { type: ['string', 'null'], maxLength: 160 },
        email_2: { type: ['string', 'null'], maxLength: 160 },
        criado_em: { type: ['string', 'null'] },
        ultima_atividade_em: { type: ['string', 'null'] },
        telegram_notificada_em: { type: ['string', 'null'] },
        nome_representante_legal: { type: ['string', 'null'], maxLength: 240 },
        fixo_ddd: { type: ['string', 'null'], maxLength: 40 },
        nome_fechou_venda: { type: ['string', 'null'], maxLength: 240 },
        cpf_representante_legal: { type: ['string', 'null'], maxLength: 20 },
        setor_funcao: { type: ['string', 'null'], maxLength: 120 },
        produto_fechado: { type: ['string', 'null'], maxLength: 160 },
        quantidade_linhas: { type: ['integer', 'null'] },
        ddd: { type: ['string', 'null'], maxLength: 10 },
        numeros_portados: { type: ['string', 'null'] },
        numeros_ativados: { type: ['string', 'null'] },
        gb: { type: ['string', 'null'], maxLength: 40 },
        valores_unitarios_chips: { type: ['string', 'null'] },
        cliente_da_base: { type: ['boolean', 'integer', 'null'] },
        categoria_campanha: { type: ['string', 'null'], maxLength: 120 },
        possui_doc_na_casa: { type: ['boolean', 'integer', 'null'] },
        cliente_solicitou_servicos: { type: ['string', 'null'] },
        cliente_solicitou_bloqueio_qtd: { type: ['integer', 'null'] },
        cliente_solicitou_cancelamento_qtd: { type: ['integer', 'null'] },
        cliente_solicitou_numeros: { type: ['string', 'null'] },
        cliente_solicitou_resolvido: { type: ['string', 'null'], enum: ['sim', 'nao', null] },
        cliente_solicitou_resolvido_em: { type: ['string', 'null'] },
        cliente_solicitou_protocolo_atendimento: { type: ['string', 'null'], maxLength: 120 },
        cliente_solicitou_observacao: { type: ['string', 'null'] },
        valor_total: { type: ['number', 'string', 'null'] },
        ponto_referencia: { type: ['string', 'null'], maxLength: 255 },
        tipo_local_cpf: { type: ['string', 'null'], maxLength: 160 },
        razao_social: { type: ['string', 'null'], maxLength: 240 },
        cnpj: { type: ['string', 'null'], maxLength: 20 },
        data_venda: { type: ['string', 'null'] },
        data_ativacao: { type: ['string', 'null'] },
        qc_feito_por: { type: ['string', 'null'], maxLength: 120 },
        promessa_cliente: { type: ['string', 'null'] },
        promessa_cumprida: { type: ['string', 'null'], enum: ['pendente', 'sim', 'nao', null] },
        observacoes: { type: ['string', 'null'] },
        dia_vencimento: { type: ['integer', 'null'] },
        endereco: { type: ['string', 'null'], maxLength: 255 },
        numero_endereco: { type: ['string', 'null'], maxLength: 30 },
        complemento: { type: ['string', 'null'], maxLength: 160 },
        bairro: { type: ['string', 'null'], maxLength: 120 },
        municipio: { type: ['string', 'null'], maxLength: 120 },
        uf: { type: ['string', 'null'], maxLength: 2 },
        cep: { type: ['string', 'null'], maxLength: 20 },
        endereco_real_divergente: { type: ['boolean', 'integer', 'null'] },
        cep_real: { type: ['string', 'null'], maxLength: 20 },
        endereco_real: { type: ['string', 'null'], maxLength: 255 },
        numero_endereco_real: { type: ['string', 'null'], maxLength: 30 },
        complemento_real: { type: ['string', 'null'], maxLength: 160 },
        bairro_real: { type: ['string', 'null'], maxLength: 120 },
        municipio_real: { type: ['string', 'null'], maxLength: 120 },
        uf_real: { type: ['string', 'null'], maxLength: 2 },
        horario_aceite_voz: { type: ['string', 'null'], maxLength: 120 },
        horario_aceite_inicio: { type: ['string', 'null'], maxLength: 10 },
        horario_aceite_fim: { type: ['string', 'null'], maxLength: 10 },
        dia_aceite_inicio: { type: ['string', 'null'], maxLength: 20 },
        dia_aceite_fim: { type: ['string', 'null'], maxLength: 20 },
        dia_aceite_fixo: { type: ['string', 'null'], maxLength: 20 },
        horario_aceite_fixo: { type: ['string', 'null'], maxLength: 10 },
        responsavel_recebimento: { type: ['string', 'null'], maxLength: 240 },
        rg_responsavel_recebimento: { type: ['string', 'null'], maxLength: 14 },
        responsavel_recebimento_2: { type: ['string', 'null'], maxLength: 240 },
        rg_responsavel_recebimento_2: { type: ['string', 'null'], maxLength: 14 },
        responsavel_recebimento_3: { type: ['string', 'null'], maxLength: 240 },
        rg_responsavel_recebimento_3: { type: ['string', 'null'], maxLength: 14 },
        nome_administrador: { type: ['string', 'null'], maxLength: 240 },
        cpf_administrador: { type: ['string', 'null'], maxLength: 40 },
        rg_administrador: { type: ['string', 'null'], maxLength: 14 },
        data_nascimento_administrador: { type: ['string', 'null'] },
        email_representante_legal: { type: ['string', 'null'], maxLength: 160 },
        telefone_representante_legal: { type: ['string', 'null'], maxLength: 40 },
        rg_representante_legal: { type: ['string', 'null'], maxLength: 14 },
        data_nascimento_representante_legal: { type: ['string', 'null'] },
        email_administrador: { type: ['string', 'null'], maxLength: 160 },
        telefone_administrador: { type: ['string', 'null'], maxLength: 40 },
        protocolo: { type: ['string', 'null'], maxLength: 120 },
        login: { type: ['string', 'null'], maxLength: 120 },
        senha: { type: ['string', 'null'], maxLength: 255 },
        numero_cliente_contrato: { type: ['string', 'null'], maxLength: 120 },
        operadora_id: { type: ['integer', 'null'] },
        operadora_atual_id: { type: ['integer', 'null'] },
        cliente_id: { type: ['integer', 'null'] },
        origem_lead_linha_id: { type: ['integer', 'null'] },
        origem_sondador_id: { type: ['integer', 'null'] },
        origem_importacao: { type: ['string', 'null'], maxLength: 80 },
        chave_importacao: { type: ['string', 'null'], maxLength: 80 },
        arquivo_importacao: { type: ['string', 'null'], maxLength: 255 },
        linha_importacao: { type: ['integer', 'null'] },
        cliente_excluido_permanentemente_em: { type: ['string', 'object', 'null'] },
        cliente_excluido_permanentemente_nome: { type: ['string', 'null'], maxLength: 240 },
        cliente_excluido_permanentemente_cnpj: { type: ['string', 'null'], maxLength: 20 },
        tipo_produto_id: { type: ['integer', 'null'] },
        tipo_venda_id: { type: ['integer', 'null'] },
        servico_id: { type: ['integer', 'null'] },

        etapa_0800_concluida: { type: 'boolean' },
        etapa_0800_concluida_em: { type: ['string', 'null'] },
        etapa_0800_concluida_por_id: { type: ['integer', 'null'] },
        etapa_0800_resultado: { type: ['string', 'null'], maxLength: 20 },
        etapa_abr_concluida: { type: 'boolean' },
        etapa_abr_concluida_em: { type: ['string', 'null'] },
        etapa_abr_concluida_por_id: { type: ['integer', 'null'] },
        etapa_vivo_concluida: { type: 'boolean' },
        etapa_vivo_concluida_em: { type: ['string', 'null'] },
        etapa_vivo_concluida_por_id: { type: ['integer', 'null'] },

        status_funil: { type: ['string', 'null'], maxLength: 40 },
        prioridade_funil: { type: 'string', maxLength: 20 },
        status_anterior_retorno: { type: ['string', 'null'], maxLength: 40 },
        motivo_retorno: { type: ['string', 'null'], maxLength: 255 },
        nota_correcao_retorno: { type: ['string', 'null'] },
        retornou_em: { type: ['string', 'null'] },
        corrigido_em: { type: ['string', 'null'] },
        criado_por_id: { type: ['integer', 'null'] },
        enviada_pos_venda_em: { type: ['string', 'null'] },
        enviada_pos_venda_por_id: { type: ['integer', 'null'] },
        vendedora_id: { type: 'integer' },
        excluido_em: { type: ['string', 'null'] },
        excluir_definitivo_em: { type: ['string', 'null'] },
        excluido_por_id: { type: ['integer', 'null'] },
        cancelada_em: { type: ['string', 'null'] },
        motivo_cancelamento: { type: ['string', 'null'] },
        cancelada_por_id: { type: ['integer', 'null'] },
        created_at: { type: 'string' },
        updated_at: { type: 'string' }
      }
    };
  }

  static get relationMappings() {
    const Usuario = require('./Usuario');
    const Operadora = require('./Operadora');
    const Cliente = require('./Cliente');
    const TipoProduto = require('./TipoProduto');
    const TipoVenda = require('./TipoVenda');
    const Servico = require('./Servico');
    const VendaHistorico = require('./VendaHistorico');
    const VendaAprovacaoSolicitacao = require('./VendaAprovacaoSolicitacao');
    const LeadLinha = require('./LeadLinha');

    return {
      operadora: {
        relation: Model.BelongsToOneRelation,
        modelClass: Operadora,
        join: {
          from: 'vendas.operadora_id',
          to: 'operadoras.id'
        }
      },
      operadoraAtual: {
        relation: Model.BelongsToOneRelation,
        modelClass: Operadora,
        join: {
          from: 'vendas.operadora_atual_id',
          to: 'operadoras.id'
        }
      },
      cliente: {
        relation: Model.BelongsToOneRelation,
        modelClass: Cliente,
        join: {
          from: 'vendas.cliente_id',
          to: 'clientes.id'
        }
      },
      tipoProduto: {
        relation: Model.BelongsToOneRelation,
        modelClass: TipoProduto,
        join: {
          from: 'vendas.tipo_produto_id',
          to: 'tipos_produto.id'
        }
      },
      tipoVenda: {
        relation: Model.BelongsToOneRelation,
        modelClass: TipoVenda,
        join: {
          from: 'vendas.tipo_venda_id',
          to: 'tipos_venda.id'
        }
      },
      servico: {
        relation: Model.BelongsToOneRelation,
        modelClass: Servico,
        join: {
          from: 'vendas.servico_id',
          to: 'servicos.id'
        }
      },

      criador: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'vendas.criado_por_id',
          to: 'usuarios.id'
        }
      },
      vendedora: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'vendas.vendedora_id',
          to: 'usuarios.id'
        }
      },
      origemSondador: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'vendas.origem_sondador_id',
          to: 'usuarios.id'
        }
      },
      origemLead: {
        relation: Model.BelongsToOneRelation,
        modelClass: LeadLinha,
        join: {
          from: 'vendas.origem_lead_linha_id',
          to: 'lead_linhas.id'
        }
      },
      historico: {
        relation: Model.HasManyRelation,
        modelClass: VendaHistorico,
        join: {
          from: 'vendas.id',
          to: 'venda_historicos.venda_id'
        }
      },
      excluidoPor: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'vendas.excluido_por_id',
          to: 'usuarios.id'
        }
      },
      vendedoras: {
        relation: Model.ManyToManyRelation,
        modelClass: Usuario,
        join: {
          from: 'vendas.id',
          through: {
            from: 'venda_vendedoras.venda_id',
            to: 'venda_vendedoras.usuario_id',
            extra: ['ordem']
          },
          to: 'usuarios.id'
        }
      },
      aprovacaoSolicitacoes: {
        relation: Model.HasManyRelation,
        modelClass: VendaAprovacaoSolicitacao,
        join: {
          from: 'vendas.id',
          to: 'venda_aprovacao_solicitacoes.venda_id'
        }
      }
    };
  }
}

module.exports = Venda;
