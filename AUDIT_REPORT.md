STATUS: BLOQUEADO

MOTIVO: A proteção futura em `register_payment` e o filtro de saldo na view estão implementados, mas o aceite não foi cumprido por completo: o dashboard ainda contabiliza pagamentos registrados com data futura, e o limite de novos recebimentos também soma esses registros antigos. Os testes da MAI-140 verificam helpers e texto SQL, sem executar a RPC no PostgreSQL; o comentário da issue também não registra a contagem de pagamentos futuros existentes solicitada no escopo.

PONTOS DE ATENÇÃO:

- [dashboard.tsx](/C:/Users/Maick/orca/workspaces/meuplantao/mai-140-fix-pagamento-data-futura/src/components/dashboard/dashboard.tsx:134): o total recebido filtra por status e período, mas não exclui datas futuras.
- [payment_future_date_guard.sql](/C:/Users/Maick/orca/workspaces/meuplantao/mai-140-fix-pagamento-data-futura/supabase/migrations/20260930000000_payment_future_date_guard.sql:17) e [mesma migration](/C:/Users/Maick/orca/workspaces/meuplantao/mai-140-fix-pagamento-data-futura/supabase/migrations/20260930000000_payment_future_date_guard.sql:84): a RPC e o trigger incluem todo pagamento `registrado` no cálculo do limite, divergindo do saldo da view para registros futuros antigos.
- [payment-future-date-mai140.test.mjs](/C:/Users/Maick/orca/workspaces/meuplantao/mai-140-fix-pagamento-data-futura/tests/payment-future-date-mai140.test.mjs:94): o teste da RPC confere padrões no SQL; não prova chamadas reais com datas futura, atual e passada.

Validação: suíte local — 678 aprovados, 0 falhas e 1 teste de integração PostgreSQL pendente/TODO; ESLint, TypeScript e build passaram. O CI do commit também passou. O build local ignorou a verificação estrita do schema remoto. Os cinco arquivos alterados são relacionados ao escopo, sem allowlist explícita de caminhos na issue; o arquivo de auditoria não rastreado foi preservado.