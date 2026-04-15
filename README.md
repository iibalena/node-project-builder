<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Project docs index: [docs/README.md](docs/README.md)

## Localization (logs/messages)

- Default language is **PT-BR**.
- To force English logs/messages, set `APP_LANG=en-US` in `.env`.
- To force Portuguese explicitly, set `APP_LANG=pt-BR`.

## Teste manual do webhook GitHub App

Objetivo deste teste: validar localmente assinatura HMAC SHA-256, diferenciar eventos de GitHub App vs webhook antigo de repositório e verificar logs de aceito/ignorado/rejeitado.

1. Configure a secret do webhook:

```bash
set GITHUB_WEBHOOK_SECRET=dev-webhook-secret
```

2. Suba a API:

```bash
pnpm run start:api:dev
```

3. (Opcional) verifique health do endpoint:

```bash
curl -X GET http://localhost:3000/github/webhook/health
```

4. Exemplo de payload `push` com `installation.id` (GitHub App):

```json
{
  "ref": "refs/heads/main",
  "after": "1111111111111111111111111111111111111111",
  "repository": {
    "full_name": "acme/my-repo",
    "name": "my-repo",
    "owner": {
      "login": "acme"
    }
  },
  "installation": {
    "id": 12345678
  }
}
```

5. Gere assinatura HMAC SHA-256 com OpenSSL (PowerShell):

```powershell
$secret = "dev-webhook-secret"
$body = Get-Content -Raw .\payload-app.json
$sig = "sha256=" + (([System.BitConverter]::ToString(
  [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($secret)).ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($body)
  )
)).Replace("-", "").ToLower())
$sig
```

Alternativa com OpenSSL (bash):

```bash
SIG="sha256=$(openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" payload-app.json | sed 's/^.* //')"
echo "$SIG"
```

6. Envie `curl` com assinatura valida e `installation.id` (deve processar):

```bash
curl -X POST http://localhost:3000/github/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-GitHub-Delivery: manual-delivery-1" \
  -H "X-Hub-Signature-256: $SIG" \
  --data-binary @payload-app.json
```

Resultado esperado: HTTP `200` e logs com `source=github-app` e status de webhook aceito/processado.

7. Exemplo de payload sem `installation.id` (simula webhook antigo de repo):

```json
{
  "ref": "refs/heads/main",
  "after": "2222222222222222222222222222222222222222",
  "repository": {
    "full_name": "acme/my-repo",
    "name": "my-repo",
    "owner": {
      "login": "acme"
    }
  }
}
```

Envie com assinatura valida para esse payload e espere HTTP `200` com log de webhook ignorado (`source=repo-webhook`).

8. Teste assinatura invalida:

```bash
curl -X POST http://localhost:3000/github/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-GitHub-Delivery: manual-delivery-invalid" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  --data-binary @payload-app.json
```

Resultado esperado: HTTP `401` e log de rejeicao por assinatura.

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
