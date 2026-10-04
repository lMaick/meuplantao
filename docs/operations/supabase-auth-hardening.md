# Supabase Auth Hardening — Política de Senha e Controles Operacionais (MAI-166)

Documento operacional de referência técnica para os controles de autenticação, política de senhas, proteção contra enumeração e auditoria da infraestrutura Supabase Auth do MeuPlantão.

---

## 1. Política Canônica de Senha da Aplicação

### 1.1 Baseline e Requisitos
- **Mínimo de 8 caracteres:** Aplicado estritamente na criação de conta (`/cadastro`) e na redefinição de senha (`/redefinir-senha`).
- **Compatibilidade com contas existentes no Login:** O formulário de login (`/login`) **NÃO** impõe validação mínima de 8 caracteres no client-side para não bloquear o acesso de médicos com senhas legadas de 6 ou 7 caracteres criadas no início do projeto.
- **Validação em dupla camada:**
  - Client-side: Atributo HTML `minLength={8}`, texto de ajuda explicativo e validação em JavaScript (`validatePasswordLength` / `validatePasswordReset` via manipuladores `processAuthSubmit` e `processPasswordResetSubmit`) antes do envio de rede.
  - Backend/Provider: Validação no Supabase GoTrue via `password_min_length = 8`.

### 1.2 Mapeamento Canônico de Código
- Arquivo centralizador: [`src/lib/auth/password-policy.ts`](file:///C:/Users/Maick/orca/workspaces/meuplantao/mai-166-ag03-auth/src/lib/auth/password-policy.ts)
- Constante: `MIN_PASSWORD_LENGTH = 8`
- Mensagem padrão: `"A senha deve ter pelo menos 8 caracteres."`
- Validação de reset: Exige tamanho mínimo e confirmação idêntica com mensagem `"As senhas digitadas não coincidem. Verifique e tente novamente."`

---

## 2. Proteção Anti-Enumeração e Mapeamento de Mensagens

Para impedir enumeração de e-mails de médicos cadastrados na plataforma e evitar vazamentos de PII ou injeções de mensagens brutas:

### 2.1 Mapeamento Estrito Exclusivo por `code` e `status`
Os conversores `mapLoginAuthError`, `mapSignupAuthError` e `mapPasswordUpdateError` **NUNCA** inspecionam substrings de `message` ou `name` do erro. Avaliam estritamente o código canônico do GoTrue (`code`) e o status HTTP (`status`), garantindo imunidade total contra injeções adversariais e estabilidade contra variações de texto ou idioma do provedor:

1. **Login:**
   - Mensagens de erro de credenciais (`invalid_credentials`) e de e-mail não confirmado (`email_not_confirmed`) ou usuário não encontrado são estritamente unificadas em uma única mensagem neutra:
     > *"E-mail ou senha incorretos. Verifique suas credenciais e tente novamente."*
   - Erros de taxa limite (`over_request_rate_limit`, 429) são mapeados para:
     > *"Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente."*
2. **Cadastro (Signup):**
   - Caso o e-mail já esteja cadastrado no Supabase (`user_already_exists`, `identity_already_exists`, `email_exists`), a aplicação não expõe o erro do provider, exibindo a mesma mensagem neutra de fluxo com link para login:
     > *"Confira seu e-mail para confirmar a conta, se o cadastro foi aceito. Veja também a pasta de spam. Após confirmar, volte aqui e entre com sua senha. Se já possui conta, tente entrar."*
   - Falha de senha fraca (`weak_password`): exibe `"A senha deve ter pelo menos 8 caracteres."`.
   - Outros erros inesperados: retornam fallback genérico sem expor stack traces ou detalhes internos.
3. **Recuperação de Senha (`/esqueci-senha`):**
   - O formulário sempre exibe resposta genérica de sucesso independente de o e-mail existir ou não na base de dados.
4. **Atualização de Senha (`/redefinir-senha`):**
   - Senha igual à anterior (`same_password`): retorna *"A nova senha deve ser diferente da senha anterior."*.
   - Sessões de recuperação expiradas ou inválidas (`bad_jwt`, `session_expired`, `token_expired`, `otp_expired`): retornam *"Sua sessão de recuperação expirou. Solicite um novo link de recuperação."*.
   - Provedor bruto nunca expõe restrições de banco ou detalhes técnicos.

---

## 3. Auditoria Operacional do Provedor Supabase Auth (Produção)

A auditoria e o alinhamento da configuração foram executados via Management API oficial do Supabase (`GET /v1/projects/{ref}/config/auth` e `organizations/{slug}/entitlements`):

| Controle | Estado Auditado | Ação Realizada (MAI-166) | Evidência / Detalhes |
| :--- | :--- | :--- | :--- |
| **Minimum Password Length** | `6` (inicial) | **Atualizado para `8`** | PATCH em 2026-10-04T17:38:47Z com readback confirmado em 17:38:51Z. Apenas este campo foi alterado. |
| **Password HIBP (Leaked Passwords)** | `false` | **Preservado `false`** | Endpoint oficial de entitlements retornou `auth.leaked_password_protection: false` e `auth.password_hibp: false` (`hasAccess: false`). O entitlement atual da organização não suporta HIBP; nenhuma tentativa de forçar patch foi feita e nenhum upgrade comercial foi acionado. |
| **CAPTCHA (Anti-Bot)** | `false` | **Preservado `false`** | Mantido desativado por ausência de chaves de provedor (hCaptcha/Cloudflare Turnstile) e ausência de componente/fluxo de challenge UX na interface. Habilitar sem o fluxo na UI quebraria 100% dos cadastros e resets legítimos. |
| **Rate Limits Nativos** | Configurados | **Preservados** | `email_sent = 2/hora`, `sms_sent = 30/hora`, `verify = 30/5min`, `token_refresh = 150/5min`, `otp = 30`, `anonymous = 30/hora`, `smtp_max_frequency = 60s`. |
| **Confirmação de E-mail** | `enable_confirmations = true` | **Preservado `true`** | Exige confirmação de e-mail antes do primeiro acesso (`mailer_autoconfirm = false`). |
| **Provedores Externos** | Google / GitHub | **Preservados `true`** | PKCE redirect urls autorizados e preservados. |
| **Sessão e Recovery** | JWT claims (RFC 8176) | **Preservados** | Inspeciona claims verificadas do JWT (`amr.method === "recovery"`), garantindo compatibilidade estrita. |

### 3.1 Riscos Residuais e Decisões Técnicas
- **Decisão CAPTCHA:** Na ausência de chaves de provedor (Turnstile/hCaptcha) e do componente de desafio no front-end, a plataforma depende dos rate limits nativos do Supabase Auth (`smtp_max_frequency = 60s`, `email_sent = 2/h`) e da proteção de rate limit no middleware. Não se alega equivalência técnica total a um CAPTCHA interativo, mas preserva-se a funcionalidade dos cadastros legítimos sem atrito.
- **Decisão HIBP:** A proteção contra senhas vazadas depende de entitlement Pro/Enterprise no Supabase. O endurecimento para 8 caracteres na UI e no backend mitiga senhas curtas triviais de 6 dígitos.

---

## 4. Status de Verificação e Homologação

Para transparência estrita de auditoria, distingue-se o que foi verificado programmaticamente do que depende de homologação operacional:

1. **Passou (Passed):**
   - Suite automatizada de testes (`npm test`): 868 testes unitários e de integração verdes.
   - Teste de limiar estrito: rejeição de 7 caracteres e aceitação de 8 caracteres em cadastro e reset.
   - Não-enumeração de usuários e mapeamento estrito por `code`/`status`.
   - Teste adversarial: imunidade a injeções em `message` e vazamento de PII.
   - Linting (`npm run lint`), tipagem TypeScript (`npx tsc --noEmit`) e build estático (`npm run build`) 100% verdes.
   - Auditoria de segurança de produção (`npm run audit:prod` com `--audit-level=high`): 0 vulnerabilidades high ou critical.
   - Alinhamento de backend: `password_min_length = 8` confirmado via GET readback na Management API.
2. **Ignorado / Fora de Escopo (Skipped):**
   - Upgrade de plano para habilitar HIBP no Supabase (não autorizado sem decisão comercial).
3. **Pendente de Homologação Manual (Operational Pending):**
   - Testes manuais interativos de login com provedores OAuth reais (Google e GitHub) e recebimento/clique do link de recuperação de senha por e-mail em ambiente de Preview da Vercel após o deploy.

---

## 5. Referências Oficiais
- Supabase Auth Service Config API: https://supabase.com/docs/reference/api/v1-update-auth-service-config
- Supabase Organization Entitlements API: https://supabase.com/docs/reference/api/v1-get-organization-entitlements
- Supabase Password Security: https://supabase.com/docs/guides/auth/password-security
- Supabase Rate Limits: https://supabase.com/docs/guides/auth/rate-limits
