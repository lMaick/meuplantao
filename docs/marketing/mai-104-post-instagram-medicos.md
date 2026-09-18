# Post Instagram — MeuPlantão (@meuplantao.pro)
**Demanda:** [MAI-104](https://linear.app/maickagent/issue/MAI-104/marketing-criar-e-preparar-post-de-instagram-para-medicos-plantonistas)  
**Tema:** Clareza e controle financeiro de plantões (substituição de planilhas e anotações por gestão em tempo real)  
**Público-alvo:** Médicos plantonistas autônomos com múltiplos vínculos  
**Pilar:** Dor → Solução  
**Formato:** Feed Instagram (1:1 Quadrado - 1080x1080)  

---

## 1. Visual do Criativo

![Criativo MeuPlantão](./assets/post_plantao_controle_financeiro.jpg)

### Especificações da Arte:
- **Formato:** Imagem quadrada (1080 × 1080 px, proporção 1:1)
- **Headline na Arte:** *"Ainda anotando plantão em papel ou planilha?"*
- **Paleta de Cores:**
  - Azul Petróleo Primário: `#033B5C` (Marca e sobriedade médica)
  - Verde Esmeralda: `#008A4B` (Status "Em dia" e saúde financeira)
  - Coral / Alerta: `#EF4444` (Status "Atrasado")
  - Fundo: Branco / Off-white cirúrgico (`#F9FAFB`)
- **Composição:** Contraste visual imediato entre a desorganização analógica (bloco de anotações amassado + planilha confusa) e a clareza digital do app mobile MeuPlantão exibindo cards de plantão com status real de pagamento.
- **Arquivo salvo no repositório:** `docs/marketing/assets/post_plantao_controle_financeiro.jpg`

---

## 2. Copywriting da Publicação

### Gancho (Hook - 1ª linha):
> Quantos plantões você fez no mês passado? Agora me responde: você tem 100% de certeza de que todos já caíram na sua conta?

### Legenda Completa:
```text
Quantos plantões você fez no mês passado? Agora me responde: você tem 100% de certeza de que todos já caíram na sua conta?

Quem vive a rotina de hospital sabe como é:
Sai de uma escala, corre para outra, paciente grave na porta, coordenação mudando data em cima da hora...

No meio dessa loucura, o controle financeiro acaba ficando naquele grupo de WhatsApp com você mesmo, num guardanapo amassado ou numa planilha no Excel que você não abre há três semanas.

O problema?
- Repasses atrasados que passam despercebidos
- Pagamentos parciais que ninguém confere
- Horas do seu descanso perdidas tentando bater extrato bancário

Você não fez anos de faculdade e residência para virar cobrador ou ficar preenchendo fórmula de planilha depois de 24h acordado.

O MeuPlantão foi feito exatamente para essa realidade:
📱 Registro de plantão em 10 segundos no celular
💰 Saldo calculado na hora, sem conta manual
⚠️ Alertas visuais claros de quem está em dia e quem está devendo
📊 Histórico completo de repasses na palma da mão

Plantão feito precisa ser plantão recebido. Sem estresse e sem deixar dinheiro para trás.

👉 Comece a organizar seus plantões hoje mesmo. É gratuito para testar: link na bio (@meuplantao.pro) ou acesse meuplantao.pro.
```

### Hashtags Estratégicas:
```text
#plantaomedico #vidademedico #medicosdobrasil #escalamedica #residente #medicina #plantonista #hospital #prontosocorro #emergenciamedica #gestaofinanceira #financaspessoais #medicinaintensiva #clinicamedica #pediatria #cirurgiageral #saudefinanceira #meuplantao
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
    "scheduledAt": "2026-09-22T15:30:00.000Z",
    "content": "Quantos plantões você fez no mês passado? Agora me responde: você tem 100% de certeza de que todos já caíram na sua conta?\n\nQuem vive a rotina de hospital sabe como é:\nSai de uma escala, corre para outra, paciente grave na porta, coordenação mudando data em cima da hora...\n\nNo meio dessa loucura, o controle financeiro acaba ficando naquele grupo de WhatsApp com você mesmo, num guardanapo amassado ou numa planilha no Excel que você não abre há três semanas.\n\nO problema?\n• Repasses atrasados que passam despercebidos\n• Pagamentos parciais que ninguém confere\n• Horas do seu descanso perdidas tentando bater extrato bancário\n\nVocê não fez anos de faculdade e residência para virar cobrador ou ficar preenchendo fórmula de planilha depois de 24h acordado.\n\nO MeuPlantão foi feito exatamente para essa realidade:\n📱 Registro de plantão em 10 segundos no celular\n💰 Saldo calculado na hora, sem conta manual\n⚠️ Alertas visuais claros de quem está em dia e quem está devendo\n📊 Histórico completo de repasses na palma da mão\n\nPlantão feito precisa ser plantão recebido. Sem estresse e sem deixar dinheiro para trás.\n\n👉 Comece a organizar seus plantões hoje mesmo. É gratuito para testar: link na bio (@meuplantao.pro) ou acesse meuplantao.pro.\n\n.\n.\n.\n#plantaomedico #vidademedico #medicosdobrasil #escalamedica #residente #medicina #plantonista #hospital #prontosocorro #emergenciamedica #gestaofinanceira #financaspessoais #medicinaintensiva #clinicamedica #pediatria #cirurgiageral #saudefinanceira #meuplantao",
    "media": [
      {
        "path": "docs/marketing/assets/post_plantao_controle_financeiro.jpg",
        "altText": "Ainda anotando plantão em papel ou planilha? Comparativo entre notas em papel e o app MeuPlantão com controle financeiro em tempo real"
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
