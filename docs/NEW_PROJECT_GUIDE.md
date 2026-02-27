# Quick Guide: New Project + GitHub Webhook

## 1) Register repository (default POST)

API endpoint:

- `POST /repos`
- Local example: `http://localhost:2999/repos`

Headers:

- `Content-Type: application/json`

Minimum payload:

```json
{
  "owner": "UltraSistemas",
  "name": "ultra-fv3-ws"
}
```

Full payload (optional):

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

`curl` example:

```bash
curl -X POST "http://localhost:2999/repos" \
  -H "Content-Type: application/json" \
  -d "{\"owner\":\"UltraSistemas\",\"name\":\"ultra-fv3-ws\"}"
```

---

## 2) Configure GitHub webhook

In the GitHub repository, go to:

- `Settings` → `Webhooks` → `Add webhook`

Set exactly:

- **Payload URL**: `http://187.86.54.241:2999/webhooks/github`
- **Content type**: `application/json`
- **Secret**: copy `GITHUB_WEBHOOK_SECRET` from the `.env` file of the running instance
- **SSL verification**: disable (`Disable`)
- **Events**: `Let me select individual events`
  - enable **Pull requests**
  - enable **Pushes**

Save webhook.

---

## 3) Quick notes

- The GitHub `secret` **must exactly match** `GITHUB_WEBHOOK_SECRET` in the server `.env`.
- If the repository is already registered and needs updates, use `PUT /repos/:id`.
- The webhook endpoint always returns `200`, but invalid events are ignored and logged.
