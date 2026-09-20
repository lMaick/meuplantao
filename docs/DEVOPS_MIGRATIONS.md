# DevOps: Processo Canônico de Migrations, Schema Gate & Smoke Test

Este documento estabelece a política operacional obrigatória para aplicação, validação e verificação de schema no banco de dados de produção (Supabase) do **MeuPlantão**.

---

## 1. Visão Geral & Filosofia Fail-Closed

O schema do banco de dados e as RPCs (`SECURITY DEFINER`) são a autoridade máxima das regras de negócio e da integridade financeira do MeuPlantão.

O sistema opera sob o princípio estrito de **fail-closed**:
> Se qualquer migration ou RPC crítica estiver ausente ou incompatível no banco de produção, o deploy **deve falhar imediatamente**. Nenhum artefato ou rota de aplicação pode ser considerado saudável se o banco estiver defasado.

### Cenário que esta arquitetura impede:
- **Problema anterior:** GitHub CI verde (testando contra Supabase local descartável) → Vercel verde (compilando frontend) → Supabase de produção sem a migration/RPC aplicada → Usuários finais recebendo erros de banco e falhas silenciosas no registro de plantões.
- **Solução implementada:** Barreira pré-build fail-closed (`prebuild`), automação de migrations no merge (`deploy-production.yml`), e smoke test mandatória das 4 RPCs críticas.

---

## 2. O Fluxo Canônico de Release

O ciclo de vida de qualquer alteração de código ou schema segue rigorosamente a seguinte esteira:

```
[1. GitHub Issue]
        ↓
[2. Branch Dedicada & Migration SQL]
        ↓
[3. CI em PR] (Testes unitários + E2E com Supabase real local)
        ↓
[4. Revisão Humana & Merge em main] (Apenas Maick faz o merge)
        ↓
[5. Aplicar / Verificar Migrations em Produção] (supabase db push)
        ↓
[6. Deploy do App] (Vercel build com prebuild schema gate)
        ↓
[7. Smoke Test de RPCs Críticas] (Fail-closed verification)
```

---

## 3. As 4 RPCs Críticas Monitoradas

O smoke test (`scripts/smoke-test-schema.mjs`) valida compulsoriamente a presença e a disponibilidade das 4 funções nucleares da plataforma:

| RPC | Responsabilidade no Sistema | Permissões |
| :--- | :--- | :--- |
| `save_shift_with_obligation` | Criação/atualização atômica de plantões e sincronização financeira de obrigações. | `authenticated`, `service_role` |
| `register_payment` | Registro de repasses e recálculo atômico de saldos financeiros. | `authenticated`, `service_role` |
| `process_mercadopago_subscription_payment` | Processamento idempotente de webhooks do Mercado Pago e ativação de período Pro. | `service_role` |
| `process_stripe_subscription_event` | Processamento legado de assinaturas Stripe (ativo enquanto Stripe existir). | `service_role` |

Se qualquer uma dessas funções retornar `404` (`PGRST202 - Could not find the function in schema cache`), o deploy/build aborta com **exit code 1**.

---

## 4. Como Criar e Versionar Migrations

1. Toda alteração no banco de dados deve existir obrigatoriamente como um arquivo versionado no Git em:
   ```
   supabase/migrations/<YYYYMMDDHHMMSS>_<nome_descritivo>.sql
   ```
2. **Proibição Absoluta de Aplicações Manuais Não Rastreadas (Anti-Drift):**
   - É **expressamente proibido** executar comandos DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE FUNCTION`, `REVOKE`, etc.) diretamente no SQL Editor do painel web do Supabase sem um arquivo correspondente no repositório.
   - Toda alteração deve ser rastreada na tabela interna `supabase_migrations.schema_migrations`.

---

## 5. Aplicação de Migrations em Produção

### Modo Automático (Recomendado via GitHub Actions)
Ao realizar o merge de um PR na branch `main`, o workflow `.github/workflows/deploy-production.yml` é disparado automaticamente:
1. Conecta ao banco via `PRODUCTION_DATABASE_URL` (ou project link do Supabase CLI).
2. Executa `supabase db push`, aplicando todas as migrations pendentes de forma sequencial e idempotente.
3. Executa o smoke test das RPCs críticas.
4. Caso ocorra qualquer erro de migration, o workflow falha imediatamente e bloqueia a release.

### Modo Manual / Contingência (Via CLI)
Caso seja necessário aplicar migrations manualmente a partir de uma máquina autorizada:
```bash
# 1. Definir a URL direta do banco de produção (Session Pooler ou conexão direta)
export PRODUCTION_DATABASE_URL="postgresql://postgres:[SENHA]@[HOST]:5432/postgres"

# 2. Executar o db push oficial da Supabase CLI
npx supabase db push --db-url "$PRODUCTION_DATABASE_URL"

# 3. Executar o smoke test de validação
DATABASE_URL="$PRODUCTION_DATABASE_URL" npm run db:smoke
```

---

## 6. Barreira de Build na Vercel (`prebuild`)

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
  - O script atua como uma barreira rígida (*strict gate*).
  - Consulta o Supabase de produção configurado em `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
  - Se faltar qualquer RPC crítica ou a conexão falhar, o processo encerra com erro (`exit 1`), abortando a compilação na Vercel e impedindo que o deploy quebrado vá ao ar.
- **Desenvolvimento Local ou CI Quality (sem Supabase ativo):**
  - O script detecta automaticamente ambiente local (`localhost`) e libera a compilação de assets estáticos sem travar desenvolvedores offline.

---

## 7. Segurança de Segredos & Higiene de Logs

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
