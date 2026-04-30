# Crush LeetCode Services

Crush LeetCode 的服务端仓库。当前只包含官方周报邮件服务，后续插件相关 API 也可以继续放在这里。

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

`apps/mailer` 是官方周报邮件服务：

- `POST /api/send-reminder`: 插件调用的邮件发送接口。
- `POST /api/issue-beta-code`: 后台/脚本签发 beta code。
- `/admin`: 后台登录页。
- `/admin/dashboard`: 用户管理和访问码审计后台。

公网默认地址：

```text
https://mail.crushlc.site
```

## 本地启动

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

本地地址：

```text
http://127.0.0.1:8787
```

后台入口：

```text
http://127.0.0.1:8787/admin
```

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
