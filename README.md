# Crush LeetCode Services

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

Crush LeetCode Services 是 [Crush LeetCode](https://github.com/oldtommmy/crush-leetcode) 的服务端仓库，用来承载插件侧不适合直接放在浏览器里的能力，例如官方周报邮件、内测访问码、用户管理后台，以及后续可能新增的远程配置、公告、统计聚合等 API。

这个仓库刻意保持轻量和自托管友好。当前核心应用 `apps/mailer` 使用 Node.js 原生 HTTP server、SQLite 本地数据库和静态后台页面，不依赖复杂后端框架，适合部署在个人服务器、Mac mini 或其他轻量主机上。

### 功能

- 官方周报和提醒邮件转发。
- 邮件服务商密钥隔离在服务端，避免暴露到 Chrome Extension。
- beta access code 签发、校验、撤销和审计。
- 轻量后台管理页，支持用户名/密码登录和 HttpOnly session cookie。
- SQLite 存储用户和访问码状态。
- beta code 只保存 HMAC hash，明文 code 只在签发成功时展示一次。
- 面向公开接口的基础内存 rate limit。

### 目录结构

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

### 当前应用

`apps/mailer` 是当前的官方周报邮件服务：

- 接收插件触发的提醒/周报请求。
- 校验共享密钥和 beta access code。
- 通过邮件服务商发送邮件。
- 提供后台登录、用户管理和 code 审计。
- 提供健康检查。

### 本地开发

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

默认监听 `127.0.0.1:8787`。

真实部署域名、Tunnel 配置、发件邮箱和密钥不要写进公开文档，请放在本地 `.env.local` 或私有运维记录中。

### 安全设计

- 插件请求通过服务端共享密钥鉴权。
- 后台 API 支持 HttpOnly session cookie，也兼容本地脚本使用 admin secret。
- beta code 不明文落库，只保存 HMAC hash。
- SQLite 运行时数据和 `.env*` 文件被 Git 忽略。
- 公开文档避免出现生产域名、Tunnel ID、发件配置和本机绝对路径。
- 内置基础 per-IP rate limit；更大规模部署建议再接入网关层限流。

### 共享包

`packages/shared` 预留给未来的可复用 schema、类型和 crypto helper。当前只是占位，方便后续扩展更多服务端 API。

### License

MIT

---

## English

Crush LeetCode Services is the service backend for [Crush LeetCode](https://github.com/oldtommmy/crush-leetcode). It hosts capabilities that should not live directly inside the browser extension, such as official email delivery, beta access management, the admin console, and future extension-facing APIs.

The repository is intentionally lightweight and self-host friendly. The current app, `apps/mailer`, uses plain Node.js, local SQLite storage, and static server-rendered admin pages, so it can run on a small personal server without a full backend framework.

### Features

- Official weekly digest and reminder email relay.
- Server-side isolation for email provider credentials.
- Beta access code issuance, validation, revocation, and audit.
- Lightweight admin console with username/password login and HttpOnly session cookies.
- SQLite-backed user and access-code storage.
- HMAC-hashed beta codes; plaintext codes are only shown once at issuance time.
- Basic in-memory rate limits for public-facing endpoints.

### Repository Layout

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

### Current App

`apps/mailer` provides the current official mailer service:

- Receives reminder and weekly digest requests from the extension.
- Verifies the shared server secret and beta access code.
- Sends email through a server-side email provider integration.
- Provides admin login, user management, and code audit.
- Provides a health check endpoint.

### Local Development

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

By default, the service listens on `127.0.0.1:8787`.

Real deployment domains, tunnel configuration, sender addresses, and secrets should stay in private deployment notes or local environment files, not public documentation.

### Security Model

- Extension requests are authenticated with a shared server-side secret.
- Admin APIs accept an HttpOnly session cookie and also support an admin secret for local scripts.
- Beta access codes are stored as HMAC hashes, not plaintext.
- SQLite runtime data and all `.env*` files are ignored by Git.
- Public documentation avoids production domains, tunnel IDs, sender configuration, and local absolute paths.
- Basic per-IP rate limits are built in; gateway-level rate limiting is still recommended for larger deployments.

### Shared Packages

`packages/shared` is reserved for future reusable schemas, types, and crypto helpers as the service surface grows. It is currently a placeholder so later APIs can be added without reshaping the repository.

### License

MIT
