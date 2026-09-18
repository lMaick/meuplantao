# Automação de Marketing — Postiz Client

Ferramenta CLI e biblioteca para agendamento e publicação automatizada nas redes sociais do **MeuPlantão** via Postiz.

---

## 🛠️ Comandos Disponíveis

```bash
# 1. Verificar conectividade com a API do Postiz
node ops/marketing/postiz-client.mjs status

# 2. Configurar API Key localmente (salvo em postiz-config.json, ignorado pelo git)
node ops/marketing/postiz-client.mjs set-key <SUA_API_KEY>

# 3. Listar integrações ativas (Instagram, Facebook, etc.)
node ops/marketing/postiz-client.mjs channels

# 4. Listar posts recentes e consultar estados
node ops/marketing/postiz-client.mjs list-posts

# 5. Agendar post para data futura
node ops/marketing/postiz-client.mjs schedule \
  --date "2026-09-22T15:30:00" \
  --caption "Texto da legenda" \
  --media "docs/marketing/assets/post.jpg"

# 6. Publicação imediata com validação de status EXECUTED
node ops/marketing/postiz-client.mjs post \
  --caption "Texto da legenda" \
  --media "docs/marketing/assets/post.jpg"
```

---

## 🔒 Regras de Integridade & Compliance

1. **Storage Público Obrigatório:** O Postiz deve apontar para storage público HTTPS (Cloudflare R2 / S3). URLs `localhost` são bloqueadas antes do envio para a Meta.
2. **Confirmação Assíncrona:** Publicações imediatas aguardam o resultado do Temporal (`state === 'EXECUTED'` + `releaseURL` + `releaseId`) antes de declarar sucesso.
3. **Nenhum Segredo Versionado:** Chaves de API e tokens residem exclusivamente no `.env` ou em `postiz-config.json` (ambos protegidos no `.gitignore`).
