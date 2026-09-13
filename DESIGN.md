# MeuPlantão — Design System & Visual Identity

Este documento estabelece o contrato visual e as decisões de design do **MeuPlantão**, alinhadas com as diretrizes do **Impeccable**.

---

## 1. Princípios de Design

1. **Precisão Clínica:** O visual deve transmitir rigor, confiança e precisão. Profissionais de saúde lidam com vidas e finanças sérias; o app não pode parecer um brinquedo nem um template genérico de SaaS com gradientes roxos ("AI slop").
2. **Mobile-First Real:** Médicos e plantonistas consultam e registram dados com uma mão só entre atendimentos no hospital. Áreas de clique (touch targets) mínimas de 44px, tipografia legível sob luz hospitalar e navegação acessível.
3. **Clareza de Status Derivado:** As cores comunicam estado financeiro sem ambiguidade:
   - **Esmeralda / Sucesso:** Saldo recebido, tudo em dia.
   - **Âmbar / Alerta:** Pagamento pendente próximo do vencimento ou parcial.
   - **Coral / Destrutivo:** Atraso comprovado na data prevista de repasse.
4. **Sem Caixas em Excesso:** Evitar empilhar cards dentro de cards. O ritmo visual deve usar espaçamento e tipografia para agrupar informações, não bordas infinitas.

---

## 2. Paleta de Cores (OKLCH)

- **Fundo Primário:** `oklch(0.99 0.005 240)` (claro cirúrgico sutilmente frio, sem branco cru estourado)
- **Superfície Escura / Hero:** `oklch(0.16 0.03 240)` (ardósia profunda / azul cirúrgico noturno)
- **Marca & Acento Primário:** `oklch(0.52 0.20 250)` / `oklch(0.66 0.19 250)` (Azul Safira Cirúrgico médico)
- **Texto Principal:** `oklch(0.14 0.02 240)` (preto profundo com nuance azulada)
- **Texto Secundário / Muted:** `oklch(0.45 0.02 240)` (contraste mínimo 4.5:1 garantido)
- **Verde Financeiro (Recebido):** `oklch(0.62 0.17 155)` / `oklch(0.92 0.05 155)` (fundo suave)
- **Âmbar de Alerta (Pendente/Próximo):** `oklch(0.68 0.16 75)` / `oklch(0.95 0.05 75)` (fundo suave)
- **Coral de Atraso (Vencido):** `oklch(0.58 0.22 25)` / `oklch(0.94 0.04 25)` (fundo suave)
- **Bordas / Divisores:** `oklch(0.92 0.01 240)`

---

## 3. Tipografia

- **Família Principal:** Geist Sans (com fallback para system sans de alta legibilidade).
- **Hierarquia:**
  - **Hero Title:** 2.5rem a 4rem (40px a 64px), peso 700/800, tracking `-0.03em`.
  - **Section Headings (H2):** 2rem a 2.75rem (32px a 44px), peso 700, tracking `-0.02em`.
  - **Subheadings (H3):** 1.25rem a 1.5rem (20px a 24px), peso 600.
  - **Corpo:** 1rem (16px), line-height `1.6`.
  - **Labels e Badges:** 0.8125rem (13px), peso 600, uppercase ou tracking ligeiramente expandido.
  - **Valores Financeiros:** Números tabulares monospaçados (`font-mono` / Geist Mono) para alinhamento contábil.

---

## 4. Componentes e Ergonomia

- **Botões:** Altura mínima de 44px em mobile, cantos arredondados modernos (`rounded-xl` / `rounded-full` para badges).
- **Feedback de toque:** Estados `:hover` e `:active` nítidos com transições suaves (150ms-200ms ease-out).
- **Anti-patterns banidos:**
  - Proibido texto cinza claro com contraste inferior a 4.5:1.
  - Proibido gradiente roxo-azul clichê de IA.
  - Proibido animações de mola exageradas ("bounce/elastic easing").
  - Proibido telas cheias de cards vazios sem conteúdo ou métricas contextuais.
