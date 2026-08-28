const test = require('node:test');
const assert = require('node:assert/strict');

const { renderEmailVenda, _internals } = require('../src/services/venda-email-template.service');

const { parseItensChips, parsePortados, resolverOperadora } = _internals;

test('resolve operadoras com template disponivel', () => {
  assert.equal(resolverOperadora({ operadora: { nome: 'Claro Empresas' } }), 'Claro');
  assert.equal(resolverOperadora({ operadora: { nome: 'Vivo Empresas' } }), 'Vivo');
  assert.equal(resolverOperadora({ operadora: { nome: 'Outra' } }), null);
});

test('parseia chips e numeros portados para template', () => {
  assert.deepEqual(parseItensChips(JSON.stringify([
    { quantidade: 2, gb: '25', tipo_linha: 'Portabilidade', valor_unitario: '59.90' }
  ]), '10'), [
    { quantidade: 2, gb: '25', tipoLinha: 'portabilidade', valorUnitario: 59.9 }
  ]);

  assert.deepEqual(parseItensChips('2x49,90 / 1 x 39.90', '15'), [
    { quantidade: 2, gb: '15', tipoLinha: 'novo', valorUnitario: 49.9 },
    { quantidade: 1, gb: '15', tipoLinha: 'novo', valorUnitario: 39.9 }
  ]);

  assert.deepEqual(parsePortados('11999990000; 11888880000'), ['11999990000', '11888880000']);
});

test('renderiza template Claro com campos essenciais', () => {
  const resultado = renderEmailVenda({
    operadora: { nome: 'Claro' },
    vendedora: { nome: 'Ana' },
    razao_social: 'Cliente Claro LTDA',
    cnpj: '11.222.333/0001-81',
    quantidade_linhas: 2,
    valor_total: 119.8,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, gb: '25', tipo_linha: 'novo', valor_unitario: 59.9 }
    ]),
    ddd: '11',
    telefone: '+55 (11) 99999-0000',
    email_representante_legal: 'rl@test.local',
    nome_representante_legal: 'Responsavel Legal',
    numeros_portados: ''
  });

  assert.equal(resultado.operadora, 'Claro');
  assert.match(resultado.texto, /VENDA Ana - Cliente Claro LTDA/);
  assert.match(resultado.texto, /CNPJ: 11222333000181/);
  assert.match(resultado.texto, /CLARO/);
  assert.match(resultado.texto, /25GB/);
  assert.match(resultado.texto, /11999990000/);
});

test('renderiza checklist Vivo completo com administrador na confirmacao', () => {
  const resultado = renderEmailVenda({
    operadora: { nome: 'Vivo' },
    vendedora: { nome: 'Bia' },
    razao_social: 'Cliente Vivo LTDA',
    cnpj: '11222333000181',
    quantidade_linhas: 1,
    valor_total: 79.99,
    valores_unitarios_chips: [{
      quantidade: 1,
      gb: '40',
      tipo_linha: 'portabilidade',
      valor_unitario: 79.99,
      operadora_atual_nome: 'TIM',
      operadora_nome: 'Vivo'
    }],
    ddd: '31',
    numeros_portados: ['31 986550327'],
    telefone: '31999990000',
    fixo_ddd: '3133334444',
    nome_representante_legal: 'SUZANA DOMINGUES',
    cpf_representante_legal: '584.092.116-53',
    rg_representante_legal: '2399103SSPMG',
    data_nascimento_representante_legal: '1962-08-08',
    telefone_representante_legal: '31911112222',
    email_representante_legal: 'suzana@test.local',
    nome_administrador: 'MAYARA LUIZA DE SOUZA',
    cpf_administrador: '107.441.966-98',
    rg_administrador: 'MG17151692',
    data_nascimento_administrador: '1991-08-08',
    telefone_administrador: '+55 (31) 98655-0327',
    nome_fechou_venda: 'ADM'
  });

  assert.equal(resultado.operadora, 'Vivo');
  assert.match(resultado.texto, /VENDA Bia - Cliente Vivo LTDA/);
  assert.match(resultado.texto, /CPF REPRESENTANTE LEGAL : 584\.092\.116-53 \/ DN: 08\/08\/1962/);
  assert.match(resultado.texto, /RG : 2399103SSPMG/);
  assert.match(resultado.texto, /TELEFONE : 31986550327/);
  assert.match(resultado.texto, /CONFIRMAÇÃO FALAR COM : MAYARA LUIZA DE SOUZA - dn: 08\/08\/1991/);
  assert.match(resultado.texto, /rg : MG17151692/);
  assert.match(resultado.texto, /CPF : 107\.441\.966-98/);
  assert.match(resultado.texto, /LINHA NOVA : X/);
  assert.match(resultado.texto, /PORTABILIDADE : 1x79,99-31 986550327/);
  assert.match(resultado.texto, /VIVO 40GB - 1X79,99 - DDD 31/);
  assert.match(resultado.texto, /tim para vivo/);
});

test('resolve confirmacao pelo RL e usa telefone geral como fallback', () => {
  const resultado = renderEmailVenda({
    operadora: { nome: 'Vivo' },
    operadoraAtual: { nome: 'Claro' },
    nome_fechou_venda: 'RL',
    nome_representante_legal: 'Maria Legal',
    cpf_representante_legal: '111.222.333-44',
    rg_representante_legal: 'MG123',
    data_nascimento_representante_legal: '1980-02-03',
    telefone: '(11) 99999-0000',
    fixo_ddd: '1133334444'
  });

  assert.match(resultado.texto, /TELEFONE : 11999990000/);
  assert.match(resultado.texto, /CONFIRMAÇÃO FALAR COM : Maria Legal - dn: 03\/02\/1980/);
  assert.match(resultado.texto, /rg : MG123/);
  assert.match(resultado.texto, /CPF : 111\.222\.333-44/);
  assert.match(resultado.texto, /claro para vivo/);
});

test('reconhece nome legado do administrador na confirmacao', () => {
  const resultado = renderEmailVenda({
    operadora: { nome: 'Vivo' },
    nome_fechou_venda: '  josé da silva ',
    nome_administrador: 'José da Silva',
    cpf_administrador: '123.456.789-00',
    telefone_administrador: '21988887777'
  });

  assert.match(resultado.texto, /TELEFONE : 21988887777/);
  assert.match(resultado.texto, /CONFIRMAÇÃO FALAR COM : José da Silva/);
  assert.match(resultado.texto, /CPF : 123\.456\.789-00/);
});

test('preserva nome legado desconhecido sem associar documentos', () => {
  const resultado = renderEmailVenda({
    operadora: { nome: 'Vivo' },
    nome_fechou_venda: 'Contato Externo',
    nome_representante_legal: 'Outra Pessoa',
    cpf_representante_legal: '111.222.333-44',
    telefone: '',
    fixo_ddd: '(31) 3333-4444'
  });

  assert.match(resultado.texto, /TELEFONE : 3133334444/);
  assert.match(resultado.texto, /CONFIRMAÇÃO FALAR COM : Contato Externo/);
  assert.match(resultado.texto, /rg :\nCPF :\n/);
  assert.doesNotMatch(resultado.texto, /CPF : 111\.222\.333-44/);
});

test('rejeita operadora sem template de email', () => {
  assert.throws(() => renderEmailVenda({
    operadora: { nome: 'Sem Template' }
  }), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /Operadora sem template/);
    return true;
  });
});
