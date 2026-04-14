# Arquitetura do projeto — node-project-builder

## TL;DR

Este é um **monorepo NestJS** com dois serviços ativos (`api` e `runner`) e
uma biblioteca interna compartilhada (`shared`). Existe um terceiro app
(`node-project-builder`) que é o esqueleto gerado automaticamente pelo
`nest new` e **não é usado em produção** — pode ser ignorado ou removido.

---

## Mapa da estrutura

```
/
├── apps/
│   ├── api/               ← Serviço 1 — Interface HTTP/REST (porta 3000 por padrão)
│   ├── runner/            ← Serviço 2 — Executor de builds (porta 3001 por padrão)
│   ├── node-project-builder/ ← LEGADO — gerado pelo nest new, stubs vazios, não usar
│   └── shared/            ← Biblioteca interna — entidades DB, i18n
├── docs/
├── nest-cli.json          ← Configura o monorepo (lista os 3 apps)
├── package.json           ← Scripts e deps do workspace
└── tsconfig.json
```

---

## Por que `npm run start` "não sobe nada de útil"

O `nest-cli.json` define como app **padrão** o `node-project-builder` (campo
`"sourceRoot"` e `"root"` no topo). Por isso todos os scripts sem `--project`
sobem aquele app esqueleto, que não tem lógica real.

```json
// nest-cli.json — configuração atual (app padrão = esqueleto)
"sourceRoot": "apps/node-project-builder/src",
"root": "apps/node-project-builder"
```

Para subir os serviços reais é necessário passar o nome do projeto:

```bash
nest start api          # ou npm run start:api
nest start runner       # ou npm run start:runner
```

---

## Serviços ativos

### `apps/api` — API REST

- **Porta**: `API_PORT` (default `3000`)
- **Entrypoint**: `apps/api/src/main.ts` → bootstrapa `ApiModule`
- **Responsabilidades**:
  - `ReposModule` — CRUD de repositórios monitorados (`POST /repos`, `GET /repos`, `PUT /repos/:id`, `DELETE /repos/:id`)
  - `WebhooksModule` — recebe e valida eventos do GitHub (`POST /webhooks/github`), valida assinatura HMAC-SHA256, enfileira builds
  - `BuildsModule` — consulta status de builds (`GET /builds`)
  - `SyncModule` — dispara sincronização manual de repos
  - `DbModule` (shared) — conexão PostgreSQL via TypeORM
  - `I18nModule` (shared) — mensagens em PT-BR (padrão) ou EN-US

### `apps/runner` — Executor de builds

- **Porta**: `RUNNER_PORT` (default `3001`)
- **Entrypoint**: `apps/runner/src/main.ts` → bootstrapa `RunnerModule`
- **Responsabilidades**:
  - Consome a fila de builds pendentes no banco
  - `BuildPreparationService` — prepara diretório, clona repo via GitHub
  - `NodeBuilderService` — build para projetos TypeScript/Node (`npm install`, `npm run build`)
  - `AngularBuilderService` — build para projetos Angular (`npm install`, `ng build`)
  - `GitHubService` — comunicação com API do GitHub (ex.: fetch de branch default)
  - `BuildSyncService` — sincroniza estado de builds entre DB e execução
  - `BuildLogger` — registra logs de cada build
  - `SyncController` — endpoint para a API acionar sincronização (`POST /sync`)
  - `DbModule` + `I18nModule` (shared)

---

## Biblioteca compartilhada `apps/shared`

Não é um app executável — é uma biblioteca consumida pelos dois serviços.

| Módulo / Arquivo | O que contém |
|---|---|
| `db/db.module.ts` | Configuração do TypeORM (PostgreSQL) |
| `db/entities/repo.entity.ts` | Tabela `repos` |
| `db/entities/build.entity.ts` | Tabela `builds` (com status enum: QUEUED, RUNNING, SUCCESS, FAILED…) |
| `db/entities/build-ref-state.entity.ts` | Controle de cooldown por branch/PR |
| `db/entities/repo-type.enum.ts` | Enum `typescript` / `angular` |
| `i18n/i18n.module.ts` + `i18n.service.ts` | Internacionalização (PT-BR / EN-US) |
| `i18n/messages.pt-br.ts` + `messages.en-us.ts` | Strings de log e erro |

---

## App legado `apps/node-project-builder`

Gerado automaticamente pelo comando `nest new` antes de a arquitetura real ser
desenvolvida. **Não contém lógica**, apenas stubs:

- `ReposService`, `WebhooksService`, `BuildsService` — corpos vazios
- `AppModule` — sem DB, sem I18n, sem DI real
- `AppController` / `AppService` — apenas retornam `"Hello World!"`

**Recomendação**: remover este app ou ao menos parar de listar nos scripts.
Enquanto existir, o `nest start` sem `--project` vai subir ele em vez dos
serviços reais.

---

## Variáveis de ambiente (`.env`)

| Variável | Descrição | Default |
|---|---|---|
| `API_PORT` | Porta da API REST | `3000` |
| `RUNNER_PORT` | Porta do Runner | `3001` |
| `GITHUB_WEBHOOK_SECRET` | Segredo HMAC para validar webhooks | — |
| `APP_LANG` | Idioma dos logs (`pt-BR` ou `en-US`) | `pt-BR` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Conexão PostgreSQL | — |
| `BUILD_COOLDOWN_MS` | Intervalo mínimo entre builds do mesmo ref | `60000` |

---

## Como rodar (desenvolvimento)

Os dois serviços precisam rodar **em paralelo** em terminais separados:

```bash
# Terminal 1 — API
npm run start:api

# Terminal 2 — Runner
npm run start:runner
```

Para modo watch (hot-reload):

```bash
npm run start:api:dev
npm run start:runner:dev
```

> Os scripts `start:api`, `start:runner` etc. estão definidos no `package.json`
> raiz (veja seção "Scripts do package.json" abaixo).

---

## Scripts do `package.json` (após correção)

| Script | Comando real | Descrição |
|---|---|---|
| `start:api` | `nest start api` | Sobe a API REST |
| `start:api:dev` | `nest start api --watch` | API em modo watch |
| `start:runner` | `nest start runner` | Sobe o Runner |
| `start:runner:dev` | `nest start runner --watch` | Runner em modo watch |
| `build:api` | `nest build api` | Compila a API |
| `build:runner` | `nest build runner` | Compila o Runner |
| `start:prod:api` | `node dist/apps/api/main` | Produção — API |
| `start:prod:runner` | `node dist/apps/runner/main` | Produção — Runner |

---

## Fluxo principal (happy path)

```
GitHub Push/PR
      │
      ▼
 POST /webhooks/github  (apps/api, porta 3000)
      │  valida HMAC-SHA256
      │  identifica repo no banco
      │  cria Build { status: QUEUED }
      │
      ▼
   PostgreSQL
      │
      ▼
   Runner  (apps/runner, porta 3001)
      │  polling / sync
      │  clona repo (GitHub)
      │  executa install + build
      │  atualiza Build { status: SUCCESS | FAILED }
      ▼
   PostgreSQL
```

---

## Por que dois processos separados, não um só?

- **Separação de responsabilidades**: a API responde HTTP rapidamente e não
  bloqueia. O Runner pode demorar minutos num build sem afetar respostas ao GitHub.
- **Escalabilidade independente**: é possível ter múltiplos Runners apontando
  para a mesma API/banco sem mexer na API.
- **Falha isolada**: um build travado não derruba o endpoint de webhook.
