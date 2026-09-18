# Configuração de Storage Público HTTPS & Automação Postiz

Este documento detalha os requisitos de infraestrutura e procedimentos para garantir que o **Postiz** e a **Meta Graph API (Instagram)** realizem publicações sem falhas de download de mídia (*Media fetch failed*).

---

## 1. Por que a Meta Rejeita URLs Locais (`localhost`)?

Quando uma publicação com imagem ou vídeo é enviada para o Instagram via Graph API (`POST /{ig-user-id}/media`), a Meta **não recebe o arquivo binário diretamente** no corpo da requisição. Em vez disso, o Postiz passa um parâmetro `image_url` (ou `video_url`).

Os servidores da Meta realizam um download assíncrono (HTTP GET) dessa URL. Se o Postiz estiver configurado com armazenamento local (`STORAGE_PROVIDER: 'local'`) e `MAIN_URL=http://localhost:4007`, a URL gerada será:
```
http://localhost:4007/uploads/...
```
Como `localhost` resolve internamente para os servidores da própria Meta, o download falha com `OAuthException code 9004, subcode 2207052 (Media fetch failed)`.

---

## 2. Configuração de Storage Persistente HTTPS (Cloudflare R2 / S3)

A solução canônica e definitiva é configurar o **Cloudflare R2** (ou qualquer bucket S3 público) no `docker-compose.yaml` do Postiz.

### Variáveis no `docker-compose.yaml`:
```yaml
services:
  postiz:
    environment:
      # === Storage Settings (Cloudflare R2)
      STORAGE_PROVIDER: 'cloudflare'
      CLOUDFLARE_ACCOUNT_ID: '${CLOUDFLARE_ACCOUNT_ID}'
      CLOUDFLARE_ACCESS_KEY: '${CLOUDFLARE_ACCESS_KEY}'
      CLOUDFLARE_SECRET_ACCESS_KEY: '${CLOUDFLARE_SECRET_ACCESS_KEY}'
      CLOUDFLARE_BUCKETNAME: 'meuplantao-marketing'
      CLOUDFLARE_BUCKET_URL: 'https://pub-xxxxxxxx.r2.dev/'
      CLOUDFLARE_REGION: 'auto'
```

### Regras de Segurança:
- **Nunca versão chaves ou tokens no Git.** As credenciais do R2/S3 devem residir exclusivamente no arquivo `.env` do diretório do docker-compose (`postiz-docker-compose/.env`), que é ignorado pelo Git.
- O bucket R2 deve possuir **acesso público de leitura habilitado** (R2.dev domain ou domínio customizado com HTTPS, ex: `https://media.meuplantao.pro/`).

---

## 3. Protocolo de Verificação no `postiz-client.mjs`

O client CLI (`ops/marketing/postiz-client.mjs`) foi padronizado com as seguintes garantias:

1. **Validação Prévia de URL de Mídia:**
   - Detecta automaticamente URLs em `localhost`, `127.0.0.1`, `0.0.0.0` e impede o envio para redes sociais que exigem HTTPS público, evitando falsos disparos.
2. **Polling Assíncrono Obrigatório (Publicação Imediata):**
   - Não declara sucesso após o `POST /api/public/v1/posts` síncrono.
   - Realiza polling no endpoint de status até confirmar:
     - `state === 'EXECUTED'`
     - `releaseURL` presente (ex: `https://www.instagram.com/p/.../`)
     - `releaseId` presente (ID da publicação no canal)
3. **Tratamento Estrito de Erro e Timeout:**
   - Se o post entrar em `state: 'ERROR'`, lança exceção explícita com detalhes do erro.
   - Se o tempo limite (`--timeout`, padrão 30s) expirar sem confirmação, encerra com código de erro.

---

## 4. Como Executar e Validar

### Verificar status do Postiz:
```bash
node ops/marketing/postiz-client.mjs status
```

### Listar canais/integrações conectadas:
```bash
node ops/marketing/postiz-client.mjs channels
```

### Agendamento Seguro:
```bash
node ops/marketing/postiz-client.mjs schedule \
  --date "2026-09-22T15:30:00" \
  --caption-file "docs/marketing/posts/caption.txt" \
  --media "docs/marketing/assets/post.jpg"
```

### Publicação Imediata (com confirmação de execução):
```bash
node ops/marketing/postiz-client.mjs post \
  --caption "Texto da legenda" \
  --media "docs/marketing/assets/post.jpg"
```
