# Crush LeetCode Services

Service backend for [Crush LeetCode](https://github.com/oldtommmy/crush-leetcode), focused on official reminder delivery, beta access management, and future extension-facing APIs.

This repository is intentionally small and self-host friendly. The current app uses plain Node.js, SQLite, and server-rendered static admin pages so it can run on a lightweight personal server without a full backend framework.

## 中文简介

这是 [Crush LeetCode](https://github.com/oldtommmy/crush-leetcode) 的服务端仓库，用来承载插件侧不适合直接放在浏览器里的能力，例如官方周报邮件、内测访问码、用户管理后台，以及后续可能新增的远程配置、公告、统计聚合等 API。

当前仓库重点是 `apps/mailer`：一个轻量的自托管邮件服务。它使用 Node.js 原生 HTTP server、SQLite 本地数据库和静态后台页面，不依赖复杂框架，适合部署在个人服务器、Mac mini 或其他轻量主机上。

设计目标：

- 把邮件服务商密钥留在服务端，避免暴露到 Chrome Extension。
- 用 beta access code 控制官方周报服务的内测访问。
- 提供一个简单后台，管理用户、签发 code、撤销 code 和查看使用状态。
- 保持部署简单，方便后续扩展更多 Crush LeetCode 相关服务。

## Features

- Official weekly digest and reminder email relay.
- Server-side email provider credential isolation.
- Beta access code issuance, validation, revocation, and audit.
- Lightweight admin console with username/password login and HttpOnly session cookies.
- SQLite-backed user and access-code storage.
- HMAC-hashed beta codes; plaintext codes are only shown once at issuance time.
- Basic in-memory rate limits for public-facing endpoints.

## Repository Layout

```text
crush-leetcode-services/
  apps/
    mailer/
      server.js
      api/
      admin.html
      admin-dashboard.html
      admin-logo.png
  packages/
    shared/
      schemas/
      types/
      crypto/
  .env.example
  README.md
```

## Apps

### `apps/mailer`

The mailer app provides the current production service surface:

- Email relay for extension-triggered reminders and weekly digests.
- Admin session handling.
- User management and beta-code management.
- Health check endpoint.

The app is written in CommonJS and uses only built-in Node.js modules plus SQLite from the local Node runtime.

中文说明：

- 负责接收插件触发的提醒/周报请求。
- 校验共享密钥和 beta access code。
- 通过邮件服务商发送邮件。
- 提供后台登录、用户管理和 code 审计。
- 明文 code 只在签发成功时展示一次，数据库只保存 hash。

## Local Development

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

By default, the service listens on `127.0.0.1:8787`.

Required environment variables are documented in `.env.example`. Real deployment domains, tunnel configuration, sender addresses, and secrets should stay in private deployment notes or local environment files.

本地开发：

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

默认监听 `127.0.0.1:8787`。真实部署域名、Tunnel 配置、发件邮箱和密钥不要写进公开文档，请放在本地 `.env.local` 或私有运维记录中。

## Security Model

- Extension requests are authenticated with a shared server-side secret.
- Admin APIs accept an HttpOnly session cookie or an admin secret for local scripts.
- Beta access codes are stored as HMAC hashes, not plaintext.
- SQLite runtime data and all `.env*` files are ignored by Git.
- Public documentation avoids production domains, tunnel IDs, sender configuration, and local absolute paths.
- Basic per-IP rate limits are built in; gateway-level rate limiting is still recommended for larger deployments.

安全设计：

- 插件请求通过服务端共享密钥鉴权。
- 后台使用用户名/密码登录，并通过 HttpOnly session cookie 维持登录态。
- 本地脚本可使用 admin secret 调用管理接口。
- beta code 不明文落库，只保存 HMAC hash。
- `.env*`、SQLite 数据库和运行时数据不会提交到仓库。
- 公开 README 不包含真实生产域名、Tunnel ID、发件邮箱或本机绝对路径。

## Shared Packages

`packages/shared` is reserved for future reusable schemas, types, and crypto helpers as the service surface grows. It is currently a placeholder so later APIs can be added without reshaping the repository.

## License

MIT
