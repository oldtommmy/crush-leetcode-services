# Crush LeetCode Services

Service backend for [Crush LeetCode](https://github.com/oldtommmy/crush-leetcode), focused on official reminder delivery, beta access management, and future extension-facing APIs.

This repository is intentionally small and self-host friendly. The current app uses plain Node.js, SQLite, and server-rendered static admin pages so it can run on a lightweight personal server without a full backend framework.

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

## Local Development

```bash
cd apps/mailer
cp .env.example .env.local
npm run start
```

By default, the service listens on `127.0.0.1:8787`.

Required environment variables are documented in `.env.example`. Real deployment domains, tunnel configuration, sender addresses, and secrets should stay in private deployment notes or local environment files.

## Security Model

- Extension requests are authenticated with a shared server-side secret.
- Admin APIs accept an HttpOnly session cookie or an admin secret for local scripts.
- Beta access codes are stored as HMAC hashes, not plaintext.
- SQLite runtime data and all `.env*` files are ignored by Git.
- Public documentation avoids production domains, tunnel IDs, sender configuration, and local absolute paths.
- Basic per-IP rate limits are built in; gateway-level rate limiting is still recommended for larger deployments.

## Shared Packages

`packages/shared` is reserved for future reusable schemas, types, and crypto helpers as the service surface grows. It is currently a placeholder so later APIs can be added without reshaping the repository.

## License

No license has been selected yet.
