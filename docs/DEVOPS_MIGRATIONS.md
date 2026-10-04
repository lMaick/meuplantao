# DevOps: Processo Canônico de Migrations, Schema Gate & Smoke Test

Este documento estabelece a política operacional obrigatória para aplicação, validação e verificação de schema no banco de dados de produção (Supabase) do **MeuPlantão**.

---

## 1. Visão Geral & Filosofia Fail-Closed

O schema do banco de dados e as RPCs (`SECURITY DEFINER`) são a autoridade máxima das regras de negócio e da integridade financeira do MeuPlantão.

O sistema opera sob o princípio estrito de **fail-closed**:
> Se qualquer migration ou RPC crítica estiver ausente ou incompatível no banco de produção, o deploy **deve falhar imediatamente**. Nenhum artefato ou rota de aplicação pode ser considerado saudável se o banco estiver defasado.

### Cenário que esta arquitetura impede:
- **Problema anterior:** GitHub CI verde (testando contra Supabase local descartável) → Vercel verde (compilando frontend) → Supabase de produção sem a migration/RPC aplicada → Usuários finais recebendo erros de banco e falhas silenciosas no registro de plantões.
- **Solução implementada:** Barreira pré-build fail-closed (`prebuild`), automação de migrations no merge (`deploy-production.yml`), e smoke test mandatório das 3 RPCs críticas.

---

## 2. O Fluxo de Release & Concorrência GitHub Actions vs. Vercel

O ciclo de vida de qualquer alteração de código ou schema segue o seguinte modelo:

```
[1. GitHub Issue]
        ↓
[2. Branch Dedicada & Migration SQL]
        ↓
[3. CI em PR] (Testes unitários + E2E com Supabase real local)
        ↓
[4. Revisão Humana & Merge em main] (Apenas Maick faz o merge)
        ↓
push main
    ├── GitHub Actions `migrate-and-verify` → migrations + strict gate (RPC + RLS + contrato semântico)
    ├── Vercel production buildCommand → aguarda o JOB `migrate-and-verify` do SHA exato → `npm run build` + prova de release
    └── GitHub Actions `post-deploy-smoke` (needs do job acima) → aguarda deployment Production do SHA → prova + `/` + `/sitemap.xml`
```

> [!IMPORTANT]
> **Ordenação Serializada migration → gate → deploy (MAI-159)**
> O `prebuild` continua como barreira de compatibilidade fail-closed dentro do build, mas a ordem agora é tecnicamente garantida: o `buildCommand` versionado (`vercel.json` → `node scripts/vercel-production-build.mjs`) só compila produção depois que o job `Apply & Verify Production Schema` do workflow pinado (`Production Migrations & Release Gate`, id `362947044`) atinge `completed/success` para o `VERCEL_GIT_COMMIT_SHA` exato. O gate observa o JOB (nunca a conclusão do workflow inteiro), de modo que o smoke pós-deploy — que aguarda o próprio deployment — não causa deadlock. Falha de migration/schema impede o build e a promoção. Detalhes na seção 9.

---

## 3. As 3 RPCs Críticas Monitoradas (Pós-Stripe)

Com o descomissionamento definitivo do Stripe (PR #94 e PR #104, referente à Issue #103), a RPC legada `process_stripe_subscription_event` foi removida da esteira obrigatória. O smoke test (`scripts/smoke-test-schema.mjs`) valida compulsoriamente a presença, quantidade e ordem exata dos tipos de argumentos das 3 funções nucleares da plataforma:

| RPC | Responsabilidade no Sistema | Assinatura Obrigatória | Permissões |
| :--- | :--- | :--- | :--- |
| `save_shift_with_obligation` | Criação/atualização atômica de plantões e sincronização financeira de obrigações. | 11 argumentos (`uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text`) | `authenticated`, `service_role` |
| `register_payment` | Registro de repasses e recálculo atômico de saldos financeiros. | 3 argumentos (`uuid, numeric, date`) | `authenticated`, `service_role` |
| `process_mercadopago_subscription_payment` | Processamento idempotente de webhooks do Mercado Pago e ativação de período Pro (MAI-147: cotação obrigatória fail-closed; MAI-152: plano/preço/vigência/moeda/período derivados da cotação canônica, divergência do caller rejeitada — mesma assinatura). | 7 argumentos (`text, uuid, integer, integer, numeric, text, uuid`) | `service_role` |

Se qualquer uma dessas funções estiver ausente ou possuir assinatura incompatível, o deploy/build aborta com **exit code 1**.

---

## 4. Marcador Canônico de Contrato Semântico (`public.schema_contract`) (MAI-158)

Embora a verificação de assinaturas (quantidade e tipos de argumentos via `pg_proc`) e RLS/grants garanta que a interface pública esteja presente, migrations podem alterar o **comportamento interno** de RPCs mantendo a mesma assinatura externa (ex.: `process_mercadopago_subscription_payment` mantida com 7 argumentos ao passar a derivar regras da cotação canônica em MAI-152).

Para provar explicitamente qual semântica de schema está instalada em produção:
1. **Tabela Singleton Canônica:**
   - `public.schema_contract` com chave primária singleton `id integer primary key default 1 check (id = 1)`.
   - Coluna `contract_version` tipada e validada por regex estrito de SemVer (`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`).
   - Rastreabilidade via `description`, `applied_by`, `created_at` e `updated_at`.
2. **Segurança & Permissões Estritas:**
   - Row Level Security (RLS) habilitada.
   - `REVOKE ALL ON public.schema_contract FROM anon, authenticated, public;`
   - `GRANT SELECT ON public.schema_contract TO service_role;`
   - O valor só é alterado através de migrations versionadas executadas com privilégios de banco.
3. **Verificação no Release Gate (`scripts/schema-contract.mjs`):**
   - O gate de produção (`verify-production-schema.mjs` / `smoke-test-schema.mjs`) valida os 3 pilares em ordem:
     1. Presença e assinatura exata de argumentos das RPCs críticas;
     2. Invariantes de segurança (RLS ativa, policies canônicas e ausência de grants públicos/perigosos);
     3. Versão do contrato semântico instalado vs. `EXPECTED_SCHEMA_CONTRACT_VERSION` no código da aplicação.
   - **Comportamento estrito:** Versão ausente, antiga (`installed < expected`), formato inválido ou erro de conexão falham fechados com `exit 1` em produção (`VERCEL_ENV=production` ou `CHECK_SCHEMA_COMPATIBILITY=1`).
   - Ambientes preview e local preservam o comportamento não-bloqueante (aviso diagnóstico informativo).

---

## 5. Como Criar e Versionar Migrations

1. Toda alteração no banco de dados deve existir obrigatoriamente como um arquivo versionado no Git em:
   ```
   supabase/migrations/<YYYYMMDDHHMMSS>_<nome_descritivo>.sql
   ```
2. **Proibição Absoluta de Aplicações Manuais Não Rastreadas (Anti-Drift):**
   - É **expressamente proibido** executar comandos DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE FUNCTION`, `REVOKE`, etc.) diretamente no SQL Editor do painel web do Supabase sem um arquivo correspondente no repositório.
   - Toda alteração deve ser rastreada na tabela interna `supabase_migrations.schema_migrations`.

---

## 6. Aplicação de Migrations em Produção

### Modo Automático (Recomendado via GitHub Actions)
Ao realizar o merge de um PR na branch `main`, o workflow `.github/workflows/deploy-production.yml` é disparado automaticamente:
1. Conecta ao banco via `PRODUCTION_DATABASE_URL` (ou project link do Supabase CLI).
2. Executa `supabase db push --include-all`, aplicando todas as migrations pendentes de forma sequencial e idempotente, incluindo migrations originadas em feature branches paralelas cujo timestamp seja anterior ao topo atual.
3. Executa o smoke test das RPCs críticas.
4. Caso ocorra qualquer erro de migration, o workflow falha imediatamente e bloqueia a release.

### Modo Manual / Contingência (Via CLI)
Caso seja necessário aplicar migrations manualmente a partir de uma máquina autorizada:
```bash
# 1. Definir a URL direta do banco de produção (Session Pooler ou conexão direta)
export PRODUCTION_DATABASE_URL="postgresql://postgres:[SENHA]@[HOST]:5432/postgres"

# 2. Executar o db push oficial da Supabase CLI (com --include-all para histórico consistente)
npx supabase db push --include-all --db-url "$PRODUCTION_DATABASE_URL"

# 3. Executar o smoke test de validação
DATABASE_URL="$PRODUCTION_DATABASE_URL" npm run db:smoke
```

---

## 7. Barreira de Build na Vercel (`prebuild`)

No arquivo `package.json`, o script `prebuild` aciona `scripts/verify-production-schema.mjs`:

```json
"scripts": {
  "prebuild": "node scripts/verify-production-schema.mjs",
  "build": "next build",
  "db:smoke": "node scripts/smoke-test-schema.mjs",
  "db:verify": "node scripts/verify-production-schema.mjs"
}
```

### Comportamento por Ambiente:
- **Produção na Vercel (`VERCEL_ENV=production`) ou Modo Explícito (`CHECK_SCHEMA_COMPATIBILITY=1`):**
  - O script atua como uma barreira rígida (*strict fail-closed gate*).
  - Conecta diretamente ao banco de produção via Node.js (`node-postgres`) utilizando a variável `DATABASE_URL` (ou `PRODUCTION_DATABASE_URL`), que aponta para o Session Pooler do Supabase.
  - Consulta `pg_catalog.pg_proc` e valida rigorosamente o nome, a quantidade e a sequência exata de tipos dos argumentos de cada RPC crítica.
  - **Fallback para REST é proibido em produção**: REST não consegue atestar assinatura de tipos em nível de compilador.
  - Se faltar qualquer RPC crítica, se a assinatura for incompatível ou se a conexão falhar, o processo encerra com erro (`exit 1`), abortando a compilação na Vercel e impedindo que o deploy quebrado vá ao ar.
- **Desenvolvimento Local ou CI Quality (sem Supabase ativo):**
  - O script detecta automaticamente ambiente local (`localhost`) e libera a compilação de assets estáticos sem travar desenvolvedores offline.
- **Vercel Preview (`VERCEL_ENV=preview`):**
  - Realiza diagnóstico não-bloqueante; emite alertas informativos sem abortar o build.

---

## 8. Segurança de Segredos & Higiene de Logs

Por contrato de segurança (`AGENTS.md` e políticas internas):
1. **Nunca exponha `service_role` ou senhas de banco:**
   - `scripts/smoke-test-schema.mjs` implementa a função `redactSecrets`, que filtra e sanitiza automaticamente:
     - Tokens JWT (`[REDACTED_JWT]`)
     - Senhas em strings de conexão (`postgresql://user:[REDACTED]@host:port/db`)
     - Cabeçalhos `Bearer` e `apikey`
     - Chaves explícitas passadas no ambiente
2. **Segredos no GitHub Secrets:**
   Configure no repositório GitHub (`Settings → Secrets and variables → Actions`):
   - `PRODUCTION_DATABASE_URL`: Connection string do Supabase de produção.
   - `NEXT_PUBLIC_SUPABASE_URL`: URL pública da instância Supabase de produção.
   - `SUPABASE_SERVICE_ROLE_KEY`: Chave secreta de administração (usada exclusivamente para validação das RPCs restritas de webhooks).

---

## 9. Release Serializado de Produção (MAI-159)

### 9.1 Quem dispara o quê (sem aprovação extra além do merge)

1. **Merge em `main` (humano, Maick):** único gatilho e único ponto de aprovação humana. O ruleset `main-ruleset` exige PR + checks estritos; não há environment com revisores obrigatórios.
2. **GitHub Actions (`deploy-production.yml`, push em `main`):** job `migrate-and-verify` aplica migrations (`supabase db push --include-all`) e roda o strict gate (assinaturas RPC + RLS/grants + `schema_contract` semântico via MAI-158). Em seguida, e somente em push, o job `post-deploy-smoke` (needs do anterior) aguarda o deployment e valida a release.
3. **Vercel (integração Git):** o `buildCommand` versionado (`vercel.json` → `scripts/vercel-production-build.mjs`) executa o rendezvous (`scripts/vercel-production-gate.mjs`, spec `1.0.0`) contra a API pública do GitHub — sem `VERCEL_TOKEN` — e só então roda `npm run build` (prebuild estrito preservado, nunca `next build` direto).

### 9.2 Contrato do rendezvous (fail-closed)

- Pinos: repo `lMaick/meuplantao`, workflow id `362947044` + path `.github/workflows/deploy-production.yml`, branch `main`, evento `push`, SHA = `VERCEL_GIT_COMMIT_SHA` (40-hex exato), job `Apply & Verify Production Schema` + steps `Apply Migrations to Production Database` e `Production Schema Smoke Test (Fail-Closed)`, tentativa mais recente (`run_attempt`).
- O JOB governa em todos os estados do run: a conclusão do workflow é apenas informativa. Um run concluído como `failure` por causa do smoke pós-deploy de uma tentativa anterior, com o job de migration/schema verde para o SHA exato, permite rebuild/recuperação (incidente f85a7e6: `PROCEED run=37171319281 job=111344671671` com `run conclusion=failure`, comprovado ao vivo).
- Produção = `VERCEL_ENV=production`, ou build Vercel (`VERCEL=1`) no ref `main` (cobre System Env Vars desligado). Qualquer outro contexto (preview, development, local, CI) desvia imediatamente sem bloquear.
- Bloqueiam na hora: SHA ausente/malformado em produção, erro de transporte, HTTP 403/429/5xx, timeout, JSON malformado/desconhecido, job/steps ausentes ou renomeados, tentativa obsoleta, workflow/branch/evento divergente, conclusão terminal sem sucesso.
- Espera limitada (~10 min, polls de ~45 s, orçamento folgado dentro de 60 req/hora); esgotar o orçamento bloqueia em vez de estender. Nenhum segredo é registrado (só ids, status e conclusões).

### 9.3 Prova de release e smoke pós-deploy

- O wrapper grava a prova em `public/release-proof-<SHA>.json` ANTES de compilar e a revalida depois do build (mesmo SHA + gate `success`). `public/` é coletado pelo builder a partir da árvore de fontes APÓS o buildCommand (`getStaticFiles` em `@vercel/next`), enquanto arquivos criados dentro de `.next/` após o `next build` não são empacotados de forma confiável — evidência: em f85a7e6 o wrapper registrou prova verificada em `.next/static/` nos build logs e o arquivo respondeu 404 no deployment e no alias exato (`X-Matched-Path: /_next/static/not-found.txt`). `public/` nunca é apagado pelo `next build`; a prova é gitignored e não leva segredos nem dados de usuário.
- **Tradeoff explícito:** a prova é atestação do gate (instante `attestedAt`, pré-build), não do build concluído — ela nunca alega horário pós-build. A promoção é protegida por duas verificações independentes: exit 0 do build (com prebuild estrito) e o smoke do deployment exato. Revalidação pós-build (presença + forma + SHA + gate `success`) e limpeza em qualquer falha/exceção (só nomes exatos `release-proof-<40-hex>.json`; verificação continua autoritativa, limpeza é best-effort) garantem que nenhuma prova de build falho possa ser promovida ou reutilizada.
- A rota raiz `/release-proof-<SHA>.json` é excluída no matcher do middleware (apenas esse caminho reservado exato; demais rotas inalteradas), portanto a prova é pública sem nenhuma outra mudança de auth, rota ou CSP.
- O job `post-deploy-smoke` aguarda o deployment `Production` criado por `vercel[bot]` com `success` para o SHA exato (nunca aceita alias/página antiga; `inactive`/superseded bloqueia), confere a prova do mesmo SHA e faz GET em `/` e `/sitemap.xml` no site canônico `https://meuplantao.pro`. Nenhuma requisição destrutiva de billing.
- Cobertura offline por mocks: `tests/vercel-production-gate.test.mjs`, `tests/vercel-production-build.test.mjs`, `tests/verify-production-release.test.mjs` (casos positivos, negativos, timeouts, erros e higiene de logs).

### 9.4 Rollback, previews e checklist do dono

- **Previews preservados:** o mesmo `buildCommand` roda em preview e desvia na hora; `npm run build` local não passa pelo wrapper.
- **Rollback de app:** Instant Rollback / Promote na Vercel re-atribui deployment anterior sem rebuild. **Rollback de banco:** não há rollback destrutivo; migrations são append-only (`supabase_migrations.schema_migrations`) com forward-fix idempotente (`db push --include-all`).
- **Checklist do dono antes do cutover (dashboard, não verificável pelo repo):** confirmar que o `buildCommand` efetivo vem do `vercel.json` (sem override no dashboard), que as System Environment Variables estão expostas e que não há array legado `builds`; nenhuma credencial nova é necessária para este desenho.
