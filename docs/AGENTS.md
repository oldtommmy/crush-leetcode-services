# AGENTS.md

## 项目定位

这是 Crush LeetCode 的服务端仓库。当前实现的是官方周报邮件服务，未来可继续承载插件相关 API。

仓库路径：

```text
/Users/cyh/Desktop/Code/tools/leetcode_plugins/crush-leetcode-services
```

当前运行中的生产服务仍由本机自托管目录提供：

```text
/Users/cyh/Desktop/Code/tools/leetcode_plugins/crush_leetcode_mailer_service
```

如果要切换生产服务到本仓库，应进入：

```text
apps/mailer
```

然后启动：

```bash
npm run start
```

## 目录结构

```text
apps/mailer/                 官方周报邮件服务
packages/shared/schemas/     未来放接口 schema
packages/shared/types/       未来放共享类型
packages/shared/crypto/      未来放共享 crypto helper
docs/使用手册.md              给用户看的中文说明
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

健康检查：

```bash
curl -X POST http://127.0.0.1:8787/api/health
curl -X POST https://mail.crushlc.site/api/health
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

- `POST /api/send-reminder`
- Header `X-Crush-Secret`
- 对比 `REMINDER_SHARED_SECRET`

后台登录：

- `POST /api/admin/session`
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

插件侧默认请求：

```text
POST https://mail.crushlc.site/api/send-reminder
Header: X-Crush-Secret
```

只要域名和接口契约不变，后端内部目录或部署方式变化不需要改插件。
