# Guia rápido: novo projeto + webhook GitHub

## 1) Cadastrar repositório (POST padrão)

Endpoint da API:

- `POST /repos`
- Exemplo local: `http://localhost:2999/repos`

Headers:

- `Content-Type: application/json`

Payload mínimo:

```json
{
  "owner": "UltraSistemas",
  "name": "ultra-fv3-ws"
}
```

Payload completo (opcional):

```json
{
  "owner": "UltraSistemas",
  "name": "ultra-fv3-ws",
  "cloneUrl": "https://github.com/UltraSistemas/ultra-fv3-ws.git",
  "defaultBranch": "master",
  "installCommand": "npm install",
  "useLegacyPeerDeps": false
}
```

Exemplo com `curl`:

```bash
curl -X POST "http://localhost:2999/repos" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"UltraSistemas\",\"name\":\"ultra-fv3-ws\"}"
```

---

## 2) Configurar webhook no GitHub

No repositório GitHub, acessar:

- `Settings` → `Webhooks` → `Add webhook`

Configurar exatamente:

- **Payload URL**: `http://187.86.54.241:2999/webhooks/github`
- **Content type**: `application/json`
- **Secret**: copiar o valor de `GITHUB_WEBHOOK_SECRET` do arquivo `.env` da instância que está rodando
- **SSL verification**: desabilitar (`Disable`)
- **Events**: `Let me select individual events`
  - marcar **Pull requests**
  - marcar **Pushes**

Salvar webhook.

---

## 3) Observações rápidas

- O `secret` do GitHub **precisa ser idêntico** ao `GITHUB_WEBHOOK_SECRET` do `.env` do servidor.
- Se o repositório já estiver cadastrado e precisar ajuste, usar `PUT /repos/:id`.
- O endpoint de webhook sempre retorna `200`, mas eventos inválidos são ignorados e registrados em log.
