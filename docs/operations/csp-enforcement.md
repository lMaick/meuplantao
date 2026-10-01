# CSP efetiva — promoção gradual (MAI-145)

Base: `docs/operations/csp-report-only.md` (MAI-133). Este documento registra a
evidência, o rollout e o rollback da promoção para `Content-Security-Policy`
efetiva.

## 1. Evidência por diretiva (auditoria do `main` + código atual)

Nenhuma origem nova em relação à MAI-133. Verificação por fluxo real:

| Fluxo | O que o browser faz | Diretivas que cobrem | Origem extra? |
|---|---|---|---|
| Auth senha (`signInWithPassword`/`signUp`/`getUser`) | `fetch` à origem Supabase (`NEXT_PUBLIC_SUPABASE_URL`) | `connect-src` (https + wss) | Não — já condicional por config |
| Auth OAuth Google/GitHub (`signInWithOAuth`) | Navegação top-level via Supabase → provedor → `/auth/callback` | Fora de `connect-src`/`form-action` (navegação top-level não é fetch nem submit) | Não |
| Dashboard/plantões/pagamentos (DAL em `src/lib/*/`) | `fetch` Supabase REST/RPC + Realtime `wss:` | `connect-src` (https + wss) | Não |
| Sentry (`@sentry/nextjs`) | SDK empacotado; `fetch` à ingestão derivada do DSN | `connect-src` condicional ao DSN | Não |
| Checkout Mercado Pago (`subscription-card.tsx`) | `fetch` same-origin `/api/mercadopago/*` + `window.location.href = init_point` (top-level) | `connect-src 'self'` + navegação top-level (sem `form-action`/`frame-src` de terceiros) | Não |
| Retorno Mercado Pago | Navegação top-level de volta ao same-origin | — (navegação top-level) | Não |
| Fontes (Geist via `next/font/google`) | Self-hosted no build (`/_next/static/media`); zero request runtime a Google Fonts | `font-src 'self' data:` | Não |
| Imagens (`next/image`, sem `remotePatterns`) | Same-origin + inline | `img-src 'self' data: blob:` | Não |
| Tema anti-FOUC (`layout.tsx`) + runtime Next.js | Script inline | `script-src 'self' 'unsafe-inline'` | `unsafe-eval` só fora de produção (HMR) |
| Estilos Next.js/Tailwind inline | Style inline | `style-src 'self' 'unsafe-inline'` | Não |

Conclusão: a política Report-Only observada já cobre todos os fluxos críticos;
a promoção reutiliza o MESMO valor (`buildCspEnforcingValue() ===
buildCspReportOnlyValue()`), acrescido apenas de
`report-uri /api/csp-report`.

## 2. Coleta de violações — `POST /api/csp-report`

- **Formatos aceitos:** `application/csp-report`, `application/reports+json`,
  `application/json` (inclui formato legado `{"csp-report": {...}}` e Reporting
  API). Outros → `415`.
- **Limites:** corpo até 8 KB (`413` acima); `400` em JSON inválido ou sem
  diretiva violada; métodos ≠ POST → `405` com `Allow: POST`.
- **Anti-abuso:** rate limit in-memory por IP (10 req/min; `429` + `Retry-After`
  no excedente). Sem writes em banco a partir deste endpoint público (evita
  vetor de abuso contra Supabase). Em serverless o limite é best-effort por
  instância — suficiente para telemetria.
- **Privacidade (nunca logar PII):** registrados SOMENTE `violated-directive`,
  `effective-directive`, origem do `blocked-uri` (`https://host`, `self:`,
  `data:`, `blob:`), pathname de `document-uri`/`source-file` e linha/coluna.
  `original-policy` NUNCA é coletado (auditoria MAI-145: pode carregar nonces
  ou URLs com parâmetros sensíveis). Query strings, fragmentos, cookies,
  `Authorization` e padrões `token|secret|password|api_key|session` são
  removidos ou mascarados como `[REDACTED]`. IP e User-Agent não são logados.
- **Limite em bytes reais:** corpo até 8 KB medidos em UTF-8
  (`Buffer.byteLength`), não contagem de caracteres.
- **Log:** `console.warn` estruturado `{event:"csp_violation", ...}` (coletável
  pelo APM/observabilidade existente).
- **Middleware:** `/api/csp-report` está no allowlist público de
  `src/lib/auth/session.ts` (mesmo tratamento dos webhooks Mercado Pago):
  violações nas páginas públicas (`/`, `/login`) partem de browsers sem
  sessão e não podem ser redirecionadas para `/login`. Sem sessão, rotas
  privadas continuam exigindo autenticação (cobertura em
  `tests/middleware-webhook-allowlist.test.mjs`).

## 3. Rollout gradual

> Os headers são resolvidos no **build** (Next grava em `routes-manifest.json`):
> cada fase abaixo = definir (ou não) `CSP_ENFORCE=true` no ambiente e fazer
> **redeploy**. Verificado em runtime: build com a flag emite ambos os headers
> mesmo rodando sem ela; build sem a flag emite só Report-Only.

1. **Fase 0 (padrão, este PR):** deploy sem `CSP_ENFORCE` → somente Report-Only
   + coleta em `/api/csp-report`. Janela de observação: 7+ dias sem violações
   legítimas nos logs.
2. **Fase 1 (preview):** `CSP_ENFORCE=true` no ambiente preview (+ redeploy);
   percorrer login (senha + OAuth), dashboard, CRUD de plantões, checkout MP
   (até o redirect) e retorno; confirmar zero `csp_violation` legítimo.
3. **Fase 2 (produção):** `CSP_ENFORCE=true` em produção (+ redeploy);
   monitorar `csp_violation` e Web Vitals/Sentry por 48–72h.
4. **Fase 3 (consolidação):** após estabilidade, manter ambos os headers
   (Report-Only como telemetria contínua) ou remover o Report-Only em
   follow-up dedicado.

## 4. Monitoramento

- Consultar logs por `event:"csp_violation"`; agrupar por
  `violatedDirective + blockedHost + documentPath`.
- Com Report-Only e efetiva idênticas, a mesma violação pode chegar DUPLICADA
  (um report por header) — deduplicar pela tupla acima + janela de tempo antes
  de contar; o rate limit (10 req/min/IP) absorve rajadas.
- Alerta em spike (> N violações/hora ou qualquer `script-src` com host
  externo novo) → investigar antes de adicionar origem (nunca wildcard `*`).
- Origens legítimas novas entram em `src/lib/security/csp.ts` com
  justificativa + teste em `tests/csp-*.test.mjs`.

## 5. Rollback (sem code change)

1. Remover `CSP_ENFORCE` (ou definir `CSP_ENFORCE=false`) no ambiente alvo.
2. **Redeploy** — o build sem a flag volta a emitir só Report-Only
   (reiniciar sem rebuild NÃO reverte, pois os headers são de build-time).
3. Alternativa nuclear: `git revert` do commit MAI-145 (restaura Report-Only
   puro da MAI-133).

Verificação: header `Content-Security-Policy` ausente + Report-Only presente;
`csp_violation` continua coletando sem bloquear.
