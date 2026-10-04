# Supabase Auth Hardening — Política de Senha e Controles Operacionais (MAI-166)

Documento operacional de referência técnica para os controles de autenticação, política de senhas, proteção contra enumeração e auditoria da infraestrutura Supabase Auth do MeuPlantão.

---

## 1. Política Canônica de Senha da Aplicação

### 1.1 Baseline e Requisitos
- **Mínimo de 8 caracteres:** Aplicado estritamente na criação de conta (`/cadastro`) e na redefinição de senha (`/redefinir-senha`).
- **Compatibilidade com contas existentes no Login:** O formulário de login (`/login`) **NÃO** impõe validação mínima de 8 caracteres no client-side para não bloquear o acesso de médicos com senhas legadas de 6 ou 7 caracteres criadas no início do projeto.
- **Validação em dupla camada:**
  - Client-side: Atributo HTML `minLength={8}`, texto de ajuda explicativo e validação em JavaScript (`validatePasswordLength` / `validatePasswordReset`) antes do envio de rede.
  - Backend/Provider: Validação no Supabase GoTrue via `password_min_length = 8`.

### 1.2 Mapeamento Canônico de Código
- Arquivo centralizador: [`src/lib/auth/password-policy.ts`](file:///C:/Users/Maick/orca/workspaces/meuplantao/mai-166-ag03-auth/src/lib/auth/password-policy.ts)
- Constante: `MIN_PASSWORD_LENGTH = 8`
- Mensagem padrão: `"A senha deve ter pelo menos 8 caracteres."`
- Validação de reset: Exige tamanho mínimo e confirmação idêntica com mensagem `"As senhas digitadas não coincidem. Verifique e tente novamente."`

---

## 2. Proteção Anti-Enumeração e Mapeamento de Mensagens

Para impedir enumeração de e-mails de médicos cadastrados na plataforma:

1. **Login:**
   - Mensagens de erro de credenciais (`invalid_credentials`) e de e-mail não confirmado (`email_not_confirmed`) são estritamente unificadas em uma única mensagem neutra:
     > *"E-mail ou senha incorretos. Verifique suas credenciais e tente novamente."*
   - Erros de taxa limite (`over_request_rate_limit`, 429) são mapeados para:
     > *"Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente."*
2. **Cadastro (Signup):**
   - Caso o e-mail já esteja cadastrado no Supabase (`user_already_exists`), a aplicação não expõe o erro do provider, exibindo a mesma mensagem neutra de fluxo com link para login:
     > *"Confira seu e-mail para confirmar a conta, se o cadastro foi aceito. Veja também a pasta de spam. Após confirmar, volte aqui e entre com sua senha. Se já possui conta, tente entrar."*
3. **Recuperação de Senha (`/esqueci-senha`):**
   - O formulário sempre exibe resposta genérica de sucesso independente de o e-mail existir ou não na base de dados.
4. **Atualização de Senha (`/redefinir-senha`):**
   - Erros de senha igual à anterior (`same_password`) retornam: *"A nova senha deve ser diferente da senha anterior."*
   - Sessões de recuperação expiradas ou inválidas retornam: *"Sua sessão de recuperação expirou. Solicite um novo link de recuperação."*
   - Provedor bruto nunca expõe restrições de banco ou stack trace.

---

## 3. Auditoria Operacional do Provedor Supabase Auth (Produção)

A auditoria e o alinhamento da configuração foram executados via Management API oficial do Supabase (`GET /v1/projects/{ref}/config/auth` e `organizations/{slug}/entitlements`):

| Controle | Estado Auditado | Ação Realizada (MAI-166) | Evidência / Detalhes |
| :--- | :--- | :--- | :--- |
| **Minimum Password Length** | `6` (inicial) | **Atualizado para `8`** | PATCH em 2026-10-04T17:38:47Z com readback confirmado em 17:38:51Z. Apenas este campo foi alterado. |
| **Password HIBP (Leaked Passwords)** | `false` | **Preservado `false`** | Endpoint oficial de entitlements retornou `auth.leaked_password_protection: false` e `auth.password_hibp: false` (`hasAccess: false`). O entitlement atual da organização não suporta HIBP; nenhuma tentativa de forçar patch foi feita. |
| **CAPTCHA (Anti-Bot)** | `false` | **Preservado `false`** | Mantido desligado por ausência de chaves de provedor (hCaptcha/Turnstile) e de widget challenge na interface. Evita quebra imediata de novos cadastros e resets. |
| **Rate Limits Nativos** | Configurados | **Preservados** | `email_sent = 2/hora`, `sms_sent = 30/hora`, `verify = 30/5min`, `token_refresh = 150/5min`, `otp = 30`, `anonymous = 30/hora`, `smtp_max_frequency = 60s`. |
| **Confirmação de E-mail** | `enable_confirmations = true` | **Preservado `true`** | Exige confirmação de e-mail antes do primeiro acesso (`mailer_autoconfirm = false`). |
| **Provedores Externos** | Google / GitHub | **Preservados `true`** | PKCE redirect urls autorizados e preservados. |
| **Sessão e Recovery** | JWT claims (RFC 8176) | **Preservados** | Inspeciona claims verificadas do JWT (`amr.method === "recovery"`), garantindo compatibilidade estrita. |

### 3.1 Risco Residual e Decisões Técnicas
- **CAPTCHA:** Por não dispor de integração com provedor de CAPTCHA configurada no tenant, a plataforma depende dos rate limits nativos do Supabase Auth (`smtp_max_frequency = 60s`, `email_sent = 2/h`) e da proteção no middleware da aplicação. Não é alegada equivalência total a um CAPTCHA interativo, mas os fluxos legítimos operam sem atrito.
- **Proteção HIBP:** Depende de upgrade de plano/entitlement no Supabase. O endurecimento para 8 caracteres mitigou senhas curtas triviais de 6 dígitos.

---

## 4. Referências Oficiais
- Supabase Auth Service Config API: https://supabase.com/docs/reference/api/v1-update-auth-service-config
- Supabase Organization Entitlements API: https://supabase.com/docs/reference/api/v1-get-organization-entitlements
- Supabase Password Security: https://supabase.com/docs/guides/auth/password-security
- Supabase Rate Limits: https://supabase.com/docs/guides/auth/rate-limits
