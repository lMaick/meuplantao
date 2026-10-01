# HSTS para o domínio de produção — MAI-146

## 1. Achado confirmado no `main` (evidência)

No `main` anterior a esta issue **não havia HSTS em nenhuma camada**:

- `next.config.ts` emitia apenas `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` (+ CSP via `src/lib/security/csp.ts`
  e `X-Robots-Tag` em rotas privadas) — nenhum `Strict-Transport-Security`.
- `grep -r "Strict-Transport-Security" src/ next.config.ts` retornava zero
  resultados (fora este documento e o helper novo).
- `README.md` registrava explicitamente: *"Não há CSP restritiva, HSTS ou
  isolamento entre origens nesta configuração"* (trecho atualizado nesta
  entrega para refletir o HSTS de produção).

## 2. O que foi implementado

Fonte única: `src/lib/security/hsts.ts`, consumida por `src/middleware.ts`.

- Header: `Strict-Transport-Security: max-age=86400`.
- Gate: o header é definido **somente** quando `host ∈ {meuplantao.pro,
  www.meuplantao.pro}` **e** protocolo `== https` (lido de
  `x-forwarded-host`/`host` + `x-forwarded-proto`/`nextUrl.protocol`).
- `next.config.ts` **propositalmente NÃO emite HSTS**: headers de build são
  estáticos e não distinguem host — emitir lá vazaria HSTS para
  localhost/preview. Cobertura em `tests/hsts-headers.test.mjs`.

## 3. Por que `max-age=86400` (24h) como inicial

- Conservador por desenho: protege sessões reais em produção, mas expira em
  24h se for preciso reverter (ver §6). `max-age` longo (ex.: 31536000/1 ano)
  prenderia browsers por meses após um erro de configuração.
- Aumentos futuros (ex.: 604800 → 2592000 → 31536000) são follow-ups
  dedicados, após janela de observação sem incidentes — mesmo modelo gradual
  da promoção CSP (MAI-145).

## 4. Decisão sobre `includeSubDomains` e `preload` (com evidência)

| Diretiva | Decisão nesta entrega | Evidência / motivo |
|---|---|---|
| `includeSubDomains` | **NÃO habilitado** | Nem todos os subdomínios foram auditados quanto a HTTPS integral (ex.: `staging.*`, previews efêmeros, `api.*` futuro). Habilitar agora arriscaria indisponibilidade em subdomínio sem HTTPS válido. Reavaliar somente após inventário + probe HTTPS de todos os subdomínios. |
| `preload` | **NÃO habilitado** | Exige `max-age >= 31536000` + `includeSubDomains` + submissão em `hstspreload.org` (lista embutida nos browsers, remoção lenta). Incompatível com a política inicial de 24h por desenho; `buildHstsValue({preload:true})` sem os pré-requisitos lança erro para impedir submissão acidental (cobertura em testes). |

## 5. Interação com Vercel, redirects, staging e domínios alternativos

- **Vercel / HTTPS:** a plataforma redireciona HTTP → HTTPS no edge por
  padrão; nenhum redirect foi implementado no middleware (evita loop e
  dupla fonte de verdade). O HSTS complementa o redirect: após a primeira
  resposta HTTPS, o browser passa a usar HTTPS direto, antes mesmo do
  redirect.
- **HSTS só sobre HTTPS (RFC 6797):** browsers ignoram HSTS recebido sobre
  HTTP; o middleware nunca envia HSTS quando `proto != https`.
- **Staging/preview/alternativos:** `*.vercel.app`, `staging.meuplantao.pro`,
  `localhost`, `127.0.0.1`, `[::1]` e domínios arbitrários **nunca** recebem
  o header (gate por allowlist fixa + testes). Previews continuam acessíveis
  sobre HTTP local sem pinning.
- **Assets estáticos:** o `matcher` do middleware exclui `_next/static`,
  `favicon.ico`, `robots.txt` e imagens por desenho (evita custo de auth no
  edge). Esses assets não carregam HSTS próprio, mas o pinning ocorre na
  primeira resposta de rota app (`/`, `/login`, `/dashboard`, …) do mesmo
  host — suficiente para a proteção. Todos continuam servidos sobre HTTPS
  pela Vercel.

## 6. Rollback e efeito do cache do navegador

HSTS é **cache do browser**, não só resposta do servidor: remover o header
não "desmarca" imediatamente quem já o recebeu — o browser mantém o pin até
`max-age` expirar. Por isso o valor inicial é curto:

1. **Rollback padrão (sem code change urgency):** reverter o commit MAI-146
   (ou remover o bloco HSTS do middleware) + redeploy. Novos visitantes não
   recebem mais o header; quem já recebeu mantém HTTPS forçado por até 24h
   após a última visita — janela aceitável e prevista.
2. **Rollback com limpeza ativa (se necessário antes de 24h):** servir
   temporariamente `Strict-Transport-Security: max-age=0` no host afetado
   (limpa o pin no browser na próxima visita HTTPS) e depois remover. Não
   implementado por padrão — procedimento manual documentado para incidente.
3. **Verificação:** `curl -sI https://meuplantao.pro/ | grep -i
   strict-transport-security` deve retornar `max-age=86400`;
   `curl -sI http://meuplantao.pro/` deve redirecionar para HTTPS sem HSTS;
   `curl -sI https://<preview>.vercel.app/` e `http://localhost:3000/` não
   devem conter o header.

## 7. Testes

`tests/hsts-headers.test.mjs` (8 casos): constantes, valor conservador sem
`includeSubDomains`/`preload`, validação de `preload`, normalização de
host/proto, allowlist apex+www, `shouldSendHsts` (produção HTTPS vs.
HTTP/localhost/preview), integração do middleware à fonte única e garantia
de que `next.config.ts` não emite HSTS estático.
