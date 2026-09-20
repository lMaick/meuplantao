# MeuPlantao — Produto

App web mobile-first para profissionais autônomos que trabalham por plantões (médicos, enfermeiros, fisioterapeutas e outros).

## Problema
O profissional não tem uma visão clara e confiável de: onde trabalhou, plantões agendados/realizados, quanto deve receber, quanto já recebeu, pagamentos parciais, quem ainda está devendo, e o que está atrasado ou próximo do vencimento.

## O que o sistema resolve
- **Autenticação individual** — cada usuário só vê os próprios dados.
- **Cadastro de locais de trabalho** e **contatos responsáveis pelo repasse**.
- **Agenda/calendário de plantões** — agendados e realizados.
- **Registro de valores e previsão de recebimento.**
- **Controle de pagamentos totais e parciais** e **saldo restante por plantão.**
- **Alertas de atraso** e de recebimentos próximos do vencimento.
- **Dashboard claro** com: a receber, recebido no mês, atrasado, próximos plantões e recebimentos previstos.

## Regras financeiras (invariantes)
1. Plantão **realizado** gera obrigação financeira.
2. Pagamento **parcial** reduz o saldo corretamente.
3. **Status financeiro sempre derivado** dos dados reais, nunca manual.
4. **Isolamento total por usuário** (RLS).
5. Alterar plantão com pagamento **não pode gerar inconsistência** financeira.

## Arquitetura
- **Next.js (App Router) + TypeScript**, mobile-first.
- **Supabase** (Postgres + Auth + RLS) — banco e identidade.
- **Tailwind CSS + shadcn/ui.**
- DAL tipada por usuário.
- Desenhado para evoluir a **SaaS comercial** (multi-tenant, planos e billing no futuro).