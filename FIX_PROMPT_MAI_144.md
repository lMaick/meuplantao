# Tarefa: MAI-144 — fix(mercadopago): corrigir deadline de RPC Supabase para não dar unref no timer (destravar CI)

Você é o Worker especializado (Muse Spark 1.3 Contributor com raciocínio xhigh) na branch `lMaick/mai-144-ops-mercadopago-timeout-retry`.

### BLOCO 1: Contexto e Causa Raiz do Bloqueio no CI
O pipeline de CI quebrou no gate de `quality` (`npm test`) com o erro do runner do Node 22:
`Promise resolution is still pending but the event loop has already resolved` (683 passaram, 6 cancelados).
**Causa raiz exata:**
Em `src/lib/mercadopago/http.ts`, a função `withSupabaseRpcTimeout()` aplica `.unref()` no timer do `setTimeout`:
```ts
const maybeUnref = timer as unknown as { unref?: unknown };
if (typeof maybeUnref.unref === "function") {
  maybeUnref.unref();
}
```
Isso desvincula o timer do event loop do Node. Quando uma RPC demora ou fica pendurada (ou quando um teste testa o timeout simulando uma RPC que não resolve, ex: `() => new Promise(() => {})`), o Node encerra prematuramente o event loop antes que o timer dispare e resolva/rejeite a promise da corrida.

### BLOCO 2: Invariantes Não-Negociáveis
1. O timer do `setTimeout` em `withSupabaseRpcTimeout()` NUNCA deve receber `.unref()`. Ele deve manter o event loop ativo até disparar o timeout ou ser limpo.
2. A limpeza do timer continua garantida pelo bloco `.finally(() => { if (timer !== undefined) clearTimeout(timer); })`. Assim que a RPC ou o timeout resolver, o timer é imediatamente desarmado, evitando qualquer vazamento de timer ou pendência de promise.
3. Resposta no terminal de exatamente 1 linha: `Concluído: PR #143 atualizada e relatório postado no Linear.`

### BLOCO 3: Escopo da Solução
1. Em `src/lib/mercadopago/http.ts`:
   - Remover as linhas de `.unref()` de `withSupabaseRpcTimeout()`.
   - Garantir que `timer = setTimeout(...)` fique ativo e seja limpo no `finally`.
2. Em `tests/mercadopago-timeout-retry.test.mjs`:
   - Certificar-se de que todos os testes de timeout de RPC e HTTP funcionam determinística e rapidamente (usando deadlines curtos como 50ms nos testes) e que nenhum timer fique solto.
3. Executar todos os gates locais:
   - `npm test`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`

### BLOCO 4: Critérios de Aceitação
- [ ] `withSupabaseRpcTimeout()` sem `.unref()`.
- [ ] Todos os 689+ testes passam em `npm test` sem nenhum cancelamento ou erro de "Promise resolution is still pending".
- [ ] Lint, typecheck e build 100% verdes.

### BLOCO 5: Protocolo de Entrega (Orca + Linear + Git)
1. `git add .`
2. Commit convencional:
   `fix(mercadopago): remover unref do timer de timeout de RPC para manter event loop no Node 22 (MAI-144)`
3. `git push origin lMaick/mai-144-ops-mercadopago-timeout-retry`
4. Postar comentário no Linear MAI-144 via `orca linear comment add MAI-144 --body-file <arquivo> --json`.
5. Terminar com resposta de 1 linha: `Concluído: PR #143 atualizada e relatório postado no Linear.`
