# E2E real (MAI-54 / MAI-62)

O teste real exige `RUN_REAL_E2E=1`, uma instância de teste e dois usuários em
`E2E_USER_A_EMAIL`, `E2E_USER_A_PASSWORD`, `E2E_USER_B_EMAIL` e
`E2E_USER_B_PASSWORD`. A URL e a anon key são lidas de
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` somente no
ambiente. O job obrigatório do CI inicia um Supabase local no runner Ubuntu,
aplica todas as migrations e cria usuários efêmeros pela Admin API em runtime;
nenhum GitHub Secret é necessário ou versionado.

O cenário valida Auth, RLS cruzada, plantão realizado, obrigação, pagamentos
parcial/total, overpayment, cancelamento lógico, atraso e duas requisições
concorrentes que disputam o mesmo saldo. A corrida HTTP é evidência de
integração; a garantia transacional vem da migration `FOR UPDATE`. Configuração
ausente ou serviço indisponível falha quando o gate é habilitado. O workflow
sempre para o stack local em `finally`/`trap`.
