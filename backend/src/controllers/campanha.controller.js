/**
 * Controller HTTP de campanhas e recompensas.
 *
 * Calcula ciclos de metas, progresso por vendedora, resgates e administracao
 * das campanhas configuradas no sistema.
 */
const Campanha = require('../models/Campanha');
const Usuario = require('../models/Usuario');
const knex = require('../database/connection');
const { listarPermissoesEfetivas } = require('../utils/permissoes');

/**
 * Valida os campos obrigatorios e categorias permitidas de uma campanha.
 */
function validarCampanha(campanha) {
  if (!campanha.desc || !Number(campanha.target)) {
    return 'Alvo e descricao sao obrigatorios.';
  }

  if (Number(campanha.target) < 1) {
    return 'Alvo deve ser maior que zero.';
  }

  if (!Campanha.periodosValidos.includes(campanha.periodo)) {
    return 'Período inválido.';
  }

  if (!Campanha.categoriasValidas.includes(campanha.categoria)) {
    return 'Categoria inválida.';
  }

  if (campanha.categoria === 'outros' && !String(campanha.categoria_personalizada || '').trim()) {
    return 'Informe a categoria personalizada.';
  }

  if (campanha.publico_base && !Campanha.publicosBaseValidos.includes(campanha.publico_base)) {
    return 'Público de base inválido.';
  }

  return null;
}

/**
 * Indica se a campanha representa uma recompensa resgatavel.
 */
function campanhaEhGift(campanha) {
  return campanha.is_gift === true || campanha.is_gift === 1 || campanha.is_gift === '1';
}

/**
 * Converte uma data para o formato YYYY-MM-DD usado nas consultas.
 */
function toDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calcula o intervalo de datas do ciclo diario, semanal ou mensal.
 */
function getCiclo(periodo, baseDate = new Date()) {
  if (periodo === 'semanal') {
    const diaSemana = baseDate.getDay();
    const diasParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
    const inicio = new Date(baseDate);
    inicio.setDate(baseDate.getDate() + diasParaSegunda);
    inicio.setHours(0, 0, 0, 0);

    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 7);

    return {
      periodo: 'semanal',
      inicio,
      fim,
      inicioStr: toDateStr(inicio),
      fimStr: toDateStr(fim)
    };
  }

  if (periodo === 'mensal') {
    const inicio = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const fim = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);

    return {
      periodo: 'mensal',
      inicio,
      fim,
      inicioStr: toDateStr(inicio),
      fimStr: toDateStr(fim)
    };
  }

  const inicio = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 1);

  return {
    periodo: 'diaria',
    inicio,
    fim,
    inicioStr: toDateStr(inicio),
    fimStr: toDateStr(fim)
  };
}

/**
 * Remove acentos e padroniza texto para comparacoes internas.
 */
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Soma a quantidade de chips a partir do JSON detalhado ou do campo legado.
 */
function somarQuantidadeChips(valoresUnitariosChips, quantidadeLinhas, fallback = 0) {
  if (valoresUnitariosChips) {
    try {
      const itens = typeof valoresUnitariosChips === 'string'
        ? JSON.parse(valoresUnitariosChips)
        : valoresUnitariosChips;

      if (Array.isArray(itens)) {
        const total = itens.reduce((acc, item) => acc + Number(item?.quantidade || 0), 0);

        if (total > 0) {
          return total;
        }
      }
    } catch {
      // Usa fallback abaixo quando o JSON antigo estiver inválido.
    }
  }

  return Number(quantidadeLinhas || 0) || fallback;
}

/**
 * Normaliza o tipo de linha de chip para novo ou portabilidade.
 */
function normalizarTipoLinhaChip(valor) {
  const tipo = normalizarTexto(valor);
  return tipo.includes('porta') ? 'portabilidade' : 'novo';
}

/**
 * Soma chips de um tipo especifico quando os itens possuem classificacao.
 */
function somarQuantidadeChipsPorTipo(valoresUnitariosChips, tipoLinha) {
  if (!valoresUnitariosChips) return null;

  try {
    const itens = typeof valoresUnitariosChips === 'string'
      ? JSON.parse(valoresUnitariosChips)
      : valoresUnitariosChips;

    if (!Array.isArray(itens)) return null;

    const temTipoPorItem = itens.some(item => item?.tipo_linha || item?.tipo || item?.categoria);
    if (!temTipoPorItem) return null;

    return itens.reduce((acc, item) => (
      normalizarTipoLinhaChip(item?.tipo_linha || item?.tipo || item?.categoria) === tipoLinha
        ? acc + Number(item?.quantidade || 0)
        : acc
    ), 0);
  } catch {
    return null;
  }
}

/**
 * Calcula a quantidade da venda que conta para uma categoria de campanha.
 */
function quantidadeCategoriaVenda(venda, categoria) {
  const porTipo = categoria === 'chip_novo'
    ? somarQuantidadeChipsPorTipo(venda.valores_unitarios_chips, 'novo')
    : categoria === 'portabilidade'
      ? somarQuantidadeChipsPorTipo(venda.valores_unitarios_chips, 'portabilidade')
      : null;

  if (porTipo !== null) return porTipo;

  const tipoVenda = normalizarTexto(venda.tipo_venda);
  if (categoria === 'chip_novo' && tipoVenda === 'novo') {
    return somarQuantidadeChips(venda.valores_unitarios_chips, venda.quantidade_linhas);
  }

  if (categoria === 'portabilidade' && tipoVenda === 'portabilidade') {
    return somarQuantidadeChips(venda.valores_unitarios_chips, venda.quantidade_linhas);
  }

  return 0;
}

/**
 * Lista clientes criados por uma vendedora dentro do ciclo informado.
 */
async function listarClientesDoCiclo(usuarioId, ciclo) {
  return knex('clientes')
    .select('id', 'operadora_atual_id')
    .where('criado_por_id', usuarioId)
    .whereRaw('DATE(created_at) >= ?', [ciclo.inicioStr])
    .whereRaw('DATE(created_at) < ?', [ciclo.fimStr]);
}

/**
 * Lista vendas validas de uma vendedora dentro do ciclo informado.
 */
async function listarVendasDoCiclo(vendedoraId, ciclo) {
  const dataReferencia = "COALESCE(NULLIF(NULLIF(v.data_venda, '0000-00-00'), '1899-11-30'), NULLIF(DATE(v.criado_em), '0000-00-00'), DATE(v.created_at))";

  return knex('vendas as v')
    .leftJoin('tipos_venda as tv', 'v.tipo_venda_id', 'tv.id')
    .leftJoin('servicos as s', 'v.servico_id', 's.id')
    .select(
      'v.id',
      'v.operadora_id',
      'v.quantidade_linhas',
      'v.valores_unitarios_chips',
      'v.valor_total',
      'v.cliente_da_base',
      'v.categoria_campanha',
      'tv.nome as tipo_venda',
      's.nome as servico'
    )
    .where('v.vendedora_id', vendedoraId)
    .whereNot('v.status_funil', 'retorno')
    .whereRaw(`${dataReferencia} >= ?`, [ciclo.inicioStr])
    .whereRaw(`${dataReferencia} < ?`, [ciclo.fimStr]);
}

/**
 * Indica se a venda pertence a operadora filtrada.
 */
function operadoraIdsCampanha(campanha) {
  const ids = Array.isArray(campanha.operadora_ids) ? campanha.operadora_ids : [];
  return ids.length ? ids.map(Number) : (campanha.operadora_id ? [Number(campanha.operadora_id)] : []);
}

function vendaPertenceOperadora(venda, campanha) {
  const ids = operadoraIdsCampanha(campanha);
  return !ids.length || ids.includes(Number(venda.operadora_id));
}

/**
 * Indica se o cliente pertence a operadora filtrada.
 */
function clientePertenceOperadora(cliente, campanha) {
  const ids = operadoraIdsCampanha(campanha);
  return !ids.length || ids.includes(Number(cliente.operadora_atual_id));
}

function vendaPertencePublicoBase(venda, campanha) {
  const publico = campanha.publico_base || 'ambos';
  if (publico === 'ambos') return true;
  if (venda.cliente_da_base === null || venda.cliente_da_base === undefined) return false;
  const eBase = venda.cliente_da_base === true || Number(venda.cliente_da_base) === 1;
  return publico === 'base' ? eBase : !eBase;
}

/**
 * Classifica vendas e clientes nos totais usados pelo progresso geral.
 */
function classificarVendas(rows, clientes = []) {
  const totais = {
    registro_cliente: clientes.length,
    chip_novo: 0,
    portabilidade: 0,
    internet: 0
  };

  for (const row of rows) {
    const servico = normalizarTexto(row.servico);

    totais.portabilidade += quantidadeCategoriaVenda(row, 'portabilidade');

    if (servico === 'internet') {
      totais.internet += somarQuantidadeChips(row.valores_unitarios_chips, row.quantidade_linhas, 1);
    }

    totais.chip_novo += quantidadeCategoriaVenda(row, 'chip_novo');
  }

  return totais;
}

/**
 * Calcula o progresso de uma campanha especifica para vendas e clientes.
 */
function calcularValorCampanha(campanha, vendas, clientes) {
  const categoria = campanha.categoria || 'registro_cliente';
  if (categoria === 'registro_cliente') {
    return clientes.filter(cliente => clientePertenceOperadora(cliente, campanha)).length;
  }

  return vendas.reduce((acc, venda) => {
    const servico = normalizarTexto(venda.servico);
    if (!vendaPertenceOperadora(venda, campanha) || !vendaPertencePublicoBase(venda, campanha)) return acc;

    if (categoria === 'chip_novo') {
      return acc + quantidadeCategoriaVenda(venda, 'chip_novo');
    }

    if (categoria === 'portabilidade') {
      return acc + quantidadeCategoriaVenda(venda, 'portabilidade');
    }

    if (categoria === 'internet' && servico === 'internet') {
      return acc + somarQuantidadeChips(venda.valores_unitarios_chips, venda.quantidade_linhas, 1);
    }

    if (categoria === 'valor_monetario') return acc + Number(venda.valor_total || 0);

    if (categoria === 'outros' && normalizarTexto(venda.categoria_campanha) === normalizarTexto(campanha.categoria_personalizada)) return acc + 1;

    return acc;
  }, 0);
}

/**
 * Calcula o progresso geral e por campanha de uma vendedora no ciclo.
 */
async function calcularProgresso(usuarioId, ciclo, campanhas = []) {
  const [clientes, vendas] = await Promise.all([
    listarClientesDoCiclo(usuarioId, ciclo),
    listarVendasDoCiclo(usuarioId, ciclo)
  ]);

  const geral = classificarVendas(vendas, clientes);
  const campanhasProgresso = {};

  campanhas.forEach((campanha) => {
    campanhasProgresso[campanha.id] = calcularValorCampanha(campanha, vendas, clientes);
  });

  return {
    geral,
    campanhas: campanhasProgresso
  };
}

/** Calcula somente as campanhas visíveis, agregando participantes de metas em grupo. */
async function calcularCampanhasParaUsuario(usuarioId, ciclo, campanhas) {
  const resultado = {};
  const visiveis = [];

  for (const campanha of campanhas) {
    const participantes = Array.isArray(campanha.participante_ids) ? campanha.participante_ids.map(Number) : [];
    if (participantes.length && !participantes.includes(Number(usuarioId))) continue;
    // Sem participantes explícitos é uma campanha global, de progresso individual.
    const contribuidores = participantes.length ? participantes : [Number(usuarioId)];
    const dados = await Promise.all(contribuidores.map(async id => {
      const [clientes, vendas] = await Promise.all([listarClientesDoCiclo(id, ciclo), listarVendasDoCiclo(id, ciclo)]);
      return calcularValorCampanha(campanha, vendas, clientes);
    }));
    resultado[campanha.id] = dados.reduce((a, v) => a + v, 0);
    visiveis.push(campanha);
  }
  return { campanhas: resultado, visiveis };
}

/**
 * Agrupa campanhas ja resgatadas por usuario para consulta rapida.
 */
function agruparResgatesPorUsuario(resgates = []) {
  return resgates.reduce((acc, resgate) => {
    const usuarioId = Number(resgate.usuario_id);
    const campanhaId = Number(resgate.campanha_id);

    if (!acc[usuarioId]) {
      acc[usuarioId] = new Set();
    }

    acc[usuarioId].add(campanhaId);
    return acc;
  }, {});
}

/**
 * Controller das rotas de campanhas, progresso de metas e resgates.
 */
class CampanhaController {
  async participantes(req, res) {
    try {
      const usuarios = await knex('usuarios').where('ativo', true).select('id', 'nome', 'email').orderBy('nome', 'asc');
      res.json(usuarios);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar participantes de campanhas.' });
    }
  }

  async index(req, res) {
    try {
      const campanhas = await Campanha.findAll();
      const usuario = await Usuario.query().findById(req.usuario.id).withGraphFetched('role');
      const permissoes = await listarPermissoesEfetivas(usuario);
      const podeGerenciar = permissoes.includes('gerenciar_campanhas');
      res.json(podeGerenciar ? campanhas : campanhas.filter(campanha => (
        !campanha.participante_ids.length || campanha.participante_ids.map(Number).includes(Number(req.usuario.id))
      )));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar campanhas.' });
    }
  }

  async updateBulk(req, res) {
    try {
      const { campanhas } = req.body;
      if (!Array.isArray(campanhas)) {
        return res.status(400).json({ error: 'Formato inválido. Esperado um array de campanhas.' });
      }

      const invalida = campanhas.find(campanha => campanhaEhGift(campanha) && validarCampanha(campanha));
      if (invalida) {
        return res.status(400).json({ error: validarCampanha(invalida) });
      }

      await Campanha.updateAll(campanhas);
      const updatedCampanhas = await Campanha.findAll();

      res.json({ message: 'Campanhas atualizadas com sucesso.', campanhas: updatedCampanhas });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar campanhas.' });
    }
  }

  async store(req, res) {
    try {
      const erro = validarCampanha(req.body);
      if (erro) {
        return res.status(400).json({ error: erro });
      }

      const campanha = await Campanha.create({
        periodo: req.body.periodo,
        categoria: req.body.categoria,
        target: Number(req.body.target),
        desc: req.body.desc,
        reward: req.body.reward,
        operadora_id: req.body.operadora_id,
        operadora_ids: req.body.operadora_ids,
        publico_base: req.body.publico_base,
        categoria_personalizada: req.body.categoria_personalizada,
        participante_ids: req.body.participante_ids,
        is_gift: true
      });

      res.status(201).json(campanha);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar campanha.' });
    }
  }

  async progresso(req, res) {
    try {
      const vendedoraId = req.usuario.id;
      const cicloDiario = getCiclo('diaria');
      const cicloSemanal = getCiclo('semanal');
      const cicloMensal = getCiclo('mensal');
      const campanhas = await Campanha.findAll();
      const campanhasDiarias = campanhas.filter(campanha => (campanha.periodo || 'diaria') === 'diaria');
      const campanhasSemanais = campanhas.filter(campanha => campanha.periodo === 'semanal');
      const campanhasMensais = campanhas.filter(campanha => campanha.periodo === 'mensal');

      const [progressoDiario, progressoSemanal, progressoMensal, campanhasDiario, campanhasSemanal, campanhasMensal] = await Promise.all([
        calcularProgresso(vendedoraId, cicloDiario),
        calcularProgresso(vendedoraId, cicloSemanal),
        calcularProgresso(vendedoraId, cicloMensal),
        calcularCampanhasParaUsuario(vendedoraId, cicloDiario, campanhasDiarias),
        calcularCampanhasParaUsuario(vendedoraId, cicloSemanal, campanhasSemanais),
        calcularCampanhasParaUsuario(vendedoraId, cicloMensal, campanhasMensais),
      ]);

      const diaria = progressoDiario.geral;
      const semanal = progressoSemanal.geral;
      const mensal = progressoMensal.geral;
      const resgates = await knex('campanha_resgates')
        .where('usuario_id', vendedoraId)
        .where(builder => {
          builder
            .where(query => {
              query.where('periodo', 'diaria').where('periodo_inicio', cicloDiario.inicioStr);
            })
            .orWhere(query => {
              query.where('periodo', 'semanal').where('periodo_inicio', cicloSemanal.inicioStr);
            })
            .orWhere(query => {
              query.where('periodo', 'mensal').where('periodo_inicio', cicloMensal.inicioStr);
            });
        })
        .pluck('campanha_id');

      res.json({
        diaria_registro_cliente: diaria.registro_cliente,
        diaria_chip_novo: diaria.chip_novo,
        diaria_portabilidade: diaria.portabilidade,
        diaria_internet: diaria.internet,
        semanal_registro_cliente: semanal.registro_cliente,
        semanal_chip_novo: semanal.chip_novo,
        semanal_portabilidade: semanal.portabilidade,
        semanal_internet: semanal.internet,
        mensal_registro_cliente: mensal.registro_cliente,
        mensal_chip_novo: mensal.chip_novo,
        mensal_portabilidade: mensal.portabilidade,
        mensal_internet: mensal.internet,
        campanhas: {
          ...campanhasDiario.campanhas,
          ...campanhasSemanal.campanhas,
          ...campanhasMensal.campanhas
        },
        resgatadas: resgates.map(Number),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao calcular progresso.' });
    }
  }

  async progressoUsuarios(req, res) {
    try {
      const cicloDiario = getCiclo('diaria');
      const cicloSemanal = getCiclo('semanal');
      const cicloMensal = getCiclo('mensal');
      const campanhas = await Campanha.findAll();
      const campanhasGift = campanhas.filter(campanhaEhGift);
      const campanhasDiarias = campanhasGift.filter(campanha => (campanha.periodo || 'diaria') === 'diaria');
      const campanhasSemanais = campanhasGift.filter(campanha => campanha.periodo === 'semanal');
      const campanhasMensais = campanhasGift.filter(campanha => campanha.periodo === 'mensal');
      const usuarios = await knex('usuarios as u')
        .leftJoin('roles as r', 'u.role_id', 'r.id')
        .select(
          'u.id',
          'u.nome',
          'u.email',
          'u.foto_perfil',
          'u.ativo',
          'r.nome as role_nome'
        )
        .where('u.ativo', true)
        .orderBy('u.nome', 'asc');
      const usuarioIds = usuarios.map(usuario => usuario.id);
      const resgates = usuarioIds.length > 0
        ? await knex('campanha_resgates')
          .whereIn('usuario_id', usuarioIds)
          .where(builder => {
            builder
              .where(query => {
                query.where('periodo', 'diaria').where('periodo_inicio', cicloDiario.inicioStr);
              })
              .orWhere(query => {
                query.where('periodo', 'semanal').where('periodo_inicio', cicloSemanal.inicioStr);
              })
              .orWhere(query => {
                query.where('periodo', 'mensal').where('periodo_inicio', cicloMensal.inicioStr);
              });
          })
          .select('usuario_id', 'campanha_id')
        : [];
      const resgatesPorUsuario = agruparResgatesPorUsuario(resgates);

      const usuariosComProgresso = await Promise.all(usuarios.map(async (usuario) => {
        const [progressoDiario, progressoSemanal, progressoMensal] = await Promise.all([
          calcularCampanhasParaUsuario(usuario.id, cicloDiario, campanhasDiarias),
          calcularCampanhasParaUsuario(usuario.id, cicloSemanal, campanhasSemanais),
          calcularCampanhasParaUsuario(usuario.id, cicloMensal, campanhasMensais)
        ]);
        const progressoCampanhas = {
          ...progressoDiario.campanhas,
          ...progressoSemanal.campanhas,
          ...progressoMensal.campanhas
        };
        const campanhasUsuario = campanhasGift.filter(campanha => {
          const participantes = campanha.participante_ids || [];
          return !participantes.length || participantes.map(Number).includes(Number(usuario.id));
        }).map((campanha) => {
          const current = progressoCampanhas[campanha.id] || 0;
          const target = Number(campanha.target || 0);
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          const achieved = pct >= 100;
          const claimed = resgatesPorUsuario[Number(usuario.id)]?.has(Number(campanha.id)) || false;

          return {
            id: campanha.id,
            periodo: campanha.periodo,
            categoria: campanha.categoria,
            desc: campanha.desc,
            reward: campanha.reward,
            target,
            current,
            pct,
            achieved,
            claimed,
            operadora_id: campanha.operadora_id,
            operadora_nome: campanha.operadora_nome,
            operadora_ids: campanha.operadora_ids,
            participantes: campanha.participantes,
            em_grupo: campanha.em_grupo
          };
        });
        const atingidas = campanhasUsuario.filter(campanha => campanha.achieved).length;
        const resgatadas = campanhasUsuario.filter(campanha => campanha.claimed).length;

        return {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          foto_perfil: usuario.foto_perfil,
          role: { nome: usuario.role_nome },
          campanhas: campanhasUsuario,
          resumo: {
            total: campanhasUsuario.length,
            atingidas,
            pendentes: campanhasUsuario.length - atingidas,
            resgatadas
          }
        };
      }));

      res.json({
        ciclo: {
          diaria: {
            inicio: cicloDiario.inicioStr,
            fim: cicloDiario.fimStr
          },
          semanal: {
            inicio: cicloSemanal.inicioStr,
            fim: cicloSemanal.fimStr
          },
          mensal: {
            inicio: cicloMensal.inicioStr,
            fim: cicloMensal.fimStr
          }
        },
        usuarios: usuariosComProgresso
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao calcular progresso por usuário.' });
    }
  }

  async resgatar(req, res) {
    try {
      const usuarioId = req.usuario.id;
      const campanha = (await Campanha.findAll()).find(item => Number(item.id) === Number(req.params.id));

      if (!campanha) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      if (!campanhaEhGift(campanha)) {
        return res.status(400).json({ error: 'Esta campanha não possui recompensa para resgate.' });
      }

      if (campanha.participante_ids?.length && !campanha.participante_ids.map(Number).includes(Number(usuarioId))) {
        return res.status(403).json({ error: 'Você não participa desta campanha.' });
      }

      const ciclo = getCiclo(campanha.periodo);
      const existente = await knex('campanha_resgates')
        .where({
          usuario_id: usuarioId,
          campanha_id: campanha.id,
          periodo_inicio: ciclo.inicioStr
        })
        .first();

      if (existente) {
        return res.json({
          message: 'Campanha já resgatada neste ciclo.',
          resgatada: true,
          jaResgatada: true,
          campanhaId: campanha.id,
          reward: existente.reward_snapshot || campanha.reward,
          resgate: existente
        });
      }

      const progresso = await calcularCampanhasParaUsuario(usuarioId, ciclo, [campanha]);
      const current = progresso.campanhas[campanha.id] ?? 0;
      const target = Number(campanha.target) || 0;

      if (current < target) {
        return res.status(400).json({
          error: 'Campanha ainda não atingida.',
          current,
          target
        });
      }

      const dadosResgate = {
        usuario_id: usuarioId,
        campanha_id: campanha.id,
        periodo: ciclo.periodo,
        periodo_inicio: ciclo.inicioStr,
        periodo_fim: ciclo.fimStr,
        reward_snapshot: campanha.reward || null,
        claimed_at: knex.fn.now(),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      };

      let id;
      try {
        [id] = await knex('campanha_resgates').insert(dadosResgate);
      } catch (insertError) {
        if (insertError && insertError.code === 'ER_DUP_ENTRY') {
          const resgateExistente = await knex('campanha_resgates')
            .where({
              usuario_id: usuarioId,
              campanha_id: campanha.id,
              periodo_inicio: ciclo.inicioStr
            })
            .first();

          return res.json({
            message: 'Campanha já resgatada neste ciclo.',
            resgatada: true,
            jaResgatada: true,
            campanhaId: campanha.id,
            reward: resgateExistente?.reward_snapshot || campanha.reward,
            resgate: resgateExistente
          });
        }

        throw insertError;
      }

      const resgate = await knex('campanha_resgates').where({ id }).first();

      res.status(201).json({
        message: 'Campanha resgatada com sucesso.',
        resgatada: true,
        jaResgatada: false,
        campanhaId: campanha.id,
        reward: resgate.reward_snapshot || campanha.reward,
        resgate
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao resgatar campanha.' });
    }
  }

  async destroy(req, res) {
    try {
      const deleted = await Campanha.deleteById(req.params.id);

      if (!deleted) {
        return res.status(404).json({ error: 'Campanha não encontrada.' });
      }

      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir campanha.' });
    }
  }
}

module.exports = new CampanhaController();
