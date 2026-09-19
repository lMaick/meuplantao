# Post Instagram — MeuPlantão (@meuplantao.pro)
**Demanda:** [MAI-113](https://linear.app/maickagent/issue/MAI-113/mktinstagram-criar-post-sobre-controle-de-repasses-em-atraso-de)
**Tema:** Controle de repasses em atraso de plantões (quem deve, há quanto tempo, quanto)
**Público-alvo:** Profissionais de saúde plantonistas com múltiplos vínculos (hospitais, UPAs, clínicas)
**Pilar:** Dor → Solução
**Formato:** Feed Instagram (1:1 Quadrado - 1080x1080)

---

## 1. Visual do Criativo

![Criativo MAI-113](./assets/mai-113-repasses-em-atraso.jpg)

### Especificações da Arte (v2 final — alinhada ao app):
- **Formato:** Imagem quadrada (1080 × 1080 px, proporção 1:1, JPG alta nitidez)
- **Headline na Arte (aprovada, mantida):** *"Plantão feito não é plantão recebido."*
- **Paleta oficial do app (src/app/globals.css + DESIGN.md):**
  - Hero dark cirúrgico: gradiente `#0B1220 → #022C22` (slate-950 → emerald-950, cf. landing-footer emerald-900→slate-900)
  - Primário CTA: `#059669 → #0D9488` (emerald-600 → teal-600, cf. app-shell/dashboard)
  - Verde financeiro: `#059669` / fundo `#D1FAE5` / texto `#047857` (badge EM DIA, cf. primitives success)
  - Coral atraso: `#DC2626` / fundo `#FEE2E2` (badge ATRASADO, cf. destructive)
  - Fundo: `#F7F9FA` (oklch 0.99 0.005 240, sem branco estourado)
  - Texto: `#0F172A` (ink) / `#64748B` (muted)
- **Tipografia fiel ao app:** Headline extrabold tracking apertado (Geist/800), valores em mono tabular (font-mono contábil), badges 13px semibold uppercase em pill rounded-full com ring
- **Marca d'água:** logo oficial `public/brand/meuplantao-avatar-instagram-1080.png` aplicado sutil no hero (faint circular, ~15% opacidade, canto superior direito, sem poluir headline) + lockup "M+ MeuPlantão / GESTÃO MÉDICA" no topo + crédito "MeuPlantão • controle financeiro de plantões"
  - Nota: `meuplantao-pulse-mark.svg` / `meuplantao-pulse-logo.svg` citados no feedback não existem no repo — usado o asset oficial disponível (`public/brand/`). Se os SVGs forem adicionados, itero a marca d'água vetorial.
- **Composição:** Hero dark com headline + 2 cards brancos rounded-2xl border `#E2E8F0` idênticos ao dashboard (barra lateral de status, badge pill, valor mono) + CTA gradiente meuplantao.pro
- **Arquivo salvo no repositório:** `docs/marketing/assets/mai-113-repasses-em-atraso.jpg` (substituído na v2)

### Variações de Headline (para escolha do Maick):
- **H1 (usada na arte):** Plantão feito não é plantão recebido.
- **H2:** Quanto do seu dinheiro está preso em repasse atrasado?
- **H3:** Quem te deve, há quanto tempo, e quanto?

---

## 2. Copywriting da Publicação

### Ganchos (para escolha do Maick):
- **G1 (recomendado):** Você sabe quanto te devem em repasses atrasados — agora, sem olhar planilha?
- **G2 (alternativo):** Se um repasse atrasasse hoje, em quanto tempo você perceberia?

### Legenda Completa (com G1):
```text
Você sabe quanto te devem em repasses atrasados — agora, sem olhar planilha?

Quem bate plantão em 2, 3 hospitais diferentes conhece a rotina:
sai de uma escala, entra em outra, troca de horário em cima da hora, e o pagamento cai picado, em datas diferentes.

Aí o controle fica no grupo de WhatsApp com você mesmo, num print solto ou numa planilha que ninguém atualiza.

O resultado é sempre o mesmo:
- Repasse atrasado que passa despercebido
- Pagamento parcial que ninguém confere
- Descanso virando conferência de extrato

Você não fez faculdade e residência pra ficar cobrando repasse no WhatsApp depois de 24h acordado.

O MeuPlantão foi feito pra essa realidade:
📱 Registro do plantão em segundos no celular
💰 Saldo real calculado na hora, sem conta manual
⚠️ Visão clara de quem está em dia e quem está em atraso

Plantão feito precisa ser plantão recebido. Sem deixar dinheiro pra trás.

👉 Comece a organizar hoje: link na bio (@meuplantao.pro) ou acesse meuplantao.pro
Marca aquele colega que vive de plantão e precisa ver isso.
```

### Hashtags Estratégicas:
```text
#plantaomedico #vidademedico #medicosdobrasil #escalamedica #plantonista #residente #medicina #hospital #prontosocorro #emergenciamedica #enfermagem #fisioterapia #gestaofinanceira #financaspessoais #organizacaofinanceira #saudefinanceira #meuplantao #repasses
```

---

## 3. Preparação para Agendamento via Postiz

### Detalhes de Agendamento Recomendados:
- **Plataforma:** Instagram (Feed)
- **Melhores Horários:**
  - Almoço: 12h15 às 12h45 (pausa entre atendimentos)
  - Noite: 20h00 às 21h15 (transição/fim de plantão)
- **Dias sugeridos:** Terça ou Quarta-feira (pico de engajamento para conteúdo profissional)

### Payload JSON para API / Importação no Postiz:

```json
{
  "post": {
    "type": "post",
    "providers": ["instagram"],
    "scheduledAt": "2026-09-23T15:30:00.000Z",
    "content": "Você sabe quanto te devem em repasses atrasados — agora, sem olhar planilha?\n\nQuem bate plantão em 2, 3 hospitais diferentes conhece a rotina:\nsai de uma escala, entra em outra, troca de horário em cima da hora, e o pagamento cai picado, em datas diferentes.\n\nAí o controle fica no grupo de WhatsApp com você mesmo, num print solto ou numa planilha que ninguém atualiza.\n\nO resultado é sempre o mesmo:\n• Repasse atrasado que passa despercebido\n• Pagamento parcial que ninguém confere\n• Descanso virando conferência de extrato\n\nVocê não fez faculdade e residência pra ficar cobrando repasse no WhatsApp depois de 24h acordado.\n\nO MeuPlantão foi feito pra essa realidade:\n📱 Registro do plantão em segundos no celular\n💰 Saldo real calculado na hora, sem conta manual\n⚠️ Visão clara de quem está em dia e quem está em atraso\n\nPlantão feito precisa ser plantão recebido. Sem deixar dinheiro pra trás.\n\n👉 Comece a organizar hoje: link na bio (@meuplantao.pro) ou acesse meuplantao.pro\nMarca aquele colega que vive de plantão e precisa ver isso.\n\n.\n.\n.\n#plantaomedico #vidademedico #medicosdobrasil #escalamedica #plantonista #residente #medicina #hospital #prontosocorro #emergenciamedica #enfermagem #fisioterapia #gestaofinanceira #financaspessoais #organizacaofinanceira #saudefinanceira #meuplantao #repasses",
    "media": [
      {
        "path": "docs/marketing/assets/mai-113-repasses-em-atraso.jpg",
        "altText": "Plantão feito não é plantão recebido. Comparativo de cards com status atrasado e em dia no app MeuPlantão"
      }
    ],
    "settings": {
      "instagram": {
        "postType": "feed"
      }
    }
  }
}
```

---

## Self-check (marketing-copywriter)
- [x] Tom de voz confere com marketing-config (colega de plantão, direto, sem vendedor agressivo)
- [x] Tem CTA (link na bio + marca colega)
- [x] Primeira linha é hook
- [x] Sem claims proibidos (ferramenta de controle, sem promessa de rendimento)
- [x] Tamanho adequado para Instagram feed
