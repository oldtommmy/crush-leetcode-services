# Crush LeetCode Services

Crush LeetCode 的服务端仓库。当前包含官方周报邮件服务，后续插件相关 API 也可以继续放在这里。

## 目录结构

```text
crush-leetcode-services/
  apps/
    mailer/
      server.js
      api/
      admin.html
      admin-dashboard.html
  packages/
    shared/
      schemas/
      types/
      crypto/
  docs/
    使用手册.md
    AGENTS.md
  .env.example
  README.md
```

## 当前服务

`apps/mailer` 是官方周报邮件服务，包含邮件发送、内测访问码和后台管理能力。

具体接口和部署地址不要写在公开 README 中；如需本机使用说明，见 `docs/使用手册.md`。

## 本地启动

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

本地默认监听 `127.0.0.1:8787`。生产域名、Cloudflare Tunnel、Brevo sender 等信息请放在私有部署文档或 `.env.local`，不要写进公开 README。

## 文档

- 使用说明：[docs/使用手册.md](docs/使用手册.md)
- Agent 接手说明：[docs/AGENTS.md](docs/AGENTS.md)

## 安全注意

不要提交：

- `.env.local`
- `.env.beta.local`
- `.data/`
- `*.sqlite`
- Brevo API Key
- beta/admin/session secrets

数据库只保存 beta code 的 HMAC hash，不保存明文 code。

服务内置基础内存 rate limit，用于降低公开接口被扫时的压力。生产环境如果有更高流量或多实例部署，建议再接入网关层 rate limit。
