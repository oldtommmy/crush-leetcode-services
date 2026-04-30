# Repository Guidelines

## Project Structure & Module Organization

This repository hosts Crush LeetCode service code. The active service is `apps/mailer`, a Node.js HTTP server for reminder email delivery, beta-code issuance, and the admin console. API route handlers live in `apps/mailer/api/`, static admin pages live beside `server.js`, and mailer environment templates are `apps/mailer/.env.example` and `.env.local.example`. Shared package directories under `packages/shared/` are placeholders for future schemas, types, and crypto helpers. User and agent documentation lives in `docs/`.

## Build, Test, and Development Commands

Run commands from `apps/mailer` unless noted:

```bash
npm run start
```

Starts the local server on `127.0.0.1:8787` by default.

```bash
node --check server.js
node --check api/_lib.js api/*.js
```

Performs syntax validation for the server and API handlers. There is no build step or package-level test script yet.

```bash
curl -X POST http://127.0.0.1:8787/api/health
```

Checks the local health endpoint after startup.

## Coding Style & Naming Conventions

Use CommonJS modules (`require`, `module.exports`) and plain Node.js APIs, matching the existing service. Keep indentation at two spaces, terminate statements with semicolons, and prefer small route handlers in `api/<feature-name>.js`. Use kebab-case for file names such as `send-reminder.js` and descriptive camelCase for local functions and variables.

## Testing Guidelines

No formal test framework is currently configured. For changes, at minimum run `node --check` on modified JavaScript files and manually exercise affected endpoints with `curl` or the admin pages. If adding automated tests, place them near the mailer app, document the command in `apps/mailer/package.json`, and name tests after the route or behavior under test.

## Commit & Pull Request Guidelines

The current history uses Conventional Commit style, for example `chore: initialize crush leetcode services repo`. Continue with concise prefixes such as `feat:`, `fix:`, `docs:`, and `chore:`. Pull requests should include a short behavior summary, validation commands run, linked issue or context, and screenshots for admin UI changes.

## Security & Configuration Tips

Never commit `.env.local`, `.env.beta.local`, `.data/`, `*.sqlite`, Brevo API keys, beta/admin secrets, or session secrets. Public docs should not include production domains, tunnel IDs, local absolute paths, or real sender configuration. Beta codes must remain write-once secrets: persist only HMAC hashes, not plaintext codes.
