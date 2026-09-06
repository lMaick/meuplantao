# E2E real (MAI-54)

O teste real exige `RUN_REAL_E2E=1`, a URL/chave pública do Supabase e dois
usuários de teste em `E2E_USER_A_EMAIL`, `E2E_USER_A_PASSWORD`, `E2E_USER_B_EMAIL`
e `E2E_USER_B_PASSWORD`. Configure-os somente no ambiente e execute
`npm run test:real`.

O cenário valida Auth, RLS cruzada, plantão realizado, obrigação, pagamentos
parcial/total, overpayment, cancelamento lógico e atraso. Configuração ausente
ou serviço indisponível falha quando o gate é habilitado. Concorrência em duas
transações não é afirmada pelo transporte HTTP; `FOR UPDATE` requer harness
PostgreSQL transacional separado.
