# CSP em Report-Only — MAI-133

## O que foi observado

Fonte única: `src/lib/security/csp.ts`, consumida por `next.config.ts`
(header `Content-Security-Policy-Report-Only` em `/:path*`). Nenhuma outra
camada emite CSP.

| Diretiva | Origens | Justificativa |
|---|---|---|
| `default-src` | `'self'` | Fechamento padrão same-origin. |
| `script-src` | `'self' 'unsafe-inline'` (+ `'unsafe-eval'` só fora de produção) | Script inline anti-FOUC de tema em `src/app/layout.tsx` + runtime inline do Next.js. Sem SDK de terceiros no browser (Mercado Pago é redirect server-side). `unsafe-eval` só no `next dev` (HMR); produção nunca usa. |
| `style-src` | `'self' 'unsafe-inline'` | Estilos inline do Next.js/Tailwind; `next/font` é self-hosted. |
| `img-src` | `'self' data: blob:` | Assets same-origin + `next/image` (sem `remotePatterns`) + inline. |
| `font-src` | `'self' data:` | Geist via `next/font` (self-hosted); sem CDN externo no app. |
| `connect-src` | `'self'` + origem Supabase (`https:` + `wss:`) quando `NEXT_PUBLIC_SUPABASE_URL` válida + ingestão Sentry quando DSN configurado | Supabase REST/Auth/Storage + Realtime; Sentry ingest derivado do DSN. Mercado Pago é server-side (proxy `/api/mercadopago/*`), sem fetch direto do browser. |
| `frame-src` | `'self'` | Checkout Mercado Pago é redirect top-level (`init_point`), não iframe. |
| `form-action` | `'self' https://www.mercadopago.com` | Destino do redirect pós `/api/mercadopago/checkout`. |
| `object-src` | `'none'` | Sem plugins/embeds. |
| `base-uri` / `frame-ancestors` | `'self'` | Consistente com `X-Frame-Options: SAMEORIGIN`. |

Headers existentes preservados integralmente: `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (+ `X-Robots-Tag`).

## Como observar (período de validação)

1. Deploy com Report-Only e usar o app normalmente (login, plantões,
   checkout Mercado Pago, sync) em produção e staging.
2. Coletar violações no console do browser (`Content Security Policy` warnings)
   — Report-Only nunca bloqueia, só reporta.
3. Se alguma origem legítima nova aparecer nos reports, adicionar em
   `src/lib/security/csp.ts` com justificativa + teste em
   `tests/csp-headers.test.mjs`.

## Promoção segura para CSP efetiva (follow-up, NÃO nesta issue)

1. Evidência de 7+ dias sem violações legítimas nos consoles/logs.
2. No follow-up: trocar `CSP_REPORT_ONLY_HEADER` por `Content-Security-Policy`
   em `next.config.ts` (manter o valor construído pelo helper), ajustar o teste
   que hoje proíbe a política efetiva, e rodar o ciclo completo
   (`npm test && npm run lint && npx tsc --noEmit && npm run build`).
3. Opcional: adicionar `report-uri /api/csp-report` antes de efetivar, para
   telemetria server-side de violações.
