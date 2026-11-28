# Avisos por e-mail (atraso e resumo semanal)

Um cron diário (Vercel Cron, `0 11 * * *` UTC = 08h em Bahia) chama `GET /api/cron/email-alerts`.

## O que é enviado

- **Aviso de atraso:** repasse com saldo > 0 e data prevista anterior a hoje (calendário America/Bahia). Cada obrigação gera no máximo um aviso (`email_overdue_notices`).
- **Resumo semanal:** segundas-feiras (America/Bahia), uma vez por dia (`last_digest_on`), se houver saldo a receber. Inclui total a receber, total em atraso e previstos nos próximos 7 dias, mais os novos atrasos.
- No máximo **um e-mail por usuário por execução** e **80 e-mails por execução**; o excedente fica para o dia seguinte.
- Só usuários com `enabled = true` e `has_active_entitlement` verdadeiro. Só entram obrigações de plantões `realizado` (a view `obligations_with_balance` não filtra por status do plantão).

## Variáveis de ambiente (Vercel, somente server-side)

| Variável | Função |
| --- | --- |
| `RESEND_API_KEY` | Chave da API do Resend. Sem ela o cron não envia e responde `200 {"skipped":"email_not_configured"}`. |
| `EMAIL_FROM` | Remetente. Padrão: `MeuPlantão <avisos@meuplantao.pro>`. O domínio precisa estar verificado no Resend. |
| `CRON_SECRET` | Segredo do cron. A Vercel envia `Authorization: Bearer $CRON_SECRET`. Sem a variável, ou com valor errado, a rota responde 401. |
| `SUPABASE_SERVICE_ROLE_KEY` | Já usada por outras rotas; o cron lê e grava com service role. |

Os valores não vão para o repositório. Defina em *Project Settings > Environment Variables* (Production).

## Verificar o domínio no Resend

1. No painel do Resend, *Domains > Add Domain* com `meuplantao.pro`.
2. Crie no DNS os registros que o Resend mostrar (SPF, DKIM e, se pedido, MX do subdomínio de envio).
3. Aguarde o status *Verified* antes de configurar `RESEND_API_KEY`.
4. Recomendado: adicionar registro DMARC (`_dmarc.meuplantao.pro`).
5. Gere uma API key com permissão apenas de envio.

## Descadastro

Todo e-mail leva link para `/descadastrar?token=...` e os headers `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058). O GET da página nunca altera nada; o botão faz `POST /api/email/unsubscribe`. O usuário também liga/desliga em Configurações > Avisos por e-mail.

## Operação

- Reexecução no mesmo dia não reenvia: avisos e resumo só são gravados depois do envio bem-sucedido, e o envio usa `Idempotency-Key` do Resend.
- Logs estruturados trazem apenas contagens (`sent`, `failed`, `deferred`, `skipped_*`), sem e-mail, valores ou nomes.
- Teste manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://meuplantao.pro/api/cron/email-alerts`.
