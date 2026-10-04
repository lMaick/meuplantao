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
   ├── GitHub Actions → migrations (deploy-production.yml)
   └── Vercel → build / prebuild (verify-production-schema)
```

> [!IMPORTANT]
> **Barreira de Compatibilidade Fail-Closed (Sem Ordenação Automática)**
> O `prebuild` atua como barreira de compatibilidade fail-closed. GitHub Actions e Vercel são disparados de forma independente e podem executar em paralelo. Se o build da Vercel atingir o schema gate antes da aplicação de uma migration necessária, o build falhará e a versão incompatível não será publicada. Após a migration ser aplicada, um novo build/deploy poderá ser necessário. Uma garantia estrita de ordenação migration → deploy exigiria mecanismo adicional de orquestração.

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
