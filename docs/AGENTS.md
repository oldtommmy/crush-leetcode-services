# AGENTS.md

## 项目定位

这是 Crush LeetCode 的服务端仓库。当前实现的是官方周报邮件服务，未来可继续承载插件相关 API。

不要在公开文档中写入真实生产域名、Tunnel ID、本机绝对路径、Brevo sender 或任何 secret。

## 目录结构

```text
apps/mailer/                 官方周报邮件服务
packages/shared/schemas/     未来放接口 schema
packages/shared/types/       未来放共享类型
packages/shared/crypto/      未来放共享 crypto helper
docs/使用手册.md              给用户看的通用中文说明
docs/AGENTS.md               给 Agent 的接手说明
```

## Mailer 服务

关键文件：

```text
apps/mailer/server.js
apps/mailer/api/_lib.js
apps/mailer/api/send-reminder.js
apps/mailer/api/issue-beta-code.js
apps/mailer/api/admin-session.js
apps/mailer/api/admin-users.js
apps/mailer/api/admin-beta-codes.js
apps/mailer/admin.html
apps/mailer/admin-dashboard.html
apps/mailer/admin-logo.png
```

## 运行和验证

本机启动：

```bash
cd apps/mailer
npm run start
```

语法检查：

```bash
node --check server.js
node --check api/_lib.js
node --check api/admin-session.js
node --check api/admin-users.js
node --check api/admin-beta-codes.js
node --check api/issue-beta-code.js
node --check api/send-reminder.js
```

本机健康检查：

```bash
curl -X POST http://127.0.0.1:8787/api/health
```

## Secret 规则

永远不要提交或在回复里明文展示：

```text
BREVO_API_KEY
REMINDER_SHARED_SECRET
BETA_CODE_SIGNING_SECRET
BETA_ADMIN_SECRET
BETA_ADMIN_PASSWORD
BETA_ADMIN_SESSION_SECRET
```

只允许输出是否存在、长度、脱敏 preview。

不要提交：

```text
.env.local
.env.beta.local
.data/
*.sqlite
```

## 鉴权模型

插件邮件接口：

- 邮件发送接口需要 Header `X-Crush-Secret`
- 与 `REMINDER_SHARED_SECRET` 做 timing-safe compare

后台登录：

- 用户名默认 `admin`
- 密码优先 `BETA_ADMIN_PASSWORD`
- 未配置时兼容 `BETA_ADMIN_SECRET`
- 登录成功写 HttpOnly cookie `crush_admin_session`

后台 API：

- 优先校验 HttpOnly cookie
- 兼容 `X-Admin-Secret` 用于脚本和 curl

Beta code：

- 新 code 格式 `clcb_...`
- 数据库只保存 HMAC hash
- 明文 code 只在签发接口返回一次
- 不要新增明文 code 持久化

## Rate Limit

`apps/mailer/api/_lib.js` 内置单进程内存 rate limit：

```text
mailer:    30 requests / minute / IP
adminAuth: 10 requests / 5 minutes / IP
adminApi:  120 requests / minute / IP
```

命中限制返回 `429` 和 `Retry-After`。这是基础防扫保护，不是分布式限流；多实例或高流量生产环境应接网关层 rate limit。

## 数据库

SQLite 默认路径：

```text
apps/mailer/.data/mailer.sqlite
```

表：

```text
official_users
beta_access_codes
```

清库或迁移前先备份数据库。

## 和插件的契约

插件侧需要调用服务端邮件发送接口，并携带共享密钥。不要在公开文档中写真实生产域名；真实域名应通过插件配置、构建变量或私有部署文档维护。
