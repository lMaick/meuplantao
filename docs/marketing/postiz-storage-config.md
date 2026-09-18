# Configuração de Storage Público HTTPS & Automação Postiz

Este documento detalha os requisitos de infraestrutura, instruções passo a passo para preenchimento manual das credenciais pelo proprietário e o protocolo de validação para garantir que o **Postiz** publique no **Instagram (Meta Graph API)** com storage público HTTPS persistente.

---

## 1. Por que a Meta Rejeita URLs Locais (`localhost`)?

Quando uma publicação com mídia é enviada ao Instagram via Graph API (`POST /{ig-user-id}/media`), a Meta **não recebe o arquivo binário diretamente** no corpo da requisição. Em vez disso, o Postiz passa um parâmetro `image_url` (ou `video_url`).

Os servidores da Meta realizam um download assíncrono (HTTP GET) dessa URL. Se o Postiz estiver configurado com armazenamento local (`STORAGE_PROVIDER: 'local'`) e `MAIN_URL=http://localhost:4007`, a URL gerada será:
```
http://localhost:4007/uploads/...
```
Como `localhost` resolve internamente para os servidores da própria Meta, o download falha com `OAuthException code 9004, subcode 2207052 (Media fetch failed)`.

---

## 2. Checklist de Configuração Manual do Proprietário (Cloudflare R2)

Para ativar o storage persistente HTTPS no Postiz, siga exatamente os passos abaixo:

### Passo 1: Criar o Bucket no Cloudflare R2
1. Acesse o [Cloudflare Dashboard](https://dash.cloudflare.com/) > **R2 Object Storage**.
2. Clique em **Create bucket**.
3. Nomeie o bucket como: `meuplantao-marketing` (ou outro nome de sua preferência).

### Passo 2: Habilitar Acesso Público HTTPS de Leitura
1. No bucket criado, vá em **Settings** > **Public access**.
2. Habilite o domínio **R2.dev subdomain** (ex: `https://pub-xxxxxxxxxxxx.r2.dev`) OU configure um domínio personalizado (ex: `https://media.meuplantao.pro`).
3. Copie a URL pública gerada.

### Passo 3: Gerar Token de API do R2 (Credenciais S3)
1. No menu lateral do R2, clique em **Manage R2 API Tokens** > **Create API token**.
2. Defina as permissões como: **Object Read & Write** (para o bucket `meuplantao-marketing`).
3. Guarde com segurança:
   - **Account ID**
   - **Access Key ID**
   - **Secret Access Key**

### Passo 4: Preencher o arquivo `.env` local do Postiz
Abra o arquivo `C:\Users\Maick\Documents\postiz-docker-compose\.env` no seu editor local e preencha o bloco de storage:

```env
# === Cloudflare R2 Persistent Public Storage
STORAGE_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=SEU_ACCOUNT_ID_AQUI
CLOUDFLARE_ACCESS_KEY=SEU_ACCESS_KEY_ID_AQUI
CLOUDFLARE_SECRET_ACCESS_KEY=SEU_SECRET_ACCESS_KEY_AQUI
CLOUDFLARE_BUCKETNAME=meuplantao-marketing
CLOUDFLARE_BUCKET_URL=https://pub-xxxxxxxxxxxx.r2.dev/
CLOUDFLARE_REGION=auto
```

> ⚠️ **IMPORTANTE:** Nunca compartilhe nem versione essas chaves no Git. O arquivo `.env` é protegido pelo `.gitignore`.

### Passo 5: Reiniciar os Containers do Postiz
No terminal local (fora do container):
```bash
cd "C:\Users\Maick\Documents\postiz-docker-compose"
docker compose down
docker compose up -d
```

---

## 3. Comandos de Verificação e Teste

### A. Verificar conectividade do Postiz:
```bash
node ops/marketing/postiz-client.mjs status
```

### B. Listar integrações conectadas:
```bash
node ops/marketing/postiz-client.mjs channels
```

### C. Teste de Validação sem Publicação Real (Testes Automatizados):
Para verificar se as regras de validação de URL e polling estão ativas:
```bash
npm test
```

### D. Executar Teste de Publicação Real (Apenas quando Autorizado):
Após o preenchimento das chaves no `.env` e reinício do container:
```bash
node ops/marketing/postiz-client.mjs post \
  --caption "Teste de integridade MeuPlantão" \
  --media "docs/marketing/assets/post_plantao_controle_financeiro.jpg"
```
*O client só declarará sucesso quando o Postiz confirmar `state === 'EXECUTED'`, exibindo a `releaseURL` e `releaseId` oficiais.*
