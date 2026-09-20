# Post Instagram — MeuPlantão (@meuplantao.pro)
**Issue Linear:** MAI-104  
**Data:** 17/09/2026  
**Responsável:** Especialista em Marketing e Conteúdo  

---

### 📌 Ficha Técnica do Post

- **Plataforma:** Instagram Feed (@meuplantao.pro)
- **Formato:** Post Estático (1080 x 1080 px | Aspect Ratio 1:1)
- **Pilar Editorial:** Dor → Solução (40%)
- **Público-Alvo:** Médicos plantonistas que atuam em múltiplos hospitais, clínicas e UPAs
- **Asset Visual:** `ops/marketing/assets/mai-104-post-instagram.jpg`
- **Canal Postiz Vinculado:** MeuPlantão.App (`meuplantao.pro` / id: `cmu4hq1y50001oe9b342cye3w`)

---

### 🎨 Especificação Visual do Criativo

- **Dimensões:** 1080x1080 px (1:1)
- **Paleta de Cores Institucional:**
  - Primária: `#033B5C` (Azul Petróleo Profundo) — autoridade médica e tecnologia segura.
  - Secundária / Ação: `#008A4B` (Verde Esmeralda) — clareza financeira, pagamentos e saúde de saldo.
  - Fundo & Base: `#F8FAFC` / `#FFFFFF` (Clean, respiração visual e alto contraste).
  - Texto & Detalhes: `#0F172A` e `#334155`.
- **Elementos Visuais:**
  - Headline em destaque no topo com tipografia sans-serif encorpada: *"Você sabe exatamente quanto tem a receber este mês?"*
  - Card central em formato de UI mobile-first simulando o dashboard do MeuPlantão:
    - Indicador do mês: *Setembro*
    - Totalizadores claros: *Total a Receber: R$ 8.750,00*
    - Linhas de escala por hospital (Hosp. Santa Maria - 12h)
    - Badge de alerta: *"PAGAMENTO PENDENTE"*
  - Grafismos sutis médicos minimalistas (pulso cardiológico, estetoscópio vetorial estilizado) sem clichês de banco de imagens.

---

### ✍️ Copywriting Completo

#### 🎯 Gancho / Headline
> **Você sabe exatamente quanto tem para receber este mês?**

---

#### 📝 Legenda para o Instagram:

Você sai do plantão às 7h da manhã, exausto, anota o valor no bloco de notas do celular e promete que no fim de semana vai atualizar a planilha. 

O problema é que o fim de semana chega, vem outra escala, e aquela anotação fica perdida entre conversas de WhatsApp.

Aí cai um repasse na sua conta. O valor não bate com o que você esperava.
👉 Qual hospital atrasou?
👉 Qual repasse foi pago parcialmente?
👉 O que ainda está pendente do mês passado?

Quem vive de plantão não tem tempo (nem cabeça) para ficar conferindo extrato de madrugada ou quebrando a cabeça com fórmulas no Excel. Planilha desorganizada não cobra o que é seu por direito.

Com o MeuPlantão, você registra sua escala em menos de 10 segundos logo ao sair do hospital. 

O app calcula tudo automaticamente:
✅ Saldo real a receber atualizado em tempo real;
✅ Identificação imediata de repasses atrasados por instituição;
✅ Controle de recebimentos parciais sem perder o histórico.

Menos tempo na planilha, zero dinheiro esquecido.

Tenha controle absoluto dos seus plantões na palma da mão. 

👉 Acesse o link da bio e comece a usar gratuitamente: meuplantao.pro

---

#### #️⃣ Hashtags Estratégicas (Mix Nicho + Alcance):
#plantaomedico #medicosplantonistas #vidademedico #residenciaemedica #medicosdobrasil #escalamedica #medicinaporamor #plantaonoturno #emergenciamedica #gestaomedica #medicosautonomos #organizacaofinanceira #financaspessoais #controlefinanceiro #meuplantao

---

### 🚀 Preparação para Agendamento via Postiz CLI

Para agendar este post diretamente no Instagram oficial via CLI:

```bash
node ops/marketing/postiz-client.mjs schedule \
  --date "2026-09-18T19:30:00" \
  --caption "Você sai do plantão às 7h da manhã, exausto, anota o valor no bloco de notas do celular e promete que no fim de semana vai atualizar a planilha. 

O problema é que o fim de semana chega, vem outra escala, e aquela anotação fica perdida entre conversas de WhatsApp.

Aí cai um repasse na sua conta. O valor não bate com o que você esperava.
👉 Qual hospital atrasou?
👉 Qual repasse foi pago parcialmente?
👉 O que ainda está pendente do mês passado?

Quem vive de plantão não tem tempo (nem cabeça) para ficar conferindo extrato de madrugada ou quebrando a cabeça com fórmulas no Excel. Planilha desorganizada não cobra o que é seu por direito.

Com o MeuPlantão, você registra sua escala em menos de 10 segundos logo ao sair do hospital. 

O app calcula tudo automaticamente:
✅ Saldo real a receber atualizado em tempo real;
✅ Identificação imediata de repasses atrasados por instituição;
✅ Controle de recebimentos parciais sem perder o histórico.

Menos tempo na planilha, zero dinheiro esquecido.

Tenha controle absoluto dos seus plantões na palma da mão. 

👉 Acesse o link da bio e comece a usar gratuitamente: meuplantao.pro

#plantaomedico #medicosplantonistas #vidademedico #residenciaemedica #medicosdobrasil #escalamedica #medicinaporamor #plantaonoturno #emergenciamedica #gestaomedica #medicosautonomos #organizacaofinanceira #financaspessoais #controlefinanceiro #meuplantao" \
  --media "ops/marketing/assets/mai-104-post-instagram.jpg"
```
