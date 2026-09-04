# MeuPlantao

Controle de plantões para profissionais autônomos da saúde (médicos, enfermeiros, fisioterapeutas e outros).

Registre onde trabalhou, plantões agendados/realizados, quanto deve receber, pagamentos totais e parciais, saldo restante e alertas de atraso. Mobile-first, seguro por usuário.

## Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + RLS)

## Rodando local
```bash
npm install
cp .env.example .env.local   # preencha as credenciais do Supabase
npm run dev
```

Veja `PRODUCT.md` para a visão de produto e `AGENTS.md` para as regras de desenvolvimento.