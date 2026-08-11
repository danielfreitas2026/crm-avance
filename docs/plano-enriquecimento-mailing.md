# Plano: Camada de Enriquecimento de Mailing

> Objetivo: elevar a assertividade do mailing enviado às consultoras, passando cada
> linha por uma camada de engenharia que coleta dados de contato em fontes externas
> (Google Places, Apify) e filtra o resultado com **fuzzy matching** real.

## 1. Visão geral da arquitetura

O pipeline é uma **máquina de estados** por linha de lead. Cada `lead_linha` caminha
por estágios; cada estágio é um job em background, re-executável sem duplicar dados
nem re-cobrar API.

```
[upload planilha]  ->  linha: status="bruto"
       |
       v
[Estágio A: Google Places]  ->  fuzzy #1  ->  status="enriquecido_maps" | "descartado"
       |
       v
[Estágio B: Apify]          ->  fuzzy #2  ->  status="enriquecido_web"  | "sem_web"
       |
       v
[Tela do consultor]  <- lê contatos consolidados + score + fonte
```

Princípio central: **cada dado enriquecido guarda `valor`, `fonte`, `confianca` (0-1)**.
Nunca sobrescreve o dado original — adiciona ao lado.

## 2. Modelo de dados

Nova tabela dedicada (histórico, re-processamento, auditoria):

```
lead_enriquecimento
├── id
├── lead_linha_id      (FK -> lead_linhas)
├── estagio            enum: pendente | maps | web | concluido | descartado
├── score_maps         decimal(4,3)   -- resultado do fuzzy #1
├── score_web          decimal(4,3)   -- resultado do fuzzy #2
├── processado_em
├── erro
└── contatos_json      -- array: [{tipo, valor, fonte, confianca}]
```

Exemplo de `contatos_json`:
```json
[
  {"tipo":"telefone","valor":"11999998888","fonte":"google_places","confianca":0.92},
  {"tipo":"site","valor":"empresa.com.br","fonte":"apify","confianca":0.81},
  {"tipo":"instagram","valor":"@empresa","fonte":"apify","confianca":0.67}
]
```

Migration nova em `backend/src/database/migrations/` (padrão Knex existente).

## 3. Motor fuzzy — `backend/src/utils/fuzzy.js` (novo)

Módulo puro, sem dependência de banco, testável com `node --test`.

- `normalizar(texto)` — centraliza a lógica NFD/acento/minúscula hoje repetida em 3 lugares.
- `jaroWinkler(a, b)` -> 0-1. Ideal para nome de empresa.
- `levenshteinRatio(a, b)` -> 0-1. Ideal para telefone/email/domínio.
- `similaridadeEmpresa(dadosOriginais, candidato)` -> score composto ponderado:
  `0.5 * jaroWinkler(nome) + 0.3 * matchCidade + 0.2 * matchUF`

Substitui o `calcularScore()` (linhas 272-296 de `google-places.service.js`), que hoje
usa apenas `includes()` (substring), não fuzzy real.

**Decisão sobre lib:** implementar direto (Jaro-Winkler ~30 linhas) em vez de puxar
Fuse.js. Fuse.js é feito para *busca em lista*, não para *comparar dois registros com
pesos por campo*. Zero dependência nova, controle total dos pesos.

## 4. Orquestração em background

Sem fila (Bull/Redis) — reaproveitar o padrão de `cnpj-importacao.service.js`:
loop com intervalo controlado (`INTERVALO_CONSULTA_MS`, `LIMITE_LINHAS`).

- `lead-enriquecimento.service.js` (novo) com `processarFila()`:
  1. Pega N linhas em `estagio="pendente"`.
  2. Roda Estágio A respeitando o rodízio de chaves existente.
  3. Roda fuzzy #1 -> grava score -> avança ou descarta.
  4. `sleep()` entre chamadas para não estourar cota.
- Disparo por `POST /lead-planilhas/:id/enriquecer` que retorna na hora e processa em
  background; a tela faz *polling* de status (como o upload streaming já faz).

## 5. Extração do motor de Places

`google-places.service.js` mistura (a) rodízio/cota de chaves e (b) busca+score.

- **Manter** toda a gestão de chaves (excelente).
- **Extrair** o score para o novo `utils/fuzzy.js`.
- **Generalizar** `buscarEmpresasPorTexto` para receber dados de um `lead_linha`
  (já recebe objeto genérico com nomeFantasia/razaoSocial/municipio/uf).

## 6. Integração Apify — `backend/src/services/apify.service.js` (novo)

- Mesmo shape do google-places: `buscarWebEmpresa(dados)` -> `{site, instagram, facebook, confianca}`.
- Gestão de token Apify espelhando a de chaves Google (tabela `apify_keys` ou env).
- **Fuzzy #2** compara o achado contra o nome já confirmado no Estágio A (âncora = dado
  de maior confiança), não contra o original cru.
- Custo: Estágio B só roda em quem passou o fuzzy #1 com score alto.

## 7. Camada de exibição

`FuturosClientesPage.jsx` já renderiza leads. Adicionar:
- Card "Meios de contato" agrupando `contatos_json`, com badge de confiança
  (verde >=0.8, amarelo 0.5-0.8) e ícone de fonte (Maps / site / redes).
- Endpoint de leitura devolve `lead_enriquecimento` via `withGraphFetched`.

## 8. Ordem de implementação (fatias entregáveis)

| # | Fatia | Entrega | Risco |
|---|---|---|---|
| 1 | `utils/fuzzy.js` + testes | Motor fuzzy isolado, verde no `node --test` | Baixo |
| 2 | Plugar fuzzy no `calcularScore` do CNPJ atual | Melhora a assertividade que já existe | Baixo |
| 3 | Migration `lead_enriquecimento` + service base | Estrutura pronta | Baixo |
| 4 | Estágio A (Places no mailing) + fuzzy #1 + endpoint | Enriquecimento via Maps | Médio |
| 5 | Exibição no card do consultor | Consultor vê contatos novos | Baixo |
| 6 | `apify.service.js` + Estágio B + fuzzy #2 | Redes sociais e site | Médio-alto |

Recomendação: fazer fatias 1 e 2 primeiro — ganho de assertividade imediato, sem custo
de API nova, e validam o motor fuzzy antes do pipeline inteiro.

## 9. Riscos a decidir antes de codar

- **LGPD**: raspar perfil de redes sociais tem implicação legal. Registrar origem do dado.
- **Custo Apify/Google**: definir teto diário. Rodízio de chaves protege o Google;
  Apify precisa de teto próprio.
- **Cache/idempotência**: antes de chamar API, checar se a linha (por CNPJ/nome
  normalizado) já foi enriquecida — não re-pagar.

## 10.1. Estado atual real (levantamento do código)

O fluxo de mailing/futuros clientes já existe e boa parte da coleta também:

- Upload/divisão de mailing: `lead-planilha.service.js` (`dividirLeads`), tabelas
  `lead_planilhas`, `lead_linhas`, `lead_envios`, `lead_atribuicoes`.
- Motor Google Places completo: `google-places.service.js` (rodízio de até 5
  chaves, controle de cota, pausa por limite).
- Busca de telefone no card do futuro cliente: permissão
  `futuros_clientes_buscar_telefone_google`, botão em `FuturosClientesPage.jsx`,
  endpoint `POST /cnpj/google-places/buscar-futuros-clientes`.

Lacunas que este trabalho começou a fechar: a busca era manual, efêmera (não
gravava), usava `includes()` (substring) em vez de fuzzy real e chamava o
caminho caro (detalhes dos 5 candidatos).

## 10.2. O que já foi implementado (fatias 1-5, SEM Apify)

- `backend/src/utils/fuzzy.js` — motor puro: `normalizar`, `levenshtein`,
  `levenshteinRatio`, `jaro`, `jaroWinkler`, `similaridadeNome`,
  `confiancaEmpresa`. Testes em `backend/test/fuzzy.test.js` (11 casos).
- `google-places.service.js` — cada candidato agora carrega `confianca` (0-1),
  `confianca_pct` (0-100), `confianca_nivel` (alta/media/baixa),
  `recomenda_apify` e `apify_motivo`. `calcularScore` foi mantido intacto
  (usado por testes/limiares), a confiabilidade fuzzy entra ao lado.
- Rota de futuros clientes passou a usar `buscarTelefoneEmpresa` (1 consulta de
  Place Details em vez de 5) via novo controller
  `buscarTelefoneGoogleFuturosClientes`. Fluxo de CNPJ intocado.
- `FuturosClientesPage.jsx` + CSS — cada resultado do Google mostra um badge de
  confiabilidade colorido (verde/amarelo/vermelho) e, quando aplicável, a
  sugestão de busca extra (Apify). Nenhuma chamada Apify é feita.

### Regras de confiabilidade e recomendação de Apify

Limiares (configuráveis por env):
- `GOOGLE_PLACES_CONFIANCA_BOA` (padrão **0.72**) — abaixo disso o match é fraco.
- `GOOGLE_PLACES_CONFIANCA_ALTA` (padrão **0.85**) — nível "alta".

Níveis exibidos: **alta** ≥ 0.85 · **média** 0.72–0.85 · **baixa** < 0.72.

Quando o Apify é recomendado (apenas sinalizado, não implementado):
1. **Confiança < 0.72** — o Google pode ter achado outra empresa; uma busca
   extra ajudaria a confirmar/achar o contato certo.
2. **Confiança ≥ 0.72 mas sem telefone** — empresa identificada, porém o Google
   não expôs telefone; uma busca extra no site/redes pode encontrar o número.
3. **Confiança ≥ 0.72 com telefone** — o Google já basta, Apify desnecessário.

Objetivo desta fase: **estudar a assertividade do Google** olhando a % por
resultado e a proporção de casos que caem na regra 1 ou 2 antes de decidir se
vale integrar o Apify.

## 10.3. Enriquecimento automático na divisão (implementado)

Disparo automático quando o mailing é **dividido para sondagem** (decisão do
usuário). Sem Apify.

**Fluxo:**
```
dividirLeads() (etapa=sondagem) ──após commit, na mesma trx──> enfileirarLinhas()
      insere em lead_enriquecimento status="pendente" (idempotente por linha)
                              │
server.js setInterval (LEAD_ENRIQUECIMENTO_WORKER_MS, padrão 15s)
      └─> processarFila(): pega LOTE pendentes → buscarTelefoneEmpresa (Google)
           → fuzzy calcula confiança → grava telefone/site/%/contatos_json
           → status "concluido" | "sem_resultado" (recomenda Apify) | "erro"
                              │
FuturosClientesPage / card ← EnriquecimentoAutomatico mostra contatos + badge %
```

**Arquivos:**
- `migrations/..._create_lead_enriquecimento.js` — tabela + unique(lead_linha_id).
- `models/LeadEnriquecimento.js` + relação `enriquecimento` em `LeadLinha`.
- `services/lead-enriquecimento.service.js` — `enfileirarLinhas`, `processarFila`.
- Hook em `lead-planilha.service.js` (`dividirLeads`, só sondagem).
- Worker em `server.js` (setInterval guardado por flag).
- `formatarLinha` inclui `enriquecimento`; card renderiza o painel.

**Garantias de custo/robustez:**
- **Idempotência**: `unique(lead_linha_id)` — dividir a mesma linha de novo não
  re-enriquece nem re-cobra (verificado: 3 enfileiramentos → 1 linha).
- **Cota**: motivos de cota do Google deixam a linha `pendente` (retry depois),
  não a "queimam".
- **Teto diário**: `LEAD_ENRIQUECIMENTO_TETO_DIARIO` (padrão 5000).
- **Não bloqueia a divisão**: só enfileira; o worker processa em background.
- **Resiliente a reinício**: a fila vive no banco.

**Envs configuráveis:** `LEAD_ENRIQUECIMENTO_ATIVO` (true),
`LEAD_ENRIQUECIMENTO_LOTE` (5), `LEAD_ENRIQUECIMENTO_INTERVALO_MS` (250),
`LEAD_ENRIQUECIMENTO_TETO_DIARIO` (150), `LEAD_ENRIQUECIMENTO_TETO_MENSAL`
(3000), `LEAD_ENRIQUECIMENTO_MAX_TENTATIVAS` (3),
`LEAD_ENRIQUECIMENTO_WORKER_MS` (15000).

### Travas de custo (proteção contra cobrança)

Cada linha gasta ~2 chamadas (Text Search + Place Details) = ~2 SKUs. A
franquia grátis do Google e ~5.000 chamadas/mês POR SKU. Camadas:

1. **Interruptor geral** `LEAD_ENRIQUECIMENTO_ATIVO=false` → worker não faz
   nenhuma chamada (verificado).
2. **Teto mensal** (`TETO_MENSAL`, padrão 3000 linhas) → barra o gasto ao longo
   do mês, mantendo abaixo da franquia grátis. Verificado: com a cota atingida o
   worker recusa processar.
3. **Teto diário** (`TETO_DIARIO`, padrão 150 linhas) → distribui o consumo.
4. **Idempotência** → nunca re-cobra a mesma linha.

⚠️ IMPORTANTE: nenhuma trava do código impede o Google de cobrar por si só — a
franquia grátis não bloqueia, ela cobra o excedente. A trava que **fisicamente
impede a cobrança** é o **limite de cota no Google Cloud Console** (Places API
(New) → Quotas), que só o dono da conta pode configurar. Os tetos do código são
defesa em profundidade para o worker nunca ultrapassar o gratuito.

## 10.4. Arquitetura pronta para o Apify (encaixe futuro, NÃO implementado)

O código já deixa o "encaixe" (seam) pronto para plugar o Apify como **2ª fonte**
de contato, acionada só quando o Google não traz telefone confiável. Hoje está
**desligado e inerte** — nada é chamado.

**Peças já preparadas:**
- `services/apify.service.js` — **stub** com o CONTRATO de retorno documentado e
  o esqueleto da chamada (comentado). Só falta preencher a chamada HTTP.
- Gancho em `lead-enriquecimento.service.js` (`talvezEnriquecerComApify`) — já
  chamado no ponto certo (após o Google devolver `sem_resultado` +
  `recomenda_apify`), guardado por `LEAD_ENRIQUECIMENTO_APIFY_ATIVO` (padrão
  `false`) e por `apifyService.APIFY_DISPONIVEL` (padrão `false`).
- **Sem migration nova**: a fila reaproveita as linhas `status='sem_resultado'`
  e `recomenda_apify=1`. Ao concluir via Apify, grava `fonte='apify'`.

**Para concluir a integração no futuro (resumo — detalhes no apify.service.js):**
1. Criar conta Apify e escolher um Actor **"contact scraper"** (extrai telefone
   do site da empresa) — melhor para telefone e menos risco que rede social.
2. Definir envs: `APIFY_TOKEN`, `APIFY_ATOR_CONTATO`,
   `LEAD_ENRIQUECIMENTO_APIFY_ATIVO=true`, e trocar `APIFY_DISPONIVEL` para true.
3. Implementar `buscarContatoEmpresa` seguindo o CONTRATO; medir confiança com o
   **mesmo** `fuzzy.confiancaEmpresa` (a % fica coerente entre as fontes).
4. Reaproveitar os tetos de custo (criar um `APIFY_TETO_MENSAL` espelhando o do
   Google) — o Apify cobra por uso de Actor.

Fluxo alvo (quando ligado):
```
Google sem telefone confiável (sem_resultado + recomenda_apify)
        └─> talvezEnriquecerComApify() → apify.service.buscarContatoEmpresa()
             → fuzzy #2 mede confiança → grava telefone/site, fonte="apify"
```

## 10. APIs necessárias (mapeamento)

Ver seção de custos na conversa. Resumo:
- **Google Places API (Text Search + Place Details)** — já integrada no código.
- **Apify** — plataforma de scrapers ("Actors"), não uma API única. Escolher Actors
  específicos (site oficial, Instagram, Google Maps scraper) e pagar por uso.
- Alternativas a avaliar: CNPJ/Receita (já usado), e possíveis Actors de e-mail/telefone.
