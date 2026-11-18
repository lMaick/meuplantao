# MeuPlantão na Google Play Store — Decisão Arquitetural

**Data da decisão:** 18/11/2026  
**Arquitetura:** Tony (Maick Digital)  
**Implementação:** Jarvis  

---

## 1. Caminho Escolhido: TWA (Trusted Web Activity) com Bubblewrap

O aplicativo Android do **MeuPlantão** utiliza **TWA (Trusted Web Activity)** gerada via **Bubblewrap**, abrindo `https://meuplantao.pro` diretamente no motor do Google Chrome em tela cheia (sem barra de endereço, validado por Digital Asset Links).

### Motivos técnicos da escolha
- **Base única de código:** o aplicativo consome a própria aplicação Next.js em produção (`meuplantao.pro`). Cada deploy na Vercel atualiza a interface imediatamente, sem exigir novo envio ou revisão na Play Store para mudanças web.
- **Compatibilidade total com backend e autenticação:** o MeuPlantão utiliza rotas de API server-side (`/api/*`), `src/middleware.ts`, cookies SSR (`@supabase/ssr`) e login OAuth (Google e GitHub). Na TWA (baseada em Chrome Custom Tabs), OAuth e cookies funcionam nativamente, sem os bloqueios do Google a WebViews embarcadas.
- **Alternativas descartadas:**
  - **Capacitor com bundle estático (`output: "export"`):** inviável sem reescrever/separar todas as rotas server-side e a sessão SSR por cookies.
  - **Capacitor apontando para URL remota:** utiliza WebView em vez do Chrome completo, bloqueia fluxos padrão de Google OAuth e adiciona manutenção nativa desnecessária.
  - **Reescrita nativa / Expo:** fora do orçamento e duplicaria regras críticas de negócio e UI.

---

## 2. Identidade Android e Assinatura

- **Application ID (pacote):** `pro.meuplantao.app` (imutável após a primeira publicação na loja).
- **Assinatura de release:** **Play App Signing** gerenciado no Google Play Console.
- **Chave de upload (upload keystore):** armazenada **exclusivamente fora do repositório**; caminho e credenciais residem apenas no Cofre seguro, nunca no Git, em variáveis expostas, PRs ou conversas.
- **Estrutura do projeto Android (etapa seguinte):** diretório `android/` gerado pelo Bubblewrap e vínculo de domínio em `public/.well-known/assetlinks.json`.

---

## 3. Política de Pagamentos da Google Play (Estratégia em 2 Fases)

Aplicativos distribuídos na Google Play que vendem acesso ou recursos digitais dentro do Android devem utilizar o **Google Play Billing**. Exibir checkout externo (Mercado Pago, Pix ou cartão fora do Play Billing), preços para contratação externa ou textos/links direcionando o usuário a assinar pelo navegador é motivo de rejeição pelas políticas de Pagamentos da Google Play.

### Fase 1 — Sem compra dentro do app Android (implementada)
- O Web App Manifest (`src/app/manifest.ts`) define `start_url: "/?origem=twa"` e `display: "standalone"`.
- Ao detectar `?origem=twa` (no `src/middleware.ts` ou no bootstrap cliente) ou referrer `android-app://`, o app grava o cookie `mp_origem=twa` (validade de 1 ano) e marca `html[data-twa="true"]` antes da primeira pintura (sem flash visual).
- **Dentro da TWA (`isTwa === true`):**
  - Esconde botões de assinar/estender plano, seletor de períodos, preços, checkout do paywall, atalhos para `/assinatura` e qualquer menção ou direcionamento a Mercado Pago, Pix ou pagamento externo (tanto na landing quanto nas telas autenticadas).
  - **Quem já possui assinatura Pro ativa** ou está em **período de avaliação gratuita** entra e utiliza todos os recursos normalmente.
  - Contas com período de avaliação encerrado permanecem em **modo leitura** para consulta de histórico, locais e recebimentos, sem oferta de pagamento externo.
- **Fora da TWA (navegador comum):** nenhuma alteração — o site mantém integralmente o fluxo atual de contratação via Mercado Pago.

### Fase 2 — Venda nativa no Android (futura, sob demanda)
- Quando houver decisão comercial de vender diretamente dentro do app Android:
  1. Confirmar na documentação oficial vigente do Google Play as regras aplicáveis ao Brasil (incluindo eventuais modalidades de faturamento alternativo / User Choice Billing e comissões).
  2. Integrar **Google Play Billing** via **Digital Goods API** + Payment Request API na TWA.
  3. Validar o `purchaseToken` no servidor via **Google Play Developer API** e notificações **RTDN (Real-Time Developer Notifications)**, gravando a vigência nas mesmas tabelas de assinatura (`subscriptions`) com idempotência e RLS preservados.

---

## 4. Ordem de Entrega

1. **Base PWA e Modo TWA Fase 1 (este PR):** `src/app/manifest.ts`, ícones `192`, `512` e `maskable` gerados de `public/brand/meuplantao-calendar-icon.svg`, página `/offline` + Service Worker de fallback offline seguro (sem cachear rotas autenticadas ou `/api/*`), detecção `origem=twa` via cookie e ocultação completa de compra/preço externo na TWA, com testes automatizados.
2. **Projeto TWA Android:** geração da pasta `android/` via Bubblewrap, publicação de `public/.well-known/assetlinks.json` com o SHA-256 da chave aprovada e build local do pacote `.aab` (sem envio automático à loja).
3. **Ficha da Google Play Store:** preparação de textos, capturas de tela, classificação indicativa, referência à Política de Privacidade (`/privacidade`) e preenchimento guiado do formulário de Segurança de Dados (*Data Safety*) para submissão humana pelo responsável.
